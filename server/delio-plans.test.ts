import { describe, expect, it } from "vitest";

import { delioCheckoutUrl } from "../shared/delio-plans.ts";
import { createDelioPlans, delioBillingTarget } from "./delio-plans.ts";

const TOKEN = `odb_device_${"a".repeat(43)}`;
const PLAN = { id: "pro", name: "Pro", usd: 49, usdYear: 539, francs: 29400, francsYear: 323400, credits: 5500, computerHours: 90, computers: 2, gateway: true, listed: true };

function portal(body: unknown) {
  const calls: string[] = [];
  const fetchImpl = (async (input: string | URL | Request) => {
    calls.push(String(input));
    return Response.json(body);
  }) as typeof fetch;
  return { calls, fetchImpl };
}

describe("Delio's plans in the app", () => {
  it("asks the portal the app is connected to, and sends the admin to that workspace's Billing page", async () => {
    const upstream = portal({ trialDays: 3, recommended: "pro", plans: [PLAN, { id: "BAD id", name: "x" }, { ...PLAN, id: "max", name: "<b>Max</b>" }], topups: [{ id: "small", credits: 4500, usd: 20, francs: 12000 }] });
    const config = { delio: { portal: "https://admin.deliobot.test/", workspace: "studio", token: TOKEN } };
    const plans = createDelioPlans({ config: () => config, env: {}, fetchImpl: upstream.fetchImpl });
    const catalog = await plans.load();
    expect(upstream.calls).toEqual(["https://admin.deliobot.test/api/public/plans"]);
    expect(catalog?.plans.map((plan) => plan.id), "malformed entries and markup in names are dropped").toEqual(["pro"]);
    expect(catalog?.billingUrl).toBe("https://admin.deliobot.test/billing?workspace=studio");
    expect(delioCheckoutUrl(catalog!.billingUrl, { plan: "pro", cycle: "year" })).toBe("https://admin.deliobot.test/billing?workspace=studio&plan=pro&cycle=year");
    await plans.load();
    expect(upstream.calls, "kept for a few minutes").toHaveLength(1);
  });

  it("without an account, falls back to the operator's portal or Delio's own, never to a plain-HTTP remote address", () => {
    expect(delioBillingTarget({}, { ODB_DELIO_ADMIN_URL: "http://127.0.0.1:8790" })).toEqual({ portal: "http://127.0.0.1:8790", workspace: null });
    expect(delioBillingTarget({}, { ODB_DELIO_ADMIN_URL: "http://evil.example" })).toEqual({ portal: "https://admin.deliobot.fun", workspace: null });
  });

  it("has nothing to show when the portal answers with no plan", async () => {
    const plans = createDelioPlans({ config: () => ({}), env: {}, fetchImpl: portal({ plans: [] }).fetchImpl });
    expect(await plans.load()).toBeNull();
  });
});
