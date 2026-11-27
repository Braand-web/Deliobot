import { Loader2 } from "lucide-react";
import { useCallback, useEffect, useState, type FormEvent } from "react";

import { activeLocale, t } from "@/lib/i18n";
import { localizedRelativeTime } from "@/lib/relative-time";
import { api, type ConfigStatus } from "@/state/store";
import { useStoreDispatch } from "@/state/store-select";
import { Switch } from "../SettingsPrimitives";
import { redeemDelioPromo, useDelioAccount, useDelioConnect } from "@/lib/delio-account";
import { cn } from "@/lib/cn";
import { ApiError } from "@/state/api";
import { KEY_FIELD } from "./KeyRow";

/** The device code to type or confirm on the portal's page, while the app waits for its approval. */
export function DelioConnectWaiting({ userCode, verification, codeNeeded = true }: { userCode: string; verification: string; codeNeeded?: boolean }) {
  if (!codeNeeded) {
    return (
      <div role="status" data-delio-link className="mt-3 rounded-lg bg-ink/[0.05] px-3 py-2 text-[13px] text-ink-secondary">
        {t("delioAccount.waitingLink")}{" "}
        <a href={verification} target="_blank" rel="noreferrer" className="text-accent hover:underline">{t("delioAccount.open")}</a>
      </div>
    );
  }
  return (
    <div role="status" className="mt-3 rounded-lg bg-ink/[0.05] px-3 py-2 text-[13px] text-ink-secondary">
      {t("delioAccount.waiting")}{" "}
      <span data-delio-code className="font-mono text-[15px] font-semibold tracking-wider text-ink">{userCode}</span>{" "}
      <a href={verification} target="_blank" rel="noreferrer" className="text-accent hover:underline">{t("delioAccount.open")}</a>
    </div>
  );
}

/** A promo code the person types: a plan code starts its plan with its credits at once on the connected account. */
export function DelioPromoField({ connected, onConnect }: { connected: boolean; onConnect: () => void }) {
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [answer, setAnswer] = useState<{ ok: boolean; text: string } | null>(null);
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!connected) { onConnect(); return; }
    if (!code.trim() || busy) return;
    setBusy(true);
    setAnswer(null);
    try {
      const message = await redeemDelioPromo(code.trim());
      setAnswer({ ok: true, text: message || t("delioAccount.promoDone") });
      setCode("");
    } catch (error) {
      const text = error instanceof ApiError && error.status !== 502 && error.body && typeof error.body.error === "string" && error.body.error !== "promo refused" ? error.body.error : t("delioAccount.promoFailed");
      setAnswer({ ok: false, text });
    } finally { setBusy(false); }
  }
  return (
    <form data-delio-promo onSubmit={(event) => void submit(event)} className="mt-3 flex flex-col gap-1.5">
      <label htmlFor="delio-promo-code" className="text-[13px] font-medium text-ink">{t("delioAccount.promoLabel")}</label>
      <div className="flex items-center gap-2">
        <input id="delio-promo-code" value={code} onChange={(event) => setCode(event.target.value.toUpperCase())} maxLength={40} autoComplete="off" spellCheck={false}
          placeholder="DELIO-XXXX-XXXX" className={cn(KEY_FIELD, "flex-1 font-mono uppercase")} />
        <button type="submit" className="ui-button shrink-0" disabled={busy || (connected && !code.trim())}>
          {busy ? <Loader2 size={13} className="animate-spin" /> : t(connected ? "delioAccount.promoApply" : "delioAccount.connect")}
        </button>
      </div>
      {!connected && <p className="text-[12px] text-ink-secondary">{t("delioAccount.promoConnectFirst")}</p>}
      {answer && <p role={answer.ok ? "status" : "alert"} className={answer.ok ? "text-[12px] text-ink" : "text-[12px] text-danger"}>{answer.text}</p>}
    </form>
  );
}

interface MemoryBackupView {
  enabled: boolean; lastAt?: number; lastError?: string; lastErrorAt?: number; remoteError?: string;
  backups: Array<{ id: string; at: number; bots: number; device: string }>;
}
interface RestoreReport { bots: number; created: string[]; files: number; aboutMe: number; team: number }

