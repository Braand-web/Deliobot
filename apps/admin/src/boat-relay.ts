// The Boat relay a hosted workspace's cloud computers go through: Boat's v1 API (https://docs.boat.dev/api/v1) with the
// operator's key, each sandbox tied to the workspace that created it, its awake minutes beyond the plan's included hours
// charged in credits, and every
// computer of a workspace put to sleep (never deleted) when its credits run out.
import type { IncomingMessage, ServerResponse } from "node:http";

import type { Wallet } from "./wallet.ts";

const MAX_BODY = 100 * 1024 * 1024;
const BOAT_ID = /^bx_[23456789abcdefghjkmnpqrstuvwxyz]{8}$/;
const OPERATION_ID = /^[A-Za-z0-9_-]{1,128}$/;
/** States in which Boat keeps the machine running and bills it; archived machines cost nothing. */
const AWAKE = new Set(["init", "provisioning", "provisioned", "cloning", "ready", "idle", "running"]);
const MINUTE_MS = 60_000;

export interface BoatRelayOptions {
  wallet: Wallet;
  key?: string;
  apiUrl?: string;
  usdPerHour?: number;
  /** Cloud computers a workspace may keep awake at once. */
  limit?: (workspace: string) => number;
  /** Awake hours a workspace's plan includes each calendar month (UTC) before minutes are charged in credits. */
  includedHours?: (workspace: string) => number;
  fetchImpl?: typeof fetch;
  now?: () => number;
}

function reply(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.setHeader("cache-control", "no-store");
  res.end(JSON.stringify(body));
}

