// SasPay (https://docs.saspay.me), the payment layer: a hosted checkout page per payment (mobile money and cards),
// its status endpoint, and signed webhooks. Only the routes and fields in its OpenAPI reference are used.
import { createHmac, timingSafeEqual } from "node:crypto";

export const SASPAY_API = "https://api.saspay.me/api/v1";
/** SasPay's webhook guide: reject a delivery whose timestamp is more than five minutes off. */
const WEBHOOK_TOLERANCE_S = 300;

export interface CheckoutSession { id: string; checkoutUrl: string }
export type SessionStatus = "PENDING" | "PAID" | "FAILED" | "CANCELLED" | "EXPIRED" | string;

export interface SasPayOptions { key: string; apiUrl?: string; fetchImpl?: typeof fetch }

/** SasPay answers either inside `{ success, data }` or with the object itself. */
function unwrap(body: unknown): Record<string, unknown> | null {
  if (!body || typeof body !== "object") return null;
  const data = (body as { data?: unknown }).data;
  return data && typeof data === "object" && !Array.isArray(data) ? data as Record<string, unknown> : body as Record<string, unknown>;
}

export function createSasPay(options: SasPayOptions) {
  const fetchImpl = options.fetchImpl ?? fetch;
  const api = (options.apiUrl ?? SASPAY_API).replace(/\/+$/, "");
  const call = async (path: string, init: RequestInit = {}) => {
    const response = await fetchImpl(`${api}${path}`, {
      ...init, redirect: "error", signal: AbortSignal.timeout(20_000),
      headers: { authorization: `Bearer ${options.key}`, accept: "application/json", ...(init.body ? { "content-type": "application/json" } : {}) },
    });
    const body = unwrap(await response.json().catch(() => null));
    // Errors carry SasPay's own message and code, never the key.
    if (!response.ok || !body) throw Object.assign(new Error(`SasPay answered ${response.status}${typeof body?.code === "string" ? ` (${body.code})` : ""}`), { status: 502 });
    return body;
  };
  return {
    async createCheckout(input: { amount: string; currency: string; description: string; email: string; name: string; returnUrl: string; metadata: Record<string, string> }): Promise<CheckoutSession> {
      const body = await call("/checkout-sessions/", { method: "POST", body: JSON.stringify({
        amount: input.amount, currency: input.currency, description: input.description, customer_email: input.email, customer_name: input.name,
        return_url: input.returnUrl, metadata: input.metadata,
      }) });
      if (typeof body.id !== "string" || typeof body.checkout_url !== "string" || !body.checkout_url.startsWith("https://")) {
        throw Object.assign(new Error("SasPay did not return a checkout page"), { status: 502 });
      }
      return { id: body.id, checkoutUrl: body.checkout_url };
    },
    async sessionStatus(id: string): Promise<SessionStatus> {
      const body = await call(`/checkout-sessions/${encodeURIComponent(id)}/status/`);
      return typeof body.status === "string" ? body.status : "PENDING";
    },
  };
}

export type SasPay = ReturnType<typeof createSasPay>;

/** The webhook guide's check: HMAC-SHA256 of "<timestamp>.<raw body>", hex, compared in constant time, timestamp within five minutes. */
export function verifySasPayWebhook(raw: Buffer, headers: { signature?: string; timestamp?: string }, secret: string, nowMs = Date.now()): boolean {
  const timestamp = Number(headers.timestamp);
  if (!secret || !headers.signature || !Number.isFinite(timestamp) || Math.abs(nowMs / 1000 - timestamp) > WEBHOOK_TOLERANCE_S) return false;
  const expected = createHmac("sha256", secret).update(`${headers.timestamp}.`).update(raw).digest("hex");
  const given = Buffer.from(headers.signature.trim().toLowerCase());
  const wanted = Buffer.from(expected);
  return given.length === wanted.length && timingSafeEqual(given, wanted);
}
