// Promo codes: a percentage off a plan, applied when its order is opened, credits given at once, or a plan for some days
// with the credits the operator chose. Each workspace uses a code once; a code's uses count paid orders and redemptions.
import type { Billing, PlanId } from "./plans.ts";
import type { SqlDatabase } from "./sql.ts";
import { MICRO, type Wallet } from "./wallet.ts";

export type PromoKind = "percent" | "credits" | "plan";
export interface Promo {
  code: string; kind: PromoKind; value: number; maxUses: number | null; expiresAt: number | null;
  /** Plans a percentage applies to; null for all paid plans. */
  plans: PlanId[] | null; note: string | null; active: boolean; createdAt: number; createdBy: string; uses: number;
  /** The ambassador this code belongs to: their customers get credits at their first plan, and the ambassador a share. */
  ambassador: string | null;
  /** A plan code's credits, granted with its plan; null for the other kinds. */
  credits: number | null;
  /** The only address whose workspace may use a plan code made for one person. */
  email: string | null;
  /** The generated lot a plan code belongs to. */
  batch: string | null;
}

export interface PromoBatch {
  id: string; plan: PlanId; days: number; credits: number; count: number; used: number; active: number;
  expiresAt: number | null; note: string | null; createdAt: number; createdBy: string;
}

export interface BatchCode { code: string; active: boolean; workspace: string | null; usedAt: number | null }

export const MAX_BATCH = 1000;
export const MAX_PLAN_DAYS = 366;
export const MAX_PLAN_CREDITS = 1_000_000;
/** Letters and digits nobody misreads on paper: no 0/O, 1/I/L. */
const CODE_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
const BATCH_PREFIX = /^[A-Z][A-Z0-9]{1,9}$/;

function randomBlock(length: number): string {
  let out = "";
  const limit = 256 - (256 % CODE_ALPHABET.length);
  while (out.length < length) {
    for (const byte of crypto.getRandomValues(new Uint8Array(length * 2))) {
      if (byte < limit && out.length < length) out += CODE_ALPHABET[byte % CODE_ALPHABET.length];
    }
  }
  return out;
}

export function batchPrefix(value: string): string | null {
  const prefix = normalizeCode(value || "DELIO");
  return BATCH_PREFIX.test(prefix) ? prefix : null;
}

export const PROMO_CODE = /^[A-Z0-9][A-Z0-9_-]{2,31}$/;
export const normalizeCode = (value: string) => value.trim().toUpperCase().replace(/\s+/g, "");

export type PromoCheck = { ok: true; promo: Promo } | { ok: false; error: string };

export class Promos {
  private readonly db: SqlDatabase;
  private readonly wallet: Wallet;
  private readonly now: () => number;

  constructor(wallet: Wallet, now: () => number = Date.now) {
    this.wallet = wallet;
    this.db = wallet.db;
    this.now = now;
    this.db.exec(`
CREATE TABLE IF NOT EXISTS promo_codes (code TEXT PRIMARY KEY, kind TEXT NOT NULL, value INTEGER NOT NULL, max_uses INTEGER, expires_at INTEGER,
  plans TEXT, note TEXT, active INTEGER NOT NULL DEFAULT 1, created_at INTEGER NOT NULL, created_by TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS promo_redemptions (code TEXT NOT NULL, workspace TEXT NOT NULL, at INTEGER NOT NULL, PRIMARY KEY (code, workspace));`);
    try { this.db.prepare("SELECT ambassador FROM promo_codes LIMIT 0").all(); } catch { this.db.exec("ALTER TABLE promo_codes ADD COLUMN ambassador TEXT"); }
    try { this.db.prepare("SELECT credits FROM promo_codes LIMIT 0").all(); } catch {
      this.db.exec("ALTER TABLE promo_codes ADD COLUMN credits INTEGER");
      this.db.exec("ALTER TABLE promo_codes ADD COLUMN email TEXT");
      this.db.exec("ALTER TABLE promo_codes ADD COLUMN batch TEXT");
    }
    this.db.exec("CREATE INDEX IF NOT EXISTS promo_codes_batch ON promo_codes (batch)");
  }

