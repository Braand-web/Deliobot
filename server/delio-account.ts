// A desktop app connected to a Delio account: it spends that account's credits through the Delio gateway for text
// (a "Delio" engine on OpenRouter's catalog) and, without a fal.ai key of its own, for images, video and music.
// Connecting is RFC 8628's device flow against Delio Admin: the app shows a code, the person approves it there.
import type { AppConfig } from "./config.ts";
import type { InstanceConfigMap } from "./contracts.ts";

export const DELIO_INSTANCE = "delio";
export const DELIO_TOKEN_ENV = "ODB_DELIO_TOKEN";
const DEVICE_TOKEN = /^odb_device_[A-Za-z0-9_-]{43}$/;
const SLUG = /^[a-z][a-z0-9-]{1,30}$/;
export const DEFAULT_DELIO_PORTAL = "https://admin.deliobot.fun";

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
  let credits: { at: number; view: { credits: number; usedThisMonth: number } | null } | null = null;

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

  async function balance(): Promise<{ credits: number; usedThisMonth: number } | null> {
    const connection = delioConnection(deps.config());
    if (!connection) return null;
    if (credits && now() - credits.at < 60_000) return credits.view;
    let view: { credits: number; usedThisMonth: number } | null = null;
    try {
      const response = await fetchImpl(`${connection.portal}/api/workspace/${connection.workspace}/account`, {
        headers: { authorization: `Bearer ${connection.token}`, accept: "application/json" }, redirect: "error", signal: AbortSignal.timeout(5_000),
      });
      const body = response.ok ? await response.json() as { credits?: unknown; usedThisMonth?: unknown } : null;
      if (body && typeof body.credits === "number" && typeof body.usedThisMonth === "number") view = { credits: body.credits, usedThisMonth: body.usedThisMonth };
    } catch { view = null; }
    credits = { at: now(), view };
    return view;
  }

  return {
    start, status, balance,
    disconnect() { pending = null; credits = null; deps.save(null); },
  };
}
