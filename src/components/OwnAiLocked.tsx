import { Lock } from "lucide-react";

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
