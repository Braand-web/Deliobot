import { delioConnection, type createDelioAccount } from "../delio-account.ts";
import type { AppConfig } from "../config.ts";
import { portalBillingUrl } from "../hosted-credits.ts";
import { PASS, type RouteHandler } from "./table.ts";

/** Settings' Delio account card: connect with a device code, see the credits left, disconnect. */
export function createDelioAccountRoutes(account: ReturnType<typeof createDelioAccount>, config: () => AppConfig): RouteHandler {
  return async ({ req, res, path, method, json, readBody, url }) => {
    if (path !== "/api/delio/account" && path !== "/api/delio/connect") return PASS;
    res.setHeader("cache-control", "no-store");
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
