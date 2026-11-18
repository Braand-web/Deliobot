import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import type { MailMessage } from "./mail.ts";
import { OperatorSettings } from "./operator-settings.ts";
import { Outbox } from "./outbox.ts";
import { Billing, catalog } from "./plans.ts";
import { Promos } from "./promos.ts";
import { nodeDatabase } from "./sql-node.ts";
import { AdminStore } from "./store.ts";
import { operatorConsole } from "./test-console.ts";
import { MICRO, Wallet } from "./wallet.ts";

const cleanups: Array<() => void | Promise<void>> = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });

function base() {
  const dir = mkdtempSync(join(tmpdir(), "delio-settings-"));
  const clock = { now: Date.parse("2026-11-18T12:00:00Z") };
  const store = new AdminStore({ db: nodeDatabase(join(dir, "admin.db")), secret: randomBytes(32), now: () => clock.now });
  cleanups.push(() => { store.close(); rmSync(dir, { recursive: true, force: true }); });
  const wallet = new Wallet(store.db, { now: () => clock.now });
  const settings = new OperatorSettings(store.db, () => clock.now);
  const billing = new Billing(wallet, () => clock.now, settings);
  const promos = new Promos(wallet, () => clock.now);
  store.createWorkspace({ slug: "acme", name: "Acme", tenantUrl: "https://acme.example", ownerEmail: "owner@acme.test" }, "test");
  store.createWorkspace({ slug: "beta", name: "Beta", tenantUrl: "https://beta.example", ownerEmail: "owner@beta.test" }, "test");
  return { store, wallet, settings, billing, promos, clock };
}

describe("promo codes", () => {
  it("takes a percentage off a plan's order and counts the code once it is paid", () => {
    const { billing, promos } = base();
    expect(promos.create({ code: "launch20", kind: "percent", value: 20, maxUses: 1, expiresAt: null, plans: ["pro"], note: null }, "ops")).toBe("ok");
    expect(promos.check("LAUNCH20", "acme", "starter")).toMatchObject({ ok: false });
    expect(promos.check("LAUNCH20", "acme", "trial")).toMatchObject({ ok: false });
    const order = billing.createOrder({ workspace: "acme", email: "owner@acme.test", kind: "plan", plan: "pro", cycle: "month", promo: { code: "LAUNCH20", percent: 20 } }, "XOF");
    expect(order).toMatchObject({ usd: 39.2, amount: "23520.00", promo: "LAUNCH20" });
    expect(promos.check("LAUNCH20", "beta", "pro").ok).toBe(true);
    billing.fulfil(order.id);
    expect(promos.check("LAUNCH20", "beta", "pro")).toEqual({ ok: false, error: "Ce code a déjà été utilisé le nombre de fois prévu." });
  });

  it("gives a credits code's credits once per workspace, and refuses an expired or disabled code", () => {
    const { wallet, promos, clock } = base();
    promos.create({ code: "MERCI", kind: "credits", value: 500, maxUses: null, expiresAt: clock.now + 1000, plans: null, note: null }, "ops");
    expect(promos.redeemCredits("merci", "acme").ok).toBe(true);
    expect(wallet.balance("acme")).toBe(500 * MICRO);
    expect(promos.redeemCredits("MERCI", "acme")).toMatchObject({ ok: false, error: "Ce code a déjà été utilisé pour cet espace." });
    promos.setActive("MERCI", false);
    expect(promos.redeemCredits("MERCI", "beta").ok).toBe(false);
    promos.setActive("MERCI", true);
    clock.now += 2000;
    expect(promos.redeemCredits("MERCI", "beta")).toMatchObject({ ok: false, error: "Ce code a expiré." });
    expect(promos.create({ code: "x", kind: "percent", value: 150, maxUses: null, expiresAt: null, plans: null, note: null }, "ops")).toBe("invalid");
  });
});

