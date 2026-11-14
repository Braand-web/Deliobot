import { describe, expect, it } from "vitest";
import { Billing } from "./plans.ts";
import { AdminStore } from "./store.ts";
import { nodeDatabase } from "./sql-node.ts";
import { Wallet, MICRO } from "./wallet.ts";

describe("yearly credit grants", () => {
  it("rolls the credit and ledger back with a failed schedule update, then grants the month only once", () => {
    let now = Date.now();
    const db = nodeDatabase(":memory:");
    try {
      const store = new AdminStore({ db, secret: Buffer.alloc(32), now: () => now });
      store.createWorkspace({ slug: "fixture", name: "Fixture", tenantUrl: "https://fixture.test", ownerEmail: "owner@fixture.test" }, "owner@fixture.test");
      const wallet = new Wallet(db, { now: () => now });
      const billing = new Billing(wallet, () => now);
      billing.grantPlan("fixture", "owner@fixture.test", "max", "year", "XOF");
      const initial = wallet.balance("fixture");
      now += 31 * 24 * 60 * 60_000;
      db.exec("CREATE TRIGGER fail_schedule BEFORE UPDATE OF next_grant_at ON subscriptions BEGIN SELECT RAISE(ABORT, 'schedule write failed'); END");
      expect(() => billing.grantDue()).toThrow("schedule write failed");
      expect(wallet.balance("fixture")).toBe(initial);
      expect(db.prepare("SELECT COUNT(*) AS n FROM credit_ledger WHERE kind = 'grant'").get()).toEqual({ n: 1 });
      db.exec("DROP TRIGGER fail_schedule");
      expect(billing.grantDue()).toBe(1);
      expect(wallet.balance("fixture")).toBe(initial + 13500 * MICRO);
      expect(billing.grantDue()).toBe(0);
      expect(wallet.balance("fixture")).toBe(initial + 13500 * MICRO);
    } finally { db.close(); }
  });
});
