// The workspace side of hosted sign-in: a PKCE handoff with the Delio Admin portal, a grant check on every remote request,
// and a periodic sweep that ends sessions the portal no longer vouches for. Wire contract: hosted-contract.ts.
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";

import { hostedWorkspaceConfiguration, type WorkspaceAccess, type WorkspaceAccessOptions } from "./enterprise.ts";
import { HOSTED_CONTRACT_ERROR, HOSTED_CONTRACT_HEADER, HOSTED_CONTRACT_MISMATCH, HOSTED_CONTRACT_VERSION, hostedContractCompatible } from "./hosted-contract.ts";
import { isLoopbackHost, isProxied, parseCookies, serializeSessionCookie, type RequestAuth } from "./request-auth.ts";
import { cookieMaxAgeSeconds, type Scope } from "./sessions.ts";

export const HOSTED_START_PATH = "/api/auth/hosted/start";
export const HOSTED_CALLBACK_PATH = "/api/auth/hosted/callback";
/** Host-only and Secure: a handoff begun on this origin can only finish here. */
export const HANDOFF_COOKIE = "__Host-odb-hosted";

const HANDOFF_TTL_MS = 10 * 60_000;
const MAX_PENDING_HANDOFFS = 1_000;
const PORTAL_DEADLINE_MS = 5_000;
const GRANT = /^[A-Za-z0-9_-]{43}$/;
const CODE = /^[A-Za-z0-9_-]{16,128}$/;
const UNAVAILABLE = "Workspace sign-in is unavailable.";
const PORTAL_DOWN = "The workspace sign-in service is not answering. Try again in a moment.";
const ACCESS_ENDED = "Your access to this workspace has ended. Sign in again through the workspace portal.";

type Role = "admin" | "member";
type Verdict = { kind: "member"; email: string; role: Role } | { kind: "revoked" } | { kind: "outage"; error: string };

interface Handoff { verifier: string; nonce: string; expiresAt: number }

const b64url = (bytes: Buffer) => bytes.toString("base64url");
const challengeOf = (verifier: string) => b64url(createHash("sha256").update(verifier).digest());
const scopesFor = (role: Role): Scope[] => role === "admin" ? ["admin", "client"] : ["client"];

