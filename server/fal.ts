// fal.ai's queue API (https://fal.ai/docs/model-apis/model-endpoints/queue): submit to queue.fal.run, poll the status URL the
// submit answer names, then read the result. Each model publishes its own input schema, so inputs are built from it.
import type { ReadableStreamReadResult } from "node:stream/web";

export const FAL_QUEUE_URL = "https://queue.fal.run";
export const FAL_API_URL = "https://api.fal.ai/v1";
const RESULT_MAX_BYTES = 2 * 1024 * 1024;
const SCHEMA_TTL_MS = 24 * 60 * 60_000;
const MODEL_ID = /^[A-Za-z0-9][A-Za-z0-9._-]*(\/[A-Za-z0-9][A-Za-z0-9._-]*){1,5}$/;
/** Refused before any work: bad key, no credit, rate limited. */
const NOT_STARTED = new Set([401, 402, 403, 429]);

export type FalError = Error & { status: number; neverStarted: boolean };

export function falError(message: string, status: number, neverStarted = false): FalError {
  return Object.assign(new Error(message), { status, neverStarted });
}

export function validFalModel(model: string): boolean {
  return model.length <= 200 && MODEL_ID.test(model) && !model.split("/").includes("..");
}

export interface FalCallOptions {
  key: string;
  fetchImpl?: typeof fetch;
  /** The queue origin; a hosted workspace points it at its portal gateway. */
  baseUrl?: string;
  timeoutMs: number;
  signal?: AbortSignal;
  pollMs?: number;
}

async function boundedJson(response: Response, maxBytes: number, what: string): Promise<unknown> {
  const reader = response.body?.getReader();
  if (!reader) return null;
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value }: ReadableStreamReadResult<Uint8Array> = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        await reader.cancel().catch(() => undefined);
        throw falError(`${what} exceeded the response limit`, 502);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw falError(`${what} was not valid JSON`, 502);
  }
}

const record = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;

/** Security: the key only ever goes to the configured queue origin, even when a submit answer names other URLs. */
function queueUrl(raw: unknown, origin: string): string {
  if (typeof raw !== "string") throw falError("fal.ai answered without a status URL", 502);
  let url: URL;
  try { url = new URL(raw); } catch { throw falError("fal.ai answered with an invalid status URL", 502); }
  if (url.origin !== origin) throw falError("fal.ai answered with a status URL on another host", 502);
  return url.href;
}

