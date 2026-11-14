import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import type { AppConfig } from "../../../server/config.ts";
import { createDelioAccount, delioConnection, delioInstanceConfigs, withDelioMedia } from "../../../server/delio-account.ts";
import { createAdminApp } from "./app.ts";
import type { MailMessage } from "./mail.ts";
import { Devices } from "./devices.ts";
import { Reports } from "./reports.ts";
import { AdminStore } from "./store.ts";
import { nodeDatabase } from "./sql-node.ts";
import { Billing } from "./plans.ts";
import { MICRO, Wallet } from "./wallet.ts";

const cleanups: Array<() => void | Promise<void>> = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });

async function portal() {
  const dir = mkdtempSync(join(tmpdir(), "delio-devices-"));
  const store = new AdminStore({ db: nodeDatabase(join(dir, "admin.db")), secret: randomBytes(32) });
  const mail: MailMessage[] = [];
  const server: Server = createServer();
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  cleanups.push(() => new Promise<void>((done) => server.close(() => { store.close(); rmSync(dir, { recursive: true, force: true }); done(); })));
  server.on("request", createAdminApp({ store, publicUrl: new URL(origin), operators: new Set(["ops@delio.test"]), mailer: { send: async (message) => void mail.push(message) },
    gateway: { openrouterKey: "fixture-key" }, fetchImpl: (async () => Response.json({ choices: [], usage: { cost: 0.002 } })) as typeof fetch }));
  let cookie = "";
  const request = async (path: string, form?: Record<string, string>) => {
    const response = await fetch(new URL(path, origin), form
      ? { method: "POST", redirect: "manual", body: new URLSearchParams(form).toString(), headers: { origin, "content-type": "application/x-www-form-urlencoded", ...(cookie ? { cookie } : {}) } }
      : { redirect: "manual", headers: cookie ? { cookie } : {} });
    const set = response.headers.getSetCookie()[0];
    if (set) cookie = set.split(";")[0]!;
    return response;
  };
  const signIn = async (email: string) => {
    cookie = "";
    await request("/login", { email, next: "/" });
    const code = /Delio est (\d{4}) (\d{4})/.exec(mail.at(-1)!.text)!;
    await request("/login/verify", { email, code: code[1]! + code[2]!, next: "/" });
  };
  return { origin, request, signIn, store };
}

/** The desktop side as the server runs it, with its settings in memory. */
function desktop(origin: string) {
  const config = { delio: null } as unknown as AppConfig;
  const account = createDelioAccount({ config: () => config, save: (delio) => { config.delio = delio ?? null; }, label: () => "Deliobot on test-mac", now: () => Date.now() + 10_000 * polls++ });
  let polls = 0;
  return { config, account, start: () => account.start(origin) };
}

