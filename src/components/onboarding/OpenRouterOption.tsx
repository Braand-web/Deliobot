import type { ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { LinkButton } from "../NoticeCard";
import { PresetProviderMark } from "../ProviderIcons";

export const OPENROUTER_KEYS_URL = "https://openrouter.ai/keys";

const GET_KEY_LINK = "inline-flex shrink-0 items-center gap-1 text-[12px] font-medium text-accent-text hover:underline";

/** The first run's row for OpenRouter, among the other ways to connect an AI; `children` is its key field. */
export function OpenRouterOption({ open, onToggle, children }: { open: boolean; onToggle: () => void; children?: ReactNode }) {
  const name = <>
    <span className="flex size-[18px] shrink-0 items-center justify-center"><PresetProviderMark preset="openrouter" size={18} /></span>
    <span className="min-w-0 flex-1">
      <span className="block truncate text-[14px] text-ink">{t("openrouterOption.name")}</span>
      <span className="block truncate text-[12px] leading-4 text-ink-secondary">{t("openrouterOption.line")}</span>
    </span>
  </>;
  return <div data-openrouter-option="">
    <div className="flex items-center gap-2 pr-4 transition-colors hover:bg-ink/[0.04]">
      {children ? <button type="button" aria-expanded={open} onClick={onToggle}
        className="flex min-w-0 flex-1 items-center gap-3 py-2.5 pl-4 text-left focus-visible:outline-offset-[-2px]">
        {name}
        <ChevronDown size={14} className={cn("shrink-0 text-ink-secondary transition-transform duration-200", open && "rotate-180")} />
      </button> : <div className="flex min-w-0 flex-1 items-center gap-3 py-2.5 pl-4">{name}</div>}
      <LinkButton url={OPENROUTER_KEYS_URL} label={t("openrouterOption.link")} className={GET_KEY_LINK} />
    </div>
    {open && children}
  </div>;
}
