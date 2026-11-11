// Plans and payments. SasPay takes one-off payments (mobile money cannot be charged again without the payer), so a plan
// is a prepaid 30-day period: paying grants its credits and moves the end date; a reminder with a payment link goes out
// before it ends; after a short grace the gateway stops spending Delio credits for the workspace.
import type { DatabaseSync } from "node:sqlite";

import type { SasPay } from "./saspay.ts";
import { token } from "./store.ts";
import { MICRO, type Wallet } from "./wallet.ts";

export type PlanId = "trial" | "pro" | "byok" | "business";

export interface Plan {
  id: PlanId;
  name: string;
  /** Price in euros, per seat for a monthly plan; the whole trial otherwise. */
  eur: number;
  days: number;
  /** Credits granted per seat for each period. */
  credits: number;
  perSeat: boolean;
  /** Cloud computers awake at once. */
  computers: number;
  /** Whether the workspace spends Delio credits through the gateway; BYOK uses its own keys. */
  gateway: boolean;
}

export const PLANS: Record<PlanId, Plan> = {
  trial: { id: "trial", name: "Trial", eur: 1, days: 3, credits: 100, perSeat: false, computers: 0, gateway: true },
  pro: { id: "pro", name: "Pro", eur: 25, days: 30, credits: 2000, perSeat: true, computers: 1, gateway: true },
  byok: { id: "byok", name: "Pro BYOK", eur: 12, days: 30, credits: 0, perSeat: true, computers: 1, gateway: false },
  business: { id: "business", name: "Business", eur: 59, days: 30, credits: 6000, perSeat: true, computers: 5, gateway: true },
};

export const TOPUPS = [
  { id: "small", credits: 5000, eur: 20 },
  { id: "large", credits: 15000, eur: 50 },
] as const;
export type TopupId = (typeof TOPUPS)[number]["id"];

/** XOF and XAF are pegged to the euro at exactly 655.957; USD needs a configured rate. */
export const EUR_RATES: Record<string, number> = { XOF: 655.957, XAF: 655.957 };
const ZERO_DECIMALS = new Set(["XOF", "XAF"]);
export const GRACE_MS = 7 * 24 * 60 * 60_000;
const REMIND_BEFORE_MS = 3 * 24 * 60 * 60_000;
const DAY_MS = 24 * 60 * 60_000;

export type SubscriptionStatus = "none" | "trialing" | "active" | "grace" | "expired";
export interface Subscription { workspace: string; plan: PlanId; seats: number; periodEnd: number; status: SubscriptionStatus }
export interface Order {
  id: string; workspace: string; email: string; kind: "plan" | "topup"; plan: PlanId | null; seats: number; credits: number;
  eur: number; amount: string; currency: string; sessionId: string | null; checkoutUrl: string | null; status: "pending" | "paid" | "failed"; createdAt: number;
}

export function priceIn(eur: number, currency: string, usdPerEur?: number): string {
  const rate = EUR_RATES[currency] ?? (currency === "USD" ? usdPerEur : undefined) ?? (currency === "EUR" ? 1 : undefined);
  if (!rate) throw new Error(`No euro rate for ${currency}`);
  const amount = eur * rate;
  return ZERO_DECIMALS.has(currency) ? `${Math.ceil(amount)}.00` : (Math.ceil(amount * 100) / 100).toFixed(2);
}

export class Billing {
  private readonly db: DatabaseSync;
  private readonly wallet: Wallet;
  private readonly now: () => number;

  constructor(wallet: Wallet, now: () => number = Date.now) {
    this.wallet = wallet;
    this.db = wallet.db;
    this.now = now;
    this.db.exec(`
CREATE TABLE IF NOT EXISTS subscriptions (workspace TEXT PRIMARY KEY REFERENCES workspaces(slug) ON DELETE CASCADE, plan TEXT NOT NULL, seats INTEGER NOT NULL,
  period_end INTEGER NOT NULL, reminded INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS orders (id TEXT PRIMARY KEY, workspace TEXT NOT NULL, email TEXT NOT NULL, kind TEXT NOT NULL, plan TEXT, seats INTEGER NOT NULL,
  credits INTEGER NOT NULL, eur REAL NOT NULL, amount TEXT NOT NULL, currency TEXT NOT NULL, session_id TEXT, checkout_url TEXT, status TEXT NOT NULL,
  created_at INTEGER NOT NULL, paid_at INTEGER);
CREATE INDEX IF NOT EXISTS orders_status ON orders (status, created_at);
CREATE TABLE IF NOT EXISTS trial_uses (email TEXT PRIMARY KEY, workspace TEXT NOT NULL, at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS payment_events (id TEXT PRIMARY KEY, at INTEGER NOT NULL);`);
  }

