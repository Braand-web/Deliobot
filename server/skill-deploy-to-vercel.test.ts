import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { parseSkillMd, scanSkillText } from "../shared/skill-md.ts";
import { loadBundledSkills, selectBundledSkills } from "./skill-library.ts";

const SKILL_DIR = join(process.cwd(), "skills", "deploy-to-vercel");
const helper = await import(pathToFileURL(join(SKILL_DIR, "deploy.mjs")).href) as {
  RECORD_FILE: string;
  uploadable(path: string): boolean;
  projectName(value: string): string;
  apiBase(env: Record<string, string>): string;
  run(argv: string[], env: Record<string, string | undefined>, options?: { pollMs?: number; waitMs?: number; logReadMs?: number }): Promise<Record<string, any>>;
};

const TOKEN = "vercel-test-token-0123456789";
const sha1 = (data: string | Buffer) => createHash("sha1").update(data).digest("hex");

interface Seen { method: string; path: string; headers: IncomingMessage["headers"]; body: Buffer }
let server: Server;
let url = "";
const seen: Seen[] = [];
const stored = new Set<string>();
const deployments = new Map<string, { target?: string; polls: number }>();

beforeAll(async () => {
  server = createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    const body = Buffer.concat(chunks);
    const path = req.url ?? "";
    seen.push({ method: req.method ?? "", path, headers: req.headers, body });
    const send = (status: number, value: unknown, type = "application/json") => { res.writeHead(status, { "content-type": type }); res.end(typeof value === "string" ? value : JSON.stringify(value)); };
    if (req.headers.authorization !== `Bearer ${TOKEN}`) return send(403, { error: { code: "forbidden", message: "Not authorized" } });
    if (req.method === "POST" && path.startsWith("/v2/files")) {
      const digest = String(req.headers["x-vercel-digest"]);
      if (sha1(body) !== digest) return send(400, { error: { code: "bad_digest" } });
      stored.add(digest);
      return send(200, {});
    }
    if (req.method === "POST" && path.startsWith("/v13/deployments")) {
      const input = JSON.parse(body.toString()) as { name: string; files: Array<{ sha: string }>; target?: string };
      const missing = input.files.map((file) => file.sha).filter((sha) => !stored.has(sha));
      if (missing.length) return send(400, { error: { code: "missing_files", message: "Missing files", missing } });
      const id = `dpl_${deployments.size + 1}`;
      deployments.set(id, { ...(input.target ? { target: input.target } : {}), polls: 0 });
      return send(200, { id, url: `${input.name}-${id}.vercel.app`, readyState: "QUEUED", projectId: "prj_1", ...(input.target ? { target: input.target } : {}) });
    }
    const one = /^\/v13\/deployments\/([^/?]+)/.exec(path);
    if (req.method === "GET" && one) {
      const deployment = deployments.get(one[1]!)!;
      deployment.polls += 1;
      return send(200, { id: one[1], url: `shop-${one[1]}.vercel.app`, readyState: deployment.polls > 1 ? "READY" : "BUILDING", ...(deployment.target ? { target: deployment.target, alias: ["shop.vercel.app"] } : {}) });
    }
    if (req.method === "POST" && path.startsWith("/v10/projects/prj_1/env")) return send(200, { created: {} });
    if (req.method === "GET" && /^\/v3\/deployments\/[^/]+\/events/.test(path)) return send(200, [{ type: "stdout", created: 2, text: "Build done" }, { type: "stdout", created: 1, text: "Installing" }]);
    if (req.method === "GET" && path.startsWith("/v1/projects/prj_1/deployments/")) {
      return send(200, [JSON.stringify({ level: "error", message: "TypeError: x is undefined", timestampInMs: 1_800_000_000_000, requestMethod: "GET", requestPath: "/api/cart", responseStatusCode: 500 }), JSON.stringify({ level: "info", message: "ok", timestampInMs: 1_800_000_000_100, requestPath: "/", responseStatusCode: 200 })].join("\n"), "application/stream+json");
    }
    if (req.method === "DELETE" && path.startsWith("/v9/projects/prj_1")) { res.writeHead(204); return res.end(); }
    send(404, { error: { code: "not_found" } });
  });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((done) => server.close(() => done())));

function workspace() {
  const root = mkdtempSync(join(tmpdir(), "odb-vercel-skill-"));
  const project = join(root, "shop");
  mkdirSync(join(project, "src"), { recursive: true });
  writeFileSync(join(project, "package.json"), JSON.stringify({ scripts: { build: "next build" } }));
  writeFileSync(join(project, "src", "page.tsx"), "export default () => 'shop'");
  writeFileSync(join(project, ".env"), "SECRET=1");
  mkdirSync(join(project, "node_modules", "x"), { recursive: true });
  writeFileSync(join(project, "node_modules", "x", "index.js"), "");
  writeFileSync(join(root, "token"), `${TOKEN}\n`);
  writeFileSync(join(root, "db-url"), "postgres://user:pw@db/shop\n");
  return { root, project, tokenFile: join(root, "token"), valueFile: join(root, "db-url") };
}
const env = () => ({ ODB_VERCEL_API_URL: url });
const fast = { pollMs: 1, waitMs: 5_000, logReadMs: 200 };

