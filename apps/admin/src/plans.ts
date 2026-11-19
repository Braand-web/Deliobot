// Plans and payments. SasPay takes one-off payments (mobile money cannot be charged again without the payer), so a plan
// is a prepaid period, a month or a year: paying grants the first month's credits and moves the end date, a yearly plan
// grants the next months' credits every 30 days; a reminder with a payment link goes out before the period ends; after
// a short grace the gateway stops spending Deliobot credits for the workspace.
import type { OperatorSettings } from "./operator-settings.ts";
import type { SqlDatabase } from "./sql.ts";

import { discounted } from "./promos.ts";
import type { SasPay } from "./saspay.ts";
import { token } from "./store.ts";
import { MICRO, type Wallet } from "./wallet.ts";

export type PlanId = "trial" | "starter" | "pro" | "max" | "byok";
export type Cycle = "month" | "year";

export interface Plan {
  id: PlanId;
  name: string;
  /** Price in US dollars of one month, or of the whole trial. */
  usd: number;
  /** Price of a year paid at once; null when the plan is not sold by the year. */
  usdYear: number | null;
  /** Credits granted each month, or for the whole trial. */
  credits: number;
  /** Cloud computer hours included each month before awake minutes are paid in credits. */
  computerHours: number;
  /** Cloud computers awake at once. */
  computers: number;
  /** Whether the workspace spends Deliobot credits through the gateway; BYOK uses its own keys. */
  gateway: boolean;
  /** Shown on the public site; the others only to signed-in admins. */
  listed: boolean;
}

export const PLANS: Record<PlanId, Plan> = {
  trial: { id: "trial", name: "Trial", usd: 5, usdYear: null, credits: 300, computerHours: 3, computers: 1, gateway: true, listed: false },
  starter: { id: "starter", name: "Starter", usd: 15, usdYear: 165, credits: 1300, computerHours: 15, computers: 1, gateway: true, listed: true },
  pro: { id: "pro", name: "Pro", usd: 49, usdYear: 539, credits: 5500, computerHours: 90, computers: 2, gateway: true, listed: true },
  max: { id: "max", name: "Max", usd: 99, usdYear: 1089, credits: 13500, computerHours: 180, computers: 5, gateway: true, listed: true },
  byok: { id: "byok", name: "BYOK", usd: 12, usdYear: 132, credits: 0, computerHours: 0, computers: 0, gateway: false, listed: false },
};
/** The plans whose apps may also run on the customer's own AI: their keys and their Claude, ChatGPT or other sign-ins. */
export const OWN_AI_PLANS: ReadonlySet<PlanId> = new Set<PlanId>(["max", "byok"]);

export const TRIAL_DAYS = 3;
/** Orders an operator granted; they cost nothing and count in no revenue. */
export const MANUAL_ORDER_PREFIX = "man_";
export const RECOMMENDED: PlanId = "pro";

export const TOPUPS = [
  { id: "small", credits: 4500, usd: 20 },
  { id: "large", credits: 13500, usd: 50 },
] as const;
export type TopupId = (typeof TOPUPS)[number]["id"];

/** A rough franc rate for a dollar when the operator sets none; the real one follows the euro, to which the franc is pegged. */
export const DEFAULT_XOF_PER_USD = 600;
const FRANCS = new Set(["XOF", "XAF"]);
/** How long a checkout may still be paid: mobile money can confirm days after the person approved it. */
export const PAYMENT_WINDOW_DAYS = 14;
export const GRACE_MS = 7 * 24 * 60 * 60_000;
const REMIND_BEFORE_MS = 3 * 24 * 60 * 60_000;
const DAY_MS = 24 * 60 * 60_000;
const MONTH_MS = 30 * DAY_MS;
const YEAR_MONTHS = 12;

export function periodMs(plan: PlanId, cycle: Cycle): number {
  return plan === "trial" ? TRIAL_DAYS * DAY_MS : cycle === "year" ? YEAR_MONTHS * MONTH_MS : MONTH_MS;
}

