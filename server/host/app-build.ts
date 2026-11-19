import { existsSync, realpathSync } from "node:fs";
import { join } from "node:path";

import { containedBy } from "../pages/bundle.ts";
import { packageManager, packageScripts, projectCommandEnv, shellFor, trimOutput } from "../coder/verify.ts";
import { execFileInGroupAsync } from "../group-exec.ts";

export const BUILD_TIMEOUT_MS = 10 * 60_000;
const OUTPUT_FOLDERS = ["dist", "build", "out", ".output/public", "public"];
const INSTALL: Record<string, string> = { npm: "npm ci", pnpm: "pnpm install --frozen-lockfile", yarn: "yarn install --frozen-lockfile", bun: "bun install --frozen-lockfile" };

export type BuildResult = { dir: string; built?: { commands: string[]; output: string } } | { error: string };

function installCommand(dir: string): string {
  const runner = packageManager(dir);
  return runner === "npm" && !existsSync(join(dir, "package-lock.json")) ? "npm install" : INSTALL[runner]!;
}

function builtOutput(dir: string): string | null {
  for (const folder of OUTPUT_FOLDERS) {
    const candidate = join(dir, folder);
    if (!existsSync(join(candidate, "index.html"))) continue;
    const real = realpathSync(candidate);
    if (containedBy(dir, real)) return real;
  }
  return null;
}

/** The folder to publish: `dir` itself when it holds index.html, else the output of the project's own build script,
 * after installing its dependencies when they are missing. */
export async function buildForPublish(dir: string, opts: { signal?: AbortSignal; timeoutMs?: number; run?: (command: string, cwd: string) => Promise<string> } = {}): Promise<BuildResult> {
  if (existsSync(join(dir, "index.html"))) return { dir };
  const script = packageScripts(dir).build;
  if (typeof script !== "string") return builtOutput(dir) ? { dir: builtOutput(dir)! } : { dir };
  const run = opts.run ?? (async (command: string, cwd: string) => {
    const [file, args] = shellFor(command);
    const { stdout, stderr } = await execFileInGroupAsync(file, args, {
      cwd, env: projectCommandEnv(), timeout: opts.timeoutMs ?? BUILD_TIMEOUT_MS, maxBuffer: 8 * 1024 * 1024, ...(opts.signal ? { signal: opts.signal } : {}),
    });
    return `${stdout}\n${stderr}`;
  });
  const commands = [...(existsSync(join(dir, "node_modules")) ? [] : [installCommand(dir)]), `${packageManager(dir)} run build`];
  let output = "";
  for (const command of commands) {
    try {
      output += await run(command, dir);
    } catch (error) {
      const failed = error as { stdout?: string; stderr?: string; message?: string };
      return { error: `\`${command}\` failed, so nothing was published. Fix the build, then publish again.\n${trimOutput(`${failed.stdout ?? ""}\n${failed.stderr ?? ""}`.trim() || String(failed.message ?? ""), 4_000)}` };
    }
  }
  const out = builtOutput(dir);
  return out ? { dir: out, built: { commands, output: trimOutput(output, 1_000) } }
    : { error: `The build ran but left no index.html in ${OUTPUT_FOLDERS.join(", ")}. Publish the folder the build writes, with index.html at its top.` };
}
