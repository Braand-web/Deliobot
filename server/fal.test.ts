import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { falCostUsd, falDownload, falInput, falInputFields, falRun, validFalModel } from "./fal.ts";
import { generateImage } from "./image-generation.ts";
import { createImageDailyCap } from "./image-daily-cap.ts";
import { generateVideoForTurn, type VideoTurn } from "./routes/video-tools.ts";
import { removeTempDir } from "./testing/cleanup.ts";

const PNG = Buffer.from("89504e470d0a1a0a0000000d4948445200000001000000010806000000", "hex");
const MP4 = Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from("ftypmp42")]);

const schemaDoc = (model: string, properties: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({
  models: [{ endpoint_id: model, openapi: {
    paths: { [`/${model}`]: { post: { requestBody: { content: { "application/json": { schema: { $ref: "#/components/schemas/ModelInput" } } } } } } },
    components: { schemas: { ModelInput: { properties }, ...extra } },
  } }],
});

/** A fal.ai stand-in: the model schema, the queue (one IN_PROGRESS poll), and a media host. */
function fakeFal(options: { model: string; properties: Record<string, unknown>; extra?: Record<string, unknown>; result: unknown; media?: { type: string; body: Buffer }; submitStatus?: number; statusHost?: string }) {
  const calls: Array<{ url: string; method: string; body?: unknown; auth?: string | null }> = [];
  let polls = 0;
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    const headers = new Headers(init?.headers);
    calls.push({ url: url.href, method: init?.method ?? "GET", body: init?.body ? JSON.parse(String(init.body)) : undefined, auth: headers.get("authorization") });
    if (url.host === "api.fal.ai" && url.pathname === "/v1/models") return Response.json(schemaDoc(options.model, options.properties, options.extra));
    if (url.host === "queue.fal.run" && init?.method === "POST") {
      if (options.submitStatus) return new Response("{}", { status: options.submitStatus });
      const base = `https://${options.statusHost ?? "queue.fal.run"}/app/requests/r1`;
      return Response.json({ request_id: "r1", status_url: `${base}/status`, response_url: base, cancel_url: `${base}/cancel` });
    }
    if (url.pathname.endsWith("/status")) return Response.json({ status: polls++ === 0 ? "IN_PROGRESS" : "COMPLETED" });
    if (url.host === "queue.fal.run") return Response.json(options.result);
    if (url.host.endsWith("fal.media") && options.media) return new Response(options.media.body, { headers: { "content-type": options.media.type } });
    return new Response("not found", { status: 404 });
  }) as typeof fetch;
  return { fetchImpl, calls };
}

describe("fal.ai client", () => {
  it("accepts owner/app model IDs and refuses paths that could leave the queue", () => {
    expect(validFalModel("fal-ai/flux/schnell")).toBe(true);
    expect(validFalModel("alibaba/wan-3.0/text-to-video")).toBe(true);
    for (const bad of ["flux", "fal-ai/../x", "/fal-ai/flux", "fal-ai/flux?x=1", "https://evil.test/a"]) expect(validFalModel(bad), bad).toBe(false);
  });

  it("builds a request from the model's own schema: aspect ratio or image size, and the nearest allowed duration", () => {
    const flux = falInputFields(schemaDoc("fal-ai/flux/schnell", {
      prompt: { type: "string" }, num_images: { type: "integer" },
      image_size: { anyOf: [{ $ref: "#/components/schemas/ImageSize" }, { type: "string", enum: ["square_hd", "landscape_16_9", "portrait_16_9"] }] },
    }, { ImageSize: { type: "object" } }).models[0]!.openapi, "fal-ai/flux/schnell");
    expect(falInput(flux, { prompt: "a fox", aspect: "16:9" })).toEqual({ prompt: "a fox", image_size: "landscape_16_9", num_images: 1 });

    const veo = falInputFields(schemaDoc("fal-ai/veo3", {
      prompt: { type: "string" }, duration: { type: "string", enum: ["4s", "6s", "8s"] }, aspect_ratio: { type: "string", enum: ["16:9", "9:16"] },
    }).models[0]!.openapi, "fal-ai/veo3");
    expect(falInput(veo, { prompt: "waves", seconds: 7, aspect: "9:16" })).toEqual({ prompt: "waves", duration: "6s", aspect_ratio: "9:16" });
    expect(falInput(veo, { prompt: "waves", aspect: "1:1" }), "an aspect the model lacks is left to its default").toEqual({ prompt: "waves" });

    const kling = falInputFields(schemaDoc("k", { prompt: {}, duration: { type: "integer" } }).models[0]!.openapi, "k");
    expect(falInput(kling, { prompt: "p", seconds: 5 })).toEqual({ prompt: "p", duration: 5 });
    expect(falInput(null, { prompt: "p", aspect: "1:1" })).toEqual({ prompt: "p", aspect_ratio: "1:1" });
  });

  it("submits, polls the status URL until done, and returns the result, sending the key only to the queue", async () => {
    const fal = fakeFal({ model: "fal-ai/flux/schnell", properties: {}, result: { images: [{ url: "https://v3.fal.media/files/a.png" }] } });
    const result = await falRun("fal-ai/flux/schnell", { prompt: "x" }, { key: "k1", fetchImpl: fal.fetchImpl, timeoutMs: 10_000, pollMs: 5 });
    expect(result).toEqual({ images: [{ url: "https://v3.fal.media/files/a.png" }] });
    expect(fal.calls[0]).toMatchObject({ url: "https://queue.fal.run/fal-ai/flux/schnell", method: "POST", body: { prompt: "x" }, auth: "Key k1" });
    expect(fal.calls.every((call) => new URL(call.url).host === "queue.fal.run")).toBe(true);
  });

  it("never follows a status URL on another host, and marks a refused key as never started", async () => {
    const foreign = fakeFal({ model: "a/b", properties: {}, result: {}, statusHost: "evil.example.test" });
    await expect(falRun("a/b", {}, { key: "k", fetchImpl: foreign.fetchImpl, timeoutMs: 5_000, pollMs: 5 })).rejects.toThrow(/another host/);
    expect(foreign.calls.some((call) => call.url.includes("evil"))).toBe(false);
    const refused = fakeFal({ model: "a/b", properties: {}, result: {}, submitStatus: 401 });
    await expect(falRun("a/b", {}, { key: "k", fetchImpl: refused.fetchImpl, timeoutMs: 5_000 })).rejects.toMatchObject({ status: 401, neverStarted: true });
  });

  it("downloads only from fal's media hosts, with the expected type and within the size limit", async () => {
    const serve = (type: string, body: Buffer) => (async () => new Response(body, { headers: { "content-type": type } })) as unknown as typeof fetch;
    const options = { maxBytes: 64, mimes: ["image/png"], timeoutMs: 5_000 };
    await expect(falDownload("https://v3.fal.media/f.png", { ...options, fetchImpl: serve("image/png", PNG) })).resolves.toMatchObject({ mime: "image/png" });
    for (const url of ["https://evil.test/f.png", "http://v3.fal.media/f.png", "https://fal.media.evil.test/f.png"]) {
      await expect(falDownload(url, { ...options, fetchImpl: serve("image/png", PNG) }), url).rejects.toThrow(/outside its media hosts/);
    }
    await expect(falDownload("https://v3.fal.media/f.svg", { ...options, fetchImpl: serve("image/svg+xml", PNG) })).rejects.toThrow(/unsupported file type/);
    await expect(falDownload("https://v3.fal.media/f.png", { ...options, fetchImpl: serve("image/png", Buffer.alloc(65)) })).rejects.toThrow(/too large/);
  });

  it("prices an output per item, or per second for a video billed by the second", () => {
    expect(falCostUsd({ unitPrice: 0.025, unit: "image" }, {})).toBe(0.025);
    expect(falCostUsd({ unitPrice: 0.07, unit: "second" }, { seconds: 5 })).toBe(0.35);
    expect(falCostUsd({ unitPrice: 0.07, unit: "second" }, {})).toBeNull();
    expect(falCostUsd(null, { seconds: 5 })).toBeNull();
  });
});

