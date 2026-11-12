// The operator's check of every provider key the portal holds: one small call to each provider, answered with the
// status and the provider's own error words. Security: it answers only the DIAG_TOKEN secret, and never returns a key.
const PROBE_TIMEOUT_MS = 15_000;

type Probe = { set: boolean; status?: number; ok?: boolean; detail?: unknown; error?: string };

function shape(key: string | undefined): string {
  if (!key) return "absent";
  const kind = /^(sk_live|sk_test|pk_live|pk_test|sk-or-v1|re_|whsec)/.exec(key)?.[1];
  return `${kind ?? "other"}, ${key.length} characters${/\s/.test(key) ? ", contains spaces" : ""}`;
}

async function probe(key: string | undefined, url: string, init: RequestInit, keep: (body: unknown) => unknown): Promise<Probe> {
  if (!key) return { set: false };
  try {
    const response = await fetch(url, { ...init, redirect: "manual", signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) });
    const text = await response.text();
    let body: unknown = text.slice(0, 600);
    try { body = JSON.parse(text); } catch { /* the provider answered plain text */ }
    return { set: true, status: response.status, ok: response.ok, detail: keep(body) };
  } catch (error) {
    return { set: true, error: error instanceof Error ? `${error.name}: ${error.message}` : String(error) };
  }
}

/** Only fields a provider documents as non-secret account facts or error words. */
function pick(body: unknown, fields: string[]): unknown {
  if (!body || typeof body !== "object") return body;
  const source = body as Record<string, unknown>;
  const data = source.data && typeof source.data === "object" && !Array.isArray(source.data) ? source.data as Record<string, unknown> : source;
  return Object.fromEntries(fields.flatMap((field) => field in data ? [[field, data[field]]] : field in source ? [[field, source[field]]] : []));
}

export async function diagnose(settings: Record<string, string>, publicUrl: string, latest?: { session_id: string; checkout_url: string }): Promise<Record<string, unknown>> {
  const saspayKey = settings.DELIO_ADMIN_SASPAY_KEY, openrouterKey = settings.DELIO_ADMIN_OPENROUTER_KEY;
  const falKey = settings.DELIO_ADMIN_FAL_KEY, boatKey = settings.DELIO_ADMIN_BOAT_KEY, mailKey = settings.DELIO_ADMIN_MAIL_API_KEY;
  const errorFields = ["error", "message", "detail", "code", "errors", "status"];
  const [saspay, openrouter, fal, boat, resend] = await Promise.all([
    probe(saspayKey, "https://api.saspay.me/api/v1/checkout-sessions/", {
      method: "POST", headers: { authorization: `Bearer ${saspayKey}`, accept: "application/json", "content-type": "application/json" },
      body: JSON.stringify({ amount: "500", currency: settings.DELIO_ADMIN_CURRENCY || "XOF", description: "Delio diagnostic (not a sale)",
        customer_email: "support@deliobot.fun", customer_name: "Delio diagnostic", return_url: `${publicUrl}/billing`, metadata: { diagnostic: "1" } }),
    }, (body) => pick(body, ["id", "checkout_url", ...errorFields])),
    probe(openrouterKey, "https://openrouter.ai/api/v1/key", { headers: { authorization: `Bearer ${openrouterKey}` } },
      (body) => pick(body, ["label", "limit", "limit_remaining", "usage", "is_free_tier", ...errorFields])),
    probe(falKey, "https://api.fal.ai/v1/models/pricing?endpoint_id=fal-ai/flux/schnell", { headers: { authorization: `Key ${falKey}`, accept: "application/json" } },
      (body) => pick(body, ["prices", ...errorFields])),
    probe(boatKey, "https://boat.dev/api/v1/sandboxes?limit=1", { headers: { authorization: `Bearer ${boatKey}`, accept: "application/json" } },
      (body) => Array.isArray(body) ? { sandboxes: body.length } : pick(body, ["total", ...errorFields])),
    probe(mailKey, "https://api.resend.com/domains", { headers: { authorization: `Bearer ${mailKey}` } },
      (body) => Array.isArray((body as { data?: unknown })?.data)
        ? (body as { data: Array<{ name?: string; status?: string }> }).data.map((domain) => ({ name: domain.name, status: domain.status }))
        : pick(body, errorFields)),
  ]);
  const latestSession = latest && saspayKey ? await probe(saspayKey, `https://api.saspay.me/api/v1/checkout-sessions/${encodeURIComponent(latest.session_id)}/`,
    { headers: { authorization: `Bearer ${saspayKey}`, accept: "application/json" } }, (body) => body) : null;
  const checkoutPage = latest ? await probe("page", latest.checkout_url, { headers: { accept: "text/html" } },
    (body) => ({ scripts: [...String(body).matchAll(/<script[^>]+src="([^"]+)"/g)].map((m) => m[1]).slice(0, 8),
      apis: [...new Set([...String(body).matchAll(/https?:\/\/[a-z0-9.-]*saspay[a-z0-9./_-]*/gi)].map((m) => m[0]))].slice(0, 20),
      text: String(body).replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/g, " ").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").slice(0, 800) })) : null;
  return {
    latestSession, checkoutPage,
    keys: Object.fromEntries(["DELIO_ADMIN_SASPAY_KEY", "DELIO_ADMIN_SASPAY_WEBHOOK_SECRET", "DELIO_ADMIN_OPENROUTER_KEY", "DELIO_ADMIN_FAL_KEY",
      "DELIO_ADMIN_BOAT_KEY", "DELIO_ADMIN_MAIL_API_KEY"].map((name) => [name, shape(settings[name])])),
    mailFrom: settings.DELIO_ADMIN_MAIL_FROM ?? null, currency: settings.DELIO_ADMIN_CURRENCY ?? null,
    saspay, openrouter, fal, boat, resend,
  };
}

function sameText(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** Whether this request carries the DIAG_TOKEN secret (32 characters or more) as a Bearer token. */
export function diagnosticsAllowed(request: Request, token: unknown): boolean {
  if (typeof token !== "string" || token.length < 32) return false;
  const presented = /^Bearer (\S+)$/.exec(request.headers.get("authorization") ?? "")?.[1] ?? "";
  return sameText(presented, token);
}
