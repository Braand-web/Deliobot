import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { Billing } from "./plans.ts";
import { nodeDatabase } from "./sql-node.ts";
import { AdminStore } from "./store.ts";
import { MICRO, Wallet } from "./wallet.ts";

const DAY = 24 * 60 * 60_000;
const cleanups: Array<() => void> = [];
afterEach(() => { for (const cleanup of cleanups.splice(0)) cleanup(); });

function setup() {
  const dir = mkdtempSync(join(tmpdir(), "delio-change-"));
  const clock = { now: Date.parse("2026-11-18T12:00:00Z") };
  const store = new AdminStore({ db: nodeDatabase(join(dir, "a.db")), secret: randomBytes(32), now: () => clock.now });
  cleanups.push(() => { store.close(); rmSync(dir, { recursive: true, force: true }); });
  const wallet = new Wallet(store.db, { now: () => clock.now });
  const billing = new Billing(wallet, () => clock.now);
  store.createWorkspace({ slug: "acme", name: "Acme", tenantUrl: "https://a.test", ownerEmail: "o@a.test" }, "t");
  const pay = (plan: "max" | "starter" | "pro", cycle: "month" | "year") => {
    const order = billing.createOrder({ workspace: "acme", email: "o@a.test", kind: "plan", plan, cycle }, "XOF");
    billing.fulfil(order.id);
  };
  return { billing, wallet, clock, pay };
}

describe("changing plans while one is paid for", () => {
  it("keeps a yearly Max running to its end and starts the new plan after it, with its own credits then", () => {
    const { billing, wallet, clock, pay } = setup();
    pay("max", "year");
    const end = billing.subscription("acme").periodEnd;
    clock.now += 30 * DAY;
    pay("starter", "month");
    expect(billing.subscription("acme")).toMatchObject({ plan: "max", cycle: "year", periodEnd: end });
    expect(billing.startsAt("acme", "pro", "month")).toBe(end);
    clock.now = end + 1;
    const before = wallet.balance("acme");
    billing.grantDue();
    expect(billing.subscription("acme")).toMatchObject({ plan: "starter", status: "active" });
    expect(wallet.balance("acme") - before).toBe(1300 * MICRO);
  });

  it("moves a monthly plan up to a dearer one at once", () => {
    const { billing, pay } = setup();
    pay("starter", "month");
    pay("max", "month");
    expect(billing.subscription("acme")).toMatchObject({ plan: "max", status: "active" });
  });

  it("renews the same plan after the current period, and upgrades a trial at once", () => {
    const { billing, clock, pay } = setup();
    pay("pro", "month");
    const end = billing.subscription("acme").periodEnd;
    pay("pro", "month");
    expect(billing.subscription("acme").periodEnd).toBe(end + 30 * DAY);
    clock.now = end + 60 * DAY;
    billing.grantDue();
    expect(billing.startsAt("acme", "max", "month")).toBe(clock.now);
  });
});