export function planUsd(plan: PlanId, cycle: Cycle): number {
  const spec = PLANS[plan];
  return cycle === "year" && spec.usdYear !== null ? spec.usdYear : spec.usd;
}

export type SubscriptionStatus = "none" | "trialing" | "active" | "grace" | "expired";
export interface Subscription { workspace: string; plan: PlanId; cycle: Cycle; periodEnd: number; status: SubscriptionStatus }
export interface Order {
  id: string; workspace: string; email: string; kind: "plan" | "topup"; plan: PlanId | null; cycle: Cycle; credits: number;
  usd: number; amount: string; currency: string; sessionId: string | null; checkoutUrl: string | null; status: "pending" | "paid" | "failed" | "refunded"; createdAt: number;
  /** The promo code whose percentage was taken off, if any. */
  promo?: string | null;
}

/** A dollar price in the currency SasPay charges: francs rounded up to a whole franc, dollars to the cent. */
export function priceIn(usd: number, currency: string, xofPerUsd = DEFAULT_XOF_PER_USD): string {
  if (FRANCS.has(currency)) return `${Math.ceil(usd * xofPerUsd)}.00`;
  if (currency === "USD") return (Math.ceil(usd * 100) / 100).toFixed(2);
  throw new Error(`No dollar rate for ${currency}`);
}

export interface Catalog {
  currency: string;
  trialDays: number;
  recommended: PlanId;
  plans: Array<Plan & { francs: number; francsYear: number | null }>;
  topups: Array<{ id: TopupId; credits: number; usd: number; francs: number }>;
}

/** The plans and top-ups as the site and the apps show them: dollars, with the francs a payer is charged. */
export function catalog(xofPerUsd = DEFAULT_XOF_PER_USD, plans: Record<PlanId, Plan> = PLANS): Catalog {
  const francs = (usd: number) => Math.ceil(usd * xofPerUsd);
  return {
    currency: "USD", trialDays: TRIAL_DAYS, recommended: RECOMMENDED,
    plans: Object.values(plans).map((plan) => ({ ...plan, francs: francs(plan.usd), francsYear: plan.usdYear === null ? null : francs(plan.usdYear) })),
    topups: TOPUPS.map((pack) => ({ ...pack, francs: francs(pack.usd) })),
  };
}

const ORDER_COLUMNS = `id, workspace, email, kind, plan, cycle, credits, usd, amount, currency, session_id AS sessionId, checkout_url AS checkoutUrl, status, created_at AS createdAt, promo`;

export class Billing {
  private readonly db: SqlDatabase;
  private readonly wallet: Wallet;
  private readonly now: () => number;
  private readonly settings: OperatorSettings | null;
  private paidListeners: Array<(order: Order) => void> = [];

  constructor(wallet: Wallet, now: () => number = Date.now, settings: OperatorSettings | null = null) {
    this.wallet = wallet;
    this.db = wallet.db;
    this.now = now;
    this.settings = settings;
    this.db.exec(`
CREATE TABLE IF NOT EXISTS subscriptions (workspace TEXT PRIMARY KEY REFERENCES workspaces(slug) ON DELETE CASCADE, plan TEXT NOT NULL, cycle TEXT NOT NULL,
  period_end INTEGER NOT NULL, reminded INTEGER NOT NULL DEFAULT 0, monthly_credits INTEGER NOT NULL, next_grant_at INTEGER, grants_left INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS orders (id TEXT PRIMARY KEY, workspace TEXT NOT NULL, email TEXT NOT NULL, kind TEXT NOT NULL, plan TEXT, cycle TEXT NOT NULL,
  credits INTEGER NOT NULL, usd REAL NOT NULL, amount TEXT NOT NULL, currency TEXT NOT NULL, session_id TEXT, checkout_url TEXT, status TEXT NOT NULL,
  created_at INTEGER NOT NULL, paid_at INTEGER);
CREATE INDEX IF NOT EXISTS orders_status ON orders (status, created_at);
CREATE TABLE IF NOT EXISTS trial_uses (email TEXT PRIMARY KEY, workspace TEXT NOT NULL, at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS payment_events (id TEXT PRIMARY KEY, at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS queued_plans (order_id TEXT PRIMARY KEY, workspace TEXT NOT NULL, at INTEGER NOT NULL);`);
    try { this.db.prepare("SELECT promo FROM orders LIMIT 0").all(); } catch { this.db.exec("ALTER TABLE orders ADD COLUMN promo TEXT"); }
  }

