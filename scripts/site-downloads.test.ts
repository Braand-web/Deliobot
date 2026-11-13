import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";
import { beforeAll, expect, it } from "vitest";

let worker: { fetch(request: Request, env: unknown, ctx: unknown): Promise<Response> };
const payload = new Uint8Array([1, 2, 3, 4, 5, 6]);
const object = { size: payload.length, httpEtag: '"fixture-version"', body: payload };
const env = { DOWNLOADS: {
  head: async () => object,
  get: async (_key: string, options: { range?: { offset: number; length?: number } } = {}) => {
    if (_key.endsWith(".yml")) return { text: async () => "version: 0.1.157\n" };
    const range = options.range;
    return range ? { ...object, range: { offset: range.offset, length: range.length ?? payload.length - range.offset }, body: payload.slice(range.offset, range.length ? range.offset + range.length : undefined) } : object;
  },
} };

beforeAll(async () => {
  execFileSync(process.execPath, [fileURLToPath(new URL("../cloudflare/site/build-worker.mjs", import.meta.url))]);
  worker = (await import("../cloudflare/site/dist/worker.js")).default;
});

it("revalidates stable downloads and feeds after each publication", async () => {
  for (const path of ["Deliobot-Setup.exe", "Deliobot-Windows.zip", "Deliobot.deb", "Deliobot.AppImage", "latest/latest.yml", "latest/latest-linux.yml"]) {
    const response = await worker.fetch(new Request(`https://site.test/download/${path}`, { method: "HEAD" }), env, {});
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-cache");
    expect(response.headers.get("etag")).toBe('"fixture-version"');
  }
});

it("keeps range requests working on the versioned update binary", async () => {
  const response = await worker.fetch(new Request("https://site.test/download/latest/OpenDeliobot-0.1.157-setup.exe", { headers: { range: "bytes=2-4" } }), env, {});
  expect(response.status).toBe(206);
  expect(response.headers.get("content-range")).toBe("bytes 2-4/6");
  expect([...new Uint8Array(await response.arrayBuffer())]).toEqual([3, 4, 5]);
});

it("serves nested landing assets on Windows and refuses download mutations", async () => {
  expect((await worker.fetch(new Request("https://site.test/guides/ventes"), env, {})).status).toBe(200);
  expect((await worker.fetch(new Request("https://site.test/download/Deliobot-Setup.exe", { method: "POST" }), env, {})).status).toBe(405);
});

it.each([["Deliobot-Windows.zip", "x64.zip"], ["Deliobot-Setup.exe", "setup.exe"]])("serves %s from its published version even if the stable object is stale", async (alias, suffix) => {
  const requested: string[] = [];
  const bucket = {
    get: async (key: string) => {
      requested.push(key);
      if (key === "download/latest/latest.yml") return { text: async () => "version: 0.1.157\n" };
      if (key === `download/latest/OpenDeliobot-0.1.157-${suffix}`) return object;
      throw new Error("The old binary must not be used");
    },
  };
  const response = await worker.fetch(new Request(`https://site.test/download/${alias}?v=0.1.157`), { DOWNLOADS: bucket }, {});
  expect(response.status).toBe(200);
  expect(requested).toEqual(["download/latest/latest.yml", `download/latest/OpenDeliobot-0.1.157-${suffix}`]);
  expect([...new Uint8Array(await response.arrayBuffer())]).toEqual([...payload]);
});

it("shows and links each platform's actual published version", async () => {
  const html = readFileSync(new URL("../cloudflare/site/public/index.html", import.meta.url), "utf8");
  const start = html.indexOf("  const releases = [");
  const end = html.indexOf('  document.querySelectorAll("a[data-download]")', start);
  const links = ["Deliobot-Setup.exe", "Deliobot-Windows.zip", "Deliobot.deb"].map(name => ({
    href: `https://site.test/download/${name}`, small: { textContent: name }, querySelector() { return this.small; },
  }));
  const label = { textContent: "" };
  const badge = { hidden: true, querySelector: () => label };
  runInNewContext(html.slice(start, end), {
    os: "Windows", URL, Intl, location: { href: "https://site.test/", origin: "https://site.test" },
    document: { querySelectorAll: (selector: string) => selector === "a[href]" ? links : selector === "[data-release]" ? [badge] : [] },
    fetch: async (url: string) => new Response(`version: ${url.endsWith("latest-linux.yml") ? "0.1.156" : "0.1.157"}\n`),
  });
  await new Promise(resolve => setImmediate(resolve));
  expect(links.map(link => link.href)).toEqual([
    "/download/Deliobot-Setup.exe?v=0.1.157", "/download/Deliobot-Windows.zip?v=0.1.157", "/download/Deliobot.deb?v=0.1.156",
  ]);
  expect(links[0]?.small.textContent).toContain("v0.1.157");
  expect(label.textContent).toContain("Windows · Version 0.1.157");
  expect(badge.hidden).toBe(false);
});
