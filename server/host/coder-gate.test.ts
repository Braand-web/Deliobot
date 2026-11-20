import { describe, expect, it } from "vitest";

import type { HostTurnResult } from "../coordinator.ts";
import type { BotRecord } from "../store.ts";
import type { CheckRun } from "../coder/verify.ts";
import { createCoderGate } from "./coder-gate.ts";

function harness(opts: { coder: NonNullable<BotRecord["coder"]>; checks: CheckRun[]; review?: string; busyOnce?: boolean }) {
  const rows: Array<{ threadId: string; key: string; ok: boolean }> = [];
  const turns: Array<{ threadId: string; text: string }> = [];
  const checks = [...opts.checks];
  let busy = opts.busyOnce ?? false;
  const gate = createCoderGate({
    bot: () => ({ id: "bot", coder: opts.coder } as BotRecord),
    request: () => "Add a contact form",
    append: (threadId, tool) => rows.push({ threadId, key: tool.nameCode, ok: tool.ok }),
    startTurn: async (_botId, text, turn) => {
      if (busy) { busy = false; throw Object.assign(new Error("busy"), { code: "thread_busy" }); }
      turns.push({ threadId: turn.threadId, text });
      if (turn.onSettled) turn.onSettled({ ok: true, text: opts.review ?? "" } as HostTurnResult);
    },
    openReviewThread: () => "review-thread",
    diffText: async () => "+<form>",
    detectChecks: () => ["npm test"],
    runChecks: async () => checks.shift() ?? { ok: true, results: [{ command: "npm test", ok: true, output: "" }] },
    sleep: async () => {},
  });
  return { gate, rows, turns };
}

const fail: CheckRun = { ok: false, results: [{ command: "npm test", ok: false, output: "1 test failed" }] };
const pass: CheckRun = { ok: true, results: [{ command: "npm test", ok: true, output: "" }] };
const turn = (extra: Partial<Parameters<ReturnType<typeof createCoderGate>["afterTurn"]>[0]> = {}) =>
  ({ botId: "bot", threadId: "t1", cwd: "/p", fromHash: "a".repeat(40), changedFiles: 2, ...extra });

describe("coder mode", () => {
  it("does nothing for a bot without it, or a turn that changed no file", async () => {
    const off = harness({ coder: { enabled: false }, checks: [fail] });
    await off.gate.afterTurn(turn());
    const idle = harness({ coder: { enabled: true }, checks: [fail] });
    await idle.gate.afterTurn(turn({ changedFiles: 0 }));
    expect([...off.rows, ...idle.rows, ...off.turns, ...idle.turns]).toEqual([]);
  });

  it("sends failing checks back to the bot until they pass, then stops", async () => {
    const { gate, rows, turns } = harness({ coder: { enabled: true }, checks: [fail, pass] });
    await gate.afterTurn(turn());
    expect(turns).toHaveLength(1);
    expect(turns[0]!.text).toContain("1 test failed");
    await gate.afterTurn(turn({ changedFiles: 0 }));
    expect(rows.map((row) => row.key)).toEqual(["chat.notice.coderChecking", "chat.notice.coderFailed", "chat.notice.coderChecking", "chat.notice.coderPassed"]);
    expect(turns).toHaveLength(1);
  });

  it("gives up after its rounds and says so", async () => {
    const { gate, rows, turns } = harness({ coder: { enabled: true, maxRounds: 1 }, checks: [fail, fail] });
    await gate.afterTurn(turn());
    await gate.afterTurn(turn());
    expect(turns).toHaveLength(1);
    expect(rows.at(-1)).toEqual({ threadId: "t1", key: "chat.notice.coderGaveUp", ok: false });
  });

  it("waits for a busy conversation before continuing", async () => {
    const { gate, turns } = harness({ coder: { enabled: true }, checks: [fail], busyOnce: true });
    await gate.afterTurn(turn());
    expect(turns).toHaveLength(1);
  });

  it("has another engine review a passing change and sends its fixes back", async () => {
    const review = { instanceId: "codex", model: "gpt-5" };
    const { gate, rows, turns } = harness({ coder: { enabled: true, review }, checks: [pass], review: '<review verdict="changes">src/form.ts: validate the e-mail</review>' });
    await gate.afterTurn(turn());
    expect(turns.map((one) => one.threadId)).toEqual(["review-thread", "t1"]);
    expect(turns[0]!.text).toContain("+<form>");
    expect(turns[1]!.text).toContain("validate the e-mail");
    expect(rows.map((row) => row.key)).toEqual(["chat.notice.coderChecking", "chat.notice.coderPassed", "chat.notice.coderReviewing", "chat.notice.coderReviewChanges"]);
    expect(gate.isReviewThread("review-thread")).toBe(true);
  });

  it("records an approval and ends there", async () => {
    const { gate, rows, turns } = harness({ coder: { enabled: true, review: { instanceId: "codex", model: "gpt-5" } }, checks: [pass], review: '<review verdict="approve">good</review>' });
    await gate.afterTurn(turn());
    expect(turns).toHaveLength(1);
    expect(rows.at(-1)!.key).toBe("chat.notice.coderReviewApproved");
  });

  it("is on for a bot that never set it, and stays off for one that switched it off", async () => {
    const neverSet = harness({ coder: undefined as never, checks: [fail] });
    await neverSet.gate.afterTurn(turn());
    expect(neverSet.turns).toHaveLength(1);
    const off = harness({ coder: { enabled: false }, checks: [fail] });
    await off.gate.afterTurn(turn());
    expect(off.rows).toEqual([]);
  });

  it("in a goal, keeps the checks' outcome for the goal's next step instead of starting a turn", async () => {
    const rows: string[] = [];
    const started: string[] = [];
    const gate = createCoderGate({
      bot: () => ({ id: "bot" } as BotRecord), request: () => "", append: (_thread, tool) => rows.push(tool.nameCode),
      startTurn: async (_bot, text) => { started.push(text); }, openReviewThread: () => null, diffText: async () => "",
      detectChecks: () => ["npm test"], runChecks: async () => fail, inGoal: () => true, sleep: async () => {},
    });
    await gate.afterTurn(turn());
    expect(started).toEqual([]);
    expect(rows).toEqual(["chat.notice.coderChecking", "chat.notice.coderGoalFailed"]);
    const note = await gate.beforeGoalStep("t1");
    expect(note).toContain("after your last step");
    expect(note).toContain("1 test failed");
    expect(await gate.beforeGoalStep("t1")).toBe("");
  });
});