  /** Uses so far: credits given, and orders opened with the code that are paid or still payable, so a limit holds while checkouts wait. */
  private uses(code: string): number {
    const row = this.db.prepare(`SELECT (SELECT COUNT(*) FROM promo_redemptions WHERE code = ?) + (SELECT COUNT(*) FROM orders WHERE promo = ? AND status IN ('paid', 'pending')) AS n`).get(code, code) as { n: number };
    return Number(row.n);
  }

  private usedBy(code: string, workspace: string): boolean {
    return Boolean(this.db.prepare("SELECT 1 FROM promo_redemptions WHERE code = ? AND workspace = ?").get(code, workspace)
      ?? this.db.prepare("SELECT 1 FROM orders WHERE promo = ? AND workspace = ? AND status IN ('paid', 'pending')").get(code, workspace));
  }

  private row(raw: Record<string, unknown>): Promo {
    const code = String(raw.code);
    return { code, kind: raw.kind as PromoKind, value: Number(raw.value), maxUses: raw.max_uses === null ? null : Number(raw.max_uses),
      expiresAt: raw.expires_at === null ? null : Number(raw.expires_at), plans: raw.plans ? String(raw.plans).split(",") as PlanId[] : null,
      note: raw.note === null ? null : String(raw.note), active: Number(raw.active) === 1, createdAt: Number(raw.created_at), createdBy: String(raw.created_by), uses: this.uses(code),
      ambassador: raw.ambassador ? String(raw.ambassador) : null, credits: raw.credits === null || raw.credits === undefined ? null : Number(raw.credits),
      email: raw.email ? String(raw.email) : null, batch: raw.batch ? String(raw.batch) : null };
  }

  get(code: string): Promo | null {
    const raw = this.db.prepare("SELECT * FROM promo_codes WHERE code = ?").get(normalizeCode(code)) as Record<string, unknown> | undefined;
    return raw ? this.row(raw) : null;
  }

  /** Codes made one at a time; generated lots are listed by `batches`. */
  all(): Promo[] {
    return (this.db.prepare("SELECT * FROM promo_codes WHERE batch IS NULL ORDER BY created_at DESC").all() as Array<Record<string, unknown>>).map((raw) => this.row(raw));
  }

  create(input: { code: string; kind: PromoKind; value: number; maxUses: number | null; expiresAt: number | null; plans: PlanId[] | null; note: string | null; ambassador?: string;
    credits?: number; email?: string; batch?: string }, actor: string): "ok" | "exists" | "invalid" {
    const code = normalizeCode(input.code);
    const valid = PROMO_CODE.test(code) && Number.isInteger(input.value)
      && (input.kind === "percent" ? input.value >= 1 && input.value <= 100
        : input.kind === "plan" ? validPlanGift(input.value, input.credits) && input.plans?.length === 1 && input.plans[0] !== "trial"
        : input.value >= 1 && input.value <= 1_000_000)
      && (input.maxUses === null || (Number.isInteger(input.maxUses) && input.maxUses >= 1));
    if (!valid) return "invalid";
    if (this.get(code)) return "exists";
    this.db.prepare("INSERT INTO promo_codes (code, kind, value, max_uses, expires_at, plans, note, active, created_at, created_by, ambassador, credits, email, batch) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?)")
      .run(code, input.kind, input.value, input.maxUses, input.expiresAt, input.plans?.length ? input.plans.join(",") : null, input.note, this.now(), actor, input.ambassador ?? null,
        input.kind === "plan" ? input.credits ?? 0 : null, input.email?.trim().toLowerCase() || null, input.batch ?? null);
    return "ok";
  }

