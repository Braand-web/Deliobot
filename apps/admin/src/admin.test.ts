import { createHash, generateKeyPairSync, randomBytes, sign } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { HOSTED_CONTRACT_MISMATCH } from "../../../server/hosted-contract.ts";
import { createAdminApp } from "./app.ts";
import type { MailMessage } from "./mail.ts";
import { AdminStore } from "./store.ts";

const TENANT = "https://acme.example.test";
const CALLBACK = `${TENANT}/api/auth/hosted/callback`;
const cleanups: Array<() => void | Promise<void>> = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });

async function listen(server: Server): Promise<string> {
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  cleanups.push(() => new Promise<void>((done) => server.close(() => done())));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

async function portal(options: { fetchImpl?: typeof fetch; now?: () => number } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "delio-admin-"));
  const store = new AdminStore({ file: join(dir, "admin.db"), secret: randomBytes(32), now: options.now });
  cleanups.push(() => { store.close(); rmSync(dir, { recursive: true, force: true }); });
  const mail: MailMessage[] = [];
  const server = createServer();
  const origin = await listen(server);
  server.on("request", createAdminApp({ store, publicUrl: new URL(origin), operators: new Set(["ops@delio.test"]), mailer: { send: async (message) => void mail.push(message) },
    fetchImpl: options.fetchImpl, now: options.now, allowHttpProviders: true }));
  return { origin, store, mail };
}

type Portal = Awaited<ReturnType<typeof portal>>;

