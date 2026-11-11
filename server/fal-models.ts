import { FAL_API_URL, validFalModel } from "./fal.ts";

export type FalMediaKind = "image" | "video";

export interface FalModel {
  id: string;
  name: string;
  group: "recommended" | "more";
}

export interface FalModelList {
  source: "fal" | "builtin";
  models: FalModel[];
}

const CATEGORY: Record<FalMediaKind, string> = { image: "text-to-image", video: "text-to-video" };
const FETCH_TIMEOUT_MS = 4_000;
const OK_TTL_MS = 60 * 60_000;
const FAILED_TTL_MS = 60_000;
const MORE_MAX = 100;

type Curated = ReadonlyArray<{ id: string; name: string }>;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

/** Active endpoints of one category from a `GET /v1/models` page, by ID, with their display names. */
export function falModelsFromPage(body: unknown, category: string): Map<string, string> | null {
  if (!isRecord(body) || !Array.isArray(body.models)) return null;
  const found = new Map<string, string>();
  for (const entry of body.models) {
    if (!isRecord(entry) || typeof entry.endpoint_id !== "string" || !validFalModel(entry.endpoint_id)) continue;
    const metadata = isRecord(entry.metadata) ? entry.metadata : {};
    if (metadata.category !== category || (metadata.status !== undefined && metadata.status !== "active") || entry.retires_at) continue;
    const name = typeof metadata.display_name === "string" && metadata.display_name.trim() ? metadata.display_name.trim().slice(0, 120) : entry.endpoint_id;
    found.set(entry.endpoint_id, name);
  }
  return found;
}

/** The recommended models first (kept even when this page did not list them), then the rest by name. */
export function mergeFalModels(found: Map<string, string>, curated: Curated): FalModelList {
  const ids = new Set(curated.map((model) => model.id));
  const more = [...found].filter(([id]) => !ids.has(id))
    .map(([id, name]) => ({ id, name, group: "more" as const }))
    .sort((a, b) => a.name.localeCompare(b.name))
    .slice(0, MORE_MAX);
  return {
    source: found.size ? "fal" : "builtin",
    models: [...curated.map((model) => ({ id: model.id, name: found.get(model.id) ?? model.name, group: "recommended" as const })), ...more],
  };
}

/** Cached an hour after an answer, a minute after a failure. Never throws, and never sends a key: the catalog is public. */
export function createFalModelCatalog(deps: { fetch?: typeof fetch; now?: () => number; curated: Record<FalMediaKind, Curated> }) {
  const fetchImpl = deps.fetch ?? fetch;
  const now = deps.now ?? Date.now;
  const cache = new Map<FalMediaKind, { until: number; list: FalModelList }>();
  return {
    async load(kind: FalMediaKind): Promise<FalModelList> {
      const cached = cache.get(kind);
      if (cached && cached.until > now()) return cached.list;
      let found: Map<string, string> | null = null;
      try {
        const url = `${FAL_API_URL}/models?${new URLSearchParams({ category: CATEGORY[kind], limit: "100", sort: "relevant" })}`;
        const response = await fetchImpl(url, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS), redirect: "error" });
        if (response.ok) found = falModelsFromPage(await response.json(), CATEGORY[kind]);
        else await response.body?.cancel().catch(() => undefined);
      } catch {
        found = null;
      }
      const list = mergeFalModels(found ?? new Map(), deps.curated[kind]);
      cache.set(kind, { until: now() + (list.source === "fal" ? OK_TTL_MS : FAILED_TTL_MS), list });
      return list;
    },
  };
}

export type FalModelCatalog = ReturnType<typeof createFalModelCatalog>;
