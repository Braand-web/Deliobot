// Bundles public/ into one Worker module, so a deploy sends only the script.
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";

const root = new URL("./public/", import.meta.url).pathname;
const types = { ".html": "text/html; charset=utf-8", ".webp": "image/webp", ".svg": "image/svg+xml", ".css": "text/css" };
const files = {};
(function walk(dir) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) { walk(path); continue; }
    const ext = name.slice(name.lastIndexOf("."));
    files["/" + relative(root, path)] = { type: types[ext] ?? "application/octet-stream", body: readFileSync(path).toString("base64") };
  }
})(root);

writeFileSync(new URL("./dist/worker.js", import.meta.url), `const FILES = ${JSON.stringify(files)};
const bytes = (b64) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
const SECURITY = { "x-content-type-options": "nosniff", "referrer-policy": "strict-origin-when-cross-origin", "x-frame-options": "DENY" };
const DOWNLOAD_TYPES = { exe: "application/vnd.microsoft.portable-executable", deb: "application/vnd.debian.binary-package", AppImage: "application/octet-stream",
  yml: "text/yaml; charset=utf-8", blockmap: "application/octet-stream", sha256: "text/plain; charset=utf-8" };

/** Installers and vendored binaries live in R2; a Range request (the app's differential updates) gets just that part. */
async function download(request, env, key) {
  if (request.method !== "GET" && request.method !== "HEAD") return new Response("method not allowed", { status: 405 });
  const range = /^bytes=(\\d+)-(\\d*)$/.exec(request.headers.get("range") ?? "");
  const options = range ? { range: range[2] ? { offset: Number(range[1]), length: Number(range[2]) - Number(range[1]) + 1 } : { offset: Number(range[1]) } } : {};
  const object = request.method === "HEAD" ? await env.DOWNLOADS.head(key) : await env.DOWNLOADS.get(key, options);
  if (!object) return new Response(bytes(FILES["/404.html"].body), { status: 404, headers: { "content-type": "text/html; charset=utf-8", ...SECURITY } });
  const ext = key.slice(key.lastIndexOf(".") + 1);
  const headers = { "content-type": DOWNLOAD_TYPES[ext] ?? "application/octet-stream", "accept-ranges": "bytes", etag: object.httpEtag,
    "cache-control": ext === "yml" ? "no-cache" : "public, max-age=3600", ...SECURITY };
  if (key.startsWith("download/") && ext !== "yml") headers["content-disposition"] = \`attachment; filename="\${key.slice(key.lastIndexOf("/") + 1)}"\`;
  if (range && object.range) {
    const start = object.range.offset, end = start + object.range.length - 1;
    return new Response(object.body, { status: 206, headers: { ...headers, "content-range": \`bytes \${start}-\${end}/\${object.size}\`, "content-length": String(object.range.length) } });
  }
  return new Response(request.method === "HEAD" ? null : object.body, { headers: { ...headers, "content-length": String(object.size) } });
}

export default {
  async fetch(request, env) {
    const path = new URL(request.url).pathname;
    if (env.DOWNLOADS && (path.startsWith("/download/") || path.startsWith("/vendor/"))) return download(request, env, decodeURIComponent(path.slice(1)));
    const clean = path.length > 1 ? path.replace(/\\/+$/, "") : path;
    const file = FILES[clean === "/" ? "/index.html" : clean] ?? FILES[clean + ".html"] ?? FILES[clean + "/index.html"];
    if (!file) return new Response(bytes(FILES["/404.html"].body), { status: 404, headers: { "content-type": "text/html; charset=utf-8", ...SECURITY } });
    const cache = file.type.startsWith("image/") ? "public, max-age=86400" : "public, max-age=300";
    return new Response(bytes(file.body), { headers: { "content-type": file.type, "cache-control": cache, ...SECURITY } });
  },
};
`);
