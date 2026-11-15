// The packaged Deliobot desktop app turns these on for anyone who never set them; a switch a person turned off stays off.
import type { AppConfig } from "./config.ts";

export const DELIO_FEATURE_DEFAULTS_ENV = "ODB_DELIO_FEATURE_DEFAULTS";

export const DELIO_DEFAULT_FEATURES = {
  skillsLibrary: true, parallelRoomJobs: true, llmThreadTitles: true, skillReview: true, showToolCalls: true, roomMemoryCapture: true,
  claudeUserMcp: true, claudeUserSkills: true, usbPhoneTakeover: true,
} as const satisfies NonNullable<AppConfig["features"]>;

export function withDelioFeatureDefaults(features: AppConfig["features"], env: NodeJS.ProcessEnv = process.env): AppConfig["features"] {
  return env[DELIO_FEATURE_DEFAULTS_ENV] === "1" ? { ...DELIO_DEFAULT_FEATURES, ...features } : features;
}
