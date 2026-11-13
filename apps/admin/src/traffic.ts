// Audience of deliobot.fun and of the portal, without cookies. Privacy invariant: an address is never stored; a visitor
// is a hash of its address, browser and a salt drawn each day and deleted the next, so nobody can be followed from one
// day to the next nor found again from the database.
import { createHash, randomBytes } from "node:crypto";

import type { SqlDatabase } from "./sql.ts";

export type TrafficSite = "site" | "compte";
export type VisitKind = "view" | "download";

/** One page view or download, as the site's Worker and the portal report it. */
export interface VisitInput {
  site: TrafficSite;
  kind: VisitKind;
  path: string;
  referrer?: string | null;
  utmSource?: string | null;
  ip: string;
  userAgent: string;
  country?: string | null;
  city?: string | null;
}

const DAY_MS = 24 * 60 * 60_000;
const KEEP_DAYS = 90;
const MAX_BATCH = 50;
const OWN_HOSTS = /(^|\.)deliobot\.fun$/;
const BOTS = /bot|crawl|spider|slurp|preview|facebookexternalhit|whatsapp|telegram|discord|slack|curl|wget|python|http-?client|headless|lighthouse|monitor|uptime|go-http|node-fetch|undici|axios|java\/|okhttp|electron/i;

const SOURCES: Array<[RegExp, string]> = [
  [/(^|\.)google\./, "Google"], [/(^|\.)bing\.com$/, "Bing"], [/(^|\.)duckduckgo\.com$/, "DuckDuckGo"], [/(^|\.)yahoo\./, "Yahoo"],
  [/(^|\.)(facebook\.com|fb\.com|fb\.me)$/, "Facebook"], [/(^|\.)instagram\.com$/, "Instagram"], [/(^|\.)(t\.co|twitter\.com|x\.com)$/, "X"],
  [/(^|\.)(whatsapp\.com|wa\.me)$/, "WhatsApp"], [/(^|\.)(linkedin\.com|lnkd\.in)$/, "LinkedIn"], [/(^|\.)(youtube\.com|youtu\.be)$/, "YouTube"],
  [/(^|\.)tiktok\.com$/, "TikTok"], [/(^|\.)(t\.me|telegram\.org)$/, "Telegram"], [/(^|\.)(chatgpt\.com|openai\.com)$/, "ChatGPT"],
];

const clip = (value: string | null | undefined, max: number) => (value ?? "").trim().slice(0, max);

export function isBot(userAgent: string): boolean {
  return !userAgent || BOTS.test(userAgent);
}

export function deviceOf(userAgent: string): "ordinateur" | "téléphone" | "tablette" {
  if (/ipad|tablet/i.test(userAgent)) return "tablette";
  return /mobi|iphone|android/i.test(userAgent) ? "téléphone" : "ordinateur";
}

export function systemOf(userAgent: string): string {
  if (/iphone|ipad|ipod/i.test(userAgent)) return "iOS";
  if (/android/i.test(userAgent)) return "Android";
  if (/windows/i.test(userAgent)) return "Windows";
  if (/mac os x|macintosh/i.test(userAgent)) return "macOS";
  if (/cros/i.test(userAgent)) return "ChromeOS";
  if (/linux/i.test(userAgent)) return "Linux";
  return "Autre";
}

/** Where a visit came from: its `utm_source`, else the referring site by name, else "Direct". Visits from our own pages are "Interne". */
export function sourceOf(referrer: string | null | undefined, utmSource: string | null | undefined): string {
  const utm = clip(utmSource, 40).toLowerCase().replace(/[^a-z0-9._-]/g, "");
  if (utm) return utm;
  let host = "";
  try { host = referrer ? new URL(referrer).hostname.toLowerCase() : ""; } catch { host = ""; }
  if (!host) return "Direct";
  if (OWN_HOSTS.test(host)) return "Interne";
  return SOURCES.find(([pattern]) => pattern.test(host))?.[1] ?? host.replace(/^www\./, "").slice(0, 60);
}

/** The platform a download path stands for, or null for a file that is not an app (the updater's latest.yml…). */
export function downloadPlatform(path: string): string | null {
  if (/\.exe$/i.test(path)) return "Windows (installateur)";
  if (/\.zip$/i.test(path)) return "Windows (ZIP)";
  if (/\.deb$/i.test(path)) return "Linux (.deb)";
  if (/\.appimage$/i.test(path)) return "Linux (AppImage)";
  if (/\.dmg$/i.test(path)) return "macOS";
  return null;
}

