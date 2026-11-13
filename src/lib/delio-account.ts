import { useEffect, useRef, useState } from "react";

import { api } from "@/state/store";

/** GET /api/delio/account: `planGate` is on in the installed app, where the customer's own AI needs a Max or BYOK plan. */
export type DelioAccount = {
  planGate: boolean;
  ownAi: boolean;
} & ({ connected: false } | { connected: true; workspace: string; portal: string; billingUrl?: string; email?: string | null; credits?: number; usedThisMonth?: number; plan?: string | null });

export type DelioConnectFlow = { state: "connected"; workspace: string } | { state: "waiting"; userCode: string; verification: string }
  | { state: "disconnected"; reason?: "denied" | "expired" };

const CHANGED = "delio-account-changed";
const REFRESH_MS = 60_000;

/** Asks every useDelioAccount to read the account again, after a connection, a disconnection or a purchase. */
export function delioAccountChanged(): void {
  window.dispatchEvent(new Event(CHANGED));
}

/** The connected Delio account, or null until the first answer. */
export function useDelioAccount(): DelioAccount | null {
  const [account, setAccount] = useState<DelioAccount | null>(null);
  useEffect(() => {
    let alive = true;
    const read = (fresh: boolean) => void Promise.resolve().then(() => api<DelioAccount>(`/api/delio/account${fresh ? "?fresh=1" : ""}`, { background: true }))
      .then((answer) => { if (alive && answer && typeof answer === "object" && "connected" in answer) setAccount(answer); }, () => undefined);
    const load = () => read(false);
    const again = () => read(true);
    load();
    const timer = window.setInterval(load, REFRESH_MS);
    window.addEventListener(CHANGED, again);
    window.addEventListener("focus", again);
    return () => { alive = false; window.clearInterval(timer); window.removeEventListener(CHANGED, again); window.removeEventListener("focus", again); };
  }, []);
  return account;
}

/** Whether this app's own-AI settings (the person's keys, their Claude, ChatGPT or other sign-ins) are locked by the plan. */
export function ownAiLocked(account: DelioAccount | null): boolean {
  return account !== null && account.planGate && !account.ownAi;
}

/** Connects this app to a Delio account: the portal's page signs the person in or up, then approves the app. */
export function useDelioConnect() {
  const [flow, setFlow] = useState<DelioConnectFlow | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const polling = useRef<number | null>(null);
  const stop = () => { if (polling.current) window.clearInterval(polling.current); polling.current = null; };
  const follow = () => {
    stop();
    polling.current = window.setInterval(async () => {
      const next = await api<DelioConnectFlow>("/api/delio/connect", { background: true }).catch(() => null);
      if (!next) return;
      setFlow(next);
      if (next.state !== "waiting") { stop(); delioAccountChanged(); }
    }, 2000);
  };
  useEffect(() => {
    let alive = true;
    void api<DelioConnectFlow>("/api/delio/connect", { background: true }).then((current) => {
      if (alive && current?.state === "waiting") { setFlow(current); follow(); }
    }, () => undefined);
    return () => { alive = false; stop(); };
  }, []);

  const connect = async () => {
    setBusy(true);
    setError(null);
    try {
      const started = await api<{ userCode: string; verification: string }>("/api/delio/connect", { method: "POST", body: "{}" });
      setFlow({ state: "waiting", ...started });
      window.open(started.verification, "_blank", "noopener");
      follow();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  const disconnect = async () => {
    setBusy(true);
    try {
      await api("/api/delio/account", { method: "DELETE" });
      setFlow(null);
      delioAccountChanged();
    } finally {
      setBusy(false);
    }
  };

  return { flow, busy, error, connect, disconnect };
}
