// The paid door to AI providers for hosted workspaces and connected apps: each request names its workspace and carries
// that workspace's token, is held against its credits, runs with the operator's provider key, and is charged its real cost.
// Security: provider keys never leave this process, and a workspace only ever reaches its own fal.ai jobs.
import type { IncomingMessage, ServerResponse } from "node:http";

import { createBoatRelay } from "./boat-relay.ts";
import type { AdminStore } from "./store.ts";
import { MICRO, type Wallet } from "./wallet.ts";

export interface GatewayOptions {
  store: AdminStore;
  wallet: Wallet;
  /** A connected desktop app's token, accepted beside the workspace token. */
  deviceToken?: (token: string, workspace: string) => boolean;
  /** Resolves an authenticated device's empty duplicate personal workspace to its existing personal account. */
  deviceAccount?: (token: string, workspace: string) => { workspace: string; sourceWorkspace: string; email: string } | null;
  refreshAccount?: (workspace: string) => Promise<void>;
  paymentVersion?: (workspace: string) => number;
  /** Keeps a problem report a person sent from their app; false when this workspace has sent too many today. */
  report?: (input: { workspace: string; email: string | null; note: string; transcript: string; bot: string; appVersion: string; platform: string }) => boolean;
  /** The address that connected a device token, shown in the app as who is signed in. */
  deviceEmail?: (token: string, workspace: string) => string | null;
  /** Revokes a device token when its app signs out. */
  revokeDevice?: (token: string, workspace: string) => void;
  publicUrl: URL;
  openrouterKey?: string;
  falKey?: string;
  fetchImpl?: typeof fetch;
  openrouterUrl?: string;
  falQueueUrl?: string;
  falApiUrl?: string;
  boatKey?: string;
  boatUrl?: string;
  boatUsdPerHour?: number;
  /** What the workspace's plan allows: spending Delio credits, and cloud computers awake at once. */
  allowance?: (workspace: string) => { gateway: boolean; computers: number; computerHours?: number; plan?: string | null; ownAi?: boolean; reason?: string };
  now?: () => number;
}

const MAX_BODY = 4 * 1024 * 1024;
/** The least a text request is held at before its real cost is known; the rest goes back when it settles. */
const TEXT_HOLD_USD = 0.05;
/** A request that names no `max_tokens` is held as if it answered with this many. */
const TEXT_DEFAULT_OUTPUT_TOKENS = 4096;
/** Bytes of request per input token, on the low side so the hold errs high. */
const BYTES_PER_TOKEN = 3;
/** A fal.ai job whose price list cannot be read is held at this much. */
const FAL_UNKNOWN_HOLD_USD = 1;
/** Text requests a workspace runs at once, by plan; the ones past it wait their turn. */
const CONCURRENT_BY_PLAN: Record<string, number> = { pro: 16, max: 32 };
const CONCURRENT_DEFAULT = 8;
/** A waiting request gives up after this long, and no more than this many times the limit wait at once. */
const QUEUE_WAIT_MS = 45_000;
const QUEUE_DEPTH = 4;
const PRICE_TTL_MS = 24 * 60 * 60_000;
const FAL_MODEL = /^[A-Za-z0-9][A-Za-z0-9._-]*(\/[A-Za-z0-9][A-Za-z0-9._-]*){1,5}$/;
const SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const OUT_OF_CREDITS = "This workspace is out of Delio credits. Ask an admin to top up in Delio Admin → Billing.";
const NOT_CONFIGURED = "This provider is not available on this Delio deployment.";

export const OUT_OF_CREDITS_CODE = "credits_exhausted";

function send(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}): void {
  res.statusCode = status;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.setHeader("cache-control", "no-store");
  for (const [name, value] of Object.entries(headers)) res.setHeader(name, value);
  res.end(JSON.stringify(body));
}

/** OpenAI-style error bodies, which the workspace's engines show as the reason a turn failed. */
const failure = (res: ServerResponse, status: number, message: string, code?: string) =>
  send(res, status, { error: { message, ...(code ? { code } : {}) } });

