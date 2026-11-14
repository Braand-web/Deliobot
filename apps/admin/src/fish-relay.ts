// The included Fish Audio voice: a connected Deliobot app speaks, transcribes and holds Live 3 calls through Fish Audio
// with Delio's key, and the workspace pays in Delio credits. Only the calls the app makes are relayed.
//
// Security: Fish agents and sessions live on Delio's one Fish account, so each is recorded for the workspace that made
// it and no other workspace can change, publish or end it. A voice listing never shows Delio's own voices.
import type { IncomingMessage, ServerResponse } from "node:http";

import type { SqlDatabase } from "./sql.ts";
import type { Wallet } from "./wallet.ts";

/** What a workspace pays, in US dollars. A Live call holds `liveHoldMinutes` when it starts and settles its real length. */
export const FISH_PRICES = { speechPer1kChars: 0.05, transcriptionPerMb: 0.03, transcriptionMinimum: 0.005, livePerMinute: 0.1, liveHoldMinutes: 10 } as const;

const MAX_JSON_BODY = 64 * 1024;
const MAX_AUDIO_BODY = 25 * 1024 * 1024;
const ID = /^[\w-]{1,128}$/;
const OUT_OF_CREDITS = "This workspace is out of Delio credits. Open Plans and credits in Deliobot to top up.";

type Route =
  | { kind: "voices" }
  | { kind: "speech" }
  | { kind: "transcription" }
  | { kind: "create"; what: "tool" | "agent" }
  | { kind: "agent"; id: string; action: "update" | "publish" }
  | { kind: "session-start" }
  | { kind: "session-end"; id: string };

/** The Fish Audio calls the app makes; anything else is refused. */
export function fishRoute(method: string, path: string): Route | null {
  if (method === "GET" && /^model(?:\/[\w-]{1,128})?$/.test(path)) return { kind: "voices" };
  if (method === "POST" && path === "v1/tts") return { kind: "speech" };
  if (method === "POST" && path === "v1/asr") return { kind: "transcription" };
  if (method === "POST" && path === "v1/agent/tools") return { kind: "create", what: "tool" };
  if (method === "POST" && path === "v1/agent/agents") return { kind: "create", what: "agent" };
  const agent = /^v1\/agent\/agents\/([^/]+)(\/publish)?$/.exec(path);
  if (agent && ID.test(agent[1]!) && ((method === "PATCH" && !agent[2]) || (method === "POST" && agent[2]))) return { kind: "agent", id: agent[1]!, action: agent[2] ? "publish" : "update" };
  if (method === "POST" && path === "v1/agent/sessions") return { kind: "session-start" };
  const end = /^v1\/agent\/sessions\/([^/]+)\/end$/.exec(path);
  if (method === "POST" && end && ID.test(end[1]!)) return { kind: "session-end", id: end[1]! };
  return null;
}

