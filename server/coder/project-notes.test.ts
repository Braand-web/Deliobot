import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

import { coderRulesPrompt, editNotes, NOTES_LIMIT, notesFile, projectNotesPrompt, readNotes, rememberChecks } from "./project-notes.ts";

const scratch = mkdtempSync(join(tmpdir(), "odb-project-notes-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));
const dataDir = join(scratch, "data");
const project = (name: string) => join(scratch, name);

describe("project notes", () => {
  it("keeps notes outside the project, one per line, and edits them by quoted words", () => {
    const cwd = project("shop");
    expect(editNotes(dataDir, cwd, { action: "add", text: "Run   the app with npm run dev\n on port 5173" })).toEqual({ ok: true, notes: "- Run the app with npm run dev on port 5173" });
    editNotes(dataDir, cwd, { action: "add", text: "- Prices are integers in cents" });
    expect(notesFile(dataDir, cwd).startsWith(dataDir)).toBe(true);
    expect(existsSync(join(cwd, "NOTES.md"))).toBe(false);
    expect(editNotes(dataDir, cwd, { action: "replace", old: "port 5173", text: "Run the app with npm run dev on port 3000" }).ok).toBe(true);
    expect(editNotes(dataDir, cwd, { action: "remove", old: "cents" }).ok).toBe(true);
    expect(readNotes(dataDir, cwd)).toBe("- Run the app with npm run dev on port 3000");
    expect(readNotes(dataDir, project("other"))).toBe("");
  });

  it("refuses an ambiguous or missing quote, an empty note and a full notebook", () => {
    const cwd = project("refusals");
    editNotes(dataDir, cwd, { action: "add", text: "uses pnpm" });
    editNotes(dataDir, cwd, { action: "add", text: "uses vitest" });
    expect(editNotes(dataDir, cwd, { action: "remove", old: "uses" })).toMatchObject({ ok: false });
    expect(editNotes(dataDir, cwd, { action: "remove", old: "nothing like this" })).toMatchObject({ ok: false });
    expect(editNotes(dataDir, cwd, { action: "add", text: "  " })).toMatchObject({ ok: false });
    expect(editNotes(dataDir, cwd, { action: "rename", text: "x" })).toMatchObject({ ok: false });
    for (let i = 0; i < NOTES_LIMIT / 100; i += 1) editNotes(dataDir, cwd, { action: "add", text: `${i} ${"x".repeat(95)}` });
    expect(editNotes(dataDir, cwd, { action: "add", text: "y".repeat(250) })).toMatchObject({ ok: false, error: expect.stringContaining("full") });
    expect(readNotes(dataDir, cwd).length).toBeLessThanOrEqual(NOTES_LIMIT);
  });

  it("remembers the checks that passed as one note that it keeps up to date", () => {
    const cwd = project("checks");
    editNotes(dataDir, cwd, { action: "add", text: "the API lives in server/" });
    rememberChecks(dataDir, cwd, ["npm run typecheck"]);
    rememberChecks(dataDir, cwd, ["npm run typecheck", "npm test"]);
    expect(readFileSync(notesFile(dataDir, cwd), "utf8")).toBe("- Checks that pass: `npm run typecheck`, `npm test`\n- the API lives in server/\n");
  });

  it("tells the bot its checks, the plan rule and the notes only in coder mode", () => {
    expect(coderRulesPrompt({ enabled: false, checks: ["npm test"] })).toBe("");
    const rules = coderRulesPrompt({ enabled: true, planFirst: true, review: true, checks: ["npm test"] });
    expect(rules).toContain("`npm test`");
    expect(rules).toContain("ask_user");
    expect(rules).toContain("another engine reviews");
    expect(coderRulesPrompt({ enabled: true, checks: [] })).not.toContain("ask_user");
    expect(projectNotesPrompt("")).toBe("");
    expect(projectNotesPrompt("- uses pnpm")).toContain("- uses pnpm");
  });
});
