import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import type { MailMessage } from "./mail.ts";
import { Billing } from "./plans.ts";
import { AdminStore } from "./store.ts";
import { nodeDatabase } from "./sql-node.ts";
import { operatorConsole } from "./test-console.ts";
import { sourceOf, systemOf, deviceOf, Traffic } from "./traffic.ts";
import { MICRO, Wallet } from "./wallet.ts";

const cleanups: Array<() => void | Promise<void>> = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });

function fakeSasPay(status: { value: string }) {
  return (async (input: string | URL | Request) => {
    const url = new URL(String(input));
    if (/\/checkout-sessions\/[^/]+\/status\/$/.test(url.pathname)) return Response.json({ success: true, data: { status: status.value } });
    return new Response("{}", { status: 404 });
  }) as typeof fetch;
}

async function setup() {
  const dir = mkdtempSync(join(tmpdir(), "delio-console-"));
  const clock = { now: Date.parse("2026-11-10T12:00:00Z") };
  const store = new AdminStore({ db: nodeDatabase(join(dir, "admin.db")), secret: randomBytes(32), now: () => clock.now });
  const mail: MailMessage[] = [];
  const saspayStatus = { value: "PENDING" };
  const ops = await operatorConsole({ store, operators: new Set(["ops@delio.test"]), mailer: { send: async (message) => void mail.push(message) }, now: () => clock.now,
    fetchImpl: fakeSasPay(saspayStatus), payments: { saspayKey: "sk_test", currency: "XOF", apiUrl: "https://saspay.test/api/v1" } }, mail);
  cleanups.push(async () => { await ops.close(); store.close(); rmSync(dir, { recursive: true, force: true }); });
  const wallet = new Wallet(store.db, { now: () => clock.now });
  const billing = new Billing(wallet, () => clock.now);
  store.createWorkspace({ slug: "acme", name: "Acme", tenantUrl: "https://acme.example", ownerEmail: "owner@acme.test" }, "test");
  return { store, ops, wallet, billing, clock, saspayStatus };
}