  /** Tells `listener` of every order the moment it is applied as paid, inside the same transaction. */
  onPaid(listener: (order: Order) => void): void {
    this.paidListeners.push(listener);
  }

  /** The plan as sold now, with the operator's prices and allowances. */
  plan(id: PlanId): Plan {
    return this.settings?.plan(id) ?? PLANS[id];
  }

  planUsd(id: PlanId, cycle: Cycle): number {
    const spec = this.plan(id);
    return cycle === "year" && spec.usdYear !== null ? spec.usdYear : spec.usd;
  }

  catalog(xofPerUsd?: number): Catalog {
    return catalog(this.settings?.xofPerUsd() ?? xofPerUsd, this.settings?.plans() ?? PLANS);
  }

  subscription(workspace: string): Subscription {
    const row = this.db.prepare("SELECT plan, cycle, period_end FROM subscriptions WHERE workspace = ?").get(workspace) as { plan: PlanId; cycle: Cycle; period_end: number } | undefined;
    if (!row || !Object.hasOwn(PLANS, row.plan)) return { workspace, plan: "trial", cycle: "month", periodEnd: 0, status: "none" };
    const at = this.now();
    const status: SubscriptionStatus = at < row.period_end ? (row.plan === "trial" ? "trialing" : "active") : at < row.period_end + GRACE_MS && row.plan !== "trial" ? "grace" : "expired";
    return { workspace, plan: row.plan, cycle: row.cycle, periodEnd: row.period_end, status };
  }

  /** What the gateway may do for a workspace: spend Deliobot credits on text (`gateway`) and on media (`media`: images, video, music,
   * voice; every plan in force, those on their own AI included), keep how many computers awake, with how many free hours a month. */
  allowance(workspace: string): { gateway: boolean; media: boolean; computers: number; computerHours: number; plan: PlanId | null; ownAi: boolean; reason?: string } {
    if (this.db.prepare("SELECT 1 FROM suspensions WHERE workspace = ?").get(workspace)) {
      return { gateway: false, media: false, computers: 0, computerHours: 0, plan: null, ownAi: false, reason: "Cet espace est suspendu. Écrivez à support@deliobot.fun." };
    }
    const subscription = this.subscription(workspace);
    if (subscription.status === "none") return { gateway: true, media: true, computers: 1, computerHours: 0, plan: null, ownAi: false };
    if (subscription.status === "expired") return { gateway: false, media: false, computers: 0, computerHours: 0, plan: null, ownAi: false, reason: "This workspace's plan has ended. An admin can renew it in Deliobot Admin → Billing." };
    const plan = this.plan(subscription.plan);
    const ownAi = OWN_AI_PLANS.has(subscription.plan);
    if (!plan.gateway) return { gateway: false, media: true, computers: 0, computerHours: 0, plan: subscription.plan, ownAi, reason: "This workspace's plan uses its own AI keys for text, not Deliobot credits." };
    return { gateway: true, media: true, computers: plan.computers, computerHours: plan.computerHours, plan: subscription.plan, ownAi };
  }

  /** A trial used, or one already waiting to be paid, by this address or for this workspace. */
  trialUsed(email: string, workspace: string): boolean {
    return Boolean(this.db.prepare("SELECT 1 FROM trial_uses WHERE email = ? OR workspace = ?").get(email, workspace)
      ?? this.db.prepare("SELECT 1 FROM orders WHERE plan = 'trial' AND status = 'pending' AND (email = ? OR workspace = ?)").get(email, workspace));
  }

