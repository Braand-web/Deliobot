import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

import { createImageDailyCap } from "./image-daily-cap.ts";
import { keepMediaCopy, keptCopyNote } from "./media-keep.ts";
import { generateImageForTurn } from "./routes/image-tools.ts";

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");

describe("a copy of generated media the bot can work on", () => {
  it("lands in the bot folder's media directory with the file's own extension", () => {
    const folder = mkdtempSync(join(tmpdir(), "odb-media-keep-"));
    const at = new Date("2026-11-20T09:15:30Z");
    const video = keepMediaCopy(folder, "video", Buffer.from("mp4"), "video/mp4", at);
    const audio = keepMediaCopy(folder, "music", Buffer.from("mp3"), "audio/mpeg; charset=binary", at);
    expect(video).toMatch(new RegExp(`^${folder.replace(/[\\^$.*+?()[\]{}|]/g, "\\$&")}[\\\\/]media[\\\\/]video-2026-11-20-09-15-30-[0-9a-f]{6}\\.mp4$`));
    expect(audio).toMatch(/audio-2026-11-20-09-15-30-[0-9a-f]{6}\.mp3$/);
    expect(readFileSync(video, "utf8")).toBe("mp4");
    expect(keepMediaCopy(folder, "video", Buffer.from("x"), "video/mp4", at)).not.toBe(video);
    expect(keptCopyNote(undefined)).toBe("");
  });

  it("tells the bot where an image it made was saved", async () => {
    const folder = mkdtempSync(join(tmpdir(), "odb-media-keep-"));
    const result = await generateImageForTurn({ prompt: "a navy owl" }, {
      cfg: { imageGen: { key: "openai-secret", primary: { provider: "openai" } } },
      personTurn: true,
      daily: createImageDailyCap(folder),
      fetchImpl: vi.fn<typeof fetch>(async () => new Response(JSON.stringify({ data: [{ b64_json: PNG.toString("base64") }] }))),
      inFlight: new Map(),
      turn: { key: "thread:turn", parked: () => 0, attach: () => true },
      keep: (image) => keepMediaCopy(folder, "image", image.bytes, image.mime),
    });
    const text = (result.body as { text: string }).text;
    const path = JSON.parse(text.match(/A copy is saved at ("[^"]+")/)![1]!) as string;
    expect(readFileSync(path)).toEqual(PNG);
    expect(path.endsWith(".png")).toBe(true);
  });
});
