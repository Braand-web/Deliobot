import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { createIncludedHosting, HostingRefusal } from "../../../server/host/included-hosting.ts";
import { createAppHosting, sitePath, type HostingAccess, type SiteBucket, type SiteManifest } from "./app-hosting.ts";
import { nodeDatabase } from "./sql-node.ts";

const cleanups: Array<() => void> = [];
afterEach(() => { for (const cleanup of cleanups.splice(0)) cleanup(); });

function memoryBucket() {
  const objects = new Map<string, Uint8Array>();
  const bucket: SiteBucket = {
    has: async (key) => objects.has(key),
    put: async (key, bytes) => { objects.set(key, bytes); },
    delete: async (key) => { objects.delete(key); },
  };
  return { bucket, objects };
}

/** The portal's relay behind a fetch, as the app's included-hosting client reaches it through the gateway. */
function relay(access: HostingAccess = { plan: "starter", active: true }) {
  const dir = mkdtempSync(join(tmpdir(), "delio-hosting-"));
  const db = nodeDatabase(join(dir, "portal.db"));
  cleanups.push(() => { db.close(); rmSync(dir, { recursive: true, force: true }); });
  const { bucket, objects } = memoryBucket();
  let state = access;
  const hosting = createAppHosting({ db, bucket, sitesSuffix: "-app.example.test", access: () => state });
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    const rest = url.pathname.replace(/^\/api\/gateway\/acme\/hosting\/v1\//, "");
    const raw = init?.body === undefined ? Buffer.alloc(0) : typeof init.body === "string" ? Buffer.from(init.body) : Buffer.from(init.body as Uint8Array);
    const req = { method: init?.method ?? "GET", headers: {}, async *[Symbol.asyncIterator]() { if (raw.length) yield raw; } } as unknown as IncomingMessage;
    let status = 200, text = "";
    const res = { statusCode: 200, headersSent: false, setHeader() {}, end(body?: string) { status = res.statusCode; text = body ?? ""; } } as unknown as ServerResponse;
    await hosting.handle(req, res, "acme", rest);
    return new Response(text, { status, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  const client = createIncludedHosting({ credential: () => ({ token: "odb_device_x", api: "https://portal.test/api/gateway/acme/hosting/v1", included: true }), fetch: fetchImpl, dataDir: dir });
  return { client, objects, dir, setAccess: (next: HostingAccess) => { state = next; } };
}

const sha1 = (text: string) => createHash("sha1").update(text).digest("hex");
const files = (entries: Record<string, string>) => Object.entries(entries).map(([path, text]) => ({ path, sha1: sha1(text), size: Buffer.byteLength(text) }));

describe("included app hosting", () => {
  it("publishes a site the app's client sends, uploading only the files the bucket lacks, at its own subdomain", async () => {
    const { client, objects } = relay();
    const site = { "index.html": "<h1>Bonjour</h1>", "app.js": "console.log(1)" };
    const started = await client.start("app-one", { title: "Ma page", files: files(site) });
    expect(started.created).toBe(true);
    expect(started.required.sort()).toEqual([sha1(site["index.html"]), sha1(site["app.js"])].sort());
    expect(started.app.url).toBeNull();
    for (const [, text] of Object.entries(site)) await client.upload("app-one", sha1(text), Buffer.from(text));

    const app = await client.app("app-one");
    expect(app.state).toBe("ready");
    expect(app.url).toMatch(/^https:\/\/[a-z2-9]{10}-app\.example\.test\/$/);
    const label = new URL(app.url!).hostname.split("-")[0]!;
    const manifest = JSON.parse(new TextDecoder().decode(objects.get(`sites/${label}.json`))) as SiteManifest;
    expect(manifest.files["index.html"]).toEqual({ sha1: sha1(site["index.html"]), type: "text/html; charset=utf-8" });

    const again = await client.start("app-one", { title: "Ma page", files: files({ ...site, "about.html": "x" }) });
    expect(again.created).toBe(false);
    expect(again.required).toEqual([sha1("x")]);
    const { apps, allowance } = await client.list();
    expect(apps.map((one) => one.key)).toEqual(["app-one"]);
    expect(allowance.apps).toEqual({ used: 1, max: 2 });
    expect(allowance.publishes.used).toBe(1);
  });

  it("refuses a file whose bytes are not the ones announced", async () => {
    const { client } = relay();
    await client.start("app-one", { title: "x", files: files({ "index.html": "real" }) });
    await expect(client.upload("app-one", sha1("real"), Buffer.from("fake"))).rejects.toMatchObject({ code: "failed" });
  });

  it("needs an index.html and plain relative paths", async () => {
    const { client } = relay();
    await expect(client.start("app-one", { title: "x", files: files({ "page.html": "a" }) })).rejects.toMatchObject({ code: "invalid_files" });
    expect(sitePath("../secret")).toBeNull();
    expect(sitePath("a//b")).toBeNull();
    expect(sitePath("a/b.html")).toBe("a/b.html");
  });

  it("keeps to the plan's number of apps, and says when the plan does not include hosting or has ended", async () => {
    const { client, setAccess } = relay();
    for (const key of ["app-one", "app-two"]) await client.start(key, { title: key, files: files({ "index.html": key }) });
    await expect(client.start("app-three", { title: "x", files: files({ "index.html": "3" }) })).rejects.toMatchObject({ code: "apps_limit_reached", ownNetlify: true });
    setAccess({ plan: "trial", active: false, ended: false });
    await expect(client.list()).rejects.toMatchObject({ code: "not_included" });
    setAccess({ plan: "pro", active: false, ended: true });
    await expect(client.list()).rejects.toMatchObject({ code: "plan_ended" });
  });

  it("takes a deleted app offline", async () => {
    const { client, objects } = relay();
    await client.start("app-one", { title: "x", files: files({ "index.html": "a" }) });
    await client.upload("app-one", sha1("a"), Buffer.from("a"));
    const label = new URL((await client.app("app-one")).url!).hostname.split("-")[0]!;
    await client.remove("app-one");
    expect(objects.has(`sites/${label}.json`)).toBe(false);
    await expect(client.app("app-one")).rejects.toBeInstanceOf(HostingRefusal);
  });

  it("names an app from the bot and its folder, as the app keys it", async () => {
    const { client, dir } = relay();
    mkdirSync(join(dir, "site"));
    writeFileSync(join(dir, "site", "index.html"), "x");
    expect(await client.keyFor("bot-1", join(dir, "site"))).toMatch(/^app-[0-9a-f]{32}$/);
  });
});
