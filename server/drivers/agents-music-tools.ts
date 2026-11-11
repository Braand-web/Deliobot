import { MUSIC_SECONDS_MAX } from "../../shared/music-generation.ts";
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
      "Make one piece of audio from a description with the person's music model: background music, a jingle, a song with lyrics, or a sound effect. Make one only when the person asked for audio. It is attached to your reply as a playable track when the turn ends: do not describe or link it again. Describe genre, mood, instruments and tempo; for a song, pass the words as lyrics.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        prompt: { type: "string", minLength: 1, maxLength: MUSIC_PROMPT_MAX_CHARS, description: "Genre, mood, instruments, tempo; or the sound to make." },
        seconds: { type: "integer", minimum: 1, maximum: MUSIC_SECONDS_MAX, description: "Length in seconds; the person's limit applies. 30 when omitted." },
        lyrics: { type: "string", maxLength: MUSIC_LYRICS_MAX_CHARS, description: "Words to sing, only for a song." },
      },
      required: ["prompt"],
    },
  },
];