  /** `promo` takes its percentage off a plan's price. */
  createOrder(input: { workspace: string; email: string; kind: "plan"; plan: PlanId; cycle: Cycle; promo?: { code: string; percent: number } } | { workspace: string; email: string; kind: "topup"; topup: TopupId },
    currency: string, xofPerUsd?: number): Order {
    const id = `ord_${token(12)}`;
    let plan: PlanId | null = null, cycle: Cycle = "month", credits: number, usd: number;
    if (input.kind === "plan") {
      plan = input.plan;
      cycle = input.cycle === "year" && this.plan(plan).usdYear !== null ? "year" : "month";
      credits = this.plan(plan).credits;
      usd = this.planUsd(plan, cycle);
      if (input.promo) usd = discounted(usd, input.promo.percent);
    } else {
      const pack = TOPUPS.find((item) => item.id === input.topup)!;
      credits = pack.credits;
      usd = pack.usd;
    }
    const amount = priceIn(usd, currency, this.settings?.xofPerUsd() ?? xofPerUsd);
    const promo = input.kind === "plan" ? input.promo?.code ?? null : null;
    this.db.prepare("INSERT INTO orders (id, workspace, email, kind, plan, cycle, credits, usd, amount, currency, status, created_at, promo) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)")
      .run(id, input.workspace, input.email, input.kind, plan, cycle, credits, usd, amount, currency, this.now(), promo);
    return this.order(id)!;
  }

  attachSession(orderId: string, sessionId: string, checkoutUrl: string): void {
    this.db.prepare("UPDATE orders SET session_id = ?, checkout_url = ? WHERE id = ?").run(sessionId, checkoutUrl, orderId);
  }

  order(id: string): Order | null {
    const row = this.db.prepare(`SELECT ${ORDER_COLUMNS} FROM orders WHERE id = ?`).get(id) as Order | undefined;
    return row ?? null;
  }

  orders(workspace: string, limit = 20): Order[] {
    return this.db.prepare(`SELECT ${ORDER_COLUMNS} FROM orders WHERE workspace = ? ORDER BY created_at DESC LIMIT ?`).all(workspace, limit) as unknown as Order[];
  }

  paidCount(workspace: string): number {
    return (this.db.prepare("SELECT COUNT(*) AS count FROM orders WHERE workspace = ? AND status = 'paid'").get(workspace) as { count: number }).count;
  }

  /** Pending orders worth asking SasPay about: those with a session, from the last two days. */
  /** Pending orders worth asking SasPay about, newest first: those with a session from the last `days` days. */
  pending(days = 2): Order[] {
    return this.db.prepare(`SELECT ${ORDER_COLUMNS} FROM orders WHERE status = 'pending' AND session_id IS NOT NULL AND created_at > ? ORDER BY created_at DESC`).all(this.now() - days * DAY_MS) as unknown as Order[];
  }

  /** Orders nobody paid within `PAYMENT_WINDOW_DAYS` are failed, so they stop waiting and stop being asked about. */
  expireStale(): number {
    return Number(this.db.prepare("UPDATE orders SET status = 'failed' WHERE status = 'pending' AND created_at <= ?").run(this.now() - PAYMENT_WINDOW_DAYS * DAY_MS).changes);
  }

  /** Applies a paid order once: credits, and for a plan its period. A repeated confirmation changes nothing. */
  fulfil(orderId: string): boolean {
    const order = this.order(orderId);
    if (!order || order.status !== "pending") return false;
    return this.db.transaction(() => {
      const claimed = this.db.prepare("UPDATE orders SET status = 'paid', paid_at = ? WHERE id = ? AND status = 'pending'").run(this.now(), orderId);
      if (Number(claimed.changes) !== 1) return false;
      if (order.kind === "plan" && order.plan) this.startPeriod(order);
      else if (order.credits > 0) this.wallet.credit(order.workspace, order.credits * MICRO, "topup", `Top-up · ${order.id}`);
      for (const listener of this.paidListeners) listener(order);
      return true;
    });
  }

