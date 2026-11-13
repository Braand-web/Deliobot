import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { closeSync, existsSync, mkdtempSync, openSync, readFileSync, readSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
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

it("publishes a release through the Worker while stable links still select the previous feed", async () => {
  const folder = mkdtempSync(join(tmpdir(), "delio-publish-fixture-"));
  try {
    const version = "0.0.2";
    const files = [`OpenDeliobot-${version}-setup.exe`, `OpenDeliobot-${version}-setup.exe.blockmap`, `OpenDeliobot-${version}-x64.zip`,
      `OpenDeliobot-${version}-x86_64.AppImage`, `OpenDeliobot-${version}-amd64.deb`, "SHA256SUMS-ubuntu-x64.txt"];
    for (const file of files) writeFileSync(join(folder, file), `fixture ${file}`);
    for (const file of ["latest.yml", "latest-linux.yml"]) writeFileSync(join(folder, file), `version: ${version}\n`);
    const objects = new Map<string, Buffer>();
    for (const file of ["latest.yml", "latest-linux.yml"]) objects.set(`download/latest/${file}`, Buffer.from("version: 0.0.1\n"));
    for (const suffix of ["setup.exe", "x64.zip", "amd64.deb", "x86_64.AppImage"]) objects.set(`download/latest/OpenDeliobot-0.0.1-${suffix}`, Buffer.from("old fixture"));
    const uploads = new Map<string, Map<number, Buffer>>();
    const objectAt = (key: string, options: { range?: { offset: number; length?: number } } = {}) => {
      const data = objects.get(key);
      if (!data) return null;
      const range = options.range;
      return { key, size: data.length, httpEtag: `"${createHash("sha256").update(data).digest("hex")}"`, text: async () => data.toString(),
        body: range ? data.subarray(range.offset, range.length ? range.offset + range.length : undefined) : data,
        ...(range ? { range: { offset: range.offset, length: range.length ?? data.length - range.offset } } : {}) };
    };
    const bucket = {
      head: async (key: string) => objectAt(key),
      get: async (key: string, options?: { range?: { offset: number; length?: number } }) => objectAt(key, options),
      createMultipartUpload: async (key: string) => { uploads.set(key, new Map()); return { uploadId: key }; },
      resumeMultipartUpload: (key: string, id: string) => {
        expect(id).toBe(key);
        return {
          uploadPart: async (partNumber: number, body: BodyInit) => {
            uploads.get(key)!.set(partNumber, Buffer.from(await new Response(body).arrayBuffer()));
            return { partNumber, etag: `part-${partNumber}` };
          },
          complete: async (parts: Array<{ partNumber: number }>) => {
            objects.set(key, Buffer.concat(parts.map(part => uploads.get(key)!.get(part.partNumber)!)));
            return objectAt(key);
          },
        };
      },
    };
    const token = "fixture-upload-token-".repeat(3);
    const lines: string[] = [];
    const source = readFileSync(new URL("./publish-downloads.mjs", import.meta.url), "utf8").replace(/^import[^\n]+;\r?\n/gm, "");
    expect(source).not.toMatch(/^import /m);
    await runInNewContext(`(async () => { ${source} })()`, {
      process: { argv: ["node", "publish-downloads.mjs", folder], env: { DELIO_UPLOAD_TOKEN: token } },
      createHash, closeSync, existsSync, openSync, readFileSync, readSync, statSync, basename, join, Buffer,
      console: { log: (line: string) => lines.push(line) }, setTimeout,
      fetch: async (url: string, init?: RequestInit) => {
        expect(new URL(url).origin).toBe("https://deliobot.fun");
        return worker.fetch(new Request(url, init), { DOWNLOADS: bucket, UPLOAD_TOKEN: token }, {});
      },
    });
    expect(objects.get(`download/latest/OpenDeliobot-${version}-x64.zip`)).toEqual(readFileSync(join(folder, `OpenDeliobot-${version}-x64.zip`)));
    expect(objects.get("download/latest/latest.yml")?.toString()).toBe("version: 0.0.2\n");
    expect(objects.get("download/latest/latest-linux.yml")?.toString()).toBe("version: 0.0.2\n");
    expect(lines.at(-1)).toBe("deliobot.fun now offers 0.0.2");
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
});
