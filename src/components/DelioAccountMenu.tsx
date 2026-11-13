import { ArrowLeftRight, Check, CreditCard, LogOut, UserRound } from "lucide-react";

import type { DelioAccount } from "@/lib/delio-account";
import { t } from "@/lib/i18n";
import type { SidebarMenuItem } from "./SidebarPopoverMenu";

const PLAN_NAMES: Record<string, string> = { starter: "Starter", pro: "Pro", max: "Max", byok: "BYOK" };

export function delioPlanLine(account: Extract<DelioAccount, { connected: true }>): string {
  if (account.checking || account.plan === undefined || account.credits === undefined) return t("delioMenu.checking");
  const credits = new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(account.credits ?? 0);
  if (!account.plan) return t("delioMenu.noPlan", { credits });
  const plan = account.plan === "trial" ? t("delioMenu.trial") : PLAN_NAMES[account.plan] ?? account.plan;
  return t("delioMenu.plan", { plan, credits });
}

/** The You menu's last rows: which Deliobot account this app uses, its plan and credits, and how to manage, switch or leave it. */
export function delioMenuItems(account: DelioAccount | null, actions: { signIn: () => void; manage: () => void; switchAccount: () => void; signOut: () => void }): SidebarMenuItem[] {
  if (!account) return [];
  if (!account.connected) return [{ key: "delio-sign-in", label: t("delioMenu.signIn"), icon: <UserRound size={18} />, onSelect: actions.signIn }];
  const who = account.email?.trim() || t("delioMenu.connected");
  return [
    { key: "delio-account", heading: t("delioMenu.heading"), label: who, title: who, subtitle: delioPlanLine(account), checked: true, icon: <Check size={18} />, onSelect: actions.manage },
    { key: "delio-manage", label: t("delioMenu.manage"), icon: <CreditCard size={18} />, onSelect: actions.manage },
    { key: "delio-switch", label: t("delioMenu.switch"), icon: <ArrowLeftRight size={18} />, onSelect: actions.switchAccount },
    { key: "delio-sign-out", label: t("delioMenu.signOut"), icon: <LogOut size={18} />, onSelect: actions.signOut },
  ];
}
