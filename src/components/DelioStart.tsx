import { Loader2 } from "lucide-react";

import { DelioAvatar } from "@/components/Avatar";
import { WindowDragStrip } from "@/components/DesktopCapabilities";
import { DelioConnectWaiting } from "@/components/keys/DelioAccountCard";
import { productName } from "@/lib/brand";
import { useDelioConnect, type DelioAccount } from "@/lib/delio-account";
import { t } from "@/lib/i18n";
import { useStore } from "@/state/store";

/** Whether the installed app must first be connected to a Delio account, or given a plan, before anything else. */
export function delioStartStep(account: DelioAccount | null): "connect" | "plan" | null {
  if (!account?.planGate) return null;
  if (!account.connected) return "connect";
  if (typeof account.credits !== "number") return null;
  return !account.plan && account.credits <= 0 ? "plan" : null;
}

/** The installed app's first screen: create a Delio account or sign in, then choose a plan. */
export function DelioStart({ step }: { step: "connect" | "plan" }) {
  const { dispatch } = useStore();
  const { flow, busy, error, connect } = useDelioConnect();
  const waiting = flow?.state === "waiting";
  return (
    <main data-delio-start={step} className="relative flex h-full min-w-0 flex-1 flex-col items-center justify-center overflow-y-auto bg-app px-6">
      <WindowDragStrip />
      <div className="flex w-full max-w-[460px] flex-col items-center text-center">
        <DelioAvatar color="green" state={waiting ? "listening" : "curious"} size={64} label={productName()} />
        <h1 className="mt-5 text-[22px] font-semibold tracking-[-0.01em] text-ink">
          {t(step === "connect" ? "delioStart.connect.title" : "delioStart.plan.title", { app: productName() })}
        </h1>
        <p className="mt-2 text-[14px] leading-relaxed text-ink-secondary">{t(step === "connect" ? "delioStart.connect.body" : "delioStart.plan.body")}</p>
        {step === "connect"
          ? <button type="button" data-delio-start-connect className="mt-6 inline-flex items-center gap-2 rounded-full bg-accent px-5 py-2.5 text-[14px] font-semibold text-accent-ink transition-opacity hover:opacity-90 disabled:opacity-60"
              disabled={busy || waiting} onClick={() => void connect()}>
              {busy && <Loader2 size={14} className="animate-spin" />}
              {t("delioStart.connect.action")}
            </button>
          : <button type="button" data-delio-start-plans className="mt-6 rounded-full bg-accent px-5 py-2.5 text-[14px] font-semibold text-accent-ink transition-opacity hover:opacity-90"
              onClick={() => dispatch({ type: "openCloudAdd", source: "app_onboarding" })}>
              {t("delioStart.plan.action")}
            </button>}
        {step === "connect" && waiting && <div className="w-full text-left"><DelioConnectWaiting userCode={flow.userCode} verification={flow.verification} /></div>}
        {step === "connect" && <p className="mt-4 text-[12px] leading-relaxed text-ink-secondary">{t("delioStart.connect.note")}</p>}
        {flow?.state === "disconnected" && flow.reason && <p role="alert" className="mt-3 text-[12px] text-danger">{t(flow.reason === "denied" ? "delioAccount.denied" : "delioAccount.expired")}</p>}
        {error && <p role="alert" className="mt-3 text-[12px] text-danger">{error}</p>}
      </div>
    </main>
  );
}
