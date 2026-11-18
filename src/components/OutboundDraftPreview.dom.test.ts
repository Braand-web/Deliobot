// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setLocale } from "@/lib/i18n";
import { OutboundDraftPreview } from "./OutboundDraftPreview";

let container: HTMLDivElement, root: Root;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  setLocale("en");
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); });

const draft = { app: "Gmail", to: "ana@example.com", subject: "Invoice", body: "Hello Ana", files: [{ name: "invoice.pdf", bytes: 2048 }] };
const render = async (props: Parameters<typeof OutboundDraftPreview>[0]) => { await act(async () => { root.render(createElement(OutboundDraftPreview, props)); }); };
const button = (selector: string) => container.querySelector<HTMLButtonElement>(selector)!;

describe("a send's draft on its card", () => {
  it("shows who it goes to, the subject, the whole text and the files", async () => {
    await render({ drafts: [draft] });
    const text = container.textContent ?? "";
    for (const part of ["ana@example.com", "Invoice", "Hello Ana", "invoice.pdf · 2 KB"]) expect(text).toContain(part);
    expect(container.querySelector("[data-outbound-draft-edit-open]")).toBeNull();
  });

  it("lets the person send their own version, only once they changed it", async () => {
    const onEdit = vi.fn();
    await render({ drafts: [draft], onEdit });
    await act(async () => button("[data-outbound-draft-edit-open]").click());
    expect(button("[data-outbound-draft-resend]").disabled).toBe(true);
    const textarea = container.querySelector("textarea")!;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!;
      setter.call(textarea, "Hello Ana, here is the invoice.");
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => button("[data-outbound-draft-resend]").click());
    expect(onEdit).toHaveBeenCalledWith({ subject: "Invoice", body: "Hello Ana, here is the invoice." });
  });

  it("offers no edit when the card holds several sends", async () => {
    await render({ drafts: [draft, { ...draft, to: "bo@example.com" }], onEdit: vi.fn() });
    expect(container.querySelector("[data-outbound-draft-edit-open]")).toBeNull();
  });
});
