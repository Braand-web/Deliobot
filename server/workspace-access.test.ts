import { createHash } from "node:crypto";
import { mkdtempSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { createWorkspaceAccess } from "./enterprise.ts";
import { HOSTED_CONTRACT_ERROR, HOSTED_CONTRACT_MISMATCH } from "./hosted-contract.ts";
import type { RequestAuth } from "./request-auth.ts";
import { SessionRegistry } from "./sessions.ts";
import { removeTempDir } from "./testing/cleanup.ts";
import { createHostedWorkspaceAccess, HANDOFF_COOKIE, HOSTED_CALLBACK_PATH, HOSTED_START_PATH } from "./workspace-access.ts";

const ENV = { ODB_ADMIN_URL: "https://admin.example.test", ODB_ADMIN_WORKSPACE: "acme", ODB_PUBLIC_URL: "https://acme.example.test" };
const GRANT = "g".repeat(43);
const dirs: string[] = [];
afterEach(async () => { for (const dir of dirs.splice(0)) await removeTempDir(dir); });

interface Portal { role: "admin" | "member" | null; down: boolean; mismatch: boolean; calls: Array<{ path: string; body: any }> }

function setup(entitled = true) {
  const dir = mkdtempSync(join(tmpdir(), "odb-workspace-access-")); dirs.push(dir);
  const sessions = new SessionRegistry({ file: join(dir, "sessions.json"), portalMembership: true });
  const portal: Portal = { role: "admin", down: false, mismatch: false, calls: [] };
  const closed: string[] = [];
  const access = createHostedWorkspaceAccess({
    sessions, cookieName: "odb-session", closeSessionStreams: (id) => closed.push(id), entitled: () => entitled, env: ENV,
    fetchImpl: async (url, init) => {
      const path = new URL(String(url)).pathname;
      const body = JSON.parse(String(init?.body));
      portal.calls.push({ path, body });
      if (portal.down) throw new Error("offline");
      if (portal.mismatch) return Response.json({ code: HOSTED_CONTRACT_MISMATCH }, { status: 409 });
      if (!portal.role) return Response.json({}, { status: 401 });
      return Response.json({ contractVersion: 1, email: "Member@Example.test", role: portal.role, grant: GRANT });
    },
  })!;
  return { sessions, portal, closed, access };
}

function request(path: string, headers: Record<string, string> = {}) {
  const req = { method: "GET", headers: { host: "acme.example.test", "x-forwarded-for": "203.0.113.8", ...headers }, socket: { remoteAddress: "127.0.0.1" } } as unknown as IncomingMessage;
  const res = { statusCode: 200, headers: {} as Record<string, unknown>, body: "",
    setHeader(name: string, value: unknown) { this.headers[name.toLowerCase()] = value; },
    end(chunk?: string) { this.body = chunk ?? ""; } };
  return { req, res: res as unknown as ServerResponse & typeof res, url: new URL(path, "https://acme.example.test") };
}

async function begin(access: ReturnType<typeof setup>["access"]) {
  const started = request(HOSTED_START_PATH);
  expect(await access.handlePublic(started.req, started.res, started.url)).toBe(true);
  const location = new URL(String(started.res.headers.location));
  const cookie = String((started.res.headers["set-cookie"] as string[])[0]).split(";")[0]!;
  return { location, cookie };
}

async function signIn(context: ReturnType<typeof setup>) {
  const { location, cookie } = await begin(context.access);
  const back = request(`${HOSTED_CALLBACK_PATH}?state=${location.searchParams.get("state")}&code=${"c".repeat(43)}`, { cookie });
  await context.access.handlePublic(back.req, back.res, back.url);
  return back;
}

const sessionAuth = (sessions: SessionRegistry, token: string): RequestAuth => {
  const session = sessions.authenticate(token)!;
  return { kind: "session", session, via: "cookie", scopes: session.scopes };
};

describe("hosted sign-in, workspace side", () => {
  it("is absent without a complete hosted configuration, and built in once there is one", () => {
    const sessions = new SessionRegistry({ file: join(mkdtempSync(join(tmpdir(), "odb-wa-")), "s.json") });
    const base = { sessions, cookieName: "c", closeSessionStreams() {}, entitled: () => true };
    expect(createHostedWorkspaceAccess({ ...base, env: { ODB_ADMIN_WORKSPACE: "acme" } })).toBeNull();
    expect(createHostedWorkspaceAccess({ ...base, env: { ...ENV, ODB_ADMIN_URL: "http://admin.example.test" } })).toBeNull();
    expect(createWorkspaceAccess({ sessions, cookieName: "c", closeSessionStreams() {}, env: ENV })).not.toBeNull();
  });

  it("starts with a host-only handoff cookie and an S256 challenge sent to the portal's /connect", async () => {
    const { access } = setup();
    const { location, cookie } = await begin(access);
    expect(location.origin + location.pathname).toBe("https://admin.example.test/connect");
    expect(Object.fromEntries(location.searchParams)).toMatchObject({ workspace: "acme", code_challenge_method: "S256",
      redirect_uri: "https://acme.example.test/api/auth/hosted/callback" });
    expect(location.searchParams.get("code_challenge")).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(cookie.startsWith(`${HANDOFF_COOKIE}=`)).toBe(true);
  });

  it("exchanges the code once, with the verifier that matches the challenge, and issues a portal session for the role", async () => {
    const context = setup();
    const { location, cookie } = await begin(context.access);
    const state = location.searchParams.get("state")!;
    const back = request(`${HOSTED_CALLBACK_PATH}?state=${state}&code=${"c".repeat(43)}`, { cookie });
    await context.access.handlePublic(back.req, back.res, back.url);
    expect(back.res.statusCode).toBe(302);
    expect(back.res.headers.location).toBe("/");
    const consume = context.portal.calls.find((call) => call.path === "/api/handoff/consume")!;
    expect(consume.body).toMatchObject({ workspace: "acme", code: "c".repeat(43), contractVersion: 1 });
    expect(createHash("sha256").update(consume.body.verifier).digest("base64url")).toBe(location.searchParams.get("code_challenge"));
    const token = (back.res.headers["set-cookie"] as string[]).find((value) => value.startsWith("odb-session="))!.split(";")[0]!.split("=")[1]!;
    const auth = sessionAuth(context.sessions, token);
    expect(auth.scopes).toEqual(["admin", "client"]);
    expect((auth as Extract<RequestAuth, { kind: "session" }>).session.email).toBe("member@example.test");

    const replay = request(`${HOSTED_CALLBACK_PATH}?state=${state}&code=${"c".repeat(43)}`, { cookie });
    await context.access.handlePublic(replay.req, replay.res, replay.url);
    expect(replay.res.statusCode).toBe(400);
    expect(context.portal.calls.filter((call) => call.path === "/api/handoff/consume")).toHaveLength(1);
  });

  it("refuses a callback without the handoff cookie that began it", async () => {
    const context = setup();
    const { location } = await begin(context.access);
    const back = request(`${HOSTED_CALLBACK_PATH}?state=${location.searchParams.get("state")}&code=${"c".repeat(43)}`, { cookie: `${HANDOFF_COOKIE}=forged` });
    await context.access.handlePublic(back.req, back.res, back.url);
    expect(back.res.statusCode).toBe(400);
    expect(context.portal.calls).toEqual([]);
  });

  it("answers a contract mismatch with the plain upgrade message, never the portal's details", async () => {
    const context = setup();
    context.portal.mismatch = true;
    const back = await signIn(context);
    expect(back.res.statusCode).toBe(503);
    expect(JSON.parse(back.res.body)).toEqual({ error: HOSTED_CONTRACT_ERROR });
  });

  it("checks the grant on every request: an outage keeps the session, removal and demotion end it, promotion does not widen it", async () => {
    const context = setup();
    const token = (await signIn(context)).res.headers["set-cookie"] as string[];
    const value = token.find((entry) => entry.startsWith("odb-session="))!.split(";")[0]!.split("=")[1]!;
    const auth = sessionAuth(context.sessions, value);
    const id = (auth as Extract<RequestAuth, { kind: "session" }>).session.id;
    expect(await context.access.authorize({} as IncomingMessage, auth)).toBeNull();
    context.portal.down = true;
    expect(await context.access.authorize({} as IncomingMessage, auth)).toMatchObject({ status: 503 });
    expect(context.closed).toContain(id);
    expect(context.sessions.isLive(id)).toBe(true);
    context.portal.down = false; context.portal.role = "member";
    expect(await context.access.authorize({} as IncomingMessage, auth)).toMatchObject({ status: 401 });
    expect(context.sessions.isLive(id)).toBe(false);

    const member = (await signIn(context)).res.headers["set-cookie"] as string[];
    const memberAuth = sessionAuth(context.sessions, member.find((entry) => entry.startsWith("odb-session="))!.split(";")[0]!.split("=")[1]!);
    expect(memberAuth.scopes).toEqual(["client"]);
    context.portal.role = "admin";
    expect(await context.access.authorize({} as IncomingMessage, memberAuth)).toBeNull();
    expect(memberAuth.scopes).toEqual(["client"]);
  });

  it("refuses any session the portal did not issue", async () => {
    const context = setup();
    const paired = context.sessions.issue({ label: "Old phone", scopes: ["admin", "client"] });
    expect(await context.access.authorize({} as IncomingMessage, sessionAuth(context.sessions, paired.token))).toMatchObject({ status: 401 });
    expect(context.portal.calls).toEqual([]);
  });

  it("sweeps quiet sessions: a removed member's streams close and the session ends", async () => {
    const context = setup();
    await signIn(context);
    const [session] = context.sessions.portalSessions();
    context.portal.role = null;
    await context.access.revalidate();
    expect(context.closed).toContain(session!.id);
    expect(context.sessions.portalSessions()).toEqual([]);
  });

  it("sends a signed-out browser's navigation to the portal, and leaves this machine's own requests alone", async () => {
    const { access } = setup();
    const page = request("/");
    expect(await access.handlePublic(page.req, page.res, page.url)).toBe(true);
    expect(page.res.headers.location).toBe(HOSTED_START_PATH);
    const local = request("/", { host: "127.0.0.1:8799" });
    delete (local.req.headers as Record<string, unknown>)["x-forwarded-for"];
    expect(await access.handlePublic(local.req, local.res, local.url)).toBe(false);
  });
});
