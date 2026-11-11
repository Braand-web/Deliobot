import { useState } from "react";
import { CloudUpload, KeyRound, Lock, Monitor, Moon, Smartphone, Sparkles, Timer, type LucideIcon } from "lucide-react";
import { delioCheckoutUrl, type DelioCatalog, type DelioPlan } from "../../../shared/delio-plans";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import type { LocaleKey } from "@/locales";
import { NightCard } from "./NightCard";
import { PRIMARY_WIDE, QUIET, QUIET_WIDE, SCREEN, Tag } from "./parts";

export type DelioCycle = "month" | "year";

const FEATURES: ReadonlyArray<readonly [LucideIcon, LocaleKey]> = [
  [Moon, "cloudBuy.benefit.awayTitle"],
  [Lock, "cloudBuy.benefit.privateTitle"],
  [Smartphone, "cloudBuy.benefit.anywhereTitle"],
  [Monitor, "cloudBuy.benefit.browserTitle"],
  [CloudUpload, "cloudBuy.benefit.moveTitle"],
];
const COLUMNS: Record<number, string> = { 1: "md:grid-cols-1", 2: "md:grid-cols-2", 3: "md:grid-cols-3", 4: "md:grid-cols-2 lg:grid-cols-4" };

export const dollars = (usd: number) => `$${usd.toLocaleString("en-US", { minimumFractionDigits: Number.isInteger(usd) ? 0 : 2, maximumFractionDigits: 2 })}`;
export const francs = (amount: number) => `≈ ${amount.toLocaleString("fr-FR")} FCFA`;


function PlanCard({ plan, cycle, popular, billingUrl }: { plan: DelioPlan; cycle: DelioCycle; popular: boolean; billingUrl: string }) {
  const yearly = cycle === "year" && plan.usdYear !== null && plan.francsYear !== null;
  const nameId = `delio-plan-${plan.id}`;
  const rows: Array<[LucideIcon, string]> = plan.gateway
    ? [[Sparkles, t("delioPlans.credits", { credits: plan.credits.toLocaleString() })],
      [Timer, t("delioPlans.hours", { hours: plan.computerHours })],
      [Monitor, plan.computers === 1 ? t("delioPlans.computer") : t("delioPlans.computers", { count: plan.computers })]]
    : [[KeyRound, t("delioPlans.byok.keys")], [Monitor, t("delioPlans.byok.computer")], [Sparkles, t("delioPlans.byok.all")]];
  return <li data-plan={plan.id} aria-labelledby={nameId}
    className={cn("flex min-w-0 flex-col gap-3 rounded-[12px] border-[0.5px] bg-menu p-4", popular ? "border-ink/25" : "border-ink/10")}>
    <div className="flex min-h-6 flex-wrap items-center justify-between gap-x-2 gap-y-1">
      <h4 id={nameId} className="text-[15px] font-medium leading-[22px] text-ink">{plan.name}</h4>
      {popular && <Tag data-plan-popular="">{t("cloudAdd.popular")}</Tag>}
    </div>
    <div className="flex flex-col">
      <p className="flex items-baseline gap-1">
        <span className="text-[28px] font-semibold leading-8 tracking-[-0.02em] tabular-nums text-ink">{dollars(yearly ? plan.usdYear! : plan.usd)}</span>
        <span className="text-[13px] text-ink-tertiary">{t(yearly ? "delioPlans.perYear" : "cloudBuy.perMonth")}</span>
      </p>
      <small data-plan-francs="" className="text-[12px] leading-4 tabular-nums text-ink-tertiary">{francs(yearly ? plan.francsYear! : plan.francs)}</small>
      {yearly && <small className="mt-1 text-[12px] leading-4 text-ink-secondary">{t("delioPlans.yearMonthly", { price: dollars(Math.round((plan.usdYear! / 12) * 100) / 100) })}</small>}
    </div>
    <ul className="flex flex-1 flex-col gap-2.5 pt-1">
      {rows.map(([Icon, text]) => <li key={text} className="grid grid-cols-[16px_minmax(0,1fr)] items-start gap-2.5 text-[13px] leading-[18px] text-ink">
        <Icon size={16} strokeWidth={1.5} aria-hidden="true" className="mt-px text-ink-tertiary" /><span>{text}</span>
      </li>)}
    </ul>
    <a data-plan-buy={plan.id} aria-describedby={nameId} className={cn(popular ? PRIMARY_WIDE : QUIET_WIDE, "text-center no-underline")} target="_blank" rel="noreferrer"
      href={delioCheckoutUrl(billingUrl, { plan: plan.id, cycle })}>{t("delioPlans.choose")}</a>
  </li>;
}

