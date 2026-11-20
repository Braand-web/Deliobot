import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import type { ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { afterAll, describe, expect, it } from "vitest";

import { falInput } from "./fal.ts";
import { ensureMediaTools, FFMPEG_BUILDS, mediaToolsMissing, writeNodeShim } from "./media-toolbox.ts";
import { createTranscribeToolRoute } from "./routes/transcribe-tool.ts";
import { removeTempDir } from "./testing/cleanup.ts";
import { readTranscript, speechAudio, transcribe, transcriptText } from "./transcribe.ts";
import { generateVideo, IMAGE_TO_VIDEO_DEFAULT, imageToVideoModel } from "./video-generation.ts";

const PNG = Buffer.from("89504e470d0a1a0a0000000d4948445200000001000000010806000000", "hex");
const MP4 = Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from("ftypmp42")]);
const dirs: string[] = [];
const scratch = () => { const dir = mkdtempSync(join(tmpdir(), "odb-media-understanding-")); dirs.push(dir); return dir; };
afterAll(async () => { for (const dir of dirs) await removeTempDir(dir); });
const hasFfmpeg = spawnSync("ffmpeg", ["-version"]).status === 0;

function fakeFal(schemas: Record<string, Record<string, unknown>>, result: Record<string, unknown>) {
  const posts: Array<{ model: string; body: Record<string, unknown> }> = [];
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    if (url.host === "api.fal.ai") {
      const model = url.searchParams.get("endpoint_id")!;
      const properties = schemas[model];
      if (!properties) return Response.json({ models: [] });
      return Response.json({ models: [{ endpoint_id: model, openapi: {
        paths: { [`/${model}`]: { post: { requestBody: { content: { "application/json": { schema: { $ref: "#/components/schemas/In" } } } } } } },
        components: { schemas: { In: { properties } } },
      } }] });
    }
    if (url.host === "queue.fal.run" && init?.method === "POST") {
      posts.push({ model: url.pathname.slice(1), body: JSON.parse(String(init.body)) });
      const base = "https://queue.fal.run/app/requests/r1";
      return Response.json({ request_id: "r1", status_url: `${base}/status`, response_url: base });
    }
    if (url.pathname.endsWith("/status")) return Response.json({ status: "COMPLETED" });
    if (url.host === "queue.fal.run") return Response.json(result);
    if (url.host.endsWith("fal.media")) return new Response(MP4, { headers: { "content-type": "video/mp4" } });
    return new Response("not found", { status: 404 });
  }) as typeof fetch;
  return { fetchImpl, posts };
}

describe("a picture animated into a video", () => {
  it("uses the image-to-video sibling of the chosen model and sends the picture as the first frame", async () => {
    expect(imageToVideoModel("fal-ai/kling-video/v3/pro/text-to-video")).toBe("fal-ai/kling-video/v3/pro/image-to-video");
    expect(imageToVideoModel("fal-ai/veo3")).toBe("fal-ai/veo3/image-to-video");
    expect(imageToVideoModel("someone/odd-model")).toBe(IMAGE_TO_VIDEO_DEFAULT);
    const fal = fakeFal({ "fal-ai/veo3/image-to-video": { prompt: {}, image_url: {}, duration: { enum: ["8s"] } } }, { video: { url: "https://v3.fal.media/v.mp4" } });
    const video = await generateVideo({ fal: { key: "k" }, videoGen: { model: "fal-ai/veo3", maxSeconds: 8 } }, { prompt: "the camera pushes in", image: { bytes: PNG, mime: "image/png" } }, { fetchImpl: fal.fetchImpl });
    expect(video.model).toBe("fal-ai/veo3/image-to-video");
    expect(fal.posts).toEqual([{ model: "fal-ai/veo3/image-to-video", body: { prompt: "the camera pushes in", image_url: `data:image/png;base64,${PNG.toString("base64")}`, duration: "8s" } }]);
  });

  it("falls back to a model known to animate pictures when the sibling takes none", async () => {
    const fal = fakeFal({ [IMAGE_TO_VIDEO_DEFAULT]: { prompt: {}, start_image_url: {} } }, { video: { url: "https://v3.fal.media/v.mp4" } });
    const video = await generateVideo({ fal: { key: "k" }, videoGen: { model: "alibaba/wan-3.0/text-to-video" } }, { prompt: "waves", image: { bytes: PNG, mime: "image/png" } }, { fetchImpl: fal.fetchImpl });
    expect(video.model).toBe(IMAGE_TO_VIDEO_DEFAULT);
    expect(fal.posts[0]!.body).toMatchObject({ start_image_url: expect.stringMatching(/^data:image\/png;base64,/) });
    expect(falInput({ prompt: {} }, { prompt: "x", imageUrl: "data:x" })).toEqual({ prompt: "x" });
  });
});

