import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { createAdminApp } from "./app.ts";
import { Hosting, type Fleet } from "./hosting.ts";
import type { MailMessage } from "./mail.ts";
import { AdminStore } from "./store.ts";
import { nodeDatabase } from "./sql-node.ts";

const DAY = 24 * 60 * 60_000;
const cleanups: Array<() => void | Promise<void>> = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });

function fakeFleet() {
  const calls: Array<{ op: string; slug: string; input?: Parameters<Fleet["create"]>[0] }> = [];
  let failures = 0;
  const fleet: Fleet = {
    create: async (input) => { calls.push({ op: "create", slug: input.slug, input }); if (failures > 0) { failures -= 1; throw new Error("nft: permission denied"); } },
    suspend: async (slug) => void calls.push({ op: "suspend", slug }),
    resume: async (slug) => void calls.push({ op: "resume", slug }),
  };
  return { fleet, calls, failNext: (count: number) => { failures = count; } };
}

function fakeSasPay() {
  const sessions = new Map<string, string>();
  let next = 0;
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    if (url.pathname === "/api/v1/checkout-sessions/" && init?.method === "POST") {
      const id = `cs_${++next}`;
      sessions.set(id, "PENDING");
      return Response.json({ id, checkout_url: `https://pay.saspay.test/${id}` }, { status: 201 });
    }
    const status = /checkout-sessions\/([^/]+)\/status\/$/.exec(url.pathname);
    if (status) return Response.json({ id: status[1], status: sessions.get(status[1]!) ?? "PENDING" });
    return new Response("{}", { status: 404 });
  }) as typeof fetch;
  return { fetchImpl, pay: (id: string) => sessions.set(id, "PAID") };
}

async function portal() {
  const clock = { now: Date.now() };
  const dir = mkdtempSync(join(tmpdir(), "delio-hosting-"));
  const store = new AdminStore({ db: nodeDatabase(join(dir, "admin.db")), secret: randomBytes(32), now: () => clock.now });
  const mail: MailMessage[] = [];
  const fleet = fakeFleet();
  const saspay = fakeSasPay();
  const server: Server = createServer();
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  cleanups.push(() => new Promise<void>((done) => server.close(() => { store.close(); rmSync(dir, { recursive: true, force: true }); done(); })));
  const app = createAdminApp({ store, publicUrl: new URL(origin), operators: new Set(["ops@delio.test"]), mailer: { send: async (message) => void mail.push(message) },
    fetchImpl: saspay.fetchImpl, now: () => clock.now, gateway: { openrouterKey: "sk-or", openrouterUrl: "https://openrouter.test/api/v1" },
    payments: { saspayKey: "sk_test_operator", webhookSecret: "whsec", currency: "XOF", apiUrl: "https://saspay.test/api/v1" },
    hosting: { domain: "deliobot.test", models: ["google/gemini-2.5-flash", "anthropic/claude-sonnet-4.5"], fleet: fleet.fleet } });
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
  /** Checks out a plan and has SasPay call it paid; the return page confirms it as a person coming back would. */
  const buy = async (workspace: string, plan: string, id: string) => {
    const checkout = await post("/billing/checkout", { workspace, kind: "plan", plan, cycle: "month" });
    expect(checkout.status).toBe(303);
    saspay.pay(id);
    await app.sweep();
  };
  const account = async (slug: string, token: string) => fetch(new URL(`/api/workspace/${slug}/account`, origin), { headers: { authorization: `Bearer ${token}` } });
  const hosting = new Hosting(store.db, () => clock.now);
  return { clock, mail, fleet, post, get, signIn, buy, account, hosting: (slug: string) => hosting.get(slug), workspace: (slug: string) => store.workspace(slug), sweep: () => app.sweep() };
}

