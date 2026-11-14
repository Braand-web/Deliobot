import { delioConnection, type createDelioAccount } from "../delio-account.ts";
import type { AppConfig } from "../config.ts";
import { serverVersion } from "../environment.ts";
import { portalBillingUrl } from "../hosted-credits.ts";
import { PASS, type RouteHandler } from "./table.ts";

/** Settings' Delio account card: connect with a device code, see the credits left, disconnect. */
export function createDelioAccountRoutes(account: ReturnType<typeof createDelioAccount>, config: () => AppConfig): RouteHandler {
  return async ({ req, res, path, method, json, readBody, url }) => {
    if (path !== "/api/delio/account" && path !== "/api/delio/connect" && path !== "/api/delio/report") return PASS;
    res.setHeader("cache-control", "no-store");
    if (path === "/api/delio/report") {
      if (method !== "POST") return json(res, 405, { error: "method not allowed" });
      const body = await readBody(req, 1024 * 1024).catch(() => null) as { note?: unknown; transcript?: unknown; bot?: unknown } | null;
      const text = (value: unknown) => typeof value === "string" ? value : "";
      if (!body || (!text(body.note).trim() && !text(body.transcript).trim())) return json(res, 400, { error: "empty report" });
      const outcome = await account.report({ note: text(body.note), transcript: text(body.transcript), bot: text(body.bot).slice(0, 80), appVersion: serverVersion(), platform: process.platform });
      return json(res, outcome === "sent" ? 200 : outcome === "not-connected" ? 409 : outcome === "too-many" ? 429 : 502, { outcome });
    }
    if (path === "/api/delio/connect" && method === "POST") {
      const body = await readBody(req, 4096).catch(() => ({})) as { portal?: unknown };
      try {
        return json(res, 200, await account.start(typeof body?.portal === "string" ? body.portal : undefined));
      } catch (error) {
        return json(res, (error as { status?: number }).status ?? 502, { error: error instanceof Error ? error.message : "Could not reach Delio Admin." });
      }
    }
    if (path === "/api/delio/connect" && method === "GET") return json(res, 200, await account.status());
    if (path === "/api/delio/account" && method === "DELETE") {
      await account.disconnect();
      return json(res, 200, { state: "disconnected" });
    }
    if (path === "/api/delio/account" && method === "GET") {
      const view = await account.balance({ fresh: url.searchParams.get("fresh") === "1" });
      const connection = delioConnection(config());
      const gate = { planGate: account.planGate, ownAi: await account.ownAiAllowed() };
      return json(res, 200, connection
        ? { connected: true, workspace: connection.workspace, portal: connection.portal, email: config().delio?.email ?? null, checking: view === null, billingUrl: portalBillingUrl(connection.portal, connection.workspace), ...view, ...gate }
        : { connected: false, ...gate });
    }
    return json(res, 405, { error: "method not allowed" });
  };
}
