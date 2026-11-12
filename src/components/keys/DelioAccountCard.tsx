import { useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";

import { api } from "@/state/store";
import { t } from "@/lib/i18n";

type Account = { connected: false } | { connected: true; workspace: string; portal: string; credits?: number; usedThisMonth?: number };
type Flow = { state: "connected"; workspace: string } | { state: "waiting"; userCode: string; verification: string } | { state: "disconnected"; reason?: "denied" | "expired" };

/** Connects this app to a Delio account, whose credits then pay for the "Delio" engine, images, video and music. */
export function DelioAccountCard() {
  const [account, setAccount] = useState<Account | null>(null);
  const [flow, setFlow] = useState<Flow | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const polling = useRef<number | null>(null);

  const load = () => Promise.resolve().then(() => api<Account>("/api/delio/account", { background: true }))
    .then((answer) => setAccount(answer && typeof answer === "object" && "connected" in answer ? answer : null), () => setAccount(null));
  useEffect(() => { void load(); return () => { if (polling.current) window.clearInterval(polling.current); }; }, []);

  const stopPolling = () => { if (polling.current) window.clearInterval(polling.current); polling.current = null; };
  const connect = async () => {
    setBusy(true);
    setError(null);
    try {
      const started = await api<{ userCode: string; verification: string }>("/api/delio/connect", { method: "POST", body: "{}" });
      setFlow({ state: "waiting", ...started });
      window.open(started.verification, "_blank", "noopener");
      stopPolling();
      polling.current = window.setInterval(async () => {
        const next = await api<Flow>("/api/delio/connect", { background: true }).catch(() => null);
        if (!next) return;
        setFlow(next);
        if (next.state !== "waiting") { stopPolling(); void load(); }
      }, 2000);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };
  const disconnect = async () => {
    setBusy(true);
    try { await api("/api/delio/account", { method: "DELETE" }); setFlow(null); await load(); } finally { setBusy(false); }
  };

  if (!account) return null;
  const format = (value: number) => value.toLocaleString(undefined, { maximumFractionDigits: 1 });
  return (
    <section data-delio-account className="rounded-xl bg-card px-4 py-3">
      <div className="flex items-center gap-3">
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="text-[14px] font-medium leading-5 text-ink">{t("delioAccount.title")}</span>
          <span className="text-[13px] leading-[18px] text-ink-secondary">
            {account.connected
              ? t("delioAccount.connected", { account: account.workspace }) + (typeof account.credits === "number" ? ` · ${t("delioAccount.credits", { credits: format(account.credits) })}` : "")
              : t("delioAccount.pitch")}
          </span>
        </span>
        {account.connected
          ? <button type="button" className="ui-button shrink-0" disabled={busy} onClick={() => void disconnect()}>{t("delioAccount.disconnect")}</button>
          : <button type="button" className="ui-button shrink-0" disabled={busy || flow?.state === "waiting"} onClick={() => void connect()}>
              {busy ? <Loader2 size={13} className="animate-spin" /> : t("delioAccount.connect")}
            </button>}
      </div>
      {!account.connected && flow?.state === "waiting" && (
        <div role="status" className="mt-3 rounded-lg bg-ink/[0.05] px-3 py-2 text-[13px] text-ink-secondary">
          {t("delioAccount.waiting")}{" "}
          <span data-delio-code className="font-mono text-[15px] font-semibold tracking-wider text-ink">{flow.userCode}</span>{" "}
          <a href={flow.verification} target="_blank" rel="noreferrer" className="text-accent hover:underline">{t("delioAccount.open")}</a>
        </div>
      )}
      {flow?.state === "disconnected" && flow.reason && <p role="alert" className="mt-2 text-[12px] text-danger">{t(flow.reason === "denied" ? "delioAccount.denied" : "delioAccount.expired")}</p>}
      {error && <p role="alert" className="mt-2 text-[12px] text-danger">{error}</p>}
    </section>
  );
}
