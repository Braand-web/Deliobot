import { createHmac, randomBytes } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { createAdminApp } from "./app.ts";
import type { MailMessage } from "./mail.ts";
import { priceIn } from "./plans.ts";
import { verifySasPayWebhook } from "./saspay.ts";
import { AdminStore } from "./store.ts";
import { nodeDatabase } from "./sql-node.ts";
import { operatorConsole } from "./test-console.ts";

const SECRET = "whsec_test_secret";
const DAY = 24 * 60 * 60_000;
const cleanups: Array<() => void | Promise<void>> = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });

/** A SasPay stand-in: checkout sessions the test marks paid, and every request it got. */
function fakeSasPay() {
  const sessions = new Map<string, { status: string; body: Record<string, unknown> }>();
  const calls: Array<{ url: string; method: string; auth: string | null; body: unknown }> = [];
  let next = 0;
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    const body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : undefined;
    calls.push({ url: url.href, method: init?.method ?? "GET", auth: new Headers(init?.headers).get("authorization"), body });
    if (url.pathname === "/api/v1/checkout-sessions/" && init?.method === "POST") {
      const id = `cs_${++next}`;
      sessions.set(id, { status: "PENDING", body: body! });
      return Response.json({ success: true, data: { id, checkout_url: `https://pay.saspay.me/checkout/${id}`, status: "PENDING" }, code: 201 }, { status: 201 });
    }
    const status = /^\/api\/v1\/checkout-sessions\/([^/]+)\/status\/$/.exec(url.pathname);
    if (status) return Response.json({ success: true, data: { id: status[1], status: sessions.get(status[1]!)?.status ?? "PENDING" } });
    return new Response("{}", { status: 404 });
  }) as typeof fetch;
  return { fetchImpl, sessions, calls, pay: (id: string) => { sessions.get(id)!.status = "PAID"; } };
}

