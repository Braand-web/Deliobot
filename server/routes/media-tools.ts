// The routes behind generate_video and generate_music: one shape for both, since each is a paid fal.ai job a bot may
// start only for a person's own message, within a per-reply limit and a daily cap, and lands as an attachment.
import type { ServerResponse } from "node:http";
import { z } from "zod";

import { MUSIC_DAILY_CAP_DEFAULT, MUSIC_MAX_PER_TURN_DEFAULT, MUSIC_SECONDS_MAX } from "../../shared/music-generation.ts";
import { VIDEO_ASPECTS, VIDEO_DAILY_CAP_DEFAULT, VIDEO_MAX_PER_TURN_DEFAULT, VIDEO_SECONDS_MAX } from "../../shared/video-generation.ts";
import { MUSIC_LYRICS_MAX_CHARS, MUSIC_PROMPT_MAX_CHARS } from "../drivers/agents-music-tools.ts";
import { VIDEO_PROMPT_MAX_CHARS } from "../drivers/agents-video-tools.ts";
import type { json } from "../harness/http.ts";
import { createImageDailyCap, type ImageDailyCap } from "../image-daily-cap.ts";
import { generateMusic, musicGenerationReady, type MusicCredentials } from "../music-generation.ts";
import { generateVideo, videoGenerationReady, type VideoCredentials } from "../video-generation.ts";
import { PASS } from "./table.ts";

export interface GeneratedMedia { bytes: Buffer; mime: string; model: string; seconds: number }
export type MediaKind = "video" | "music";
export type MediaCredentials = VideoCredentials & MusicCredentials;

interface MediaSpec {
  path: string;
  dayFile: string;
  schema: z.ZodType<Record<string, unknown>>;
  usage: string;
  ready: (cfg: MediaCredentials) => boolean;
  limits: (cfg: MediaCredentials) => { maxPerTurn: number; dailyCap: number };
  generate: (cfg: MediaCredentials, request: never, options: { fetchImpl?: typeof fetch; signal?: AbortSignal }) => Promise<GeneratedMedia>;
  messages: { notSetUp: string; notPerson: string; perTurn: (limit: number) => string; dailyCap: (cap: number) => string; made: (media: GeneratedMedia) => string };
}

const NO_TURN = "This turn has not started yet or already ended, so the file could not be attached.";
const NOT_SAVED = "The file could not be saved. Try again shortly.";

export const MEDIA_SPECS: Record<MediaKind, MediaSpec> = {
  video: {
    path: "/api/internal/videos/generate",
    dayFile: "video-generation-day.json",
    schema: z.object({ prompt: z.string().trim().min(1).max(VIDEO_PROMPT_MAX_CHARS), seconds: z.number().int().min(1).max(VIDEO_SECONDS_MAX).optional(), aspect: z.enum(VIDEO_ASPECTS).optional() }),
    usage: `generate_video takes a prompt (1 to ${VIDEO_PROMPT_MAX_CHARS} characters), optional seconds (1 to ${VIDEO_SECONDS_MAX}) and an optional aspect (${VIDEO_ASPECTS.join(", ")}).`,
    ready: videoGenerationReady,
    limits: (cfg) => ({ maxPerTurn: cfg.videoGen?.maxPerTurn ?? VIDEO_MAX_PER_TURN_DEFAULT, dailyCap: cfg.videoGen?.dailyCap ?? VIDEO_DAILY_CAP_DEFAULT }),
    generate: (cfg, request, options) => generateVideo(cfg, request, options),
    messages: {
      notSetUp: "Video generation isn't turned on here. Ask the person to add a fal.ai key and turn videos on in Settings → AI → Image generation.",
      notPerson: "Videos are made only for a person's own message in a chat. This turn was started another way, so no video was made. Tell the person they can ask for the video in a chat.",
      perTurn: (limit) => `This turn already has ${limit === 1 ? "a video" : `${limit} videos`}, the most the person allows per reply. Send what you have.`,
      dailyCap: (cap) => `Bots here have made ${cap} videos today, the most allowed in one day, so no video was made. Tell the person it starts again after midnight.`,
      made: (media) => `A ${media.seconds}-second video was made by fal.ai (${media.model}). It will be attached to this turn's reply when the turn ends.`,
    },
  },
  music: {
    path: "/api/internal/music/generate",
    dayFile: "music-generation-day.json",
    schema: z.object({ prompt: z.string().trim().min(1).max(MUSIC_PROMPT_MAX_CHARS), seconds: z.number().int().min(1).max(MUSIC_SECONDS_MAX).optional(), lyrics: z.string().trim().max(MUSIC_LYRICS_MAX_CHARS).optional() }),
    usage: `generate_music takes a prompt (1 to ${MUSIC_PROMPT_MAX_CHARS} characters), optional seconds (1 to ${MUSIC_SECONDS_MAX}) and optional lyrics.`,
    ready: musicGenerationReady,
    limits: (cfg) => ({ maxPerTurn: cfg.musicGen?.maxPerTurn ?? MUSIC_MAX_PER_TURN_DEFAULT, dailyCap: cfg.musicGen?.dailyCap ?? MUSIC_DAILY_CAP_DEFAULT }),
    generate: (cfg, request, options) => generateMusic(cfg, request, options),
    messages: {
      notSetUp: "Music generation isn't turned on here. Ask the person to add a fal.ai key and turn music on in Settings → AI → Image generation.",
      notPerson: "Music is made only for a person's own message in a chat. This turn was started another way, so none was made. Tell the person they can ask for it in a chat.",
      perTurn: (limit) => `This turn already has ${limit === 1 ? "a track" : `${limit} tracks`}, the most the person allows per reply. Send what you have.`,
      dailyCap: (cap) => `Bots here have made ${cap} tracks today, the most allowed in one day, so none was made. Tell the person it starts again after midnight.`,
      made: (media) => `A ${media.seconds}-second track was made by fal.ai (${media.model}). It will be attached to this turn's reply when the turn ends.`,
    },
  },
};