describe("fal.ai images and videos", () => {
  const dirs: string[] = [];
  afterEach(async () => { for (const dir of dirs.splice(0)) await removeTempDir(dir); });

  it("makes an image with the base slot on fal.ai", async () => {
    const fal = fakeFal({ model: "fal-ai/flux/schnell", properties: { prompt: {}, aspect_ratio: { enum: ["1:1", "16:9"] } }, result: { images: [{ url: "https://v3.fal.media/a.png" }] }, media: { type: "image/png", body: PNG } });
    const image = await generateImage({ fal: { key: "k" }, imageGen: { primary: { provider: "fal" } } }, { prompt: "a fox", aspect: "16:9" }, { fetchImpl: fal.fetchImpl });
    expect(image).toMatchObject({ provider: "fal", model: "fal-ai/flux/schnell", mime: "image/png", usedFallback: false });
    expect(fal.calls.find((call) => call.method === "POST")?.body).toEqual({ prompt: "a fox", aspect_ratio: "16:9" });
    expect(fal.calls.find((call) => call.url.includes("fal.media"))?.auth, "the key never goes to the media host").toBeNull();
  });

  function turn(): VideoTurn & { attached: number } {
    const state = { attached: 0 };
    return Object.assign(state, { key: "t1", parked: () => state.attached, attach: async () => { state.attached += 1; return true; } });
  }

  it("makes a video only for a person's own turn, once turned on, within the per-turn limit, and reports what it made", async () => {
    const dir = mkdtempSync(join(tmpdir(), "odb-video-")); dirs.push(dir);
    const fal = fakeFal({ model: "fal-ai/veo3", properties: { prompt: {}, duration: { enum: ["4s", "8s"] } }, result: { video: { url: "https://v3.fal.media/v.mp4" } }, media: { type: "video/mp4", body: MP4 } });
    const made: unknown[] = [];
    const base = { cfg: { fal: { key: "k" }, videoGen: { enabled: true, model: "fal-ai/veo3", maxSeconds: 8 } }, personTurn: true, daily: createImageDailyCap(dir, { cap: 5, file: "v.json" }),
      fetchImpl: fal.fetchImpl, inFlight: new Map<string, number>(), made: (video: unknown) => made.push(video) };
    const own = turn();
    expect((await generateVideoForTurn({ prompt: "x" }, { ...base, personTurn: false, turn: own })).status).toBe(403);
    expect((await generateVideoForTurn({ prompt: "x" }, { ...base, cfg: { ...base.cfg, videoGen: { enabled: false } }, turn: own })).status).toBe(409);
    const ok = await generateVideoForTurn({ prompt: "waves", seconds: 9 }, { ...base, turn: own });
    expect(ok).toMatchObject({ status: 201 });
    expect(own.attached).toBe(1);
    expect(fal.calls.find((call) => call.method === "POST")?.body, "longer than allowed is held to the limit, then to the model's nearest length").toEqual({ prompt: "waves", duration: "8s" });
    expect(made).toEqual([expect.objectContaining({ model: "fal-ai/veo3", seconds: 8, mime: "video/mp4" })]);
    expect((await generateVideoForTurn({ prompt: "again" }, { ...base, turn: own })).status, "one video per reply by default").toBe(429);
  });
});