  subscription(workspace: string): Subscription {
    const row = this.db.prepare("SELECT plan, seats, period_end FROM subscriptions WHERE workspace = ?").get(workspace) as { plan: PlanId; seats: number; period_end: number } | undefined;
    if (!row) return { workspace, plan: "trial", seats: 0, periodEnd: 0, status: "none" };
    const at = this.now();
    const status: SubscriptionStatus = at < row.period_end ? (row.plan === "trial" ? "trialing" : "active") : at < row.period_end + GRACE_MS && row.plan !== "trial" ? "grace" : "expired";
    return { workspace, plan: row.plan, seats: row.seats, periodEnd: row.period_end, status };
  }

  /** What the gateway may do for a workspace: spend Delio credits, and keep how many computers awake. */
  allowance(workspace: string): { gateway: boolean; computers: number; reason?: string } {
    const subscription = this.subscription(workspace);
    if (subscription.status === "none") return { gateway: true, computers: 1 };
    if (subscription.status === "expired") return { gateway: false, computers: 0, reason: "This workspace's plan has ended. An admin can renew it in Delio Admin → Billing." };
    const plan = PLANS[subscription.plan];
    if (!plan.gateway) return { gateway: false, computers: 0, reason: "This workspace's plan uses its own AI keys, not Delio credits." };
    return { gateway: true, computers: plan.computers };
  }

  trialUsed(email: string, workspace: string): boolean {
    return Boolean(this.db.prepare("SELECT 1 FROM trial_uses WHERE email = ? OR workspace = ?").get(email, workspace));
  }

  createOrder(input: { workspace: string; email: string; kind: "plan"; plan: PlanId; seats: number } | { workspace: string; email: string; kind: "topup"; topup: TopupId },
    currency: string, usdPerEur?: number): Order {
    const id = `ord_${token(12)}`;
    let plan: PlanId | null = null, seats = 1, credits: number, eur: number;
    if (input.kind === "plan") {
      plan = input.plan;
      const spec = PLANS[plan];
      seats = spec.perSeat ? Math.max(1, Math.min(500, Math.floor(input.seats))) : 1;
      credits = spec.credits * (spec.perSeat ? seats : 1);
      eur = spec.eur * (spec.perSeat ? seats : 1);
    } else {
      const pack = TOPUPS.find((item) => item.id === input.topup)!;
      credits = pack.credits;
      eur = pack.eur;
    }
    const amount = priceIn(eur, currency, usdPerEur);
    this.db.prepare("INSERT INTO orders (id, workspace, email, kind, plan, seats, credits, eur, amount, currency, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)")
      .run(id, input.workspace, input.email, input.kind, plan, seats, credits, eur, amount, currency, this.now());
    return this.order(id)!;
  }

  attachSession(orderId: string, sessionId: string, checkoutUrl: string): void {
    this.db.prepare("UPDATE orders SET session_id = ?, checkout_url = ? WHERE id = ?").run(sessionId, checkoutUrl, orderId);
  }

  order(id: string): Order | null {
    const row = this.db.prepare(`SELECT id, workspace, email, kind, plan, seats, credits, eur, amount, currency, session_id AS sessionId, checkout_url AS checkoutUrl,
      status, created_at AS createdAt FROM orders WHERE id = ?`).get(id) as Order | undefined;
    return row ?? null;
  }

  orders(workspace: string, limit = 20): Order[] {
    return this.db.prepare(`SELECT id, workspace, email, kind, plan, seats, credits, eur, amount, currency, session_id AS sessionId, checkout_url AS checkoutUrl,
      status, created_at AS createdAt FROM orders WHERE workspace = ? ORDER BY created_at DESC LIMIT ?`).all(workspace, limit) as unknown as Order[];
  }