describe("transcribing speech", () => {
  const whisper = { text: "Bonjour à tous. Merci.", inferred_languages: ["fr"], chunks: [{ timestamp: [0, 1.4], text: " Bonjour à tous." }, { timestamp: [1.6, 2.5], text: "Merci." }] };

  it("reads timestamped segments and prints them with the language", () => {
    const transcript = readTranscript(whisper);
    expect(transcript).toEqual({ text: "Bonjour à tous. Merci.", language: "fr", segments: [{ start: 0, end: 1.4, text: "Bonjour à tous." }, { start: 1.6, end: 2.5, text: "Merci." }] });
    expect(transcriptText(transcript)).toBe("Language: fr\n[00:00.0–00:01.4] Bonjour à tous.\n[00:01.6–00:02.5] Merci.");
    expect(transcriptText(readTranscript({ text: "" }))).toBe("(no speech found)");
  });

  it("sends the recording to the speech model with the timing asked for", async () => {
    const fal = fakeFal({}, whisper);
    await transcribe({ fal: { key: "k" } }, { bytes: Buffer.from("mp3"), mime: "audio/mpeg" }, { language: "fr", words: true }, { fetchImpl: fal.fetchImpl });
    expect(fal.posts).toEqual([{ model: "fal-ai/whisper", body: { audio_url: `data:audio/mpeg;base64,${Buffer.from("mp3").toString("base64")}`, task: "transcribe", chunk_level: "word", language: "fr" } }]);
    await expect(transcribe({}, { bytes: Buffer.from("x"), mime: "audio/mpeg" }, {})).rejects.toThrow(/fal.ai API key/);
  });

  it("refuses files that are not recordings", async () => {
    const dir = scratch();
    writeFileSync(join(dir, "notes.txt"), "hello");
    await expect(speechAudio(join(dir, "notes.txt"))).rejects.toMatchObject({ status: 400 });
  });

  it.runIf(hasFfmpeg)("transcribes a video from the bot's folder and saves the transcript", async () => {
    const dir = scratch();
    const video = join(dir, "clip.mp4");
    expect(spawnSync("ffmpeg", ["-loglevel", "error", "-f", "lavfi", "-i", "testsrc=size=320x240:rate=10", "-f", "lavfi", "-i", "sine=f=440", "-t", "2", "-pix_fmt", "yuv420p", "-shortest", video]).status).toBe(0);
    const fal = fakeFal({}, whisper);
    const kept: unknown[] = [];
    const route = createTranscribeToolRoute({ config: () => ({ fal: { key: "k" } }), ready: () => true, ffmpegMissing: () => {}, fetchImpl: fal.fetchImpl, keep: (_bot, transcript) => { kept.push(transcript); return join(dir, "media", "t.json"); } });
    const answer = async (body: unknown) => {
      let sent: { status: number; body: any } | undefined;
      await route.internal({ method: "POST", path: "/api/internal/audio/transcribe", res: { once: () => {}, writableEnded: true } as unknown as ServerResponse,
        json: ((_res: ServerResponse, status: number, value: unknown) => { sent = { status, body: value }; }) as never,
        readBody: async () => body, botId: "b1", folders: async () => ({ roots: [dir], vmWorkspace: null }), requireActive: () => {} });
      return sent!;
    };
    const ok = await answer({ path: video, language: "fr" });
    expect(ok.status).toBe(200);
    expect(ok.body.text).toContain("[00:00.0–00:01.4] Bonjour à tous.");
    expect(ok.body.text).toContain("t.json");
    expect(fal.posts[0]!.body.audio_url).toMatch(/^data:audio\/mpeg;base64,/);
    expect(kept).toHaveLength(1);
    expect((await answer({ path: "/etc/passwd" })).status).toBe(400);
    expect((await answer({})).status).toBe(400);
  });
});

describe("media tools the app provides", () => {
  it("installs only what the computer lacks, checked against the pinned checksum", async () => {
    const bin = join(scratch(), "bin");
    expect(mediaToolsMissing({ bin, platform: "linux", onPath: (tool) => tool === "ffprobe" })).toEqual(["ffmpeg"]);
    expect(await ensureMediaTools({ bin, platform: "sunos", arch: "x64", onPath: () => false })).toEqual([]);
    const tampered = (async () => new Response(gzipSync(Buffer.from("not ffmpeg")))) as unknown as typeof fetch;
    await expect(ensureMediaTools({ bin, platform: "linux", arch: "x64", onPath: (tool) => tool === "ffprobe", fetchImpl: tampered })).rejects.toThrow(/pinned checksum/);
    expect(existsSync(join(bin, "ffmpeg"))).toBe(false);
    for (const build of Object.values(FFMPEG_BUILDS)) for (const hash of Object.values(build)) expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("installs a download whose checksum matches, as an executable", async () => {
    const bin = join(scratch(), "bin");
    const packed = gzipSync(Buffer.from("#!/bin/sh\necho ffmpeg\n"));
    const original = FFMPEG_BUILDS["linux-x64"]!;
    FFMPEG_BUILDS["linux-x64"] = { ffmpeg: createHash("sha256").update(packed).digest("hex"), ffprobe: original.ffprobe };
    try {
      const done = await ensureMediaTools({ bin, platform: "linux", arch: "x64", onPath: (tool) => tool === "ffprobe", fetchImpl: (async () => new Response(packed)) as unknown as typeof fetch });
      expect(done).toEqual(["ffmpeg"]);
      expect(readFileSync(join(bin, "ffmpeg"), "utf8")).toBe("#!/bin/sh\necho ffmpeg\n");
    } finally {
      FFMPEG_BUILDS["linux-x64"] = original;
    }
  });

  it("gives the bots a node that runs this app's own runtime", () => {
    const bin = join(scratch(), "bin");
    writeNodeShim(bin, { execPath: "C:\\Program Files\\Deliobot\\Deliobot.exe", electron: true }, "win32");
    expect(readFileSync(join(bin, "node.cmd"), "utf8")).toBe('@echo off\r\nset ELECTRON_RUN_AS_NODE=1\r\n"C:\\Program Files\\Deliobot\\Deliobot.exe" %*\r\n');
    expect(readFileSync(join(bin, "node"), "utf8")).toContain('ELECTRON_RUN_AS_NODE=1 exec "C:\\Program Files\\Deliobot\\Deliobot.exe" "$@"');
    const unixBin = join(scratch(), "bin");
    writeNodeShim(unixBin, { execPath: process.execPath, electron: false }, "linux");
    expect(spawnSync(join(unixBin, "node"), ["-e", "process.stdout.write('ok')"], { encoding: "utf8" }).stdout).toBe("ok");
  });
});
