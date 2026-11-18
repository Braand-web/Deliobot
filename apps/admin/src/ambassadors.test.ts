import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { Ambassadors } from "./ambassadors.ts";
import { OperatorSettings } from "./operator-settings.ts";
import { Billing, type PlanId } from "./plans.ts";
import { Promos } from "./promos.ts";
import { nodeDatabase } from "./sql-node.ts";
import { AdminStore } from "./store.ts";
import { Traffic } from "./traffic.ts";
import { MICRO, Wallet } from "./wallet.ts";

const DAY = 24 * 60 * 60_000;
const cleanups: Array<() => void> = [];
afterEach(() => { for (const cleanup of cleanups.splice(0)) cleanup(); });

function setup() {
  const dir = mkdtempSync(join(tmpdir(), "delio-amb-"));
  const clock = { now: Date.parse("2026-11-18T12:00:00Z") };
  const store = new AdminStore({ db: nodeDatabase(join(dir, "admin.db")), secret: randomBytes(32), now: () => clock.now });
  cleanups.push(() => { store.close(); rmSync(dir, { recursive: true, force: true }); });
  const now = () => clock.now;
  const wallet = new Wallet(store.db, { now });
  new Traffic(store.db, now);
  const settings = new OperatorSettings(store.db, now);
  const billing = new Billing(wallet, now, settings);
  const promos = new Promos(wallet, now);
  const ambassadors = new Ambassadors({ wallet, promos, settings, now });
  billing.onPaid((order) => ambassadors.recordPaid(order));
  const awa = ambassadors.apply({ name: "Awa Diallo", email: "awa@influence.test", phone: "+221700000000" }, "active")!;
  expect(ambassadors.createCode(awa, "awa")).toEqual({ ok: true, code: "AWA" });
  let customers = 0;
  const customer = (via = "AWA") => {
    const slug = `client${++customers}`;
    store.createWorkspace({ slug, name: slug, tenantUrl: `https://${slug}.test`, ownerEmail: `${slug}@client.test` }, "test");
    ambassadors.attribute(slug, via, "link", [`${slug}@client.test`]);
    return slug;
  };
  const pay = (workspace: string, plan: PlanId, cycle: "month" | "year" = "month") => {
    const order = billing.createOrder({ workspace, email: `${workspace}@client.test`, kind: "plan", plan, cycle }, "XOF");
    billing.fulfil(order.id);
    return order;
  };
  return { store, wallet, settings, billing, promos, ambassadors, awa, clock, customer, pay };
}

