import { delioConnection, type createDelioAccount } from "../delio-account.ts";
import type { MemoryBackup } from "../delio-memory-backup.ts";
import type { AppConfig } from "../config.ts";
import { serverVersion } from "../environment.ts";
import { portalBillingUrl } from "../hosted-credits.ts";
import { PASS, type RouteHandler } from "./table.ts";

/** Settings' Delio account card: connect with a device code, see the credits left, disconnect. */
export function createDelioAccountRoutes(account: ReturnType<typeof createDelioAccount>, config: () => AppConfig, memory?: MemoryBackup): RouteHandler {
  return async ({ req, res, path, method, json, readBody, url, auth }) => {
    if (path !== "/api/delio/account" && path !== "/api/delio/connect" && path !== "/api/delio/report" && path !== "/api/delio/promo" && !path.startsWith("/api/delio/memory")) return PASS;
    res.setHeader("cache-control", "no-store");
    if (path.startsWith("/api/delio/memory")) {
      if (!memory) return json(res, 404, { error: "not found" });
      if (!auth.scopes.includes("admin")) return json(res, 403, { error: "Only the owner can manage the account's memory backup." });
      const connected = Boolean(delioConnection(config()));
      if (path === "/api/delio/memory" && method === "GET") {
        let backups: Awaited<ReturnType<MemoryBackup["remote"]>> = [];
        let remoteError: string | undefined;
        if (connected) {
          try { backups = await memory.remote(); } catch (error) { remoteError = error instanceof Error ? error.message : String(error); }
        }
        return json(res, 200, { connected, enabled: config().features?.delioMemoryBackup !== false, ...memory.status(), backups, ...(remoteError ? { remoteError } : {}) });
      }
      if (!connected) return json(res, 409, { error: "Connect a Delio account first.", code: "not-connected" });
      if (path === "/api/delio/memory/backup" && method === "POST") {
        const status = await memory.backUp(true);
        return status.lastError && (status.lastErrorAt ?? 0) >= (status.lastAt ?? 0) ? json(res, 502, { error: status.lastError, ...status }) : json(res, 200, status);
      }
      if (path === "/api/delio/memory/restore" && method === "POST") {
        const body = await readBody(req, 4096).catch(() => ({})) as { id?: unknown };
        const id = typeof body?.id === "string" && /^[A-Za-z0-9_-]{6,40}$/.test(body.id) ? body.id : undefined;
        try {
          return json(res, 200, await memory.restore(id));
        } catch (error) {
          return json(res, (error as { status?: number }).status ?? 502, { error: error instanceof Error ? error.message : String(error) });
        }
      }
      return json(res, 405, { error: "method not allowed" });
    }
    if (path === "/api/delio/promo") {
      if (method !== "POST") return json(res, 405, { error: "method not allowed" });
      if (!auth.scopes.includes("admin")) return json(res, 403, { error: "Only the owner can enter a promo code." });
      const body = await readBody(req, 4096).catch(() => null) as { code?: unknown } | null;
      const code = typeof body?.code === "string" ? body.code.trim() : "";
      if (!code) return json(res, 400, { error: "empty code" });
      const outcome = await account.redeemPromo(code);
      return outcome.ok ? json(res, 200, { message: outcome.message }) : json(res, outcome.status, { error: outcome.message || "promo refused", code: outcome.status === 409 ? "not-connected" : "promo-refused" });
    }
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
        const fromThisComputer = ["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(req.socket.remoteAddress ?? "") && !req.headers["x-forwarded-for"] && !req.headers.forwarded;
        return json(res, 200, await account.start(typeof body?.portal === "string" ? body.portal : undefined, fromThisComputer));
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
