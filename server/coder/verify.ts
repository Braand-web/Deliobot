import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { stripVTControlCharacters } from "node:util";

import { execFileInGroupAsync } from "../group-exec.ts";

export const CHECK_TIMEOUT_MS = 5 * 60_000;
export const CHECK_OUTPUT_LIMIT = 8_000;
const SCRIPT_ORDER = ["typecheck", "lint", "test", "build"] as const;

export interface CheckResult { command: string; ok: boolean; output: string; timedOut?: boolean }
export interface CheckRun { ok: boolean; results: CheckResult[] }

export function packageManager(cwd: string): string {
  if (existsSync(join(cwd, "pnpm-lock.yaml"))) return "pnpm";
  if (existsSync(join(cwd, "yarn.lock"))) return "yarn";
  if (existsSync(join(cwd, "bun.lockb")) || existsSync(join(cwd, "bun.lock"))) return "bun";
  return "npm";
}

export function packageScripts(cwd: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(readFileSync(join(cwd, "package.json"), "utf8")) as { scripts?: Record<string, unknown> };
    return parsed.scripts && typeof parsed.scripts === "object" ? parsed.scripts : {};
  } catch {
    return {};
  }
}

/** The project's own checks, read from its files: package scripts first, then the usual Python, Rust, Go and make ones. */
export function detectChecks(cwd: string): string[] {
  if (existsSync(join(cwd, "package.json"))) {
    const scripts = packageScripts(cwd);
    const runner = packageManager(cwd);
    const found = SCRIPT_ORDER.filter((name) => typeof scripts[name] === "string" && !/\bwatch\b|--watch/.test(String(scripts[name])));
    const tsc = !scripts.typecheck && existsSync(join(cwd, "tsconfig.json")) ? ["npx tsc --noEmit"] : [];
    return [...tsc, ...found.map((name) => `${runner} run ${name}`)];
  }
  if (existsSync(join(cwd, "pyproject.toml")) || existsSync(join(cwd, "pytest.ini")) || existsSync(join(cwd, "setup.py"))) return ["python -m pytest -q"];
  if (existsSync(join(cwd, "Cargo.toml"))) return ["cargo test"];
  if (existsSync(join(cwd, "go.mod"))) return ["go test ./..."];
  if (existsSync(join(cwd, "Makefile")) && /^test:/m.test(readFileSync(join(cwd, "Makefile"), "utf8"))) return ["make test"];
  return [];
}

/** The start and the end of a long output, where a failure usually says what went wrong. */
export function trimOutput(text: string, limit = CHECK_OUTPUT_LIMIT): string {
  const clean = stripVTControlCharacters(text).trim();
  if (clean.length <= limit) return clean;
  const head = Math.floor(limit * 0.3);
  return `${clean.slice(0, head)}\n…\n${clean.slice(clean.length - (limit - head))}`;
}

const PROJECT_ENV_KEYS = new Set([
  "PATH", "PATHEXT", "HOME", "USERPROFILE", "APPDATA", "LOCALAPPDATA", "PROGRAMDATA", "SYSTEMROOT", "WINDIR", "COMSPEC", "TEMP", "TMP", "TMPDIR",
  "LANG", "LC_ALL", "LC_CTYPE", "SHELL", "USER", "USERNAME", "LOGNAME", "HTTP_PROXY", "HTTPS_PROXY", "NO_PROXY", "ALL_PROXY",
  "NODE_EXTRA_CA_CERTS", "SSL_CERT_FILE", "NPM_CONFIG_CACHE", "XDG_CACHE_HOME", "XDG_CONFIG_HOME", "XDG_DATA_HOME",
]);

/** Security: a project's own commands get what a build needs, never the server's own settings or keys. */
export function projectCommandEnv(base: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(base)) if (value !== undefined && PROJECT_ENV_KEYS.has(key.toUpperCase())) env[key] = value;
  return { ...env, CI: "1", FORCE_COLOR: "0" };
}

export function shellFor(command: string): [string, string[]] {
  return process.platform === "win32" ? [process.env.ComSpec || "cmd.exe", ["/d", "/s", "/c", command]] : ["/bin/sh", ["-c", command]];
}

export async function runChecks(cwd: string, commands: readonly string[], opts: { signal?: AbortSignal; timeoutMs?: number } = {}): Promise<CheckRun> {
  const results: CheckResult[] = [];
  for (const command of commands) {
    if (opts.signal?.aborted) break;
    const [file, args] = shellFor(command);
    try {
      const { stdout, stderr } = await execFileInGroupAsync(file, args, {
        cwd, env: projectCommandEnv(), timeout: opts.timeoutMs ?? CHECK_TIMEOUT_MS, maxBuffer: 4 * 1024 * 1024, signal: opts.signal,
      });
      results.push({ command, ok: true, output: trimOutput(`${stdout}\n${stderr}`, 1_000) });
    } catch (error) {
      const failed = error as { stdout?: string; stderr?: string; killed?: boolean; message?: string };
      results.push({ command, ok: false, output: trimOutput(`${failed.stdout ?? ""}\n${failed.stderr ?? ""}`.trim() || String(failed.message ?? "")), ...(failed.killed ? { timedOut: true } : {}) });
    }
  }
  return { ok: results.every((result) => result.ok), results };
}

/** What the bot reads when its change broke a check. */
export function failureMessage(run: CheckRun, round: number, maxRounds: number): string {
  const failed = run.results.filter((result) => !result.ok);
  const lines = [
    `Deliobot ran this project's checks after your change and ${failed.length === 1 ? "one failed" : `${failed.length} failed`} (round ${round} of ${maxRounds}).`,
    "Fix the cause in the code, without weakening, skipping or deleting the checks, then stop: they run again on their own.",
  ];
  for (const result of failed) lines.push("", `$ ${result.command}${result.timedOut ? " (stopped: it ran too long)" : ""}`, result.output || "(no output)");
  return lines.join("\n");
}
