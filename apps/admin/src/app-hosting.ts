// Included app hosting: the relay a connected Deliobot app publishes a bot's static site through (the app's
// server/host/included-hosting.ts is the client). Files are content-addressed per workspace in a bucket; a published app
// is a manifest at sites/<label>.json that the sites Worker serves on https://<label><sitesSuffix>/.
//
// Security: a site is served on its own subdomain, never on the portal's origin, so its pages cannot read the portal's
// host-only session cookie, and the portal refuses forms from any other origin. Paths are plain relative names, checked
// before they reach the bucket.
import { createHash, randomBytes } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";

import type { Billing, PlanId } from "./plans.ts";
import type { SqlDatabase } from "./sql.ts";

/** The bucket behind the sites: R2 on Cloudflare. */
export interface SiteBucket {
  has(key: string): Promise<boolean>;
  put(key: string, bytes: Uint8Array, contentType?: string): Promise<void>;
  delete(key: string): Promise<void>;
}

export interface SiteManifest { workspace: string; key: string; files: Record<string, { sha1: string; type: string }> }

export const HOSTING_LIMITS = { maxBytes: 25 * 1024 * 1024, maxFileBytes: 4 * 1024 * 1024, maxFiles: 500 } as const;
/** Apps kept online at once, and publishes a month, per plan. A trial gets hosting with its first payment. */
export const HOSTING_BY_PLAN: Partial<Record<PlanId, { apps: number; publishes: number }>> = {
  starter: { apps: 2, publishes: 30 }, byok: { apps: 3, publishes: 50 }, pro: { apps: 5, publishes: 100 }, max: { apps: 20, publishes: 300 },
};

export type HostingAccess = { plan: PlanId; active: true } | { plan: PlanId | null; active: false; ended: boolean };

/** A paid plan that is current (or in its grace days) hosts apps; a trial, a suspended or an ended one does not. */
export function hostingAccess(plans: Pick<Billing, "allowance" | "subscription">, workspace: string): HostingAccess {
  const subscription = plans.subscription(workspace);
  if (subscription.status === "none") return { plan: null, active: false, ended: false };
  if (subscription.status === "expired") return { plan: subscription.plan, active: false, ended: true };
  const allowance = plans.allowance(workspace);
  if (allowance.plan === null) return { plan: subscription.plan, active: false, ended: true };
  if (subscription.status === "trialing") return { plan: subscription.plan, active: false, ended: false };
  return { plan: subscription.plan, active: true };
}

const KEY = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const SHA1 = /^[0-9a-f]{40}$/;
const LABEL_ALPHABET = "abcdefghijkmnpqrstuvwxyz23456789";
const MAX_MANIFEST_BYTES = 256 * 1024;

const TYPES: Record<string, string> = {
  html: "text/html; charset=utf-8", htm: "text/html; charset=utf-8", css: "text/css; charset=utf-8", js: "text/javascript; charset=utf-8",
  mjs: "text/javascript; charset=utf-8", json: "application/json", txt: "text/plain; charset=utf-8", xml: "application/xml", svg: "image/svg+xml",
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", avif: "image/avif", ico: "image/x-icon",
  woff: "font/woff", woff2: "font/woff2", ttf: "font/ttf", otf: "font/otf", mp3: "audio/mpeg", wav: "audio/wav", ogg: "audio/ogg",
  mp4: "video/mp4", webm: "video/webm", pdf: "application/pdf", wasm: "application/wasm", map: "application/json", webmanifest: "application/manifest+json",
};
export const contentType = (path: string): string => TYPES[path.slice(path.lastIndexOf(".") + 1).toLowerCase()] ?? "application/octet-stream";

