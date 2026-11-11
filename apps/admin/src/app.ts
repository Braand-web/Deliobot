import { readFileSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";

import { HOSTED_CONTRACT_HEADER, HOSTED_CONTRACT_METADATA, HOSTED_CONTRACT_MISMATCH, HOSTED_CONTRACT_VERSION, hostedContractCompatible } from "../../../server/hosted-contract.ts";
import type { Mailer } from "./mail.ts";
import { discover, exchangeCode, pkceChallenge, verifyIdToken } from "./oidc.ts";
import { createGateway, type GatewayOptions } from "./gateway.ts";
import { DEVICE_POLL_SECONDS, Devices } from "./devices.ts";
import { Billing, PLANS, priceIn, reconcileOrders, TOPUPS, type PlanId, type TopupId } from "./plans.ts";
import { createSasPay, verifySasPayWebhook } from "./saspay.ts";
import { MICRO, Wallet } from "./wallet.ts";
import { billingPage, codePage, devicePage, homePage, invitePage, loginPage, messagePage, page, peoplePage, slackPage, ssoPage, type Html } from "./pages.ts";
import { normalizeEmail, token, validEmail, validSlug, type Account, type AdminStore, type Role, type Workspace } from "./store.ts";

export interface AdminAppOptions {
  store: AdminStore;
  /** The portal's own public origin; https in production. */
  publicUrl: URL;
  /** Addresses allowed to create workspaces. */
  operators: ReadonlySet<string>;
  mailer: Mailer;
  fetchImpl?: typeof fetch;
  now?: () => number;
  /** Tests only: lets a fixture identity provider run over plain HTTP. */
  allowHttpProviders?: boolean;
  /** The operator's provider keys and upstreams for the paid gateway; a provider without a key is refused there. */
  gateway?: Omit<GatewayOptions, "store" | "wallet" | "publicUrl" | "fetchImpl" | "now" | "allowance" | "deviceToken"> & { creditUsd?: number };
  /** SasPay: the secret key, the webhook signing secret, and the currency checkouts are priced in (XOF by default). */
  payments?: { saspayKey?: string; webhookSecret?: string; currency?: string; usdPerEur?: number; apiUrl?: string };
}

const MAX_BODY = 16 * 1024;
const CHALLENGE = /^[A-Za-z0-9_-]{43}$/;
const STATE = /^[A-Za-z0-9_-]{16,512}$/;
const VERIFIER = /^[A-Za-z0-9._~-]{43,128}$/;
const OPAQUE = /^[A-Za-z0-9_-]{16,128}$/;
const CALLBACK_PATH = "/api/auth/hosted/callback";
const SSO_CALLBACK_PATH = "/sso/callback";
const ROLES: readonly Role[] = ["admin", "member"];

const ASSETS = new Map<string, Buffer>(["idle", "happy", "sad", "curious"].map((expression) => {
  const file = expression === "idle" ? "cursor-88.webp" : `cursor.${expression}-88.webp`;
  return [`/assets/delio-${expression}.webp`, readFileSync(new URL(`../../../src/assets/delio-steel/${file}`, import.meta.url))] as const;
}));

class HttpError extends Error {
  readonly status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}

function parseCookies(header: string | undefined): Map<string, string> {
  const cookies = new Map<string, string>();
  for (const part of (header ?? "").split(";")) {
    const index = part.indexOf("=");
    if (index > 0) cookies.set(part.slice(0, index).trim(), part.slice(index + 1).trim());
  }
  return cookies;
}

async function readBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req as AsyncIterable<Buffer>) {
    size += chunk.length;
    if (size > MAX_BODY) throw new HttpError(413, "Request too large.");
    chunks.push(chunk);
  }
  const text = Buffer.concat(chunks).toString("utf8");
  const type = String(req.headers["content-type"] ?? "");
  if (type.startsWith("application/json")) {
    try {
      const value: unknown = JSON.parse(text || "{}");
      if (value && typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
    } catch { /* answered below */ }
    throw new HttpError(400, "Malformed JSON.");
  }
  return Object.fromEntries(new URLSearchParams(text));
}

const text = (body: Record<string, unknown>, key: string, max = 512): string => {
  const value = body[key];
  return typeof value === "string" ? value.trim().slice(0, max) : "";
};

async function readRawBody(req: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req as AsyncIterable<Buffer>) {
    size += chunk.length;
    if (size > 256 * 1024) throw new HttpError(413, "Request too large.");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

/** Only same-site paths, so a crafted `next` can never send someone elsewhere after sign-in. */
function localPath(value: string | null | undefined): string {
  return value && value.startsWith("/") && !value.startsWith("//") && !value.startsWith("/\\") && value.length <= 2048 ? value : "/";
}

function tenantOrigin(value: string): string | null {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password) return null;
    return url.origin;
  } catch { return null; }
}

export type AdminApp = ((req: IncomingMessage, res: ServerResponse) => Promise<void>) & {
  /** Charges cloud computers' awake minutes and puts those of workspaces out of credits to sleep; run once a minute. */
  sweep: () => Promise<void>;
};

