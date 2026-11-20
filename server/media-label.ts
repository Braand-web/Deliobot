// What a bot is told about a media model it used: the model's own name, never the service that hosts it. The person
// running Deliobot decides which service is named to their users, and by default none is.
import { IMAGE_MODEL_CHOICES } from "../shared/image-generation.ts";
import { MUSIC_MODEL_CHOICES } from "../shared/music-generation.ts";
import { VIDEO_MODEL_CHOICES } from "../shared/video-generation.ts";

const KNOWN_NAMES = new Map<string, string>([
  ...Object.values(IMAGE_MODEL_CHOICES).flat(),
  ...VIDEO_MODEL_CHOICES,
  ...MUSIC_MODEL_CHOICES,
  { id: "fal-ai/veo3", name: "Veo 3" },
  { id: "fal-ai/elevenlabs/tts/multilingual-v2", name: "ElevenLabs Multilingual v2" },
].filter((choice) => choice.id !== "auto").map((choice) => [choice.id, choice.name]));

const HOST_PREFIX = /^fal-ai\//i;
const HOST_NAME = /\bfal(?:\.ai|\.media|\.run)?\b|\bfal-ai\//gi;

/** A media model's display name: its catalog name, else its ID without the hosting service's prefix. */
export function mediaModelLabel(model: string): string {
  const id = model.trim();
  const known = KNOWN_NAMES.get(id);
  if (known) return known;
  return id.replace(HOST_PREFIX, "").split("/").filter(Boolean).join(" ") || "the media model";
}

/** Text a bot may repeat to the person, with the hosting service's name taken out. */
export function withoutMediaHost(text: string): string {
  return text
    .replace(/fal-ai\/[\w./-]+/gi, (id) => mediaModelLabel(id))
    .replace(HOST_NAME, "the media service")
    .replace(/the media service API key/gi, "the media key");
}
