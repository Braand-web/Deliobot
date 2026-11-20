import { describe, expect, it } from "vitest";

import { loadTasks, markdownReport, summarize, validateTask, type BenchResult } from "./bench.ts";

describe("coding bench", () => {
  const tasks = loadTasks();

  it("holds a dozen tasks with a request and a check", () => {
    expect(tasks.length).toBeGreaterThanOrEqual(12);
    expect(new Set(tasks.map((task) => task.id)).size).toBe(tasks.length);
  });

  it.each(loadTasks().map((task) => [task.id, task] as const))("%s fails as given and passes with its reference solution", async (_id, task) => {
    expect(await validateTask(task)).toEqual({ failsAsGiven: true, passesSolved: true });
  }, 60_000);

  it("compares the two arms on pass rate, time, cost and turns", () => {
    const results: BenchResult[] = [
      { task: "a", arm: "plain", replicate: 1, passed: false, durationMs: 30_000, costUsd: 0.02, turns: 1 },
      { task: "b", arm: "plain", replicate: 1, passed: true, durationMs: 50_000, costUsd: 0.04, turns: 1 },
      { task: "a", arm: "coder", replicate: 1, passed: true, durationMs: 80_000, costUsd: 0.05, turns: 2 },
      { task: "b", arm: "coder", replicate: 1, passed: true, durationMs: 60_000, costUsd: null, turns: 1 },
    ];
    expect(summarize(results)).toEqual([
      { arm: "plain", runs: 2, passRate: 0.5, meanDurationMs: 40_000, meanCostUsd: 0.03, meanTurns: 1 },
      { arm: "coder", runs: 2, passRate: 1, meanDurationMs: 70_000, meanCostUsd: 0.05, meanTurns: 1.5 },
    ]);
    expect(markdownReport(results, "test")).toContain("| a | 0/1 | 1/1 |");
  });
});