  /** Pending orders worth asking SasPay about: those with a session, from the last two days. */
  pending(): Order[] {
    return this.db.prepare(`SELECT id, workspace, email, kind, plan, seats, credits, eur, amount, currency, session_id AS sessionId, checkout_url AS checkoutUrl,
      status, created_at AS createdAt FROM orders WHERE status = 'pending' AND session_id IS NOT NULL AND created_at > ?`).all(this.now() - 2 * DAY_MS) as unknown as Order[];
  }

  /** Applies a paid order once: credits, and for a plan its period. A repeated confirmation changes nothing. */
  fulfil(orderId: string): boolean {
    const order = this.order(orderId);
    if (!order || order.status !== "pending") return false;
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const claimed = this.db.prepare("UPDATE orders SET status = 'paid', paid_at = ? WHERE id = ? AND status = 'pending'").run(this.now(), orderId);
      if (Number(claimed.changes) !== 1) { this.db.exec("ROLLBACK"); return false; }
      if (order.kind === "plan" && order.plan) {
        const spec = PLANS[order.plan];
        const current = this.subscription(order.workspace);
        const continuing = current.plan === order.plan && (current.status === "active" || current.status === "grace" || current.status === "trialing");
        const start = continuing ? Math.max(this.now(), current.periodEnd) : this.now();
        this.db.prepare(`INSERT INTO subscriptions (workspace, plan, seats, period_end, reminded) VALUES (?, ?, ?, ?, 0)
          ON CONFLICT (workspace) DO UPDATE SET plan = excluded.plan, seats = excluded.seats, period_end = excluded.period_end, reminded = 0`)
          .run(order.workspace, order.plan, order.seats, start + spec.days * DAY_MS);
        if (order.plan === "trial") this.db.prepare("INSERT INTO trial_uses (email, workspace, at) VALUES (?, ?, ?) ON CONFLICT DO NOTHING").run(order.email, order.workspace, this.now());
      }
      if (order.credits > 0) this.wallet.credit(order.workspace, order.credits * MICRO, order.kind === "plan" ? "grant" : "topup", `${order.kind === "plan" ? PLANS[order.plan!].name : "Top-up"} · ${order.id}`);
      this.db.exec("COMMIT");
      return true;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  markFailed(orderId: string): void {
    this.db.prepare("UPDATE orders SET status = 'failed' WHERE id = ? AND status = 'pending'").run(orderId);
  }

  /** Records a payment event once; false when it was already seen. */
  firstSeen(eventId: string): boolean {
    return Number(this.db.prepare("INSERT INTO payment_events (id, at) VALUES (?, ?) ON CONFLICT DO NOTHING").run(eventId, this.now()).changes) === 1;
  }

  /** Workspaces whose period ends within three days and were not reminded yet; each is reminded once per period. */
  dueReminders(): Array<{ workspace: string; plan: PlanId; periodEnd: number }> {
    const rows = this.db.prepare("SELECT workspace, plan, period_end FROM subscriptions WHERE reminded = 0 AND plan != 'trial' AND period_end - ? < ?")
      .all(this.now(), REMIND_BEFORE_MS) as Array<{ workspace: string; plan: PlanId; period_end: number }>;
    for (const row of rows) this.db.prepare("UPDATE subscriptions SET reminded = 1 WHERE workspace = ?").run(row.workspace);
    return rows.map((row) => ({ workspace: row.workspace, plan: row.plan, periodEnd: row.period_end }));
  }
}

/** Asks SasPay about pending orders and applies those it reports paid; the webhook and the return page both call it. */
export async function reconcileOrders(billing: Billing, saspay: SasPay, only?: string): Promise<string[]> {
  const fulfilled: string[] = [];
  for (const order of billing.pending()) {
    if (only && order.id !== only) continue;
    let status: string;
    try { status = await saspay.sessionStatus(order.sessionId!); } catch { continue; }
    if (status === "PAID" && billing.fulfil(order.id)) fulfilled.push(order.id);
    else if (status === "FAILED" || status === "CANCELLED" || status === "EXPIRED") billing.markFailed(order.id);
  }
  return fulfilled;
}