async function readRaw(req: IncomingMessage): Promise<Buffer | undefined> {
  if (req.method === "GET" || req.method === "HEAD") return undefined;
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req as AsyncIterable<Buffer>) {
    size += chunk.length;
    if (size > MAX_BODY) throw Object.assign(new Error("Request too large."), { status: 413 });
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

export function createBoatRelay(options: BoatRelayOptions) {
  const { wallet } = options;
  const { db } = wallet;
  db.exec(`CREATE TABLE IF NOT EXISTS boat_sandboxes (id TEXT PRIMARY KEY, workspace TEXT NOT NULL, awake INTEGER NOT NULL, billed_at INTEGER NOT NULL, deleted INTEGER NOT NULL DEFAULT 0);
CREATE INDEX IF NOT EXISTS boat_sandboxes_workspace ON boat_sandboxes (workspace);
CREATE TABLE IF NOT EXISTS boat_included (workspace TEXT NOT NULL, month TEXT NOT NULL, minutes INTEGER NOT NULL, PRIMARY KEY (workspace, month));`);
  const fetchImpl = options.fetchImpl ?? fetch;
  const now = options.now ?? Date.now;
  const api = (options.apiUrl ?? "https://boat.dev/api/v1").replace(/\/+$/, "");
  const perMinuteUsd = (options.usdPerHour ?? 0.1) / 60;
  const limit = options.limit ?? (() => 1);
  const includedHours = options.includedHours ?? (() => 0);

  /** Of `minutes` awake now, how many the plan's included hours still cover this month; those are counted as used. */
  function takeIncluded(workspace: string, minutes: number): number {
    const month = new Date(now()).toISOString().slice(0, 7);
    const used = (db.prepare("SELECT minutes FROM boat_included WHERE workspace = ? AND month = ?").get(workspace, month) as { minutes: number } | undefined)?.minutes ?? 0;
    const free = Math.max(0, Math.min(minutes, Math.floor(includedHours(workspace) * 60) - used));
    if (free > 0) db.prepare("INSERT INTO boat_included (workspace, month, minutes) VALUES (?, ?, ?) ON CONFLICT (workspace, month) DO UPDATE SET minutes = minutes + excluded.minutes").run(workspace, month, free);
    return free;
  }

  const owned = (workspace: string, id: string) =>
    Boolean(db.prepare("SELECT 1 FROM boat_sandboxes WHERE id = ? AND workspace = ? AND deleted = 0").get(id, workspace));
  const awakeCount = (workspace: string) =>
    (db.prepare("SELECT COUNT(*) AS count FROM boat_sandboxes WHERE workspace = ? AND awake = 1 AND deleted = 0").get(workspace) as { count: number }).count;

  /** Charges the minutes since the last charge, a started minute counting whole when `final`. */
  function bill(id: string, final = false): void {
    const row = db.prepare("SELECT workspace, awake, billed_at FROM boat_sandboxes WHERE id = ? AND deleted = 0").get(id) as { workspace: string; awake: number; billed_at: number } | undefined;
    if (!row || !row.awake) return;
    const elapsed = now() - row.billed_at;
    const minutes = final ? Math.ceil(elapsed / MINUTE_MS) : Math.floor(elapsed / MINUTE_MS);
    if (minutes <= 0) return;
    const paid = minutes - takeIncluded(row.workspace, minutes);
    if (paid > 0) wallet.charge(row.workspace, wallet.microFor(paid * perMinuteUsd), "boat", "cloud computer");
    db.prepare("UPDATE boat_sandboxes SET billed_at = ? WHERE id = ?").run(final ? now() : row.billed_at + minutes * MINUTE_MS, id);
  }

  const setAwake = (id: string, awake: boolean) => db.prepare("UPDATE boat_sandboxes SET awake = ?, billed_at = ? WHERE id = ?").run(awake ? 1 : 0, now(), id);

  async function upstream(method: string, path: string, body?: Buffer, contentType?: string): Promise<Response> {
    return fetchImpl(`${api}${path}`, {
      method, redirect: "error", signal: AbortSignal.timeout(120_000),
      headers: { authorization: `Bearer ${options.key}`, accept: "application/json", ...(body ? { "content-type": contentType ?? "application/json" } : {}) },
      ...(body ? { body } : {}),
    });
  }

  async function pass(res: ServerResponse, response: Response, rewrite?: (body: Record<string, unknown>) => Record<string, unknown>): Promise<Record<string, unknown> | null> {
    const type = response.headers.get("content-type") ?? "application/json";
    const raw = Buffer.from(await response.arrayBuffer());
    let parsed: Record<string, unknown> | null = null;
    if (type.includes("json")) { try { parsed = JSON.parse(raw.toString("utf8")) as Record<string, unknown>; } catch { parsed = null; } }
    res.statusCode = response.status;
    res.setHeader("content-type", type);
    res.setHeader("cache-control", "no-store");
    res.end(parsed && rewrite ? JSON.stringify(rewrite(parsed)) : raw);
    return parsed;
  }

  /** Puts every awake computer of a workspace to sleep: its disk is kept, the minutes stop. */
  async function sleepAll(workspace: string): Promise<void> {
    const rows = db.prepare("SELECT id FROM boat_sandboxes WHERE workspace = ? AND awake = 1 AND deleted = 0").all(workspace) as Array<{ id: string }>;
    for (const { id } of rows) {
      bill(id, true);
      try {
        const response = await upstream("POST", `/sandboxes/${id}/stop`);
        await response.body?.cancel().catch(() => undefined);
      } catch { /* the next sweep tries again while it is still marked awake */ continue; }
      setAwake(id, false);
    }
  }

  return {
    sleepAll,
    /** Charges awake minutes and puts the computers of workspaces out of credits to sleep; run once a minute. */
    async sweep(): Promise<void> {
      const rows = db.prepare("SELECT id, workspace FROM boat_sandboxes WHERE awake = 1 AND deleted = 0").all() as Array<{ id: string; workspace: string }>;
      for (const { id } of rows) bill(id);
      for (const workspace of new Set(rows.map((row) => row.workspace))) {
        if (wallet.balance(workspace) <= 0) await sleepAll(workspace);
      }
    },

    async handle(req: IncomingMessage, res: ServerResponse, workspace: string, rest: string): Promise<void> {
      if (!options.key) return reply(res, 503, { error: "Cloud computers are not available on this Delio deployment." });
      const [pathOnly, query = ""] = rest.split("?");
      const parts = pathOnly!.split("/").filter(Boolean);
      const method = req.method ?? "GET";
      const search = query ? `?${query}` : "";
      const body = await readRaw(req);
      const type = typeof req.headers["content-type"] === "string" ? req.headers["content-type"] : undefined;

      if (parts[0] === "deletion-operations" && parts.length === 2 && OPERATION_ID.test(parts[1]!) && method === "GET") {
        await pass(res, await upstream("GET", `/deletion-operations/${parts[1]}`));
        return;
      }
      if (parts[0] !== "sandboxes") return reply(res, 404, { error: "Not found." });

      if (parts.length === 1 && method === "GET") {
        // The operator's account holds every workspace's computers: each sees only its own.
        await pass(res, await upstream("GET", `/sandboxes${search}`), (listed) => ({
          ...listed, sandboxes: Array.isArray(listed.sandboxes) ? listed.sandboxes.filter((item) => owned(workspace, String((item as { id?: unknown })?.id))) : [],
        }));
        return;
      }
      if (parts.length === 1 && method === "POST") {
        if (wallet.balance(workspace) <= 0) return reply(res, 402, { error: "This workspace is out of Delio credits, so no cloud computer can start. Ask an admin to top up." });
        if (awakeCount(workspace) >= limit(workspace)) return reply(res, 409, { error: `This workspace's plan allows ${limit(workspace)} cloud computer${limit(workspace) === 1 ? "" : "s"} awake at once. Put one to sleep first.` });
        const created = await pass(res, await upstream("POST", `/sandboxes${search}`, body, type));
        const id = (created?.sandbox as { id?: unknown } | undefined)?.id;
        if (typeof id === "string" && BOAT_ID.test(id)) {
          db.prepare("INSERT INTO boat_sandboxes (id, workspace, awake, billed_at) VALUES (?, ?, 1, ?) ON CONFLICT (id) DO NOTHING").run(id, workspace, now());
        }
        return;
      }

      const id = parts[1]!;
      if (!BOAT_ID.test(id) || !owned(workspace, id)) return reply(res, 404, { error: "No such cloud computer." });
      const action = parts.slice(2).join("/");
      if (action === "resume" && method === "POST") {
        if (wallet.balance(workspace) <= 0) return reply(res, 402, { error: "This workspace is out of Delio credits, so the cloud computer cannot wake up. Ask an admin to top up." });
        if (awakeCount(workspace) >= limit(workspace)) return reply(res, 409, { error: `This workspace's plan allows ${limit(workspace)} cloud computer${limit(workspace) === 1 ? "" : "s"} awake at once. Put one to sleep first.` });
      }
      if ((action === "stop" && method === "POST") || (!action && method === "DELETE")) bill(id, true);
      const response = await upstream(method, `/${parts.join("/")}${search}`, body, type);
      const answered = await pass(res, response);
      if (!response.ok) return;
      if (!action && method === "DELETE") db.prepare("UPDATE boat_sandboxes SET deleted = 1, awake = 0 WHERE id = ?").run(id);
      else if (action === "stop" && method === "POST") setAwake(id, false);
      else if (action === "resume" && method === "POST") setAwake(id, true);
      else if (!action && method === "GET") {
        const state = (answered?.sandbox as { state?: unknown } | undefined)?.state;
        const row = db.prepare("SELECT awake FROM boat_sandboxes WHERE id = ?").get(id) as { awake: number };
        if (typeof state === "string" && AWAKE.has(state) !== Boolean(row.awake)) { bill(id, true); setAwake(id, AWAKE.has(state)); }
      }
    },
  };
}
