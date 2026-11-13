import { Lock } from "lucide-react";

import { ownAiLocked, useDelioAccount } from "@/lib/delio-account";
import { t } from "@/lib/i18n";
import { useStore } from "@/state/store";

/** Stands in for the person's own AI (their keys, their Claude, ChatGPT or other sign-ins) on plans that do not include it. */
export function OwnAiLocked() {
  const { dispatch } = useStore();
  return (
    <section data-own-ai-locked className="flex items-center gap-3 rounded-xl bg-card px-4 py-3">
      <Lock size={15} aria-hidden="true" className="shrink-0 text-ink-secondary" />
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="text-[14px] font-medium leading-5 text-ink">{t("ownAi.locked.title")}</span>
        <span className="text-[13px] leading-[18px] text-ink-secondary">{t("ownAi.locked.body")}</span>
      </span>
      <button type="button" className="ui-button shrink-0" onClick={() => dispatch({ type: "openCloudAdd", source: "app_settings" })}>
        {t("ownAi.locked.action")}
      </button>
    </section>
  );
}

/** Whether this app's plan leaves out the customer's own AI. */
export function useOwnAiLocked(): boolean {
  return ownAiLocked(useDelioAccount());
}

/** The model picker's row in place of local models and API keys, on plans without the customer's own AI. */
export function OwnAiLockedRow({ onOpen }: { onOpen: () => void }) {
  return (
    <button type="button" data-own-ai-locked onClick={onOpen}
      className="flex w-full shrink-0 items-start gap-2.5 border-t-[0.5px] border-ink/10 px-3.5 py-2.5 text-left hover:bg-ink/[0.06]">
      <Lock size={14} aria-hidden="true" className="mt-0.5 shrink-0 text-ink-secondary" />
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className="text-[13px] leading-[18px] text-ink">{t("ownAi.locked.title")}</span>
        <span className="text-[12px] leading-4 text-ink-secondary">{t("ownAi.locked.body")}</span>
        <span className="text-[12px] leading-4 text-accent">{t("ownAi.locked.action")}</span>
      </span>
    </button>
  );
}
