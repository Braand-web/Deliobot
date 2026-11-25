import { useEffect, useState } from "react";
import type { CloudAccountState, CloudPlanSnapshot } from "../../../electron/cloud-account.mjs";
import { cloudPlanLabel, cloudPlanView } from "@/lib/cloud-plan";
import { t } from "@/lib/i18n";
import { useDelioAccount, type DelioAccount } from "@/lib/delio-account";
import { profileForSession, type SessionState } from "@/lib/session";
import { readSharedSessionState } from "@/lib/shared-session";
import { useStoreSelector } from "@/state/store-select";

export interface AccountSummary {
  /** read from the account bridge, the plan bridge or the server session; null until it answers */
  signedIn: boolean | null;
  email: string | null;
  /** "Pro", "Free"; null where this page can't read the plan */
  plan: string | null;
  paid: boolean;
}

function fromAccount(account: CloudAccountState | null): AccountSummary {
  const view = cloudPlanView(account);
  if (!account || view.kind === "unknown") return { signedIn: null, email: null, plan: null, paid: false };
  const signedIn = ["connected", "unavailable", "reauth-required"].includes(account.status);
  const email = signedIn && "account" in account ? account.account?.email ?? null : null;
  const plan = view.kind === "paid" ? view.label : view.kind === "free" ? t("settings.account.free") : signedIn ? null : null;
  return { signedIn, email, plan, paid: view.kind === "paid" };
}

function fromPlan(plan: CloudPlanSnapshot | null): AccountSummary {
  if (!plan) return { signedIn: null, email: null, plan: null, paid: false };
  const paid = plan.status === "paid";
  return { signedIn: plan.status !== "none" && plan.status !== "signin", email: null, plan: paid ? cloudPlanLabel(plan.tier) : null, paid };
}

const PLAN_NAMES: Record<string, string> = { starter: "Starter", pro: "Pro", max: "Max", byok: "BYOK" };

/** The Deliobot account this app is connected to, as the summary reads it. */
export function fromDelio(account: DelioAccount): AccountSummary {
  if (!account.connected) return { signedIn: false, email: null, plan: null, paid: false };
  const plan = account.plan === "trial" ? t("delioMenu.trial") : account.plan ? PLAN_NAMES[account.plan] ?? account.plan : null;
  return { signedIn: true, email: account.email ?? null, plan, paid: Boolean(account.plan) };
}

/** Who is signed in to Delio on this device, as far as this page may know: the Deliobot account first. */
export function useAccountSummary(): AccountSummary {
  const delio = useDelioAccount();
  const cloud = useCloudAccountSummary();
  return delio ? fromDelio(delio) : cloud;
}

function useCloudAccountSummary(): AccountSummary {
  const account = typeof window === "undefined" || window.odb?.remoteClient?.active ? undefined : window.odb?.cloudAccount;
  const planBridge = account ? undefined : typeof window === "undefined" ? undefined : window.odb?.cloudPlan;
  const [summary, setSummary] = useState<AccountSummary>({ signedIn: null, email: null, plan: null, paid: false });
  useEffect(() => {
    let alive = true;
    if (account) {
      const off = account.onState((next) => { if (alive) setSummary(fromAccount(next)); });
      void account.state().then((next) => { if (alive) setSummary(fromAccount(next)); }).catch(() => {});
      return () => { alive = false; off(); };
    }
    if (planBridge) {
      void planBridge.state().then((next) => { if (alive) setSummary(fromPlan(next)); }).catch(() => {});
      return () => { alive = false; };
    }
    return () => { alive = false; };
  }, [account, planBridge]);
  return summary;
}

/** The name and photo the chrome shows for you, and the server session they came from. */
export function useYou(): { profile: { name?: string; email?: string; avatarUrl?: string } | undefined; session: SessionState | null } {
  const profile = useStoreSelector((state) => state.config?.profile);
  const [session, setSession] = useState<SessionState | null>(null);
  useEffect(() => {
    let alive = true;
    void readSharedSessionState().then((next) => { if (alive) setSession(next); });
    return () => { alive = false; };
  }, []);
  return { profile: profileForSession(profile, session), session };
}

/** "Pro · ada@example.com", "Not signed in"; in a browser, "Signed in to My Cloud". */
export function accountLine(summary: AccountSummary, { browser, place, openSource }: { browser: boolean; place: string; openSource: boolean }): string {
  if (browser) return t("settings.account.signedInTo", { place });
  if (openSource) return t("settings.account.onThisDevice");
  if (summary.signedIn === false) return t("settings.account.notSignedIn");
  return [summary.plan, summary.email].filter(Boolean).join(" · ") || t("settings.account.signedIn");
}
