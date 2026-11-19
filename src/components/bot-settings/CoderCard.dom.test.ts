// @vitest-environment happy-dom
import { createElement } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setLocale } from "@/lib/i18n";
import type { Bot } from "@/state/store";

const instance = (instanceId: string, displayName: string, models: string[]) => ({
  instanceId, displayName, snapshot: { state: "available", authenticated: true }, models: { options: models.map((id) => ({ id, label: id })) },
});

vi.mock("@/state/store", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/state/store")>();
  return { ...original, useStore: () => ({ state: { instances: [instance("claude", "Claude", ["sonnet", "opus"]), instance("codex", "Codex", ["gpt-5"])] } }) };
});

const { CoderCard } = await import("./CoderCard");

let host: HTMLDivElement;
let root: Root;
beforeEach(() => { setLocale("fr"); host = document.createElement("div"); document.body.append(host); root = createRoot(host); });
afterEach(() => { flushSync(() => root.unmount()); host.remove(); });

const bot = (coder?: Bot["coder"]) => ({ id: "b", modelSelection: { instanceId: "claude", model: "sonnet" }, coder } as unknown as Bot);
const render = (value: Bot, saved: unknown[]) => flushSync(() => root.render(createElement(CoderCard, { bot: value, onChange: (coder) => saved.push(coder) })));

describe("coder mode settings", () => {
  it("shows only the switch while off, and turns it on", () => {
    const saved: unknown[] = [];
    render(bot(), saved);
    expect(host.textContent).toContain("Mode Codeur");
    expect(host.querySelector("#bot-coder-reviewer")).toBeNull();
    host.querySelector<HTMLButtonElement>("[aria-label='Mode Codeur']")!.click();
    expect(saved.at(-1)).toEqual({ enabled: true });
  });

  it("offers every other model as reviewer, plan first, and the page to check once a reviewer is set", () => {
    const saved: unknown[] = [];
    render(bot({ enabled: true }), saved);
    const reviewer = host.querySelector<HTMLSelectElement>("#bot-coder-reviewer")!;
    expect([...reviewer.options].map((option) => option.textContent)).toEqual(["Pas de relecture", "Claude · opus", "Codex · gpt-5"]);
    expect(host.querySelector("input[type=url]")).toBeNull();
    host.querySelector<HTMLButtonElement>("[aria-label=\"Plan d'abord\"]")!.click();
    expect(saved.at(-1)).toEqual({ enabled: true, planFirst: true });
    reviewer.value = "codex\ngpt-5";
    reviewer.dispatchEvent(new Event("change", { bubbles: true }));
    expect(saved.at(-1)).toEqual({ enabled: true, review: { instanceId: "codex", model: "gpt-5" } });

    render(bot({ enabled: true, review: { instanceId: "codex", model: "gpt-5" } }), saved);
    expect(host.textContent).toContain("Page à vérifier");
  });
});