/** Runs one request through the queue and returns the model's result object. */
export async function falRun(model: string, input: Record<string, unknown>, options: FalCallOptions): Promise<Record<string, unknown>> {
  if (!validFalModel(model)) throw falError(`"${model}" is not a fal.ai model ID`, 400, true);
  const fetchImpl = options.fetchImpl ?? fetch;
  const base = new URL(options.baseUrl ?? FAL_QUEUE_URL);
  const prefix = base.href.replace(/\/+$/, "");
  const timeout = AbortSignal.timeout(options.timeoutMs);
  const signal = options.signal ? AbortSignal.any([timeout, options.signal]) : timeout;
  const headers = { authorization: `Key ${options.key}`, accept: "application/json" };
  const failed = (error: unknown): never => {
    if (options.signal?.aborted && !timeout.aborted) throw falError("Generation was cancelled", 409);
    if (timeout.aborted) throw falError("fal.ai generation timed out", 502);
    if ((error as Partial<FalError>)?.status) throw error;
    throw falError("Could not reach fal.ai", 502, true);
  };

  let submitted: Record<string, unknown> | null;
  try {
    const response = await fetchImpl(`${prefix}/${model}`, {
      method: "POST", headers: { ...headers, "content-type": "application/json" }, body: JSON.stringify(input), redirect: "error", signal,
    });
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      // The body can echo the request: report the status only.
      throw falError(`fal.ai refused the request (HTTP ${response.status}, model ${model})`, response.status === 401 ? 401 : 502, NOT_STARTED.has(response.status));
    }
    submitted = record(await boundedJson(response, RESULT_MAX_BYTES, "fal.ai's answer"));
  } catch (error) {
    return failed(error);
  }
  const statusUrl = queueUrl(submitted?.status_url, base.origin);
  const resultUrl = queueUrl(submitted?.response_url, base.origin);
  const cancelUrl = typeof submitted?.cancel_url === "string" ? submitted.cancel_url : null;

  let wait = options.pollMs ?? 1000;
  try {
    for (;;) {
      await new Promise((resolve, reject) => {
        const timer = setTimeout(resolve, wait);
        signal.addEventListener("abort", () => { clearTimeout(timer); reject(signal.reason); }, { once: true });
      });
      wait = Math.min(wait * 1.5, 4000);
      const response = await fetchImpl(statusUrl, { headers, redirect: "error", signal });
      if (!response.ok && response.status !== 202) {
        await response.body?.cancel().catch(() => undefined);
        throw falError(`fal.ai status check failed (HTTP ${response.status})`, 502);
      }
      const status = record(await boundedJson(response, RESULT_MAX_BYTES, "fal.ai's status"));
      if (status?.status !== "COMPLETED") continue;
      if (typeof status.error === "string" && status.error) throw falError(`fal.ai could not make it: ${status.error.slice(0, 300)}`, 502);
      break;
    }
    const response = await fetchImpl(resultUrl, { headers, redirect: "error", signal });
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      throw falError(`fal.ai could not make it (HTTP ${response.status}, model ${model})`, 502);
    }
    const result = record(await boundedJson(response, RESULT_MAX_BYTES, "fal.ai's result"));
    if (!result) throw falError("fal.ai returned an empty result", 502);
    return result;
  } catch (error) {
    if (cancelUrl && signal.aborted) {
      void fetchImpl(queueUrl(cancelUrl, base.origin), { method: "PUT", headers, redirect: "error", signal: AbortSignal.timeout(5000) }).catch(() => undefined);
    }
    return failed(error);
  }
}

/** Security: a result names files to download; only HTTPS files on fal's own media hosts are fetched, without the key. */
export function falMediaHostAllowed(raw: string): boolean {
  try {
    const url = new URL(raw);
    const host = url.hostname.toLowerCase();
    return url.protocol === "https:" && !url.username && !url.password && (host === "fal.media" || host.endsWith(".fal.media"));
  } catch {
    return false;
  }
}

export async function falDownload(
  raw: string,
  options: { maxBytes: number; mimes: readonly string[]; fetchImpl?: typeof fetch; timeoutMs: number; signal?: AbortSignal },
): Promise<{ bytes: Buffer; mime: string }> {
  if (!falMediaHostAllowed(raw)) throw falError("fal.ai returned a file outside its media hosts", 502);
  const timeout = AbortSignal.timeout(options.timeoutMs);
  const signal = options.signal ? AbortSignal.any([timeout, options.signal]) : timeout;
  let response: Response;
  try {
    response = await (options.fetchImpl ?? fetch)(raw, { redirect: "error", signal });
  } catch {
    throw falError(timeout.aborted ? "Downloading the file from fal.ai timed out" : "Could not download the file from fal.ai", 502);
  }
  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined);
    throw falError(`Could not download the file from fal.ai (HTTP ${response.status})`, 502);
  }
  const mime = response.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() ?? "";
  if (!options.mimes.includes(mime)) {
    await response.body?.cancel().catch(() => undefined);
    throw falError(`fal.ai returned an unsupported file type (${mime || "unknown"})`, 502);
  }
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > options.maxBytes) {
    await response.body?.cancel().catch(() => undefined);
    throw falError("The file from fal.ai is too large", 502);
  }
  const reader = response.body?.getReader();
  if (!reader) throw falError("fal.ai returned an empty file", 502);
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value }: ReadableStreamReadResult<Uint8Array> = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > options.maxBytes) {
        await reader.cancel().catch(() => undefined);
        throw falError("The file from fal.ai is too large", 502);
      }
      chunks.push(value);
    }
  } catch (error) {
    if ((error as Partial<FalError>).status) throw error;
    throw falError(timeout.aborted ? "Downloading the file from fal.ai timed out" : "Could not download the file from fal.ai", 502);
  } finally {
    reader.releaseLock();
  }
  if (size === 0) throw falError("fal.ai returned an empty file", 502);
  return { bytes: Buffer.concat(chunks), mime };
}