export interface MediaTurn {
  key: string;
  parked: () => number;
  attach: (media: GeneratedMedia) => Promise<boolean>;
}

export interface MediaToolDeps {
  cfg: MediaCredentials;
  personTurn: boolean;
  daily: ImageDailyCap;
  fetchImpl?: typeof fetch;
  turn: MediaTurn | null;
  inFlight: Map<string, number>;
  signal?: AbortSignal;
  /** Told of every file fal.ai made, attached or not: it was paid for either way. */
  made?: (media: GeneratedMedia) => void;
}

type Outcome = { status: number; body: { text: string } | { error: string } };

export async function generateMediaForTurn(kind: MediaKind, raw: unknown, deps: MediaToolDeps): Promise<Outcome> {
  const spec = MEDIA_SPECS[kind];
  const parsed = spec.schema.safeParse(raw);
  if (!parsed.success) return { status: 400, body: { error: spec.usage } };
  if (!deps.personTurn) return { status: 403, body: { error: spec.messages.notPerson } };
  if (!spec.ready(deps.cfg)) return { status: 409, body: { error: spec.messages.notSetUp } };
  const { turn } = deps;
  if (!turn) return { status: 409, body: { error: NO_TURN } };
  const { maxPerTurn } = spec.limits(deps.cfg);
  if (turn.parked() + (deps.inFlight.get(turn.key) ?? 0) >= maxPerTurn) return { status: 429, body: { error: spec.messages.perTurn(maxPerTurn) } };
  if (!deps.daily.reserve()) return { status: 429, body: { error: spec.messages.dailyCap(deps.daily.cap) } };
  let made = false;
  deps.inFlight.set(turn.key, (deps.inFlight.get(turn.key) ?? 0) + 1);
  try {
    const media = await spec.generate(deps.cfg, parsed.data as never, { fetchImpl: deps.fetchImpl, signal: deps.signal });
    made = true;
    deps.made?.(media);
    if (!await turn.attach(media)) return { status: 409, body: { error: NO_TURN } };
    return { status: 201, body: { text: spec.messages.made(media) } };
  } catch (error) {
    const status = (error as { status?: unknown } | null)?.status;
    if (typeof status !== "number" || !(error instanceof Error)) return { status: 500, body: { error: NOT_SAVED } };
    return { status, body: { error: error.message } };
  } finally {
    deps.daily.settle(made);
    const left = (deps.inFlight.get(turn.key) ?? 1) - 1;
    if (left > 0) deps.inFlight.set(turn.key, left); else deps.inFlight.delete(turn.key);
  }
}

export interface MediaRouteContext {
  method: string;
  path: string;
  res: ServerResponse;
  json: typeof json;
  readBody: () => Promise<unknown>;
  threadId: string;
  requireActive: () => void;
  personTurn: boolean;
  botId: string;
}

export interface MediaTurnStore {
  liveTurn: (threadId: string) => string | undefined;
  key: (threadId: string, turnId: string) => string;
  parked: (kind: MediaKind, key: string) => number;
  park: (kind: MediaKind, key: string, media: GeneratedMedia) => Promise<void>;
}

export function mediaTurn(store: MediaTurnStore, kind: MediaKind, threadId: string, requireActive: () => void): MediaTurn | null {
  requireActive();
  const turnId = store.liveTurn(threadId);
  if (!turnId) return null;
  const key = store.key(threadId, turnId);
  return {
    key,
    parked: () => store.parked(kind, key),
    attach: async (media) => {
      requireActive();
      if (store.liveTurn(threadId) !== turnId) return false;
      await store.park(kind, key, media);
      return true;
    },
  };
}

export function createMediaToolRoutes(deps: MediaTurnStore & {
  config: () => MediaCredentials;
  dataDir: string;
  fetchImpl?: typeof fetch;
  made?: (kind: MediaKind, media: GeneratedMedia, by: { botId: string; threadId: string }) => void;
}) {
  const inFlight = new Map<string, number>();
  const counters = new Map<MediaKind, { cap: number; counter: ImageDailyCap }>();
  const daily = (kind: MediaKind) => {
    const cap = MEDIA_SPECS[kind].limits(deps.config()).dailyCap;
    const current = counters.get(kind);
    if (current?.cap === cap) return current.counter;
    const counter = createImageDailyCap(deps.dataDir, { cap, file: MEDIA_SPECS[kind].dayFile });
    counters.set(kind, { cap, counter });
    return counter;
  };
  return {
    async internal(ctx: MediaRouteContext): Promise<typeof PASS | void> {
      const kind = (Object.keys(MEDIA_SPECS) as MediaKind[]).find((name) => MEDIA_SPECS[name].path === ctx.path);
      if (ctx.method !== "POST" || !kind) return PASS;
      const turn = mediaTurn(deps, kind, ctx.threadId, ctx.requireActive);
      const call = new AbortController();
      ctx.res.once("close", () => { if (!ctx.res.writableEnded) call.abort(); });
      const outcome = await generateMediaForTurn(kind, await ctx.readBody(), {
        cfg: deps.config(), personTurn: ctx.personTurn, daily: daily(kind), fetchImpl: deps.fetchImpl, turn, inFlight, signal: call.signal,
        made: (media) => deps.made?.(kind, media, { botId: ctx.botId, threadId: ctx.threadId }),
      });
      ctx.json(ctx.res, outcome.status, outcome.body);
    },
  };
}