describe("self-serve workspaces", () => {
  it("signs up, waits for payment, then has the fleet create the workspace with its gateway token and emails its admin", async () => {
    const target = await portal();
    await target.signIn("founder@acme.test");
    const form = await (await target.get("/signup?plan=pro&cycle=year")).text();
    expect(form).toContain(".deliobot.test");
    expect(form).toContain('name="plan" value="pro"');

    expect(await (await target.post("/signup", { name: "Acme", slug: "admin", plan: "pro", cycle: "year" })).text()).toContain("Cet identifiant est déjà pris");
    expect(await (await target.post("/signup", { name: "Acme", slug: "Bad slug", plan: "pro", cycle: "year" })).text()).toContain("lettres minuscules");
    const created = await target.post("/signup", { name: "Acme", slug: "acme", plan: "pro", cycle: "year" });
    expect(created.headers.get("location")).toBe("/billing?workspace=acme&plan=pro&cycle=year");
    const waiting = await target.get("/billing?workspace=acme&plan=pro&cycle=year");
    expect(waiting.status).toBe(303);
    expect(waiting.headers.get("location")).toBe("opendeliobot://cloud");
    expect(target.workspace("acme")?.tenantUrl).toBe("https://acme.deliobot.test");
    expect(target.hosting("acme")?.state).toBe("waiting");

    await target.sweep();
    expect(target.fleet.calls, "nothing is created before a plan is paid").toEqual([]);

    await target.buy("acme", "pro", "cs_1");
    expect(target.fleet.calls.map((call) => call.op)).toEqual(["create"]);
    const input = target.fleet.calls[0]!.input!;
    expect(input).toMatchObject({ slug: "acme", admins: ["founder@acme.test"], delioModels: ["google/gemini-2.5-flash", "anthropic/claude-sonnet-4.5"] });
    expect(input.portalUrl).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
    expect(input.delioToken).toMatch(/^odb_workspace_[A-Za-z0-9_-]{43}$/);
    expect((await target.account("acme", input.delioToken!)).status, "the token the workspace got opens its gateway").toBe(200);
    expect(target.hosting("acme")?.state).toBe("ready");
    expect(target.mail.find((message) => message.subject.includes("est prêt"))).toMatchObject({ to: "founder@acme.test" });

    await target.sweep();
    expect(target.fleet.calls.filter((call) => call.op === "create"), "created once").toHaveLength(1);
  });

  it("suspends a workspace whose plan ended past its grace week and resumes it once renewed", async () => {
    const target = await portal();
    await target.signIn("founder@acme.test");
    await target.post("/signup", { name: "Acme", slug: "acme" });
    await target.buy("acme", "starter", "cs_1");

    target.clock.now += 36 * DAY;
    await target.sweep();
    expect(target.fleet.calls.map((call) => call.op), "still inside the grace week").toEqual(["create"]);
    target.clock.now += 2 * DAY;
    await target.sweep();
    expect(target.fleet.calls.map((call) => call.op)).toEqual(["create", "suspend"]);
    await target.signIn("founder@acme.test");
    expect(target.hosting("acme")?.state).toBe("suspended");

    await target.buy("acme", "starter", "cs_2");
    expect(target.fleet.calls.map((call) => call.op)).toEqual(["create", "suspend", "resume"]);
  });

  it("retries a failed creation with growing waits, tells the operators after the fourth failure, and lets an admin retry", async () => {
    const target = await portal();
    await target.signIn("founder@acme.test");
    await target.post("/signup", { name: "Acme", slug: "acme" });
    target.fleet.failNext(4);
    await target.buy("acme", "pro", "cs_1");
    const billing = await target.get("/billing?workspace=acme");
    expect(billing.status).toBe(303);
    expect(billing.headers.get("location")).toBe("opendeliobot://cloud");
    expect(target.hosting("acme")?.state).toBe("failed");
    expect(await billing.text(), "the server's own error stays out of the customer's page").not.toContain("nft");

    for (const wait of [5, 10, 20]) {
      await target.sweep();
      target.clock.now += wait * 60_000;
      await target.sweep();
    }
    expect(target.fleet.calls.filter((call) => call.op === "create")).toHaveLength(4);
    expect(target.mail.filter((message) => message.to === "ops@delio.test" && message.subject.includes("could not create")).length).toBe(1);
    target.clock.now += 60 * 60_000;
    await target.sweep();
    expect(target.fleet.calls.filter((call) => call.op === "create"), "no more automatic attempts").toHaveLength(4);

    await target.post("/billing/hosting/retry", { workspace: "acme" });
    await target.sweep();
    expect(target.fleet.calls.filter((call) => call.op === "create")).toHaveLength(5);
    expect(target.hosting("acme")?.state).toBe("ready");
  });

  it("creates a BYOK workspace without Delio's token, and caps self-serve workspaces per account", async () => {
    const target = await portal();
    await target.signIn("founder@acme.test");
    await target.post("/signup", { name: "Mine", slug: "mine" });
    await target.buy("mine", "byok", "cs_1");
    expect(target.fleet.calls[0]!.input).not.toHaveProperty("delioToken");

    await target.post("/signup", { name: "Two", slug: "two" });
    await target.post("/signup", { name: "Three", slug: "three" });
    expect(await (await target.post("/signup", { name: "Four", slug: "four" })).text()).toContain("Vous avez déjà 3 espaces");
  });
});
