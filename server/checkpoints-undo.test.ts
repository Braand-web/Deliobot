import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

import { diffText, keep, release, restore, snapshot } from "./checkpoints.ts";
import { removeTempDir } from "./testing/cleanup.ts";

const scratch: string[] = [];
afterAll(async () => { for (const dir of scratch) await removeTempDir(dir); });

function workspace(name: string) {
  const cwd = mkdtempSync(join(tmpdir(), "odb-ckpt-undo-"));
  scratch.push(cwd);
  return { bot: `ckpt-undo-${name}-${Date.now()}`, cwd };
}

describe("undoing a coder-mode turn", () => {
  it("shows the change as a diff, keeps the snapshot and puts the folder back", async () => {
    const { bot, cwd } = workspace("restore");
    writeFileSync(join(cwd, "app.js"), "export const answer = 41;\n");
    writeFileSync(join(cwd, "old.txt"), "keep me\n");
    const before = await snapshot(bot, cwd, "before the turn", undefined, { pin: "turn-1" });
    expect(before).toMatch(/^[0-9a-f]{40}$/);
    writeFileSync(join(cwd, "app.js"), "export const answer = 42;\n");
    writeFileSync(join(cwd, "new.js"), "added\n");
    await import("node:fs/promises").then(({ rm }) => rm(join(cwd, "old.txt")));

    const diff = await diffText(bot, cwd, before!);
    expect(diff).toContain("-export const answer = 41;");
    expect(diff).toContain("+export const answer = 42;");
    expect(await keep(bot, cwd, before!, "thread:turn-1")).toBe(true);
    await release(bot, cwd, "turn-1");
    await snapshot(bot, cwd, "a later turn");

    const undone = await restore(bot, cwd, before!);
    expect(undone).toEqual({ changed: ["app.js"], added: ["new.js"], deleted: ["old.txt"] });
    expect(readFileSync(join(cwd, "app.js"), "utf8")).toBe("export const answer = 41;\n");
    expect(readFileSync(join(cwd, "old.txt"), "utf8")).toBe("keep me\n");
    expect(existsSync(join(cwd, "new.js"))).toBe(false);
  });

  it("refuses a value that is not a snapshot", async () => {
    const { bot, cwd } = workspace("refuse");
    expect(await restore(bot, cwd, "not-a-hash")).toBeNull();
    expect(await diffText(bot, cwd, "nope")).toBeNull();
  });
});
