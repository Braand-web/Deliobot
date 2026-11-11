import { MUSIC_SECONDS_DEFAULT, MUSIC_SECONDS_MAX, type MusicGenerationConfig } from "../shared/music-generation.ts";
import { PREVIEW_MAX_BYTES } from "../shared/upload-limits.ts";
import { createFalSchemaCache, falDownload, falError, falInput, falRun, validFalModel } from "./fal.ts";
import { autoMusicModel, MEDIA_AUTO } from "./media-auto.ts";

export const MUSIC_GENERATION_TIMEOUT_MS = 5 * 60_000;
/** What fal's audio models answer with, and the voice-note formats the chat plays. */
const AUDIO_MIMES = ["audio/mpeg", "audio/mp3", "audio/wav", "audio/x-wav", "audio/wave"] as const;

export interface MusicCredentials {
  fal?: { key?: string };
  musicGen?: MusicGenerationConfig;
}

export interface MusicRequest {
  prompt: string;
  seconds?: number;
  lyrics?: string;
}

export interface GeneratedMusic {
  bytes: Buffer;
  mime: string;
  model: string;
  seconds: number;
}

export function musicGenerationReady(cfg: MusicCredentials): boolean {
  return cfg.musicGen?.enabled === true && Boolean(cfg.fal?.key?.trim());
}

export function musicMaxSeconds(cfg: MusicCredentials): number {
  const max = cfg.musicGen?.maxSeconds;
  return typeof max === "number" && Number.isInteger(max) && max >= 1 ? Math.min(max, MUSIC_SECONDS_MAX) : 60;
}

export function musicModel(cfg: MusicCredentials, request: MusicRequest): string {
  const model = cfg.musicGen?.model?.trim() ?? "";
  return model && model !== MEDIA_AUTO && validFalModel(model) ? model : autoMusicModel(request);
}

/** The first audio file a result names: fal's audio models use `audio`, `audio_file` or `audio_url`. */
export function falAudioUrl(result: Record<string, unknown>): string | null {
  for (const key of ["audio", "audio_file", "audio_url", "output"]) {
    const value = result[key];
    if (typeof value === "string") return value;
    const url = value && typeof value === "object" ? (value as { url?: unknown }).url : undefined;
    if (typeof url === "string") return url;
  }
  return null;
}

const falSchemas = createFalSchemaCache();

export async function generateMusic(
  cfg: MusicCredentials,
  request: MusicRequest,
  options: { fetchImpl?: typeof fetch; timeoutMs?: number; signal?: AbortSignal } = {},
): Promise<GeneratedMusic> {
  const key = cfg.fal?.key?.trim();
  if (!key) throw falError("Add a fal.ai API key first", 409, true);
  const model = musicModel(cfg, request);
  const seconds = Math.min(Math.max(1, Math.round(request.seconds ?? MUSIC_SECONDS_DEFAULT)), musicMaxSeconds(cfg));
  const fetchImpl = options.fetchImpl ?? fetch;
  const fields = await falSchemas(model, { key, fetchImpl });
  const result = await falRun(model, falInput(fields, { prompt: request.prompt, seconds, lyrics: request.lyrics }), {
    key, fetchImpl, timeoutMs: options.timeoutMs ?? MUSIC_GENERATION_TIMEOUT_MS, signal: options.signal,
  });
  const url = falAudioUrl(result);
  if (!url) throw falError(`fal.ai returned no audio (model ${model})`, 502);
  const file = await falDownload(url, { maxBytes: PREVIEW_MAX_BYTES, mimes: AUDIO_MIMES, fetchImpl, timeoutMs: 120_000, signal: options.signal });
  const mime = file.mime === "audio/mp3" ? "audio/mpeg" : file.mime === "audio/x-wav" || file.mime === "audio/wave" ? "audio/wav" : file.mime;
  return { bytes: file.bytes, mime, model, seconds };
}
