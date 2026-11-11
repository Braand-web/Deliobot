/** Music, songs and sound effects run on fal.ai with the same key as images and videos. */
export const MUSIC_SECONDS_DEFAULT = 30;
export const MUSIC_SECONDS_MAX = 180;
export const MUSIC_MAX_PER_TURN_DEFAULT = 1;
export const MUSIC_DAILY_CAP_DEFAULT = 20;

export interface MusicModelChoice { id: string; name: string }

/** Offered first in Settings; fal.ai's live audio catalog adds the rest, and any other ID can be typed. */
export const MUSIC_MODEL_CHOICES: readonly MusicModelChoice[] = [
  { id: "auto", name: "Auto" },
  { id: "elevenlabs/music/v2.5", name: "ElevenLabs Music 2.5" },
  { id: "fal-ai/minimax-music/v2.6", name: "MiniMax Music 2.6 (songs with lyrics)" },
  { id: "fal-ai/stable-audio-25/text-to-audio", name: "Stable Audio 2.5" },
  { id: "google/lyria-3.5", name: "Lyria 3.5" },
  { id: "elevenlabs/sound-effects/v3", name: "ElevenLabs Sound Effects 3" },
];

export interface MusicGenerationConfig {
  /** Off until the person turns it on. */
  enabled?: boolean;
  /** A fal.ai audio model ID, or "auto" (the default) to choose per request. */
  model?: string;
  maxSeconds?: number;
  maxPerTurn?: number;
  dailyCap?: number;
}
