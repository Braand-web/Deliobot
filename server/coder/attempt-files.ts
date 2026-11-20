import { createHash } from "node:crypto";
import { copyFileSync, cpSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, rmSync, symlinkSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";

const SKIPPED = new Set(["node_modules", ".git", ".hg", ".svn", ".next", ".turbo", ".cache", "__pycache__", ".venv", "venv", "target"]);
export const MAX_PROJECT_BYTES = 200 * 1024 * 1024;
export const MAX_PROJECT_FILES = 20_000;

export class AttemptRefusal extends Error {}

/** Every plain file of the project a copy carries, by relative path, with its digest. Links are never followed. */
export function projectFiles(root: string): Map<string, string> {
  const files = new Map<string, string>();
  let bytes = 0;
  const walk = (folder: string) => {
    for (const name of readdirSync(folder)) {
      if (SKIPPED.has(name)) continue;
      const full = join(folder, name);
      const info = lstatSync(full);
      if (info.isDirectory()) { walk(full); continue; }
      if (!info.isFile()) continue;
      bytes += info.size;
      if (bytes > MAX_PROJECT_BYTES || files.size >= MAX_PROJECT_FILES) throw new AttemptRefusal("The project is too large to copy for parallel attempts (200 MB or 20,000 files without its dependencies).");
      files.set(relative(root, full).split(sep).join("/"), createHash("sha1").update(readFileSync(full)).digest("hex"));
    }
  };
  walk(root);
  return files;
}

/** A working copy of the project for one attempt; its dependencies are shared with the original, never copied. */
export function copyProject(source: string, target: string): void {
  mkdirSync(dirname(target), { recursive: true });
  cpSync(source, target, { recursive: true, verbatimSymlinks: true, filter: (path) => !SKIPPED.has(path.split(/[\\/]/).at(-1)!) || path === source });
  if (existsSync(join(source, "node_modules"))) symlinkSync(join(source, "node_modules"), join(target, "node_modules"), "junction");
}

export interface FileChanges { changed: string[]; added: string[]; deleted: string[]; lines: number }

function lineDelta(before: string, after: string): number {
  const counts = new Map<string, number>();
  for (const line of before.split("\n")) counts.set(line, (counts.get(line) ?? 0) + 1);
  let added = 0;
  for (const line of after.split("\n")) {
    const left = counts.get(line) ?? 0;
    if (left > 0) counts.set(line, left - 1);
    else added += 1;
  }
  let removed = 0;
  for (const left of counts.values()) removed += left;
  return added + removed;
}

/** What an attempt changed against the files the project had when the attempts started. */
export function changesFrom(base: Map<string, string>, baseRoot: string, copyRoot: string): FileChanges {
  const now = projectFiles(copyRoot);
  const changes: FileChanges = { changed: [], added: [], deleted: [], lines: 0 };
  const text = (root: string, path: string) => readFileSync(join(root, path), "utf8");
  for (const [path, sha] of now) {
    const before = base.get(path);
    if (before === undefined) { changes.added.push(path); changes.lines += text(copyRoot, path).split("\n").length; }
    else if (before !== sha) { changes.changed.push(path); changes.lines += existsSync(join(baseRoot, path)) ? lineDelta(text(baseRoot, path), text(copyRoot, path)) : 1; }
  }
  for (const path of base.keys()) if (!now.has(path)) { changes.deleted.push(path); changes.lines += 1; }
  for (const list of [changes.changed, changes.added, changes.deleted]) list.sort();
  return changes;
}

export interface AttemptOutcome { index: number; ok: boolean; checksPassed: boolean; changes: FileChanges | null }

/** The attempt to keep: one whose checks pass before one whose checks fail, then the smaller change, then the first. */
export function pickAttempt(outcomes: readonly AttemptOutcome[]): AttemptOutcome | null {
  const usable = outcomes.filter((one) => one.ok && one.changes && one.changes.lines > 0);
  return [...usable].sort((a, b) => Number(b.checksPassed) - Number(a.checksPassed) || a.changes!.lines - b.changes!.lines || a.index - b.index)[0] ?? null;
}

/** Writes the attempt's changes into the project, unless one of those files changed there since the attempts started. */
export function applyChanges(changes: FileChanges, copyRoot: string, projectRoot: string, base: Map<string, string>): { applied: true } | { applied: false; conflicts: string[] } {
  const current = projectFiles(projectRoot);
  const conflicts = [...changes.changed, ...changes.deleted, ...changes.added].filter((path) => current.get(path) !== base.get(path));
  if (conflicts.length) return { applied: false, conflicts };
  for (const path of [...changes.changed, ...changes.added]) {
    mkdirSync(dirname(join(projectRoot, path)), { recursive: true });
    copyFileSync(join(copyRoot, path), join(projectRoot, path));
  }
  for (const path of changes.deleted) rmSync(join(projectRoot, path), { force: true });
  return { applied: true };
}
