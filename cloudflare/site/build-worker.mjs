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
export default {
  fetch(request) {
    const path = new URL(request.url).pathname;
    const clean = path.length > 1 ? path.replace(/\\/+$/, "") : path;
    const file = FILES[clean === "/" ? "/index.html" : clean] ?? FILES[clean + ".html"] ?? FILES[clean + "/index.html"];
    if (!file) return new Response(bytes(FILES["/404.html"].body), { status: 404, headers: { "content-type": "text/html; charset=utf-8", ...SECURITY } });
    const cache = file.type.startsWith("image/") ? "public, max-age=86400" : "public, max-age=300";
    return new Response(bytes(file.body), { headers: { "content-type": file.type, "cache-control": cache, ...SECURITY } });
  },
};
`);