export function createAdminApp(options: AdminAppOptions): AdminApp {
  const { store, publicUrl, operators, mailer } = options;
  const fetchImpl = options.fetchImpl ?? fetch;
  const now = options.now ?? Date.now;
  const secure = publicUrl.protocol === "https:";
  const cookieName = secure ? "__Host-delio-admin" : "delio-admin";
  const ssoRedirectUri = new URL(SSO_CALLBACK_PATH, publicUrl).href;
  const wallet = new Wallet(store.db, { now, creditUsd: options.gateway?.creditUsd });
  const devices = new Devices(store.db, now);
  const plans = new Billing(wallet, now);
  const saspay = options.payments?.saspayKey ? createSasPay({ key: options.payments.saspayKey, apiUrl: options.payments.apiUrl, fetchImpl }) : null;
  const currency = options.payments?.currency ?? "XOF";
  const gateway = createGateway({ ...options.gateway, store, wallet, publicUrl, fetchImpl, now, deviceToken: (value, slug) => devices.check(value, slug),
    allowance: (slug) => plans.allowance(slug) });

  function sessionCookie(value: string, maxAgeSeconds: number): string {
    return `${cookieName}=${value}; Path=/; Max-Age=${maxAgeSeconds}; HttpOnly; SameSite=Lax${secure ? "; Secure" : ""}`;
  }

  function send(res: ServerResponse, status: number, body: string, type: string, headers: Record<string, string | string[]> = {}): void {
    res.statusCode = status;
    res.setHeader("content-type", type);
    res.setHeader("cache-control", "no-store");
    res.setHeader("x-content-type-options", "nosniff");
    // Chromium sends `Origin: null` on form posts from a no-referrer page, which the same-origin check would refuse.
    res.setHeader("referrer-policy", "same-origin");
    res.setHeader("content-security-policy", "default-src 'none'; style-src 'unsafe-inline'; img-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'");
    for (const [name, value] of Object.entries(headers)) res.setHeader(name, value);
    res.end(body);
  }

  const json = (res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}) =>
    send(res, status, JSON.stringify(body), "application/json; charset=utf-8", headers);
  const html = (res: ServerResponse, status: number, input: Parameters<typeof page>[0], headers: Record<string, string | string[]> = {}) =>
    send(res, status, page(input), "text/html; charset=utf-8", headers);

  function redirect(res: ServerResponse, location: string, cookies: string[] = []): void {
    res.statusCode = 303;
    res.setHeader("cache-control", "no-store");
    res.setHeader("referrer-policy", "no-referrer");
    if (cookies.length) res.setHeader("set-cookie", cookies);
    res.setHeader("location", location);
    res.end();
  }

  function account(req: IncomingMessage): Account | null {
    return store.sessionAccount(parseCookies(req.headers.cookie).get(cookieName));
  }

  function clientAddress(req: IncomingMessage): string {
    return req.socket.remoteAddress ?? "unknown";
  }

  /** Browser forms must come from this portal's own pages; a missing Origin falls back to Fetch Metadata. */
  function sameOrigin(req: IncomingMessage): boolean {
    const origin = req.headers.origin;
    if (typeof origin === "string") return origin === publicUrl.origin;
    return req.headers["sec-fetch-site"] === "same-origin";
  }

  function requireWorkspaceAdmin(user: Account, slug: string): Workspace {
    const workspace = validSlug(slug) ? store.workspace(slug) : null;
    if (!workspace) throw new HttpError(404, "No such workspace.");
    if (store.role(slug, user.id) !== "admin" && !operators.has(user.email)) throw new HttpError(403, "Only this workspace's administrators can do that.");
    return workspace;
  }

  function signIn(res: ServerResponse, user: Account, next: string): void {
    const session = store.createSession(user.id);
    store.audit(null, user.email, "account.signin", null);
    redirect(res, localPath(next), [sessionCookie(session.token, session.maxAgeSeconds)]);
  }

  async function startSso(res: ServerResponse, workspace: string, next: string): Promise<void> {
    const config = store.sso(workspace);
    if (!config) throw new HttpError(404, "Single sign-on is not set up for this workspace.");
    const provider = await discover(fetchImpl, config.issuer, options.allowHttpProviders);
    const state = token(), verifier = token(48), nonce = token();
    store.saveSsoState({ state, workspace, verifier, nonce, next: localPath(next) });
    const target = new URL(provider.authorization_endpoint);
    for (const [key, value] of Object.entries({ response_type: "code", client_id: config.clientId, redirect_uri: ssoRedirectUri, scope: "openid email profile",
      state, nonce, code_challenge: pkceChallenge(verifier), code_challenge_method: "S256" })) target.searchParams.set(key, value);
    redirect(res, target.href);
  }

  async function handoff(req: IncomingMessage, res: ServerResponse, kind: "consume" | "check"): Promise<void> {
    const body = await readBody(req);
    // The version is checked before anything is spent, so an incompatible peer never burns a one-use code.
    if (!hostedContractCompatible(body.contractVersion)) return json(res, 409, { code: HOSTED_CONTRACT_MISMATCH, ...HOSTED_CONTRACT_METADATA });
    const reply = { [HOSTED_CONTRACT_HEADER]: String(HOSTED_CONTRACT_VERSION) };
    const workspace = text(body, "workspace", 64);
    if (!validSlug(workspace)) return json(res, 400, { error: "invalid request" }, reply);
    if (kind === "consume") {
      if (!store.allow(`consume:${clientAddress(req)}`, 120, 60_000)) return json(res, 429, { error: "too many requests" }, reply);
      const code = text(body, "code", 256), verifier = text(body, "verifier", 256);
      if (!OPAQUE.test(code) || !VERIFIER.test(verifier)) return json(res, 400, { error: "invalid request" }, reply);
      const issued = store.consumeHandoffCode(workspace, code, verifier);
      if (!issued) return json(res, 401, { error: "invalid code" }, reply);
      store.audit(workspace, issued.email, "workspace.signin", issued.role);
      return json(res, 200, { contractVersion: HOSTED_CONTRACT_VERSION, email: issued.email, role: issued.role, grant: issued.grant }, reply);
    }
    const grant = text(body, "grant", 64);
    const member = OPAQUE.test(grant) ? store.checkGrant(workspace, grant) : null;
    if (!member) return json(res, 404, { error: "not a member" }, reply);
    return json(res, 200, { contractVersion: HOSTED_CONTRACT_VERSION, ...member }, reply);
  }

  function connect(res: ServerResponse, url: URL, user: Account | null): void {
    const params = url.searchParams;
    const slug = params.get("workspace") ?? "", state = params.get("state") ?? "", challenge = params.get("code_challenge") ?? "", redirectUri = params.get("redirect_uri") ?? "";
    const workspace = validSlug(slug) ? store.workspace(slug) : null;
    if (!workspace || !STATE.test(state) || !CHALLENGE.test(challenge) || params.get("code_challenge_method") !== "S256") {
      return html(res, 400, { title: "Invalid link", body: messagePage("This sign-in link is not valid", "Open your workspace address again to start over."), mascot: "sad" });
    }
    // Security: codes only ever travel back to the callback registered for this workspace, never to an address the link names.
    if (redirectUri !== new URL(CALLBACK_PATH, workspace.tenantUrl).href) {
      return html(res, 400, { title: "Invalid link", body: messagePage("This sign-in link is not valid", "The link does not lead back to this workspace."), mascot: "sad" });
    }
    if (!user) return redirect(res, `/login?next=${encodeURIComponent(url.pathname + url.search)}`);
    const role = store.role(slug, user.id);
    if (!role) {
      return html(res, 403, { title: "No access", email: user.email, mascot: "sad",
        body: messagePage(`You are not a member of ${workspace.name}`, `Signed in as ${user.email}. Ask one of its administrators for an invitation.`, { href: "/", label: "Your workspaces" }) });
    }
    const code = store.issueHandoffCode({ workspace: slug, accountId: user.id, challenge, redirectUri });
    const back = new URL(redirectUri);
    back.searchParams.set("state", state);
    back.searchParams.set("code", code);
    redirect(res, back.href);
  }

  async function route(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? "/", publicUrl);
    const method = req.method ?? "GET";
    const path = url.pathname;

    if (method === "GET" && ASSETS.has(path)) {
      res.setHeader("cache-control", "public, max-age=86400");
      res.setHeader("content-type", "image/webp");
      res.end(ASSETS.get(path));
      return;
    }
    if (path === "/api/health") return json(res, 200, { ok: true, service: "delio-admin", ...HOSTED_CONTRACT_METADATA });
    if (await gateway.handle(req, res, url)) return;
    if (path === "/api/saspay/webhook") {
      if (method !== "POST") return json(res, 405, { error: "method not allowed" });
      const raw = await readRawBody(req);
      const header = (name: string) => { const value = req.headers[name]; return typeof value === "string" ? value : undefined; };
      if (!verifySasPayWebhook(raw, { signature: header("x-webhook-signature"), timestamp: header("x-webhook-timestamp") }, options.payments?.webhookSecret ?? "", now())) {
        return json(res, 403, { error: "invalid signature" });
      }
      let event: { event?: unknown; data?: { id?: unknown } } = {};
      try { event = JSON.parse(raw.toString("utf8")) as typeof event; } catch { return json(res, 400, { error: "invalid JSON" }); }
      const id = `${String(event.event)}:${String(event.data?.id ?? "")}:${header("x-webhook-timestamp")}`;
      // The event names a transaction, not our order: every pending order is checked against SasPay itself.
      if (plans.firstSeen(id) && event.event === "transaction.success" && saspay) await reconcileOrders(plans, saspay);
      return json(res, 200, { ok: true });
    }
    if (path === "/api/device/start" || path === "/api/device/token") {
      if (method !== "POST") return json(res, 405, { error: "method not allowed" });
      const body = await readBody(req);
      if (path === "/api/device/start") {
        if (!store.allow(`device:${clientAddress(req)}`, 20, 15 * 60_000)) return json(res, 429, { error: "slow_down" });
        const started = devices.start(text(body, "label", 80));
        const verification = new URL("/device", publicUrl);
        return json(res, 200, { device_code: started.deviceCode, user_code: started.userCode, verification_uri: verification.href,
          verification_uri_complete: `${verification.href}?code=${encodeURIComponent(started.userCode)}`, expires_in: started.expiresIn, interval: DEVICE_POLL_SECONDS });
      }
      const deviceCode = text(body, "device_code", 128);
      if (!/^[A-Za-z0-9_-]{43}$/.test(deviceCode)) return json(res, 400, { error: "invalid_request" });
      const polled = devices.poll(deviceCode);
      if (polled.status === "pending") return json(res, 400, { error: "authorization_pending" });
      if (polled.status !== "approved") return json(res, 400, { error: polled.status === "denied" ? "access_denied" : "expired_token" });
      return json(res, 200, { token: polled.token, workspace: polled.workspace, gateway: new URL(`/api/gateway/${polled.workspace}`, publicUrl).href, portal: publicUrl.origin });
    }
    if (path === "/api/handoff/consume" || path === "/api/handoff/check") {
      if (method !== "POST") return json(res, 405, { error: "method not allowed" });
      return handoff(req, res, path === "/api/handoff/consume" ? "consume" : "check");
    }

    if (method === "POST" && !sameOrigin(req)) throw new HttpError(403, "This form did not come from the Delio Admin portal.");
    const user = account(req);

    if (method === "GET" && path === "/login") {
      if (user) return redirect(res, localPath(url.searchParams.get("next")));
      return html(res, 200, { title: "Sign in", body: loginPage(localPath(url.searchParams.get("next"))), mascot: "idle" });
    }
    if (method === "POST" && path === "/login") {
      const body = await readBody(req);
      const email = normalizeEmail(text(body, "email", 320)), next = localPath(text(body, "next", 2048));
      if (!validEmail(email)) return html(res, 400, { title: "Sign in", body: loginPage(next, "Enter a valid email address."), mascot: "sad" });
      const domain = email.slice(email.lastIndexOf("@") + 1);
      const sso = store.ssoForDomain(domain)[0];
      if (sso) return startSso(res, sso.workspace, next);
      if (!store.allow(`otp-ip:${clientAddress(req)}`, 20, 15 * 60_000) || !store.allow(`otp-email:${email}`, 5, 15 * 60_000)) {
        return html(res, 429, { title: "Sign in", body: loginPage(next, "Too many codes were requested. Wait a few minutes and try again."), mascot: "sad" });
      }
      const code = store.issueOtp(email);
      await mailer.send({ to: email, subject: `${code.slice(0, 4)} ${code.slice(4)} is your Delio sign-in code`,
        text: `Your Delio sign-in code is ${code.slice(0, 4)} ${code.slice(4)}.\n\nIt expires in 10 minutes. If you did not ask for it, ignore this email.` })
        .catch((error: unknown) => console.error(`delio-admin: sign-in email could not be sent (${error instanceof Error ? error.name : "error"})`));
      return html(res, 200, { title: "Check your email", body: codePage(email, next), mascot: "curious" });
    }
    if (method === "POST" && path === "/login/verify") {
      const body = await readBody(req);
      const email = normalizeEmail(text(body, "email", 320)), next = localPath(text(body, "next", 2048));
      const code = text(body, "code", 16).replace(/\s/g, "");
      if (!store.allow(`verify-ip:${clientAddress(req)}`, 60, 15 * 60_000)) {
        return html(res, 429, { title: "Sign in", body: codePage(email, next, "Too many attempts. Wait a few minutes."), mascot: "sad" });
      }
      const result = validEmail(email) && /^\d{8}$/.test(code) ? store.verifyOtp(email, code) : { ok: false as const, reason: "invalid" as const };
      if (!result.ok) {
        const message = result.reason === "expired" ? "That code has expired. Request a new one." : result.reason === "locked" ? "Too many wrong codes. Request a new one." : "That code is not right.";
        return html(res, 401, { title: "Check your email", body: codePage(email, next, message), mascot: "sad" });
      }
      return signIn(res, result.account, next);
    }
    if (method === "POST" && path === "/logout") {
      const value = parseCookies(req.headers.cookie).get(cookieName);
      if (value) store.endSession(value);
      return redirect(res, "/login", [sessionCookie("", 0)]);
    }
    if (method === "GET" && path === "/connect") return connect(res, url, user);

    if (method === "GET" && path === "/sso/start") {
      const slug = url.searchParams.get("workspace") ?? "";
      if (!validSlug(slug)) throw new HttpError(404, "No such workspace.");
      return startSso(res, slug, url.searchParams.get("next") ?? "/");
    }
    if (method === "GET" && path === SSO_CALLBACK_PATH) {
      const pending = store.takeSsoState(url.searchParams.get("state") ?? "");
      const code = url.searchParams.get("code") ?? "";
      const config = pending ? store.sso(pending.workspace) : null;
      if (!pending || !config || !code) {
        return html(res, 400, { title: "Sign-in failed", body: messagePage("Single sign-on did not finish", "The sign-in took too long or was already used. Start again.", { href: "/login", label: "Sign in" }), mascot: "sad" });
      }
      let email: string;
      try {
        const provider = await discover(fetchImpl, config.issuer, options.allowHttpProviders);
        const idToken = await exchangeCode(fetchImpl, provider, { code, verifier: pending.verifier, redirectUri: ssoRedirectUri, clientId: config.clientId, clientSecret: config.clientSecret });
        ({ email } = await verifyIdToken(fetchImpl, provider, idToken, { clientId: config.clientId, nonce: pending.nonce, now: now() }));
      } catch (error) {
        console.warn(`delio-admin: single sign-on failed for ${pending.workspace}: ${error instanceof Error ? error.message : "error"}`);
        return html(res, 401, { title: "Sign-in failed", body: messagePage("Single sign-on failed", "Your identity provider's answer could not be verified. Ask your administrator to check the setup.", { href: "/login", label: "Try again" }), mascot: "sad" });
      }
      if (!email.endsWith(`@${config.domain}`)) {
        return html(res, 403, { title: "Sign-in failed", body: messagePage("This account is not allowed here", `Single sign-on for this workspace accepts @${config.domain} addresses only.`), mascot: "sad" });
      }
      const signedIn = store.ensureAccount(email);
      if (config.autoJoin && !store.role(config.workspace, signedIn.id)) store.addMember(config.workspace, signedIn.id, "member", "sso");
      return signIn(res, signedIn, pending.next);
    }

    if (method === "GET" && path === "/invite") {
      const value = url.searchParams.get("token") ?? "";
      const invitation = OPAQUE.test(value) ? store.invitation(value) : null;
      const workspace = invitation ? store.workspace(invitation.workspace) : null;
      if (!invitation || !workspace) return html(res, 404, { title: "Invitation", email: user?.email, body: messagePage("This invitation has expired", "Ask an administrator to send a new one."), mascot: "sad" });
      return html(res, 200, { title: "Invitation", email: user?.email, body: invitePage({ invitation, workspace, token: value, email: user?.email ?? null }), mascot: "happy" });
    }

    if (!user) {
      if (method === "GET") return redirect(res, `/login?next=${encodeURIComponent(path + url.search)}`);
      throw new HttpError(401, "Sign in first.");
    }

    if (method === "POST" && path === "/invite/accept") {
      const body = await readBody(req);
      const value = text(body, "token", 128);
      const invitation = OPAQUE.test(value) ? store.acceptInvitation(value, user) : null;
      if (!invitation) throw new HttpError(400, "This invitation has expired or is for another address.");
      const workspace = store.workspace(invitation.workspace)!;
      return html(res, 200, { title: "Welcome", email: user.email, mascot: "happy",
        body: messagePage(`You joined ${workspace.name}`, "You can sign in to the workspace now.", { href: workspace.tenantUrl, label: `Open ${workspace.tenantUrl}` }) });
    }

    if (method === "GET" && path === "/") {
      return html(res, 200, { title: "Workspaces", email: user.email, body: homePage({ workspaces: store.workspacesOf(user.id), operator: operators.has(user.email),
        all: operators.has(user.email) ? store.allWorkspaces() : [], message: url.searchParams.get("created") ? "Workspace created." : undefined }) });
    }
    if (method === "POST" && path === "/workspaces") {
      if (!operators.has(user.email)) throw new HttpError(403, "Only operators can create workspaces.");
      const body = await readBody(req);
      const slug = text(body, "slug", 64), name = text(body, "name", 80), tenant = tenantOrigin(text(body, "tenantUrl", 512)), owner = normalizeEmail(text(body, "ownerEmail", 320));
      const error = !validSlug(slug) ? "The slug must be 2–31 lowercase letters, digits or dashes, starting with a letter." : !name ? "Give the workspace a name."
        : !tenant ? "The workspace address must be an https:// address." : !validEmail(owner) ? "Enter the first administrator's email." : store.workspace(slug) ? "That slug is taken." : null;
      if (error) {
        return html(res, 400, { title: "Workspaces", email: user.email, body: homePage({ workspaces: store.workspacesOf(user.id), operator: true, all: store.allWorkspaces(), error }) });
      }
      store.createWorkspace({ slug, name, tenantUrl: tenant!, ownerEmail: owner }, user.email);
      return redirect(res, "/?created=1");
    }

    if (method === "GET" && path === "/people") {
      const workspace = requireWorkspaceAdmin(user, url.searchParams.get("workspace") ?? "");
      const flash = url.searchParams.get("done");
      return html(res, 200, { title: "People", email: user.email, body: people(workspace, user, { message: flash === "invited" ? "Invitation sent." : flash ? "Saved." : undefined }) });
    }
    if (method === "POST" && path.startsWith("/people/")) {
      const body = await readBody(req);
      const workspace = requireWorkspaceAdmin(user, text(body, "workspace", 64));
      const back = (done: string) => redirect(res, `/people?workspace=${workspace.slug}&done=${done}`);
      const fail = (status: number, error: string, extra: { inviteLink?: string } = {}) =>
        html(res, status, { title: "People", email: user.email, body: people(workspace, user, { error, ...extra }) });
      if (path === "/people/invite") {
        const email = normalizeEmail(text(body, "email", 320)), role = text(body, "role", 16) as Role;
        if (!validEmail(email) || !ROLES.includes(role)) return fail(400, "Enter an email address and a role.");
        if (!store.allow(`invite:${workspace.slug}`, 100, 60 * 60_000)) return fail(429, "Too many invitations this hour.");
        const { token: value } = store.invite(workspace.slug, email, role, user.email);
        const link = new URL(`/invite?token=${value}`, publicUrl).href;
        await mailer.send({ to: email, subject: `You're invited to ${workspace.name} on Delio`,
          text: `${user.email} invited you to the ${workspace.name} workspace on Delio as ${role === "admin" ? "an admin" : "a member"}.\n\nAccept: ${link}\n\nThis link expires in 7 days.` })
          .catch(() => console.error("delio-admin: invitation email could not be sent"));
        return html(res, 200, { title: "People", email: user.email, body: people(workspace, user, { message: `Invitation sent to ${email}.`, inviteLink: link }) });
      }
      if (path === "/people/cancel") {
        store.cancelInvitation(workspace.slug, text(body, "invitation", 64), user.email);
        return back("cancelled");
      }
      const target = text(body, "account", 64);
      if (path === "/people/role") {
        const role = text(body, "role", 16) as Role;
        if (!ROLES.includes(role)) return fail(400, "Choose a role.");
        const outcome = store.setRole(workspace.slug, target, role, user.email);
        if (outcome === "last-admin") return fail(409, "A workspace needs at least one admin. Promote someone else first.");
        if (outcome === "missing") return fail(404, "That person is no longer a member.");
        return back("role");
      }
      if (path === "/people/remove") {
        const outcome = store.removeMember(workspace.slug, target, user.email);
        if (outcome === "last-admin") return fail(409, "A workspace needs at least one admin. Promote someone else first.");
        return back("removed");
      }
    }

    if (method === "GET" && path === "/sso") {
      const workspace = requireWorkspaceAdmin(user, url.searchParams.get("workspace") ?? "");
      return html(res, 200, { title: "Single sign-on", email: user.email, body: ssoPage({ workspace, sso: store.sso(workspace.slug), redirectUri: ssoRedirectUri,
        message: url.searchParams.get("done") ? "Saved." : undefined }) });
    }
    if (method === "POST" && (path === "/sso" || path === "/sso/remove")) {
      const body = await readBody(req);
      const workspace = requireWorkspaceAdmin(user, text(body, "workspace", 64));
      if (path === "/sso/remove") {
        store.removeSso(workspace.slug, user.email);
        return redirect(res, `/sso?workspace=${workspace.slug}&done=1`);
      }
      const existing = store.sso(workspace.slug);
      const issuer = text(body, "issuer", 512).replace(/\/$/, ""), clientId = text(body, "clientId", 512);
      const clientSecret = text(body, "clientSecret", 1024) || existing?.clientSecret || "";
      const domain = text(body, "domain", 253).toLowerCase().replace(/^@/, "");
      const fail = (error: string) => html(res, 400, { title: "Single sign-on", email: user.email,
        body: ssoPage({ workspace, sso: existing, redirectUri: ssoRedirectUri, error }) });
      if (!clientId || !clientSecret || !/^[a-z0-9.-]+\.[a-z]{2,}$/.test(domain)) return fail("Fill in every field.");
      const claimed = store.ssoForDomain(domain).find((config) => config.workspace !== workspace.slug);
      if (claimed) return fail(`${domain} already signs in through another workspace.`);
      try {
        await discover(fetchImpl, issuer, options.allowHttpProviders);
      } catch (error) {
        return fail(`The issuer could not be reached or is not an OpenID Connect provider (${error instanceof Error ? error.message : "error"}).`);
      }
      store.setSso({ workspace: workspace.slug, issuer, clientId, clientSecret, domain, autoJoin: body.autoJoin === "1" }, user.email);
      return redirect(res, `/sso?workspace=${workspace.slug}&done=1`);
    }

    if (method === "GET" && path === "/device") {
      return html(res, 200, { title: "Connect an app", email: user.email, mascot: "curious",
        body: devicePage({ code: url.searchParams.get("code") ?? "", label: devices.pendingLabel(url.searchParams.get("code") ?? ""), workspaces: store.workspacesOf(user.id).filter((item) => item.role === "admin") }) });
    }
    if (method === "POST" && path === "/device") {
      const body = await readBody(req);
      const code = text(body, "code", 16);
      const admin = store.workspacesOf(user.id).filter((item) => item.role === "admin");
      const again = (status: number, error: string) => html(res, status, { title: "Connect an app", email: user.email, mascot: "sad", body: devicePage({ code, label: devices.pendingLabel(code), workspaces: admin, error }) });
      if (!devices.pendingLabel(code)) return again(400, "This code has expired or was already used. Start again from the app.");
      if (text(body, "decision", 8) === "deny") {
        devices.decide(code, "deny");
        return html(res, 200, { title: "Connect an app", email: user.email, body: messagePage("Connection refused", "The app was not connected. You can close this page.") });
      }
      let slug = text(body, "workspace", 64);
      if (slug === "personal") {
        slug = `me-${token(6).toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 8).padEnd(8, "x")}`;
        store.createWorkspace({ slug, name: `${user.email} (personal)`, tenantUrl: publicUrl.origin, ownerEmail: user.email }, user.email);
      } else if (!admin.some((item) => item.slug === slug)) {
        return again(403, "Choose a workspace you administer.");
      }
      const label = devices.pendingLabel(code);
      devices.decide(code, { workspace: slug, accountId: user.id });
      store.audit(slug, user.email, "device.connect", label);
      return html(res, 200, { title: "Connected", email: user.email, mascot: "happy",
        body: messagePage("The app is connected", "Go back to the app: it finishes on its own in a few seconds. It uses this workspace's Delio credits.") });
    }
    if (method === "POST" && path === "/billing/checkout") {
      const body = await readBody(req);
      const workspace = requireWorkspaceAdmin(user, text(body, "workspace", 64));
      const fail = (status: number, error: string) => html(res, status, { title: "Billing", email: user.email, body: billing(workspace, user, { error }) });
      if (!saspay) return fail(503, "Payments are not set up on this Delio deployment yet.");
      const kind = text(body, "kind", 8);
      const plan = text(body, "plan", 16) as PlanId;
      const topup = text(body, "topup", 16) as TopupId;
      if (kind === "plan" && !Object.hasOwn(PLANS, plan)) return fail(400, "Choose a plan.");
      if (kind === "topup" && !TOPUPS.some((pack) => pack.id === topup)) return fail(400, "Choose a top-up.");
      if (kind !== "plan" && kind !== "topup") return fail(400, "Choose a plan or a top-up.");
      if (kind === "plan" && plan === "trial" && plans.trialUsed(user.email, workspace.slug)) return fail(409, "The trial was already used for this account or workspace.");
      const seats = Number(text(body, "seats", 4)) || store.members(workspace.slug).length;
      const order = kind === "plan"
        ? plans.createOrder({ workspace: workspace.slug, email: user.email, kind, plan, seats }, currency, options.payments?.usdPerEur)
        : plans.createOrder({ workspace: workspace.slug, email: user.email, kind, topup }, currency, options.payments?.usdPerEur);
      const description = kind === "plan" ? `Delio ${PLANS[plan].name}${PLANS[plan].perSeat ? ` · ${order.seats} seat${order.seats === 1 ? "" : "s"} · 30 days` : " · 3 days"}` : `Delio credits · ${order.credits}`;
      try {
        const session = await saspay.createCheckout({ amount: order.amount, currency, description, email: user.email, name: user.email,
          returnUrl: new URL(`/billing/return?order=${order.id}`, publicUrl).href, metadata: { order: order.id, workspace: workspace.slug } });
        plans.attachSession(order.id, session.id, session.checkoutUrl);
        store.audit(workspace.slug, user.email, "billing.checkout", `${order.id}:${order.amount} ${currency}`);
        res.statusCode = 303;
        res.setHeader("cache-control", "no-store");
        res.setHeader("location", session.checkoutUrl);
        return void res.end();
      } catch (error) {
        plans.markFailed(order.id);
        return fail(502, `The payment page could not be opened (${error instanceof Error ? error.message : "error"}). Try again in a moment.`);
      }
    }
    if (method === "GET" && path === "/billing/return") {
      const order = plans.order(url.searchParams.get("order") ?? "");
      if (!order) throw new HttpError(404, "No such payment.");
      const workspace = requireWorkspaceAdmin(user, order.workspace);
      if (order.status === "pending" && saspay) await reconcileOrders(plans, saspay, order.id);
      const latest = plans.order(order.id)!;
      return html(res, 200, { title: "Billing", email: user.email, body: billing(workspace, user,
        latest.status === "paid" ? { message: "Payment received: thank you. Your credits are added." }
          : latest.status === "failed" ? { error: "The payment did not go through. You can try again." }
          : { message: "The payment is being confirmed. This page shows it as soon as SasPay does." }) });
    }
    if (method === "POST" && path === "/billing/device") {
      const body = await readBody(req);
      const workspace = requireWorkspaceAdmin(user, text(body, "workspace", 64));
      devices.revoke(workspace.slug, text(body, "device", 32));
      store.audit(workspace.slug, user.email, "device.revoke", null);
      return redirect(res, `/billing?workspace=${workspace.slug}&done=1`);
    }

    if (method === "GET" && path === "/billing") {
      const workspace = requireWorkspaceAdmin(user, url.searchParams.get("workspace") ?? "");
      return html(res, 200, { title: "Billing", email: user.email, body: billing(workspace, user, { message: url.searchParams.get("done") ? "Saved." : undefined }) });
    }
    if (method === "POST" && (path === "/billing/credit" || path === "/billing/token")) {
      const body = await readBody(req);
      const workspace = requireWorkspaceAdmin(user, text(body, "workspace", 64));
      if (!operators.has(user.email)) throw new HttpError(403, "Only operators can add credits or issue workspace tokens.");
      if (path === "/billing/token") {
        const issued = wallet.issueToken(workspace.slug);
        store.audit(workspace.slug, user.email, "gateway.token", null);
        return html(res, 200, { title: "Billing", email: user.email, body: billing(workspace, user, { token: issued }) });
      }
      const credits = Number(text(body, "credits", 16));
      if (!Number.isFinite(credits) || credits === 0 || Math.abs(credits) > 10_000_000) {
        return html(res, 400, { title: "Billing", email: user.email, body: billing(workspace, user, { error: "Enter a number of credits." }) });
      }
      wallet.credit(workspace.slug, Math.round(credits * MICRO), credits > 0 ? "grant" : "adjust", text(body, "note", 200) || null);
      store.audit(workspace.slug, user.email, "credits.add", String(credits));
      return redirect(res, `/billing?workspace=${workspace.slug}&done=1`);
    }

    if (method === "GET" && path === "/slack") {
      const workspace = requireWorkspaceAdmin(user, url.searchParams.get("workspace") ?? "");
      return html(res, 200, { title: "Slack", email: user.email, body: slackPage(workspace) });
    }

    throw new HttpError(404, "Not found.");
  }

  function billing(workspace: Workspace, user: Account, extra: { message?: string; error?: string; token?: string }): Html {
    return billingPage({ workspace, operator: operators.has(user.email), balance: wallet.balance(workspace.slug) / MICRO,
      subscription: plans.subscription(workspace.slug), orders: plans.orders(workspace.slug, 10), payments: Boolean(saspay), currency,
      trialAvailable: !plans.trialUsed(user.email, workspace.slug), seats: store.members(workspace.slug).length,
      prices: Object.fromEntries([...Object.values(PLANS).map((plan) => [plan.id, priceIn(plan.eur, currency, options.payments?.usdPerEur)]),
        ...TOPUPS.map((pack) => [pack.id, priceIn(pack.eur, currency, options.payments?.usdPerEur)])]),
      usedThisMonth: wallet.usedThisMonth(workspace.slug) / MICRO, hasToken: wallet.hasToken(workspace.slug), ledger: wallet.ledger(workspace.slug, 30),
      gatewayUrl: new URL(`/api/gateway/${workspace.slug}`, publicUrl).href, devices: devices.list(workspace.slug), ...extra });
  }

  function people(workspace: Workspace, user: Account, extra: { message?: string; error?: string; inviteLink?: string }): Html {
    return peoplePage({ workspace, members: store.members(workspace.slug), invitations: store.invitations(workspace.slug), self: user.id,
      audit: store.auditLog(workspace.slug, 20), ...extra });
  }

  const handler = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    try {
      await route(req, res);
    } catch (error) {
      const status = error instanceof HttpError ? error.status : 500;
      const message = error instanceof HttpError ? error.message : "Something went wrong.";
      if (status === 500) console.error("delio-admin:", error);
      if (res.headersSent) return void res.end();
      if (req.url?.startsWith("/api/")) return json(res, status, { error: message });
      html(res, status, { title: "Error", body: messagePage(status === 404 ? "Not found" : "That did not work", message, { href: "/", label: "Back" }), mascot: "sad" });
    }
  };
  async function sweep(): Promise<void> {
    await gateway.sweep();
    if (saspay) await reconcileOrders(plans, saspay);
    for (const due of plans.dueReminders()) {
      const workspace = store.workspace(due.workspace);
      if (!workspace) continue;
      const link = new URL(`/billing?workspace=${due.workspace}`, publicUrl).href;
      for (const admin of store.members(due.workspace).filter((member) => member.role === "admin")) {
        await mailer.send({ to: admin.email, subject: `Your Delio ${PLANS[due.plan].name} plan for ${workspace.name} ends soon`,
          text: `The ${PLANS[due.plan].name} plan of ${workspace.name} ends on ${new Date(due.periodEnd).toISOString().slice(0, 10)}.\n\nRenew it here to keep its credits coming: ${link}\n\nAfter that day the workspace has 7 days of grace, then its bots stop using Delio credits until it is renewed.` })
          .catch(() => console.error("delio-admin: a renewal reminder could not be sent"));
      }
    }
  }
  return Object.assign(handler, { sweep });
}