describe("operators' console", () => {
  it("answers 404 to a signed-in customer on every page and action", async () => {
    const { store, ops } = await setup();
    const customer = store.ensureAccount("owner@acme.test");
    const session = store.createSession(customer.id);
    for (const path of ["/", "/trafic", "/clients", "/clients/acme", "/commandes", "/journal"]) {
      const response = await fetch(new URL(path, ops.origin), { redirect: "manual", headers: { cookie: `delio-admin=${session.token}` } });
      expect(response.status, path).toBe(404);
    }
    const action = await fetch(new URL("/clients/acme/credits", ops.origin), { method: "POST", redirect: "manual", body: "credits=1000",
      headers: { origin: ops.origin, cookie: `delio-admin=${session.token}`, "content-type": "application/x-www-form-urlencoded" } });
    expect(action.status).toBe(404);
  });

  it("shows revenue, subscribers and margin on the dashboard, with a nonce-only script policy", async () => {
    const { ops, billing, wallet } = await setup();
    const order = billing.createOrder({ workspace: "acme", email: "owner@acme.test", kind: "plan", plan: "pro", cycle: "month" }, "XOF");
    billing.fulfil(order.id);
    wallet.charge("acme", 1000 * MICRO, "openrouter", "some/model");
    const response = await ops.get("/?p=7d");
    expect(response.status).toBe(200);
    const page = await response.text();
    expect(page).toContain("Tableau de bord");
    expect(page).toContain("49 $");
    expect(page).toMatch(/29\s400 FCFA/);
    expect(page).toContain("OpenRouter (texte)");
    const nonce = /script-src 'nonce-([A-Za-z0-9_-]+)'/.exec(response.headers.get("content-security-policy") ?? "")?.[1];
    expect(nonce).toBeTruthy();
    expect(page).toContain(`<script nonce="${nonce}">`);
  });

  it("grants a plan as a free order: credits and period, but no revenue", async () => {
    const { ops, billing, wallet } = await setup();
    const response = await ops.post("/clients/acme/forfait", { plan: "pro", cycle: "month" });
    expect(response.headers.get("location")).toBe("/clients/acme?ok=plan");
    expect(wallet.balance("acme") / MICRO).toBe(5500);
    expect(billing.subscription("acme").status).toBe("active");
    const orders = await (await ops.get("/commandes")).text();
    expect(orders).toContain("Offert");
    expect(orders).toMatch(/Encaissé<\/div><div class="value">0 \$/);
  });

  it("adds and removes credits, refusing zero", async () => {
    const { ops, wallet } = await setup();
    await ops.post("/clients/acme/credits", { credits: "1000", note: "geste" });
    await ops.post("/clients/acme/credits", { credits: "-250" });
    expect(wallet.balance("acme") / MICRO).toBe(750);
    expect((await ops.post("/clients/acme/credits", { credits: "0" })).headers.get("location")).toBe("/clients/acme?erreur=bad-credits");
  });

  it("suspends a workspace's AI and resumes it", async () => {
    const { ops, billing } = await setup();
    await ops.post("/clients/acme/forfait", { plan: "starter", cycle: "month" });
    await ops.post("/clients/acme/suspendre", { suspended: "1", reason: "impayé" });
    expect(billing.allowance("acme")).toMatchObject({ gateway: false, ownAi: false });
    expect(await (await ops.get("/clients/acme")).text()).toContain("Espace suspendu");
    await ops.post("/clients/acme/suspendre", { suspended: "0" });
    expect(billing.allowance("acme")).toMatchObject({ gateway: true, plan: "starter" });
  });

  it("blocks an account's sign-in and sessions, but never an operator's", async () => {
    const { ops, store } = await setup();
    const customer = store.ensureAccount("owner@acme.test");
    const session = store.createSession(customer.id);
    await ops.post("/clients/acme/bloquer", { account: customer.id, blocked: "1" });
    expect(store.sessionAccount(session.token)).toBeNull();
    expect(store.sessionAccount(store.createSession(customer.id).token)).toBeNull();
    await ops.post("/clients/acme/bloquer", { account: customer.id, blocked: "0" });
    expect(store.sessionAccount(store.createSession(customer.id).token)?.email).toBe("owner@acme.test");
    const operator = store.ensureAccount("ops@delio.test");
    store.addMember("acme", operator.id, "member", "test");
    expect((await ops.post("/clients/acme/bloquer", { account: operator.id, blocked: "1" })).headers.get("location")).toBe("/clients/acme?erreur=operator");
    expect(store.blocked(operator.id)).toBe(false);
  });

  it("marks an order paid once, and rechecks a pending one with SasPay", async () => {
    const { ops, billing, wallet, saspayStatus } = await setup();
    const topup = billing.createOrder({ workspace: "acme", email: "owner@acme.test", kind: "topup", topup: "small" }, "XOF");
    expect((await ops.post(`/commandes/${topup.id}/payee`, {})).headers.get("location")).toBe("/commandes?ok=paid");
    expect((await ops.post(`/commandes/${topup.id}/payee`, {})).headers.get("location")).toBe("/commandes?ok=already-paid");
    expect(wallet.balance("acme") / MICRO).toBe(4500);
    const plan = billing.createOrder({ workspace: "acme", email: "owner@acme.test", kind: "plan", plan: "max", cycle: "month" }, "XOF");
    billing.attachSession(plan.id, "cs_1", "https://pay.saspay.me/checkout/cs_1");
    expect((await ops.post(`/commandes/${plan.id}/verifier`, {})).headers.get("location")).toBe("/commandes?ok=recheck-pending");
    saspayStatus.value = "PAID";
    expect((await ops.post(`/commandes/${plan.id}/verifier`, {})).headers.get("location")).toBe("/commandes?ok=recheck-paid");
    expect(billing.subscription("acme").plan).toBe("max");
  });

  it("deletes a workspace only with its identifier typed, keeping its orders", async () => {
    const { ops, store, billing } = await setup();
    await ops.post("/clients/acme/forfait", { plan: "pro", cycle: "month" });
    expect((await ops.post("/clients/acme/supprimer", { confirm: "acm" })).headers.get("location")).toBe("/clients/acme?erreur=bad-confirm");
    expect(store.workspace("acme")).not.toBeNull();
    expect((await ops.post("/clients/acme/supprimer", { confirm: "acme" })).headers.get("location")).toBe("/clients?ok=deleted");
    expect(store.workspace("acme")).toBeNull();
    expect(billing.orders("acme")).toHaveLength(1);
    expect((await ops.get("/clients/acme")).status).toBe(404);
  });

  it("finds clients by member e-mail and filters them by status", async () => {
    const { ops } = await setup();
    expect(await (await ops.get("/clients?q=owner%40acme")).text()).toContain("Acme");
    expect(await (await ops.get("/clients?q=nobody")).text()).toContain("Aucun client ne correspond");
    expect(await (await ops.get("/clients?filtre=active")).text()).not.toContain("owner@acme.test");
  });
});