  /** A plan's period starts now, or after the current one when the same plan is renewed early; a month's credits come at its start. */
  /** When a paid order for a different plan or cycle starts: now, or once the paid plan running today ends (it is never cut short). */
  startsAt(workspace: string, plan: PlanId, cycle: Cycle): number {
    const current = this.subscription(workspace);
    const queued = this.db.prepare("SELECT MAX(o.created_at) AS at FROM queued_plans q JOIN orders o ON o.id = q.order_id WHERE q.workspace = ?").get(workspace) as { at: number | null };
    if (queued.at !== null) return Math.max(this.now(), current.periodEnd);
    const sameKind = current.plan === plan && current.cycle === cycle;
    // A monthly plan moves up to a dearer one at once; the credits already given stay. Anything else would throw paid time away.
    const upgrade = current.cycle === "month" && this.plan(plan).usd > this.plan(current.plan).usd;
    return current.status === "active" && current.plan !== "trial" && !sameKind && !upgrade ? current.periodEnd : this.now();
  }

  private startPeriod(order: Order): void {
    const plan = order.plan!;
    const current = this.subscription(order.workspace);
    if (plan !== "trial" && this.startsAt(order.workspace, plan, order.cycle) > this.now()) {
      this.db.prepare("INSERT INTO queued_plans (order_id, workspace, at) VALUES (?, ?, ?) ON CONFLICT DO NOTHING").run(order.id, order.workspace, this.now());
      return;
    }
    const continuing = current.plan === plan && current.cycle === order.cycle && (current.status === "active" || current.status === "grace" || current.status === "trialing");
    const start = continuing ? Math.max(this.now(), current.periodEnd) : this.now();
    const months = order.cycle === "year" ? YEAR_MONTHS : 1;
    const pending = continuing
      ? (this.db.prepare("SELECT next_grant_at, grants_left FROM subscriptions WHERE workspace = ?").get(order.workspace) as { next_grant_at: number | null; grants_left: number })
      : null;
    let next: number | null, left: number;
    if (pending && pending.grants_left > 0 && pending.next_grant_at !== null) {
      next = pending.next_grant_at;
      left = pending.grants_left + months;
    } else if (start <= this.now() || order.cycle === "month") {
      this.grant(order.workspace, plan, order.credits, order.id);
      next = months > 1 ? start + MONTH_MS : null;
      left = months - 1;
    } else {
      next = start;
      left = months;
    }
    this.db.prepare(`INSERT INTO subscriptions (workspace, plan, cycle, period_end, reminded, monthly_credits, next_grant_at, grants_left) VALUES (?, ?, ?, ?, 0, ?, ?, ?)
      ON CONFLICT (workspace) DO UPDATE SET plan = excluded.plan, cycle = excluded.cycle, period_end = excluded.period_end, reminded = 0,
        monthly_credits = excluded.monthly_credits, next_grant_at = excluded.next_grant_at, grants_left = excluded.grants_left`)
      .run(order.workspace, plan, order.cycle, start + periodMs(plan, order.cycle), order.credits, next, left);
    if (plan === "trial") this.db.prepare("INSERT INTO trial_uses (email, workspace, at) VALUES (?, ?, ?) ON CONFLICT DO NOTHING").run(order.email, order.workspace, this.now());
  }

  private grant(workspace: string, plan: PlanId, credits: number, note: string): void {
    if (credits > 0) this.wallet.credit(workspace, credits * MICRO, "grant", `${PLANS[plan].name} · ${note}`);
  }

  /** Grants the monthly credits of yearly plans whose next month has begun; run from the sweep. */
  grantDue(): number {
    return this.db.transaction(() => { this.startQueued(); return this.grantDueWithinTransaction(); });
  }

