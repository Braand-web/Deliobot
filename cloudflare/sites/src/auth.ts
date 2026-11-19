// A private app: the portal stores PBKDF2-SHA256 of its password (apps/admin/src/app-hosting.ts `siteAuth`). A visitor who
// gives it gets a cookie for this one site, an HMAC keyed by that hash, so changing the password signs everyone out.
export interface SiteAuth { salt: string; hash: string; iterations: number }

export const LOGIN_PATH = "/__deliobot_login";
const COOKIE = "deliobot_site";
const DAY_SECONDS = 24 * 60 * 60;
export const SESSION_SECONDS = 30 * DAY_SECONDS;

const encoder = new TextEncoder();
const hex = (bytes: ArrayBuffer) => [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, "0")).join("");

function sameText(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function passwordMatches(auth: SiteAuth, password: string): Promise<boolean> {
  const key = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: encoder.encode(auth.salt), iterations: auth.iterations }, key, 256);
  return sameText(hex(bits), auth.hash);
}

async function signature(auth: SiteAuth, label: string, expires: number): Promise<string> {
  const key = await crypto.subtle.importKey("raw", encoder.encode(auth.hash), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return hex(await crypto.subtle.sign("HMAC", key, encoder.encode(`${label}.${expires}`)));
}

export async function sessionCookie(auth: SiteAuth, label: string, nowSeconds: number): Promise<string> {
  const expires = nowSeconds + SESSION_SECONDS;
  return `${COOKIE}=${expires}.${await signature(auth, label, expires)}; Path=/; Max-Age=${SESSION_SECONDS}; HttpOnly; Secure; SameSite=Lax`;
}

export async function hasSession(auth: SiteAuth, label: string, cookieHeader: string | null, nowSeconds: number): Promise<boolean> {
  const value = (cookieHeader ?? "").split(/;\s*/).find((part) => part.startsWith(`${COOKIE}=`))?.slice(COOKIE.length + 1) ?? "";
  const [expiresText, given] = value.split(".");
  const expires = Number(expiresText);
  if (!given || !Number.isInteger(expires) || expires < nowSeconds) return false;
  return sameText(given, await signature(auth, label, expires));
}

const escapeHtml = (text: string) => text.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);

export function loginPage(next: string, failed: boolean): string {
  return `<!doctype html><html lang="fr"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Page protégée</title><meta name="robots" content="noindex">
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;font:16px/1.5 system-ui,sans-serif;background:#f6f6f4;color:#1c1c1a}
form{width:min(340px,calc(100vw - 32px));padding:28px;border-radius:16px;background:#fff;box-shadow:0 1px 3px #0001}
h1{margin:0 0 6px;font-size:20px}p{margin:0 0 16px;color:#666;font-size:14px}input,button{width:100%;box-sizing:border-box;font:inherit;border-radius:10px}
input{padding:10px 12px;border:1px solid #ccc;margin-bottom:12px}button{padding:10px;border:0;background:#1c1c1a;color:#fff;cursor:pointer}
.err{color:#b42318}@media (prefers-color-scheme:dark){body{background:#151514;color:#eee}form{background:#22221f}p{color:#aaa}input{background:#151514;color:#eee;border-color:#444}button{background:#eee;color:#151514}}</style>
<form method="post" action="${LOGIN_PATH}"><h1>Page protégée</h1><p${failed ? ' class="err"' : ""}>${failed ? "Mot de passe incorrect." : "Entrez le mot de passe pour ouvrir cette page."}</p>
<input type="hidden" name="next" value="${escapeHtml(next)}"><input type="password" name="password" autocomplete="current-password" required autofocus aria-label="Mot de passe">
<button type="submit">Ouvrir</button></form></html>`;
}

/** Only a path on this site: never another origin, so the form cannot send a visitor elsewhere. */
export function safeNext(value: unknown): string {
  return typeof value === "string" && value.startsWith("/") && !value.startsWith("//") && !value.startsWith("/\\") && value.length <= 2_000 ? value : "/";
}
