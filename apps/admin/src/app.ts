import type { IncomingMessage, ServerResponse } from "node:http";

import { HOSTED_CONTRACT_HEADER, HOSTED_CONTRACT_METADATA, HOSTED_CONTRACT_MISMATCH, HOSTED_CONTRACT_VERSION, hostedContractCompatible } from "../../../server/hosted-contract.ts";
import type { Mailer } from "./mail.ts";
import { discover, exchangeCode, pkceChallenge, verifyIdToken } from "./oidc.ts";
import { createGateway, type GatewayOptions } from "./gateway.ts";
import { DEVICE_POLL_SECONDS, Devices } from "./devices.ts";
import { personalWorkspaces } from "./personal-workspaces.ts";
import { BILLING_REFRESH_SCRIPT } from "./billing-refresh.ts";
import { Hosting, hostingRunner, RESERVED_SLUGS, socketFleet, type Fleet } from "./hosting.ts";
import { Billing, catalog, PLANS, reconcileOrders, TOPUPS, TRIAL_DAYS, type Cycle, type PlanId, type TopupId } from "./plans.ts";
import { createSasPay, verifySasPayWebhook } from "./saspay.ts";
import { MICRO, Wallet } from "./wallet.ts";
import { consoleServes, createConsole } from "./console/routes.ts";
import { Traffic, type VisitInput } from "./traffic.ts";
import { billingPage, codePage, devicePage, homePage, invitePage, loginPage, messagePage, page, peoplePage, otherAccountPage, signupPage, slackPage, ssoPage, SUPPORT_EMAIL, type Html } from "./pages.ts";
import { normalizeEmail, token, validEmail, validSlug, type Account, type AdminStore, type Role, type Workspace } from "./store.ts";

export interface AdminAppOptions {
  store: AdminStore;
  /** The portal's own public origin; https in production. */
  publicUrl: URL;
  /** The Delio team: the only addresses the operators' console lets in; also who is told when a workspace cannot be created. */
  operators: ReadonlySet<string>;
  /** The operators' console: every workspace, credits and tokens, for the team only. Customers' portal otherwise, where nobody is an operator. */
  console?: boolean;
  mailer: Mailer;
  fetchImpl?: typeof fetch;
  now?: () => number;
  /** Tests only: lets a fixture identity provider run over plain HTTP. */
  allowHttpProviders?: boolean;
  /** The operator's provider keys and upstreams for the paid gateway; a provider without a key is refused there. */
  gateway?: Omit<GatewayOptions, "store" | "wallet" | "publicUrl" | "fetchImpl" | "now" | "allowance" | "deviceToken" | "deviceEmail" | "deviceAccount" | "revokeDevice" | "refreshAccount" | "paymentVersion"> & { creditUsd?: number };
  /** The mascot pictures pages show, by path (`/assets/delio-idle.webp`…). */
  assets?: ReadonlyMap<string, Uint8Array>;
  /** SasPay: the secret key, the webhook signing secret, and the currency checkouts are priced in (XOF by default). */
  payments?: { saspayKey?: string; webhookSecret?: string; currency?: string; xofPerUsd?: number; apiUrl?: string };
  /** Self-serve sign-up: workspaces at https://<slug>.<domain>, created through the fleet agent once paid, with these OpenRouter models. */
  hosting?: { domain: string; models: string[]; fleet?: Fleet; fleetSocket?: string };
  /** Self-serve sign-up without hosting: customers pay here and use the desktop app, downloaded from `downloadUrl`. */
  signup?: { downloadUrl: string };
}

/** What the operators' console serves; everything else there is 404, customer pages and public APIs included. */
const CONSOLE_PATHS = new Set(["/login", "/login/verify", "/logout", "/workspaces", "/billing", "/billing/credit", "/billing/token", "/billing/hosting/retry", "/people"]);

/** Chromium applies form-action to a form's redirects too: a plan's form answers with SasPay's checkout page, so it is allowed. */
const CHECKOUT_ORIGINS = "https://*.saspay.me";

/** Self-serve workspaces may own this many; more takes an operator. */
const SELF_SERVE_LIMIT = 3;

