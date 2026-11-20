// Custom domains for included hosting, through Cloudflare for SaaS: the portal asks Cloudflare for a custom hostname on
// the zone that serves the sites, the person points a CNAME at `target`, and Cloudflare issues the certificate.
// API: https://developers.cloudflare.com/api/resources/custom_hostnames/

export type DomainStatus = "pending" | "active" | "failed";
export interface CustomHostname { id: string; status: DomainStatus; detail: string | null }

export interface SaasHostnames {
  create(hostname: string): Promise<CustomHostname>;
  get(id: string): Promise<CustomHostname | null>;
  remove(id: string): Promise<void>;
}

export interface DomainSettings { saas: SaasHostnames; target: string; ownSuffix: string }

const LABEL = /^(?!-)[a-z0-9-]{1,63}(?<!-)$/;

/** A name a person can point at their app: lowercase, two labels or more, a real top-level name, none of ours. */
export function customHostname(value: unknown, ownSuffix: string): string | null {
  if (typeof value !== "string") return null;
  const name = value.trim().toLowerCase().replace(/\.$/, "");
  if (name.length > 253 || name.startsWith("*.")) return null;
  const labels = name.split(".");
  if (labels.length < 2 || !labels.every((label) => LABEL.test(label)) || !/^[a-z]{2,63}$/.test(labels.at(-1)!)) return null;
  const own = ownSuffix.replace(/^-[^.]*\./, "");
  return name === own || name.endsWith(`.${own}`) ? null : name;
}

function readHostname(raw: unknown): CustomHostname | null {
  const result = raw as { id?: unknown; status?: unknown; ssl?: { status?: unknown; validation_errors?: Array<{ message?: unknown }> }; verification_errors?: unknown[] } | null;
  if (!result || typeof result.id !== "string") return null;
  const ssl = typeof result.ssl?.status === "string" ? result.ssl.status : "";
  const status: DomainStatus = result.status === "active" && ssl === "active" ? "active"
    : /^(blocked|moved|deleted)$/.test(String(result.status)) || /^(expired|deleted|validation_timed_out|issuance_timed_out)$/.test(ssl) ? "failed" : "pending";
  const errors = [...(result.verification_errors ?? []), ...(result.ssl?.validation_errors ?? []).map((one) => one.message)].filter((one): one is string => typeof one === "string");
  return { id: result.id, status, detail: errors.length ? errors.join("; ").slice(0, 300) : null };
}

/** Security: the token only ever goes to Cloudflare's API, and only Cloudflare's own words about the hostname come back. */
/** `fallbackOrigin`: the zone's own host the custom hostnames are served from; set once, before the first hostname. */
export function cloudflareSaas(options: { zoneId: string; token: string; fallbackOrigin?: string; fetch?: typeof fetch }): SaasHostnames {
  const call = options.fetch ?? fetch;
  const base = `https://api.cloudflare.com/client/v4/zones/${encodeURIComponent(options.zoneId)}/custom_hostnames`;
  const request = async (path: string, init: RequestInit = {}) => {
    const response = await call(`${base}${path}`, { ...init, headers: { authorization: `Bearer ${options.token}`, "content-type": "application/json" }, signal: AbortSignal.timeout(20_000) });
    const body = await response.json().catch(() => null) as { success?: boolean; result?: unknown; errors?: Array<{ code?: number; message?: string }> } | null;
    return { status: response.status, ok: response.ok && body?.success === true, result: body?.result, code: body?.errors?.[0]?.code ?? null };
  };
  let origin: Promise<void> | null = null;
  const ensureOrigin = () => origin ??= (async () => {
    if (!options.fallbackOrigin) return;
    const current = await request("/fallback_origin");
    const set = (current.result as { origin?: unknown } | undefined)?.origin;
    if (current.ok && set === options.fallbackOrigin) return;
    const answer = await request("/fallback_origin", { method: "PUT", body: JSON.stringify({ origin: options.fallbackOrigin }) });
    if (!answer.ok) origin = null;
  })();
  return {
    async create(hostname) {
      await ensureOrigin();
      const answer = await request("", { method: "POST", body: JSON.stringify({ hostname, ssl: { method: "http", type: "dv" } }) });
      const read = answer.ok ? readHostname(answer.result) : null;
      if (!read) throw Object.assign(new Error("custom hostname refused"), { code: answer.code === 1406 ? "domain_taken" : "domain_failed" });
      return read;
    },
    async get(id) {
      const answer = await request(`/${encodeURIComponent(id)}`);
      return answer.ok ? readHostname(answer.result) : null;
    },
    async remove(id) {
      const answer = await request(`/${encodeURIComponent(id)}`, { method: "DELETE" });
      if (!answer.ok && answer.status !== 404) throw new Error("custom hostname not removed");
    },
  };
}
