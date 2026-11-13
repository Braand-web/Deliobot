import { Loader2 } from "lucide-react";

import { t } from "@/lib/i18n";
import { useDelioAccount, useDelioConnect } from "@/lib/delio-account";

/** The device code to type or confirm on the portal's page, while the app waits for its approval. */
export function DelioConnectWaiting({ userCode, verification }: { userCode: string; verification: string }) {
  return (
    <div role="status" className="mt-3 rounded-lg bg-ink/[0.05] px-3 py-2 text-[13px] text-ink-secondary">
      {t("delioAccount.waiting")}{" "}
      <span data-delio-code className="font-mono text-[15px] font-semibold tracking-wider text-ink">{userCode}</span>{" "}
      <a href={verification} target="_blank" rel="noreferrer" className="text-accent hover:underline">{t("delioAccount.open")}</a>
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
      {!account.connected && flow?.state === "waiting" && <DelioConnectWaiting userCode={flow.userCode} verification={flow.verification} />}
      {flow?.state === "disconnected" && flow.reason && <p role="alert" className="mt-2 text-[12px] text-danger">{t(flow.reason === "denied" ? "delioAccount.denied" : "delioAccount.expired")}</p>}
      {error && <p role="alert" className="mt-2 text-[12px] text-danger">{error}</p>}
    </section>
  );
}