const MAX_BODY = 16 * 1024;
const CHALLENGE = /^[A-Za-z0-9_-]{43}$/;
const STATE = /^[A-Za-z0-9_-]{16,512}$/;
const VERIFIER = /^[A-Za-z0-9._~-]{43,128}$/;
const OPAQUE = /^[A-Za-z0-9_-]{16,128}$/;
const CALLBACK_PATH = "/api/auth/hosted/callback";
const SSO_CALLBACK_PATH = "/sso/callback";
const ROLES: readonly Role[] = ["admin", "member"];


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
    if (size > MAX_BODY) throw new HttpError(413, "Requête trop volumineuse.");
    chunks.push(chunk);
  }
  const text = Buffer.concat(chunks).toString("utf8");
  const type = String(req.headers["content-type"] ?? "");
  if (type.startsWith("application/json")) {
    try {
      const value: unknown = JSON.parse(text || "{}");
      if (value && typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
    } catch { /* answered below */ }
    throw new HttpError(400, "JSON mal formé.");
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
    if (size > 256 * 1024) throw new HttpError(413, "Requête trop volumineuse.");
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
  /** Counts page views and downloads of the site and the portal; robots are left out. */
  recordVisits: (visits: readonly VisitInput[]) => number;
};

export function createAdminApp(options: AdminAppOptions): AdminApp {
  const { store, publicUrl, operators, mailer } = options;
  const operatorConsole = options.console === true;
  /** Operator powers exist only on the console, whatever the address: a customer's portal never grants them. */
  const isOperator = (user: Account) => operatorConsole && operators.has(user.email);
  const fetchImpl = options.fetchImpl ?? fetch;
  const now = options.now ?? Date.now;
  const secure = publicUrl.protocol === "https:";
  const cookieName = secure ? "__Host-delio-admin" : "delio-admin";
  const ssoRedirectUri = new URL(SSO_CALLBACK_PATH, publicUrl).href;
  const wallet = new Wallet(store.db, { now, creditUsd: options.gateway?.creditUsd });
  const devices = new Devices(store.db, now);
  const plans = new Billing(wallet, now);
  const personal = personalWorkspaces(store, plans, wallet, publicUrl.origin);
  const saspay = options.payments?.saspayKey ? createSasPay({ key: options.payments.saspayKey, apiUrl: options.payments.apiUrl, fetchImpl }) : null;
  const currency = options.payments?.currency ?? "XOF";
  const hosting = new Hosting(store.db, now);
  const selfServe = options.hosting ?? null;
  const signupOpen = Boolean(selfServe || options.signup);
  const runHosting = selfServe ? hostingRunner({ hosting, billing: plans, wallet, store, mailer, operators, now, portalUrl: publicUrl.origin, models: selfServe.models,
    fleet: selfServe.fleet ?? socketFleet(selfServe.fleetSocket ?? "/run/opendeliobot/fleet.sock") }) : null;
  const startHosting = () => { void runHosting?.().catch((error: unknown) => console.error("delio-admin: hosting pass failed", error)); };
  const traffic = new Traffic(store.db, now);
  const paymentChecks = new Map<string, { at: number; running: Promise<void> | null }>();
  async function refreshPayments(workspace: string): Promise<void> {
    if (!saspay) return;
    const previous = paymentChecks.get(workspace);
    if (previous?.running) return previous.running;
    if (!plans.pending().some(order => order.workspace === workspace)) { paymentChecks.delete(workspace); return; }
    if (previous && now() - previous.at < 5_000) return;
    const check = { at: now(), running: null as Promise<void> | null };
    check.running = reconcileOrders(plans, saspay, { workspace }).then(paid => {
      if (paid.length) startHosting();
    }).finally(() => { check.at = now(); check.running = null; });
    paymentChecks.set(workspace, check);
    return check.running;
  }
  const gateway = createGateway({ ...options.gateway, store, wallet, publicUrl, fetchImpl, now,
    deviceAccount: (value, requested) => {
      const owner = devices.identity(value);
      if (!owner) return null;
      const workspace = personal.resolve(owner, owner.workspace);
      if (requested !== owner.workspace && requested !== workspace) return null;
      if (!devices.check(value, owner.workspace)) return null;
      return { workspace, sourceWorkspace: owner.workspace, email: owner.email };
    },
    deviceEmail: (value, slug) => devices.ownerEmail(value, slug), revokeDevice: (value, slug) => devices.revokeToken(value, slug),
    allowance: (slug) => plans.allowance(slug), refreshAccount: refreshPayments, paymentVersion: slug => plans.paidCount(slug) });

  function sessionCookie(value: string, maxAgeSeconds: number): string {
    return `${cookieName}=${value}; Path=/; Max-Age=${maxAgeSeconds}; HttpOnly; SameSite=Lax${secure ? "; Secure" : ""}`;
  }

  /** `scriptNonce`: the nonce of the page's own script; without it the page runs no script at all. */
  function send(res: ServerResponse, status: number, body: string, type: string, headers: Record<string, string | string[]> = {}, scriptNonce?: string): void {
    res.statusCode = status;
    res.setHeader("content-type", type);
    res.setHeader("cache-control", "no-store");
    res.setHeader("x-content-type-options", "nosniff");
    res.setHeader("cross-origin-opener-policy", "same-origin");
    res.setHeader("cross-origin-resource-policy", "same-origin");
    res.setHeader("permissions-policy", "camera=(), microphone=(), geolocation=(), payment=()");
    if (secure) res.setHeader("strict-transport-security", "max-age=31536000; includeSubDomains");
    // Chromium sends `Origin: null` on form posts from a no-referrer page, which the same-origin check would refuse.
    res.setHeader("referrer-policy", "same-origin");
    res.setHeader("content-security-policy", `default-src 'none'; style-src 'unsafe-inline'; img-src 'self'; ${scriptNonce ? `script-src 'nonce-${scriptNonce}'; connect-src 'self'; ` : ""}form-action 'self' ${CHECKOUT_ORIGINS}; frame-ancestors 'none'; base-uri 'none'`);
    for (const [name, value] of Object.entries(headers)) res.setHeader(name, value);
    res.end(body);
  }

  const json = (res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}) =>
    send(res, status, JSON.stringify(body), "application/json; charset=utf-8", headers);
  const html = (res: ServerResponse, status: number, input: Parameters<typeof page>[0], headers: Record<string, string | string[]> = {}) => {
    const nonce = token(16);
    send(res, status, page({ ...input, nonce, brand: operatorConsole ? "Delio Admin" : "Delio" }), "text/html; charset=utf-8", headers, nonce);
  };
  const billingRefresh = (workspace: Workspace) => operatorConsole ? {} : { billingRefresh: { workspace: workspace.slug, paymentVersion: plans.paidCount(workspace.slug) } };

  /** Opens SasPay's checkout for a plan or a top-up of this workspace, or shows the billing page with what stopped it. */
  async function openCheckout(res: ServerResponse, user: Account, workspace: Workspace, input: { kind: string; plan: string; topup: string; cycle: string }): Promise<void> {
    workspace = store.workspace(personal.resolve(user, workspace.slug))!;
    const fail = (status: number, error: string) => html(res, status, { title: "Facturation", email: user.email, ...billingRefresh(workspace), body: billing(workspace, user, { error }) });
    if (!saspay) return fail(503, "Les paiements ne sont pas encore activés.");
    if (!store.allow(`checkout:${user.id}`, 20, 60 * 60_000)) return fail(429, "Trop de paiements ouverts en peu de temps. Patientez une heure et réessayez.");
    const kind = input.kind;
    const plan = input.plan as PlanId;
    const topup = input.topup as TopupId;
    const cycle: Cycle = input.cycle === "year" ? "year" : "month";
    if (kind === "plan" && !Object.hasOwn(PLANS, plan)) return fail(400, "Choisissez un forfait.");
    if (kind === "topup" && !TOPUPS.some((pack) => pack.id === topup)) return fail(400, "Choisissez une recharge.");
    if (kind !== "plan" && kind !== "topup") return fail(400, "Choisissez un forfait ou une recharge.");
    if (kind === "plan" && plan === "trial" && plans.trialUsed(user.email, workspace.slug)) return fail(409, "L'essai a déjà été utilisé pour ce compte ou cet espace.");
    const order = kind === "plan"
      ? plans.createOrder({ workspace: workspace.slug, email: user.email, kind, plan, cycle }, currency, options.payments?.xofPerUsd)
      : plans.createOrder({ workspace: workspace.slug, email: user.email, kind, topup }, currency, options.payments?.xofPerUsd);
    const description = kind === "plan"
      ? `Delio ${PLANS[plan].name} · ${plan === "trial" ? `${TRIAL_DAYS} jours` : order.cycle === "year" ? "1 an" : "1 mois"}`
      : `Crédits Delio · ${order.credits}`;
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
      return fail(502, `La page de paiement n'a pas pu s'ouvrir (${error instanceof Error ? error.message : "erreur"}). Réessayez dans un instant.`);
    }
  }

  /** The person's own workspace, for an app or a payment that needs one before they made any. */
  function personalWorkspace(user: Account): Workspace {
    const found = personal.existing(user);
    if (found) return found;
    if (!store.allow(`personal:${user.id}`, 3, 24 * 60 * 60_000)) throw new HttpError(429, "Trop d'espaces créés aujourd'hui. Utilisez un espace existant ou réessayez demain.");
    return personal.ensure(user);
  }

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

  /** Whether this person may run this existing workspace's billing; an unknown workspace answers 404 further on. */
  function administers(user: Account, slug: string): boolean {
    return !validSlug(slug) || !store.workspace(slug) || store.role(slug, user.id) === "admin" || isOperator(user);
  }

  function otherAccount(res: ServerResponse, user: Account, next: string): void {
    return html(res, 403, { title: "Autre adresse", email: user.email, mascot: "curious", body: otherAccountPage(user.email, next) });
  }

  function requireWorkspaceAdmin(user: Account, slug: string): Workspace {
    const workspace = validSlug(slug) ? store.workspace(slug) : null;
    if (!workspace) throw new HttpError(404, "Cet espace n'existe pas.");
    if (store.role(slug, user.id) !== "admin" && !isOperator(user)) throw new HttpError(403, "Seuls les administrateurs de cet espace peuvent faire cela.");
    return workspace;
  }

  function signIn(res: ServerResponse, user: Account, next: string): void {
    if (store.blocked(user.id)) {
      return html(res, 403, { title: "Compte bloqué", mascot: "sad", body: messagePage("Ce compte est bloqué", `Écrivez à ${SUPPORT_EMAIL} si vous pensez que c'est une erreur.`) });
    }
    const session = store.createSession(user.id);
    store.audit(null, user.email, "account.signin", null);
    redirect(res, localPath(next), [sessionCookie(session.token, session.maxAgeSeconds)]);
  }

  async function startSso(res: ServerResponse, workspace: string, next: string): Promise<void> {
    const config = store.sso(workspace);
    if (!config) throw new HttpError(404, "La connexion unique (SSO) n'est pas configurée pour cet espace.");
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
      return html(res, 400, { title: "Lien invalide", body: messagePage("Ce lien de connexion n'est pas valide", "Rouvrez l'adresse de votre espace pour recommencer."), mascot: "sad" });
    }
    // Security: codes only ever travel back to the callback registered for this workspace, never to an address the link names.
    if (redirectUri !== new URL(CALLBACK_PATH, workspace.tenantUrl).href) {
      return html(res, 400, { title: "Lien invalide", body: messagePage("Ce lien de connexion n'est pas valide", "Ce lien ne ramène pas vers cet espace."), mascot: "sad" });
    }
    if (!user) return redirect(res, `/login?next=${encodeURIComponent(url.pathname + url.search)}`);
    const role = store.role(slug, user.id);
    if (!role) {
      return html(res, 403, { title: "Accès refusé", email: user.email, mascot: "sad",
        body: messagePage(`Vous n'êtes pas membre de ${workspace.name}`, `Connecté en tant que ${user.email}. Demandez une invitation à l'un de ses administrateurs.`, { href: "/", label: "Vos espaces" }) });
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

    if (method === "GET" && path === "/assets/billing-refresh.js") return send(res, 200, BILLING_REFRESH_SCRIPT, "text/javascript; charset=utf-8");

    const asset = method === "GET" ? options.assets?.get(path) : undefined;
    if (asset) {
      res.setHeader("cache-control", "public, max-age=86400");
      res.setHeader("content-type", "image/webp");
      res.end(asset);
      return;
    }
    if (path === "/api/health") return json(res, 200, { ok: true, service: "delio-admin", ...HOSTED_CONTRACT_METADATA });
    if (operatorConsole && !CONSOLE_PATHS.has(path) && !path.startsWith("/people/") && !consoleServes(path)) throw new HttpError(404, "Not found.");
    if (await gateway.handle(req, res, url)) return;
    if (path === "/api/public/plans") {
      if (method !== "GET") return json(res, 405, { error: "method not allowed" });
      return json(res, 200, catalog(options.payments?.xofPerUsd), { "access-control-allow-origin": "*", "cache-control": "public, max-age=300" });
    }
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
      if (plans.firstSeen(id) && event.event === "transaction.success" && saspay && (await reconcileOrders(plans, saspay)).length) startHosting();
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

    if (method === "POST" && !sameOrigin(req)) throw new HttpError(403, "Ce formulaire ne vient pas du portail Delio.");
    const user = account(req);

    if (method === "GET" && path === "/login") {
      if (user) return redirect(res, localPath(url.searchParams.get("next")));
      return html(res, 200, { title: "Connexion", body: loginPage(localPath(url.searchParams.get("next"))), mascot: "idle" });
    }
    if (method === "POST" && path === "/login") {
      const body = await readBody(req);
      const email = normalizeEmail(text(body, "email", 320)), next = localPath(text(body, "next", 2048));
      if (!validEmail(email)) return html(res, 400, { title: "Connexion", body: loginPage(next, "Entrez une adresse e-mail valide."), mascot: "sad" });
      const domain = email.slice(email.lastIndexOf("@") + 1);
      const sso = operatorConsole ? undefined : store.ssoForDomain(domain)[0];
      if (sso) return startSso(res, sso.workspace, next);
      // The console sends codes to the team only, and says the same thing to anyone else so no address is revealed.
      if (operatorConsole && !operators.has(email)) return html(res, 200, { title: "Vérifiez vos e-mails", body: codePage(email, next), mascot: "curious" });
      if (!store.allow(`otp-ip:${clientAddress(req)}`, 20, 15 * 60_000) || !store.allow(`otp-email:${email}`, 5, 15 * 60_000)) {
        return html(res, 429, { title: "Connexion", body: loginPage(next, "Trop de codes demandés. Patientez quelques minutes et réessayez."), mascot: "sad" });
      }
      const code = store.issueOtp(email);
      await mailer.send({ to: email, subject: `${code.slice(0, 4)} ${code.slice(4)} est votre code de connexion Delio`,
        text: `Votre code de connexion Delio est ${code.slice(0, 4)} ${code.slice(4)}.\n\nIl expire dans 10 minutes. Si vous ne l'avez pas demandé, ignorez cet e-mail.\n\nBesoin d'aide ? Écrivez à ${SUPPORT_EMAIL}.` })
        .catch((error: unknown) => console.error(`delio-admin: sign-in email could not be sent (${error instanceof Error ? error.name : "error"})`));
      return html(res, 200, { title: "Vérifiez vos e-mails", body: codePage(email, next), mascot: "curious" });
    }
    if (method === "POST" && path === "/login/verify") {
      const body = await readBody(req);
      const email = normalizeEmail(text(body, "email", 320)), next = localPath(text(body, "next", 2048));
      const code = text(body, "code", 16).replace(/\s/g, "");
      if (!store.allow(`verify-ip:${clientAddress(req)}`, 60, 15 * 60_000)) {
        return html(res, 429, { title: "Connexion", body: codePage(email, next, "Trop d'essais. Patientez quelques minutes."), mascot: "sad" });
      }
      const result = validEmail(email) && /^\d{8}$/.test(code) ? store.verifyOtp(email, code) : { ok: false as const, reason: "invalid" as const };
      if (!result.ok) {
        const message = result.reason === "expired" ? "Ce code a expiré. Demandez-en un nouveau." : result.reason === "locked" ? "Trop de codes erronés. Demandez-en un nouveau." : "Ce code n'est pas le bon.";
        return html(res, 401, { title: "Vérifiez vos e-mails", body: codePage(email, next, message), mascot: "sad" });
      }
      return signIn(res, result.account, next);
    }
    if (method === "POST" && path === "/logout") {
      const value = parseCookies(req.headers.cookie).get(cookieName);
      if (value) store.endSession(value);
      const next = localPath(text(await readBody(req).catch(() => ({})), "next", 2048));
      return redirect(res, next === "/" ? "/login" : `/login?next=${encodeURIComponent(next)}`, [sessionCookie("", 0)]);
    }
    if (method === "GET" && path === "/connect") return connect(res, url, user);

    if (method === "GET" && path === "/sso/start") {
      const slug = url.searchParams.get("workspace") ?? "";
      if (!validSlug(slug)) throw new HttpError(404, "Cet espace n'existe pas.");
      return startSso(res, slug, url.searchParams.get("next") ?? "/");
    }
    if (method === "GET" && path === SSO_CALLBACK_PATH) {
      const pending = store.takeSsoState(url.searchParams.get("state") ?? "");
      const code = url.searchParams.get("code") ?? "";
      const config = pending ? store.sso(pending.workspace) : null;
      if (!pending || !config || !code) {
        return html(res, 400, { title: "Connexion échouée", body: messagePage("La connexion unique n'a pas abouti", "La connexion a pris trop de temps ou a déjà servi. Recommencez.", { href: "/login", label: "Se connecter" }), mascot: "sad" });
      }
      let email: string;
      try {
        const provider = await discover(fetchImpl, config.issuer, options.allowHttpProviders);
        const idToken = await exchangeCode(fetchImpl, provider, { code, verifier: pending.verifier, redirectUri: ssoRedirectUri, clientId: config.clientId, clientSecret: config.clientSecret });
        ({ email } = await verifyIdToken(fetchImpl, provider, idToken, { clientId: config.clientId, nonce: pending.nonce, now: now() }));
      } catch (error) {
        console.warn(`delio-admin: single sign-on failed for ${pending.workspace}: ${error instanceof Error ? error.message : "error"}`);
        return html(res, 401, { title: "Connexion échouée", body: messagePage("La connexion unique a échoué", "La réponse de votre fournisseur d'identité n'a pas pu être vérifiée. Demandez à votre administrateur de vérifier la configuration.", { href: "/login", label: "Réessayer" }), mascot: "sad" });
      }
      if (!email.endsWith(`@${config.domain}`)) {
        return html(res, 403, { title: "Connexion échouée", body: messagePage("Ce compte n'est pas autorisé ici", `La connexion unique de cet espace n'accepte que les adresses @${config.domain}.`), mascot: "sad" });
      }
      const signedIn = store.ensureAccount(email);
      if (config.autoJoin && !store.role(config.workspace, signedIn.id)) store.addMember(config.workspace, signedIn.id, "member", "sso");
      return signIn(res, signedIn, pending.next);
    }

    if (method === "GET" && path === "/invite") {
      const value = url.searchParams.get("token") ?? "";
      const invitation = OPAQUE.test(value) ? store.invitation(value) : null;
      const workspace = invitation ? store.workspace(invitation.workspace) : null;
      if (!invitation || !workspace) return html(res, 404, { title: "Invitation", email: user?.email, body: messagePage("Cette invitation a expiré", "Demandez à un administrateur de vous en envoyer une nouvelle."), mascot: "sad" });
      return html(res, 200, { title: "Invitation", email: user?.email, body: invitePage({ invitation, workspace, token: value, email: user?.email ?? null }), mascot: "happy" });
    }

    if (!user) {
      if (method === "GET") return redirect(res, `/login?next=${encodeURIComponent(path + url.search)}`);
      throw new HttpError(401, "Connectez-vous d'abord.");
    }
    if (operatorConsole && !isOperator(user)) throw new HttpError(404, "Not found.");
    if (operatorConsole && await operatorPages(req, res, url, user)) return;

    if (method === "POST" && path === "/invite/accept") {
      const body = await readBody(req);
      const value = text(body, "token", 128);
      const invitation = OPAQUE.test(value) ? store.acceptInvitation(value, user) : null;
      if (!invitation) throw new HttpError(400, "Cette invitation a expiré ou concerne une autre adresse.");
      const workspace = store.workspace(invitation.workspace)!;
      return html(res, 200, { title: "Bienvenue", email: user.email, mascot: "happy",
        body: messagePage(`Vous avez rejoint ${workspace.name}`, "Vous pouvez maintenant vous connecter à l'espace.", { href: workspace.tenantUrl, label: `Ouvrir ${workspace.tenantUrl}` }) });
    }

    if (method === "GET" && path === "/") {
      return html(res, 200, { title: "Vos espaces", email: user.email, body: homePage({ workspaces: store.workspacesOf(user.id), operator: isOperator(user), signup: signupOpen && !operatorConsole,
        all: isOperator(user) ? store.allWorkspaces() : [], message: url.searchParams.get("created") ? "Espace créé." : undefined }) });
    }
    if (signupOpen && path === "/signup") {
      const form = method === "POST" ? await readBody(req) : null;
      const pick = (name: string, max: number) => (form ? text(form, name, max) : url.searchParams.get(name) ?? "").slice(0, max);
      const plan = Object.hasOwn(PLANS, pick("plan", 16)) ? pick("plan", 16) : "";
      const cycle = pick("cycle", 8) === "year" ? "year" : "month";
      const show = (status: number, extra: { name?: string; slug?: string; error?: string } = {}) =>
        html(res, status, { title: "Créer votre espace", email: user.email, mascot: "happy", body: signupPage({ domain: selfServe?.domain, plan, cycle, ...extra }) });
      if (method === "GET") return show(200);
      if (method !== "POST") throw new HttpError(405, "Méthode non autorisée.");
      const name = pick("name", 80), slug = pick("slug", 64).toLowerCase();
      const owned = store.workspacesOf(user.id).filter((item) => item.role === "admin" && hosting.get(item.slug)).length;
      const error = !name ? "Donnez un nom à l'espace."
        : !validSlug(slug) ? "L'identifiant doit faire 2 à 31 caractères : lettres minuscules, chiffres ou tirets, en commençant par une lettre."
        : RESERVED_SLUGS.has(slug) || store.workspace(slug) ? "Cet identifiant est déjà pris. Essayez-en un autre."
        : owned >= SELF_SERVE_LIMIT ? `Vous avez déjà ${SELF_SERVE_LIMIT} espaces. Écrivez à l'équipe Delio pour en avoir plus.` : null;
      if (error) return show(400, { name, slug, error });
      if (!store.allow(`signup:${user.id}`, 10, 60 * 60_000)) return show(429, { name, slug, error: "Trop d'espaces créés en peu de temps. Patientez une heure et réessayez." });
      store.createWorkspace({ slug, name, tenantUrl: selfServe ? `https://${slug}.${selfServe.domain}` : options.signup!.downloadUrl, ownerEmail: user.email }, user.email);
      if (selfServe) hosting.request(slug);
      return redirect(res, `/billing?workspace=${slug}${plan ? `&plan=${plan}&cycle=${cycle}` : ""}`);
    }
    if (method === "POST" && path === "/billing/hosting/retry") {
      const body = await readBody(req);
      const workspace = requireWorkspaceAdmin(user, text(body, "workspace", 64));
      const row = hosting.get(workspace.slug);
      if (row?.state === "failed") {
        hosting.set(workspace.slug, { state: "waiting", attempts: 0, nextTryAt: 0, error: null });
        store.audit(workspace.slug, user.email, "hosting.retry", null);
        startHosting();
      }
      return redirect(res, `/billing?workspace=${workspace.slug}`);
    }
    if (method === "POST" && path === "/workspaces") {
      if (!isOperator(user)) throw new HttpError(404, "Not found.");
      const body = await readBody(req);
      const slug = text(body, "slug", 64), name = text(body, "name", 80), tenant = tenantOrigin(text(body, "tenantUrl", 512)), owner = normalizeEmail(text(body, "ownerEmail", 320));
      const error = !validSlug(slug) ? "L'identifiant doit faire 2 à 31 caractères : lettres minuscules, chiffres ou tirets, en commençant par une lettre." : !name ? "Donnez un nom à l'espace."
        : !tenant ? "The workspace address must be an https:// address." : !validEmail(owner) ? "Enter the first administrator's email." : store.workspace(slug) ? "That slug is taken." : null;
      if (error) {
        return html(res, 400, { title: "Vos espaces", email: user.email, body: homePage({ workspaces: store.workspacesOf(user.id), operator: true, all: store.allWorkspaces(), error }) });
      }
      store.createWorkspace({ slug, name, tenantUrl: tenant!, ownerEmail: owner }, user.email);
      return redirect(res, "/?created=1");
    }

    if (method === "GET" && path === "/people") {
      const workspace = requireWorkspaceAdmin(user, url.searchParams.get("workspace") ?? "");
      const flash = url.searchParams.get("done");
      return html(res, 200, { title: "Membres", email: user.email, body: people(workspace, user, { message: flash === "invited" ? "Invitation envoyée." : flash ? "Enregistré." : undefined }) });
    }
    if (method === "POST" && path.startsWith("/people/")) {
      const body = await readBody(req);
      const workspace = requireWorkspaceAdmin(user, text(body, "workspace", 64));
      const back = (done: string) => redirect(res, `/people?workspace=${workspace.slug}&done=${done}`);
      const fail = (status: number, error: string, extra: { inviteLink?: string } = {}) =>
        html(res, status, { title: "Membres", email: user.email, body: people(workspace, user, { error, ...extra }) });
      if (path === "/people/invite") {
        const email = normalizeEmail(text(body, "email", 320)), role = text(body, "role", 16) as Role;
        if (!validEmail(email) || !ROLES.includes(role)) return fail(400, "Entrez une adresse e-mail et un rôle.");
        if (!store.allow(`invite:${workspace.slug}`, 100, 60 * 60_000)) return fail(429, "Trop d'invitations cette heure-ci.");
        const { token: value } = store.invite(workspace.slug, email, role, user.email);
        const link = new URL(`/invite?token=${value}`, publicUrl).href;
        await mailer.send({ to: email, subject: `Invitation à rejoindre ${workspace.name} sur Delio`,
          text: `${user.email} vous invite dans l'espace ${workspace.name} sur Delio en tant que ${role === "admin" ? "administrateur" : "membre"}.\n\nAccepter : ${link}\n\nCe lien expire dans 7 jours.` })
          .catch(() => console.error("delio-admin: invitation email could not be sent"));
        return html(res, 200, { title: "Membres", email: user.email, body: people(workspace, user, { message: `Invitation envoyée à ${email}.`, inviteLink: link }) });
      }
      if (path === "/people/cancel") {
        store.cancelInvitation(workspace.slug, text(body, "invitation", 64), user.email);
        return back("cancelled");
      }
      const target = text(body, "account", 64);
      if (path === "/people/role") {
        const role = text(body, "role", 16) as Role;
        if (!ROLES.includes(role)) return fail(400, "Choisissez un rôle.");
        const outcome = store.setRole(workspace.slug, target, role, user.email);
        if (outcome === "last-admin") return fail(409, "A workspace needs at least one admin. Promote someone else first.");
        if (outcome === "missing") return fail(404, "Cette personne n'est plus membre.");
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
      return html(res, 200, { title: "Connexion unique (SSO)", email: user.email, body: ssoPage({ workspace, sso: store.sso(workspace.slug), redirectUri: ssoRedirectUri,
        message: url.searchParams.get("done") ? "Enregistré." : undefined }) });
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
      const fail = (error: string) => html(res, 400, { title: "Connexion unique (SSO)", email: user.email,
        body: ssoPage({ workspace, sso: existing, redirectUri: ssoRedirectUri, error }) });
      if (!clientId || !clientSecret || !/^[a-z0-9.-]+\.[a-z]{2,}$/.test(domain)) return fail("Remplissez tous les champs.");
      const claimed = store.ssoForDomain(domain).find((config) => config.workspace !== workspace.slug);
      if (claimed) return fail(`${domain} already signs in through another workspace.`);
      try {
        await discover(fetchImpl, issuer, options.allowHttpProviders);
      } catch (error) {
        return fail(`L'émetteur est injoignable ou n'est pas un fournisseur OpenID Connect (${error instanceof Error ? error.message : "erreur"}).`);
      }
      store.setSso({ workspace: workspace.slug, issuer, clientId, clientSecret, domain, autoJoin: body.autoJoin === "1" }, user.email);
      return redirect(res, `/sso?workspace=${workspace.slug}&done=1`);
    }

    if (method === "GET" && path === "/device") {
      return html(res, 200, { title: "Connecter une application", email: user.email, mascot: "curious",
        body: devicePage({ code: url.searchParams.get("code") ?? "", email: user.email, label: devices.pendingLabel(url.searchParams.get("code") ?? ""), workspaces: store.workspacesOf(user.id).filter((item) => item.role === "admin") }) });
    }
    if (method === "POST" && path === "/device") {
      const body = await readBody(req);
      const code = text(body, "code", 16);
      const admin = store.workspacesOf(user.id).filter((item) => item.role === "admin");
      const again = (status: number, error: string) => html(res, status, { title: "Connecter une application", email: user.email, mascot: "sad", body: devicePage({ code, email: user.email, label: devices.pendingLabel(code), workspaces: admin, error }) });
      if (!devices.pendingLabel(code)) return again(400, "Ce code a expiré ou a déjà servi. Recommencez depuis l'application.");
      if (text(body, "decision", 8) === "deny") {
        devices.decide(code, "deny");
        return html(res, 200, { title: "Connecter une application", email: user.email, body: messagePage("Connexion refusée", "L'application n'a pas été connectée. Vous pouvez fermer cette page.") });
      }
      let slug = text(body, "workspace", 64);
      if (slug === "personal") {
        slug = personalWorkspace(user).slug;
      } else if (!admin.some((item) => item.slug === slug)) {
        return again(403, "Choisissez un espace que vous administrez.");
      }
      slug = personal.resolve(user, slug);
      const label = devices.pendingLabel(code);
      if (!devices.decide(code, { workspace: slug, accountId: user.id })) return again(400, "Ce code a expiré ou a déjà servi. Recommencez depuis l'application.");
      store.audit(slug, user.email, "device.connect", label);
      return html(res, 200, { title: "Connectée", email: user.email, mascot: "happy",
        body: messagePage("L'application est connectée", "Retournez dans l'application : elle termine toute seule en quelques secondes. Elle utilise les crédits Delio de cet espace.") });
    }
    if (method === "POST" && path === "/billing/checkout") {
      const body = await readBody(req);
      const workspace = requireWorkspaceAdmin(user, text(body, "workspace", 64));
      return openCheckout(res, user, workspace, { kind: text(body, "kind", 8), plan: text(body, "plan", 16), topup: text(body, "topup", 16), cycle: text(body, "cycle", 8) });
    }
    // One click from the site or the app: straight to SasPay's checkout, the person's own workspace made if needed.
    if (method === "GET" && path === "/pay") {
      const asked = url.searchParams.get("workspace");
      if (asked && !administers(user, asked)) return otherAccount(res, user, path + url.search);
      const workspace = asked ? requireWorkspaceAdmin(user, personal.resolve(user, asked)) : personal.existing(user) ?? store.workspacesOf(user.id).find((item) => item.role === "admin") ?? personalWorkspace(user);
      const pick = (name: string, max: number) => (url.searchParams.get(name) ?? "").slice(0, max);
      const topup = pick("topup", 16);
      return openCheckout(res, user, workspace, { kind: topup ? "topup" : "plan", plan: pick("plan", 16), topup, cycle: pick("cycle", 8) });
    }
    if (method === "GET" && path === "/api/billing/status") {
      const workspace = requireWorkspaceAdmin(user, url.searchParams.get("workspace") ?? "");
      await refreshPayments(workspace.slug);
      return json(res, 200, { paymentVersion: plans.paidCount(workspace.slug), pending: plans.pending().some(order => order.workspace === workspace.slug) });
    }
    if (method === "GET" && path === "/billing/return") {
      const order = plans.order(url.searchParams.get("order") ?? "");
      if (!order) throw new HttpError(404, "Ce paiement n'existe pas.");
      const workspace = requireWorkspaceAdmin(user, order.workspace);
      if (order.status === "pending") await refreshPayments(workspace.slug);
      const latest = plans.order(order.id)!;
      return html(res, 200, { title: "Facturation", email: user.email, ...billingRefresh(workspace), body: billing(workspace, user,
        latest.status === "paid" ? { message: "Paiement reçu : merci ! Vos crédits sont ajoutés." }
          : latest.status === "failed" ? { error: "Le paiement n'a pas abouti. Vous pouvez réessayer." }
          : { message: "Le paiement est en cours de confirmation. Cette page l'affichera dès que SasPay l'aura confirmé." }) });
    }
    if (method === "POST" && path === "/billing/device") {
      const body = await readBody(req);
      const workspace = requireWorkspaceAdmin(user, text(body, "workspace", 64));
      devices.revoke(workspace.slug, text(body, "device", 32));
      store.audit(workspace.slug, user.email, "device.revoke", null);
      return redirect(res, `/billing?workspace=${workspace.slug}&done=1`);
    }

    if (method === "GET" && path === "/billing") {
      const asked = url.searchParams.get("workspace");
      if (!asked) {
        const first = personal.existing(user) ?? store.workspacesOf(user.id).find((item) => item.role === "admin");
        if (!first && signupOpen) return redirect(res, `/signup?${new URLSearchParams([...url.searchParams].filter(([name]) => name === "plan" || name === "cycle"))}`);
        if (!first) return html(res, 200, { title: "Facturation", email: user.email, body: messagePage("Pas encore d'espace", "Un forfait s'achète pour un espace que vous administrez. Demandez à son administrateur, ou créez-en un d'abord.", { href: "/", label: "Retour" }) });
        const next = new URLSearchParams(url.searchParams);
        next.set("workspace", first.slug);
        return redirect(res, `/billing?${next}`);
      }
      if (!administers(user, asked)) return otherAccount(res, user, path + url.search);
      const resolved = personal.resolve(user, asked);
      if (resolved !== asked) {
        const next = new URLSearchParams(url.searchParams);
        next.set("workspace", resolved);
        return redirect(res, `/billing?${next}`);
      }
      const workspace = requireWorkspaceAdmin(user, asked);
      const chosen = url.searchParams.get("plan");
      await refreshPayments(workspace.slug);
      return html(res, 200, { title: "Facturation", email: user.email, ...billingRefresh(workspace), body: billing(workspace, user, { message: url.searchParams.get("done") ? "Enregistré." : undefined,
        chosen: chosen && Object.hasOwn(PLANS, chosen) ? chosen as PlanId : undefined, cycle: url.searchParams.get("cycle") === "year" ? "year" : "month" }) });
    }
    if (method === "POST" && (path === "/billing/credit" || path === "/billing/token")) {
      const body = await readBody(req);
      const workspace = requireWorkspaceAdmin(user, text(body, "workspace", 64));
      if (!isOperator(user)) throw new HttpError(404, "Not found.");
      if (path === "/billing/token") {
        const issued = wallet.issueToken(workspace.slug);
        store.audit(workspace.slug, user.email, "gateway.token", null);
        return html(res, 200, { title: "Facturation", email: user.email, body: billing(workspace, user, { token: issued }) });
      }
      const credits = Number(text(body, "credits", 16));
      if (!Number.isFinite(credits) || credits === 0 || Math.abs(credits) > 10_000_000) {
        return html(res, 400, { title: "Facturation", email: user.email, body: billing(workspace, user, { error: "Entrez un nombre de crédits." }) });
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

  function billing(workspace: Workspace, user: Account, extra: { message?: string; error?: string; token?: string; chosen?: PlanId; cycle?: Cycle }): Html {
    return billingPage({ workspace, operator: isOperator(user), balance: wallet.balance(workspace.slug) / MICRO,
      subscription: plans.subscription(workspace.slug), orders: plans.orders(workspace.slug, 10), payments: Boolean(saspay), currency,
      trialAvailable: !plans.trialUsed(user.email, workspace.slug), catalog: catalog(options.payments?.xofPerUsd),
      hosting: hostingView(workspace.slug),
      usedThisMonth: wallet.usedThisMonth(workspace.slug) / MICRO, hasToken: wallet.hasToken(workspace.slug), ledger: wallet.ledger(workspace.slug, 30),
      gatewayUrl: new URL(`/api/gateway/${workspace.slug}`, publicUrl).href, devices: devices.list(workspace.slug), ...extra });
  }

  function hostingView(slug: string) {
    const row = hosting.get(slug);
    return row ? { state: row.state, error: row.state === "failed" ? "La dernière tentative a échoué." : null, retry: row.state === "failed" } : null;
  }

  function people(workspace: Workspace, user: Account, extra: { message?: string; error?: string; inviteLink?: string }): Html {
    return peoplePage({ workspace, members: store.members(workspace.slug), invitations: store.invitations(workspace.slug), self: user.id,
      audit: store.auditLog(workspace.slug, 20), ...extra });
  }

  const operatorPages = createConsole({ store, wallet, devices, billing: plans, hosting, saspay, currency, operators, now, readForm: readBody,
    redirect: (res, location) => redirect(res, location), send });

  const handler = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    try {
      await route(req, res);
    } catch (error) {
      const status = error instanceof HttpError ? error.status : 500;
      const message = error instanceof HttpError ? error.message : "Une erreur est survenue.";
      if (status === 500) console.error("delio-admin:", error);
      if (res.headersSent) return void res.end();
      if (req.url?.startsWith("/api/")) return json(res, status, { error: message });
      html(res, status, { title: "Erreur", body: messagePage(status === 404 ? "Page introuvable" : "Cela n'a pas marché", message, { href: "/", label: "Retour" }), mascot: "sad" });
    }
  };
  async function sweep(): Promise<void> {
    await gateway.sweep();
    traffic.purge();
    if (saspay) await reconcileOrders(plans, saspay);
    plans.grantDue();
    const repaired = plans.repairUnapplied();
    for (const id of repaired) store.audit(plans.order(id)?.workspace ?? null, null, "order.repaired", id);
    if (repaired.length) startHosting();
    if (runHosting) await runHosting();
    for (const due of plans.dueReminders()) {
      const workspace = store.workspace(due.workspace);
      if (!workspace) continue;
      const link = new URL(`/billing?workspace=${due.workspace}`, publicUrl).href;
      const day = new Intl.DateTimeFormat("fr-FR", { dateStyle: "long", timeZone: "UTC" }).format(new Date(due.periodEnd));
      const message = due.plan === "trial"
        ? { subject: `Votre essai Delio pour ${workspace.name} se termine bientôt`,
          text: `L'essai de ${workspace.name} se termine le ${day}.\n\nChoisissez un forfait ici pour que vos bots continuent d'utiliser l'IA de Delio : ${link}\n\nBesoin d'aide ? Écrivez à ${SUPPORT_EMAIL}.` }
        : { subject: `Votre forfait Delio ${PLANS[due.plan].name} pour ${workspace.name} se termine bientôt`,
          text: `Le forfait ${PLANS[due.plan].name} de ${workspace.name} se termine le ${day}.\n\nRenouvelez-le ici pour continuer à recevoir ses crédits : ${link}\n\nAprès cette date, l'espace a 7 jours de grâce ; ensuite ses bots n'utilisent plus les crédits Delio jusqu'au renouvellement.\n\nBesoin d'aide ? Écrivez à ${SUPPORT_EMAIL}.` };
      for (const admin of store.members(due.workspace).filter((member) => member.role === "admin")) {
        await mailer.send({ to: admin.email, ...message })
          .catch(() => console.error("delio-admin: a renewal reminder could not be sent"));
      }
    }
  }
  return Object.assign(handler, { sweep, recordVisits: (visits: readonly VisitInput[]) => traffic.record(visits) });
}
