/** Video generation runs on fal.ai: the person's key, or the workspace's when Delio hosts it. */
export const VIDEO_PROVIDERS = ["fal"] as const;
export type VideoProvider = (typeof VIDEO_PROVIDERS)[number];

export const VIDEO_ASPECTS = ["16:9", "9:16", "1:1"] as const;
export type VideoAspect = (typeof VIDEO_ASPECTS)[number];

export const VIDEO_DEFAULT_MODEL = "fal-ai/kling-video/v2.5-turbo/pro/text-to-video";
export const VIDEO_SECONDS_DEFAULT = 5;
export const VIDEO_SECONDS_MAX = 10;
export const VIDEO_MAX_PER_TURN_DEFAULT = 1;
export const VIDEO_DAILY_CAP_DEFAULT = 20;

export interface VideoModelChoice { id: string; name: string }

/** Offered first in Settings; fal.ai's live catalog adds the rest, and any other ID can be typed. */
export const VIDEO_MODEL_CHOICES: readonly VideoModelChoice[] = [
  { id: "fal-ai/kling-video/v2.5-turbo/pro/text-to-video", name: "Kling 2.5 Turbo Pro" },
  { id: "fal-ai/kling-video/v3/standard/text-to-video", name: "Kling 3 Standard" },
  { id: "alibaba/wan-3.0/text-to-video", name: "Wan 3.0" },
  { id: "minimax/h3/text-to-video", name: "MiniMax H3" },
  { id: "bytedance/seedance-2.5/us/text-to-video", name: "Seedance 2.5" },
  { id: "fal-ai/kling-video/v3/pro/text-to-video", name: "Kling 3 Pro" },
  { id: "google/gemini-omni-flash/v1.2/text-to-video", name: "Gemini Omni Flash 1.2" },
];

export interface VideoGenerationConfig {
  /** Off until the person turns it on: a video costs far more than an image. */
  enabled?: boolean;
  model?: string;
  /** The longest clip a bot may ask for, in seconds. */
  maxSeconds?: number;
  maxPerTurn?: number;
  /** Videos all bots on this server may make in a day. */
  dailyCap?: number;
}
