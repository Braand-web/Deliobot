import { execFile } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

import { removeTempDir } from "../../server/testing/cleanup.ts";

export const TASKS_DIR = join(dirname(fileURLToPath(import.meta.url)), "tasks");

const taskSchema = z.object({ id: z.string().regex(/^[a-z0-9-]+$/), title: z.string().min(1), request: z.string().min(1), check: z.string().min(1) });
export type BenchTask = z.infer<typeof taskSchema> & { dir: string };

export function loadTasks(root = TASKS_DIR): BenchTask[] {
  return readdirSync(root).sort().map((id) => ({ ...taskSchema.parse(JSON.parse(readFileSync(join(root, id, "task.json"), "utf8"))), dir: join(root, id) }));
}

/** A fresh copy of the task's starting repository, which the caller removes. */
export function checkout(task: BenchTask, withSolution = false): string {
  const dir = mkdtempSync(join(tmpdir(), `odb-bench-${task.id}-`));
  cpSync(join(task.dir, "repo"), dir, { recursive: true });
  if (withSolution && existsSync(join(task.dir, "solution"))) cpSync(join(task.dir, "solution"), dir, { recursive: true });
  return dir;
}

export function runCheck(task: BenchTask, dir: string, timeoutMs = 120_000): Promise<boolean> {
  return new Promise((resolve) => {
    execFile("/bin/sh", ["-c", task.check], { cwd: dir, timeout: timeoutMs, env: { PATH: process.env.PATH ?? "", HOME: dir, CI: "1" } }, (error) => resolve(!error));
  });
}

/** A task is fair when its check fails as given and passes with the reference solution. */
export async function validateTask(task: BenchTask): Promise<{ failsAsGiven: boolean; passesSolved: boolean }> {
  const given = checkout(task), solved = checkout(task, true);
  try {
    return { failsAsGiven: !(await runCheck(task, given)), passesSolved: await runCheck(task, solved) };
  } finally {
    await removeTempDir(given);
    await removeTempDir(solved);
  }
}

export interface BenchResult { task: string; arm: "plain" | "coder"; replicate: number; passed: boolean; durationMs: number; costUsd: number | null; turns: number }

export interface ArmSummary { arm: string; runs: number; passRate: number; meanDurationMs: number; meanCostUsd: number | null; meanTurns: number }

const mean = (values: readonly number[]) => (values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0);

export function summarize(results: readonly BenchResult[]): ArmSummary[] {
  return [...new Set(results.map((result) => result.arm))].map((arm) => {
    const runs = results.filter((result) => result.arm === arm);
    const costs = runs.flatMap((run) => (run.costUsd === null ? [] : [run.costUsd]));
    return {
      arm, runs: runs.length, passRate: mean(runs.map((run) => (run.passed ? 1 : 0))),
      meanDurationMs: Math.round(mean(runs.map((run) => run.durationMs))), meanCostUsd: costs.length ? mean(costs) : null, meanTurns: mean(runs.map((run) => run.turns)),
    };
  });
}

export function markdownReport(results: readonly BenchResult[], engine: string): string {
  const rows = summarize(results).map((arm) => `| ${arm.arm} | ${arm.runs} | ${(arm.passRate * 100).toFixed(0)} % | ${(arm.meanDurationMs / 1000).toFixed(0)} s | ${arm.meanCostUsd === null ? "—" : `$${arm.meanCostUsd.toFixed(3)}`} | ${arm.meanTurns.toFixed(1)} |`);
  const rate = (task: string, arm: string) => {
    const runs = results.filter((one) => one.task === task && one.arm === arm);
    return runs.length ? `${runs.filter((one) => one.passed).length}/${runs.length}` : "—";
  };
  const perTask = [...new Set(results.map((result) => result.task))].map((task) => `| ${task} | ${rate(task, "plain")} | ${rate(task, "coder")} |`);
  return [`# Coding bench — ${engine}`, "", "| Arm | Runs | Tests pass | Mean time | Mean cost | Mean turns |", "|---|---|---|---|---|---|", ...rows,
    "", "| Task | Plain | Coder mode |", "|---|---|---|", ...perTask, ""].join("\n");
}