  /** Plans paid for while another was running begin once it ends, oldest first. */
  private startQueued(): void {
    const due = this.db.prepare(`SELECT q.order_id AS id FROM queued_plans q JOIN subscriptions s ON s.workspace = q.workspace
      WHERE s.period_end <= ? ORDER BY q.at`).all(this.now()) as Array<{ id: string }>;
    const started = new Set<string>();
    for (const row of due) {
      const order = this.order(row.id);
      if (order && started.has(order.workspace)) continue;
      this.db.prepare("DELETE FROM queued_plans WHERE order_id = ?").run(row.id);
      if (!order) continue;
      started.add(order.workspace);
      this.startPeriod(order);
    }
  }

  private grantDueWithinTransaction(): number {
    const due = this.db.prepare("SELECT workspace, plan, monthly_credits, next_grant_at, grants_left FROM subscriptions WHERE grants_left > 0 AND next_grant_at <= ?")
      .all(this.now()) as Array<{ workspace: string; plan: PlanId; monthly_credits: number; next_grant_at: number; grants_left: number }>;
    let granted = 0;
    for (const row of due) {
      let { next_grant_at: next, grants_left: left } = row;
      while (left > 0 && next <= this.now()) {
        this.grant(row.workspace, row.plan, row.monthly_credits, `month starting ${new Date(next).toISOString().slice(0, 10)}`);
        next += MONTH_MS;
        left -= 1;
        granted += 1;
      }
      this.db.prepare("UPDATE subscriptions SET next_grant_at = ?, grants_left = ? WHERE workspace = ?").run(left > 0 ? next : null, left, row.workspace);
    }
    return granted;
  }

  /** An operator's grant: a free order applied like a paid one, so it shows among the orders and moves the period the same way. */
  grantPlan(workspace: string, email: string, plan: PlanId, cycle: Cycle, currency: string): Order {
    const id = `${MANUAL_ORDER_PREFIX}${token(12)}`;
    const period = cycle === "year" && this.plan(plan).usdYear !== null ? "year" : "month";
    this.db.prepare("INSERT INTO orders (id, workspace, email, kind, plan, cycle, credits, usd, amount, currency, status, created_at) VALUES (?, ?, ?, 'plan', ?, ?, ?, 0, '0', ?, 'pending', ?)")
      .run(id, workspace, email, plan, period, this.plan(plan).credits, currency, this.now());
    this.fulfil(id);
    return this.order(id)!;
  }

  /** An operator's gift: `plan` for `days` days with `credits` credits (none means the Deliobot AI is not paid for, only the
   * plan's rights such as using one's own AI), recorded as a free order. */
  giftPlan(workspace: string, email: string, plan: PlanId, days: number, credits: number): Order {
    const id = `${MANUAL_ORDER_PREFIX}${token(12)}`;
    this.db.transaction(() => {
      this.db.prepare("INSERT INTO orders (id, workspace, email, kind, plan, cycle, credits, usd, amount, currency, status, created_at, paid_at) VALUES (?, ?, ?, 'plan', ?, 'month', ?, 0, '0', 'XOF', 'paid', ?, ?)")
        .run(id, workspace, email, plan, credits, this.now(), this.now());
      if (credits > 0) this.grant(workspace, plan, credits, id);
      this.db.prepare(`INSERT INTO subscriptions (workspace, plan, cycle, period_end, reminded, monthly_credits, next_grant_at, grants_left) VALUES (?, ?, 'month', ?, 0, ?, NULL, 0)
        ON CONFLICT (workspace) DO UPDATE SET plan = excluded.plan, cycle = excluded.cycle, period_end = excluded.period_end, reminded = 0,
          monthly_credits = excluded.monthly_credits, next_grant_at = NULL, grants_left = 0`).run(workspace, plan, this.now() + days * DAY_MS, credits);
    });
    return this.order(id)!;
  }

  /** Applies an order the payer settled outside the checkout's confirmation; a failed one is reopened first. False when it was already paid. */
  markPaid(orderId: string): boolean {
    this.db.prepare("UPDATE orders SET status = 'pending' WHERE id = ? AND status = 'failed'").run(orderId);
    return this.fulfil(orderId);
  }

