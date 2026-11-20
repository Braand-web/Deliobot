// Bundles public/ into one Worker module, so a deploy sends only the script.
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { llms, llmsFull, ROBOTS, sitemap, withSeo } from "./seo.mjs";

const root = fileURLToPath(new URL("./public/", import.meta.url));
const types = { ".html": "text/html; charset=utf-8", ".webp": "image/webp", ".svg": "image/svg+xml", ".css": "text/css", ".js": "text/javascript; charset=utf-8", ".txt": "text/plain; charset=utf-8", ".xml": "application/xml; charset=utf-8", ".json": "application/json; charset=utf-8", ".md": "text/markdown; charset=utf-8" };
const files = {};
(function walk(dir) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) { walk(path); continue; }
    const ext = name.slice(name.lastIndexOf("."));
    const name_ = "/" + relative(root, path).split(sep).join("/");
    const body = ext === ".html" ? Buffer.from(withSeo(readFileSync(path, "utf8"), name_)) : readFileSync(path);
    files[name_] = { type: types[ext] ?? "application/octet-stream", body: body.toString("base64") };
  }
})(root);
files["/robots.txt"] = { type: types[".txt"], body: Buffer.from(ROBOTS).toString("base64") };
const pages = Object.fromEntries(Object.entries(files).filter(([name]) => name.endsWith(".html")).map(([name, file]) => [name, Buffer.from(file.body, "base64").toString("utf8")]));
files["/llms.txt"] = { type: types[".txt"], body: Buffer.from(llms(pages)).toString("base64") };
files["/llms-full.txt"] = { type: types[".txt"], body: Buffer.from(llmsFull(pages)).toString("base64") };
files["/sitemap.xml"] = { type: types[".xml"], body: Buffer.from(sitemap(Object.keys(files), new Date().toISOString().slice(0, 10))).toString("base64") };

