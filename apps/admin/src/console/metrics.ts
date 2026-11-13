import type { SqlDatabase } from "../sql.ts";
import { MANUAL_ORDER_PREFIX, PLANS, type PlanId } from "../plans.ts";
import { dayOf, downloadPlatform } from "../traffic.ts";
import { MICRO } from "../wallet.ts";

const DAY_MS = 24 * 60 * 60_000;

export type PeriodId = "today" | "7d" | "30d" | "month";
export const PERIODS: ReadonlyArray<[PeriodId, string]> = [["today", "Aujourd'hui"], ["7d", "7 jours"], ["30d", "30 jours"], ["month", "Ce mois"]];

export interface Period { id: PeriodId; from: number; to: number; previousFrom: number; days: string[] }

export function period(id: string | null, now: number): Period {
  const chosen: PeriodId = PERIODS.some(([value]) => value === id) ? id as PeriodId : "30d";
  const midnight = Date.parse(`${dayOf(now)}T00:00:00Z`);
  const from = chosen === "today" ? midnight : chosen === "7d" ? midnight - 6 * DAY_MS : chosen === "month" ? Date.parse(`${dayOf(now).slice(0, 8)}01T00:00:00Z`) : midnight - 29 * DAY_MS;
  const span = Math.max(DAY_MS, now - from);
  const chartFrom = Math.min(from, midnight - 13 * DAY_MS);
  const days: string[] = [];
  for (let at = chartFrom; at <= now; at += DAY_MS) days.push(dayOf(at));
  return { id: chosen, from, to: now + 1, previousFrom: from - span, days };
}

/** The share of `value` over `previous`, in percent; null when there was nothing before. */
export const trend = (value: number, previous: number): number | null => previous > 0 ? Math.round(((value - previous) / previous) * 100) : null;

const PAID = `status = 'paid' AND usd > 0 AND id NOT LIKE '${MANUAL_ORDER_PREFIX}%'`;

type Row = Record<string, unknown>;
const num = (value: unknown) => Number(value ?? 0) || 0;

export class Metrics {
  private readonly db: SqlDatabase;
  private readonly creditUsd: number;
  private readonly now: () => number;

  constructor(db: SqlDatabase, creditUsd: number, now: () => number) {
    this.db = db;
    this.creditUsd = creditUsd;
    this.now = now;
  }

  private one(sql: string, ...params: Array<string | number>): Row {
    return (this.db.prepare(sql).get(...params) as Row | undefined) ?? {};
  }

  private all(sql: string, ...params: Array<string | number>): Row[] {
    return this.db.prepare(sql).all(...params) as Row[];
  }

  revenue(from: number, to: number): { usd: number; francs: number; orders: number } {
    const row = this.one(`SELECT COALESCE(SUM(usd), 0) AS usd, COALESCE(SUM(CASE WHEN currency IN ('XOF', 'XAF') THEN CAST(amount AS REAL) ELSE 0 END), 0) AS francs,
      COUNT(*) AS orders FROM orders WHERE ${PAID} AND paid_at >= ? AND paid_at < ?`, from, to);
    return { usd: num(row.usd), francs: num(row.francs), orders: num(row.orders) };
  }

  signups(from: number, to: number): number {
    return num(this.one("SELECT COUNT(*) AS n FROM accounts WHERE created_at >= ? AND created_at < ?", from, to).n);
  }

  trialsStarted(from: number, to: number): number {
    return num(this.one("SELECT COUNT(*) AS n FROM trial_uses WHERE at >= ? AND at < ?", from, to).n);
  }

  /** Credits spent on AI, and what they cost the business at the providers' price. */
  usage(from: number, to: number): { credits: number; costUsd: number } {
    const credits = num(this.one("SELECT COALESCE(-SUM(delta), 0) AS used FROM credit_ledger WHERE kind = 'usage' AND at >= ? AND at < ?", from, to).used) / MICRO;
    return { credits, costUsd: credits * this.creditUsd };
  }

  usageByProvider(from: number, to: number): Array<{ provider: string; credits: number; costUsd: number }> {
    return this.all(`SELECT COALESCE(provider, 'autre') AS provider, -SUM(delta) AS used FROM credit_ledger WHERE kind = 'usage' AND at >= ? AND at < ?
      GROUP BY provider ORDER BY used DESC`, from, to).map((row) => {
      const credits = num(row.used) / MICRO;
      return { provider: String(row.provider), credits, costUsd: credits * this.creditUsd };
    });
  }

  /** Paid subscriptions and trials running now, by plan. */
  activeByPlan(): Array<{ plan: PlanId; count: number }> {
    return this.all("SELECT plan, COUNT(*) AS n FROM subscriptions WHERE period_end > ? GROUP BY plan", this.now())
      .filter((row) => Object.hasOwn(PLANS, String(row.plan)))
      .map((row) => ({ plan: row.plan as PlanId, count: num(row.n) }))
      .sort((a, b) => Object.keys(PLANS).indexOf(a.plan) - Object.keys(PLANS).indexOf(b.plan));
  }

  /** Of the workspaces that took a trial, the share that later paid for a plan. */
  trialConversion(): { trials: number; converted: number; rate: number | null } {
    const row = this.one(`SELECT COUNT(*) AS trials, SUM(CASE WHEN EXISTS (SELECT 1 FROM orders o WHERE o.workspace = t.workspace AND o.kind = 'plan' AND o.plan != 'trial'
      AND o.status = 'paid' AND o.usd > 0) THEN 1 ELSE 0 END) AS converted FROM trial_uses t`);
    const trials = num(row.trials), converted = num(row.converted);
    return { trials, converted, rate: trials > 0 ? Math.round((converted / trials) * 100) : null };
  }