/** The bots' memory kept in the account: on by default, a copy every six hours when it changed, restorable on any computer. */
export function DelioMemoryBackup() {
  const dispatch = useStoreDispatch();
  const [view, setView] = useState<MemoryBackupView | null>(null);
  const [busy, setBusy] = useState<"backup" | "restore" | "toggle" | null>(null);
  const [answer, setAnswer] = useState<{ ok: boolean; text: string } | null>(null);
  const load = useCallback(async () => {
    try { setView(await api<MemoryBackupView>("/api/delio/memory", { timeoutMs: 20_000 })); } catch { setView(null); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  if (!view) return null;
  const when = (at: number) => localizedRelativeTime(at, activeLocale());
  const failed = view.lastError && (view.lastErrorAt ?? 0) >= (view.lastAt ?? 0);
  const newest = view.backups[0];
  async function run(kind: "backup" | "restore" | "toggle") {
    if (busy) return;
    setBusy(kind);
    setAnswer(null);
    try {
      if (kind === "toggle") {
        const config = await api<ConfigStatus>("/api/config", { method: "PATCH", body: JSON.stringify({ features: { delioMemoryBackup: !view!.enabled } }) });
        dispatch({ type: "configStatus", config });
      } else if (kind === "backup") {
        await api("/api/delio/memory/backup", { method: "POST", timeoutMs: 90_000 });
        setAnswer({ ok: true, text: t("delioMemory.saved") });
      } else {
        const report = await api<RestoreReport>("/api/delio/memory/restore", { method: "POST", body: "{}", timeoutMs: 90_000 });
        setAnswer({ ok: true, text: t("delioMemory.restored", { bots: report.bots, files: report.files + report.team + report.aboutMe })
          + (report.created.length ? ` ${t("delioMemory.created", { names: report.created.join(", ") })}` : "") });
      }
    } catch (error) {
      setAnswer({ ok: false, text: error instanceof Error && error.message ? error.message : t("delioMemory.failed") });
    } finally {
      setBusy(null);
      void load();
    }
  }
  return (
    <div data-delio-memory className="mt-3 border-t border-hairline/40 pt-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[13px] font-medium text-ink">{t("delioMemory.title")}</div>
          <p className="mt-0.5 text-[13px] leading-relaxed text-ink-secondary">{t("delioMemory.subtitle")}</p>
          <p className="mt-1 text-[12px] text-ink-secondary">
            {failed ? t("delioMemory.lastFailed", { time: when(view.lastErrorAt!) })
              : view.lastAt ? t("delioMemory.lastSaved", { time: when(view.lastAt) }) : t("delioMemory.never")}
            {newest ? ` ${t("delioMemory.newest", { time: when(newest.at), device: newest.device || "?" })}` : ""}
          </p>
        </div>
        <Switch checked={view.enabled} aria-label={t("delioMemory.title")} disabled={busy !== null} onClick={() => void run("toggle")} className="disabled:cursor-wait disabled:opacity-50" />
      </div>
      <div className="mt-2 flex flex-wrap gap-2">
        <button type="button" className="ui-button" disabled={busy !== null} onClick={() => void run("backup")}>
          {busy === "backup" ? <Loader2 size={13} className="animate-spin" /> : t("delioMemory.saveNow")}
        </button>
        <button type="button" className="ui-button" disabled={busy !== null || !newest} onClick={() => void run("restore")}>
          {busy === "restore" ? <Loader2 size={13} className="animate-spin" /> : t("delioMemory.restore")}
        </button>
      </div>
      {answer && <p role={answer.ok ? "status" : "alert"} className={answer.ok ? "mt-1 text-[12px] text-ink" : "mt-1 text-[12px] text-danger"}>{answer.text}</p>}
    </div>
  );
}

/** Connects this app to a Delio account, whose credits then pay for the "Delio" engine, images, video and music. */
export function DelioAccountCard() {
  const account = useDelioAccount();
  const { flow, busy, error, connect, disconnect } = useDelioConnect();

  if (!account) return null;
  const format = (value: number) => value.toLocaleString(undefined, { maximumFractionDigits: 1 });
  return (
    <section data-delio-account className="rounded-xl bg-card px-4 py-3">
      <div className="flex items-center gap-3">
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="text-[14px] font-medium leading-5 text-ink">{t("delioAccount.title")}</span>
          <span className="text-[13px] leading-[18px] text-ink-secondary">
            {account.connected
              ? t("delioAccount.connected", { account: account.email || t("delioMenu.connected") }) + (typeof account.credits === "number" ? ` · ${t("delioAccount.credits", { credits: format(account.credits) })}` : "")
              : t("delioAccount.pitch")}
          </span>
        </span>
        {account.connected
          ? <button type="button" className="ui-button shrink-0" disabled={busy} onClick={() => void disconnect()}>{t("delioAccount.disconnect")}</button>
          : <button type="button" className="ui-button shrink-0" disabled={busy || flow?.state === "waiting"} onClick={() => void connect()}>
              {busy ? <Loader2 size={13} className="animate-spin" /> : t("delioAccount.connect")}
            </button>}
      </div>
      {!account.connected && flow?.state === "waiting" && <DelioConnectWaiting userCode={flow.userCode} verification={flow.verification} codeNeeded={flow.codeNeeded} />}
      {flow?.state === "disconnected" && flow.reason && <p role="alert" className="mt-2 text-[12px] text-danger">{t(flow.reason === "denied" ? "delioAccount.denied" : "delioAccount.expired")}</p>}
      {error && <p role="alert" className="mt-2 text-[12px] text-danger">{error}</p>}
      {account.connected && <DelioPromoField connected onConnect={() => void connect()} />}
      {account.connected && <DelioMemoryBackup />}
    </section>
  );
}
