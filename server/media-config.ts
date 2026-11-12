// The saved settings of the fal.ai media generators other than images: video clips, and music with sound effects.
import { z } from "zod";

import { MUSIC_SECONDS_MAX } from "../shared/music-generation.ts";
import { VIDEO_SECONDS_MAX } from "../shared/video-generation.ts";
import { validFalModel } from "./fal.ts";

const falModelSetting = z.string().trim().max(200).refine((value) => !value || value === "auto" || validFalModel(value), "Use a fal.ai model ID, such as fal-ai/flux/schnell, or auto");

const generator = (maxSeconds: number) => z.object({
  enabled: z.boolean().optional(),
  model: falModelSetting.optional(),
  maxSeconds: z.number().int().min(1).max(maxSeconds).optional(),
  maxPerTurn: z.number().int().min(1).max(4).optional(),
  dailyCap: z.number().int().min(1).max(500).optional(),
}).strict().optional();

export const mediaGenerationShape = {
  /** Music, songs and sound effects bots make on fal.ai with `fal.key`; off unless `enabled`. */
  musicGen: generator(MUSIC_SECONDS_MAX),
  /** Video clips bots make on fal.ai with `fal.key`; off unless `enabled`. */
  videoGen: generator(VIDEO_SECONDS_MAX),
};
