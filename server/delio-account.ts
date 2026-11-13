// A desktop app connected to a Delio account: it spends that account's credits through the Delio gateway for text
// (a "Delio" engine on OpenRouter's catalog) and, without a fal.ai key of its own, for images, video and music.
// Connecting is RFC 8628's device flow against Delio Admin: the app shows a code, the person approves it there.
import type { ModelSelection } from "../shared/wire.ts";
import type { AppConfig } from "./config.ts";
import type { InstanceConfigMap } from "./contracts.ts";

export const DELIO_INSTANCE = "delio";
export const DELIO_TOKEN_ENV = "ODB_DELIO_TOKEN";
/** Set by the packaged desktop app: the customer's own AI (their keys, their Claude, ChatGPT or other sign-ins) then
 * needs a Max or BYOK plan. */
export const DELIO_PLAN_GATE_ENV = "ODB_DELIO_PLAN_GATE";
export const OWN_AI_REFUSAL = "Your own AI accounts and keys come with the Max and BYOK plans. Choose a plan in Settings → Plans and top-ups, or use Delio.";

export interface DelioAccountView { email: string | null; credits: number; usedThisMonth: number; plan: string | null; ownAi: boolean }
const DEVICE_TOKEN = /^odb_device_[A-Za-z0-9_-]{43}$/;
const SLUG = /^[a-z][a-z0-9-]{1,30}$/;
export const DEFAULT_DELIO_PORTAL = "https://compte.deliobot.fun";

export interface DelioConnection { portal: string; workspace: string; token: string; gateway: string }

/** The portal's origin: HTTPS, or plain HTTP on loopback for a local test portal. */
export function delioPortalOrigin(raw: string | undefined): string | null {
  try {
    const url = new URL(raw ?? "");
    const loopback = url.protocol === "http:" && ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname);
    if ((url.protocol !== "https:" && !loopback) || url.username || url.password || url.search || url.hash || url.pathname !== "/") return null;
    return url.origin;
  } catch {
    return null;
  }
}

export function delioConnection(cfg: Pick<AppConfig, "delio">): DelioConnection | null {
  const portal = delioPortalOrigin(cfg.delio?.portal);
  const workspace = cfg.delio?.workspace ?? "";
  const token = cfg.delio?.token ?? "";
  if (!portal || !SLUG.test(workspace) || !DEVICE_TOKEN.test(token)) return null;
  return { portal, workspace, token, gateway: `${portal}/api/gateway/${workspace}` };
}

/** The "Delio" engine: OpenRouter's catalog through the gateway, Auto first. */
export function delioInstanceConfigs(cfg: Pick<AppConfig, "delio">): InstanceConfigMap {
  const connection = delioConnection(cfg);
  if (!connection) return {};
  return {
    [DELIO_INSTANCE]: {
      driver: "openai-compat", displayName: "Delio",
      config: { url: `${connection.gateway}/openrouter/v1`, apiKeyEnv: DELIO_TOKEN_ENV, provider: "", model: "auto" },
      environment: { [DELIO_TOKEN_ENV]: connection.token },
    },
  };
}

/** Media settings as the generators see them: the person's own fal.ai key wins, else the Delio account pays. */
export function withDelioMedia<T extends Pick<AppConfig, "delio" | "fal">>(cfg: T): T {
  if (cfg.fal?.key?.trim()) return cfg;
  const connection = delioConnection(cfg);
  return connection ? { ...cfg, fal: { key: connection.token, url: `${connection.gateway}/fal` } } : cfg;
}

interface PendingFlow { portal: string; deviceCode: string; userCode: string; verification: string; expiresAt: number; interval: number; nextPollAt: number }