describe("deploy-to-vercel skill", () => {
  it("is a valid bundled skill the scanner has nothing to say about, picked for Vercel and server-side apps", () => {
    const skills = loadBundledSkills(join(process.cwd(), "skills"));
    const skill = skills.find((entry) => entry.manifest.id === "deploy-to-vercel");
    expect(parseSkillMd(skill!.instructions)).toMatchObject({ name: "deploy-to-vercel" });
    expect(scanSkillText(skill!.instructions)).toEqual([]);
    expect(scanSkillText(readFileSync(join(SKILL_DIR, "deploy.mjs"), "utf8"))).toEqual([]);
    expect(readdirSync(SKILL_DIR).sort()).toEqual(["SKILL.md", "deploy.mjs", "manifest.json"]);
    expect(selectBundledSkills("deploy my Next.js app to vercel", [], skills).map((entry) => entry.manifest.id)).toContain("deploy-to-vercel");
  });

  it("never sends dependencies, dotfiles or secrets, and only talks to Vercel or a loopback stand-in", () => {
    expect(helper.uploadable("src/page.tsx")).toBe(true);
    expect(helper.uploadable(".well-known/security.txt")).toBe(true);
    for (const path of [".env", "node_modules/a.js", ".git/config", "keys/server.pem", ".next/cache", "credentials.json"]) expect(helper.uploadable(path), path).toBe(false);
    expect(helper.apiBase({ ODB_VERCEL_API_URL: "https://evil.example" })).toBe("https://api.vercel.com");
    expect(helper.projectName("My Shop!")).toBe("my-shop");
  });

  it("deploys a preview, uploading only what Vercel lacks, then production when asked, and keeps one project", async () => {
    const { project, tokenFile } = workspace();
    const preview = await helper.run(["--dir", project, "--project", project, "--token-file", tokenFile, "--title", "Boutique"], env(), fast);
    expect(preview).toMatchObject({ ok: true, live: true, target: "preview", project: "shop", created: true, files: 2, uploaded: 2 });
    expect(preview.skipped).toEqual(expect.arrayContaining([".env", "node_modules"]));
    expect(JSON.stringify(preview)).not.toContain(TOKEN);
    const record = readFileSync(join(project, helper.RECORD_FILE), "utf8");
    expect(record).not.toContain(TOKEN);
    expect(JSON.parse(record)).toMatchObject({ projectName: "shop", projectId: "prj_1", title: "Boutique", lastDeployment: { target: "preview" } });

    const production = await helper.run(["--dir", project, "--project", project, "--token-file", tokenFile, "--prod"], env(), fast);
    expect(production).toMatchObject({ ok: true, live: true, target: "production", url: "https://shop.vercel.app", uploaded: 0, created: false });
    const last = seen.filter((one) => one.method === "POST" && one.path.startsWith("/v13/deployments")).at(-1)!;
    expect(JSON.parse(last.body.toString())).toMatchObject({ name: "shop", project: "prj_1", target: "production" });
    expect(await helper.run(["--check", "--project", project, "--token-file", tokenFile], env(), fast)).toMatchObject({ ok: true, state: "READY" });
  });

  it("saves a secret setting from its file without ever showing the value", async () => {
    const { project, tokenFile, valueFile } = workspace();
    await helper.run(["--dir", project, "--project", project, "--token-file", tokenFile], env(), fast);
    const saved = await helper.run(["--env", "DATABASE_URL", "--value-file", valueFile, "--project", project, "--token-file", tokenFile], env(), fast);
    expect(saved).toMatchObject({ ok: true, variable: "DATABASE_URL" });
    expect(JSON.stringify(saved)).not.toContain("postgres://");
    const call = seen.filter((one) => one.path.startsWith("/v10/projects/prj_1/env")).at(-1)!;
    expect(call.path).toContain("upsert=true");
    expect(JSON.parse(call.body.toString())).toEqual({ key: "DATABASE_URL", value: "postgres://user:pw@db/shop", type: "encrypted", target: ["production", "preview"] });
    await expect(helper.run(["--env", "BAD NAME", "--value-file", valueFile, "--project", project, "--token-file", tokenFile], env(), fast)).rejects.toThrow();
  });

  it("reads the build log and the server's recent errors", async () => {
    const { project, tokenFile } = workspace();
    await helper.run(["--dir", project, "--project", project, "--token-file", tokenFile], env(), fast);
    const logs = await helper.run(["--logs", "--project", project, "--token-file", tokenFile], env(), fast);
    expect(logs.build).toEqual(["Installing", "Build done"]);
    expect(logs.errors).toBe(1);
    expect(logs.runtime[0]).toMatchObject({ level: "error", request: "GET /api/cart", status: 500, message: "TypeError: x is undefined" });
  });

  it("refuses to send a file that holds the token, and deletes the project only with its record", async () => {
    const { project, tokenFile } = workspace();
    writeFileSync(join(project, "src", "config.ts"), `export const t = "${TOKEN}";`);
    await expect(helper.run(["--dir", project, "--project", project, "--token-file", tokenFile], env(), fast)).rejects.toThrow(/contains the Vercel token/);
    rmSync(join(project, "src", "config.ts"));
    await helper.run(["--dir", project, "--project", project, "--token-file", tokenFile], env(), fast);
    expect(await helper.run(["--delete", "--project", project, "--token-file", tokenFile], env(), fast)).toMatchObject({ ok: true, deleted: true });
    expect(existsSync(join(project, helper.RECORD_FILE))).toBe(false);
  });
});
