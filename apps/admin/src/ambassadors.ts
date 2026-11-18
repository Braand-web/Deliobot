// The ambassador programme: people who bring paying customers with their own codes and links, and earn a share of the
// plans those customers pay for. Only plans count: top-ups, trials (beyond a small fixed bonus) and granted plans never
// do. A commission waits a while before it can be paid out, so a payment that fails or is refunded never reaches one.
import type { OperatorSettings } from "./operator-settings.ts";
import { MANUAL_ORDER_PREFIX, type Order } from "./plans.ts";
import { normalizeCode, type Promos } from "./promos.ts";
import type { SqlDatabase } from "./sql.ts";
import { MICRO, type Wallet } from "./wallet.ts";

const DAY_MS = 24 * 60 * 60_000;
const MONTH_MS = 30 * DAY_MS;

export type AmbassadorStatus = "pending" | "active" | "suspended";
export type LevelId = "bronze" | "argent" | "or" | "diamant";
export interface Level { id: LevelId; name: string; clients: number | null; revenueUsd: number | null; rate: number; months: number }

export interface AmbassadorRules {
  /** From the lowest to the highest; a level is reached by its client count or its plan revenue over six months. */
  levels: Level[];
  /** The share of a payment after a customer's sixth month, for an ambassador whose extension was granted. */
  extendedRate: number;
  holdDays: number;
  minPayoutXof: number;
  welcomeCredits: number;
  trialBonusUsd: number;
  trialWindowDays: number;
  maxCodes: number;
}

export const DEFAULT_RULES: AmbassadorRules = {
  levels: [
    { id: "bronze", name: "Bronze", clients: 0, revenueUsd: null, rate: 0.15, months: 6 },
    { id: "argent", name: "Argent", clients: 10, revenueUsd: 1000, rate: 0.2, months: 6 },
    { id: "or", name: "Or", clients: null, revenueUsd: 5000, rate: 0.2, months: 12 },
    { id: "diamant", name: "Diamant", clients: null, revenueUsd: 15000, rate: 0.25, months: 24 },
  ],
  extendedRate: 0.1, holdDays: 14, minPayoutXof: 5000, welcomeCredits: 500, trialBonusUsd: 1, trialWindowDays: 30, maxCodes: 3,
};

/** Words a code may not hold: our own name and words that would mislead a customer. */
const FORBIDDEN = ["DELIO", "DELIOBOT", "ADMIN", "SUPPORT", "GRATUIT", "FREE", "OFFICIEL", "OFFICIAL", "STAFF", "TEST"];
export const AMBASSADOR_CODE = /^[A-Z0-9][A-Z0-9-]{2,19}$/;
const LEVEL_DROP_MS = 90 * DAY_MS;

export interface Ambassador {
  id: string; name: string; email: string; phone: string; social: string; audience: string; why: string; status: AmbassadorStatus;
  /** Months of commission per customer: 6, or 12 and 24 once an extension was granted. */
  months: number;
  extensionRequest: number | null;
  rateOverride: number | null;
  createdAt: number;
}

export interface AmbassadorStats {
  clicks: number; signups: number; paying: number; revenueUsd: number; level: Level; next: Level | null;
  heldUsd: number; payableUsd: number; paidUsd: number; availableUsd: number; nextPayableAt: number | null; canExtendTo: number | null;
}

export interface Payout { id: number; ambassador: string; usd: number; mode: "mobile_money" | "credits"; status: "requested" | "paid"; reference: string | null; at: number; paidAt: number | null }

const usd = (micro: number) => Math.round(Number(micro)) / MICRO;

export class Ambassadors {
  private readonly db: SqlDatabase;
  private readonly wallet: Wallet;
  private readonly promos: Promos;
  private readonly settings: OperatorSettings;
  private readonly now: () => number;

