// Promo codes: a percentage off a plan, applied when its order is opened, or credits given at once. Each workspace uses a
// code once; a code's uses count paid orders and credit redemptions.
import type { PlanId } from "./plans.ts";
import type { SqlDatabase } from "./sql.ts";
import { MICRO, type Wallet } from "./wallet.ts";

export type PromoKind = "percent" | "credits";
export interface Promo {
  code: string; kind: PromoKind; value: number; maxUses: number | null; expiresAt: number | null;
  /** Plans a percentage applies to; null for all paid plans. */
  plans: PlanId[] | null; note: string | null; active: boolean; createdAt: number; createdBy: string; uses: number;
  /** The ambassador this code belongs to: their customers get credits at their first plan, and the ambassador a share. */
  ambassador: string | null;
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
  }

  private uses(code: string): number {
    const row = this.db.prepare(`SELECT (SELECT COUNT(*) FROM promo_redemptions WHERE code = ?) + (SELECT COUNT(*) FROM orders WHERE promo = ? AND status = 'paid') AS n`).get(code, code) as { n: number };
    return Number(row.n);
  }

  private usedBy(code: string, workspace: string): boolean {
    return Boolean(this.db.prepare("SELECT 1 FROM promo_redemptions WHERE code = ? AND workspace = ?").get(code, workspace)
      ?? this.db.prepare("SELECT 1 FROM orders WHERE promo = ? AND workspace = ? AND status = 'paid'").get(code, workspace));
  }

  private row(raw: Record<string, unknown>): Promo {
    const code = String(raw.code);
    return { code, kind: raw.kind as PromoKind, value: Number(raw.value), maxUses: raw.max_uses === null ? null : Number(raw.max_uses),
      expiresAt: raw.expires_at === null ? null : Number(raw.expires_at), plans: raw.plans ? String(raw.plans).split(",") as PlanId[] : null,
      note: raw.note === null ? null : String(raw.note), active: Number(raw.active) === 1, createdAt: Number(raw.created_at), createdBy: String(raw.created_by), uses: this.uses(code),
      ambassador: raw.ambassador ? String(raw.ambassador) : null };
  }

  get(code: string): Promo | null {
    const raw = this.db.prepare("SELECT * FROM promo_codes WHERE code = ?").get(normalizeCode(code)) as Record<string, unknown> | undefined;
    return raw ? this.row(raw) : null;
  }

  all(): Promo[] {
    return (this.db.prepare("SELECT * FROM promo_codes ORDER BY created_at DESC").all() as Array<Record<string, unknown>>).map((raw) => this.row(raw));
  }

  create(input: { code: string; kind: PromoKind; value: number; maxUses: number | null; expiresAt: number | null; plans: PlanId[] | null; note: string | null; ambassador?: string }, actor: string): "ok" | "exists" | "invalid" {
    const code = normalizeCode(input.code);
    const valid = PROMO_CODE.test(code) && Number.isInteger(input.value)
      && (input.kind === "percent" ? input.value >= 1 && input.value <= 100 : input.value >= 1 && input.value <= 1_000_000)
      && (input.maxUses === null || (Number.isInteger(input.maxUses) && input.maxUses >= 1));
    if (!valid) return "invalid";
    if (this.get(code)) return "exists";
    this.db.prepare("INSERT INTO promo_codes (code, kind, value, max_uses, expires_at, plans, note, active, created_at, created_by, ambassador) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)")
      .run(code, input.kind, input.value, input.maxUses, input.expiresAt, input.plans?.length ? input.plans.join(",") : null, input.note, this.now(), actor, input.ambassador ?? null);
    return "ok";
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
    if (checked.promo.kind !== "credits") return { ok: false, error: "Ce code donne une réduction : choisissez un forfait pour l'utiliser." };
    return this.db.transaction((): PromoCheck => {
      const claimed = this.db.prepare("INSERT INTO promo_redemptions (code, workspace, at) VALUES (?, ?, ?) ON CONFLICT DO NOTHING").run(checked.promo.code, workspace, this.now());
      if (Number(claimed.changes) !== 1) return { ok: false, error: "Ce code a déjà été utilisé pour cet espace." };
      this.wallet.credit(workspace, checked.promo.value * MICRO, "grant", `Code ${checked.promo.code}`);
      return checked;
    });
  }
}

/** A dollar price after a percentage off, to the cent; never free, since a checkout needs an amount. */
export function discounted(usd: number, percent: number): number {
  return Math.max(0.01, Math.round(usd * (100 - percent)) / 100);
}