export function createDelioAccount(deps: {
  config: () => AppConfig;
  save: (delio: AppConfig["delio"] | null) => void;
  label: () => string;
  env?: NodeJS.ProcessEnv;
  fetchImpl?: typeof fetch;
  now?: () => number;
}) {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const now = deps.now ?? Date.now;
  let pending: PendingFlow | null = null;
  let credits: { at: number; view: DelioAccountView | null } | null = null;
  const planGate = (deps.env ?? process.env)[DELIO_PLAN_GATE_ENV] === "1";

  async function post(url: string, body: unknown): Promise<{ status: number; body: Record<string, unknown> }> {
    const response = await fetchImpl(url, {
      method: "POST", headers: { "content-type": "application/json", accept: "application/json" }, body: JSON.stringify(body),
      redirect: "error", signal: AbortSignal.timeout(10_000),
    });
    const parsed = await response.json().catch(() => ({})) as Record<string, unknown>;
    return { status: response.status, body: parsed && typeof parsed === "object" ? parsed : {} };
  }

  async function start(portalRaw?: string): Promise<{ userCode: string; verification: string; expiresAt: number }> {
    const portal = delioPortalOrigin(portalRaw || deps.env?.ODB_DELIO_ADMIN_URL || process.env.ODB_DELIO_ADMIN_URL || DEFAULT_DELIO_PORTAL);
    if (!portal) throw Object.assign(new Error("The Delio Admin address must be an HTTPS origin."), { status: 400 });
    const answer = await post(`${portal}/api/device/start`, { label: deps.label() });
    const { device_code: deviceCode, user_code: userCode, verification_uri_complete: verification, expires_in: expiresIn, interval } = answer.body;
    if (answer.status !== 200 || typeof deviceCode !== "string" || typeof userCode !== "string" || typeof verification !== "string" || !verification.startsWith(`${portal}/`)) {
      throw Object.assign(new Error("Delio Admin did not start the connection. Try again in a moment."), { status: 502 });
    }
    const seconds = typeof interval === "number" && interval > 0 ? interval : 3;
    pending = { portal, deviceCode, userCode, verification, expiresAt: now() + (typeof expiresIn === "number" ? expiresIn : 600) * 1000, interval: seconds * 1000, nextPollAt: 0 };
    return { userCode, verification, expiresAt: pending.expiresAt };
  }

  /** Where the connection stands; while a code waits, asks the portal at most once per its interval. */
  async function status(): Promise<{ state: "connected"; workspace: string; portal: string } | { state: "waiting"; userCode: string; verification: string } | { state: "disconnected"; reason?: "denied" | "expired" }> {
    const connection = delioConnection(deps.config());
    if (connection && !pending) return { state: "connected", workspace: connection.workspace, portal: connection.portal };
    if (!pending) return { state: "disconnected" };
    if (pending.expiresAt <= now()) { pending = null; return { state: "disconnected", reason: "expired" }; }
    if (now() >= pending.nextPollAt) {
      pending.nextPollAt = now() + pending.interval;
      const answer = await post(`${pending.portal}/api/device/token`, { device_code: pending.deviceCode }).catch(() => null);
      if (answer?.status === 200 && typeof answer.body.token === "string" && typeof answer.body.workspace === "string") {
        deps.save({ portal: pending.portal, workspace: answer.body.workspace, token: answer.body.token });
        pending = null;
        credits = null;
        const saved = delioConnection(deps.config());
        return saved ? { state: "connected", workspace: saved.workspace, portal: saved.portal } : { state: "disconnected" };
      }
      if (answer && (answer.body.error === "access_denied" || answer.body.error === "expired_token")) {
        pending = null;
        return { state: "disconnected", reason: answer.body.error === "access_denied" ? "denied" : "expired" };
      }
    }
    return { state: "waiting", userCode: pending.userCode, verification: pending.verification };
  }

  /** `fresh`: the person is back in the app, perhaps from paying, so a reading older than a few seconds is read again. */
  async function balance({ fresh = false }: { fresh?: boolean } = {}): Promise<DelioAccountView | null> {
    const connection = delioConnection(deps.config());
    if (!connection) return null;
    if (credits && now() - credits.at < (fresh ? 5_000 : 60_000)) return credits.view;
    let view: DelioAccountView | null = null;
    try {
      const response = await fetchImpl(`${connection.portal}/api/workspace/${connection.workspace}/account`, {
        headers: { authorization: `Bearer ${connection.token}`, accept: "application/json" }, redirect: "error", signal: AbortSignal.timeout(5_000),
      });
      const body = response.ok ? await response.json() as { email?: unknown; credits?: unknown; usedThisMonth?: unknown; plan?: unknown; ownAi?: unknown } : null;
      if (body && typeof body.credits === "number" && typeof body.usedThisMonth === "number") {
        view = { email: typeof body.email === "string" ? body.email : null, credits: body.credits, usedThisMonth: body.usedThisMonth, plan: typeof body.plan === "string" ? body.plan : null, ownAi: body.ownAi === true };
      }
    } catch { view = null; }
    credits = { at: now(), view };
    return view;
  }

  /** Whether this app may run AI other than Delio's: always without the plan gate, else only on a Max or BYOK plan. */
  async function ownAiAllowed(): Promise<boolean> {
    if (!planGate) return true;
    return (await balance())?.ownAi === true;
  }

  /** Refuses a turn on an engine other than Delio's when the plan does not include the customer's own AI. */
  async function assertOwnAi(instanceId: string): Promise<void> {
    if (instanceId === DELIO_INSTANCE || await ownAiAllowed()) return;
    throw Object.assign(new Error(OWN_AI_REFUSAL), { status: 402, code: "plan_required" });
  }

  return {
    start, status, balance, ownAiAllowed, assertOwnAi, planGate,
    /** Forgets the account here and revokes this app's token on the portal, so a copied token stops working too. */
    async disconnect() {
      const connection = delioConnection(deps.config());
      pending = null;
      credits = null;
      deps.save(null);
      if (!connection) return;
      await fetchImpl(`${connection.portal}/api/workspace/${connection.workspace}/account`, {
        method: "DELETE", headers: { authorization: `Bearer ${connection.token}` }, redirect: "error", signal: AbortSignal.timeout(5_000),
      }).catch(() => undefined);
    },
  };
}

/** Before a turn on a plan without the customer's own AI: a bot on another engine moves to Delio's, the engine the plan
 * pays for, and a turn that still names another engine is refused. */
export function delioPlanTurnsFor(deps: {
  account: Pick<ReturnType<typeof createDelioAccount>, "ownAiAllowed" | "assertOwnAi">;
  bot: (botId: string, threadId: string) => { modelSelection: ModelSelection } | null | undefined;
  useDelio: (botId: string, selection: ModelSelection) => unknown;
}) {
  return {
    async before(botId: string, threadId: string): Promise<void> {
      const current = deps.bot(botId, threadId);
      if (!current || current.modelSelection.instanceId === DELIO_INSTANCE || await deps.account.ownAiAllowed()) return;
      deps.useDelio(botId, { instanceId: DELIO_INSTANCE, model: "auto" });
      await deps.account.assertOwnAi(deps.bot(botId, threadId)?.modelSelection.instanceId ?? current.modelSelection.instanceId);
    },
  };
}
