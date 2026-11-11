import type { ServerResponse } from "node:http";
import { z } from "zod";

import { VIDEO_ASPECTS, VIDEO_DAILY_CAP_DEFAULT, VIDEO_MAX_PER_TURN_DEFAULT, VIDEO_SECONDS_MAX } from "../../shared/video-generation.ts";
import { VIDEO_PROMPT_MAX_CHARS } from "../drivers/agents-video-tools.ts";
import type { json } from "../harness/http.ts";
import { createImageDailyCap, type ImageDailyCap } from "../image-daily-cap.ts";
import { generateVideo, videoGenerationReady, type GeneratedVideo, type VideoCredentials } from "../video-generation.ts";
import { PASS } from "./table.ts";

export const VIDEO_DAY_FILE = "video-generation-day.json";

export const VIDEO_MESSAGES = {
  notSetUp: "Video generation isn't turned on here. Ask the person to add a fal.ai key and turn videos on in Settings → AI → Video generation.",
  noTurn: "This turn has not started yet or already ended, so the video could not be attached.",
  notSaved: "The video could not be saved. Try again shortly.",
  notPerson: "Videos are made only for a person's own message in a chat. This turn was started another way, so no video was made. Tell the person they can ask for the video in a chat.",
  dailyCap: (cap: number) => `Bots here have made ${cap} videos today, the most allowed in one day, so no video was made. Tell the person it starts again after midnight.`,
} as const;

const requestSchema = z.object({
  prompt: z.string().trim().min(1).max(VIDEO_PROMPT_MAX_CHARS),
  seconds: z.number().int().min(1).max(VIDEO_SECONDS_MAX).optional(),
  aspect: z.enum(VIDEO_ASPECTS).optional(),
});

export interface VideoTurn {
  key: string;
  parked: () => number;
  attach: (video: GeneratedVideo) => Promise<boolean>;
}

export interface VideoToolDeps {
  cfg: VideoCredentials;
  personTurn: boolean;
  daily: ImageDailyCap;
  fetchImpl?: typeof fetch;
  turn: VideoTurn | null;
  inFlight: Map<string, number>;
  signal?: AbortSignal;
  /** Told of every video fal.ai made, attached or not: it was paid for either way. */
  made?: (video: GeneratedVideo) => void;
}

type Outcome = { status: number; body: { text: string } | { error: string } };

export async function generateVideoForTurn(raw: unknown, deps: VideoToolDeps): Promise<Outcome> {
  const parsed = requestSchema.safeParse(raw);
  if (!parsed.success) {
    return { status: 400, body: { error: `generate_video takes a prompt (1 to ${VIDEO_PROMPT_MAX_CHARS} characters), optional seconds (1 to ${VIDEO_SECONDS_MAX}) and an optional aspect (${VIDEO_ASPECTS.join(", ")}).` } };
  }
  if (!deps.personTurn) return { status: 403, body: { error: VIDEO_MESSAGES.notPerson } };
  if (!videoGenerationReady(deps.cfg)) return { status: 409, body: { error: VIDEO_MESSAGES.notSetUp } };
  const { turn } = deps;
  if (!turn) return { status: 409, body: { error: VIDEO_MESSAGES.noTurn } };
  const limit = deps.cfg.videoGen?.maxPerTurn ?? VIDEO_MAX_PER_TURN_DEFAULT;
  if (turn.parked() + (deps.inFlight.get(turn.key) ?? 0) >= limit) {
    return { status: 429, body: { error: `This turn already has ${limit === 1 ? "a video" : `${limit} videos`}, the most the person allows per reply. Send what you have.` } };
  }
  if (!deps.daily.reserve()) return { status: 429, body: { error: VIDEO_MESSAGES.dailyCap(deps.daily.cap) } };
  let made = false;
  deps.inFlight.set(turn.key, (deps.inFlight.get(turn.key) ?? 0) + 1);
  try {
    const video = await generateVideo(deps.cfg, parsed.data, { fetchImpl: deps.fetchImpl, signal: deps.signal });
    made = true;
    deps.made?.(video);
    if (!await turn.attach(video)) return { status: 409, body: { error: VIDEO_MESSAGES.noTurn } };
    return { status: 201, body: { text: `A ${video.seconds}-second video was made by fal.ai (${video.model}). It will be attached to this turn's reply when the turn ends.` } };
  } catch (error) {
    const status = (error as { status?: unknown } | null)?.status;
    if (typeof status !== "number" || !(error instanceof Error)) return { status: 500, body: { error: VIDEO_MESSAGES.notSaved } };
    return { status, body: { error: error.message } };
  } finally {
    deps.daily.settle(made);
    const left = (deps.inFlight.get(turn.key) ?? 1) - 1;
    if (left > 0) deps.inFlight.set(turn.key, left); else deps.inFlight.delete(turn.key);
  }
}

export interface VideoRouteContext {
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

export interface VideoTurnStore {
  liveTurn: (threadId: string) => string | undefined;
  key: (threadId: string, turnId: string) => string;
  videos: (key: string) => number;
  park: (key: string, video: GeneratedVideo) => Promise<void>;
}

export function videoTurn(store: VideoTurnStore, threadId: string, requireActive: () => void): VideoTurn | null {
  requireActive();
  const turnId = store.liveTurn(threadId);
  if (!turnId) return null;
  const key = store.key(threadId, turnId);
  return {
    key,
    parked: () => store.videos(key),
    attach: async (video) => {
      requireActive();
      if (store.liveTurn(threadId) !== turnId) return false;
      await store.park(key, video);
      return true;
    },
  };
}

export function createVideoToolRoutes(deps: VideoTurnStore & { config: () => VideoCredentials; dataDir: string; fetchImpl?: typeof fetch; made?: (video: GeneratedVideo, by: { botId: string; threadId: string }) => void }) {
  const inFlight = new Map<string, number>();
  const daily = (() => {
    let current: { cap: number; counter: ImageDailyCap } | null = null;
    return () => {
      const cap = deps.config().videoGen?.dailyCap ?? VIDEO_DAILY_CAP_DEFAULT;
      if (current?.cap !== cap) current = { cap, counter: createImageDailyCap(deps.dataDir, { cap, file: VIDEO_DAY_FILE }) };
      return current.counter;
    };
  })();
  return {
    async internal(ctx: VideoRouteContext): Promise<typeof PASS | void> {
      if (ctx.method !== "POST" || ctx.path !== "/api/internal/videos/generate") return PASS;
      const turn = videoTurn(deps, ctx.threadId, ctx.requireActive);
      const call = new AbortController();
      ctx.res.once("close", () => { if (!ctx.res.writableEnded) call.abort(); });
      const outcome = await generateVideoForTurn(await ctx.readBody(), {
        cfg: deps.config(), personTurn: ctx.personTurn, daily: daily(), fetchImpl: deps.fetchImpl, turn, inFlight, signal: call.signal, made: (video) => deps.made?.(video, { botId: ctx.botId, threadId: ctx.threadId }),
      });
      ctx.json(ctx.res, outcome.status, outcome.body);
    },
  };
}
