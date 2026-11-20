import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

import type { HostTurnResult } from "../coordinator.ts";
import { changesFrom, copyProject, pickAttempt, projectFiles } from "../coder/attempt-files.ts";
import { createParallelAttempts } from "./parallel-attempts.ts";

const scratch = mkdtempSync(join(tmpdir(), "odb-attempts-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

function project(name: string) {
  const dir = join(scratch, name);
  mkdirSync(join(dir, "src"), { recursive: true });
  mkdirSync(join(dir, "node_modules", "lib"), { recursive: true });
  writeFileSync(join(dir, "src", "cart.js"), "export const total = (items) => 0;\n");
  writeFileSync(join(dir, "README.md"), "shop\n");
  writeFileSync(join(dir, "node_modules", "lib", "index.js"), "module.exports = 1;\n");
  return dir;
}

/** Each attempt's "engine" edits its copy as scripted, by the attempt's number in its title. */
function harness(cwd: string, edits: Record<number, (dir: string) => void>, failing: Set<number>) {
  const rows: string[] = [];
  const continued: string[] = [];
  const threads = new Map<string, { dir: string; index: number }>();
  const restored: string[] = [];
  const attempts = createParallelAttempts({
    dataDir: join(scratch, `data-${Math.random()}`),
    openThread: (_bot, dir, title) => { const id = `t-${threads.size + 1}`; threads.set(id, { dir, index: Number(/Attempt (\d)/.exec(title)![1]) }); return id; },
    startTurn: async (_bot, text, opts) => {
      if (opts.cardContinuation) { continued.push(text); return; }
      const thread = threads.get(opts.threadId)!;
      edits[thread.index]?.(thread.dir);
      opts.onSettled?.({ ok: true, text: "done" } as HostTurnResult);
    },
    append: (_thread, tool) => rows.push(tool.nameCode),
    checks: () => ["npm test"],
    runChecks: async (dir) => {
      const index = [...threads.values()].find((one) => one.dir === dir)!.index;
      return failing.has(index) ? { ok: false, results: [{ command: "npm test", ok: false, output: "fail" }] } : { ok: true, results: [{ command: "npm test", ok: true, output: "" }] };
    },
    snapshot: async () => "snap",
    restore: async (_bot, dir) => { restored.push(dir); writeFileSync(join(dir, "src", "cart.js"), "export const total = (items) => 0;\n"); rmSync(join(dir, "src", "tax.js"), { force: true }); },
    sleep: async () => {},
  });
  const settled = async () => { for (let i = 0; i < 50 && !continued.length; i += 1) await new Promise((resolve) => setTimeout(resolve, 10)); };
  return { attempts, rows, continued, restored, settled, cwd };
}

describe("parallel attempts", () => {
  it("copies the project without its dependencies, which stay shared, and sees what an attempt changed", () => {
    const dir = project("copy");
    const base = projectFiles(dir);
    expect([...base.keys()].sort()).toEqual(["README.md", "src/cart.js"]);
    const copy = join(scratch, "copy-attempt");
    copyProject(dir, copy);
    expect(lstatSync(join(copy, "node_modules")).isSymbolicLink()).toBe(true);
    writeFileSync(join(copy, "src", "cart.js"), "export const total = (items) => items.reduce((a, b) => a + b, 0);\n");
    writeFileSync(join(copy, "src", "tax.js"), "export const tax = 0.2;\n");
    rmSync(join(copy, "README.md"));
    expect(changesFrom(base, dir, copy)).toEqual({ changed: ["src/cart.js"], added: ["src/tax.js"], deleted: ["README.md"], lines: 5 });
  });

  it("prefers passing checks, then the smaller change", () => {
    const change = (lines: number) => ({ changed: ["a"], added: [], deleted: [], lines });
    expect(pickAttempt([{ index: 1, ok: true, checksPassed: false, changes: change(2) }, { index: 2, ok: true, checksPassed: true, changes: change(40) }])?.index).toBe(2);
    expect(pickAttempt([{ index: 1, ok: true, checksPassed: true, changes: change(30) }, { index: 2, ok: true, checksPassed: true, changes: change(3) }])?.index).toBe(2);
    expect(pickAttempt([{ index: 1, ok: false, checksPassed: false, changes: null }, { index: 2, ok: true, checksPassed: true, changes: change(0) }])).toBeNull();
  });

  it("runs the attempts, writes the best into the project, reports to the bot, and switches when asked", async () => {
    const cwd = project("run");
    const big = (dir: string) => { writeFileSync(join(dir, "src", "cart.js"), "// rewritten\n".repeat(20) + "export const total = (items) => items.length;\n"); writeFileSync(join(dir, "src", "tax.js"), "x\n"); };
    const small = (dir: string) => writeFileSync(join(dir, "src", "cart.js"), "export const total = (items) => items.reduce((a, b) => a + b, 0);\n");
    const { attempts, rows, continued, restored, settled } = harness(cwd, { 1: big, 2: small }, new Set());
    const started = await attempts.start({ botId: "bot", threadId: "origin", cwd, request: "Fix the cart total", count: 2 });
    expect(started).toMatchObject({ attempts: 2 });
    expect(attempts.owns("t-1")).toBe(true);
    await settled();
    expect(readFileSync(join(cwd, "src", "cart.js"), "utf8")).toContain("reduce");
    expect(existsSync(join(cwd, "src", "tax.js"))).toBe(false);
    expect(rows).toEqual(["chat.notice.attemptsStarted", "chat.notice.attemptsKept"]);
    expect(continued[0]).toContain("Attempt 2 was written into the project");
    expect(continued[0]).toContain("Attempt 1: checks passed, 24 lines in 2 files");
    expect(continued[0]).toContain("Attempt 2: checks passed, 2 lines in 1 file (src/cart.js)");

    const run = (started as { run: string }).run;
    expect(await attempts.choose({ botId: "bot", threadId: "origin", run, attempt: 1 })).toMatchObject({ ok: true });
    expect(restored).toEqual([cwd]);
    expect(readFileSync(join(cwd, "src", "cart.js"), "utf8")).toContain("items.length");
    expect(existsSync(join(cwd, "src", "tax.js"))).toBe(true);
    expect(await attempts.choose({ botId: "other", threadId: "origin", run, attempt: 2 })).toMatchObject({ error: expect.any(String) });
  });

  it("keeps a passing attempt over a smaller failing one, and writes nothing over a file the person changed meanwhile", async () => {
    const cwd = project("conflict");
    const edit = (text: string) => (dir: string) => { writeFileSync(join(dir, "src", "cart.js"), text); writeFileSync(join(cwd, "src", "cart.js"), "// the person's own edit\n"); };
    const { attempts, rows, continued, settled } = harness(cwd, { 1: edit("a\n"), 2: edit("b\nc\nd\n") }, new Set([1]));
    await attempts.start({ botId: "bot", threadId: "origin", cwd, request: "x", count: 2 });
    await settled();
    expect(rows.at(-1)).toBe("chat.notice.attemptsConflict");
    expect(continued[0]).toContain("Attempt 2 was the best");
    expect(readFileSync(join(cwd, "src", "cart.js"), "utf8")).toBe("// the person's own edit\n");
  });
});
