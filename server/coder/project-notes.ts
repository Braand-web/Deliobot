import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, realpathSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

import { writeFileAtomic } from "../atomic.ts";

export const NOTES_LIMIT = 4_000;
const LINE_LIMIT = 300;
const CHECKS_PREFIX = "- Checks that pass: ";

function canonical(path: string): string {
  try { return realpathSync.native(path); } catch { return path; }
}

/** Kept in Deliobot's data folder, never in the person's project. */
export function notesFile(dataDir: string, cwd: string): string {
  return join(dataDir, "projects", createHash("sha256").update(canonical(resolve(cwd))).digest("hex").slice(0, 16), "NOTES.md");
}

export function readNotes(dataDir: string, cwd: string): string {
  const file = notesFile(dataDir, cwd);
  try { return existsSync(file) ? readFileSync(file, "utf8").trim() : ""; } catch { return ""; }
}

function save(dataDir: string, cwd: string, lines: readonly string[]): void {
  const file = notesFile(dataDir, cwd);
  mkdirSync(dirname(file), { recursive: true });
  writeFileAtomic(file, lines.length ? `${lines.join("\n")}\n` : "", { mode: 0o600 });
}

const linesOf = (notes: string) => notes.split("\n").map((line) => line.trimEnd()).filter(Boolean);
const oneLine = (text: unknown) => typeof text === "string" ? text.replace(/\s+/g, " ").trim() : "";

export type NoteEdit = { action?: unknown; text?: unknown; old?: unknown };
export type NoteResult = { ok: true; notes: string } | { ok: false; error: string };

export function editNotes(dataDir: string, cwd: string, edit: NoteEdit): NoteResult {
  const lines = linesOf(readNotes(dataDir, cwd));
  const text = oneLine(edit.text), old = oneLine(edit.old);
  const matching = old ? lines.filter((line) => line.includes(old)) : [];
  if (edit.action === "remove" || edit.action === "replace") {
    if (!old) return { ok: false, error: `project_note ${edit.action} needs old: words from the one note to change.` };
    if (matching.length !== 1) return { ok: false, error: matching.length ? "Several notes hold those words; quote more of the one you mean." : "No note holds those words." };
  }
  if (edit.action !== "remove" && (!text || text.length > LINE_LIMIT)) return { ok: false, error: `A note is one line of 1 to ${LINE_LIMIT} characters.` };
  const note = `- ${text.replace(/^[-*]\s*/, "")}`;
  const next = edit.action === "remove" ? lines.filter((line) => line !== matching[0])
    : edit.action === "replace" ? lines.map((line) => line === matching[0] ? note : line)
      : edit.action === "add" || edit.action === undefined ? [...lines, note] : null;
  if (!next) return { ok: false, error: "project_note's action is add, replace or remove." };
  if (next.join("\n").length > NOTES_LIMIT) return { ok: false, error: `The project's notes are full (${NOTES_LIMIT} characters): replace or remove an old one first.` };
  save(dataDir, cwd, next);
  return { ok: true, notes: next.join("\n") };
}

/** The checks that last passed, as one note the person and the bot can read. */
export function rememberChecks(dataDir: string, cwd: string, commands: readonly string[]): void {
  if (!commands.length) return;
  const line = `${CHECKS_PREFIX}${commands.map((command) => `\`${command}\``).join(", ")}`.slice(0, LINE_LIMIT + 2);
  const lines = linesOf(readNotes(dataDir, cwd));
  const at = lines.findIndex((one) => one.startsWith(CHECKS_PREFIX));
  if (at >= 0 && lines[at] === line) return;
  const next = at >= 0 ? lines.map((one, index) => index === at ? line : one) : [line, ...lines];
  if (next.join("\n").length <= NOTES_LIMIT) save(dataDir, cwd, next);
}

export interface CoderPromptInput { enabled: boolean; planFirst?: boolean; checks: readonly string[]; review?: boolean; previewUrl?: string }

/** Stable for a bot's settings, so its cached prompt prefix survives from turn to turn. */
export function coderRulesPrompt(input: CoderPromptInput): string {
  if (!input.enabled) return "";
  const lines = [
    "\n\nCoder mode is on for this bot.",
    input.checks.length
      ? `After any turn that changes files, Deliobot runs these checks in the project: ${input.checks.map((command) => `\`${command}\``).join(", ")}. A failure comes back to you as the next message; fix the cause in the code and never weaken, skip or delete a check.`
      : "After any turn that changes files, Deliobot runs the project's own checks (typecheck, lint, tests, build) when it finds them. A failure comes back to you as the next message; fix the cause in the code and never weaken, skip or delete a check.",
    ...(input.review ? ["Once the checks pass, another engine reviews your diff and its blocking findings come back to you."] : []),
    ...(input.planFirst ? ["Before you change any file for a new request, write a short plan (files to touch, approach, how you will check it) and ask the person with ask_user, offering Approve and Change. Edit nothing until they approve. A message carrying failed checks or review findings continues approved work and needs no new plan."] : []),
    "Use project_note to keep this project's lasting facts for your next conversations here: how to build, test and run it, its conventions, and pitfalls you hit. One line each; replace a note that turned out wrong.",
  ];
  return lines.join("\n");
}

export function projectNotesPrompt(notes: string): string {
  return notes ? `\n\nWhat earlier conversations learned about this project (your project notes):\n${notes.slice(0, NOTES_LIMIT)}` : "";
}