/** One input field of a model, as its OpenAPI schema describes it: only what the request builder needs. */
export interface FalField { type?: string; values?: readonly string[] }
export type FalInputSchema = Record<string, FalField>;

function resolveRef(schemas: Record<string, unknown>, node: unknown): Record<string, unknown> | null {
  const value = record(node);
  if (!value) return null;
  const ref = typeof value.$ref === "string" ? value.$ref : null;
  return ref ? record(schemas[ref.split("/").pop() ?? ""]) : value;
}

/** Reads the request fields of a model's OpenAPI document, collapsing `anyOf` into one type and its enum values. */
export function falInputFields(openapi: unknown, model: string): FalInputSchema | null {
  const doc = record(openapi);
  const schemas = record(record(doc?.components)?.schemas) ?? {};
  const post = record(record(record(doc?.paths)?.[`/${model}`])?.post);
  const body = record(record(record(record(post?.requestBody)?.content)?.["application/json"])?.schema);
  const input = resolveRef(schemas, body) ?? Object.entries(schemas).find(([name]) => name.endsWith("Input"))?.[1];
  const properties = record(record(input)?.properties);
  if (!properties) return null;
  const fields: FalInputSchema = {};
  for (const [name, raw] of Object.entries(properties)) {
    const variants = [raw, ...(Array.isArray(record(raw)?.anyOf) ? record(raw)!.anyOf as unknown[] : [])]
      .map((node) => resolveRef(schemas, node)).filter((node): node is Record<string, unknown> => node !== null);
    const values = variants.flatMap((node) => Array.isArray(node.enum) ? node.enum.filter((item): item is string => typeof item === "string") : []);
    const type = variants.map((node) => node.type).find((item): item is string => typeof item === "string" && item !== "null");
    fields[name] = { ...(type ? { type } : {}), ...(values.length ? { values } : {}) };
  }
  return fields;
}

export function createFalSchemaCache(options: { now?: () => number } = {}) {
  const cache = new Map<string, { at: number; fields: FalInputSchema | null }>();
  const now = options.now ?? Date.now;
  return async function fields(model: string, call: { key?: string; fetchImpl?: typeof fetch } = {}): Promise<FalInputSchema | null> {
    const key = call.key;
    const hit = cache.get(model);
    if (hit && now() - hit.at < SCHEMA_TTL_MS) return hit.fields;
    let found: FalInputSchema | null = null;
    try {
      const url = `${FAL_API_URL}/models?${new URLSearchParams({ endpoint_id: model, expand: "openapi-3.0" })}`;
      const response = await (call.fetchImpl ?? fetch)(url, {
        headers: { accept: "application/json", ...(key ? { authorization: `Key ${key}` } : {}) }, redirect: "error", signal: AbortSignal.timeout(10_000),
      });
      if (response.ok) {
        const models = record(await boundedJson(response, 4 * 1024 * 1024, "fal.ai's model schema"))?.models;
        const entry = Array.isArray(models) ? record(models[0]) : null;
        found = falInputFields(entry?.openapi, model);
      } else {
        await response.body?.cancel().catch(() => undefined);
      }
    } catch {
      found = null;
    }
    // A failed lookup is retried after a minute, not a day.
    cache.set(model, { at: found ? now() : now() - SCHEMA_TTL_MS + 60_000, fields: found });
    return found;
  };
}

const IMAGE_SIZES: Record<string, string> = { "1:1": "square_hd", "16:9": "landscape_16_9", "9:16": "portrait_16_9" };

/** The closest allowed duration to the one asked for: fal models spell it "5", "8s" or as a number. */
function durationValue(field: FalField, seconds: number): string | number | undefined {
  if (field.values?.length) {
    const scored = field.values.map((value) => ({ value, n: Number.parseFloat(value) })).filter((item) => Number.isFinite(item.n));
    scored.sort((a, b) => Math.abs(a.n - seconds) - Math.abs(b.n - seconds) || a.n - b.n);
    return scored[0]?.value;
  }
  if (field.type === "integer" || field.type === "number") return seconds;
  if (field.type === "string") return String(seconds);
  return undefined;
}