async function readRaw(req: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req as AsyncIterable<Buffer>) {
    size += chunk.length;
    if (size > MAX_BODY) throw Object.assign(new Error("Request too large."), { status: 413 });
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

function bearer(req: IncomingMessage): string {
  const header = req.headers.authorization ?? "";
  const match = /^(?:Bearer|Key)\s+(\S+)$/i.exec(header);
  if (match) return match[1]!;
  const apiKey = req.headers["x-api-key"];
  return typeof apiKey === "string" ? apiKey : "";
}

/** The provider cost of an OpenRouter answer: `usage.cost`, in a JSON body or the last SSE event that carries it. */
export function openrouterCost(text: string): number | null {
  let cost: number | null = null;
  const read = (value: unknown) => {
    const found = (value as { usage?: { cost?: unknown } } | null)?.usage?.cost;
    if (typeof found === "number" && Number.isFinite(found) && found >= 0) cost = found;
  };
  const trimmed = text.trim();
  if (trimmed.startsWith("{")) {
    try { read(JSON.parse(trimmed)); } catch { /* a cut-off body has no cost */ }
    return cost;
  }
  for (const line of text.split("\n")) {
    if (!line.startsWith("data:")) continue;
    const data = line.slice(5).trim();
    if (!data || data === "[DONE]") continue;
    try { read(JSON.parse(data)); } catch { /* keepalive or partial line */ }
  }
  return cost;
}

/** How many of a fal.ai model's billing units a request asks for: its length for per-second pricing, else one output. */
export function falUnits(input: Record<string, unknown>, unit: string): number {
  if (!/second/.test(unit)) return 1;
  const raw = input.duration ?? input.seconds_total ?? input.duration_seconds ?? (typeof input.music_length_ms === "number" ? input.music_length_ms / 1000 : undefined);
  const seconds = typeof raw === "number" ? raw : typeof raw === "string" ? Number.parseFloat(raw) : NaN;
  return Number.isFinite(seconds) && seconds > 0 ? Math.min(seconds, 600) : 10;
}

export function createGateway(options: GatewayOptions) {
  const { store, wallet } = options;
  const fetchImpl = options.fetchImpl ?? fetch;
  const now = options.now ?? Date.now;
  const openrouterUrl = (options.openrouterUrl ?? "https://openrouter.ai/api/v1").replace(/\/+$/, "");
  const falQueueUrl = (options.falQueueUrl ?? "https://queue.fal.run").replace(/\/+$/, "");
  const falApiUrl = (options.falApiUrl ?? "https://api.fal.ai/v1").replace(/\/+$/, "");
  const boat = createBoatRelay({ wallet, key: options.boatKey, apiUrl: options.boatUrl, usdPerHour: options.boatUsdPerHour, limit: (workspace) => options.allowance?.(workspace).computers ?? 1,
    includedHours: (workspace) => options.allowance?.(workspace).computerHours ?? 0, fetchImpl, now });
  const running = new Map<string, number>();
  const prices = new Map<string, { at: number; price: { unitPrice: number; unit: string } | null }>();

  async function falPrice(model: string): Promise<{ unitPrice: number; unit: string } | null> {
    const hit = prices.get(model);
    if (hit && now() - hit.at < PRICE_TTL_MS) return hit.price;
    let price: { unitPrice: number; unit: string } | null = null;
    try {
      const response = await fetchImpl(`${falApiUrl}/models/pricing?${new URLSearchParams({ endpoint_id: model })}`, {
        headers: { authorization: `Key ${options.falKey}`, accept: "application/json" }, redirect: "error", signal: AbortSignal.timeout(10_000),
      });
      if (response.ok) {
        const body = await response.json() as { prices?: Array<{ endpoint_id?: unknown; unit_price?: unknown; unit?: unknown; currency?: unknown }> };
        const entry = body.prices?.find((item) => item.endpoint_id === model);
        if (entry && typeof entry.unit_price === "number" && typeof entry.unit === "string" && entry.currency === "USD") price = { unitPrice: entry.unit_price, unit: entry.unit.toLowerCase() };
      } else {
        await response.body?.cancel().catch(() => undefined);
      }
    } catch { price = null; }
    prices.set(model, { at: price ? now() : now() - PRICE_TTL_MS + 60_000, price });
    return price;
  }

  const waiting = new Map<string, Array<() => void>>();
  const release = (workspace: string) => () => {
    const next = waiting.get(workspace)?.shift();
    if (next) return next();
    const left = (running.get(workspace) ?? 1) - 1;
    if (left > 0) running.set(workspace, left); else running.delete(workspace);
  };

  /** A place among the workspace's running requests, at once or after waiting in line; null when the line is full or the wait too long. */
  function admit(workspace: string, limit: number): Promise<(() => void) | null> {
    const count = running.get(workspace) ?? 0;
    if (count < limit) {
      running.set(workspace, count + 1);
      return Promise.resolve(release(workspace));
    }
    const line = waiting.get(workspace) ?? [];
    if (line.length >= limit * QUEUE_DEPTH) return Promise.resolve(null);
    waiting.set(workspace, line);
    return new Promise((resolve) => {
      const turn = () => { clearTimeout(timer); resolve(release(workspace)); };
      const timer = setTimeout(() => {
        const at = line.indexOf(turn);
        if (at >= 0) line.splice(at, 1);
        resolve(null);
      }, QUEUE_WAIT_MS);
      line.push(turn);
    });
  }

  let textPrices: { at: number; byModel: Map<string, { prompt: number; completion: number }> } | null = null;
  /** OpenRouter's USD price per token of each model, read from its public list and kept a day; empty when unreadable. */
  async function textPrice(model: string): Promise<{ prompt: number; completion: number } | null> {
    if (!textPrices || now() - textPrices.at >= PRICE_TTL_MS) {
      const byModel = new Map<string, { prompt: number; completion: number }>();
      try {
        const response = await fetchImpl(`${openrouterUrl}/models`, { headers: { accept: "application/json" }, redirect: "error", signal: AbortSignal.timeout(10_000) });
        const body = response.ok ? await response.json() as { data?: Array<{ id?: unknown; pricing?: { prompt?: unknown; completion?: unknown } }> } : null;
        for (const entry of body?.data ?? []) {
          const prompt = Number(entry.pricing?.prompt), completion = Number(entry.pricing?.completion);
          if (typeof entry.id === "string" && Number.isFinite(prompt) && Number.isFinite(completion) && prompt >= 0 && completion >= 0) byModel.set(entry.id, { prompt, completion });
        }
      } catch { /* held at the flat amount below */ }
      textPrices = { at: byModel.size ? now() : now() - PRICE_TTL_MS + 60_000, byModel };
    }
    return textPrices.byModel.get(model) ?? null;
  }

  /** What a text request can cost at most: its size at the model's input price plus the answer it may ask for. */
  async function textHoldUsd(model: string, bytes: number, maxTokens: unknown): Promise<number> {
    const price = await textPrice(model);
    if (!price) return TEXT_HOLD_USD;
    const output = typeof maxTokens === "number" && Number.isFinite(maxTokens) && maxTokens > 0 ? maxTokens : TEXT_DEFAULT_OUTPUT_TOKENS;
    return Math.max(TEXT_HOLD_USD, (bytes / BYTES_PER_TOKEN) * price.prompt + output * price.completion);
  }

  async function openrouter(req: IncomingMessage, res: ServerResponse, workspace: string, rest: string, limit: number): Promise<void> {
    if (!options.openrouterKey) return failure(res, 503, NOT_CONFIGURED);
    const upstreamHeaders = { authorization: `Bearer ${options.openrouterKey}`, accept: req.headers.accept ?? "application/json" };
    if (req.method === "GET" && (rest === "models" || rest.startsWith("models?"))) {
      const response = await fetchImpl(`${openrouterUrl}/${rest}`, { headers: upstreamHeaders, redirect: "error", signal: AbortSignal.timeout(15_000) });
      res.statusCode = response.status;
      res.setHeader("content-type", response.headers.get("content-type") ?? "application/json");
      res.setHeader("cache-control", "no-store");
      res.end(Buffer.from(await response.arrayBuffer()));
      return;
    }
    if (req.method !== "POST" || rest !== "chat/completions") return failure(res, 404, "Not found.");
    let body: Record<string, unknown>;
    let bytes = 0;
    try {
      const raw = await readRaw(req);
      bytes = raw.length;
      const parsed: unknown = JSON.parse(raw.toString("utf8"));
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error();
      body = parsed as Record<string, unknown>;
    } catch (error) {
      return failure(res, (error as { status?: number }).status ?? 400, "The request was not valid JSON.");
    }
    const model = typeof body.model === "string" ? body.model : "unknown";
    if (wallet.balance(workspace) <= 0) return failure(res, 402, OUT_OF_CREDITS, OUT_OF_CREDITS_CODE);
    const holdUsd = await textHoldUsd(model, bytes, body.max_tokens ?? body.max_completion_tokens);
    const done = await admit(workspace, limit);
    if (!done) return failure(res, 429, "Too many requests at once for this workspace. Try again in a moment.");
    const hold = wallet.hold(workspace, wallet.microFor(holdUsd));
    if (!hold) { done(); return failure(res, 402, OUT_OF_CREDITS, OUT_OF_CREDITS_CODE); }
    let settled = false;
    const finish = (costUsd: number | null, made: boolean) => {
      if (settled) return;
      settled = true;
      if (!made) wallet.release(hold.id);
      else wallet.settle(hold.id, costUsd === null ? hold.amount : wallet.microFor(costUsd), "openrouter", model);
      done();
    };
    try {
      // OpenRouter reports each answer's cost only when asked.
      const complete = (input: Record<string, unknown>) => fetchImpl(`${openrouterUrl}/chat/completions`, {
        method: "POST", headers: { ...upstreamHeaders, "content-type": "application/json" },
        body: JSON.stringify({ ...input, usage: { ...(body.usage && typeof body.usage === "object" ? body.usage : {}), include: true } }),
        redirect: "error", signal: AbortSignal.timeout(10 * 60_000),
      });
      let response = await complete(body);
      if (response.status === 402) {
        const refused = await response.clone().json().catch(() => null) as { error?: { message?: unknown; metadata?: { limit_source?: unknown } } } | null;
        const message = refused?.error?.message;
        const match = typeof message === "string" && message.length < 8192
          ? /^This request requires more credits, or fewer max_tokens\. You requested up to (\d+) tokens, but can only afford (\d+)\./.exec(message) : null;
        const limits = [body.max_completion_tokens, body.max_tokens].filter((value): value is number => typeof value === "number" && Number.isSafeInteger(value) && value > 0);
        const requested = Math.min(Number(match?.[1]), ...limits);
        const affordable = Math.floor(Math.min(Number(match?.[2]), requested) * 0.9);
        const source = refused?.error?.metadata?.limit_source;
        if (match && (source === undefined || source === "openrouter_credits") && Number.isSafeInteger(requested) && affordable >= 256 && affordable < requested) {
          await response.body?.cancel();
          const revised: Record<string, unknown> = { ...body };
          if ("max_tokens" in body || !("max_completion_tokens" in body)) revised.max_tokens = affordable;
          if ("max_completion_tokens" in body) revised.max_completion_tokens = affordable;
          response = await complete(revised);
        }
      }
      const retryAfter = response.headers.get("retry-after");
      if (retryAfter) res.setHeader("retry-after", retryAfter);
      if (response.status === 402) {
        await response.body?.cancel();
        finish(null, false);
        return failure(res, 503, "Delio's AI provider is temporarily unavailable. Your Deliobot credits were not charged. Try again shortly.", "provider_unavailable");
      }
      res.statusCode = response.status;
      res.setHeader("content-type", response.headers.get("content-type") ?? "application/json");
      res.setHeader("cache-control", "no-store");
      const reader = response.body?.getReader();
      const decoder = new TextDecoder();
      let seen = "";
      if (reader) {
        for (;;) {
          const { done: ended, value } = await reader.read();
          if (ended) break;
          res.write(value);
          seen += decoder.decode(value, { stream: true });
          // Only the tail can hold the usage event; the head is already sent.
          if (seen.length > 256 * 1024) seen = seen.slice(-64 * 1024);
        }
      }
      res.end();
      finish(response.ok ? openrouterCost(seen) : null, response.ok);
    } catch {
      finish(null, false);
      if (!res.headersSent) return failure(res, 502, "Could not reach the AI provider.");
      res.destroy();
    }
  }

  function falUrls(workspace: string, owner: string, app: string, requestId: string) {
    const base = new URL(`/api/gateway/${workspace}/fal/${owner}/${app}/requests/${requestId}`, options.publicUrl).href;
    return { response_url: base, status_url: `${base}/status`, cancel_url: `${base}/cancel` };
  }

  async function fal(req: IncomingMessage, res: ServerResponse, workspace: string, rest: string): Promise<void> {
    if (!options.falKey) return failure(res, 503, NOT_CONFIGURED);
    const upstreamHeaders = { authorization: `Key ${options.falKey}`, accept: "application/json" };
    const parts = rest.split("?")[0]!.split("/");
    const requestsAt = parts.indexOf("requests");
    if (requestsAt === 2 && parts.length >= 4) {
      const [owner, app, , requestId, action] = parts;
      if (![owner, app, requestId].every((part) => SEGMENT.test(part ?? ""))) return failure(res, 404, "Not found.");
      const job = wallet.falJob(workspace, requestId!);
      if (!job || job.owner !== owner || job.app !== app) return failure(res, 404, "Not found.");
      const upstream = `${falQueueUrl}/${owner}/${app}/requests/${requestId}${action ? `/${action}` : ""}`;
      const method = action === "cancel" ? "PUT" : "GET";
      if ((action === "cancel" && req.method !== "PUT") || (action !== "cancel" && req.method !== "GET") || (action && !["status", "cancel"].includes(action))) {
        return failure(res, 405, "Method not allowed.");
      }
      const response = await fetchImpl(upstream, { method, headers: upstreamHeaders, redirect: "error", signal: AbortSignal.timeout(30_000) });
      const text = await response.text();
      let parsed: Record<string, unknown> | null = null;
      try { parsed = JSON.parse(text) as Record<string, unknown>; } catch { parsed = null; }
      if (action === "cancel") wallet.settleFalJob(workspace, requestId!, "failed");
      else if (action === "status" && parsed?.status === "COMPLETED") wallet.settleFalJob(workspace, requestId!, typeof parsed.error === "string" && parsed.error ? "failed" : "made");
      else if (!action && response.ok) wallet.settleFalJob(workspace, requestId!, "made");
      if (parsed && action === "status") Object.assign(parsed, { response_url: falUrls(workspace, owner!, app!, requestId!).response_url });
      return send(res, response.status, parsed ?? {});
    }
    if (req.method !== "POST") return failure(res, 405, "Method not allowed.");
    const model = parts.join("/");
    if (!FAL_MODEL.test(model) || parts.includes("..")) return failure(res, 400, "Not a fal.ai model ID.");
    let input: Record<string, unknown>;
    try {
      const parsed: unknown = JSON.parse((await readRaw(req)).toString("utf8"));
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error();
      input = parsed as Record<string, unknown>;
    } catch (error) {
      return failure(res, (error as { status?: number }).status ?? 400, "The request was not valid JSON.");
    }
    const price = await falPrice(model);
    const estimateUsd = price ? price.unitPrice * falUnits(input, price.unit) : FAL_UNKNOWN_HOLD_USD;
    const hold = wallet.hold(workspace, wallet.microFor(estimateUsd));
    if (!hold) return failure(res, 402, OUT_OF_CREDITS, OUT_OF_CREDITS_CODE);
    try {
      const response = await fetchImpl(`${falQueueUrl}/${model}`, {
        method: "POST", headers: { ...upstreamHeaders, "content-type": "application/json" }, body: JSON.stringify(input), redirect: "error", signal: AbortSignal.timeout(30_000),
      });
      const submitted = await response.json().catch(() => null) as { request_id?: unknown; status_url?: unknown } | null;
      const statusPath = typeof submitted?.status_url === "string" ? new URL(submitted.status_url).pathname.split("/").filter(Boolean) : [];
      const requestId = typeof submitted?.request_id === "string" ? submitted.request_id : "";
      const [owner, app] = statusPath;
      if (!response.ok || !owner || !app || !SEGMENT.test(requestId) || !SEGMENT.test(owner) || !SEGMENT.test(app)) {
        wallet.release(hold.id);
        return failure(res, response.ok ? 502 : response.status, `fal.ai refused the request (HTTP ${response.status}).`);
      }
      wallet.recordFalJob({ requestId, workspace, owner, app, model, hold: hold.id, costMicro: hold.amount });
      return send(res, 200, { ...submitted, request_id: requestId, ...falUrls(workspace, owner, app, requestId) });
    } catch {
      wallet.release(hold.id);
      return failure(res, 502, "Could not reach fal.ai.");
    }
  }

  return {
    /** Charges cloud computers' awake minutes; run once a minute. */
    sweep: () => boat.sweep(),
    /** Handles /api/gateway/<workspace>/<provider>/… and /api/workspace/<workspace>/account; false for any other path. */
    async handle(req: IncomingMessage, res: ServerResponse, url: URL): Promise<boolean> {
      const gateway = /^\/api\/gateway\/([a-z][a-z0-9-]{1,30})\/(openrouter\/v1|fal|boat\/v1|anthropic|openai\/v1)\/(.+)$/.exec(url.pathname);
      const account = /^\/api\/workspace\/([a-z][a-z0-9-]{1,30})\/account$/.exec(url.pathname);
      const report = /^\/api\/workspace\/([a-z][a-z0-9-]{1,30})\/report$/.exec(url.pathname);
      const requested = gateway?.[1] ?? account?.[1] ?? report?.[1];
      if (!requested) return false;
      const presented = bearer(req);
      const device = options.deviceAccount?.(presented, requested);
      if (!store.workspace(requested) || !(device || wallet.tokenWorkspace(presented, requested) || options.deviceToken?.(presented, requested))) {
        failure(res, 401, "This workspace token is not valid.");
        return true;
      }
      const workspace = device?.workspace ?? requested;
      if (report) {
        if (req.method !== "POST" || !options.report) { failure(res, 405, "Method not allowed."); return true; }
        let body: Record<string, unknown>;
        try { body = JSON.parse((await readRaw(req)).toString("utf8")) as Record<string, unknown>; } catch { failure(res, 400, "The request was not valid JSON."); return true; }
        const text = (key: string) => typeof body?.[key] === "string" ? body[key] as string : "";
        if (!text("note").trim() && !text("transcript").trim()) { failure(res, 400, "A report needs a note or a conversation."); return true; }
        const kept = options.report({ workspace, email: device?.email ?? options.deviceEmail?.(presented, requested) ?? null, note: text("note"), transcript: text("transcript"),
          bot: text("bot"), appVersion: text("appVersion"), platform: text("platform") });
        if (kept) send(res, 200, { received: true }); else failure(res, 429, "Too many reports today. Write to support instead.");
        return true;
      }
      if (account && req.method === "DELETE") {
        options.revokeDevice?.(presented, device?.sourceWorkspace ?? requested);
        send(res, 200, { revoked: true });
        return true;
      }
      if (account) await options.refreshAccount?.(workspace);
      const allowed = options.allowance?.(workspace) ?? { gateway: true, computers: 1 };
      if (account) {
        send(res, 200, { email: device?.email ?? options.deviceEmail?.(presented, requested) ?? null, workspace, credits: wallet.balance(workspace) / MICRO, usedThisMonth: wallet.usedThisMonth(workspace) / MICRO, creditUsd: wallet.creditUsd, gateway: allowed.gateway,
          plan: allowed.plan ?? null, ownAi: allowed.ownAi ?? false, paymentVersion: options.paymentVersion?.(workspace) });
        return true;
      }
      if (!allowed.gateway) {
        failure(res, 402, allowed.reason ?? OUT_OF_CREDITS, "plan_inactive");
        return true;
      }
      const provider = gateway![2]!;
      const rest = gateway![3]! + url.search;
      try {
        if (provider === "openrouter/v1") await openrouter(req, res, workspace, rest, CONCURRENT_BY_PLAN[allowed.plan ?? ""] ?? CONCURRENT_DEFAULT);
        else if (provider === "fal") await fal(req, res, workspace, rest);
        else if (provider === "boat/v1") await boat.handle(req, res, workspace, rest);
        else failure(res, 501, "Claude and Codex company models are not offered on this deployment yet; use the OpenRouter company models.");
      } catch (error) {
        if (!res.headersSent) failure(res, (error as { status?: number }).status ?? 502, "The gateway could not complete this request.");
      }
      return true;
    },
  };
}