  /** A single-use plan code; with `email`, only that person's workspace may use it. */
  createPlanCode(input: { plan: PlanId; days: number; credits: number; email?: string; expiresAt: number | null; note: string | null; prefix?: string }, actor: string): string | null {
    const prefix = batchPrefix(input.prefix ?? "");
    if (!prefix) return null;
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const code = `${prefix}-${randomBlock(4)}-${randomBlock(4)}`;
      const made = this.create({ code, kind: "plan", value: input.days, maxUses: 1, expiresAt: input.expiresAt, plans: [input.plan], note: input.note, credits: input.credits, email: input.email }, actor);
      if (made === "ok") return code;
      if (made === "invalid") return null;
    }
    return null;
  }

  /** Generates `count` single-use plan codes as one lot; null when the input is not valid. */
  createBatch(input: { plan: PlanId; days: number; credits: number; count: number; prefix: string; expiresAt: number | null; note: string | null }, actor: string): { id: string; codes: string[] } | null {
    const prefix = batchPrefix(input.prefix);
    if (!prefix || !Number.isInteger(input.count) || input.count < 1 || input.count > MAX_BATCH || input.plan === "trial" || !validPlanGift(input.days, input.credits)) return null;
    const id = `lot_${randomBlock(10).toLowerCase()}`;
    const codes = new Set<string>();
    return this.db.transaction(() => {
      while (codes.size < input.count) {
        const code = `${prefix}-${randomBlock(4)}-${randomBlock(4)}`;
        if (codes.has(code) || this.db.prepare("SELECT 1 FROM promo_codes WHERE code = ?").get(code)) continue;
        codes.add(code);
        this.db.prepare("INSERT INTO promo_codes (code, kind, value, max_uses, expires_at, plans, note, active, created_at, created_by, credits, batch) VALUES (?, 'plan', ?, 1, ?, ?, ?, 1, ?, ?, ?, ?)")
          .run(code, input.days, input.expiresAt, input.plan, input.note, this.now(), actor, input.credits, id);
      }
      return { id, codes: [...codes] };
    });
  }

  batches(): PromoBatch[] {
    const rows = this.db.prepare(`SELECT p.batch AS id, MIN(p.plans) AS plan, MIN(p.value) AS days, MIN(p.credits) AS credits, COUNT(*) AS count, SUM(p.active) AS active,
      (SELECT COUNT(*) FROM promo_redemptions r JOIN promo_codes c ON c.code = r.code WHERE c.batch = p.batch) AS used,
      MIN(p.expires_at) AS expires_at, MIN(p.note) AS note, MIN(p.created_at) AS created_at, MIN(p.created_by) AS created_by
      FROM promo_codes p WHERE p.batch IS NOT NULL GROUP BY p.batch ORDER BY created_at DESC`).all() as Array<Record<string, unknown>>;
    return rows.map((row) => ({ id: String(row.id), plan: String(row.plan) as PlanId, days: Number(row.days), credits: Number(row.credits), count: Number(row.count),
      used: Number(row.used), active: Number(row.active), expiresAt: row.expires_at === null ? null : Number(row.expires_at), note: row.note === null ? null : String(row.note),
      createdAt: Number(row.created_at), createdBy: String(row.created_by) }));
  }

  batchCodes(batch: string): BatchCode[] {
    return (this.db.prepare(`SELECT p.code, p.active, r.workspace, r.at FROM promo_codes p LEFT JOIN promo_redemptions r ON r.code = p.code
      WHERE p.batch = ? ORDER BY p.code`).all(batch) as Array<Record<string, unknown>>)
      .map((row) => ({ code: String(row.code), active: Number(row.active) === 1, workspace: row.workspace ? String(row.workspace) : null, usedAt: row.at === null ? null : Number(row.at) }));
  }

  setBatchActive(batch: string, active: boolean): number {
    return Number(this.db.prepare("UPDATE promo_codes SET active = ? WHERE batch = ?").run(active ? 1 : 0, batch).changes);
  }

  setActive(code: string, active: boolean): boolean {
    return Number(this.db.prepare("UPDATE promo_codes SET active = ? WHERE code = ?").run(active ? 1 : 0, normalizeCode(code)).changes) === 1;
  }

  remove(code: string): void {
    this.db.prepare("DELETE FROM promo_codes WHERE code = ?").run(normalizeCode(code));
  }

  /** Whether a workspace may use the code now, for `plan` when it is a percentage. */
  check(value: string, workspace: string, plan?: PlanId): PromoCheck {
    const promo = this.get(value);
    if (!promo || !promo.active) return { ok: false, error: "Ce code n'existe pas ou n'est plus valable." };
    if (promo.expiresAt !== null && promo.expiresAt <= this.now()) return { ok: false, error: "Ce code a expiré." };
    if (promo.maxUses !== null && promo.uses >= promo.maxUses) return { ok: false, error: "Ce code a déjà été utilisé le nombre de fois prévu." };
    if (this.usedBy(promo.code, workspace)) return { ok: false, error: "Ce code a déjà été utilisé pour cet espace." };
    if (plan && promo.kind === "percent" && (plan === "trial" || (promo.plans && !promo.plans.includes(plan)))) return { ok: false, error: "Ce code ne s'applique pas à ce forfait." };
    return { ok: true, promo };
  }

  /** Gives a credits code's credits to the workspace once. */
  redeemCredits(value: string, workspace: string): PromoCheck {
    const checked = this.check(value, workspace);
    if (!checked.ok) return checked;
    if (checked.promo.kind === "percent") return { ok: false, error: "Ce code donne une réduction : choisissez un forfait pour l'utiliser." };
    if (checked.promo.kind !== "credits") return { ok: false, error: "Ce code active un forfait." };
    if (checked.promo.ambassador) return { ok: false, error: "Ce code n'est plus valable." };
    return this.db.transaction((): PromoCheck => {
      const claimed = this.db.prepare("INSERT INTO promo_redemptions (code, workspace, at) VALUES (?, ?, ?) ON CONFLICT DO NOTHING").run(checked.promo.code, workspace, this.now());
      if (Number(claimed.changes) !== 1) return { ok: false, error: "Ce code a déjà été utilisé pour cet espace." };
      this.wallet.credit(workspace, checked.promo.value * MICRO, "grant", `Code ${checked.promo.code}`);
      return checked;
    });
  }

  /** Activates a plan code's plan for its days with its credits, once; `emails` are the workspace's members, checked against a code made for one person.
   * A workspace whose paid plan is running is refused, since the gift would replace its end date. */
  redeemPlan(value: string, workspace: string, emails: string[], billing: Pick<Billing, "subscription" | "giftPlan">): PromoCheck {
    const checked = this.check(value, workspace);
    if (!checked.ok) return checked;
    const promo = checked.promo;
    const plan = promo.plans?.[0];
    if (promo.kind !== "plan" || !plan) return { ok: false, error: "Ce code n'active pas de forfait." };
    if (promo.email && !emails.map((email) => email.toLowerCase()).includes(promo.email)) return { ok: false, error: "Ce code est réservé à un autre compte." };
    const current = billing.subscription(workspace);
    if (current.status === "active") return { ok: false, error: "Votre compte a déjà un abonnement actif." };
    return this.db.transaction((): PromoCheck => {
      if (promo.maxUses !== null && this.uses(promo.code) >= promo.maxUses) return { ok: false, error: "Ce code a déjà été utilisé le nombre de fois prévu." };
      const claimed = this.db.prepare("INSERT INTO promo_redemptions (code, workspace, at) VALUES (?, ?, ?) ON CONFLICT DO NOTHING").run(promo.code, workspace, this.now());
      if (Number(claimed.changes) !== 1) return { ok: false, error: "Ce code a déjà été utilisé pour cet espace." };
      billing.giftPlan(workspace, promo.email ?? emails[0] ?? "", plan, promo.value, promo.credits ?? 0);
      return { ok: true, promo };
    });
  }
}

function validPlanGift(days: number, credits: number | undefined): boolean {
  return Number.isInteger(days) && days >= 1 && days <= MAX_PLAN_DAYS && Number.isInteger(credits) && credits! >= 0 && credits! <= MAX_PLAN_CREDITS;
}

/** A dollar price after a percentage off, to the cent; never free, since a checkout needs an amount. */
export function discounted(usd: number, percent: number): number {
  return Math.max(0.01, Math.round(usd * (100 - percent)) / 100);
}
