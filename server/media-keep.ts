import { randomBytes } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const EXTENSIONS: Record<string, string> = {
  "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "image/gif": "gif",
  "video/mp4": "mp4", "video/webm": "webm", "video/quicktime": "mov",
  "audio/mpeg": "mp3", "audio/mp3": "mp3", "audio/wav": "wav", "audio/x-wav": "wav", "audio/ogg": "ogg", "audio/mp4": "m4a", "audio/aac": "aac", "audio/flac": "flac",
};

export type KeptKind = "image" | "video" | "music";

export function keepMediaCopy(folder: string, kind: KeptKind, bytes: Uint8Array, mime: string, at = new Date()): string {
  const dir = join(folder, "media");
  mkdirSync(dir, { recursive: true });
  const stamp = at.toISOString().slice(0, 19).replace(/[T:]/g, "-");
  const path = join(dir, `${kind === "music" ? "audio" : kind}-${stamp}-${randomBytes(3).toString("hex")}.${EXTENSIONS[mime.split(";")[0]!.trim().toLowerCase()] ?? "bin"}`);
  writeFileSync(path, bytes);
  return path;
}

export function keptCopyNote(path: string | undefined): string {
  return path ? ` A copy is saved at ${JSON.stringify(path)}: use that file to edit, join, caption or mix it, or to reuse it later.` : "";
}
