// @vitest-environment happy-dom
// A bot's Media card, in a real DOM, against the harness's model lists.
import { createElement } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setLocale } from "@/lib/i18n";
import type { Bot } from "@/state/store";

vi.mock("@/state/store", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/state/store")>();
  return { ...original, api: (path: string) => Promise.resolve({ source: "fal", models: path.includes("kind=video")
    ? [{ id: "auto", name: "Auto", group: "recommended" }, { id: "fal-ai/kling-video/v3/pro/text-to-video", name: "Kling 3 Pro", group: "recommended" }, { id: "fal-ai/veo3", name: "Veo 3", group: "more" }]
    : [{ id: "auto", name: "Auto", group: "recommended" }] }) };
});

const { MediaModelsCard } = await import("./MediaModelsCard");

let host: HTMLDivElement;
let root: Root;
const settle = async () => { for (let i = 0; i < 3; i++) await new Promise((resolve) => setTimeout(resolve, 0)); };

beforeEach(() => { setLocale("fr"); host = document.createElement("div"); document.body.append(host); root = createRoot(host); });
afterEach(() => { flushSync(() => root.unmount()); host.remove(); });

describe("a bot's media models", () => {
  it("starts on Auto, lists the models by name without the provider, and saves the one chosen", async () => {
    const saved: unknown[] = [];
    flushSync(() => root.render(createElement(MediaModelsCard, { bot: { id: "b", media: { image: "fal-ai/flux-2-pro" } } as unknown as Bot, onChange: (media) => saved.push(media) })));
    await settle();
    expect(host.textContent).toContain("Médias");
    expect(host.textContent).not.toMatch(/fal\.ai/i);
    const video = host.querySelector<HTMLSelectElement>("#bot-media-video")!;
    expect(video.value).toBe("auto");
    expect([...video.options].map((option) => option.textContent)).toEqual(["Auto (recommandé)", "Kling 3 Pro", "Veo 3"]);
    video.value = "fal-ai/veo3";
    video.dispatchEvent(new Event("change", { bubbles: true }));
    expect(saved.at(-1)).toEqual({ image: "fal-ai/flux-2-pro", video: "fal-ai/veo3" });
  });
});