function sameText(left: string, right: string): boolean {
  const a = Buffer.from(left), b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

function remote(req: IncomingMessage): boolean {
  return !isLoopbackHost(req.headers.host) || isProxied(req);
}

function redirect(res: ServerResponse, location: string, cookies: string[] = []): void {
  res.statusCode = 302;
  res.setHeader("cache-control", "no-store");
  if (cookies.length) res.setHeader("set-cookie", cookies);
  res.setHeader("location", location);
  res.end();
}

function reply(res: ServerResponse, status: number, error: string, cookies: string[] = []): void {
  res.statusCode = status;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.setHeader("cache-control", "no-store");
  if (cookies.length) res.setHeader("set-cookie", cookies);
  res.end(JSON.stringify({ error }));
}

const clearHandoff = `${HANDOFF_COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`;

/** Null when the deployment's hosted settings are incomplete or invalid: the server then refuses hosted access outright. */
export function createHostedWorkspaceAccess(options: WorkspaceAccessOptions): WorkspaceAccess | null {
  const hosted = hostedWorkspaceConfiguration(options.env);
  if (!hosted) return null;
  const { sessions, cookieName, closeSessionStreams, entitled } = options;
  const fetchImpl = options.fetchImpl ?? fetch;
  const now = options.now ?? Date.now;
  const handoffs = new Map<string, Handoff>();
  const inFlight = new Map<string, Promise<Verdict>>();
  const callbackUrl = new URL(HOSTED_CALLBACK_PATH, hosted.tenant).href;

  function prune(): void {
    const at = now();
    for (const [state, handoff] of handoffs) if (handoff.expiresAt <= at) handoffs.delete(state);
    while (handoffs.size > MAX_PENDING_HANDOFFS) handoffs.delete(handoffs.keys().next().value!);
  }

  async function portal(path: string, body: Record<string, unknown>): Promise<Response> {
    return fetchImpl(new URL(path, hosted!.admin).href, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json", [HOSTED_CONTRACT_HEADER]: String(HOSTED_CONTRACT_VERSION) },
      body: JSON.stringify({ workspace: hosted!.workspace, contractVersion: HOSTED_CONTRACT_VERSION, ...body }),
      signal: AbortSignal.timeout(PORTAL_DEADLINE_MS),
      redirect: "error",
    });
  }

  async function mismatch(response: Response): Promise<boolean> {
    if (response.status !== 409) return false;
    const body: unknown = await response.json().catch(() => null);
    return Boolean(body && typeof body === "object" && Reflect.get(body, "code") === HOSTED_CONTRACT_MISMATCH);
  }

  function identity(body: unknown): { email: string; role: Role } | null {
    if (!body || typeof body !== "object") return null;
    if (!hostedContractCompatible(Reflect.get(body, "contractVersion"))) return null;
    const email = Reflect.get(body, "email"), role = Reflect.get(body, "role");
    if (typeof email !== "string" || !email.includes("@") || email.length > 320) return null;
    if (role !== "admin" && role !== "member") return null;
    return { email: email.trim().toLowerCase(), role };
  }

  async function check(grant: string): Promise<Verdict> {
    const pending = inFlight.get(grant);
    if (pending) return pending;
    const verdict = (async (): Promise<Verdict> => {
      let response: Response;
      try {
        response = await portal("/api/handoff/check", { grant });
      } catch {
        return { kind: "outage", error: PORTAL_DOWN };
      }
      if (await mismatch(response)) {
        console.warn(`workspace sign-in: the Admin portal refused contract version ${HOSTED_CONTRACT_VERSION}`);
        return { kind: "outage", error: HOSTED_CONTRACT_ERROR };
      }
      if (response.status === 401 || response.status === 403 || response.status === 404) return { kind: "revoked" };
      if (!response.ok) return { kind: "outage", error: PORTAL_DOWN };
      const found = identity(await response.json().catch(() => null));
      return found ? { kind: "member", ...found } : { kind: "outage", error: PORTAL_DOWN };
    })().finally(() => inFlight.delete(grant));
    inFlight.set(grant, verdict);
    return verdict;
  }

  /** Revokes what the portal no longer vouches for; null when the session may go on. */
  function apply(id: string, scopes: readonly Scope[], verdict: Verdict): { status: 401 | 503; error: string } | null {
    if (verdict.kind === "outage") {
      closeSessionStreams(id);
      return { status: 503, error: verdict.error };
    }
    // Demotion ends the session; promotion never widens an existing credential.
    if (verdict.kind === "revoked" || (scopes.includes("admin") && verdict.role !== "admin")) {
      sessions.revoke(id);
      closeSessionStreams(id);
      return { status: 401, error: ACCESS_ENDED };
    }
    return null;
  }

  function signedIn(req: IncomingMessage): boolean {
    const token = parseCookies(Array.isArray(req.headers.cookie) ? req.headers.cookie.join("; ") : req.headers.cookie).get(cookieName);
    const record = sessions.authenticate(token);
    return Boolean(record && record.membershipAuthority === "portal");
  }

  async function start(res: ServerResponse): Promise<void> {
    prune();
    const state = b64url(randomBytes(32));
    const verifier = b64url(randomBytes(48));
    const nonce = b64url(randomBytes(32));
    handoffs.set(state, { verifier, nonce, expiresAt: now() + HANDOFF_TTL_MS });
    const connect = new URL("/connect", hosted!.admin);
    connect.search = new URLSearchParams({
      workspace: hosted!.workspace, state, code_challenge: challengeOf(verifier), code_challenge_method: "S256", redirect_uri: callbackUrl,
    }).toString();
    redirect(res, connect.href, [`${HANDOFF_COOKIE}=${nonce}; Path=/; Max-Age=${HANDOFF_TTL_MS / 1000}; HttpOnly; Secure; SameSite=Lax`]);
  }

  async function callback(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
    prune();
    const state = url.searchParams.get("state") ?? "";
    const code = url.searchParams.get("code") ?? "";
    const handoff = handoffs.get(state);
    const nonce = parseCookies(Array.isArray(req.headers.cookie) ? req.headers.cookie.join("; ") : req.headers.cookie).get(HANDOFF_COOKIE) ?? "";
    // Security: the state is spent before the portal is asked, so a replayed callback never reaches it twice.
    handoffs.delete(state);
    if (!handoff || !CODE.test(code) || !sameText(handoff.nonce, nonce)) {
      return reply(res, 400, "This sign-in link has expired or was already used. Start again from the workspace address.", [clearHandoff]);
    }
    let response: Response;
    try {
      response = await portal("/api/handoff/consume", { code, verifier: handoff.verifier });
    } catch {
      return reply(res, 503, PORTAL_DOWN, [clearHandoff]);
    }
    if (await mismatch(response)) {
      console.warn(`workspace sign-in: the Admin portal refused contract version ${HOSTED_CONTRACT_VERSION}`);
      return reply(res, 503, HOSTED_CONTRACT_ERROR, [clearHandoff]);
    }
    if (!response.ok) return reply(res, 401, "The workspace portal did not accept this sign-in. Start again.", [clearHandoff]);
    const body: unknown = await response.json().catch(() => null);
    const found = identity(body);
    const grant = body && typeof body === "object" ? Reflect.get(body, "grant") : undefined;
    if (!found || typeof grant !== "string" || !GRANT.test(grant)) return reply(res, 502, PORTAL_DOWN, [clearHandoff]);
    const issued = sessions.issuePortal({ email: found.email, grant, scopes: scopesFor(found.role) });
    redirect(res, "/", [clearHandoff, serializeSessionCookie(cookieName, issued.token, { secure: true, maxAgeSeconds: cookieMaxAgeSeconds(issued.session) })]);
  }

  return {
    async handlePublic(req, res, url) {
      const method = req.method ?? "GET";
      const hostedPath = url.pathname === HOSTED_START_PATH || url.pathname === HOSTED_CALLBACK_PATH;
      if (hostedPath && !entitled()) {
        reply(res, 503, UNAVAILABLE);
        return true;
      }
      if (url.pathname === HOSTED_START_PATH) {
        if (method !== "GET") reply(res, 405, "method not allowed");
        else await start(res);
        return true;
      }
      if (url.pathname === HOSTED_CALLBACK_PATH) {
        if (method !== "GET") reply(res, 405, "method not allowed");
        else await callback(req, res, url);
        return true;
      }
      if (method === "GET" && (url.pathname === "/" || url.pathname === "/pair") && remote(req) && !signedIn(req)) {
        if (!entitled()) reply(res, 503, UNAVAILABLE);
        else redirect(res, HOSTED_START_PATH);
        return true;
      }
      return false;
    },

    async authorize(_req, auth: RequestAuth) {
      if (auth.kind !== "session") return null;
      if (!entitled()) return { status: 503, error: UNAVAILABLE };
      const record = auth.session;
      const grant = record.membershipAuthority === "portal" && record.userId?.startsWith("portal:") ? record.userId.slice("portal:".length) : "";
      if (!GRANT.test(grant)) return { status: 401, error: "Sign in through the workspace portal." };
      return apply(record.id, record.scopes, await check(grant));
    },

    async revalidate() {
      if (!entitled()) {
        for (const session of sessions.portalSessions()) closeSessionStreams(session.id);
        return;
      }
      await Promise.all(sessions.portalSessions().map(async (session) => {
        apply(session.id, session.scopes, await check(session.grant));
      }));
    },
  };
}