export const dayOf = (at: number) => new Date(at).toISOString().slice(0, 10);

export class Traffic {
  private readonly db: SqlDatabase;
  private readonly now: () => number;

  constructor(db: SqlDatabase, now: () => number = Date.now) {
    this.db = db;
    this.now = now;
    this.db.exec(`
CREATE TABLE IF NOT EXISTS traffic_salts (day TEXT PRIMARY KEY, salt TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS visits (id INTEGER PRIMARY KEY AUTOINCREMENT, at INTEGER NOT NULL, day TEXT NOT NULL, site TEXT NOT NULL, kind TEXT NOT NULL,
  path TEXT NOT NULL, source TEXT NOT NULL, country TEXT, city TEXT, device TEXT NOT NULL, os TEXT NOT NULL, visitor TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS visits_at ON visits (at);
CREATE INDEX IF NOT EXISTS visits_day ON visits (day, site, visitor);
CREATE TABLE IF NOT EXISTS visit_days (day TEXT NOT NULL, site TEXT NOT NULL, views INTEGER NOT NULL DEFAULT 0, visitors INTEGER NOT NULL DEFAULT 0,
  downloads INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (day, site));`);
  }

  private salt(day: string): string {
    const found = this.db.prepare("SELECT salt FROM traffic_salts WHERE day = ?").get(day) as { salt: string } | undefined;
    if (found) return found.salt;
    const salt = randomBytes(32).toString("base64url");
    this.db.prepare("INSERT INTO traffic_salts (day, salt) VALUES (?, ?) ON CONFLICT DO NOTHING").run(day, salt);
    this.db.prepare("DELETE FROM traffic_salts WHERE day < ?").run(dayOf(this.now() - DAY_MS));
    return (this.db.prepare("SELECT salt FROM traffic_salts WHERE day = ?").get(day) as { salt: string }).salt;
  }

  /** Records what is a person's visit; robots, prefetches and the app's own update checks are left out. Answers how many were kept. */
  record(batch: readonly VisitInput[]): number {
    const at = this.now();
    const day = dayOf(at);
    let kept = 0;
    this.db.transaction(() => {
      const salt = this.salt(day);
      for (const visit of batch.slice(0, MAX_BATCH)) {
        const userAgent = clip(visit.userAgent, 512);
        const path = clip(visit.path, 200) || "/";
        if (isBot(userAgent) || (visit.site !== "site" && visit.site !== "compte")) continue;
        if (visit.kind === "download" && !downloadPlatform(path)) continue;
        const visitor = createHash("sha256").update(`${salt}\n${clip(visit.ip, 64)}\n${userAgent}`).digest("base64url").slice(0, 22);
        const known = visit.kind === "download" || this.db.prepare("SELECT 1 FROM visits WHERE day = ? AND site = ? AND kind = 'view' AND visitor = ? LIMIT 1").get(day, visit.site, visitor);
        this.db.prepare(`INSERT INTO visits (at, day, site, kind, path, source, country, city, device, os, visitor) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
          .run(at, day, visit.site, visit.kind === "download" ? "download" : "view", path, sourceOf(visit.referrer, visit.utmSource),
            clip(visit.country, 2).toUpperCase() || null, clip(visit.city, 80) || null, deviceOf(userAgent), systemOf(userAgent), visitor);
        this.db.prepare(`INSERT INTO visit_days (day, site, views, visitors, downloads) VALUES (?, ?, ?, ?, ?) ON CONFLICT (day, site) DO UPDATE SET
          views = views + excluded.views, visitors = visitors + excluded.visitors, downloads = downloads + excluded.downloads`)
          .run(day, visit.site, visit.kind === "download" ? 0 : 1, known ? 0 : 1, visit.kind === "download" ? 1 : 0);
        kept += 1;
      }
    });
    return kept;
  }

  /** Deletes visit details older than 90 days; the daily totals stay. */
  purge(): void {
    this.db.prepare("DELETE FROM visits WHERE at < ?").run(this.now() - KEEP_DAYS * DAY_MS);
  }
}
