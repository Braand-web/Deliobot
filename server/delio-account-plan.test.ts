import { describe, expect, it } from "vitest";

import type { AppConfig } from "./config.ts";
import { createDelioAccount, DELIO_INSTANCE, DELIO_PLAN_GATE_ENV, delioPlanTurnsFor } from "./delio-account.ts";

const connected = { delio: { portal: "https://compte.example.test", workspace: "me-abcdefgh", token: `odb_device_${"a".repeat(43)}` } } as unknown as AppConfig;

function account(plan: { plan: string | null; ownAi: boolean } | "unreachable", gate: boolean) {
  const fetchImpl = (async () => plan === "unreachable"
    ? Promise.reject(new Error("offline"))
    : Response.json({ credits: 100, usedThisMonth: 0, ...plan })) as unknown as typeof fetch;
  return createDelioAccount({ config: () => connected, save: () => undefined, label: () => "test", fetchImpl,
    env: gate ? { [DELIO_PLAN_GATE_ENV]: "1" } : {} });
}

describe("the customer's own AI and the plan", () => {
  it("is open everywhere without the installed app's gate", async () => {
    expect(await account({ plan: "starter", ownAi: false }, false).ownAiAllowed()).toBe(true);
  });

  it("needs a Max or BYOK plan in the installed app, and a turn on another engine than Delio's is refused", async () => {
    const pro = account({ plan: "pro", ownAi: false }, true);
    expect(await pro.ownAiAllowed()).toBe(false);
    await expect(pro.assertOwnAi("claude")).rejects.toMatchObject({ status: 402, code: "plan_required" });
    await expect(pro.assertOwnAi(DELIO_INSTANCE)).resolves.toBeUndefined();
    expect(await account({ plan: "max", ownAi: true }, true).ownAiAllowed()).toBe(true);
    expect(await account({ plan: "byok", ownAi: true }, true).ownAiAllowed()).toBe(true);
  });

  it("stays closed when the portal cannot be reached", async () => {
    expect(await account("unreachable", true).ownAiAllowed()).toBe(false);
  });
});

describe("a turn on a plan without the customer's own AI", () => {
  it("moves the bot to Delio's engine before it runs, and leaves it on Max", async () => {
    const selections = new Map([["scout", { instanceId: "claude", model: "claude-sonnet-5" }]]);
    const turns = (plan: { plan: string; ownAi: boolean }) => delioPlanTurnsFor({ account: account(plan, true), bot: (id) => ({ modelSelection: selections.get(id)! }),
      useDelio: (id, selection) => selections.set(id, selection) });
    await turns({ plan: "max", ownAi: true }).before("scout", "t1");
    expect(selections.get("scout")?.instanceId).toBe("claude");
    await turns({ plan: "pro", ownAi: false }).before("scout", "t1");
    expect(selections.get("scout")).toEqual({ instanceId: DELIO_INSTANCE, model: "auto" });
  });

  it("refuses the turn when Delio's engine is not there to move to", async () => {
    const turns = delioPlanTurnsFor({ account: account({ plan: "pro", ownAi: false }, true), bot: () => ({ modelSelection: { instanceId: "claude", model: "x" } }), useDelio: () => null });
    await expect(turns.before("scout", "t1")).rejects.toMatchObject({ code: "plan_required" });
  });
});
