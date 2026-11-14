import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readPublicUrl } from "./public-web.ts";
import type { PageFetchOptions } from "./wait-probes.ts";

let server: Server, base = "";
const requests: Array<{ path: string; method: string; cookie?: string; auth?: string }> = [];
beforeAll(async () => {
  server = createServer((req, res) => {
    requests.push({ path: req.url!, method: req.method!, cookie: req.headers.cookie, auth: req.headers.authorization });
    if (req.url === "/redirect") { res.writeHead(302, { location: "/page" }); return res.end(); }
    if (req.url === "/private") { res.writeHead(302, { location: "http://169.254.169.254/latest/meta-data" }); return res.end(); }
    if (req.url === "/binary") { res.writeHead(200, { "content-type": "application/octet-stream" }); return res.end(Buffer.from([0, 1, 2])); }
    res.writeHead(200, { "content-type": "text/html; charset=utf-8", "set-cookie": "secret=fixture" });
    res.end("<html><title>Public fixture</title><script>secretScript()</script><style>hidden style</style><p>Bonjour &amp; bienvenue</p>" + "Suite ".repeat(100) + "</html>");
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  base = `http://public.fixture.test:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>(resolve => server.close(() => resolve())));
const options: PageFetchOptions = { lookup: async () => [{ address: "127.0.0.1", family: 4 }], allow: ({ host }) => host === "public.fixture.test" };
const input = (url: string, offset = 0) => ({ url, offset, max_chars: 256 });

describe("native public URL reading", () => {
  it("reads and pages HTML with GET only, without cookies, sign-in or script execution", async () => {
    const first = await readPublicUrl(input(base + "/page"), options);
    expect(first).toMatchObject({ ok: true, untrusted: true, offset: 0, next_offset: 256, truncated: false });
    if (!first.ok) throw new Error(first.error);
    expect(first.text).toContain("Bonjour & bienvenue");
    expect(first.text).not.toContain("secretScript");
    expect(first.text).not.toContain("hidden style");
    const next = await readPublicUrl(input(base + "/page", first.next_offset), options);
    expect(next).toMatchObject({ ok: true, offset: 256 });
    expect(requests.slice(-2)).toEqual([expect.objectContaining({ method: "GET", cookie: undefined, auth: undefined }), expect.objectContaining({ method: "GET", cookie: undefined, auth: undefined })]);
  });
  it("returns the final public URL after a redirect", async () => {
    expect(await readPublicUrl(input(base + "/redirect"), options)).toMatchObject({ ok: true, url: base + "/page" });
  });
  it.each(["http://127.0.0.1/", "http://[::1]/", "http://169.254.169.254/", "file:///etc/passwd", "https://user:password@example.com/"])("refuses %s", async url => {
    expect(await readPublicUrl(input(url))).toMatchObject({ ok: false, refused: true });
  });
  it("refuses DNS answers that point at the local machine before sending a request", async () => {
    const count = requests.length;
    expect(await readPublicUrl(input(base + "/page"), { lookup: options.lookup })).toMatchObject({ ok: false, refused: true });
    expect(requests).toHaveLength(count);
  });
  it("does not follow a redirect into the metadata network", async () => {
    const count = requests.length;
    expect(await readPublicUrl(input(base + "/private"), options)).toMatchObject({ ok: false, refused: true });
    expect(requests).toHaveLength(count + 1);
  });
  it("reports download truncation and rejects binary documents", async () => {
    expect(await readPublicUrl(input(base + "/page"), { ...options, maxBytes: 40 })).toMatchObject({ ok: true, truncated: true });
    expect(await readPublicUrl(input(base + "/binary"), options)).toMatchObject({ ok: false, error: expect.stringContaining("supported text page") });
  });
  it("rechecks authority after DNS resolution before sending anything", async () => {
    const count = requests.length;
    expect(await readPublicUrl(input(base + "/page"), { ...options, beforeRequest: () => { throw new Error("Turn ended"); } })).toMatchObject({ ok: false });
    expect(requests).toHaveLength(count);
  });
});