/** Delio's plans: Starter, Pro and Max, then BYOK and the top-ups that only the app shows. Prices in dollars, francs beneath. */
export function DelioPlansScreen({ catalog, initialCycle = "month" }: { catalog: DelioCatalog; initialCycle?: DelioCycle }) {
  const [cycle, setCycle] = useState<DelioCycle>(initialCycle);
  const trial = catalog.plans.find(plan => plan.id === "trial");
  const plans = [...catalog.plans.filter(plan => plan.id !== "trial" && plan.listed), ...catalog.plans.filter(plan => plan.id !== "trial" && !plan.listed)];
  const yearly = plans.some(plan => plan.usdYear !== null);
  return <div data-delio-plans="" className={SCREEN}>
    <div className="-mx-4 -mt-3">
      <NightCard>
        <h2 id="cloud-add-title" tabIndex={-1} className="text-[17px] font-medium leading-6 tracking-[-0.008em] outline-none!">{t("pro.name")}</h2>
        <p className="mt-0.5 max-w-[440px] text-[14px] leading-5 text-(--cloud-night-ink-quiet) [text-wrap:pretty]">
          <span className="font-medium text-(--cloud-night-ink)">{t("cloudBuy.title")}</span> {t("delioPlans.lede")}
        </p>
      </NightCard>
    </div>
    {yearly && <div role="radiogroup" aria-label={t("delioPlans.billing")} className="flex items-center gap-1 self-center rounded-full bg-ink/[0.05] p-1">
      {(["month", "year"] as const).map(value => <button key={value} type="button" role="radio" aria-checked={cycle === value} onClick={() => setCycle(value)}
        className={cn("rounded-full px-3.5 py-1.5 text-[13px] leading-[18px] transition-colors motion-reduce:transition-none",
          cycle === value ? "bg-app font-medium text-ink shadow-sm" : "text-ink-secondary hover:text-ink")}>
        {t(value === "month" ? "delioPlans.monthly" : "delioPlans.yearly")}
      </button>)}
    </div>}
    <section aria-labelledby="delio-plans-heading">
      <h3 id="delio-plans-heading" className="sr-only">{t("cloudBuy.choose")}</h3>
      <ul className={cn("grid gap-3", COLUMNS[plans.length] ?? "md:grid-cols-3")}>
        {plans.map(plan => <PlanCard key={plan.id} plan={plan} cycle={cycle} popular={plan.id === catalog.recommended} billingUrl={catalog.billingUrl} />)}
      </ul>
    </section>
    {trial && <div data-delio-trial="" className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-[12px] bg-ink/[0.04] px-4 py-3">
      <p className="min-w-0 flex-1 text-[13px] leading-[18px] text-ink">
        <b className="font-medium">{t("delioPlans.trial.title", { days: catalog.trialDays, price: dollars(trial.usd) })}</b>{" "}
        <span className="text-ink-tertiary">{francs(trial.francs)}</span>
        <span className="block text-ink-secondary">{t("delioPlans.trial.body", { credits: trial.credits.toLocaleString(), hours: trial.computerHours })}</span>
      </p>
      <a className={cn(QUIET, "no-underline")} target="_blank" rel="noreferrer" href={delioCheckoutUrl(catalog.billingUrl, { plan: trial.id })}>{t("delioPlans.trial.start")}</a>
    </div>}
    {catalog.topups.length > 0 && <section aria-labelledby="delio-topups" className="flex flex-col gap-2.5">
      <h3 id="delio-topups" className="text-[13px] font-medium leading-[18px] text-ink-secondary">{t("delioPlans.topups")}</h3>
      <ul className="flex flex-wrap gap-2">
        {catalog.topups.map(pack => <li key={pack.id}>
          <a data-delio-topup={pack.id} target="_blank" rel="noreferrer" href={delioCheckoutUrl(catalog.billingUrl, { topup: pack.id })}
            className="flex flex-col rounded-[10px] border-[0.5px] border-ink/15 px-3 py-2 text-[13px] leading-[18px] text-ink no-underline transition-colors hover:bg-ink/[0.04] motion-reduce:transition-none">
            <span>{t("delioPlans.topup", { credits: pack.credits.toLocaleString(), price: dollars(pack.usd) })}</span>
            <small className="text-[12px] leading-4 text-ink-tertiary">{francs(pack.francs)}</small>
          </a>
        </li>)}
      </ul>
      <p className="text-[12px] leading-4 text-ink-tertiary">{t("delioPlans.topupsNote")}</p>
    </section>}
    <section aria-labelledby="delio-includes" className="flex flex-col gap-2.5">
      <h3 id="delio-includes" className="text-[13px] font-medium leading-[18px] text-ink-secondary">{t("cloudBuy.includes")}</h3>
      <ul className="flex flex-wrap gap-x-5 gap-y-2">
        {FEATURES.map(([Icon, title]) => <li key={title} className="inline-flex items-center gap-1.5 text-[13px] leading-[18px] text-ink">
          <Icon size={16} strokeWidth={1.5} aria-hidden="true" className="shrink-0 text-ink-tertiary" />{t(title)}
        </li>)}
      </ul>
    </section>
    <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 border-t-[0.5px] border-ink/10 pt-4 text-[12px] leading-4 text-ink-tertiary">
      <span className="inline-flex items-center gap-1.5"><Lock size={13} strokeWidth={1.5} aria-hidden="true" />{t("delioPlans.secure")}</span>
      <span className="inline-flex gap-1">
        {[t("delioPlans.mobileMoney"), t("cloudBuy.card")].map(mark => <span key={mark}
          className="rounded-[6px] border-[0.5px] border-ink/20 px-1.5 py-px text-[11px] font-medium text-ink-secondary">{mark}</span>)}
      </span>
      <span aria-hidden="true">·</span><span>{t("delioPlans.prepaid")}</span>
    </div>
  </div>;
}
