// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/state/store", () => ({ api: vi.fn() }));
import { api } from "@/state/store";
import { delioAccountChanged, delioPaymentStarted, ownAiLocked, useDelioAccount, type DelioAccount } from "./delio-account";

let root: Root | undefined;
let container: HTMLDivElement;
let snapshot: DelioAccount;
let current: DelioAccount | null;

function Probe({ enabled = true }: { enabled?: boolean }) {
  current = useDelioAccount(enabled);
  return createElement("p", null, current?.connected ? `${current.plan}:${current.credits}` : "disconnected");
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.useFakeTimers();
  delioAccountChanged();
  current = null;
  snapshot = { connected: true, workspace: "acme", portal: "https://portal.test", credits: 0, usedThisMonth: 0, plan: null, paymentVersion: 0, ownAi: false, planGate: true };
  vi.mocked(api).mockReset().mockImplementation(async () => snapshot as never);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root?.unmount());
  container.remove();
  delioAccountChanged();
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("Delio account after checkout", () => {
  it("waits for verification before locking the connected account's settings", () => {
    expect(ownAiLocked({ connected: true, workspace: "acme", portal: "https://portal.test", checking: true, planGate: true, ownAi: false })).toBe(false);
    expect(ownAiLocked({ connected: true, workspace: "acme", portal: "https://portal.test", checking: false, planGate: true, ownAi: false })).toBe(true);
  });
  it("updates plan and credits without a browser return, including after a late confirmation", async () => {
    await act(async () => root!.render(createElement(Probe)));
    await act(async () => delioPaymentStarted());
    await act(async () => vi.advanceTimersByTimeAsync(180_000));
    expect(container.textContent).toBe("null:0");
    snapshot = { ...snapshot, connected: true, workspace: "acme", portal: "https://portal.test", plan: "max", credits: 13500, paymentVersion: 1, ownAi: true };
    await act(async () => vi.advanceTimersByTimeAsync(5_000));
    expect(container.textContent).toBe("max:13500");
    expect(current).toMatchObject({ ownAi: true, paymentVersion: 1 });
    expect(api).toHaveBeenLastCalledWith("/api/delio/account?fresh=1", { background: true });
    vi.mocked(api).mockClear();
    await act(async () => vi.advanceTimersByTimeAsync(5_000));
    expect(api).not.toHaveBeenCalled();
    await act(async () => vi.advanceTimersByTimeAsync(55_000));
    expect(api).toHaveBeenCalledOnce();
  });

  it("keeps retrying after a connection failure and refreshes when the app regains focus", async () => {
    await act(async () => root!.render(createElement(Probe)));
    await act(async () => delioPaymentStarted());
    vi.mocked(api).mockRejectedValueOnce(new Error("offline"));
    await act(async () => vi.advanceTimersByTimeAsync(5_000));
    expect(container.textContent).toBe("null:0");
    snapshot = { ...snapshot, connected: true, workspace: "acme", portal: "https://portal.test", plan: "trial", credits: 300, paymentVersion: 1 };
    await act(async () => window.dispatchEvent(new Event("focus")));
    expect(container.textContent).toBe("trial:300");
  });

  it("does not keep polling when the plans dialog is disabled", async () => {
    await act(async () => root!.render(createElement(Probe)));
    await act(async () => delioPaymentStarted());
    await act(async () => root!.render(createElement(Probe, { enabled: false })));
    vi.mocked(api).mockClear();
    await act(async () => vi.advanceTimersByTimeAsync(60_000));
    expect(api).not.toHaveBeenCalled();
  });
});
