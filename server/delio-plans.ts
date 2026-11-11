// The plans and top-ups Delio sells, read from the Delio Admin portal this server belongs to: the one a connected app
// pays through, the hosted workspace's own, or the public one.
import { parseDelioCatalog, type DelioCatalog } from "../shared/delio-plans.ts";
import type { AppConfig } from "./config.ts";
import { DEFAULT_DELIO_PORTAL, delioConnection, delioPortalOrigin } from "./delio-account.ts";
import { hostedWorkspaceConfiguration } from "./enterprise.ts";
import { PASS, type RouteHandler } from "./routes/table.ts";

const TTL_MS = 5 * 60_000;
const RETRY_MS = 30_000;

export function delioBillingTarget(cfg: Pick<AppConfig, "delio">, env: NodeJS.ProcessEnv = process.env): { portal: string; workspace: string | null } {
  const connection = delioConnection(cfg);
  if (connection) return { portal: connection.portal, workspace: connection.workspace };
  const hosted = hostedWorkspaceConfiguration(env);
  if (hosted) return { portal: hosted.admin.origin, workspace: hosted.workspace };
  return { portal: delioPortalOrigin(env.ODB_DELIO_ADMIN_URL) ?? DEFAULT_DELIO_PORTAL, workspace: null };
}

export function createDelioPlans(deps: { config: () => Pick<AppConfig, "delio">; env?: NodeJS.ProcessEnv; fetchImpl?: typeof fetch; now?: () => number }) {
  const now = deps.now ?? Date.now;
  let cached: { portal: string; until: number; body: unknown } | null = null;

  async function load(): Promise<DelioCatalog | null> {
    const { portal, workspace } = delioBillingTarget(deps.config(), deps.env ?? process.env);
    const billingUrl = `${portal}/billing${workspace ? `?workspace=${encodeURIComponent(workspace)}` : ""}`;
    if (!cached || cached.portal !== portal || now() >= cached.until) {
      let body: unknown = null;
      try {
        const response = await (deps.fetchImpl ?? fetch)(`${portal}/api/public/plans`, { headers: { accept: "application/json" }, redirect: "error", signal: AbortSignal.timeout(8_000) });
        body = response.ok ? await response.json() : null;
        if (!response.ok) await response.body?.cancel().catch(() => undefined);
      } catch {
        body = null;
      }
      cached = { portal, until: now() + (body ? TTL_MS : RETRY_MS), body };
    }
    return parseDelioCatalog(cached.body, billingUrl);
  }

  const routes: RouteHandler = async ({ res, path, method, json }) => {
    if (path !== "/api/delio/plans") return PASS;
    if (method !== "GET") return json(res, 405, { error: "method not allowed" });
    res.setHeader("cache-control", "no-store");
    const catalog = await load();
    return catalog ? json(res, 200, catalog) : json(res, 503, { error: "Delio's plans could not be loaded. Try again in a moment." });
  };
  return { load, routes };
}