mkdirSync(new URL("./dist/", import.meta.url), { recursive: true });
writeFileSync(new URL("./dist/worker.js", import.meta.url), `const FILES = ${JSON.stringify(files)};
const bytes = (b64) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
const SECURITY = { "x-content-type-options": "nosniff", "referrer-policy": "strict-origin-when-cross-origin", "x-frame-options": "DENY",
  "strict-transport-security": "max-age=31536000; includeSubDomains", "permissions-policy": "camera=(), microphone=(), geolocation=(), payment=()", "cross-origin-opener-policy": "same-origin" };
const decoded = (text) => { try { return decodeURIComponent(text); } catch { return null; } };
const DOWNLOAD_TYPES = { exe: "application/vnd.microsoft.portable-executable", deb: "application/vnd.debian.binary-package", AppImage: "application/octet-stream", zip: "application/zip",
  yml: "text/yaml; charset=utf-8", blockmap: "application/octet-stream", sha256: "text/plain; charset=utf-8", mp4: "video/mp4", jpg: "image/jpeg" };

/** Reports a page view or a download to the portal's audience count, after the answer is sent; robots are left out there. */
function count(request, env, ctx, kind, path) {
  if (!env.TRAFFIC || !ctx || request.method !== "GET") return;
  if (/prefetch/i.test(request.headers.get("sec-purpose") ?? request.headers.get("purpose") ?? "")) return;
  const range = request.headers.get("range");
  if (kind === "download" && range && !/^bytes=0-/.test(range)) return;
  const url = new URL(request.url);
  const visit = { site: "site", kind, path, referrer: request.headers.get("referer"), utmSource: url.searchParams.get("utm_source") ?? (url.searchParams.get("ref") ? "ref." + url.searchParams.get("ref").toLowerCase().slice(0, 30) : null),
    ip: request.headers.get("cf-connecting-ip") ?? "", userAgent: request.headers.get("user-agent") ?? "", country: request.cf?.country ?? null, city: request.cf?.city ?? null };
  ctx.waitUntil(env.TRAFFIC.record([visit]).catch(() => 0));
}

/** Installers and vendored binaries live in R2; a Range request (the app's differential updates) gets just that part. */
async function download(request, env, key) {
  if (request.method !== "GET" && request.method !== "HEAD") return new Response("method not allowed", { status: 405 });
  const range = /^bytes=(\\d+)-(\\d*)$/.exec(request.headers.get("range") ?? "");
  const options = range ? { range: range[2] ? { offset: Number(range[1]), length: Number(range[2]) - Number(range[1]) + 1 } : { offset: Number(range[1]) } } : {};
  const readObject = (name) => request.method === "HEAD" ? env.DOWNLOADS.head(name) : env.DOWNLOADS.get(name, options);
  let object;
  const release = {
    "download/Deliobot-Setup.exe": ["latest.yml", "setup.exe"],
    "download/Deliobot-Windows.zip": ["latest.yml", "x64.zip"],
    "download/Deliobot.deb": ["latest-linux.yml", "amd64.deb"],
    "download/Deliobot.AppImage": ["latest-linux.yml", "x86_64.AppImage"],
  }[key];
  if (release) {
    const feed = await env.DOWNLOADS.get("download/latest/" + release[0]);
    const version = feed && /^version:\\s*['"]?([0-9][A-Za-z0-9.+-]*)/m.exec(await feed.text())?.[1];
    if (version) object = await readObject("download/latest/OpenDeliobot-" + version + "-" + release[1]);
  }
  object ??= await readObject(key);
  if (!object) return new Response(bytes(FILES["/404.html"].body), { status: 404, headers: { "content-type": "text/html; charset=utf-8", ...SECURITY } });
  const ext = key.slice(key.lastIndexOf(".") + 1);
  const stable = /^download\\/Deliobot[.-]/.test(key) || ext === "yml";
  const headers = { "content-type": DOWNLOAD_TYPES[ext] ?? "application/octet-stream", "accept-ranges": "bytes", etag: object.httpEtag,
    "cache-control": stable ? "no-cache" : key.startsWith("media/") ? "public, max-age=86400" : "public, max-age=3600", ...SECURITY };
  if (key.startsWith("download/") && ext !== "yml") headers["content-disposition"] = \`attachment; filename="\${key.slice(key.lastIndexOf("/") + 1)}"\`;
  if (range && object.range) {
    const start = object.range.offset, end = start + object.range.length - 1;
    return new Response(object.body, { status: 206, headers: { ...headers, "content-range": \`bytes \${start}-\${end}/\${object.size}\`, "content-length": String(object.range.length) } });
  }
  return new Response(request.method === "HEAD" ? null : object.body, { headers: { ...headers, "content-length": String(object.size) } });
}

function sameText(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * Puts a release file into R2 in parts, for files over wrangler's upload limit: POST ?start, PUT ?id=&part=N per part,
 * POST ?id= with the parts' list. Answers only the Bearer UPLOAD_TOKEN secret; without one the route does not exist.
 */
async function upload(request, env, key) {
  const token = env.UPLOAD_TOKEN ?? "";
  const presented = /^Bearer (\\S+)$/.exec(request.headers.get("authorization") ?? "")?.[1] ?? "";
  if (token.length < 32 || !sameText(presented, token)) return new Response("not found", { status: 404 });
  if (!/^(download|vendor|media)\\/[A-Za-z0-9._\\/-]+$/.test(key) || key.includes("..")) return new Response("bad key", { status: 400 });
  const url = new URL(request.url);
  const id = url.searchParams.get("id");
  if (request.method === "POST" && url.searchParams.has("start")) {
    const created = await env.DOWNLOADS.createMultipartUpload(key);
    return Response.json({ id: created.uploadId });
  }
  if (!id) return new Response("missing id", { status: 400 });
  const pending = env.DOWNLOADS.resumeMultipartUpload(key, id);
  if (request.method === "PUT") {
    const part = Number(url.searchParams.get("part"));
    if (!Number.isInteger(part) || part < 1 || part > 10000 || !request.body) return new Response("bad part", { status: 400 });
    return Response.json(await pending.uploadPart(part, request.body));
  }
  if (request.method === "POST") {
    const object = await pending.complete(await request.json());
    return Response.json({ key: object.key, size: object.size, etag: object.httpEtag });
  }
  if (request.method === "DELETE") { await pending.abort(); return new Response(null, { status: 204 }); }
  return new Response("method not allowed", { status: 405 });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.hostname === "www.deliobot.fun") return Response.redirect(\`https://deliobot.fun\${url.pathname}\${url.search}\`, 301);
    if (url.pathname === "/ambassadeur" || url.pathname === "/ambassadeur/") return Response.redirect("https://compte.deliobot.fun/ambassadeur", 302);
    const path = url.pathname;
    if (decoded(path) === null) return new Response("bad request", { status: 400, headers: SECURITY });
    if (env.DOWNLOADS && path.startsWith("/__upload/")) return upload(request, env, decodeURIComponent(path.slice("/__upload/".length)));
    if (env.DOWNLOADS && path.startsWith("/download/")) count(request, env, ctx, "download", path);
    if (env.DOWNLOADS && (path.startsWith("/download/") || path.startsWith("/vendor/") || path.startsWith("/media/"))) return download(request, env, decodeURIComponent(path.slice(1)));
    const clean = path.length > 1 ? path.replace(/\\/+$/, "") : path;
    const file = FILES[clean === "/" ? "/index.html" : clean] ?? FILES[clean + ".html"] ?? FILES[clean + "/index.html"];
    if (!file) return new Response(bytes(FILES["/404.html"].body), { status: 404, headers: { "content-type": "text/html; charset=utf-8", ...SECURITY } });
    if (file.type.startsWith("text/html")) count(request, env, ctx, "view", clean);
    const cache = file.type.startsWith("image/") ? "public, max-age=86400" : "public, max-age=300";
    return new Response(bytes(file.body), { headers: { "content-type": file.type, "cache-control": cache, ...SECURITY } });
  },
};
`);
