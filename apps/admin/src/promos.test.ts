import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { Billing } from "./plans.ts";
import { Promos } from "./promos.ts";
import { nodeDatabase } from "./sql-node.ts";
import { AdminStore } from "./store.ts";
import { MICRO, Wallet } from "./wallet.ts";

const DAY = 24 * 60 * 60_000;
const cleanups: Array<() => void> = [];
afterEach(() => { for (const cleanup of cleanups.splice(0).reverse()) cleanup(); });

function base() {
  const dir = mkdtempSync(join(tmpdir(), "delio-promos-"));
  const clock = { now: Date.parse("2026-11-26T12:00:00Z") };
  const store = new AdminStore({ db: nodeDatabase(join(dir, "admin.db")), secret: randomBytes(32), now: () => clock.now });
  cleanups.push(() => { store.close(); rmSync(dir, { recursive: true, force: true }); });
  const wallet = new Wallet(store.db, { now: () => clock.now });
  const billing = new Billing(wallet, () => clock.now);
  const promos = new Promos(wallet, () => clock.now);
  for (const slug of ["acme", "beta"]) store.createWorkspace({ slug, name: slug, tenantUrl: `https://${slug}.example`, ownerEmail: `owner@${slug}.test` }, "test");
  return { wallet, billing, promos, clock };
}

describe("plan codes", () => {
  it("generates a lot of distinct single-use codes that read clearly", () => {
    const { promos } = base();
    const lot = promos.createBatch({ plan: "pro", days: 30, credits: 5500, count: 50, prefix: "delio", expiresAt: null, note: "Salon" }, "ops")!;
    expect(new Set(lot.codes).size).toBe(50);
    for (const code of lot.codes) expect(code).toMatch(/^DELIO-[2-9A-HJKMNP-Z]{4}-[2-9A-HJKMNP-Z]{4}$/);
    expect(promos.batches()).toMatchObject([{ id: lot.id, plan: "pro", days: 30, credits: 5500, count: 50, used: 0, active: 50, note: "Salon" }]);
    expect(promos.all(), "lots stay off the list of single codes").toEqual([]);
    expect(promos.createBatch({ plan: "pro", days: 30, credits: 0, count: 1001, prefix: "DELIO", expiresAt: null, note: null }, "ops")).toBeNull();
    expect(promos.createBatch({ plan: "trial", days: 30, credits: 0, count: 1, prefix: "DELIO", expiresAt: null, note: null }, "ops")).toBeNull();
    expect(promos.createBatch({ plan: "pro", days: 30, credits: -1, count: 1, prefix: "DELIO", expiresAt: null, note: null }, "ops")).toBeNull();
  });

  it("activates the plan with the lot's own credits, once, as a free order", () => {
    const { promos, billing, wallet, clock } = base();
    const [code, other] = promos.createBatch({ plan: "pro", days: 30, credits: 2000, count: 2, prefix: "DELIO", expiresAt: null, note: null }, "ops")!.codes as [string, string];
    expect(promos.redeemPlan(code.toLowerCase(), "acme", ["owner@acme.test"], billing).ok).toBe(true);
    expect(billing.subscription("acme")).toMatchObject({ plan: "pro", status: "active", periodEnd: clock.now + 30 * DAY });
    expect(wallet.balance("acme")).toBe(2000 * MICRO);
    expect(billing.orders("acme", 5)).toMatchObject([{ kind: "plan", plan: "pro", usd: 0, status: "paid", credits: 2000 }]);
    expect(promos.redeemPlan(code, "beta", ["owner@beta.test"], billing)).toMatchObject({ ok: false, error: "Ce code a déjà été utilisé le nombre de fois prévu." });
    expect(promos.redeemPlan(other, "acme", ["owner@acme.test"], billing)).toMatchObject({ ok: false, error: "Votre compte a déjà un abonnement actif." });
    expect(promos.batchCodes(promos.batches()[0]!.id).find((row) => row.code === code)).toMatchObject({ workspace: "acme", usedAt: clock.now });
  });

  it("gives the plan without credits when the lot has none", () => {
    const { promos, billing, wallet } = base();
    const [code] = promos.createBatch({ plan: "max", days: 7, credits: 0, count: 1, prefix: "VIP", expiresAt: null, note: null }, "ops")!.codes as [string];
    expect(promos.redeemPlan(code, "acme", ["owner@acme.test"], billing).ok).toBe(true);
    expect(billing.allowance("acme")).toMatchObject({ plan: "max", ownAi: true });
    expect(wallet.balance("acme")).toBe(0);
  });

  it("refuses expired, disabled and other people's codes", () => {
    const { promos, billing, clock } = base();
    const lot = promos.createBatch({ plan: "starter", days: 30, credits: 1300, count: 2, prefix: "DELIO", expiresAt: clock.now + DAY, note: null }, "ops")!;
    promos.setBatchActive(lot.id, false);
    expect(promos.redeemPlan(lot.codes[0]!, "acme", ["owner@acme.test"], billing).ok).toBe(false);
    promos.setBatchActive(lot.id, true);
    clock.now += 2 * DAY;
    expect(promos.redeemPlan(lot.codes[0]!, "acme", ["owner@acme.test"], billing)).toMatchObject({ ok: false, error: "Ce code a expiré." });
    const personal = promos.createPlanCode({ plan: "pro", days: 30, credits: 3000, email: "Friend@Example.test", expiresAt: null, note: null }, "ops")!;
    expect(promos.get(personal)).toMatchObject({ kind: "plan", email: "friend@example.test", credits: 3000, maxUses: 1 });
    expect(promos.redeemPlan(personal, "beta", ["owner@beta.test"], billing)).toMatchObject({ ok: false, error: "Ce code est réservé à un autre compte." });
    expect(promos.redeemPlan(personal, "acme", ["owner@acme.test", "friend@example.test"], billing).ok).toBe(true);
    expect(promos.redeemCredits(personal, "beta").ok).toBe(false);
  });

  it("lets a workspace whose trial or plan has ended use a code", () => {
    const { promos, billing, clock } = base();
    billing.giftPlan("acme", "owner@acme.test", "starter", 1, 0);
    clock.now += 2 * DAY;
    const [code] = promos.createBatch({ plan: "pro", days: 30, credits: 100, count: 1, prefix: "DELIO", expiresAt: null, note: null }, "ops")!.codes as [string];
    expect(promos.redeemPlan(code, "acme", ["owner@acme.test"], billing).ok).toBe(true);
    expect(billing.subscription("acme")).toMatchObject({ plan: "pro", status: "active" });
  });
});