describe("connecting a desktop app to a Delio account", () => {
  it("reuses the same personal account on reconnect and keeps it when a switch is refused", async () => {
    const target = await portal();
    const app = desktop(target.origin);
    await target.signIn("ana@acme.test");
    const first = await app.start();
    await target.request("/device", { code: first.userCode, workspace: "personal", decision: "allow" });
    await app.account.status();
    const original = delioConnection(app.config)!;
    const second = await app.start();
    await target.request("/device", { code: second.userCode, workspace: "personal", decision: "allow" });
    await app.account.status();
    expect(delioConnection(app.config)!.workspace).toBe(original.workspace);
    expect(target.store.workspacesOf(target.store.ensureAccount("ana@acme.test").id)).toHaveLength(1);
    const saved = { ...app.config.delio };
    const cancelled = await app.start();
    await target.request("/device", { code: cancelled.userCode, decision: "deny" });
    await app.account.status();
    expect(app.config.delio).toEqual(saved);
    expect((await app.account.balance({ fresh: true }))?.email).toBe("ana@acme.test");
  });

  it("recovers Max from an empty duplicate using the same authenticated device, without granting credits again", async () => {
    const target = await portal();
    const app = desktop(target.origin);
    await target.signIn("ana@acme.test");
    const first = await app.start();
    await target.request("/device", { code: first.userCode, workspace: "personal", decision: "allow" });
    await app.account.status();
    const original = delioConnection(app.config)!;
    target.store.createWorkspace({ slug: "me-paid1234", name: "ana@acme.test (personal)", tenantUrl: target.origin, ownerEmail: "ana@acme.test" }, "fixture");
    const wallet = new Wallet(target.store.db);
    const billing = new Billing(wallet);
    const order = billing.createOrder({ workspace: "me-paid1234", email: "ana@acme.test", kind: "plan", plan: "max", cycle: "year" }, "XOF");
    billing.fulfil(order.id);
    const read = (slug: string, method = "GET") => fetch(`${target.origin}/api/workspace/${slug}/account`, { method, headers: { authorization: `Bearer ${original.token}` } });
    expect(await (await read(original.workspace)).json()).toMatchObject({ workspace: "me-paid1234", email: "ana@acme.test", plan: "max", ownAi: true, credits: 13500 });
    expect(await app.account.balance({ fresh: true })).toMatchObject({ email: "ana@acme.test", plan: "max", ownAi: true });
    expect(app.config.delio).toMatchObject({ workspace: "me-paid1234", email: "ana@acme.test", token: original.token });
    expect((await read("me-paid1234")).status).toBe(200);
    expect(wallet.balance("me-paid1234")).toBe(13500 * MICRO);
    expect(wallet.ledger("me-paid1234")).toHaveLength(1);
    const chat = await fetch(`${target.origin}/api/gateway/${original.workspace}/openrouter/v1/chat/completions`, {
      method: "POST", headers: { authorization: `Bearer ${original.token}`, "content-type": "application/json" }, body: JSON.stringify({ model: "fixture", messages: [] }),
    });
    expect(chat.status).toBe(200);
    await chat.text();
    expect(wallet.balance("me-paid1234")).toBe(13499 * MICRO);
    expect(wallet.balance(original.workspace)).toBe(0);
    target.store.createWorkspace({ slug: "me-other123", name: "bob@acme.test (personal)", tenantUrl: target.origin, ownerEmail: "bob@acme.test" }, "fixture");
    expect((await read("me-other123")).status).toBe(401);
    const page = await target.request(`/billing?workspace=${original.workspace}`);
    expect(page.headers.get("location")).toBe("/billing?workspace=me-paid1234");
    expect((await read("me-paid1234", "DELETE")).status).toBe(200);
    expect((await read(original.workspace)).status).toBe(401);
    expect((await read("me-paid1234")).status).toBe(401);
  });
  it("connects with a code approved on the portal, spends a personal workspace's credits, and stops at disconnection", async () => {
    const target = await portal();
    const app = desktop(target.origin);
    const started = await app.start();
    expect(started.userCode).toMatch(/^[A-Z]{4}-[A-Z]{4}$/);
    expect(started.verification.startsWith(`${target.origin}/device?code=`)).toBe(true);
    expect(await app.account.status()).toMatchObject({ state: "waiting", userCode: started.userCode });

    await target.signIn("ana@acme.test");
    const approval = await (await target.request(`/device?code=${started.userCode}`)).text();
    expect(approval).toContain("Deliobot on test-mac");
    expect(approval, "another address can sign in and come back to the same code").toContain(`name="next" value="/device?code=${started.userCode}"`);
    const approved = await target.request("/device", { code: started.userCode.toLowerCase().replace("-", " "), workspace: "personal", decision: "allow" });
    expect(approved.status).toBe(200);

    expect(await app.account.status()).toMatchObject({ state: "connected" });
    const connection = delioConnection(app.config)!;
    expect(connection.token).toMatch(/^odb_device_/);
    expect(connection.workspace).toMatch(/^me-/);
    expect(delioInstanceConfigs(app.config).delio).toMatchObject({ driver: "openai-compat", displayName: "Delio",
      config: { url: `${target.origin}/api/gateway/${connection.workspace}/openrouter/v1`, model: "auto" } });
    expect(withDelioMedia(app.config).fal).toEqual({ key: connection.token, url: `${target.origin}/api/gateway/${connection.workspace}/fal` });
    expect(withDelioMedia({ ...app.config, fal: { key: "own-fal-key" } }).fal, "the person's own key wins").toEqual({ key: "own-fal-key" });
    expect(await app.account.balance()).toEqual({ email: "ana@acme.test", credits: 0, usedThisMonth: 0, plan: null, ownAi: false, paymentVersion: 0 });

    await target.signIn("ana@acme.test");
    const billing = await (await target.request(`/billing?workspace=${connection.workspace}`)).text();
    expect(billing).toContain("Deliobot on test-mac");
    const device = /name="device" value="([^"]+)"/.exec(billing)![1]!;
    await target.request("/billing/device", { workspace: connection.workspace, device });
    const refused = await fetch(`${target.origin}/api/workspace/${connection.workspace}/account`, { headers: { authorization: `Bearer ${connection.token}` } });
    expect(refused.status, "a disconnected app's token no longer works").toBe(401);
  });

  it("revokes the app's token on the portal when the app signs out", async () => {
    const target = await portal();
    const app = desktop(target.origin);
    const started = await app.start();
    await target.signIn("ana@acme.test");
    await target.request("/device", { code: started.userCode, workspace: "personal", decision: "allow" });
    await app.account.status();
    const connection = delioConnection(app.config)!;
    await app.account.disconnect();
    expect(delioConnection(app.config)).toBeNull();
    const refused = await fetch(`${target.origin}/api/workspace/${connection.workspace}/account`, { headers: { authorization: `Bearer ${connection.token}` } });
    expect(refused.status, "the signed-out app's token no longer works").toBe(401);
  });

  it("tells the app when the person refuses, and only an administrator's workspace can be chosen", async () => {
    const target = await portal();
    const app = desktop(target.origin);
    const started = await app.start();
    await target.signIn("bob@acme.test");
    expect((await target.request("/device", { code: started.userCode, workspace: "someone-elses", decision: "allow" })).status).toBe(403);
    await target.request("/device", { code: started.userCode, decision: "deny" });
    expect(await app.account.status()).toEqual({ state: "disconnected", reason: "denied" });
    expect(delioConnection(app.config)).toBeNull();
  });
});