export interface FalMediaRequest { prompt: string; aspect?: string; seconds?: number; imageUrl?: string; lyrics?: string }

/** The request a model's own schema accepts; without a schema, only fields every fal media model takes. */
export function falInput(fields: FalInputSchema | null, request: FalMediaRequest): Record<string, unknown> {
  const input: Record<string, unknown> = { prompt: request.prompt };
  if (!fields) {
    if (request.aspect) input.aspect_ratio = request.aspect;
    if (request.imageUrl) input.image_url = request.imageUrl;
    return input;
  }
  const allows = (name: string, value: string) => !fields[name]?.values || fields[name]!.values!.includes(value);
  if (request.aspect) {
    if (fields.aspect_ratio && allows("aspect_ratio", request.aspect)) input.aspect_ratio = request.aspect;
    else if (fields.image_size && IMAGE_SIZES[request.aspect] && allows("image_size", IMAGE_SIZES[request.aspect]!)) input.image_size = IMAGE_SIZES[request.aspect];
  }
  if (request.seconds !== undefined) {
    // Audio models name their length differently: seconds, seconds_total, or milliseconds.
    const field = fields.duration ? "duration" : fields.seconds_total ? "seconds_total" : fields.duration_seconds ? "duration_seconds" : null;
    const value = field ? durationValue(fields[field]!, request.seconds) : undefined;
    if (field && value !== undefined) input[field] = value;
    else if (fields.music_length_ms) input.music_length_ms = request.seconds * 1000;
  }
  if (request.lyrics) {
    if (fields.lyrics) input.lyrics = request.lyrics;
    else if (fields.lyrics_prompt) input.lyrics_prompt = request.lyrics;
  }
  if (fields.num_images) input.num_images = 1;
  if (request.imageUrl && fields.image_url) input.image_url = request.imageUrl;
  return input;
}

export interface FalPrice { unitPrice: number; unit: string }

/** fal.ai's list price for one output; `GET /v1/models/pricing` needs a key. Cached a day, a failed lookup a minute. */
export function createFalPriceBook(options: { now?: () => number } = {}) {
  const now = options.now ?? Date.now;
  const cache = new Map<string, { at: number; price: FalPrice | null }>();
  return async function price(model: string, call: { key: string; fetchImpl?: typeof fetch }): Promise<FalPrice | null> {
    const hit = cache.get(model);
    if (hit && now() - hit.at < SCHEMA_TTL_MS) return hit.price;
    let found: FalPrice | null = null;
    try {
      const response = await (call.fetchImpl ?? fetch)(`${FAL_API_URL}/models/pricing?${new URLSearchParams({ endpoint_id: model })}`, {
        headers: { accept: "application/json", authorization: `Key ${call.key}` }, redirect: "error", signal: AbortSignal.timeout(10_000),
      });
      if (response.ok) {
        const prices = record(await boundedJson(response, 256 * 1024, "fal.ai's price list"))?.prices;
        const entry = Array.isArray(prices) ? prices.map(record).find((item) => item?.endpoint_id === model) : null;
        if (entry && typeof entry.unit_price === "number" && entry.unit_price >= 0 && typeof entry.unit === "string" && entry.currency === "USD") {
          found = { unitPrice: entry.unit_price, unit: entry.unit.toLowerCase() };
        }
      } else {
        await response.body?.cancel().catch(() => undefined);
      }
    } catch {
      found = null;
    }
    cache.set(model, { at: found ? now() : now() - SCHEMA_TTL_MS + 60_000, price: found });
    return found;
  };
}

/** The list price of what was made: per second for a video billed by the second, otherwise per output. */
export function falCostUsd(price: FalPrice | null, made: { seconds?: number }): number | null {
  if (!price) return null;
  const perSecond = /second/.test(price.unit);
  if (perSecond && made.seconds === undefined) return null;
  return Math.round(price.unitPrice * (perSecond ? made.seconds! : 1) * 1e6) / 1e6;
}
