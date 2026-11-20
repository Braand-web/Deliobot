import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { extname, join } from "node:path";

import { falError, falQueueBase, falRun } from "./fal.ts";
import { OWN_GROUP, stopGroup } from "./group-exec.ts";
import { mediaCommand } from "./media-toolbox.ts";

export const TRANSCRIBE_MODEL = "fal-ai/whisper";
export const TRANSCRIBE_MAX_BYTES = 12 * 1024 * 1024;
const TRANSCRIPT_SHOWN_CHARS = 30_000;

export const AUDIO_TYPES: Record<string, string> = {
  ".mp3": "audio/mpeg", ".wav": "audio/wav", ".m4a": "audio/mp4", ".aac": "audio/aac", ".ogg": "audio/ogg", ".opus": "audio/ogg", ".flac": "audio/flac",
  ".mp4": "video/mp4", ".mov": "video/quicktime", ".webm": "video/webm", ".mkv": "video/x-matroska", ".m4v": "video/mp4",
};

export interface TranscriptSegment { start: number; end: number; text: string }
export interface Transcript { text: string; language: string | null; segments: TranscriptSegment[] }

function runFfmpeg(args: string[], timeoutMs: number): Promise<void> {
  return new Promise((done, fail) => {
    const child = spawn(mediaCommand("ffmpeg"), args, { stdio: ["ignore", "ignore", "pipe"], ...OWN_GROUP });
    let stderr = "";
    const timer = setTimeout(() => { stopGroup(child); fail(new Error("ffmpeg timed out")); }, timeoutMs);
    child.stderr.on("data", (chunk: Buffer) => { stderr += chunk; });
    child.on("error", (error) => { clearTimeout(timer); fail(error); });
    child.on("close", (code) => { clearTimeout(timer); if (code === 0) done(); else fail(new Error(stderr.trim().slice(-400))); });
  });
}

/** The recording as small mono speech audio; a plain audio file is sent as it is when ffmpeg is not there yet. */
export async function speechAudio(file: string, options: { ffmpegMissing?: () => void } = {}): Promise<{ bytes: Buffer; mime: string }> {
  const mime = AUDIO_TYPES[extname(file).toLowerCase()];
  if (!mime) throw falError(`${file.slice(0, 200)} is not an audio or video file this can read (mp3, wav, m4a, ogg, flac, mp4, mov, webm, mkv).`, 400);
  const dir = await mkdtemp(join(tmpdir(), "odb-speech-"));
  try {
    const out = join(dir, "speech.mp3");
    try {
      await runFfmpeg(["-v", "error", "-protocol_whitelist", "file", "-i", file, "-vn", "-ac", "1", "-ar", "16000", "-b:a", "32k", "-y", out], 10 * 60_000);
      return { bytes: await readFile(out), mime: "audio/mpeg" };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw falError(`This recording could not be read: ${(error as Error).message}`, 400);
      options.ffmpegMissing?.();
      if (mime.startsWith("video/")) throw falError("Deliobot is still getting its video tools ready on this computer. Try again in a minute.", 409);
      if ((await stat(file)).size > TRANSCRIBE_MAX_BYTES) throw falError("This recording is too large to send as it is. Try again in a minute, once Deliobot's audio tools are ready.", 409);
      return { bytes: await readFile(file), mime };
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

const seconds = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? value : null);

export function readTranscript(result: Record<string, unknown>): Transcript {
  const chunks = Array.isArray(result.chunks) ? result.chunks : [];
  const segments: TranscriptSegment[] = [];
  for (const chunk of chunks) {
    const item = chunk as { timestamp?: unknown[]; text?: unknown };
    const start = seconds(item.timestamp?.[0]);
    const text = typeof item.text === "string" ? item.text.trim() : "";
    if (start === null || !text) continue;
    segments.push({ start, end: seconds(item.timestamp?.[1]) ?? start, text });
  }
  const languages = Array.isArray(result.inferred_languages) ? result.inferred_languages.filter((one): one is string => typeof one === "string") : [];
  const text = typeof result.text === "string" ? result.text.trim() : segments.map((s) => s.text).join(" ");
  return { text, language: languages[0] ?? null, segments };
}

const clock = (t: number) => `${String(Math.floor(t / 60)).padStart(2, "0")}:${(t % 60).toFixed(1).padStart(4, "0")}`;

export function transcriptText(transcript: Transcript): string {
  const lines = transcript.segments.length ? transcript.segments.map((s) => `[${clock(s.start)}–${clock(s.end)}] ${s.text}`) : [transcript.text];
  const body = lines.join("\n");
  const shown = body.length > TRANSCRIPT_SHOWN_CHARS ? `${body.slice(0, TRANSCRIPT_SHOWN_CHARS)}\n… (cut here; the saved copy has all of it)` : body;
  return `${transcript.language ? `Language: ${transcript.language}\n` : ""}${shown || "(no speech found)"}`;
}

export async function transcribe(
  cfg: { fal?: { key?: string; url?: string } },
  audio: { bytes: Buffer; mime: string },
  request: { language?: string; words?: boolean },
  options: { fetchImpl?: typeof fetch; signal?: AbortSignal } = {},
): Promise<Transcript> {
  const key = cfg.fal?.key?.trim();
  if (!key) throw falError("Add a fal.ai API key first", 409, true);
  if (audio.bytes.byteLength > TRANSCRIBE_MAX_BYTES) throw falError("This recording is over about 40 minutes. Cut it into parts first.", 413);
  const result = await falRun(TRANSCRIBE_MODEL, {
    audio_url: `data:${audio.mime};base64,${audio.bytes.toString("base64")}`,
    task: "transcribe",
    chunk_level: request.words ? "word" : "segment",
    ...(request.language ? { language: request.language } : {}),
  }, { key, baseUrl: falQueueBase(cfg.fal?.url), fetchImpl: options.fetchImpl ?? fetch, timeoutMs: 10 * 60_000, signal: options.signal });
  return readTranscript(result);
}