describe("a device token and the account behind it", () => {
  it("stops working once that account no longer administers the workspace", () => {
    const dir = mkdtempSync(join(tmpdir(), "delio-devices-"));
    const store = new AdminStore({ db: nodeDatabase(join(dir, "admin.db")), secret: randomBytes(32) });
    cleanups.push(() => { store.close(); rmSync(dir, { recursive: true, force: true }); });
    store.createWorkspace({ slug: "acme", name: "Acme", tenantUrl: "https://acme.example.test", ownerEmail: "owner@acme.test" }, "owner@acme.test");
    const second = store.ensureAccount("second@acme.test");
    store.addMember("acme", second.id, "admin", "owner@acme.test");
    const devices = new Devices(store.db);
    const flow = devices.start("Laptop");
    expect(devices.decide(flow.userCode, { workspace: "acme", accountId: second.id })).toBe(true);
    const polled = devices.poll(flow.deviceCode);
    if (polled.status !== "approved") throw new Error("the flow was approved");
    expect(devices.check(polled.token, "acme")).toBe(true);
    expect(store.setRole("acme", second.id, "member", "owner@acme.test")).toBe("ok");
    expect(devices.check(polled.token, "acme"), "a demoted admin's app").toBe(false);
    expect(store.removeMember("acme", second.id, "owner@acme.test")).toBe("ok");
    expect(devices.check(polled.token, "acme"), "a removed member's app").toBe(false);
  });
});

describe("a problem report sent from the app", () => {
  it("reaches the portal under the sender's workspace with secrets masked, and is refused without an account or past ten a day", async () => {
    const target = await portal();
    const app = desktop(target.origin);
    const report = { note: "Le bot s'arrête avant la fin. Ma clé : sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123456789", transcript: "Moi: fais le rapport\nDelio: …", bot: "Delio", appVersion: "0.1.161", platform: "win32" };
    expect(await app.account.report(report)).toBe("not-connected");

    const started = await app.start();
    await target.signIn("ana@acme.test");
    await target.request("/device", { code: started.userCode, workspace: "personal", decision: "allow" });
    expect(await app.account.status()).toMatchObject({ state: "connected" });
    expect(await app.account.report(report)).toBe("sent");

    const reports = new Reports(target.store.db);
    const [listed] = reports.list(10);
    expect(listed).toMatchObject({ email: "ana@acme.test", bot: "Delio", appVersion: "0.1.161", platform: "win32", readAt: null });
    const opened = reports.open(listed!.id)!;
    expect(opened.transcript).toContain("fais le rapport");
    expect(opened.note).toContain("Le bot s'arrête avant la fin");
    expect(opened.note, "a key pasted in the note never leaves the computer").not.toContain("abcdefghijklmnopqrstuvwxyz0123456789");
    expect(reports.unread()).toBe(0);

    for (let sent = 1; sent < 10; sent += 1) expect(await app.account.report(report)).toBe("sent");
    expect(await app.account.report(report)).toBe("too-many");
    const anonymous = await fetch(new URL(`/api/workspace/${listed!.workspace}/report`, target.origin), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(report) });
    expect(anonymous.status).toBe(401);
  });
});