  /** One value per day of `days` (YYYY-MM-DD, UTC). */
  daily(kind: "revenue" | "signups" | "cost" | "visitors", days: readonly string[]): number[] {
    const from = Date.parse(`${days[0]}T00:00:00Z`);
    const rows = kind === "revenue"
      ? this.all(`SELECT paid_at AS at, usd AS v FROM orders WHERE ${PAID} AND paid_at >= ?`, from)
      : kind === "signups" ? this.all("SELECT created_at AS at, 1 AS v FROM accounts WHERE created_at >= ?", from)
      : kind === "cost" ? this.all("SELECT at, -delta AS v FROM credit_ledger WHERE kind = 'usage' AND at >= ?", from)
      : [];
    if (kind === "visitors") {
      const byDay = new Map(this.all("SELECT day, visitors FROM visit_days WHERE site = 'site' AND day >= ?", days[0]!).map((row) => [String(row.day), num(row.visitors)]));
      return days.map((day) => byDay.get(day) ?? 0);
    }
    const totals = new Map<string, number>();
    for (const row of rows) totals.set(dayOf(num(row.at)), (totals.get(dayOf(num(row.at))) ?? 0) + num(row.v));
    return days.map((day) => {
      const value = totals.get(day) ?? 0;
      return kind === "cost" ? (value / MICRO) * this.creditUsd : value;
    });
  }

  /** What deserves a look: unpaid orders, plans about to end, wallets nearly empty. */
  watchlist(): { pending: number; ending: Array<{ workspace: string; plan: string; periodEnd: number }>; lowBalance: Array<{ workspace: string; credits: number }> } {
    const now = this.now();
    return {
      pending: num(this.one("SELECT COUNT(*) AS n FROM orders WHERE status = 'pending' AND created_at > ?", now - 2 * DAY_MS).n),
      ending: this.all("SELECT workspace, plan, period_end FROM subscriptions WHERE period_end > ? AND period_end < ? ORDER BY period_end LIMIT 8", now, now + 3 * DAY_MS)
        .map((row) => ({ workspace: String(row.workspace), plan: String(row.plan), periodEnd: num(row.period_end) })),
      lowBalance: this.all(`SELECT w.workspace, w.balance FROM wallets w JOIN subscriptions s ON s.workspace = w.workspace
        WHERE s.period_end > ? AND s.plan != 'byok' AND w.balance < ? ORDER BY w.balance LIMIT 8`, now, 50 * MICRO)
        .map((row) => ({ workspace: String(row.workspace), credits: num(row.balance) / MICRO })),
    };
  }

  recentActivity(limit = 10): Array<{ workspace: string | null; actor: string | null; action: string; target: string | null; at: number }> {
    return this.all("SELECT workspace, actor, action, target, at FROM audit ORDER BY id DESC LIMIT ?", limit) as never;
  }

  /** Audience of one site over a period. */
  traffic(from: number, to: number) {
    const count = (sql: string, ...params: Array<string | number>) => num(this.one(sql, ...params).n);
    const fromDay = dayOf(from);
    const group = (column: string, site = "site", kind = "view", limit = 8) => this.all(`SELECT ${column} AS label, COUNT(DISTINCT day || visitor) AS visitors, COUNT(*) AS views
      FROM visits WHERE site = ? AND kind = ? AND at >= ? AND at < ? AND ${column} IS NOT NULL GROUP BY ${column} ORDER BY visitors DESC, views DESC LIMIT ?`, site, kind, from, to, limit)
      .map((row) => ({ label: String(row.label), visitors: num(row.visitors), views: num(row.views) }));
    const downloads = new Map<string, number>();
    for (const row of this.all("SELECT path, COUNT(*) AS n FROM visits WHERE kind = 'download' AND at >= ? AND at < ? GROUP BY path", from, to)) {
      const platform = downloadPlatform(String(row.path));
      if (platform) downloads.set(platform, (downloads.get(platform) ?? 0) + num(row.n));
    }
    const visitors = count("SELECT COUNT(DISTINCT day || visitor) AS n FROM visits WHERE site = 'site' AND kind = 'view' AND at >= ? AND at < ?", from, to);
    const clicked = count("SELECT COUNT(DISTINCT day || visitor) AS n FROM visits WHERE site = 'compte' AND (path LIKE '/pay%' OR path LIKE '/signup%') AND at >= ? AND at < ?", from, to);
    const signups = this.signups(from, to);
    const trials = this.trialsStarted(from, to);
    const paying = count(`SELECT COUNT(DISTINCT workspace) AS n FROM orders WHERE kind = 'plan' AND plan != 'trial' AND ${PAID} AND paid_at >= ? AND paid_at < ?`, from, to);
    return {
      visitors,
      views: count("SELECT COUNT(*) AS n FROM visits WHERE site = 'site' AND kind = 'view' AND at >= ? AND at < ?", from, to),
      downloads: [...downloads.values()].reduce((sum, value) => sum + value, 0),
      now: count("SELECT COUNT(DISTINCT visitor) AS n FROM visits WHERE at >= ?", this.now() - 5 * 60_000),
      apps: count("SELECT COUNT(*) AS n FROM device_tokens WHERE last_used_at >= ?", this.now() - 7 * DAY_MS),
      pages: group("path"), sources: group("source"), countries: group("country"), cities: group("city"),
      devices: group("device", "site", "view", 4), systems: group("os", "site", "view", 7),
      downloadsByPlatform: [...downloads.entries()].sort((a, b) => b[1] - a[1]).map(([label, n]) => ({ label, visitors: n, views: n })),
      funnel: [["Visiteurs du site", visitors], ["Clic « Essayer » ou « Choisir »", clicked], ["Inscriptions", signups], ["Essais", trials], ["Clients payants", paying]] as Array<[string, number]>,
      fromDay,
    };
  }
}
