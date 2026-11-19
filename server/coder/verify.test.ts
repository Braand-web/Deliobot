import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { detectChecks, failureMessage, runChecks, trimOutput } from "./verify.ts";

const dirs: string[] = [];
const folder = (files: Record<string, string>) => {
  const dir = mkdtempSync(join(tmpdir(), "coder-verify-"));
  dirs.push(dir);
  for (const [name, body] of Object.entries(files)) writeFileSync(join(dir, name), body);
  return dir;
};
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });

describe("the project's own checks", () => {
  it("reads package scripts in order with the lockfile's runner, skipping watch scripts", () => {
    const dir = folder({ "package.json": JSON.stringify({ scripts: { test: "vitest run", lint: "eslint .", build: "vite build", dev: "vite", typecheck: "tsc --watch" } }), "pnpm-lock.yaml": "" });
    expect(detectChecks(dir)).toEqual(["pnpm run lint", "pnpm run test", "pnpm run build"]);
  });

  it("adds a type check for a TypeScript project without one, and knows Python, Rust and Go", () => {
    expect(detectChecks(folder({ "package.json": JSON.stringify({ scripts: { test: "jest" } }), "tsconfig.json": "{}" }))).toEqual(["npx tsc --noEmit", "npm run test"]);
    expect(detectChecks(folder({ "pyproject.toml": "" }))).toEqual(["python -m pytest -q"]);
    expect(detectChecks(folder({ "Cargo.toml": "" }))).toEqual(["cargo test"]);
    expect(detectChecks(folder({ "go.mod": "" }))).toEqual(["go test ./..."]);
    expect(detectChecks(folder({ "README.md": "" }))).toEqual([]);
  });

  it("keeps the start and the end of a long output", () => {
    const out = trimOutput(`${"a".repeat(5_000)}MIDDLE${"z".repeat(5_000)}`, 1_000);
    expect(out.length).toBeLessThan(1_010);
    expect(out.startsWith("a")).toBe(true);
    expect(out.endsWith("z")).toBe(true);
    expect(out).not.toContain("MIDDLE");
  });

  it("runs each command in the folder and reports what failed", async () => {
    const dir = folder({ "ok.txt": "fine" });
    const run = await runChecks(dir, ["cat ok.txt", "echo broken >&2; exit 3"]);
    expect(run.ok).toBe(false);
    expect(run.results.map((one) => one.ok)).toEqual([true, false]);
    expect(run.results[1]!.output).toContain("broken");
    const message = failureMessage(run, 1, 3);
    expect(message).toContain("round 1 of 3");
    expect(message).toContain("$ echo broken >&2; exit 3");
    expect(message).not.toContain("$ cat ok.txt");
  });
});
