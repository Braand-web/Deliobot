import { describe, expect, it } from "vitest";

import type { FalModelCatalog, FalModelList } from "./fal-models.ts";
import { chooseMediaModel, resolveMediaModel } from "./media-choice.ts";
import { botMediaPatch } from "./routes/bot-patch.ts";

const list: FalModelList = { source: "fal", models: [
  { id: "auto", name: "Auto", group: "recommended" },
  { id: "fal-ai/kling-video/v3/pro/text-to-video", name: "Kling 3 Pro", group: "recommended" },
  { id: "fal-ai/kling-video/v2.5-turbo/pro/text-to-video", name: "Kling 2.5 Turbo Pro", group: "recommended" },
  { id: "fal-ai/veo3", name: "Veo 3", group: "more" },
] };
const catalog = { load: async () => list } as FalModelCatalog;

describe("media models a bot uses", () => {
  it("finds a model from its ID or the words someone typed, recommended first", () => {
    expect(resolveMediaModel(list, "fal-ai/veo3")).toBe("fal-ai/veo3");
    expect(resolveMediaModel(list, "kling 3")).toBe("fal-ai/kling-video/v3/pro/text-to-video");
    expect(resolveMediaModel(list, "Veo")).toBe("fal-ai/veo3");
    expect(resolveMediaModel(list, "fal-ai/some/new-model")).toBe("fal-ai/some/new-model");
    expect(resolveMediaModel(list, "midjourney")).toBeNull();
  });

  it("takes the named model, then the bot's own, else leaves the workspace setting", async () => {
    expect(await chooseMediaModel("video", "veo 3", { video: "fal-ai/kling-video/v3/pro/text-to-video" }, catalog)).toEqual({ model: "fal-ai/veo3" });
    expect(await chooseMediaModel("video", undefined, { video: "fal-ai/kling-video/v3/pro/text-to-video" }, catalog)).toEqual({ model: "fal-ai/kling-video/v3/pro/text-to-video" });
    expect(await chooseMediaModel("video", "auto", undefined, catalog)).toEqual({ model: null });
    expect(await chooseMediaModel("video", "midjourney", undefined, catalog)).toMatchObject({ error: expect.stringContaining("Kling 3 Pro") });
  });

  it("saves a bot's choice only as model IDs, and clears it", () => {
    expect(botMediaPatch({ image: "fal-ai/flux-2-pro", video: "auto" })).toEqual({ value: { image: "fal-ai/flux-2-pro" } });
    expect(botMediaPatch({})).toEqual({ value: undefined });
    expect(botMediaPatch(null)).toEqual({ value: undefined });
    expect(botMediaPatch({ image: "https://evil.test/x" })).toBeNull();
    expect(botMediaPatch({ voice: "x" })).toBeNull();
  });
});