  constructor(deps: { wallet: Wallet; promos: Promos; settings: OperatorSettings; now?: () => number }) {
    this.wallet = deps.wallet;
    this.db = deps.wallet.db;
    this.promos = deps.promos;
    this.settings = deps.settings;
    this.now = deps.now ?? Date.now;
    this.db.exec(`
CREATE TABLE IF NOT EXISTS ambassadors (id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL UNIQUE, phone TEXT NOT NULL DEFAULT '', social TEXT NOT NULL DEFAULT '',
  audience TEXT NOT NULL DEFAULT '', why TEXT NOT NULL DEFAULT '', status TEXT NOT NULL, months INTEGER NOT NULL DEFAULT 6, extension_request INTEGER,
  rate_override REAL, below_since INTEGER, created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS referrals (workspace TEXT PRIMARY KEY, ambassador TEXT NOT NULL, code TEXT NOT NULL, source TEXT NOT NULL, at INTEGER NOT NULL,
  first_paid_at INTEGER, months INTEGER, bonus_given INTEGER NOT NULL DEFAULT 0);
CREATE INDEX IF NOT EXISTS referrals_ambassador ON referrals (ambassador);
CREATE TABLE IF NOT EXISTS commissions (order_id TEXT PRIMARY KEY, ambassador TEXT NOT NULL, workspace TEXT NOT NULL, kind TEXT NOT NULL, order_usd REAL NOT NULL,
  rate REAL NOT NULL, amount INTEGER NOT NULL, status TEXT NOT NULL, payable_at INTEGER NOT NULL, created_at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS commissions_ambassador ON commissions (ambassador, status);
CREATE TABLE IF NOT EXISTS ambassador_payouts (id INTEGER PRIMARY KEY AUTOINCREMENT, ambassador TEXT NOT NULL, amount INTEGER NOT NULL, mode TEXT NOT NULL,
  status TEXT NOT NULL, reference TEXT, at INTEGER NOT NULL, paid_at INTEGER, actor TEXT);`);
  }

  rules(): AmbassadorRules {
    return this.settings.ambassadorRules() ?? DEFAULT_RULES;
  }

  private row(raw: Record<string, unknown>): Ambassador {
    return { id: String(raw.id), name: String(raw.name), email: String(raw.email), phone: String(raw.phone), social: String(raw.social), audience: String(raw.audience),
      why: String(raw.why), status: raw.status as AmbassadorStatus, months: Number(raw.months), extensionRequest: raw.extension_request === null ? null : Number(raw.extension_request),
      rateOverride: raw.rate_override === null ? null : Number(raw.rate_override), createdAt: Number(raw.created_at) };
  }

  get(id: string): Ambassador | null {
    const raw = this.db.prepare("SELECT * FROM ambassadors WHERE id = ?").get(id) as Record<string, unknown> | undefined;
    return raw ? this.row(raw) : null;
  }

  byEmail(email: string): Ambassador | null {
    const raw = this.db.prepare("SELECT * FROM ambassadors WHERE email = ?").get(email.trim().toLowerCase()) as Record<string, unknown> | undefined;
    return raw ? this.row(raw) : null;
  }

  all(status?: AmbassadorStatus): Ambassador[] {
    return (this.db.prepare(`SELECT * FROM ambassadors ${status ? "WHERE status = ?" : ""} ORDER BY created_at DESC`).all(...(status ? [status] : [])) as Array<Record<string, unknown>>)
      .map((raw) => this.row(raw));
  }

  pendingCount(): number {
    return Number((this.db.prepare("SELECT (SELECT COUNT(*) FROM ambassadors WHERE status = 'pending') + (SELECT COUNT(*) FROM ambassadors WHERE extension_request IS NOT NULL) + (SELECT COUNT(*) FROM ambassador_payouts WHERE status = 'requested') AS n").get() as { n: number }).n);
  }

