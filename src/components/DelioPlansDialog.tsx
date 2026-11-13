import { useEffect, useState } from "react";
import { Loader2, X } from "lucide-react";
import type { DelioCatalog } from "../../shared/delio-plans";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { useDelioAccount } from "@/lib/delio-account";
import { api, useStore } from "@/state/store";
import { DelioPlansScreen } from "./cloud-buy/DelioPlansScreen";
import { CLOSE, Heading, ON_NIGHT, QUIET, SCREEN, SHEET } from "./cloud-buy/parts";

/** The plans sheet every "Try Cloud", "See plans" and "Upgrade" in the app opens. */
export function DelioPlansDialog() {
  const { state, dispatch } = useStore();
  const open = Boolean(state.cloudAdd);
  const account = useDelioAccount(open);
  const accountKey = account?.connected ? `${account.portal}/${account.workspace}` : null;
  const [catalog, setCatalog] = useState<DelioCatalog | null | undefined>(undefined);
  const [attempt, setAttempt] = useState(0);
  const close = () => dispatch({ type: "closeCloudAdd" });

  useEffect(() => {
    if (!open) return;
    let active = true;
    setCatalog(undefined);
    Promise.resolve().then(() => api<DelioCatalog>("/api/delio/plans", { background: true }))
      .then(next => { if (active) setCatalog(next && Array.isArray(next.plans) ? next : null); }, () => { if (active) setCatalog(null); });
    return () => { active = false; };
  }, [open, attempt, accountKey]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") { event.preventDefault(); close(); } };
    window.addEventListener("keydown", onKey, true);
    (document.querySelector("#cloud-add-title") as HTMLElement | null)?.focus();
    return () => window.removeEventListener("keydown", onKey, true);
  }, [open, catalog]);

  if (!open) return null;
  return <div className="ui-scrim fixed inset-0 z-[60] flex items-center justify-center p-4 sm:p-6" onMouseDown={event => event.target === event.currentTarget && close()}>
    <div role="dialog" aria-modal="true" aria-labelledby="cloud-add-title" data-cloud-add-dialog tabIndex={-1}
      className={cn(SHEET, "group/sheet animate-pop-in relative max-h-full w-full overflow-y-auto overscroll-contain outline-none", catalog ? "max-w-[1040px]" : "max-w-[540px]")}>
      <button type="button" onClick={close} aria-label={t("cloudAdd.close")} className={cn(CLOSE, ON_NIGHT, "absolute end-4 top-4 z-10")}><X size={16} /></button>
      {catalog ? <DelioPlansScreen catalog={catalog} account={account} requiresAccount={!new URL(catalog.payUrl).searchParams.has("workspace")} />
        : <div className={SCREEN}>
          <Heading title={t("pro.name")} />
          {catalog === undefined
            ? <p role="status" className="flex items-center gap-2 text-[13px] text-ink-secondary"><Loader2 size={14} className="animate-spin motion-reduce:animate-none" aria-hidden="true" />{t("cloudAdd.checking")}</p>
            : <>
              <p role="alert" className="text-[14px] leading-relaxed text-ink">{t("delioPlans.unreachable")}</p>
              <div className="flex justify-end"><button type="button" className={QUIET} onClick={() => setAttempt(attempt + 1)}>{t("cloudAdd.tryAgain")}</button></div>
            </>}
        </div>}
    </div>
  </div>;
}
