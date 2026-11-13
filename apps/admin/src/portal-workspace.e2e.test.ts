// A real Delio Admin portal and a real workspace server; only the portal's HTTPS origin is rewritten to its loopback port.
import { spawn, type ChildProcess } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { createServer, request, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { removeTempDir, waitForExit } from "../../../server/testing/cleanup.ts";
import { freePortBlock } from "../../../server/testing/ports.ts";
import { createAdminApp } from "./app.ts";
import type { MailMessage } from "./mail.ts";
import { AdminStore } from "./store.ts";
import { nodeDatabase } from "./sql-node.ts";
import { operatorConsole } from "./test-console.ts";

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const HOST = "acme.example.test";
const ADMIN_ORIGIN = "https://admin.example.test";
let home: string;
let port: number;
let portalOrigin: string;
let portalServer: Server;
let store: AdminStore;
let child: ChildProcess;
let log = "";
const mail: MailMessage[] = [];

type Reply = { status: number; body: any; cookies: string[]; location?: string };

function workspace(path: string, options: { method?: string; cookie?: string; local?: boolean } = {}): Promise<Reply> {
  return new Promise((resolve, reject) => {
    const req = request({ hostname: "127.0.0.1", port, path, method: options.method ?? "GET", headers: {
      ...(options.local ? {} : { host: HOST, "x-forwarded-for": "203.0.113.8", "x-forwarded-proto": "https" }),
      ...(options.cookie ? { cookie: options.cookie } : {}),
    } }, (res) => {
      let raw = ""; res.on("data", (chunk) => raw += chunk);
      res.on("end", () => { let body: unknown = raw; try { body = JSON.parse(raw); } catch { /* not JSON */ }
        resolve({ status: res.statusCode!, body, cookies: res.headers["set-cookie"] ?? [], location: res.headers.location }); });
    });
    req.on("error", reject); req.end();
  });
}

/** One person's browser on the portal. */
function person() {
  let cookie = "";
  async function go(path: string, init: RequestInit = {}) {
    const response = await fetch(new URL(path, portalOrigin), { ...init, redirect: "manual", headers: { ...(cookie ? { cookie } : {}), ...init.headers as Record<string, string> } });
    const set = response.headers.getSetCookie()[0];
    if (set) cookie = set.split(";")[0]!;
    return response;
  }
  const post = (path: string, form: Record<string, string>) =>
    go(path, { method: "POST", headers: { origin: portalOrigin, "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(form).toString() });
  async function signIn(email: string) {
    await post("/login", { email, next: "/" });
    const code = /Delio est (\d{4}) (\d{4})/.exec(mail.at(-1)!.text)!;
    expect((await post("/login/verify", { email, code: code[1]! + code[2]!, next: "/" })).status).toBe(303);
  }
  /** Opens the workspace address and follows the handoff through the portal; returns the workspace session cookie. */
  async function openWorkspace(): Promise<string> {
    expect((await workspace("/")).location).toBe("/api/auth/hosted/start");
    const start = await workspace("/api/auth/hosted/start");
    const connect = new URL(start.location!);
    expect(connect.origin).toBe(ADMIN_ORIGIN);
    const approved = await go(connect.pathname + connect.search);
    expect(approved.status).toBe(303);
    const back = new URL(approved.headers.get("location")!);
    expect(back.origin).toBe(`https://${HOST}`);
    const callback = await workspace(back.pathname + back.search, { cookie: start.cookies[0]!.split(";")[0] });
    expect(callback.status, JSON.stringify(callback.body)).toBe(302);
    return callback.cookies.find((value) => !value.startsWith("__Host-"))!.split(";")[0]!;
  }
  return { go, post, signIn, openWorkspace };
}

beforeAll(async () => {
  home = mkdtempSync(join(tmpdir(), "delio-portal-e2e-"));
  store = new AdminStore({ db: nodeDatabase(join(home, "admin.db")), secret: Buffer.alloc(32, 7) });
  portalServer = createServer();
  await new Promise<void>((done) => portalServer.listen(0, "127.0.0.1", done));
  portalOrigin = `http://127.0.0.1:${(portalServer.address() as AddressInfo).port}`;
  portalServer.on("request", createAdminApp({ store, publicUrl: new URL(portalOrigin), operators: new Set(["ops@delio.test"]), mailer: { send: async (message) => void mail.push(message) } }));

  port = await freePortBlock([0, 1], 36_000, 5_000);
  const layer = join(home, "layer");
  mkdirSync(join(layer, "server"), { recursive: true });
  mkdirSync(join(home, "static"));
  writeFileSync(join(home, "static", "index.html"), "<!doctype html><title>Acme workspace</title>");
  writeFileSync(join(layer, "server", "index.ts"), `
    import { createHostedWorkspaceAccess } from ${JSON.stringify(pathToFileURL(join(ROOT, "server/workspace-access.ts")).href)};
    export function register() { return { customer: 'Portal fixture', features: [], expiresAt: null }; }
    export function createWorkspaceAccess(options) {
      return createHostedWorkspaceAccess({ ...options, fetchImpl: (url, init) => {
        const target = new URL(url);
        if (target.origin !== ${JSON.stringify(ADMIN_ORIGIN)}) throw new Error('unexpected outbound origin');
        return fetch(new URL(target.pathname + target.search, ${JSON.stringify(portalOrigin)}), init);
      } });
    }
  `);
  child = spawn(process.execPath, [join(ROOT, "server/index.ts")], { cwd: ROOT, stdio: ["ignore", "pipe", "pipe"], env: {
    ...(process.env.PATH ? { PATH: process.env.PATH } : {}),
    HOME: home, USERPROFILE: home, ODB_PORT: String(port), ODB_WEBHOOK_PORT: String(port + 1),
    ODB_STATIC_DIR: join(home, "static"), ODB_BROWSER_CONNECTION: join(home, "browser-connection.json"),
    ODB_ENTERPRISE_DIR: layer, ODB_LICENSE_KEY: "fixture-only",
    ODB_ADMIN_URL: ADMIN_ORIGIN, ODB_ADMIN_WORKSPACE: "acme", ODB_PUBLIC_URL: `https://${HOST}`, ODB_ADMIN_MEMBERSHIP: "portal",
  } });
  child.stdout?.on("data", (chunk) => log += chunk); child.stderr?.on("data", (chunk) => log += chunk);
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    try { if ((await workspace("/api/health", { local: true })).status === 200) return; } catch { /* still starting */ }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`workspace fixture failed to start:\n${log}`);
}, 30_000);

afterAll(async () => {
  if (child) await waitForExit(child, { signal: "SIGTERM" });
  await new Promise<void>((done) => portalServer.close(() => done()));
  store.close();
  await removeTempDir(home);
});

describe("Delio Admin portal with a real workspace server", () => {
  const boss = person(), dev = person();
  let devId: string;

  it("creates a workspace, and its admin signs in to it through the portal", async () => {
    const ops = await operatorConsole({ store, operators: new Set(["ops@delio.test"]), mailer: { send: async (message) => void mail.push(message) } }, mail);
    expect((await ops.post("/workspaces", { slug: "acme", name: "Acme", tenantUrl: `https://${HOST}`, ownerEmail: "boss@acme.test" })).status).toBe(303);
    await ops.close();
    await boss.signIn("boss@acme.test");
    const cookie = await boss.openWorkspace();
    expect((await workspace("/api/auth/session", { cookie })).body).toMatchObject({ scopes: ["admin", "client"], hosted: true });
    expect((await workspace("/", { cookie })).body).toContain("Acme workspace");
    expect((await workspace("/api/health/hosted")).status).toBe(200);
  });

  it("keeps outsiders out, and lets an invited member in with member access only", async () => {
    const outsider = person();
    await outsider.signIn("outsider@acme.test");
    const start = await workspace("/api/auth/hosted/start");
    const connect = new URL(start.location!);
    expect((await outsider.go(connect.pathname + connect.search)).status).toBe(403);

    await boss.post("/people/invite", { workspace: "acme", email: "dev@acme.test", role: "admin" });
    const link = new URL(/Accepter : (\S+)/.exec(mail.at(-1)!.text)![1]!);
    await dev.signIn("dev@acme.test");
    expect((await dev.post("/invite/accept", { token: link.searchParams.get("token")! })).status).toBe(200);
    devId = store.members("acme").find((member) => member.email === "dev@acme.test")!.accountId;
    const cookie = await dev.openWorkspace();
    expect((await workspace("/api/auth/session", { cookie })).body.scopes).toEqual(["admin", "client"]);

    expect((await boss.post("/people/role", { workspace: "acme", account: devId, role: "member" })).status).toBe(303);
    expect((await workspace("/api/auth/session", { cookie })).status).toBe(401);
    const memberCookie = await dev.openWorkspace();
    expect((await workspace("/api/auth/session", { cookie: memberCookie })).body.scopes).toEqual(["client"]);
    expect((await workspace("/api/auth/sessions", { cookie: memberCookie })).status).toBe(403);
  });

  it("closes a removed member's quiet event stream within fifteen seconds", async () => {
    const cookie = await dev.openWorkspace();
    const response = await new Promise<IncomingMessage>((resolve, reject) => {
      const req = request({ hostname: "127.0.0.1", port, path: "/api/events", headers: { host: HOST, cookie, "x-forwarded-for": "203.0.113.8" } }, resolve);
      req.on("error", reject); req.end();
    });
    expect(response.statusCode).toBe(200);
    response.resume();
    const ended = new Promise<void>((resolve) => response.on("end", resolve));
    const removedAt = Date.now();
    expect((await boss.post("/people/remove", { workspace: "acme", account: devId })).status).toBe(303);
    await ended;
    expect(Date.now() - removedAt).toBeLessThan(15_000);
    expect((await workspace("/api/auth/session", { cookie })).status).toBe(401);
  }, 17_000);
});