async function readBody(req: IncomingMessage, max: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req as AsyncIterable<Buffer>) {
    size += chunk.length;
    if (size > max) throw Object.assign(new Error("Request too large."), { status: 413 });
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

function reply(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.setHeader("cache-control", "no-store");
  res.end(JSON.stringify(body));
}
const refuse = (res: ServerResponse, status: number, message: string) => reply(res, status, { message });

export function createFishRelay(options: { db: SqlDatabase; wallet: Wallet; key?: string; apiUrl?: string; fetchImpl?: typeof fetch; now?: () => number }) {
  const { db, wallet } = options;
  const fetchImpl = options.fetchImpl ?? fetch;
  const now = options.now ?? Date.now;
  const api = (options.apiUrl ?? "https://api.fish.audio").replace(/\/+$/, "");
  db.exec("CREATE TABLE IF NOT EXISTS fish_objects (id TEXT PRIMARY KEY, workspace TEXT NOT NULL, kind TEXT NOT NULL, created_at INTEGER NOT NULL)");
  db.exec("CREATE TABLE IF NOT EXISTS fish_sessions (id TEXT PRIMARY KEY, workspace TEXT NOT NULL, hold TEXT NOT NULL, started_at INTEGER NOT NULL)");

  const owns = (workspace: string, id: string, kind: string) =>
    Boolean(db.prepare("SELECT 1 FROM fish_objects WHERE id = ? AND workspace = ? AND kind = ?").get(id, workspace, kind));

  async function call(method: string, path: string, init: { body?: Uint8Array; headers?: Record<string, string> } = {}): Promise<Response> {
    return fetchImpl(`${api}/${path}`, {
      method, redirect: "error", signal: AbortSignal.timeout(90_000),
      headers: { authorization: `Bearer ${options.key}`, ...init.headers }, ...(init.body ? { body: init.body } : {}),
    });
  }

  async function pass(res: ServerResponse, response: Response): Promise<Buffer> {
    const bytes = Buffer.from(await response.arrayBuffer());
    res.statusCode = response.status;
    res.setHeader("content-type", response.headers.get("content-type") ?? "application/octet-stream");
    res.setHeader("cache-control", "no-store");
    res.end(bytes);
    return bytes;
  }

  /** Charges what a call cost, or gives the hold back when Fish made nothing. */
  async function paid(res: ServerResponse, workspace: string, costUsd: number, model: string, send: () => Promise<Response>): Promise<void> {
    const hold = wallet.hold(workspace, wallet.microFor(costUsd));
    if (!hold) return refuse(res, 402, OUT_OF_CREDITS);
    try {
      const response = await send();
      await pass(res, response);
      if (response.ok) wallet.settle(hold.id, hold.amount, "fish", model);
      else wallet.release(hold.id);
    } catch {
      wallet.release(hold.id);
      if (!res.headersSent) refuse(res, 502, "Could not reach Fish Audio.");
    }
  }

  /** Settles a Live call at its real length, at most what was held. */
  function settleSession(id: string, workspace: string): void {
    const session = db.prepare("SELECT hold, started_at FROM fish_sessions WHERE id = ? AND workspace = ?").get(id, workspace) as { hold: string; started_at: number } | undefined;
    if (!session) return;
    db.prepare("DELETE FROM fish_sessions WHERE id = ?").run(id);
    const minutes = Math.max(1, Math.ceil((now() - session.started_at) / 60_000));
    wallet.settle(session.hold, wallet.microFor(Math.min(minutes, FISH_PRICES.liveHoldMinutes) * FISH_PRICES.livePerMinute), "fish", "live3");
  }

  return {
    available: () => Boolean(options.key),

    /** Settles Live calls the app never ended, at their full hold, once they are past any call's length. */
    sweep(): void {
      const stale = db.prepare("SELECT id, workspace FROM fish_sessions WHERE started_at < ?").all(now() - 2 * 60 * 60_000) as Array<{ id: string; workspace: string }>;
      for (const session of stale) settleSession(session.id, session.workspace);
    },

    /** Serves /api/gateway/<workspace>/fish/<rest> for an authenticated workspace whose plan spends credits. */
    async handle(req: IncomingMessage, res: ServerResponse, workspace: string, rest: string): Promise<void> {
      if (!options.key) return refuse(res, 503, "Delio's included Fish Audio voice is not set up yet.");
      const [path, query = ""] = rest.split("?", 2) as [string, string?];
      const method = req.method ?? "GET";
      const route = fishRoute(method, path);
      if (!route) return refuse(res, 404, "This Fish Audio call is not offered by Delio.");

      if (route.kind === "voices") {
        const params = new URLSearchParams(query);
        params.delete("self");
        const search = params.toString();
        await pass(res, await call("GET", `${path}${search ? `?${search}` : ""}`));
        return;
      }

      let body: Buffer;
      try { body = await readBody(req, route.kind === "transcription" ? MAX_AUDIO_BODY : MAX_JSON_BODY); } catch { return refuse(res, 413, "The request is too large."); }
      const json = { "content-type": "application/json" };

      if (route.kind === "speech") {
        let text = "";
        try { text = String((JSON.parse(body.toString("utf8")) as { text?: unknown }).text ?? ""); } catch { return refuse(res, 400, "The request was not valid JSON."); }
        if (!text.trim()) return refuse(res, 400, "There is no text to speak.");
        const model = typeof req.headers.model === "string" ? req.headers.model : "s1";
        return paid(res, workspace, (text.length / 1000) * FISH_PRICES.speechPer1kChars, model,
          () => call("POST", path, { body: new Uint8Array(body), headers: { ...json, accept: "audio/mpeg", model } }));
      }

      if (route.kind === "transcription") {
        const type = req.headers["content-type"];
        if (typeof type !== "string" || !type.startsWith("multipart/form-data")) return refuse(res, 400, "Send the audio as multipart form data.");
        const model = typeof req.headers.model === "string" ? req.headers.model : "transcribe-1-pro";
        const cost = Math.max(FISH_PRICES.transcriptionMinimum, (body.length / 1024 / 1024) * FISH_PRICES.transcriptionPerMb);
        return paid(res, workspace, cost, model, () => call("POST", path, { body: new Uint8Array(body), headers: { "content-type": type, model } }));
      }

      if (route.kind === "create") {
        const response = await call("POST", path, { body: new Uint8Array(body), headers: json });
        const bytes = await pass(res, response);
        if (response.ok) {
          const created = (() => { try { return JSON.parse(bytes.toString("utf8")) as Record<string, unknown>; } catch { return {}; } })();
          const id = route.what === "tool" ? created.tool_id : created.agent_id;
          if (typeof id === "string" && ID.test(id)) db.prepare("INSERT OR IGNORE INTO fish_objects (id, workspace, kind, created_at) VALUES (?, ?, ?, ?)").run(id, workspace, route.what, now());
        }
        return;
      }

      if (route.kind === "agent") {
        if (!owns(workspace, route.id, "agent")) return refuse(res, 404, "This Fish agent does not belong to this workspace.");
        await pass(res, await call(method, path, { body: new Uint8Array(body), headers: json }));
        return;
      }

      if (route.kind === "session-start") {
        let agent = "";
        try { agent = String((JSON.parse(body.toString("utf8")) as { agent_id?: unknown }).agent_id ?? ""); } catch { return refuse(res, 400, "The request was not valid JSON."); }
        if (!owns(workspace, agent, "agent")) return refuse(res, 404, "This Fish agent does not belong to this workspace.");
        const hold = wallet.hold(workspace, wallet.microFor(FISH_PRICES.liveHoldMinutes * FISH_PRICES.livePerMinute));
        if (!hold) return refuse(res, 402, OUT_OF_CREDITS);
        try {
          const response = await call("POST", path, { body: new Uint8Array(body), headers: json });
          const bytes = await pass(res, response);
          const session = (() => { try { return (JSON.parse(bytes.toString("utf8")) as { session_id?: unknown }).session_id; } catch { return null; } })();
          if (response.ok && typeof session === "string" && ID.test(session)) {
            db.prepare("INSERT INTO fish_sessions (id, workspace, hold, started_at) VALUES (?, ?, ?, ?)").run(session, workspace, hold.id, now());
          } else wallet.release(hold.id);
        } catch {
          wallet.release(hold.id);
          if (!res.headersSent) refuse(res, 502, "Could not reach Fish Audio.");
        }
        return;
      }

      if (!db.prepare("SELECT 1 FROM fish_sessions WHERE id = ? AND workspace = ?").get(route.id, workspace)) return refuse(res, 404, "This call is not running.");
      try {
        await pass(res, await call("POST", path, { body: new Uint8Array(body), headers: json }));
      } finally {
        settleSession(route.id, workspace);
      }
    },
  };
}

export type FishRelay = ReturnType<typeof createFishRelay>;