  /** Applies paid orders whose credits and period never landed (a top-up with no ledger row, a plan with neither a ledger row
   * nor a subscription), keeping their payment time; run from the sweep. Answers the orders it applied. */
  repairUnapplied(): string[] {
    const missing = this.db.prepare(`SELECT o.id, o.paid_at FROM orders o WHERE o.status = 'paid' AND o.paid_at > ?
      AND NOT EXISTS (SELECT 1 FROM credit_ledger l WHERE l.workspace = o.workspace AND l.note LIKE '%· ' || o.id)
      AND (o.kind = 'topup' OR NOT EXISTS (SELECT 1 FROM subscriptions s WHERE s.workspace = o.workspace))
      AND EXISTS (SELECT 1 FROM workspaces w WHERE w.slug = o.workspace AND w.created_at <= o.created_at)`).all(this.now() - 60 * DAY_MS) as Array<{ id: string; paid_at: number }>;
    const repaired: string[] = [];
    for (const row of missing) {
      this.db.prepare("UPDATE orders SET status = 'pending' WHERE id = ? AND status = 'paid'").run(row.id);
      if (this.fulfil(row.id)) {
        this.db.prepare("UPDATE orders SET paid_at = ? WHERE id = ?").run(row.paid_at, row.id);
        repaired.push(row.id);
      }
    }
    return repaired;
  }

  /** An operator's refund of a paid order: its commissions are voided on the next sweep. Credits already used stay used. */
  markRefunded(orderId: string): boolean {
    return Number(this.db.prepare("UPDATE orders SET status = 'refunded' WHERE id = ? AND status = 'paid'").run(orderId).changes) === 1;
  }

  markFailed(orderId: string): void {
    this.db.prepare("UPDATE orders SET status = 'failed' WHERE id = ? AND status = 'pending'").run(orderId);
  }

  /** Records a payment event once; false when it was already seen. */
  firstSeen(eventId: string): boolean {
    this.db.prepare("DELETE FROM payment_events WHERE at < ?").run(this.now() - 90 * DAY_MS);
    return Number(this.db.prepare("INSERT INTO payment_events (id, at) VALUES (?, ?) ON CONFLICT DO NOTHING").run(eventId, this.now()).changes) === 1;
  }

  /** Workspaces whose period ends within three days and were not reminded yet; each is reminded once per period. */
  dueReminders(): Array<{ workspace: string; plan: PlanId; periodEnd: number }> {
    const rows = this.db.prepare("SELECT workspace, plan, period_end FROM subscriptions WHERE reminded = 0 AND period_end - ? < ?")
      .all(this.now(), REMIND_BEFORE_MS) as Array<{ workspace: string; plan: PlanId; period_end: number }>;
    for (const row of rows) this.db.prepare("UPDATE subscriptions SET reminded = 1 WHERE workspace = ?").run(row.workspace);
    return rows.map((row) => ({ workspace: row.workspace, plan: row.plan, periodEnd: row.period_end }));
  }
}

/** Asks SasPay about pending orders and applies those it reports paid; the webhook and the return page both call it. */
export async function reconcileOrders(billing: Billing, saspay: SasPay, filter: { order?: string; workspace?: string; days?: number; limit?: number } = {}): Promise<string[]> {
  const fulfilled: string[] = [];
  let asked = 0;
  for (const order of billing.pending(filter.days)) {
    if ((filter.order && order.id !== filter.order) || (filter.workspace && order.workspace !== filter.workspace)) continue;
    if (++asked > (filter.limit ?? 40)) break;
    let status: string;
    try { status = await saspay.sessionStatus(order.sessionId!); } catch { continue; }
    if (status === "PAID" && billing.fulfil(order.id)) fulfilled.push(order.id);
    else if (status === "FAILED" || status === "CANCELLED" || status === "EXPIRED") billing.markFailed(order.id);
  }
  return fulfilled;
}