/** A browser: one cookie jar, forms posted from the portal's own origin, redirects left for the test to follow. */
function browser(target: Portal) {
  let cookie = "";
  async function go(path: string, init: RequestInit = {}) {
    const response = await fetch(new URL(path, target.origin), { ...init, redirect: "manual", headers: { ...(cookie ? { cookie } : {}), ...init.headers as Record<string, string> } });
    const set = response.headers.getSetCookie()[0];
    if (set) cookie = set.split(";")[0]!.endsWith("=") ? "" : set.split(";")[0]!;
    return response;
  }
  const post = (path: string, form: Record<string, string>, origin = target.origin) =>
    go(path, { method: "POST", headers: { origin, "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(form).toString() });
  async function signIn(email: string) {
    await post("/login", { email, next: "/" });
    const code = /code is (\d{4}) (\d{4})/.exec(target.mail.at(-1)!.text)!;
    const response = await post("/login/verify", { email, code: code[1]! + code[2]!, next: "/" });
    expect(response.status).toBe(303);
    return response;
  }
  return { go, post, signIn, get cookie() { return cookie; } };
}

async function backchannel(target: Portal, path: string, body: Record<string, unknown>) {
  const response = await fetch(new URL(path, target.origin), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  return { status: response.status, body: await response.json() as Record<string, unknown> };
}

async function workspaceWithAdmin(target: Portal) {
  const ops = browser(target);
  await ops.signIn("ops@delio.test");
  const created = await ops.post("/workspaces", { slug: "acme", name: "Acme", tenantUrl: TENANT, ownerEmail: "boss@acme.test" });
  expect(created.status).toBe(303);
  const boss = browser(target);
  await boss.signIn("boss@acme.test");
  return boss;
}

async function invite(target: Portal, admin: ReturnType<typeof browser>, email: string, role: "admin" | "member") {
  await admin.post("/people/invite", { workspace: "acme", email, role });
  const link = /Accept: (\S+)/.exec(target.mail.at(-1)!.text)![1]!;
  const person = browser(target);
  await person.signIn(email);
  const accepted = await person.post("/invite/accept", { token: new URL(link).searchParams.get("token")! });
  expect(accepted.status).toBe(200);
  return person;
}

async function connect(person: ReturnType<typeof browser>, verifier = randomBytes(48).toString("base64url")) {
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  const response = await person.go(`/connect?${new URLSearchParams({ workspace: "acme", state: "s".repeat(43), code_challenge: challenge, code_challenge_method: "S256", redirect_uri: CALLBACK })}`);
  return { response, verifier, code: response.headers.get("location")?.startsWith(CALLBACK) ? new URL(response.headers.get("location")!).searchParams.get("code") : null };
}

describe("Delio Admin accounts", () => {
  it("signs in with an emailed one-time code, locks a code after five wrong tries, and limits how often codes are sent", async () => {
    const target = await portal();
    const visitor = browser(target);
    expect((await visitor.go("/")).headers.get("location")).toBe("/login?next=%2F");
    await visitor.post("/login", { email: "Someone@Example.test", next: "/" });
    expect(target.mail.at(-1)!.to).toBe("someone@example.test");
    for (let attempt = 0; attempt < 5; attempt++) expect((await visitor.post("/login/verify", { email: "someone@example.test", code: "00000000", next: "/" })).status).toBe(401);
    const code = /code is (\d{4}) (\d{4})/.exec(target.mail.at(-1)!.text)!;
    const locked = await visitor.post("/login/verify", { email: "someone@example.test", code: code[1]! + code[2]!, next: "/" });
    expect(await locked.text()).toContain("Too many wrong codes");
    await visitor.signIn("someone@example.test");
    expect((await visitor.go("/")).status).toBe(200);
    for (let sent = 0; sent < 4; sent++) await visitor.post("/login", { email: "someone@example.test", next: "/" });
    expect((await visitor.post("/login", { email: "someone@example.test", next: "/" })).status).toBe(429);
  });

  it("refuses forms posted from another site and never redirects off the portal after sign-in", async () => {
    const target = await portal();
    const visitor = browser(target);
    expect((await visitor.go("/login")).headers.get("referrer-policy"), "a no-referrer page makes Chromium post its forms with Origin: null").toBe("same-origin");
    expect((await visitor.post("/login", { email: "a@b.test", next: "/" }, "https://evil.example.test")).status).toBe(403);
    expect(target.mail).toEqual([]);
    await visitor.post("/login", { email: "a@b.test", next: "//evil.example.test/" });
    const code = /code is (\d{4}) (\d{4})/.exec(target.mail.at(-1)!.text)!;
    const signedIn = await visitor.post("/login/verify", { email: "a@b.test", code: code[1]! + code[2]!, next: "//evil.example.test/" });
    expect(signedIn.headers.get("location")).toBe("/");
  });

  it("lets only operators create workspaces, and only a workspace's admins manage its people", async () => {
    const target = await portal();
    const stranger = browser(target);
    await stranger.signIn("stranger@acme.test");
    expect((await stranger.post("/workspaces", { slug: "acme", name: "Acme", tenantUrl: TENANT, ownerEmail: "stranger@acme.test" })).status).toBe(403);
    const boss = await workspaceWithAdmin(target);
    expect((await boss.go("/people?workspace=acme")).status).toBe(200);
    expect((await stranger.go("/people?workspace=acme")).status).toBe(403);
    const member = await invite(target, boss, "dev@acme.test", "member");
    expect((await member.go("/people?workspace=acme")).status).toBe(403);
    expect((await member.post("/people/invite", { workspace: "acme", email: "x@acme.test", role: "admin" })).status).toBe(403);
  });

  it("accepts an invitation only for the invited address, and always keeps one admin", async () => {
    const target = await portal();
    const boss = await workspaceWithAdmin(target);
    await boss.post("/people/invite", { workspace: "acme", email: "dev@acme.test", role: "member" });
    const link = new URL(/Accept: (\S+)/.exec(target.mail.at(-1)!.text)![1]!);
    const other = browser(target);
    await other.signIn("other@acme.test");
    expect((await other.post("/invite/accept", { token: link.searchParams.get("token")! })).status).toBe(400);

    const bossId = target.store.members("acme")[0]!.accountId;
    expect((await boss.post("/people/role", { workspace: "acme", account: bossId, role: "member" })).status).toBe(409);
    expect((await boss.post("/people/remove", { workspace: "acme", account: bossId })).status).toBe(409);
    expect(target.store.role("acme", bossId)).toBe("admin");
  });
});

describe("Delio Admin hosted handoff", () => {
  it("sends a signed-out visitor to sign in, refuses a callback address other than the workspace's own, and refuses non-members", async () => {
    const target = await portal();
    await workspaceWithAdmin(target);
    const visitor = browser(target);
    const first = await connect(visitor);
    expect(first.response.headers.get("location")).toMatch(/^\/login\?next=%2Fconnect%3F/);
    await visitor.signIn("outsider@acme.test");
    expect((await connect(visitor)).response.status).toBe(403);
    const elsewhere = await visitor.go(`/connect?${new URLSearchParams({ workspace: "acme", state: "s".repeat(43), code_challenge: "c".repeat(43), code_challenge_method: "S256",
      redirect_uri: "https://evil.example.test/api/auth/hosted/callback" })}`);
    expect(elsewhere.status).toBe(400);
  });

  it("exchanges a code once with the matching verifier, and checks the live role of the grant", async () => {
    const target = await portal();
    const boss = await workspaceWithAdmin(target);
    const dev = await invite(target, boss, "dev@acme.test", "admin");
    const { response, verifier, code } = await connect(dev);
    const back = new URL(response.headers.get("location")!);
    expect(back.origin + back.pathname).toBe(CALLBACK);
    expect(back.searchParams.get("state")).toBe("s".repeat(43));

    const wrong = await connect(dev);
    expect((await backchannel(target, "/api/handoff/consume", { workspace: "acme", code: wrong.code, verifier: "v".repeat(64), contractVersion: 1 })).status).toBe(401);
    expect((await backchannel(target, "/api/handoff/consume", { workspace: "acme", code: wrong.code, verifier: wrong.verifier, contractVersion: 1 })).status).toBe(401);

    const consumed = await backchannel(target, "/api/handoff/consume", { workspace: "acme", code, verifier, contractVersion: 1 });
    expect(consumed).toMatchObject({ status: 200, body: { contractVersion: 1, email: "dev@acme.test", role: "admin" } });
    const grant = consumed.body.grant as string;
    expect(grant).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect((await backchannel(target, "/api/handoff/consume", { workspace: "acme", code, verifier, contractVersion: 1 })).status).toBe(401);

    expect(await backchannel(target, "/api/handoff/check", { workspace: "acme", grant, contractVersion: 1 })).toMatchObject({ status: 200, body: { role: "admin" } });
    expect((await backchannel(target, "/api/handoff/check", { workspace: "other", grant, contractVersion: 1 })).status).toBe(404);
    const devId = target.store.members("acme").find((member) => member.email === "dev@acme.test")!.accountId;
    await boss.post("/people/role", { workspace: "acme", account: devId, role: "member" });
    expect(await backchannel(target, "/api/handoff/check", { workspace: "acme", grant, contractVersion: 1 })).toMatchObject({ status: 200, body: { role: "member" } });
    await boss.post("/people/remove", { workspace: "acme", account: devId });
    expect((await backchannel(target, "/api/handoff/check", { workspace: "acme", grant, contractVersion: 1 })).status).toBe(404);
  });

  it("refuses an unsupported contract version before spending the code, and accepts a legacy-v1 peer that omits it", async () => {
    const target = await portal();
    const boss = await workspaceWithAdmin(target);
    const { code, verifier } = await connect(boss);
    for (const contractVersion of [2, "1", null]) {
      expect(await backchannel(target, "/api/handoff/consume", { workspace: "acme", code, verifier, contractVersion }))
        .toMatchObject({ status: 409, body: { code: HOSTED_CONTRACT_MISMATCH } });
    }
    expect((await backchannel(target, "/api/handoff/consume", { workspace: "acme", code, verifier })).status).toBe(200);
  });

  it("expires an unused code after a minute", async () => {
    let clock = Date.now();
    const target = await portal({ now: () => clock });
    const boss = await workspaceWithAdmin(target);
    const { code, verifier } = await connect(boss);
    clock += 61_000;
    expect((await backchannel(target, "/api/handoff/consume", { workspace: "acme", code, verifier, contractVersion: 1 })).status).toBe(401);
  });
});

describe("Delio Admin single sign-on", () => {
  async function identityProvider(overrides: { nonce?: string; emailVerified?: boolean; email?: string } = {}) {
    const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const jwk = { ...publicKey.export({ format: "jwk" }), kid: "k1", alg: "RS256", use: "sig" };
    const codes = new Map<string, { nonce: string; challenge: string }>();
    const server = createServer();
    const issuer = await listen(server);
    server.on("request", async (req, res) => {
      const url = new URL(req.url!, issuer);
      res.setHeader("content-type", "application/json");
      if (url.pathname === "/.well-known/openid-configuration") {
        return res.end(JSON.stringify({ issuer, authorization_endpoint: `${issuer}/authorize`, token_endpoint: `${issuer}/token`, jwks_uri: `${issuer}/jwks` }));
      }
      if (url.pathname === "/jwks") return res.end(JSON.stringify({ keys: [jwk] }));
      if (url.pathname === "/token") {
        let body = "";
        for await (const chunk of req) body += chunk;
        const form = new URLSearchParams(body);
        const issued = codes.get(form.get("code")!);
        if (!issued || form.get("client_secret") !== "top-secret" || createHash("sha256").update(form.get("code_verifier")!).digest("base64url") !== issued.challenge) {
          res.statusCode = 400;
          return res.end("{}");
        }
        const now = Math.floor(Date.now() / 1000);
        const part = (value: object) => Buffer.from(JSON.stringify(value)).toString("base64url");
        const unsigned = `${part({ alg: "RS256", kid: "k1" })}.${part({ iss: issuer, aud: "client-1", sub: "u1", exp: now + 300, iat: now,
          nonce: overrides.nonce ?? issued.nonce, email: overrides.email ?? "Ana@Acme.test", email_verified: overrides.emailVerified ?? true })}`;
        return res.end(JSON.stringify({ id_token: `${unsigned}.${sign("sha256", Buffer.from(unsigned), privateKey).toString("base64url")}` }));
      }
      res.statusCode = 404;
      res.end("{}");
    });
    /** Plays the provider's consent screen: approves the authorization request and returns the redirect back to the portal. */
    const approve = (authorize: string) => {
      const url = new URL(authorize);
      const code = randomBytes(16).toString("base64url");
      codes.set(code, { nonce: url.searchParams.get("nonce")!, challenge: url.searchParams.get("code_challenge")! });
      const back = new URL(url.searchParams.get("redirect_uri")!);
      back.search = new URLSearchParams({ code, state: url.searchParams.get("state")! }).toString();
      return back.pathname + back.search;
    };
    return { issuer, approve };
  }

  async function configured(provider: Awaited<ReturnType<typeof identityProvider>>) {
    const target = await portal();
    const boss = await workspaceWithAdmin(target);
    const saved = await boss.post("/sso", { workspace: "acme", issuer: provider.issuer, clientId: "client-1", clientSecret: "top-secret", domain: "acme.test", autoJoin: "1" });
    expect(saved.status).toBe(303);
    return target;
  }

  it("signs a company address in through the identity provider and adds it as a member", async () => {
    const provider = await identityProvider();
    const target = await configured(provider);
    const ana = browser(target);
    const started = await ana.post("/login", { email: "ana@acme.test", next: "/" });
    const authorize = started.headers.get("location")!;
    expect(new URL(authorize).searchParams.get("code_challenge_method")).toBe("S256");
    const done = await ana.go(provider.approve(authorize));
    expect(done.status).toBe(303);
    expect((await ana.go("/")).status).toBe(200);
    expect(target.store.members("acme").find((member) => member.email === "ana@acme.test")?.role).toBe("member");
    expect((await ana.go(provider.approve(authorize))).status).toBe(400);
  });

  it.each([
    ["a replayed nonce", { nonce: "other" }],
    ["an unverified email", { emailVerified: false }],
  ])("refuses an ID token with %s", async (_name, overrides) => {
    const provider = await identityProvider(overrides);
    const target = await configured(provider);
    const ana = browser(target);
    const started = await ana.post("/login", { email: "ana@acme.test", next: "/" });
    expect((await ana.go(provider.approve(started.headers.get("location")!))).status).toBe(401);
    expect(ana.cookie).toBe("");
  });

  it("refuses an identity outside the configured domain", async () => {
    const provider = await identityProvider({ email: "eve@elsewhere.test" });
    const target = await configured(provider);
    const eve = browser(target);
    const started = await eve.post("/login", { email: "eve@acme.test", next: "/" });
    expect((await eve.go(provider.approve(started.headers.get("location")!))).status).toBe(403);
  });
});
