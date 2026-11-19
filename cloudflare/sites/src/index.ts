// Serves the apps bots publish through Deliobot's included hosting (apps/admin/src/app-hosting.ts writes them): each
// app is a manifest at sites/<label>.json naming content-addressed files, served at https://<label><SITES_SUFFIX>/.
import { hasSession, LOGIN_PATH, loginPage, passwordMatches, safeNext, sessionCookie, type SiteAuth } from "./auth.ts";
import { resolveSitePath, type SiteManifest } from "./resolve.ts";

interface Env { SITES: R2Bucket; SITES_SUFFIX: string }

const SECURITY_HEADERS = {
  "x-content-type-options": "nosniff",
  "referrer-policy": "strict-origin-when-cross-origin",
  "x-frame-options": "SAMEORIGIN",
};

const notFound = () => new Response("<!doctype html><meta charset=utf-8><title>Introuvable</title><p>Cette page n'existe pas.</p>", {
  status: 404, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", ...SECURITY_HEADERS },
});

const page = (html: string, status: number) => new Response(html, {
  status, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", ...SECURITY_HEADERS },
});

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const login = request.method === "POST" && url.pathname === LOGIN_PATH;
    if (request.method !== "GET" && request.method !== "HEAD" && !login) return new Response(null, { status: 405, headers: { allow: "GET, HEAD" } });
    if (!url.hostname.endsWith(env.SITES_SUFFIX)) return notFound();
    const label = url.hostname.slice(0, -env.SITES_SUFFIX.length);
    if (!/^[a-z2-9]{10}$/.test(label)) return notFound();

    const stored = await env.SITES.get(`sites/${label}.json`);
    if (!stored) return notFound();
    const manifest = await stored.json<SiteManifest & { auth?: SiteAuth }>();
    if (manifest.auth) {
      const nowSeconds = Math.floor(Date.now() / 1000);
      if (login) {
        const form = await request.formData().catch(() => null);
        const next = safeNext(form?.get("next"));
        const password = form?.get("password");
        if (typeof password !== "string" || password.length > 128 || !(await passwordMatches(manifest.auth, password))) return page(loginPage(next, true), 401);
        return new Response(null, { status: 303, headers: { location: next, "set-cookie": await sessionCookie(manifest.auth, label, nowSeconds), "cache-control": "no-store" } });
      }
      if (!(await hasSession(manifest.auth, label, request.headers.get("cookie"), nowSeconds))) return page(loginPage(`${url.pathname}${url.search}`, false), 401);
    } else if (login) return notFound();
    const found = resolveSitePath(manifest, decodeURIComponent(url.pathname));
    if (!found) return notFound();
    const file = await env.SITES.get(`blobs/${manifest.workspace}/${found.file.sha1}`);
    if (!file) return notFound();
    return new Response(request.method === "HEAD" ? null : file.body, {
      status: found.status,
      headers: { "content-type": found.file.type, "cache-control": manifest.auth ? "private, no-store" : "public, max-age=60", etag: `"${found.file.sha1}"`, ...SECURITY_HEADERS },
    });
  },
} satisfies ExportedHandler<Env>;