/** A published file's path: relative, forward slashes, no empty, dot or dot-dot parts, nothing a URL would read otherwise. */
export function sitePath(value: unknown): string | null {
  if (typeof value !== "string" || !value || value.length > 300) return null;
  const parts = value.split("/");
  if (parts.some((part) => !part || part === "." || part === ".." || /[\p{Cc}\\?#%]/u.test(part))) return null;
  return parts.join("/");
}

interface AppRow { workspace: string; key: string; label: string; title: string; state: string; pending: string | null; created_at: number; published_at: number | null }

export function createAppHosting(options: { db: SqlDatabase; bucket: SiteBucket | null; sitesSuffix: string; access: (workspace: string) => HostingAccess; now?: () => number }) {
  const { db } = options;
  const now = options.now ?? Date.now;
  db.exec(`CREATE TABLE IF NOT EXISTS hosted_apps (workspace TEXT NOT NULL, key TEXT NOT NULL, label TEXT NOT NULL UNIQUE, title TEXT NOT NULL,
    state TEXT NOT NULL, pending TEXT, created_at INTEGER NOT NULL, published_at INTEGER, PRIMARY KEY (workspace, key))`);
  db.exec("CREATE TABLE IF NOT EXISTS hosted_publishes (workspace TEXT NOT NULL, month TEXT NOT NULL, count INTEGER NOT NULL, PRIMARY KEY (workspace, month))");

  const month = () => new Date(now()).toISOString().slice(0, 7);
  const nextMonth = () => { const at = new Date(now()); return new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth() + 1, 1)).toISOString(); };
  const row = (workspace: string, key: string) => db.prepare("SELECT * FROM hosted_apps WHERE workspace = ? AND key = ?").get(workspace, key) as AppRow | undefined;
  const rows = (workspace: string) => db.prepare("SELECT * FROM hosted_apps WHERE workspace = ? ORDER BY created_at").all(workspace) as AppRow[];
  const published = (workspace: string) => (db.prepare("SELECT count FROM hosted_publishes WHERE workspace = ? AND month = ?").get(workspace, month()) as { count: number } | undefined)?.count ?? 0;
  const blob = (workspace: string, sha1: string) => `blobs/${workspace}/${sha1}`;

  function label(): string {
    for (;;) {
      const bytes = randomBytes(10);
      const value = Array.from(bytes, (byte) => LABEL_ALPHABET[byte % LABEL_ALPHABET.length]).join("");
      if (!db.prepare("SELECT 1 FROM hosted_apps WHERE label = ?").get(value)) return value;
    }
  }

  const view = (app: AppRow) => ({
    key: app.key, title: app.title, url: app.state === "ready" ? `https://${app.label}${options.sitesSuffix}/` : null, state: app.state, visibility: "public",
    createdAt: new Date(app.created_at).toISOString(), publishedAt: app.published_at === null ? null : new Date(app.published_at).toISOString(),
  });

  function allowance(workspace: string, plan: PlanId) {
    const limit = HOSTING_BY_PLAN[plan] ?? { apps: 0, publishes: 0 };
    return { apps: { used: rows(workspace).length, max: limit.apps }, publishes: { used: published(workspace), max: limit.publishes, resetsAt: nextMonth() }, limits: HOSTING_LIMITS };
  }

  async function missing(workspace: string, files: Array<{ sha1: string }>): Promise<string[]> {
    const wanted = [...new Set(files.map((file) => file.sha1))];
    const present = await Promise.all(wanted.map((sha1) => options.bucket!.has(blob(workspace, sha1))));
    return wanted.filter((_, index) => !present[index]);
  }

  async function finish(app: AppRow, files: Array<{ path: string; sha1: string }>): Promise<void> {
    const manifest: SiteManifest = { workspace: app.workspace, key: app.key, files: Object.fromEntries(files.map((file) => [file.path, { sha1: file.sha1, type: contentType(file.path) }])) };
    await options.bucket!.put(`sites/${app.label}.json`, new TextEncoder().encode(JSON.stringify(manifest)), "application/json");
    db.transaction(() => {
      db.prepare("UPDATE hosted_apps SET state = 'ready', pending = NULL, published_at = ? WHERE workspace = ? AND key = ?").run(now(), app.workspace, app.key);
      db.prepare("INSERT INTO hosted_publishes (workspace, month, count) VALUES (?, ?, 1) ON CONFLICT (workspace, month) DO UPDATE SET count = count + 1").run(app.workspace, month());
    });
  }

  function reply(res: ServerResponse, status: number, body: unknown): void {
    res.statusCode = status;
    res.setHeader("content-type", "application/json; charset=utf-8");
    res.setHeader("cache-control", "no-store");
    res.end(JSON.stringify(body));
  }

  async function body(req: IncomingMessage, max: number): Promise<Buffer> {
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of req as AsyncIterable<Buffer>) {
      size += chunk.length;
      if (size > max) throw Object.assign(new Error("too large"), { code: "request_too_large", max });
      chunks.push(chunk);
    }
    return Buffer.concat(chunks);
  }

  return {
    /** Every published app, newest first, for the operators' console. */
    all(limit = 200): Array<{ workspace: string; key: string; label: string; title: string; state: string; url: string; publishedAt: number | null }> {
      return (db.prepare("SELECT * FROM hosted_apps ORDER BY COALESCE(published_at, created_at) DESC LIMIT ?").all(limit) as AppRow[])
        .map((app) => ({ workspace: app.workspace, key: app.key, label: app.label, title: app.title, state: app.state, url: `https://${app.label}${options.sitesSuffix}/`, publishedAt: app.published_at }));
    },

    /** Takes a site offline for good: its address stops answering and its workspace cannot publish it again. */
    async takeDown(label: string): Promise<{ workspace: string; key: string } | null> {
      const app = db.prepare("SELECT * FROM hosted_apps WHERE label = ?").get(label) as AppRow | undefined;
      if (!app) return null;
      if (options.bucket) await options.bucket.delete(`sites/${app.label}.json`);
      db.prepare("UPDATE hosted_apps SET state = 'taken_down', pending = NULL WHERE label = ?").run(label);
      return { workspace: app.workspace, key: app.key };
    },

    /** Serves /api/gateway/<workspace>/hosting/v1/<rest> for an authenticated workspace. */
    async handle(req: IncomingMessage, res: ServerResponse, workspace: string, rest: string): Promise<void> {
      if (!options.bucket) return reply(res, 503, { error: "unavailable" });
      const access = options.access(workspace);
      if (!access.active) return reply(res, 403, { error: access.ended ? "subscription_inactive" : "not_included" });
      if (!HOSTING_BY_PLAN[access.plan]) return reply(res, 403, { error: "not_included" });
      const path = rest.split("?")[0]!;
      const method = req.method ?? "GET";

      if (path === "apps" && method === "GET") return reply(res, 200, { apps: rows(workspace).map(view), allowance: allowance(workspace, access.plan) });

      const match = /^apps\/([^/]+)(?:\/files\/([^/]+))?$/.exec(path);
      const key = match ? decodeURIComponent(match[1]!) : "";
      if (!match || !KEY.test(key)) return reply(res, 404, { error: "not_found" });
      const existing = row(workspace, key);
      if (existing?.state === "taken_down" && method !== "GET" && method !== "DELETE") return reply(res, 403, { error: "app_taken_down" });

      if (match[2] !== undefined) {
        if (method !== "PUT") return reply(res, 405, { error: "failed" });
        const sha1 = match[2];
        if (!existing || !existing.pending || !SHA1.test(sha1)) return reply(res, 409, { error: "not_required" });
        const files = JSON.parse(existing.pending) as Array<{ path: string; sha1: string; size: number }>;
        const expected = files.find((file) => file.sha1 === sha1);
        if (!expected) return reply(res, 409, { error: "not_required" });
        let bytes: Buffer;
        try { bytes = await body(req, HOSTING_LIMITS.maxFileBytes); } catch { return reply(res, 413, { error: "file_too_large", path: expected.path, max: HOSTING_LIMITS.maxFileBytes }); }
        if (bytes.length !== expected.size) return reply(res, 400, { error: "size_mismatch" });
        if (createHash("sha1").update(bytes).digest("hex") !== sha1) return reply(res, 400, { error: "digest_mismatch" });
        await options.bucket.put(blob(workspace, sha1), new Uint8Array(bytes), contentType(expected.path));
        if (!(await missing(workspace, files)).length) await finish(existing, files);
        return reply(res, 200, { received: true });
      }

      if (method === "GET") return existing ? reply(res, 200, { app: view(existing) }) : reply(res, 404, { error: "app_not_found" });

      if (method === "DELETE") {
        if (!existing) return reply(res, 404, { error: "app_not_found" });
        await options.bucket.delete(`sites/${existing.label}.json`);
        db.prepare("DELETE FROM hosted_apps WHERE workspace = ? AND key = ?").run(workspace, key);
        return reply(res, 200, { deleted: true });
      }

      if (method !== "PUT") return reply(res, 405, { error: "failed" });
      let manifest: { title?: unknown; files?: unknown };
      try { manifest = JSON.parse((await body(req, MAX_MANIFEST_BYTES)).toString("utf8")) as typeof manifest; } catch { return reply(res, 413, { error: "request_too_large", max: MAX_MANIFEST_BYTES }); }
      if (!Array.isArray(manifest?.files)) return reply(res, 400, { error: "invalid_files" });
      if (manifest.files.length > HOSTING_LIMITS.maxFiles) return reply(res, 400, { error: "too_many_files", files: manifest.files.length, max: HOSTING_LIMITS.maxFiles });
      const files: Array<{ path: string; sha1: string; size: number }> = [];
      const seen = new Set<string>();
      let total = 0;
      for (const entry of manifest.files as Array<Record<string, unknown>>) {
        const filePath = sitePath(entry?.path);
        const size = entry?.size;
        if (!filePath || seen.has(filePath) || typeof entry.sha1 !== "string" || !SHA1.test(entry.sha1) || typeof size !== "number" || !Number.isInteger(size) || size < 0) {
          return reply(res, 400, { error: "invalid_files", path: typeof entry?.path === "string" ? entry.path : "" });
        }
        if (size > HOSTING_LIMITS.maxFileBytes) return reply(res, 400, { error: "file_too_large", path: filePath, size, max: HOSTING_LIMITS.maxFileBytes });
        seen.add(filePath);
        total += size;
        files.push({ path: filePath, sha1: entry.sha1, size });
      }
      if (!seen.has("index.html")) return reply(res, 400, { error: "invalid_files", path: "index.html" });
      if (total > HOSTING_LIMITS.maxBytes) return reply(res, 400, { error: "app_too_large", bytes: total, max: HOSTING_LIMITS.maxBytes });

      const limit = HOSTING_BY_PLAN[access.plan]!;
      const current = allowance(workspace, access.plan);
      if (!existing && current.apps.used >= limit.apps) return reply(res, 403, { error: "apps_limit_reached", apps: current.apps });
      if (current.publishes.used >= limit.publishes) return reply(res, 403, { error: "publishes_limit_reached", publishes: current.publishes });

      const title = (typeof manifest.title === "string" ? manifest.title : key).replace(/\p{Cc}/gu, " ").trim().slice(0, 200) || key;
      if (existing) {
        db.prepare("UPDATE hosted_apps SET title = ?, pending = ?, state = CASE WHEN state = 'ready' THEN 'ready' ELSE 'uploading' END WHERE workspace = ? AND key = ?")
          .run(title, JSON.stringify(files), workspace, key);
      } else {
        db.prepare("INSERT INTO hosted_apps (workspace, key, label, title, state, pending, created_at, published_at) VALUES (?, ?, ?, ?, 'uploading', ?, ?, NULL)")
          .run(workspace, key, label(), title, JSON.stringify(files), now());
      }
      const app = row(workspace, key)!;
      const required = await missing(workspace, files);
      if (!required.length) await finish(app, files);
      return reply(res, 200, { app: view(row(workspace, key)!), created: !existing, required: required.map((sha1) => ({ sha1 })), allowance: allowance(workspace, access.plan) });
    },
  };
}

export type AppHosting = ReturnType<typeof createAppHosting>;
