// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setLocale } from "@/lib/i18n";
import type { Message } from "@/state/store";

const dispatch = vi.hoisted(() => vi.fn());
vi.mock("@/state/store", async (original) => ({ ...await original<typeof import("@/state/store")>(), useStore: () => ({ dispatch }) }));

let container: HTMLDivElement, root: Root;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  setLocale("en");
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); dispatch.mockReset(); });

const row: Message = { id: "n1", role: "bot", kind: "activity", at: 1, tool: {
  name: "notice: Gmail is signed out: its sign-in expired or was revoked. Reconnect it so your bots can use it again.", ok: false, reconnectApp: "gmail",
  nameCode: "chat.notice.appSignedOut", nameParams: { app: "Gmail" } } } as Message;

describe("an app that signed out, in the conversation", () => {
  it("says which app and opens Connected apps to reconnect it", async () => {
    const { StatusActivityRow } = await import("./StatusActivityRow");
    await act(async () => { root.render(createElement(StatusActivityRow, { message: row })); });
    expect(container.querySelector("[data-app-signed-out]")?.getAttribute("data-app-signed-out")).toBe("gmail");
    expect(container.textContent).toContain("Gmail is signed out");
    const button = [...container.querySelectorAll("button")].find((candidate) => candidate.textContent === "Reconnect")!;
    await act(async () => button.click());
    expect(dispatch).toHaveBeenCalledWith({ type: "togglePlugins", open: true, surface: "apps" });
  });
});
