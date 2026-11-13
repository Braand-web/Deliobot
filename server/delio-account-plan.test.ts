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
  it("refreshes a newly paid plan and its confirmation version instead of keeping the old account cached", async () => {
    let now = 0;
    let reply = { credits: 0, usedThisMonth: 0, plan: null as string | null, ownAi: false, paymentVersion: 0 };
    const instance = createDelioAccount({ config: () => connected, save: () => undefined, label: () => "test", now: () => now,
      env: { [DELIO_PLAN_GATE_ENV]: "1" }, fetchImpl: (async () => Response.json(reply)) as typeof fetch });
    expect(await instance.balance()).toMatchObject({ credits: 0, plan: null, paymentVersion: 0 });
    reply = { credits: 13500, usedThisMonth: 0, plan: "max", ownAi: true, paymentVersion: 1 };
    now += 5_001;
    expect(await instance.balance({ fresh: true })).toMatchObject({ credits: 13500, plan: "max", paymentVersion: 1 });
    expect(await instance.ownAiAllowed()).toBe(true);
  });

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

describe("reading the Delio account", () => {
  it("keeps the verified address through an outage and never turns a failed verification into a plan downgrade", async () => {
    let clock = 0;
    let offline = false;
    const config = structuredClone(connected);
    const delio = createDelioAccount({ config: () => config, save: value => { config.delio = value; }, label: () => "test", now: () => clock,
      env: { [DELIO_PLAN_GATE_ENV]: "1" }, fetchImpl: (async () => {
        if (offline) throw new Error("offline");
        return Response.json({ email: "ana@example.test", credits: 13500, usedThisMonth: 0, plan: "max", ownAi: true });
      }) as typeof fetch });
    await delio.balance();
    expect(config.delio?.email).toBe("ana@example.test");
    offline = true;
    clock += 60_001;
    expect(await delio.balance({ fresh: true })).toBeNull();
    expect(config.delio?.email).toBe("ana@example.test");
    expect(await delio.ownAiVisible()).toBe(true);
    expect(await delio.ownAiAllowed()).toBe(false);
    let moved = false;
    const turns = delioPlanTurnsFor({ account: delio, bot: () => ({ modelSelection: { instanceId: "claude", model: "test" } }), useDelio: () => { moved = true; } });
    await expect(turns.before("bot", "thread")).rejects.toMatchObject({ status: 503, code: "account_unavailable" });
    expect(moved).toBe(false);
  });

  it("discards a response that arrives after signing out", async () => {
    const config = structuredClone(connected);
    let release!: (response: Response) => void;
    const delio = createDelioAccount({ config: () => config, save: value => { config.delio = value; }, label: () => "test",
      fetchImpl: ((_url, init) => init?.method === "DELETE" ? Promise.resolve(Response.json({ revoked: true })) : new Promise<Response>(resolve => { release = resolve; })) as typeof fetch });
    const reading = delio.balance();
    await delio.disconnect();
    release(Response.json({ email: "ana@example.test", credits: 13500, usedThisMonth: 0, plan: "max", ownAi: true }));
    expect(await reading).toBeNull();
    expect(config.delio).toBeNull();
  });
  it("answers from the last reading at once and reads again behind it, but waits for a fresh reading on return", async () => {
    let clock = 0;
    let plan = "pro";
    let calls = 0;
    const fetchImpl = (async () => { calls++; return Response.json({ credits: 100, usedThisMonth: 0, plan, ownAi: plan === "max" }); }) as unknown as typeof fetch;
    const delio = createDelioAccount({ config: () => connected, save: () => undefined, label: () => "test", fetchImpl, now: () => clock });
    expect((await delio.balance())?.plan).toBe("pro");
    plan = "max";
    clock += 120_000;
    expect((await delio.balance())?.plan, "an old reading answers at once").toBe("pro");
    await new Promise((done) => setTimeout(done, 0));
    expect((await delio.balance())?.plan, "the reading behind it has landed").toBe("max");
    plan = "byok";
    clock += 10_000;
    expect((await delio.balance({ fresh: true }))?.plan, "back in the app, the reading waits for the portal").toBe("byok");
    expect(calls).toBe(3);
  });
});
