// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ConfigStatus } from "@/state/store";
import { budgetTone, entitledTo, UsageBudgetCards, DelioCreditsCard, type BudgetState } from "./UsageBudget";

const fixture = vi.hoisted(() => ({ config: null as ConfigStatus | null, dispatch: vi.fn() }));
vi.mock("@/state/store", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/state/store")>(),
  useStore: () => ({ state: { config: fixture.config }, dispatch: fixture.dispatch }),
}));
afterEach(() => vi.unstubAllGlobals());

function config(features: string[], extra: Partial<ConfigStatus> = {}): ConfigStatus {
  return {
    composio: { configured: false }, box: { configured: false }, vps: { configured: false, sshAlias: "" },
    rooms: { turnTimeoutMinutes: 30 }, localVm: { mode: "shared", maxInstances: 1 },
    edition: { edition: features.length ? "enterprise" : "oss", features },
    ...extra,
  } as ConfigStatus;
}

const budget: BudgetState = { month: "2026-09", monthlyUsd: 50, spentUsd: 42.5, percent: 85, warnAtPercent: 80, warn: true, exceeded: false };

describe("usage budget and prices cards", () => {
  it("opens top-ups in the app rather than navigating to the old billing page", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    try {
      await act(async () => root.render(createElement(DelioCreditsCard, { credits: { credits: 30, usedThisMonth: 10, billingUrl: "https://compte.example.test/billing?workspace=fixture" } })));
      expect(host.querySelector('a[target="_blank"]')).toBeNull();
      await act(async () => host.querySelector("button")!.click());
      expect(fixture.dispatch).toHaveBeenCalledWith({ type: "openCloudAdd", source: "app_settings" });
    } finally { await act(async () => root.unmount()); host.remove(); }
  });

  it("render nothing at all on the open-source edition", () => {
    fixture.config = config([]);
    expect(renderToStaticMarkup(createElement(UsageBudgetCards, { budget }))).toBe("");
    expect(entitledTo(fixture.config, "budgets")).toBe(false);
  });

  it("show the cap, its warning state, and the price list only with their entitlements", () => {
    fixture.config = config(["budgets"], { budgets: { monthlyUsd: 50, warnAtPercent: 80 } });
    const budgetsOnly = renderToStaticMarkup(createElement(UsageBudgetCards, { budget }));
    expect(budgetsOnly).toContain("Monthly spend limit");
    expect(budgetsOnly).toContain("Nearing the limit");
    expect(budgetsOnly).toContain("$42.50 of $50.00 (85%)");
    expect(budgetsOnly).toContain('aria-valuenow="85"');
    expect(budgetsOnly).not.toContain("Sell prices");

    fixture.config = config(["budgets", "billing"], { billing: { currency: "EUR", prices: { "claude-sonnet-5": { inputPerMillion: 4, outputPerMillion: 20 } } } });
    const both = renderToStaticMarkup(createElement(UsageBudgetCards, { budget: { ...budget, spentUsd: 50, percent: 100, exceeded: true } }));
    expect(both).toContain("Limit reached");
    expect(both).toContain("Sell prices");
    expect(both).toContain('value="claude-sonnet-5"');
    expect(both).toContain('value="EUR"');
  });

  it("says when no cap is set and tones the bar by state", () => {
    fixture.config = config(["budgets"]);
    expect(renderToStaticMarkup(createElement(UsageBudgetCards, { budget: null }))).toContain("No limit is set");
    expect(budgetTone(null)).toBe("quiet");
    expect(budgetTone(budget)).toBe("warning");
    expect(budgetTone({ ...budget, exceeded: true })).toBe("danger");
    expect(budgetTone({ ...budget, warn: false })).toBe("quiet");
  });
});
