// What the operator changes from the console without a redeploy: plan prices and allowances, the franc rate, what is open
// to new customers, and the announcement the site and the portal show.
import { PLANS, type Plan, type PlanId } from "./plans.ts";
import type { SqlDatabase } from "./sql.ts";

/** The parts of a plan the operator may change; the rest (name, gateway, listed) is fixed by the code that relies on it. */
export type PlanOverride = Partial<Pick<Plan, "usd" | "usdYear" | "credits" | "computerHours" | "computers">>;
export const PLAN_FIELDS = ["usd", "usdYear", "credits", "computerHours", "computers"] as const;

export type Switch = "signups" | "payments" | "trial";
export const SWITCHES: ReadonlyArray<[Switch, string, string]> = [
  ["signups", "Nouveaux comptes", "Fermé : seules les personnes qui ont déjà un compte peuvent se connecter."],
  ["payments", "Paiements", "Fermé : aucun forfait ni recharge ne peut être acheté (maintenance de SasPay, par exemple)."],
  ["trial", "Essai 3 jours", "Fermé : l'essai n'est plus vendu, les forfaits restent en vente."],
];

export type AnnouncementLevel = "info" | "promo" | "warning";
export interface Announcement { text: string; link: string | null; level: AnnouncementLevel; until: number | null; at: number }

export class OperatorSettings {
  readonly db: SqlDatabase;
  private readonly now: () => number;

  constructor(db: SqlDatabase, now: () => number = Date.now) {
    this.db = db;
    this.now = now;
    db.exec("CREATE TABLE IF NOT EXISTS operator_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, at INTEGER NOT NULL)");
  }

  private read(key: string): string | null {
    const row = this.db.prepare("SELECT value FROM operator_settings WHERE key = ?").get(key) as { value: string } | undefined;
    return row?.value ?? null;
  }

  private write(key: string, value: string | null): void {
    if (value === null) this.db.prepare("DELETE FROM operator_settings WHERE key = ?").run(key);
    else this.db.prepare("INSERT INTO operator_settings (key, value, at) VALUES (?, ?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value, at = excluded.at").run(key, value, this.now());
  }

  isOpen(name: Switch): boolean {
    return this.read(`open:${name}`) !== "0";
  }

  setOpen(name: Switch, open: boolean): void {
    this.write(`open:${name}`, open ? null : "0");
  }

  /** The plan as sold now: the code's values with the operator's changes. */
  plan(id: PlanId): Plan {
    const raw = this.read(`plan:${id}`);
    if (!raw) return PLANS[id];
    const override = JSON.parse(raw) as PlanOverride;
    return { ...PLANS[id], ...override, usdYear: PLANS[id].usdYear === null ? null : override.usdYear ?? PLANS[id].usdYear };
  }

  plans(): Record<PlanId, Plan> {
    return Object.fromEntries(Object.keys(PLANS).map((id) => [id, this.plan(id as PlanId)])) as Record<PlanId, Plan>;
  }

  overridden(id: PlanId): boolean {
    return this.read(`plan:${id}`) !== null;
  }

  /** Saves the values that differ from the code's; values equal to the code's are dropped, so a reset is saving the defaults. */
  setPlan(id: PlanId, values: PlanOverride): void {
    const base = PLANS[id];
    const changed = Object.fromEntries(PLAN_FIELDS.filter((key) => values[key] !== undefined && values[key] !== base[key]).map((key) => [key, values[key]]));
    this.write(`plan:${id}`, Object.keys(changed).length ? JSON.stringify(changed) : null);
  }

  /** CFA francs to the dollar the operator set; null to use the environment's. */
  xofPerUsd(): number | null {
    const value = Number(this.read("xof_per_usd"));
    return value > 0 ? value : null;
  }

  setXofPerUsd(value: number | null): void {
    this.write("xof_per_usd", value && value > 0 ? String(value) : null);
  }

  /** The announcement still running, or null. */
  announcement(): Announcement | null {
    const raw = this.read("announcement");
    if (!raw) return null;
    const value = JSON.parse(raw) as Announcement;
    return value.until !== null && value.until <= this.now() ? null : value;
  }

  setAnnouncement(value: Omit<Announcement, "at"> | null): void {
    this.write("announcement", value ? JSON.stringify({ ...value, at: this.now() }) : null);
  }
}
