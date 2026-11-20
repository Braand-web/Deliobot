import { MUSIC_SECONDS_MAX } from "../../shared/music-generation.ts";
import { AUDIO_KINDS } from "../media-auto.ts";
import type { ToolCallContext, ToolCallResult } from "./agents-call.ts";
import type { Json } from "./agents-client.ts";

export const MUSIC_PROMPT_MAX_CHARS = 2000;
export const MUSIC_LYRICS_MAX_CHARS = 3000;
export const MUSIC_TOOL_NAMES: ReadonlySet<string> = new Set(["generate_music", "transcribe_audio"]);

export async function callMusicTool(name: string, args: Json, context: ToolCallContext): Promise<ToolCallResult> {
  const transcribing = name === "transcribe_audio";
  const { ok, body } = await context.client.apiResponse(transcribing ? "/api/internal/audio/transcribe" : "/api/internal/music/generate", {
    method: "POST",
    body: JSON.stringify({ fromBotId: context.botId, fromThreadId: context.threadId, ...args }),
  });
  return ok ? { text: String(body.text ?? "") } : { text: String(body.error ?? (transcribing ? "The recording was not transcribed. Try again shortly." : "The track was not made. Try again shortly.")), isError: true };
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
  {
    name: "transcribe_audio",
    description:
      "Write down what is said in a video or audio file (one the person sent, one you made, any recording in your folders), with timestamps and the language heard. Use it to understand, summarise, check or caption a video, or to time captions and cuts to the speech. The full transcript is also saved as JSON next to your other media.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        path: { type: "string", minLength: 1, maxLength: 1000, description: "The video or audio file (mp4, mov, webm, mkv, mp3, wav, m4a, ogg, flac)." },
        language: { type: "string", minLength: 2, maxLength: 5, description: "Two-letter language code (fr, en, wo…) when you know it; detected when left out." },
        words: { type: "boolean", description: "Timestamps per word instead of per sentence, for precise captions." },
      },
      required: ["path"],
    },
  },
];
