import { PREVIEW_MAX_BYTES } from "../shared/upload-limits.ts";
import { autoVideoModel, MEDIA_AUTO } from "./media-auto.ts";
import {
  VIDEO_SECONDS_DEFAULT, VIDEO_SECONDS_MAX, type VideoAspect, type VideoGenerationConfig,
} from "../shared/video-generation.ts";
import { createFalSchemaCache, falDownload, falQueueBase, falError, falInput, falRun, validFalModel } from "./fal.ts";

export const VIDEO_GENERATION_TIMEOUT_MS = 6 * 60_000;
/** Kept within what the chat plays inline, so a made video never lands as a file the person cannot watch. */
export const VIDEO_DOWNLOAD_MAX_BYTES = PREVIEW_MAX_BYTES;
const VIDEO_MIMES = ["video/mp4", "video/webm", "video/quicktime"] as const;

export interface VideoCredentials {
  fal?: { key?: string; url?: string };
  videoGen?: VideoGenerationConfig;
}

export interface VideoRequest {
  prompt: string;
  seconds?: number;
  aspect?: VideoAspect;
}

export interface GeneratedVideo {
  bytes: Buffer;
  mime: string;
  model: string;
  seconds: number;
}

export function videoModel(cfg: VideoCredentials, prompt: string): string {
  const model = cfg.videoGen?.model?.trim() ?? "";
  return model && model !== MEDIA_AUTO && validFalModel(model) ? model : autoVideoModel(prompt);
}

export function videoMaxSeconds(cfg: VideoCredentials): number {
  const max = cfg.videoGen?.maxSeconds;
  return typeof max === "number" && Number.isInteger(max) && max >= 1 ? Math.min(max, VIDEO_SECONDS_MAX) : VIDEO_SECONDS_DEFAULT;
}

export function videoGenerationReady(cfg: VideoCredentials): boolean {
  return cfg.videoGen?.enabled === true && Boolean(cfg.fal?.key?.trim());
}

const falSchemas = createFalSchemaCache();

export async function generateVideo(
  cfg: VideoCredentials,
  request: VideoRequest,
  options: { fetchImpl?: typeof fetch; timeoutMs?: number; signal?: AbortSignal } = {},
): Promise<GeneratedVideo> {
  const key = cfg.fal?.key?.trim();
  if (!key) throw falError("Add a fal.ai API key first", 409, true);
  const model = videoModel(cfg, request.prompt);
  const seconds = Math.min(Math.max(1, Math.round(request.seconds ?? VIDEO_SECONDS_DEFAULT)), videoMaxSeconds(cfg));
  const fetchImpl = options.fetchImpl ?? fetch;
  const fields = await falSchemas(model, { key, fetchImpl });
  const result = await falRun(model, falInput(fields, { prompt: request.prompt, seconds, aspect: request.aspect ?? "16:9" }), {
    key, baseUrl: falQueueBase(cfg.fal?.url), fetchImpl, timeoutMs: options.timeoutMs ?? VIDEO_GENERATION_TIMEOUT_MS, signal: options.signal,
  });
  const video = result.video && typeof result.video === "object" ? (result.video as { url?: unknown }).url : undefined;
  if (typeof video !== "string") throw falError(`fal.ai returned no video (model ${model})`, 502);
  const file = await falDownload(video, { maxBytes: VIDEO_DOWNLOAD_MAX_BYTES, mimes: VIDEO_MIMES, fetchImpl, timeoutMs: 120_000, signal: options.signal });
  return { ...file, model, seconds };
}
