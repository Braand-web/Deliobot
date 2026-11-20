import { describe, expect, it } from "vitest";

import { cloudflareSaas } from "./app-domains.ts";

function fakeCloudflare(origin: string | null) {
  const calls: Array<{ method: string; path: string; body?: unknown }> = [];
  let current = origin;
  const fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    const path = url.pathname.replace("/client/v4/zones/zone-1/custom_hostnames", "");
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ method: init?.method ?? "GET", path, body });
    if (path === "/fallback_origin" && (init?.method ?? "GET") === "GET") return Response.json({ success: true, result: current ? { origin: current, status: "active" } : {} });
    if (path === "/fallback_origin") { current = body.origin; return Response.json({ success: true, result: { origin: current, status: "pending_deployment" } }); }
    return Response.json({ success: true, result: { id: `h-${calls.length}`, status: "pending", ssl: { status: "pending_validation" } } });
  }) as typeof globalThis.fetch;
  return { fetch, calls };
}

describe("custom domains through Cloudflare for SaaS", () => {
  it("sets the fallback origin once, before the first hostname", async () => {
    const cloudflare = fakeCloudflare(null);
    const saas = cloudflareSaas({ zoneId: "zone-1", token: "t", fallbackOrigin: "domains.deliobot.fun", fetch: cloudflare.fetch });
    await saas.create("boutique-awa.com");
    await saas.create("atelier.example");
    expect(cloudflare.calls.map((call) => `${call.method} ${call.path}`)).toEqual(["GET /fallback_origin", "PUT /fallback_origin", "POST ", "POST "]);
    expect(cloudflare.calls[1]!.body).toEqual({ origin: "domains.deliobot.fun" });
  });

  it("leaves a fallback origin that is already right alone", async () => {
    const cloudflare = fakeCloudflare("domains.deliobot.fun");
    await cloudflareSaas({ zoneId: "zone-1", token: "t", fallbackOrigin: "domains.deliobot.fun", fetch: cloudflare.fetch }).create("shop.example");
    expect(cloudflare.calls.map((call) => call.method)).toEqual(["GET", "POST"]);
  });
});