describe("traffic", () => {
  it("counts people once a day without storing their address, and leaves robots out", async () => {
    const { store, ops, clock } = await setup();
    const traffic = new Traffic(store.db, () => clock.now);
    const browser = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/140 Safari/537.36";
    const phone = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148";
    expect(traffic.record([
      { site: "site", kind: "view", path: "/", referrer: "https://www.google.com/", ip: "203.0.113.7", userAgent: browser, country: "SN", city: "Dakar" },
      { site: "site", kind: "view", path: "/tarifs", referrer: "https://deliobot.fun/", ip: "203.0.113.7", userAgent: browser, country: "SN", city: "Dakar" },
      { site: "site", kind: "view", path: "/", utmSource: "WhatsApp", ip: "198.51.100.9", userAgent: phone, country: "CI", city: "Abidjan" },
      { site: "site", kind: "download", path: "/download/Deliobot-Setup.exe", ip: "203.0.113.7", userAgent: browser },
      { site: "site", kind: "download", path: "/download/latest.yml", ip: "203.0.113.7", userAgent: browser },
      { site: "site", kind: "view", path: "/", ip: "192.0.2.1", userAgent: "Googlebot/2.1 (+http://www.google.com/bot.html)" },
      { site: "compte", kind: "view", path: "/pay", ip: "203.0.113.7", userAgent: browser },
    ])).toBe(5);
    const dump = JSON.stringify(store.db.prepare("SELECT * FROM visits").all());
    expect(dump).not.toContain("203.0.113.7");
    expect(dump).not.toContain("198.51.100.9");
    const page = await (await ops.get("/trafic?p=today")).text();
    expect(page).toMatch(/Visiteurs uniques<\/div><div class="value">2</);
    expect(page).toMatch(/Téléchargements<\/div><div class="value">1</);
    expect(page).toContain("Windows (installateur)");
    expect(page).toContain("Sénégal");
    expect(page).toContain("whatsapp");
    expect(page).toContain("Google");
  });

  it("names sources, devices and systems", () => {
    expect(sourceOf("https://l.facebook.com/l.php", null)).toBe("Facebook");
    expect(sourceOf("https://www.deliobot.fun/", null)).toBe("Interne");
    expect(sourceOf(null, null)).toBe("Direct");
    expect(sourceOf("https://blog.example.org/post", null)).toBe("blog.example.org");
    expect(deviceOf("Mozilla/5.0 (Linux; Android 14; Pixel 8) Mobile")).toBe("téléphone");
    expect(systemOf("Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5)")).toBe("macOS");
  });
});
