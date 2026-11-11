import { delioConnection, type createDelioAccount } from "../delio-account.ts";
import type { AppConfig } from "../config.ts";
import { PASS, type RouteHandler } from "./table.ts";

/** Settings' Delio account card: connect with a device code, see the credits left, disconnect. */
export function createDelioAccountRoutes(account: ReturnType<typeof createDelioAccount>, config: () => AppConfig): RouteHandler {
  return async ({ req, res, path, method, json, readBody }) => {
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
      account.disconnect();
      return json(res, 200, { state: "disconnected" });
    }
    if (path === "/api/delio/account" && method === "GET") {
      const connection = delioConnection(config());
      return json(res, 200, connection ? { connected: true, workspace: connection.workspace, portal: connection.portal, ...(await account.balance()) } : { connected: false });
    }
    return json(res, 405, { error: "method not allowed" });
  };
}