  /** An application from the public form, or an ambassador the operator adds (`active`). Answers null when the e-mail already has one. */
  apply(input: { name: string; email: string; phone?: string; social?: string; audience?: string; why?: string }, status: AmbassadorStatus = "pending"): Ambassador | null {
    const email = input.email.trim().toLowerCase();
    if (this.byEmail(email)) return null;
    const id = `amb_${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`;
    this.db.prepare("INSERT INTO ambassadors (id, name, email, phone, social, audience, why, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .run(id, input.name.trim(), email, input.phone?.trim() ?? "", input.social?.trim() ?? "", input.audience?.trim() ?? "", input.why?.trim() ?? "", status, this.now());
    return this.get(id);
  }

  update(id: string, input: Partial<Pick<Ambassador, "name" | "phone" | "social" | "status" | "rateOverride">>): void {
    const current = this.get(id);
    if (!current) return;
    const next = { ...current, ...input };
    this.db.prepare("UPDATE ambassadors SET name = ?, phone = ?, social = ?, status = ?, rate_override = ? WHERE id = ?")
      .run(next.name, next.phone, next.social, next.status, next.rateOverride, id);
    if (next.status !== "active") this.db.prepare("UPDATE promo_codes SET active = 0 WHERE ambassador = ?").run(id);
  }

  /** A first code from the ambassador's name, made when they are approved, if they have none. */
  suggestCode(ambassador: Ambassador): string {
    const base = normalizeCode(ambassador.name.split(/\s+/)[0] ?? "").replace(/[^A-Z0-9]/g, "").slice(0, 12) || "AMB";
    for (const candidate of [base, ...Array.from({ length: 50 }, (_, index) => `${base}${index + 2}`)]) {
      if (candidate.length >= 3 && !this.promos.get(candidate) && this.codeProblem(candidate) === null) return candidate;
    }
    return `AMB${Date.now().toString(36).toUpperCase()}`;
  }

  private codeProblem(code: string): string | null {
    if (!AMBASSADOR_CODE.test(code)) return "Un code fait 3 à 20 caractères : lettres, chiffres et tirets.";
    if (FORBIDDEN.some((word) => code.replace(/-/g, "").includes(word))) return "Ce code contient un mot réservé. Choisissez-en un autre.";
    return null;
  }

  codes(ambassador: string): Array<{ code: string; active: boolean; signups: number; paying: number }> {
    return (this.db.prepare(`SELECT p.code, p.active, (SELECT COUNT(*) FROM referrals r WHERE r.code = p.code) AS signups,
      (SELECT COUNT(*) FROM referrals r WHERE r.code = p.code AND r.first_paid_at IS NOT NULL) AS paying FROM promo_codes p WHERE p.ambassador = ? ORDER BY p.created_at`).all(ambassador) as Array<Record<string, unknown>>)
      .map((row) => ({ code: String(row.code), active: Number(row.active) === 1, signups: Number(row.signups), paying: Number(row.paying) }));
  }

  /** A new code of the ambassador's own: unique, at most `maxCodes`, never a reserved word. */
  createCode(ambassador: Ambassador, wanted: string): { ok: true; code: string } | { ok: false; error: string } {
    const code = normalizeCode(wanted);
    const problem = this.codeProblem(code);
    if (problem) return { ok: false, error: problem };
    if (ambassador.status !== "active") return { ok: false, error: "Votre compte ambassadeur n'est pas encore actif." };
    if (this.codes(ambassador.id).length >= this.rules().maxCodes) return { ok: false, error: `Vous avez déjà ${this.rules().maxCodes} codes, le maximum. Désactivez-en un ou gardez ceux-là.` };
    if (this.promos.get(code)) return { ok: false, error: "Ce code est déjà pris. Essayez-en un autre." };
    const made = this.promos.create({ code, kind: "credits", value: this.rules().welcomeCredits, maxUses: null, expiresAt: null, plans: null, note: `Ambassadeur ${ambassador.name}`, ambassador: ambassador.id }, ambassador.email);
    return made === "ok" ? { ok: true, code } : { ok: false, error: "Ce code ne peut pas être créé. Essayez-en un autre." };
  }

  setCodeActive(ambassador: string, code: string, active: boolean): boolean {
    const promo = this.promos.get(code);
    return Boolean(promo && promo.ambassador === ambassador && this.promos.setActive(promo.code, active));
  }

  /** The ambassador behind an active code, or null. */
  ambassadorForCode(value: string): { ambassador: Ambassador; code: string } | null {
    const promo = this.promos.get(value);
    if (!promo?.ambassador || !promo.active) return null;
    const ambassador = this.get(promo.ambassador);
    return ambassador && ambassador.status === "active" ? { ambassador, code: promo.code } : null;
  }

  /** Ties a workspace to the ambassador of `code`, once: the first ambassador keeps it. False for an unknown code or their own workspace. */
  attribute(workspace: string, value: string, source: "link" | "code", memberEmails: readonly string[]): boolean {
    const found = this.ambassadorForCode(value);
    if (!found) return false;
    if (memberEmails.map((email) => email.toLowerCase()).includes(found.ambassador.email)) return false;
    // A customer who already paid was not brought by this link: attribution is for new customers only.
    if (this.db.prepare(`SELECT 1 FROM orders WHERE workspace = ? AND status = 'paid' AND usd > 0 AND id NOT LIKE '${MANUAL_ORDER_PREFIX}%'`).get(workspace)) return false;
    return Number(this.db.prepare("INSERT INTO referrals (workspace, ambassador, code, source, at) VALUES (?, ?, ?, ?, ?) ON CONFLICT DO NOTHING")
      .run(workspace, found.ambassador.id, found.code, source, this.now()).changes) === 1;
  }

  referral(workspace: string): { ambassador: string; code: string; firstPaidAt: number | null; months: number | null; bonusGiven: boolean } | null {
    const row = this.db.prepare("SELECT ambassador, code, first_paid_at, months, bonus_given FROM referrals WHERE workspace = ?").get(workspace) as Record<string, unknown> | undefined;
    return row ? { ambassador: String(row.ambassador), code: String(row.code), firstPaidAt: row.first_paid_at === null ? null : Number(row.first_paid_at),
      months: row.months === null ? null : Number(row.months), bonusGiven: Number(row.bonus_given) === 1 } : null;
  }

  /** Plan revenue the ambassador brought over the last six months, and their paying customers. Only paid plans count, never top-ups or trials. */
  private performance(ambassador: string): { paying: number; revenueUsd: number } {
    const paying = Number((this.db.prepare("SELECT COUNT(*) AS n FROM referrals WHERE ambassador = ? AND first_paid_at IS NOT NULL").get(ambassador) as { n: number }).n);
    const revenue = Number((this.db.prepare(`SELECT COALESCE(SUM(o.usd), 0) AS usd FROM orders o JOIN referrals r ON r.workspace = o.workspace
      WHERE r.ambassador = ? AND o.status = 'paid' AND o.kind = 'plan' AND o.plan != 'trial' AND o.id NOT LIKE '${MANUAL_ORDER_PREFIX}%' AND o.usd > 0 AND o.paid_at > ?`)
      .get(ambassador, this.now() - 6 * MONTH_MS) as { usd: number }).usd);
    return { paying, revenueUsd: Math.round(revenue * 100) / 100 };
  }

  level(ambassador: string): { level: Level; next: Level | null; paying: number; revenueUsd: number } {
    const { paying, revenueUsd } = this.performance(ambassador);
    const levels = this.rules().levels;
    const reached = levels.filter((level) => (level.clients !== null && paying >= level.clients) || (level.revenueUsd !== null && revenueUsd >= level.revenueUsd));
    const level = reached.at(-1) ?? levels[0]!;
    return { level, next: levels[levels.indexOf(level) + 1] ?? null, paying, revenueUsd };
  }

  /** Called once for every order that turns paid. Plans earn a share; a trial earns a small bonus once a plan follows; top-ups earn nothing. */
  recordPaid(order: Order): void {
    if (order.id.startsWith(MANUAL_ORDER_PREFIX) || order.usd <= 0 || order.kind !== "plan" || !order.plan) return;
    const referral = this.referral(order.workspace);
    if (!referral) return;
    const ambassador = this.get(referral.ambassador);
    if (!ambassador || ambassador.status !== "active" || order.email.toLowerCase() === ambassador.email) return;
    const rules = this.rules();
    const at = this.now();
    const insert = (kind: string, rate: number, micro: number, status: string, payableAt: number) =>
      this.db.prepare("INSERT INTO commissions (order_id, ambassador, workspace, kind, order_usd, rate, amount, status, payable_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT DO NOTHING")
        .run(order.id, ambassador.id, order.workspace, kind, order.usd, rate, Math.round(micro), status, payableAt, at);
    if (order.plan === "trial") {
      insert("trial", 0, rules.trialBonusUsd * MICRO, "trial", at + rules.trialWindowDays * DAY_MS);
      return;
    }
    if (referral.firstPaidAt === null) {
      this.db.prepare("UPDATE referrals SET first_paid_at = ?, months = ? WHERE workspace = ?").run(at, Math.max(6, ambassador.months), order.workspace);
      if (!referral.bonusGiven && rules.welcomeCredits > 0) {
        this.wallet.credit(order.workspace, rules.welcomeCredits * MICRO, "grant", `Bonus ambassadeur ${referral.code}`);
        this.db.prepare("UPDATE referrals SET bonus_given = 1 WHERE workspace = ?").run(order.workspace);
      }
      this.db.prepare("UPDATE commissions SET status = 'held', payable_at = ? WHERE workspace = ? AND kind = 'trial' AND status = 'trial' AND created_at > ?")
        .run(at + rules.holdDays * DAY_MS, order.workspace, at - rules.trialWindowDays * DAY_MS);
    }
    const started = referral.firstPaidAt ?? at;
    const months = referral.months ?? Math.max(6, ambassador.months);
    const age = at - started;
    if (age >= months * MONTH_MS) return;
    const rate = age < 6 * MONTH_MS ? ambassador.rateOverride ?? this.level(ambassador.id).level.rate : rules.extendedRate;
    insert("plan", rate, order.usd * rate * MICRO, "held", at + rules.holdDays * DAY_MS);
  }

  /** Run from the sweep: commissions past their hold become payable, trial bonuses with no plan after them lapse, and an
   * extension whose level was lost for three months stops applying to new customers. */
  sweep(): void {
    const at = this.now();
    this.db.prepare("UPDATE commissions SET status = 'payable' WHERE status = 'held' AND payable_at <= ? AND order_id IN (SELECT id FROM orders WHERE status = 'paid')").run(at);
    this.db.prepare("UPDATE commissions SET status = 'void' WHERE status IN ('held', 'payable') AND order_id IN (SELECT id FROM orders WHERE status != 'paid')").run();
    this.db.prepare("UPDATE commissions SET status = 'void' WHERE status = 'trial' AND payable_at <= ?").run(at);
    for (const ambassador of this.all("active").filter((one) => one.months > 6)) {
      const months = this.level(ambassador.id).level.months;
      const below = (this.db.prepare("SELECT below_since FROM ambassadors WHERE id = ?").get(ambassador.id) as { below_since: number | null }).below_since;
      if (months >= ambassador.months) { if (below !== null) this.db.prepare("UPDATE ambassadors SET below_since = NULL WHERE id = ?").run(ambassador.id); continue; }
      if (below === null) this.db.prepare("UPDATE ambassadors SET below_since = ? WHERE id = ?").run(at, ambassador.id);
      else if (at - below >= LEVEL_DROP_MS) this.db.prepare("UPDATE ambassadors SET months = ?, below_since = NULL WHERE id = ?").run(Math.max(6, months), ambassador.id);
    }
  }

  stats(ambassador: Ambassador): AmbassadorStats {
    const { level, next, paying, revenueUsd } = this.level(ambassador.id);
    const sum = (status: string) => usd((this.db.prepare("SELECT COALESCE(SUM(amount), 0) AS n FROM commissions WHERE ambassador = ? AND status = ?").get(ambassador.id, status) as { n: number }).n);
    const payouts = usd((this.db.prepare("SELECT COALESCE(SUM(amount), 0) AS n FROM ambassador_payouts WHERE ambassador = ?").get(ambassador.id) as { n: number }).n);
    const paid = usd((this.db.prepare("SELECT COALESCE(SUM(amount), 0) AS n FROM ambassador_payouts WHERE ambassador = ? AND status = 'paid'").get(ambassador.id) as { n: number }).n);
    const payable = sum("payable");
    const codes = this.codes(ambassador.id).map((code) => `ref.${code.code.toLowerCase()}`);
    const clicks = codes.length ? Number((this.db.prepare(`SELECT COUNT(DISTINCT visitor) AS n FROM visits WHERE source IN (${codes.map(() => "?").join(", ")})`).get(...codes) as { n: number }).n) : 0;
    const signups = Number((this.db.prepare("SELECT COUNT(*) AS n FROM referrals WHERE ambassador = ?").get(ambassador.id) as { n: number }).n);
    const nextPayable = this.db.prepare("SELECT MIN(payable_at) AS at FROM commissions WHERE ambassador = ? AND status = 'held'").get(ambassador.id) as { at: number | null };
    const canExtendTo = level.months > ambassador.months && ambassador.extensionRequest === null ? level.months : null;
    return { clicks, signups, paying, revenueUsd, level, next, heldUsd: sum("held"), payableUsd: payable, paidUsd: paid, availableUsd: Math.max(0, Math.round((payable - payouts) * 100) / 100),
      nextPayableAt: nextPayable.at === null ? null : Number(nextPayable.at), canExtendTo };
  }

  /** What a customer pays for one credit on the entry plan: gains taken as credits buy what that money would buy. */
  private creditPrice(): number {
    const starter = this.settings.plan("starter");
    return starter.credits > 0 ? starter.usd / starter.credits : this.wallet.creditUsd;
  }

  requestExtension(ambassador: Ambassador): boolean {
    const months = this.stats(ambassador).canExtendTo;
    if (!months) return false;
    this.db.prepare("UPDATE ambassadors SET extension_request = ? WHERE id = ?").run(months, ambassador.id);
    return true;
  }

  decideExtension(id: string, accept: boolean): void {
    const ambassador = this.get(id);
    if (!ambassador?.extensionRequest) return;
    this.db.prepare(`UPDATE ambassadors SET ${accept ? "months = extension_request, below_since = NULL," : ""} extension_request = NULL WHERE id = ?`).run(id);
    if (accept) this.db.prepare("UPDATE referrals SET months = MAX(COALESCE(months, 6), ?) WHERE ambassador = ? AND (first_paid_at IS NULL OR first_paid_at > ?)")
      .run(ambassador.extensionRequest, id, this.now() - ambassador.extensionRequest * MONTH_MS);
  }

  /** Pays out what is available: credits land at once in `creditWorkspace`; Mobile Money waits for the operator. */
  requestPayout(ambassador: Ambassador, mode: "mobile_money" | "credits", creditWorkspace: string | null, xofPerUsd: number): { ok: true; usd: number } | { ok: false; error: string } {
    const available = this.stats(ambassador).availableUsd;
    if (available <= 0) return { ok: false, error: "Rien à retirer pour l'instant : vos gains deviennent disponibles 14 jours après chaque paiement." };
    if (mode === "mobile_money" && available * xofPerUsd < this.rules().minPayoutXof) {
      return { ok: false, error: `Le retrait Mobile Money se fait à partir de ${this.rules().minPayoutXof.toLocaleString("fr-FR")} FCFA. Vous pouvez aussi recevoir vos gains en crédits tout de suite.` };
    }
    if (mode === "mobile_money" && this.db.prepare("SELECT 1 FROM ambassador_payouts WHERE ambassador = ? AND status = 'requested'").get(ambassador.id)) {
      return { ok: false, error: "Un retrait est déjà en cours. Il arrive en général sous quelques jours." };
    }
    if (mode === "credits" && !creditWorkspace) return { ok: false, error: "Aucun espace où ajouter les crédits." };
    const amount = Math.round(available * MICRO);
    this.db.transaction(() => {
      this.db.prepare("INSERT INTO ambassador_payouts (ambassador, amount, mode, status, at, paid_at) VALUES (?, ?, ?, ?, ?, ?)")
        .run(ambassador.id, amount, mode, mode === "credits" ? "paid" : "requested", this.now(), mode === "credits" ? this.now() : null);
      if (mode === "credits") this.wallet.credit(creditWorkspace!, Math.round(available / this.creditPrice()) * MICRO, "grant", "Gains ambassadeur");
    });
    return { ok: true, usd: available };
  }

  markPayoutPaid(id: number, reference: string, actor: string): Payout | null {
    const changed = Number(this.db.prepare("UPDATE ambassador_payouts SET status = 'paid', reference = ?, paid_at = ?, actor = ? WHERE id = ? AND status = 'requested'")
      .run(reference || null, this.now(), actor, id).changes);
    return changed ? this.payouts().find((payout) => payout.id === id) ?? null : null;
  }

  payouts(ambassador?: string): Payout[] {
    return (this.db.prepare(`SELECT * FROM ambassador_payouts ${ambassador ? "WHERE ambassador = ?" : ""} ORDER BY id DESC LIMIT 200`).all(...(ambassador ? [ambassador] : [])) as Array<Record<string, unknown>>)
      .map((row) => ({ id: Number(row.id), ambassador: String(row.ambassador), usd: usd(Number(row.amount)), mode: row.mode as Payout["mode"], status: row.status as Payout["status"],
        reference: row.reference === null ? null : String(row.reference), at: Number(row.at), paidAt: row.paid_at === null ? null : Number(row.paid_at) }));
  }

  commissions(ambassador: string): Array<{ orderId: string; workspace: string; kind: string; orderUsd: number; rate: number; usd: number; status: string; payableAt: number; createdAt: number }> {
    return (this.db.prepare("SELECT * FROM commissions WHERE ambassador = ? ORDER BY created_at DESC LIMIT 200").all(ambassador) as Array<Record<string, unknown>>)
      .map((row) => ({ orderId: String(row.order_id), workspace: String(row.workspace), kind: String(row.kind), orderUsd: Number(row.order_usd), rate: Number(row.rate),
        usd: usd(Number(row.amount)), status: String(row.status), payableAt: Number(row.payable_at), createdAt: Number(row.created_at) }));
  }

  /** Plan revenue that came through ambassadors and what is owed to them, for the dashboard. */
  totals(): { revenueUsd: number; owedUsd: number } {
    const revenue = Number((this.db.prepare(`SELECT COALESCE(SUM(o.usd), 0) AS usd FROM orders o JOIN referrals r ON r.workspace = o.workspace
      WHERE o.status = 'paid' AND o.kind = 'plan' AND o.id NOT LIKE '${MANUAL_ORDER_PREFIX}%'`).get() as { usd: number }).usd);
    const payable = Number((this.db.prepare("SELECT COALESCE(SUM(amount), 0) AS n FROM commissions WHERE status IN ('held', 'payable')").get() as { n: number }).n);
    const paid = Number((this.db.prepare("SELECT COALESCE(SUM(amount), 0) AS n FROM ambassador_payouts").get() as { n: number }).n);
    return { revenueUsd: Math.round(revenue * 100) / 100, owedUsd: Math.max(0, usd(payable - paid)) };
  }
}
