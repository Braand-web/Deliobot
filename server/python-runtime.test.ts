import { EventEmitter } from "node:events";
import { mkdirSync, mkdtempSync, readlinkSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import type { spawn, spawnSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";

import { hasPython, prependPath, startPythonRuntime } from "./python-runtime.ts";

const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });

function setup() {
  const root = mkdtempSync(join(tmpdir(), "odb-python-"));
  dirs.push(root);
  const resources = join(root, "resources"), data = join(root, "data");
  mkdirSync(join(resources, "uv"), { recursive: true });
  writeFileSync(join(resources, "uv", "uv"), "");
  const interpreter = join(root, "managed", "bin", "python3.12");
  mkdirSync(join(root, "managed", "bin"), { recursive: true });
  writeFileSync(interpreter, "");
  return { root, resources, data, interpreter };
}

const answer = (status: number, stdout = "") => ({ status, stdout, stderr: "", pid: 1, output: [], signal: null }) as unknown as ReturnType<typeof spawnSync>;

describe("Python for the bots in the desktop app", () => {
  it("puts uv on PATH and installs nothing when the computer has Python", () => {
    const { resources, data } = setup();
    const env: NodeJS.ProcessEnv = { ODB_RESOURCES_PATH: resources, PATH: "/usr/bin" };
    const calls: string[][] = [];
    const run = ((command: string, args: string[]) => { calls.push([command, ...args]); return answer(0, "Python 3.11.4"); }) as unknown as typeof spawnSync;
    let launched = false;
    startPythonRuntime({ env, dataDir: data, platform: "linux", run, launch: (() => { launched = true; }) as unknown as typeof spawn });
    expect(env.PATH).toBe([join(resources, "uv"), "/usr/bin"].join(delimiter));
    expect(launched).toBe(false);
  });

  it("installs Python with uv where there is none, then links python and python3 on PATH", () => {
    const { resources, data, interpreter } = setup();
    const env: NodeJS.ProcessEnv = { ODB_RESOURCES_PATH: resources, PATH: "/usr/bin" };
    let installed = false;
    const run = ((_command: string, args: string[]) => {
      if (args[0] === "--version") return answer(1);
      if (args[0] === "python" && args[1] === "find") return installed ? answer(0, `${interpreter}\n`) : answer(2);
      return answer(1);
    }) as unknown as typeof spawnSync;
    const child = new EventEmitter();
    const launches: string[][] = [];
    const launch = ((command: string, args: string[]) => { launches.push([command, ...args]); return child; }) as unknown as typeof spawn;
    startPythonRuntime({ env, dataDir: data, platform: "linux", run, launch });
    expect(launches).toEqual([[join(resources, "uv", "uv"), "python", "install", "3.12"]]);
    installed = true;
    child.emit("exit", 0);
    const bin = join(data, "python", "bin");
    expect(readlinkSync(join(bin, "python3"))).toBe(interpreter);
    expect(readlinkSync(join(bin, "python"))).toBe(interpreter);
    expect(env.PATH?.split(delimiter)[0]).toBe(bin);
  });

  it("does nothing outside the packaged app", () => {
    const env: NodeJS.ProcessEnv = { PATH: "/usr/bin" };
    startPythonRuntime({ env, dataDir: "/nowhere", platform: "linux" });
    expect(env.PATH).toBe("/usr/bin");
  });

  it("does not take Windows' Store alias for Python, and keeps PATH entries once", () => {
    const run = (() => answer(9009, "")) as unknown as typeof spawnSync;
    expect(hasPython({}, "win32", run)).toBe(false);
    const env: NodeJS.ProcessEnv = { Path: ["/opt/a", "/opt/b"].join(delimiter) };
    prependPath(env, "/opt/b");
    expect(env.Path).toBe(["/opt/b", "/opt/a"].join(delimiter));
  });
});
