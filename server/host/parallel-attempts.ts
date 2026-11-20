import { randomBytes } from "node:crypto";
import { existsSync, readdirSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";

import type { HostTurnResult } from "../coordinator.ts";
import { noticeTool } from "../chat-notices.ts";
import { applyChanges, AttemptRefusal, changesFrom, copyProject, pickAttempt, projectFiles, type AttemptOutcome } from "../coder/attempt-files.ts";
import type { CheckRun } from "../coder/verify.ts";
import { startWhenFree } from "./start-when-free.ts";

export const MAX_ATTEMPTS = 3;
const KEEP_RUNS_MS = 24 * 60 * 60_000;

type Row = ReturnType<typeof noticeTool<{ ok: boolean }>>;
export interface Engine { instanceId: string; model: string }

export interface ParallelAttemptsDeps {
  dataDir: string;
  /** A new conversation on this bot, in `cwd`, on `engine` when given. */
  openThread(botId: string, cwd: string, title: string, engine?: Engine): string | null;
  startTurn(botId: string, text: string, opts: { threadId: string; cardContinuation?: true; unattended?: boolean; onSettled?: (outcome: HostTurnResult) => void }): Promise<unknown>;
  append(threadId: string, tool: Row): void;
  checks(botId: string, cwd: string): string[];
  runChecks(cwd: string, commands: readonly string[]): Promise<CheckRun>;
  /** A kept snapshot of the project folder, to put it back if another attempt is chosen. */
  snapshot(botId: string, cwd: string): Promise<string | null>;
  restore(botId: string, cwd: string, hash: string): Promise<unknown>;
  sleep?: (ms: number) => Promise<void>;
}

interface Run {
  id: string; botId: string; threadId: string; cwd: string; base: Map<string, string>;
  attempts: Array<{ index: number; dir: string; threadId: string | null; engine?: Engine; outcome?: AttemptOutcome & { failedChecks?: string[] } }>;
  applied?: number; snapshot?: string | null;
}

const attemptPrompt = (request: string, index: number, count: number) => [
  `You are attempt ${index} of ${count}, each working on its own copy of the project; the best one is kept.`,
  "Do the whole request in this folder, run the project's checks, and stop when it is done. Don't install or remove packages.",
  "", "The request:", request,
].join("\n");

function summary(run: Run): string {
  const lines = run.attempts.map(({ index, engine, outcome }) => {
    if (!outcome) return `- Attempt ${index}: did not finish.`;
    if (!outcome.ok || !outcome.changes) return `- Attempt ${index}${engine ? ` (${engine.model})` : ""}: the turn failed.`;
    const files = [...outcome.changes.changed, ...outcome.changes.added, ...outcome.changes.deleted];
    return `- Attempt ${index}${engine ? ` (${engine.model})` : ""}: checks ${outcome.checksPassed ? "passed" : `failed (${(outcome.failedChecks ?? []).join(", ")})`}, ${outcome.changes.lines} lines in ${files.length} ${files.length === 1 ? "file" : "files"}${files.length ? ` (${files.slice(0, 6).join(", ")}${files.length > 6 ? ", …" : ""})` : ""}.`;
  });
  return lines.join("\n");
}

/** Parallel attempts: the same request worked on by 2 or 3 copies of the project at once, each checked, the best one
 * written into the project, the others kept for a day so the person can pick another. */
export function createParallelAttempts(deps: ParallelAttemptsDeps) {
  const runs = new Map<string, Run>();
  const attemptThreads = new Set<string>();
  const root = join(deps.dataDir, "attempts");

  function sweep(): void {
    if (!existsSync(root)) return;
    for (const name of readdirSync(root)) {
      const dir = join(root, name);
      if (Date.now() - statSync(dir).mtimeMs > KEEP_RUNS_MS) { rmSync(dir, { recursive: true, force: true }); runs.delete(name); }
    }
  }

  async function settleAttempt(run: Run, attempt: Run["attempts"][number], result: HostTurnResult): Promise<void> {
    const changes = result.ok ? changesFrom(run.base, run.cwd, attempt.dir) : null;
    const commands = deps.checks(run.botId, attempt.dir);
    const checked = changes && changes.lines > 0 && commands.length ? await deps.runChecks(attempt.dir, commands) : null;
    attempt.outcome = {
      index: attempt.index, ok: result.ok, changes, checksPassed: checked ? checked.ok : commands.length === 0,
      ...(checked && !checked.ok ? { failedChecks: checked.results.filter((one) => !one.ok).map((one) => one.command) } : {}),
    };
  }

  async function finish(run: Run): Promise<void> {
    const best = pickAttempt(run.attempts.flatMap((one) => (one.outcome ? [one.outcome] : [])));
    let verdict: string;
    if (!best) {
      deps.append(run.threadId, noticeTool("chat.notice.attemptsNone", { count: String(run.attempts.length) }, { ok: false }));
      verdict = "No attempt produced a change to keep; the project is as it was.";
    } else {
      run.snapshot = await deps.snapshot(run.botId, run.cwd);
      const applied = applyChanges(best.changes!, run.attempts[best.index - 1]!.dir, run.cwd, run.base);
      if (applied.applied) {
        run.applied = best.index;
        deps.append(run.threadId, noticeTool("chat.notice.attemptsKept", { attempt: String(best.index), count: String(run.attempts.length) }, { ok: best.checksPassed }));
        verdict = `Attempt ${best.index} was written into the project${best.checksPassed ? "" : ", although its checks fail: none passed"}.`;
      } else {
        deps.append(run.threadId, noticeTool("chat.notice.attemptsConflict", { files: applied.conflicts.slice(0, 3).join(", ") }, { ok: false }));
        verdict = `Attempt ${best.index} was the best, but ${applied.conflicts.join(", ")} changed in the project meanwhile, so nothing was written.`;
      }
    }
    const text = [`The parallel attempts (run ${run.id}) are done.`, verdict, "", summary(run), "",
      "Tell the person which attempt was kept and why, in a few lines. If they prefer another one, call choose_attempt with this run and its number."].join("\n");
    await startWhenFree(() => deps.startTurn(run.botId, text, { threadId: run.threadId, cardContinuation: true }), deps.sleep ? { sleep: deps.sleep } : {});
  }

  return {
    /** Whether this conversation is one an attempt runs in: Coder mode leaves those to the attempts. */
    owns: (threadId: string) => attemptThreads.has(threadId),

    async start(input: { botId: string; threadId: string; cwd: string; request: string; count: number; engines?: Engine[] }): Promise<{ run: string; attempts: number } | { error: string }> {
      const count = Math.min(MAX_ATTEMPTS, Math.max(2, Math.floor(input.count)));
      if ([...runs.values()].some((one) => one.threadId === input.threadId && one.attempts.some((attempt) => !attempt.outcome))) return { error: "Attempts are already running in this conversation; wait for their results." };
      sweep();
      let base: Map<string, string>;
      try { base = projectFiles(input.cwd); } catch (error) {
        if (error instanceof AttemptRefusal) return { error: error.message };
        throw error;
      }
      const id = randomBytes(6).toString("hex");
      const run: Run = { id, botId: input.botId, threadId: input.threadId, cwd: input.cwd, base, attempts: [] };
      for (let index = 1; index <= count; index += 1) {
        const dir = join(root, id, String(index));
        copyProject(input.cwd, dir);
        const engine = input.engines?.[(index - 1) % input.engines.length];
        const threadId = deps.openThread(input.botId, dir, `Attempt ${index} of ${count}`, engine);
        if (threadId) attemptThreads.add(threadId);
        run.attempts.push({ index, dir, threadId, ...(engine ? { engine } : {}) });
      }
      runs.set(id, run);
      deps.append(input.threadId, noticeTool("chat.notice.attemptsStarted", { count: String(count) }, { ok: true }));
      void Promise.all(run.attempts.map(async (attempt) => {
        if (!attempt.threadId) { attempt.outcome = { index: attempt.index, ok: false, checksPassed: false, changes: null }; return; }
        const result = await new Promise<HostTurnResult>((resolve) => {
          deps.startTurn(input.botId, attemptPrompt(input.request, attempt.index, count), { threadId: attempt.threadId!, unattended: true, onSettled: resolve })
            .catch(() => resolve({ ok: false, text: "" } as HostTurnResult));
        });
        await settleAttempt(run, attempt, result).catch(() => { attempt.outcome = { index: attempt.index, ok: false, checksPassed: false, changes: null }; });
      })).then(() => finish(run)).catch((error) => console.warn(`parallel attempts: ${error instanceof Error ? error.message : String(error)}`));
      return { run: id, attempts: count };
    },

    /** Puts the project back as it was before the kept attempt, then writes `attempt` in its place. */
    async choose(input: { botId: string; threadId: string; run: string; attempt: number }): Promise<{ ok: true; message: string } | { error: string }> {
      const run = runs.get(input.run);
      if (!run || run.threadId !== input.threadId || run.botId !== input.botId) return { error: "No such run of attempts in this conversation (they are kept for a day)." };
      const chosen = run.attempts.find((one) => one.index === input.attempt);
      if (!chosen?.outcome?.changes || chosen.outcome.changes.lines === 0) return { error: `Attempt ${input.attempt} has no change to use.` };
      if (run.applied === chosen.index) return { ok: true, message: `Attempt ${chosen.index} is already the one in the project.` };
      if (run.applied !== undefined && run.snapshot) await deps.restore(run.botId, run.cwd, run.snapshot);
      const applied = applyChanges(chosen.outcome.changes, chosen.dir, run.cwd, run.base);
      if (!applied.applied) return { error: `The project changed since the attempts (${applied.conflicts.join(", ")}); nothing was written.` };
      run.applied = chosen.index;
      deps.append(run.threadId, noticeTool("chat.notice.attemptsKept", { attempt: String(chosen.index), count: String(run.attempts.length) }, { ok: chosen.outcome.checksPassed }));
      return { ok: true, message: `Attempt ${chosen.index} is now in the project${chosen.outcome.checksPassed ? "" : "; its checks failed"}.` };
    },
  };
}

export type ParallelAttempts = ReturnType<typeof createParallelAttempts>;
