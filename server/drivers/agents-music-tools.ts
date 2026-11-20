import { MUSIC_SECONDS_MAX } from "../../shared/music-generation.ts";
import { AUDIO_KINDS } from "../media-auto.ts";
import type { ToolCallContext, ToolCallResult } from "./agents-call.ts";
import type { Json } from "./agents-client.ts";

export const MUSIC_PROMPT_MAX_CHARS = 2000;
export const MUSIC_LYRICS_MAX_CHARS = 3000;
export const MUSIC_TOOL_NAMES: ReadonlySet<string> = new Set(["generate_music"]);

export async function callMusicTool(_name: string, args: Json, context: ToolCallContext): Promise<ToolCallResult> {
  const { ok, body } = await context.client.apiResponse("/api/internal/music/generate", {
    method: "POST",
    body: JSON.stringify({ fromBotId: context.botId, fromThreadId: context.threadId, ...args }),
  });
  return ok ? { text: String(body.text ?? "") } : { text: String(body.error ?? "The track was not made. Try again shortly."), isError: true };
}

export const MUSIC_TOOL_DEFINITIONS = [
  {
    name: "generate_music",
    description:
      "Make one piece of audio yourself: background music, a jingle, a song with lyrics, a sound effect, or a voice-over (a natural human voice reading a text, in any language). Set kind, and leave model out: the best model for the request is chosen for you. Make one when the person asked for audio or the task they gave needs it. It is attached to your reply as a playable track when the turn ends: do not describe or link it again. For music, describe genre, mood, instruments and tempo; for a song, pass the words as lyrics; for a voice-over, the prompt is exactly the words to say.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        prompt: { type: "string", minLength: 1, maxLength: MUSIC_PROMPT_MAX_CHARS, description: "Genre, mood, instruments, tempo; the sound to make; or, for a voice-over, the exact words to say." },
        seconds: { type: "integer", minimum: 1, maximum: MUSIC_SECONDS_MAX, description: "Length in seconds; the person's limit applies. 30 when omitted." },
        kind: { type: "string", enum: [...AUDIO_KINDS], description: "music, song, sound_effect or voice (spoken words)." },
        model: { type: "string", maxLength: 200, description: "Only a model the person named; leave out otherwise." },
        lyrics: { type: "string", maxLength: MUSIC_LYRICS_MAX_CHARS, description: "Words to sing, only for a song." },
      },
      required: ["prompt"],
    },
  },
];
