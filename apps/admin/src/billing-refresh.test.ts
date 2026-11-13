import { runInNewContext } from "node:vm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BILLING_REFRESH_SCRIPT } from "./billing-refresh.ts";

afterEach(() => vi.useRealTimers());

function browser(fetchImpl: typeof fetch) {
  const window = new EventTarget();
  const documentEvents = new EventTarget();
  const pending = { hidden: true };
  const reload = vi.fn();
  runInNewContext(BILLING_REFRESH_SCRIPT, {
    window,
    document: {
      currentScript: { dataset: { workspace: "acme", paymentVersion: "0" } },
      visibilityState: "visible",
      addEventListener: documentEvents.addEventListener.bind(documentEvents),
      querySelector: () => pending,
    },
    fetch: fetchImpl, location: { reload }, AbortController, setTimeout, clearTimeout,
  });
  return { window, pending, reload };
}

describe("billing payment refresh", () => {
  it("updates only after the server confirms a payment and keeps checking beyond two minutes", async () => {
    vi.useFakeTimers();
    let paid = false;
    const fetchImpl = vi.fn(async () => Response.json({ paymentVersion: paid ? 1 : 0, pending: !paid }));
    const page = browser(fetchImpl as typeof fetch);
    await vi.advanceTimersByTimeAsync(0);
    expect(page.pending.hidden).toBe(false);
    await vi.advanceTimersByTimeAsync(180_000);
    expect(page.reload).not.toHaveBeenCalled();
    paid = true;
    await vi.advanceTimersByTimeAsync(5_000);
    expect(page.reload).toHaveBeenCalledOnce();
    expect(fetchImpl).toHaveBeenCalledWith("/api/billing/status?workspace=acme", expect.objectContaining({ credentials: "same-origin", cache: "no-store" }));
    page.window.dispatchEvent(new Event("pagehide"));
  });

  it("recovers from a network failure and stops when the page is left", async () => {
    vi.useFakeTimers();
    const fetchImpl = vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValue(Response.json({ paymentVersion: 0, pending: true }));
    const page = browser(fetchImpl);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(page.pending.hidden).toBe(false);
    expect(page.reload).not.toHaveBeenCalled();
    page.window.dispatchEvent(new Event("pagehide"));
    const requests = fetchImpl.mock.calls.length;
    await vi.advanceTimersByTimeAsync(60_000);
    expect(fetchImpl).toHaveBeenCalledTimes(requests);
  });

  it("resumes confirmation after the browser restores the billing page from its back cache", async () => {
    vi.useFakeTimers();
    let paid = false;
    const page = browser((async () => Response.json({ paymentVersion: paid ? 1 : 0, pending: !paid })) as typeof fetch);
    await vi.advanceTimersByTimeAsync(0);
    page.window.dispatchEvent(new Event("pagehide"));
    paid = true;
    page.window.dispatchEvent(new Event("pageshow"));
    await vi.advanceTimersByTimeAsync(0);
    expect(page.reload).toHaveBeenCalledOnce();
    page.window.dispatchEvent(new Event("pagehide"));
  });
});