async function portal(saspay: ReturnType<typeof fakeSasPay>, clock: { now: number }) {
  const dir = mkdtempSync(join(tmpdir(), "delio-payments-"));
  const store = new AdminStore({ db: nodeDatabase(join(dir, "admin.db")), secret: randomBytes(32), now: () => clock.now });
  const mail: MailMessage[] = [];
  const server: Server = createServer();
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  cleanups.push(() => new Promise<void>((done) => server.close(() => { store.close(); rmSync(dir, { recursive: true, force: true }); done(); })));
  const app = createAdminApp({ store, publicUrl: new URL(origin), operators: new Set(["ops@delio.test"]), mailer: { send: async (message) => void mail.push(message) },
    fetchImpl: saspay.fetchImpl, now: () => clock.now,
    gateway: { openrouterKey: "sk-or", openrouterUrl: "https://openrouter.test/api/v1" },
    payments: { saspayKey: "sk_test_operator", webhookSecret: SECRET, currency: "XOF", apiUrl: "https://saspay.test/api/v1" } });
  server.on("request", app);
  let cookie = "";
  const post = async (path: string, form: Record<string, string>) => {
    const response = await fetch(new URL(path, origin), { method: "POST", redirect: "manual", body: new URLSearchParams(form).toString(),
      headers: { origin, "content-type": "application/x-www-form-urlencoded", ...(cookie ? { cookie } : {}) } });
    const set = response.headers.getSetCookie()[0];
    if (set) cookie = set.split(";")[0]!;
    return response;
  };
  const get = (path: string) => fetch(new URL(path, origin), { redirect: "manual", headers: cookie ? { cookie } : {} });
  const signIn = async (email: string) => {
    cookie = "";
    await post("/login", { email, next: "/" });
    const code = /Delio est (\d{4}) (\d{4})/.exec(mail.at(-1)!.text)!;
    await post("/login/verify", { email, code: code[1]! + code[2]!, next: "/" });
  };
  const ops = await operatorConsole({ store, operators: new Set(["ops@delio.test"]), mailer: { send: async (message) => void mail.push(message) }, now: () => clock.now }, mail);
  cleanups.push(ops.close);
  await ops.post("/workspaces", { slug: "acme", name: "Acme", tenantUrl: "https://acme.example.test", ownerEmail: "boss@acme.test" });
  const token = /odb_workspace_[A-Za-z0-9_-]{43}/.exec(await (await ops.post("/billing/token", { workspace: "acme" })).text())![0];
  await signIn("boss@acme.test");
  const webhook = (event: unknown, options: { secret?: string; age?: number } = {}) => {
    const body = JSON.stringify(event);
    const timestamp = String(Math.floor(clock.now / 1000) - (options.age ?? 0));
    const signature = createHmac("sha256", options.secret ?? SECRET).update(`${timestamp}.${body}`).digest("hex");
    return fetch(new URL("/api/saspay/webhook", origin), { method: "POST", body, headers: { "content-type": "application/json", "x-webhook-signature": signature, "x-webhook-timestamp": timestamp, "x-webhook-event": "transaction.success" } });
  };
  const account = async () => (await fetch(new URL("/api/workspace/acme/account", origin), { headers: { authorization: `Bearer ${token}` } })).json() as Promise<{ credits: number; gateway: boolean }>;
  const chat = () => fetch(new URL("/api/gateway/acme/openrouter/v1/chat/completions", origin), { method: "POST", body: "{}", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" } });
  return { post, get, webhook, account, chat, mail, sweep: () => app.sweep(), signIn };
}

describe("SasPay webhook signature", () => {
  it("accepts SasPay's HMAC of timestamp and body, and refuses another secret, another body or an old delivery", () => {
    const now = 1_800_000_000_000;
    const body = Buffer.from('{"event":"transaction.success","data":{"id":"t1"}}');
    const timestamp = String(now / 1000);
    const signature = createHmac("sha256", SECRET).update(`${timestamp}.${body}`).digest("hex");
    expect(verifySasPayWebhook(body, { signature, timestamp }, SECRET, now)).toBe(true);
    expect(verifySasPayWebhook(body, { signature, timestamp }, "other", now)).toBe(false);
    expect(verifySasPayWebhook(Buffer.from(`${body} `), { signature, timestamp }, SECRET, now)).toBe(false);
    expect(verifySasPayWebhook(body, { signature, timestamp }, SECRET, now + 301_000)).toBe(false);
    expect(verifySasPayWebhook(body, { timestamp }, SECRET, now)).toBe(false);
  });

  it("charges dollar prices in CFA francs at the operator's rate, rounded up to a whole franc", () => {
    expect(priceIn(5, "XOF")).toBe("3000.00");
    expect(priceIn(1.5, "XAF", 607)).toBe("911.00");
    expect(priceIn(49, "USD")).toBe("49.00");
  });
});

describe("plans paid through SasPay", () => {
  it("runs the five-dollar trial once, credits it on a signed webhook only once, then sells and renews Pro by the month", async () => {
    const clock = { now: Date.now() };
    const saspay = fakeSasPay();
    const target = await portal(saspay, clock);

    const trial = await target.post("/billing/checkout", { workspace: "acme", kind: "plan", plan: "trial" });
    expect(trial.status).toBe(303);
    expect(trial.headers.get("location")).toBe("https://pay.saspay.me/checkout/cs_1");
    const created = saspay.calls[0]!;
    expect(created.auth).toBe("Bearer sk_test_operator");
    expect(created.body).toMatchObject({ amount: "3000.00", currency: "XOF", customer_email: "boss@acme.test", metadata: { workspace: "acme" } });
    expect(String((created.body as { return_url: string }).return_url)).toMatch(/\/billing\/return\?order=ord_/);

    expect((await target.webhook({ event: "transaction.success", data: { id: "t1" } }, { secret: "forged" })).status).toBe(403);
    expect((await target.webhook({ event: "transaction.success", data: { id: "t1" } }, { age: 600 })).status).toBe(403);
    expect((await target.webhook({ event: "transaction.success", data: { id: "t1" } })).status, "signed, but SasPay still says pending").toBe(200);
    expect((await target.account()).credits).toBe(0);

    saspay.pay("cs_1");
    expect((await target.webhook({ event: "transaction.success", data: { id: "t2" } })).status).toBe(200);
    expect((await target.account()).credits).toBe(300);
    await target.webhook({ event: "transaction.success", data: { id: "t3" } });
    expect((await target.account()).credits, "a second confirmation changes nothing").toBe(300);
    expect(await (await target.get("/billing?workspace=acme")).text()).toContain("Essai jusqu");
    expect((await target.post("/billing/checkout", { workspace: "acme", kind: "plan", plan: "trial" })).status, "one trial per account and workspace").toBe(409);

    const pro = await target.post("/billing/checkout", { workspace: "acme", kind: "plan", plan: "pro", cycle: "month" });
    expect(saspay.calls.at(-1)!.body, "49 USD at 600 francs").toMatchObject({ amount: "29400.00" });
    saspay.pay("cs_2");
    const order = /order=(ord_[^&"]+)/.exec(String((saspay.calls.at(-1)!.body as { return_url: string }).return_url))![1];
    expect(new URL(pro.headers.get("location")!).pathname).toBe("/checkout/cs_2");
    expect(await (await target.get(`/billing/return?order=${order}`)).text(), "the return page confirms with SasPay itself").toContain("Paiement reçu");
    expect((await target.account()).credits).toBe(5800);
    expect(await (await target.get("/billing?workspace=acme")).text()).toMatch(/Pro · mensuel · jusqu/);

    await target.post("/billing/checkout", { workspace: "acme", kind: "plan", plan: "pro", cycle: "month" });
    saspay.pay("cs_3");
    await target.sweep();
    expect((await target.account()).credits, "the sweep confirms payments whose webhook never came").toBe(11300);
    expect(await (await target.get("/billing?workspace=acme")).text(), "a renewal adds 30 days after the current period")
      .toContain(`jusqu&#39;au ${new Date(clock.now + 60 * DAY).toISOString().slice(0, 10)}`);
  });

  it("lets the billing page's forms land on SasPay's checkout, and shows a pending button with its own script only", async () => {
    const target = await portal(fakeSasPay(), { now: Date.now() });
    const response = await target.get("/billing?workspace=acme");
    const policy = response.headers.get("content-security-policy") ?? "";
    expect(policy, "Chromium applies form-action to the redirect to the checkout").toContain("form-action 'self' https://*.saspay.me;");
    const nonce = /script-src 'nonce-([A-Za-z0-9_-]+)'/.exec(policy)?.[1];
    expect(await response.text()).toContain(`<script nonce="${nonce}">`);
  });

  it("sells a year for the price of eleven months and grants its credits month by month", async () => {
    const clock = { now: Date.now() };
    const saspay = fakeSasPay();
    const target = await portal(saspay, clock);
    await target.post("/billing/checkout", { workspace: "acme", kind: "plan", plan: "starter", cycle: "year" });
    expect(saspay.calls.at(-1)!.body).toMatchObject({ amount: "99000.00", description: "Delio Starter · 1 an" });
    saspay.pay("cs_1");
    await target.sweep();
    expect((await target.account()).credits).toBe(1300);

    clock.now += 29 * DAY;
    await target.sweep();
    expect((await target.account()).credits, "the next month has not begun").toBe(1300);
    clock.now += 1 * DAY;
    await target.sweep();
    expect((await target.account()).credits).toBe(2600);

    clock.now += 400 * DAY;
    await target.sweep();
    expect((await target.account()).credits, "twelve months, then nothing more").toBe(12 * 1300);
    expect((await target.account()).gateway, "the year and its grace week are over").toBe(false);
  });

  it("reminds admins before a period ends, keeps a week of grace, then stops the gateway; BYOK never spends Delio credits", async () => {
    const clock = { now: Date.now() };
    const saspay = fakeSasPay();
    const target = await portal(saspay, clock);
    await target.post("/billing/checkout", { workspace: "acme", kind: "plan", plan: "pro" });
    saspay.pay("cs_1");
    await target.sweep();
    expect((await target.account()).gateway).toBe(true);

    clock.now += 28 * DAY;
    await target.sweep();
    expect(target.mail.filter((message) => message.subject.includes("se termine bientôt")).map((message) => message.to)).toEqual(["boss@acme.test"]);
    await target.sweep();
    expect(target.mail.filter((message) => message.subject.includes("se termine bientôt")), "once per period").toHaveLength(1);

    clock.now += 5 * DAY;
    expect((await target.account()).gateway, "inside the grace week").toBe(true);
    clock.now += 7 * DAY;
    expect((await target.account()).gateway).toBe(false);
    const refused = await target.chat();
    expect(refused.status).toBe(402);
    expect(await refused.json()).toMatchObject({ error: { code: "plan_inactive" } });

    await target.signIn("boss@acme.test");
    await target.post("/billing/checkout", { workspace: "acme", kind: "plan", plan: "byok" });
    saspay.pay("cs_2");
    await target.sweep();
    expect((await target.chat()).status, "BYOK uses the workspace's own keys").toBe(402);
  });

  it("sells top-ups priced in dollars and charged in CFA francs, credited once SasPay confirms them", async () => {
    const clock = { now: Date.now() };
    const saspay = fakeSasPay();
    const target = await portal(saspay, clock);
    await target.post("/billing/checkout", { workspace: "acme", kind: "topup", topup: "small" });
    expect(saspay.calls.at(-1)!.body).toMatchObject({ amount: "12000.00", currency: "XOF" });
    saspay.pay("cs_1");
    await target.sweep();
    expect((await target.account()).credits).toBe(4500);
  });

  it("opens SasPay's checkout in one click from the site or the app, signing in first and making a newcomer's workspace", async () => {
    const clock = { now: Date.now() };
    const saspay = fakeSasPay();
    const target = await portal(saspay, clock);
    const own = await target.get("/pay?workspace=acme&plan=pro&cycle=year");
    expect(own.status).toBe(303);
    expect(own.headers.get("location")).toBe("https://pay.saspay.me/checkout/cs_1");
    expect(saspay.calls.at(-1)!.body).toMatchObject({ currency: "XOF", metadata: { workspace: "acme" } });
    expect((await target.get("/pay?topup=small")).headers.get("location")).toBe("https://pay.saspay.me/checkout/cs_2");

    await target.signIn("new@delio.test");
    const fresh = await target.get("/pay?plan=trial");
    expect(fresh.headers.get("location")).toBe("https://pay.saspay.me/checkout/cs_3");
    expect(saspay.calls.at(-1)!.body).toMatchObject({ customer_email: "new@delio.test", metadata: { workspace: expect.stringMatching(/^me-/) } });
    expect(saspay.calls.at(-1)!.body, "no country is imposed: SasPay offers every country it serves").not.toHaveProperty("country");
  });

  it("tells someone signed in with another address whose workspace it is, and switches address back to the same page", async () => {
    const clock = { now: Date.now() };
    const target = await portal(fakeSasPay(), clock);
    await target.signIn("someone-else@delio.test");
    for (const path of ["/billing?workspace=acme&plan=trial", "/pay?workspace=acme&plan=pro"]) {
      const answer = await target.get(path);
      expect(answer.status).toBe(403);
      const html = await answer.text();
      expect(html).toContain("Cet espace appartient à une autre adresse");
      expect(html).toContain("someone-else@delio.test");
    }
    const out = await target.post("/logout", { next: "/billing?workspace=acme&plan=trial" });
    expect(out.headers.get("location")).toBe(`/login?next=${encodeURIComponent("/billing?workspace=acme&plan=trial")}`);
    expect((await target.post("/logout", {})).headers.get("location")).toBe("/login");
  });

  it("publishes the catalog in dollars with its franc prices; only Starter, Pro and Max are listed for the site", async () => {
    const clock = { now: Date.now() };
    const target = await portal(fakeSasPay(), clock);
    const response = await target.get("/api/public/plans");
    expect(response.headers.get("access-control-allow-origin")).toBe("*");
    const body = await response.json() as { plans: Array<{ id: string; usd: number; usdYear: number | null; francs: number; listed: boolean }>; topups: Array<{ credits: number; francs: number }> };
    expect(body.plans.filter((plan) => plan.listed).map((plan) => plan.id)).toEqual(["starter", "pro", "max"]);
    expect(body.plans.find((plan) => plan.id === "pro")).toMatchObject({ usd: 49, usdYear: 539, francs: 29400 });
    expect(body.topups.map((pack) => pack.credits)).toEqual([4500, 13500]);
  });
});
