// Live coding bench: each task's request sent to a real engine twice, as a plain bot and as the same bot in Coder mode,
// then the task's own tests decide. Closed unless ODB_EVAL_LIVE=1; never in CI. Usage:
//   ODB_EVAL_LIVE=1 ODB_EVAL_LIVE_INSTANCE='{"instanceId":"claude","driver":"claudeAgent","model":"claude-sonnet-5","config":{"cli":"/path/to/claude"},"environmentFrom":["HOME","USER"]}' \
//     node --experimental-strip-types evals/coding-bench/run-coding-bench.ts [--only cart-total,csv] [--replicates 3] [--arms plain,coder]
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

import { removeTempDir } from "../../server/testing/cleanup.ts";
import { spawnLiveServer } from "../live/live-server.ts";
import { loadLiveInstance } from "../live/run-live.ts";
import { checkout, loadTasks, markdownReport, runCheck, summarize, type BenchResult, type BenchTask } from "./bench.ts";

const REPORTS = join(dirname(fileURLToPath(import.meta.url)), "..", "reports", "runs");
const TURN_LIMIT_MS = 15 * 60_000;
const QUIET_MS = 8_000;

interface Row { kind?: string; digest?: { usage?: { costUsd?: number | null } }; tool?: { nameCode?: string } }

async function runOne(base: string, task: BenchTask, arm: "plain" | "coder", replicate: number, engine: { instanceId: string; model: string }): Promise<BenchResult> {
  const call = async (method: string, path: string, body?: unknown) => {
    const response = await fetch(base + path, { method, headers: { "content-type": "application/json", origin: base }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return await response.json().catch(() => null) as any;
  };
  const dir = checkout(task);
  const started = Date.now();
  try {
    const { bot } = await call("POST", "/api/bots", { name: `${task.id}-${arm}-${replicate}` });
    await call("PATCH", `/api/bots/${bot.id}`, { cwd: dir, modelSelection: engine, ...(arm === "coder" ? { coder: { enabled: true, verify: [task.check] } } : {}) });
    await call("POST", `/api/bots/${bot.id}/messages`, { text: `${task.request}\n\nThe project is in your working folder; its tests run with: ${task.check}` });
    let quietSince = 0;
    let rows: Row[] = [];
    while (Date.now() - started < TURN_LIMIT_MS) {
      await new Promise((resolve) => setTimeout(resolve, 2_000));
      const current = (await call("GET", `/api/bots/${bot.id}`))?.bot;
      rows = (await call("GET", `/api/threads/${current.activeTaskId ?? current.mainThreadId}/messages?limit=200`))?.messages ?? [];
      const settled = !current.busy && rows.some((row) => row.kind === "digest");
      quietSince = settled ? quietSince || Date.now() : 0;
      if (quietSince && Date.now() - quietSince >= QUIET_MS) break;
    }
    const digests = rows.filter((row) => row.kind === "digest");
    const costs = digests.flatMap((row) => (typeof row.digest?.usage?.costUsd === "number" ? [row.digest.usage.costUsd] : []));
    const passed = await runCheck(task, dir);
    await call("DELETE", `/api/bots/${bot.id}`);
    return { task: task.id, arm, replicate, passed, durationMs: Date.now() - started, costUsd: costs.length ? costs.reduce((a, b) => a + b, 0) : null, turns: digests.length };
  } finally {
    await removeTempDir(dir);
  }
}

async function main(): Promise<void> {
  if (process.env.ODB_EVAL_LIVE !== "1") {
    console.log("coding bench: closed (set ODB_EVAL_LIVE=1 and an engine instance to run it on your own account)");
    return;
  }
  const { values } = parseArgs({ options: { only: { type: "string" }, replicates: { type: "string" }, arms: { type: "string" } } });
  const instance = loadLiveInstance(process.env);
  const engine = { instanceId: instance.instanceId, model: instance.model };
  const only = values.only ? new Set(values.only.split(",")) : null;
  const tasks = loadTasks().filter((task) => !only || only.has(task.id));
  const arms = (values.arms ?? "plain,coder").split(",").filter((arm): arm is "plain" | "coder" => arm === "plain" || arm === "coder");
  const replicates = Math.max(1, Number(values.replicates ?? 1));
  const passEnv = (process.env.ODB_EVAL_LIVE_PASS_ENV ?? "").split(/[:,]/).map((name) => name.trim()).filter(Boolean);
  const server = await spawnLiveServer(process.env, instance, passEnv);
  const results: BenchResult[] = [];
  try {
    for (const task of tasks) {
      for (let replicate = 1; replicate <= replicates; replicate += 1) {
        for (const arm of arms) {
          const result = await runOne(server.url, task, arm, replicate, engine);
          results.push(result);
          console.log(`${task.id} ${arm} #${replicate}: ${result.passed ? "pass" : "FAIL"} in ${Math.round(result.durationMs / 1000)} s`);
        }
      }
    }
  } finally {
    await server.close();
  }
  mkdirSync(REPORTS, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  writeFileSync(join(REPORTS, `coding-bench-${stamp}.json`), `${JSON.stringify({ engine, results, summary: summarize(results) }, null, 2)}\n`);
  writeFileSync(join(REPORTS, `coding-bench-${stamp}.md`), markdownReport(results, `${engine.instanceId} ${engine.model}`));
  console.log(markdownReport(results, `${engine.instanceId} ${engine.model}`));
}

await main();
