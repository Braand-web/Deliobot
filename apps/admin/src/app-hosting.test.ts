import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { createIncludedHosting, HostingRefusal } from "../../../server/host/included-hosting.ts";
import { createAppHosting, PASSWORD_ITERATIONS, siteAuth, sitePath, VERSIONS_KEPT, type HostingAccess, type SiteBucket, type SiteManifest } from "./app-hosting.ts";
import { nodeDatabase } from "./sql-node.ts";
import { customHostname, type CustomHostname, type DomainSettings } from "./app-domains.ts";

const cleanups: Array<() => void> = [];
let latestHosting: ReturnType<typeof createAppHosting> | null = null;
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
function relay(access: HostingAccess = { plan: "starter", active: true }, domains?: DomainSettings) {
  const dir = mkdtempSync(join(tmpdir(), "delio-hosting-"));
  const db = nodeDatabase(join(dir, "portal.db"));
  cleanups.push(() => { db.close(); rmSync(dir, { recursive: true, force: true }); });
  const { bucket, objects } = memoryBucket();
  let state = access;
  const hosting = latestHosting = createAppHosting({ db, bucket, sitesSuffix: "-app.example.test", access: () => state, ...(domains ? { domains } : {}) });
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

  it("keeps each publish as a version, puts an earlier one back, and guards an app with a password", async () => {
    const { client, objects } = relay();
    const publish = async (site: Record<string, string>) => {
      const started = await client.start("app-one", { title: "Boutique", files: files(site) });
      for (const sha of started.required) await client.upload("app-one", sha, Buffer.from(Object.values(site).find((text) => sha1(text) === sha)!));
    };
    await publish({ "index.html": "v1" });
    await publish({ "index.html": "v2", "new.html": "n" });
    expect((await client.app("app-one")).version).toBe(2);
    expect((await client.versions("app-one")).map((one) => [one.version, one.files])).toEqual([[2, 2], [1, 1]]);
    const label = new URL((await client.app("app-one")).url!).hostname.split("-")[0]!;
    const served = () => JSON.parse(new TextDecoder().decode(objects.get(`sites/${label}.json`))) as SiteManifest;

    const back = await client.rollback("app-one");
    expect(back.restored).toBe(1);
    expect(back.app.version).toBe(3);
    expect(Object.keys(served().files)).toEqual(["index.html"]);
    expect(served().files["index.html"]!.sha1).toBe(sha1("v1"));
    expect((await client.list()).allowance.publishes.used).toBe(2);
    await expect(client.rollback("app-one", 99)).rejects.toMatchObject({ code: "not_found" });

    const guarded = await client.setPassword("app-one", "a long secret");
    expect(guarded.visibility).toBe("private");
    expect(served().auth).toMatchObject({ iterations: PASSWORD_ITERATIONS });
    expect(served().auth!.hash).toBe(siteAuth("a long secret", served().auth!.salt).hash);
    await publish({ "index.html": "v4" });
    expect(served().auth).toBeTruthy();
    await expect(client.setPassword("app-one", "short")).rejects.toBeInstanceOf(HostingRefusal);
    expect((await client.setPassword("app-one", null)).visibility).toBe("public");
    expect(served().auth).toBeUndefined();

    for (let i = 5; i <= 14; i += 1) await publish({ "index.html": `v${i}` });
    const kept = await client.versions("app-one");
    expect(kept).toHaveLength(VERSIONS_KEPT);
    expect(kept.at(-1)!.version).toBe(5);
  });

  it("points a person's domain at an app, follows its certificate, and lets it go with the app", async () => {
    const made = new Map<string, CustomHostname>();
    const saas = {
      create: async (hostname: string) => { if (hostname === "taken.example.com") throw Object.assign(new Error("dup"), { code: "domain_taken" }); const one = { id: `cf-${made.size}`, status: "pending" as const, detail: null }; made.set(one.id, one); return one; },
      get: async (id: string) => made.get(id) ?? null,
      remove: async (id: string) => { made.delete(id); },
    };
    const { client, objects } = relay(undefined, { saas, target: "domains.example.test", ownSuffix: "-app.example.test" });
    const started = await client.start("app-one", { title: "Boutique", files: files({ "index.html": "v1" }) });
    for (const sha of started.required) await client.upload("app-one", sha, Buffer.from("v1"));
    const label = new URL((await client.app("app-one")).url!).hostname.split("-")[0]!;

    expect(await client.domain("app-one")).toBeNull();
    const set = await client.domain("app-one", "www.Boutique-Awa.com");
    expect(set).toEqual({ hostname: "www.boutique-awa.com", status: "pending", dns: { type: "CNAME", name: "www.boutique-awa.com", target: "domains.example.test" } });
    expect(JSON.parse(new TextDecoder().decode(objects.get("domains/www.boutique-awa.com.json")))).toEqual({ label });
    made.set("cf-0", { id: "cf-0", status: "active", detail: null });
    expect((await client.domain("app-one"))?.status).toBe("active");
    expect((await client.app("app-one")) as unknown).toMatchObject({ key: "app-one" });
    await expect(client.domain("app-one", "taken.example.com")).rejects.toMatchObject({ code: "failed" });
    await expect(client.domain("app-one", "x.example.test")).rejects.toMatchObject({ code: "failed" });
    expect((await client.domain("app-one"))?.hostname).toBe("www.boutique-awa.com");

    await client.remove("app-one");
    expect(made.size).toBe(0);
    expect(objects.has("domains/www.boutique-awa.com.json")).toBe(false);
  });

  it("takes only a real domain the person could own", () => {
    expect(customHostname("Shop.Example.COM.", "-app.deliobot.fun")).toBe("shop.example.com");
    expect(customHostname("example.co.uk", "-app.deliobot.fun")).toBe("example.co.uk");
    for (const bad of ["localhost", "*.example.com", "a..b.com", "-a.example.com", "x.deliobot.fun", "deliobot.fun", "1.2.3.4", "exa mple.com", 42]) {
      expect(customHostname(bad, "-app.deliobot.fun"), String(bad)).toBeNull();
    }
  });

  it("says custom domains are off when the portal has no Cloudflare token for them", async () => {
    const { client } = relay();
    await client.start("app-one", { title: "x", files: files({ "index.html": "a" }) });
    await expect(client.domain("app-one", "www.example.com")).rejects.toMatchObject({ code: "unavailable" });
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

  it("lets the operator take a site down for good: its address stops answering and it cannot be published again", async () => {
    const { client, objects } = relay();
    await client.start("app-one", { title: "x", files: files({ "index.html": "a" }) });
    await client.upload("app-one", sha1("a"), Buffer.from("a"));
    const label = new URL((await client.app("app-one")).url!).hostname.split("-")[0]!;
    expect(objects.has(`sites/${label}.json`)).toBe(true);
    const hosting = latestHosting!;
    expect(hosting.all().map((app) => app.label)).toEqual([label]);
    expect(await hosting.takeDown(label)).toEqual({ workspace: "acme", key: "app-one" });
    expect(objects.has(`sites/${label}.json`)).toBe(false);
    expect((await client.app("app-one")).state).toBe("taken_down");
    await expect(client.start("app-one", { title: "x", files: files({ "index.html": "b" }) })).rejects.toMatchObject({ code: "taken_down" });
  });

  it("names an app from the bot and its folder, as the app keys it", async () => {
    const { client, dir } = relay();
    mkdirSync(join(dir, "site"));
    writeFileSync(join(dir, "site", "index.html"), "x");
    expect(await client.keyFor("bot-1", join(dir, "site"))).toMatch(/^app-[0-9a-f]{32}$/);
  });
});