describe("the operator's plan settings", () => {
  it("sells plans at the operator's price, credits and franc rate, and resets to the code's values", () => {
    const { billing, settings } = base();
    settings.setPlan("pro", { usd: 45, credits: 6000, computers: 2 });
    settings.setXofPerUsd(655.96);
    const order = billing.createOrder({ workspace: "acme", email: "owner@acme.test", kind: "plan", plan: "pro", cycle: "month" }, "XOF");
    expect(order).toMatchObject({ usd: 45, credits: 6000, amount: "29519.00" });
    const pro = billing.catalog().plans.find((plan) => plan.id === "pro")!;
    expect(pro).toMatchObject({ usd: 45, usdYear: 539, credits: 6000, francs: 29519 });
    expect(settings.overridden("pro")).toBe(true);
    settings.setPlan("pro", { usd: 49, credits: 5500 });
    expect(settings.overridden("pro")).toBe(false);
    expect(billing.catalog(600)).toEqual({ ...catalog(655.96) });
  });

  it("keeps the announcement until its end date", () => {
    const { settings, clock } = base();
    settings.setAnnouncement({ text: "-20 % sur Pro", link: null, level: "promo", until: clock.now + 1000 });
    expect(settings.announcement()?.text).toBe("-20 % sur Pro");
    clock.now += 2000;
    expect(settings.announcement()).toBeNull();
  });
});

describe("e-mails to customers", () => {
  it("sends each address once, a few at a time, and records failures", async () => {
    const { store } = base();
    const outbox = new Outbox(store.db);
    expect(outbox.queue({ subject: "Nouveautés", text: "Bonjour", audience: "all", emails: ["a@x.test", "A@x.test", "b@x.test"] }, "ops")).toBe(2);
    const sent: string[] = [];
    await outbox.drain({ send: async (message) => { if (message.to === "b@x.test") throw new Error("refused"); sent.push(message.to); } }, async () => {});
    expect(sent).toEqual(["a@x.test"]);
    expect(outbox.broadcasts()[0]).toMatchObject({ subject: "Nouveautés", total: 2, sent: 1, failed: 1 });
  });
});

describe("the console's settings pages", () => {
  async function signedIn() {
    const setup = base();
    const mail: MailMessage[] = [];
    const ops = await operatorConsole({ store: setup.store, operators: new Set(["ops@delio.test"]), mailer: { send: async (message) => void mail.push(message) }, now: () => setup.clock.now }, mail);
    cleanups.push(() => ops.close());
    return { ...setup, ops };
  }

  it("opens every section instead of a coming-soon label", async () => {
    const { ops } = await signedIn();
    for (const path of ["/promos", "/communication", "/forfaits", "/systeme", "/securite"]) {
      const response = await ops.get(path);
      expect(response.status, path).toBe(200);
      expect(await response.text(), path).not.toContain("bientôt</span>");
    }
  });

  it("creates and disables a code, saves a price, closes the trial and publishes an announcement", async () => {
    const { ops, settings, promos } = await signedIn();
    expect((await ops.post("/promos", { code: "noel25", kind: "percent", value: "25", plans: "max" })).headers.get("location")).toBe("/promos?ok=promo-created");
    expect(promos.get("NOEL25")).toMatchObject({ value: 25, plans: ["max"] });
    await ops.post("/promos/NOEL25/desactiver", {});
    expect(promos.get("NOEL25")?.active).toBe(false);
    expect((await ops.post("/forfaits/starter", { usd: "12", credits: "1500" })).headers.get("location")).toBe("/forfaits?ok=plan-saved");
    expect(settings.plan("starter")).toMatchObject({ usd: 12, credits: 1500 });
    expect((await ops.post("/forfaits/starter", { usd: "-1" })).headers.get("location")).toBe("/forfaits?erreur=bad-plan");
    await ops.post("/systeme/trial", { open: "0" });
    expect(settings.isOpen("trial")).toBe(false);
    await ops.post("/communication/annonce", { text: "Nouvelle version", link: "https://deliobot.fun/#telecharger", level: "info" });
    expect(settings.announcement()).toMatchObject({ text: "Nouvelle version", link: "https://deliobot.fun/#telecharger" });
    expect((await ops.post("/communication/annonce", { text: "x", link: "javascript:alert(1)" })).headers.get("location")).toBe("/communication?erreur=bad-announcement");
  });

  it("queues an e-mail to workspace admins, with the opt-out line", async () => {
    const { ops, store } = await signedIn();
    expect((await ops.post("/communication/envoyer", { audience: "admins", subject: "Bonjour", body: "Du nouveau" })).headers.get("location")).toBe("/communication?ok=queued&n=2");
    const queued = store.db.prepare("SELECT email FROM outbox ORDER BY email").all() as Array<{ email: string }>;
    expect(queued.map((row) => row.email)).toEqual(["owner@acme.test", "owner@beta.test"]);
    expect((store.db.prepare("SELECT text FROM broadcasts").get() as { text: string }).text).toContain("répondez simplement « STOP »");
  });
});
