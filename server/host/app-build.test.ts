import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

import { buildForPublish } from "./app-build.ts";
import { projectCommandEnv } from "../coder/verify.ts";

const scratch = mkdtempSync(join(tmpdir(), "odb-app-build-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));
const project = (name: string, files: Record<string, string>) => {
  const dir = join(scratch, name);
  for (const [path, text] of Object.entries(files)) { mkdirSync(join(dir, path, ".."), { recursive: true }); writeFileSync(join(dir, path), text); }
  return dir;
};
const vite = JSON.stringify({ scripts: { build: "vite build" } });

describe("building an app before it is published", () => {
  it("publishes a folder that already holds index.html as it is", async () => {
    const dir = project("plain", { "index.html": "<h1>hi</h1>" });
    expect(await buildForPublish(dir, { run: async () => { throw new Error("no build expected"); } })).toEqual({ dir });
  });

  it("installs missing dependencies with the lockfile's tool, runs the build script and publishes its output", async () => {
    const dir = project("shop", { "package.json": vite, "pnpm-lock.yaml": "" });
    const ran: string[] = [];
    const result = await buildForPublish(dir, { run: async (command, cwd) => {
      ran.push(command);
      if (command.endsWith("run build")) project("shop", { "dist/index.html": "<h1>shop</h1>" });
      expect(cwd).toBe(dir);
      return "ok";
    } });
    expect(ran).toEqual(["pnpm install --frozen-lockfile", "pnpm run build"]);
    expect(result).toMatchObject({ dir: join(dir, "dist"), built: { commands: ran } });
  });

  it("says what failed, and refuses a build that leaves no page", async () => {
    const broken = project("broken", { "package.json": vite, "node_modules/.keep": "" });
    const failed = await buildForPublish(broken, { run: async () => { throw Object.assign(new Error("exit 1"), { stderr: "src/main.ts: Unexpected token" }); } });
    expect(failed).toMatchObject({ error: expect.stringContaining("Unexpected token") });
    const empty = project("empty", { "package.json": vite, "node_modules/.keep": "" });
    expect(await buildForPublish(empty, { run: async () => "" })).toMatchObject({ error: expect.stringContaining("no index.html") });
  });

  it("gives the project's commands what a build needs and none of the server's own settings", () => {
    const env = projectCommandEnv({ PATH: "/usr/bin", HOME: "/home/a", HTTPS_PROXY: "http://proxy", ODB_COMMS_TOKEN: "secret", ANTHROPIC_API_KEY: "k" });
    expect(env).toEqual({ PATH: "/usr/bin", HOME: "/home/a", HTTPS_PROXY: "http://proxy", CI: "1", FORCE_COLOR: "0" });
  });
});
