// Python for the bots' shell in the packaged desktop app: the bundled uv goes on PATH, and where the computer has no
// Python 3, uv installs one into Delio's data folder in the background and that goes on PATH too. Nothing outside the
// data folder is changed, and a Python the person already has always wins.
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readlinkSync, rmSync, symlinkSync } from "node:fs";
import { delimiter, dirname, join } from "node:path";

export const PYTHON_VERSION = "3.12";

export interface PythonRuntimeOptions {
  env?: NodeJS.ProcessEnv;
  dataDir: string;
  platform?: NodeJS.Platform;
  log?: (line: string) => void;
  run?: typeof spawnSync;
  launch?: typeof spawn;
}

const pathKey = (env: NodeJS.ProcessEnv) => Object.keys(env).find((key) => key.toUpperCase() === "PATH") ?? "PATH";

/** Puts `dir` first on PATH, once. */
export function prependPath(env: NodeJS.ProcessEnv, dir: string): void {
  const key = pathKey(env);
  const parts = (env[key] ?? "").split(delimiter).filter(Boolean);
  if (parts[0] === dir) return;
  env[key] = [dir, ...parts.filter((part) => part !== dir)].join(delimiter);
}

/** True when `python3` (or `python` on Windows) on this PATH is a working Python 3. Windows' Store alias is not. */
export function hasPython(env: NodeJS.ProcessEnv, platform: NodeJS.Platform = process.platform, run: typeof spawnSync = spawnSync): boolean {
  for (const command of platform === "win32" ? ["python", "py"] : ["python3", "python"]) {
    const result = run(command, ["--version"], { env, encoding: "utf8", timeout: 10_000, windowsHide: true });
    if (result.status === 0 && /Python 3\./.test(`${result.stdout ?? ""}${result.stderr ?? ""}`)) return true;
  }
  return false;
}

/** Where `python3` and `python` point on macOS and Linux: links in Delio's own bin folder. */
function linkInterpreter(bin: string, interpreter: string): void {
  mkdirSync(bin, { recursive: true });
  for (const name of ["python3", "python"]) {
    const link = join(bin, name);
    try { if (readlinkSync(link) === interpreter) continue; } catch { /* absent or not a link */ }
    rmSync(link, { force: true });
    symlinkSync(interpreter, link);
  }
}

/** Starts the work; returns at once. The PATH changes apply to every process the server starts afterwards. */
export function startPythonRuntime(options: PythonRuntimeOptions): void {
  const env = options.env ?? process.env;
  const platform = options.platform ?? process.platform;
  const run = options.run ?? spawnSync;
  const resources = env.ODB_RESOURCES_PATH;
  if (!resources) return;
  const uvDir = join(resources, "uv");
  const uv = join(uvDir, platform === "win32" ? "uv.exe" : "uv");
  if (!existsSync(uv)) return;
  prependPath(env, uvDir);
  if (hasPython(env, platform, run)) return;

  const root = join(options.dataDir, "python");
  const uvEnv = { ...env, UV_PYTHON_INSTALL_DIR: join(root, "installs"), UV_CACHE_DIR: join(root, "cache"), UV_NO_CONFIG: "1", UV_PYTHON_PREFERENCE: "only-managed" };
  const find = (): string | null => {
    const found = run(uv, ["python", "find", PYTHON_VERSION], { env: uvEnv, encoding: "utf8", timeout: 20_000, windowsHide: true });
    const path = found.status === 0 ? `${found.stdout ?? ""}`.trim().split(/\r?\n/).pop() ?? "" : "";
    return path && existsSync(path) ? path : null;
  };
  const expose = (interpreter: string) => {
    if (platform === "win32") prependPath(env, dirname(interpreter));
    else {
      const bin = join(root, "bin");
      linkInterpreter(bin, interpreter);
      prependPath(env, bin);
    }
  };

  const installed = find();
  if (installed) { expose(installed); return; }
  options.log?.(`python: none on this computer; installing Python ${PYTHON_VERSION} for the bots`);
  const child = (options.launch ?? spawn)(uv, ["python", "install", PYTHON_VERSION], { env: uvEnv, stdio: "ignore", windowsHide: true });
  child.on("error", (error) => options.log?.(`python: could not start the install: ${error.message}`));
  child.on("exit", (code) => {
    const interpreter = code === 0 ? find() : null;
    if (interpreter) { expose(interpreter); options.log?.(`python: Python ${PYTHON_VERSION} is ready for the bots`); }
    else options.log?.(`python: the install did not finish (exit ${code}); it is tried again at the next start`);
  });
}
