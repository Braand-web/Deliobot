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
import { AdminStore } from "./store.ts";

const cleanups: Array<() => void | Promise<void>> = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });

async function portal() {
  const dir = mkdtempSync(join(tmpdir(), "delio-devices-"));
  const store = new AdminStore({ file: join(dir, "admin.db"), secret: randomBytes(32) });
  const mail: MailMessage[] = [];
  const server: Server = createServer();
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  cleanups.push(() => new Promise<void>((done) => server.close(() => { store.close(); rmSync(dir, { recursive: true, force: true }); done(); })));
  server.on("request", createAdminApp({ store, publicUrl: new URL(origin), operators: new Set(["ops@delio.test"]), mailer: { send: async (message) => void mail.push(message) } }));
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
    const code = /code is (\d{4}) (\d{4})/.exec(mail.at(-1)!.text)!;
    await request("/login/verify", { email, code: code[1]! + code[2]!, next: "/" });
  };
  return { origin, request, signIn };
}

/** The desktop side as the server runs it, with its settings in memory. */
function desktop(origin: string) {
  const config = { delio: null } as unknown as AppConfig;
  const account = createDelioAccount({ config: () => config, save: (delio) => { config.delio = delio ?? null; }, label: () => "Deliobot on test-mac", now: () => Date.now() + 10_000 * polls++ });
  let polls = 0;
  return { config, account, start: () => account.start(origin) };
}

describe("connecting a desktop app to a Delio account", () => {
  it("connects with a code approved on the portal, spends a personal workspace's credits, and stops at disconnection", async () => {
    const target = await portal();
    const app = desktop(target.origin);
    const started = await app.start();
    expect(started.userCode).toMatch(/^[A-Z]{4}-[A-Z]{4}$/);
    expect(started.verification.startsWith(`${target.origin}/device?code=`)).toBe(true);
    expect(await app.account.status()).toMatchObject({ state: "waiting", userCode: started.userCode });

    await target.signIn("ana@acme.test");
    expect(await (await target.request(`/device?code=${started.userCode}`)).text()).toContain("Deliobot on test-mac");
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
    expect(await app.account.balance()).toEqual({ credits: 0, usedThisMonth: 0 });

    await target.signIn("ana@acme.test");
    const billing = await (await target.request(`/billing?workspace=${connection.workspace}`)).text();
    expect(billing).toContain("Deliobot on test-mac");
    const device = /name="device" value="([^"]+)"/.exec(billing)![1]!;
    await target.request("/billing/device", { workspace: connection.workspace, device });
    const refused = await fetch(`${target.origin}/api/workspace/${connection.workspace}/account`, { headers: { authorization: `Bearer ${connection.token}` } });
    expect(refused.status, "a disconnected app's token no longer works").toBe(401);
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