describe("the ambassador programme", () => {
  it("pays a share of each plan, gives the customer 500 credits at their first plan only, and nothing on a top-up", () => {
    const { ambassadors, awa, wallet, billing, customer, pay } = setup();
    const client = customer();
    pay(client, "pro");
    expect(wallet.balance(client)).toBe((5500 + 500) * MICRO);
    pay(client, "pro");
    expect(wallet.balance(client)).toBe((5500 * 2 + 500) * MICRO);
    const topup = billing.createOrder({ workspace: client, email: "c@client.test", kind: "topup", topup: "small" }, "XOF");
    billing.fulfil(topup.id);
    const rows = ambassadors.commissions(awa.id);
    expect(rows.map((row) => [row.kind, row.rate, row.usd])).toEqual([["plan", 0.15, 7.35], ["plan", 0.15, 7.35]]);
    expect(ambassadors.stats(awa)).toMatchObject({ paying: 1, revenueUsd: 98, heldUsd: 14.7, payableUsd: 0 });
  });

  it("never pays on the ambassador's own workspace, a granted plan, or for a suspended ambassador", () => {
    const { store, ambassadors, awa, billing, customer, pay } = setup();
    store.createWorkspace({ slug: "awa-own", name: "Awa", tenantUrl: "https://a.test", ownerEmail: "awa@influence.test" }, "test");
    expect(ambassadors.attribute("awa-own", "AWA", "code", ["awa@influence.test"])).toBe(false);
    const client = customer();
    billing.grantPlan(client, "ops@delio.test", "max", "month", "XOF");
    ambassadors.update(awa.id, { status: "suspended" });
    pay(client, "pro");
    expect(ambassadors.commissions(awa.id)).toEqual([]);
  });

  it("keeps the first ambassador who brought a customer", () => {
    const { ambassadors, awa, customer } = setup();
    const moussa = ambassadors.apply({ name: "Moussa", email: "moussa@influence.test" }, "active")!;
    ambassadors.createCode(moussa, "MOUSSA");
    const client = customer("AWA");
    expect(ambassadors.attribute(client, "MOUSSA", "code", [])).toBe(false);
    expect(ambassadors.referral(client)?.ambassador).toBe(awa.id);
  });

  it("gives a trial bonus only once a plan follows, and lets commissions be paid after 14 days", () => {
    const { ambassadors, awa, clock, customer, pay } = setup();
    const lapsed = customer();
    pay(lapsed, "trial");
    clock.now += 31 * DAY;
    ambassadors.sweep();
    expect(ambassadors.commissions(awa.id).map((row) => row.status)).toEqual(["void"]);

    const converted = customer();
    pay(converted, "trial");
    clock.now += 2 * DAY;
    pay(converted, "starter");
    clock.now += 13 * DAY;
    ambassadors.sweep();
    expect(ambassadors.stats(awa).payableUsd).toBe(0);
    clock.now += 2 * DAY;
    ambassadors.sweep();
    expect(ambassadors.stats(awa)).toMatchObject({ payableUsd: 3.25, availableUsd: 3.25 });
  });

  it("raises the rate with the level, stops after six months, and extends to twelve at 10 % once granted", () => {
    const { ambassadors, awa, clock, customer, pay } = setup();
    const clients = Array.from({ length: 10 }, () => customer());
    for (const client of clients) pay(client, "starter");
    expect(ambassadors.level(awa.id).level.id).toBe("argent");
    const late = clients[0]!;
    clock.now += 7 * 30 * DAY;
    pay(late, "starter");
    expect(ambassadors.commissions(awa.id).filter((row) => row.workspace === late)).toHaveLength(1);

    const big = customer();
    for (let month = 0; month < 6; month++) { pay(big, "max", "year"); clock.now += DAY; }
    expect(ambassadors.level(awa.id).level.id).toBe("or");
    const fresh = ambassadors.get(awa.id)!;
    expect(ambassadors.stats(fresh).canExtendTo).toBe(12);
    expect(ambassadors.requestExtension(fresh)).toBe(true);
    ambassadors.decideExtension(awa.id, true);
    expect(ambassadors.get(awa.id)!.months).toBe(12);
    clock.now += 7 * 30 * DAY;
    pay(big, "starter");
    expect(ambassadors.commissions(awa.id)[0]).toMatchObject({ workspace: big, rate: 0.1 });
  });

  it("refuses an extension below the threshold, a reserved or taken code and a fourth code", () => {
    const { ambassadors, awa } = setup();
    expect(ambassadors.requestExtension(awa)).toBe(false);
    expect(ambassadors.createCode(awa, "AWA")).toMatchObject({ ok: false });
    expect(ambassadors.createCode(awa, "DELIO-AWA")).toMatchObject({ ok: false });
    expect(ambassadors.createCode(awa, "AWA-TIKTOK")).toMatchObject({ ok: true });
    expect(ambassadors.createCode(awa, "AWA-INSTA")).toMatchObject({ ok: true });
    expect(ambassadors.createCode(awa, "AWA-FB")).toMatchObject({ ok: false, error: expect.stringContaining("3 codes") });
    expect(ambassadors.setCodeActive(awa.id, "AWA-INSTA", false)).toBe(true);
    expect(ambassadors.ambassadorForCode("AWA-INSTA")).toBeNull();
  });

  it("pays out in credits at once, and in Mobile Money from 5,000 francs once the operator marks it paid", () => {
    const { ambassadors, awa, wallet, store, clock, customer, pay } = setup();
    store.createWorkspace({ slug: "awa-own", name: "Awa", tenantUrl: "https://a.test", ownerEmail: "awa@influence.test" }, "test");
    const client = customer();
    pay(client, "starter");
    clock.now += 15 * DAY;
    ambassadors.sweep();
    expect(ambassadors.requestPayout(awa, "mobile_money", null, 600)).toMatchObject({ ok: false, error: expect.stringContaining("5") });
    expect(ambassadors.requestPayout(awa, "credits", "awa-own", 600)).toEqual({ ok: true, usd: 2.25 });
    expect(wallet.balance("awa-own")).toBe(Math.round(2.25 / wallet.creditUsd) * MICRO);
    expect(ambassadors.stats(awa).availableUsd).toBe(0);

    for (let index = 0; index < 4; index++) pay(customer(), "max");
    clock.now += 15 * DAY;
    ambassadors.sweep();
    const asked = ambassadors.requestPayout(awa, "mobile_money", null, 600);
    expect(asked).toMatchObject({ ok: true });
    const payout = ambassadors.payouts(awa.id)[0]!;
    expect(payout).toMatchObject({ mode: "mobile_money", status: "requested" });
    expect(ambassadors.markPayoutPaid(payout.id, "OM-12345", "ops@delio.test")).toMatchObject({ status: "paid", reference: "OM-12345" });
  });

  it("turns a suspended ambassador's codes off, and never gives their credits away as a plain code", () => {
    const { ambassadors, awa, promos, store } = setup();
    store.createWorkspace({ slug: "farm", name: "farm", tenantUrl: "https://f.test", ownerEmail: "farm@x.test" }, "test");
    expect(promos.redeemCredits("AWA", "farm")).toMatchObject({ ok: false });
    ambassadors.update(awa.id, { status: "suspended" });
    expect(promos.get("AWA")?.active).toBe(false);
    expect(promos.redeemCredits("AWA", "farm")).toMatchObject({ ok: false });
  });
});
