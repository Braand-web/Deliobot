// The portal's one-time setup page: the operator pastes the provider keys into a form on the portal itself, so they
// travel from the operator's browser to the Durable Object's storage and nowhere else. It answers only with the
// SETUP_TOKEN secret, and closes once the settings are saved with it: a new SETUP_TOKEN opens it again.
import { portalSettings } from "../../../apps/admin/src/env-config.ts";

/** The settings the form takes, in the order it shows them; empty fields keep what is already set. */
export const SETUP_FIELDS = [
  { name: "DELIO_ADMIN_MAIL_API_KEY", label: "Clé API Resend (envoi des codes de connexion)", secret: true },
  { name: "DELIO_ADMIN_MAIL_FROM", label: "Expéditeur des e-mails", secret: false, placeholder: "Delio <signin@deliobot.fun>" },
  { name: "DELIO_ADMIN_OPENROUTER_KEY", label: "Clé API OpenRouter (texte)", secret: true },
  { name: "DELIO_ADMIN_FAL_KEY", label: "Clé API fal.ai (images, vidéo, musique, voix)", secret: true },
  { name: "DELIO_ADMIN_BOAT_KEY", label: "Clé API Boat (ordinateurs cloud)", secret: true },
  { name: "DELIO_ADMIN_SASPAY_KEY", label: "Clé secrète SasPay (sk_live_… ou sk_test_…)", secret: true },
  { name: "DELIO_ADMIN_SASPAY_WEBHOOK_SECRET", label: "Secret du webhook SasPay", secret: true },
  { name: "DELIO_ADMIN_OPERATORS", label: "Votre e-mail d'opérateur (console d'administration)", secret: false, placeholder: "vous@exemple.com" },
] as const;

export const SETTINGS_KEY = "settings";
export const SETUP_DONE_KEY = "setup-done";

/** What the storage keeps of the token a setup was saved with: its SHA-256, never the token. */
export async function tokenDigest(token: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

const escape = (text: string) => text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

function page(body: string, status = 200): Response {
  return new Response(`<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex"><title>Installation · Delio</title><style>
:root{color-scheme:light dark}body{margin:0;font:15px/1.55 system-ui,sans-serif;background:Canvas;color:CanvasText}main{max-width:560px;margin:40px auto;padding:0 20px}
label{display:block;font-weight:600;margin:16px 0 6px}input{width:100%;box-sizing:border-box;font:inherit;padding:10px 12px;border:1px solid #8886;border-radius:10px;background:Field;color:FieldText}
button{margin-top:22px;width:100%;font:inherit;font-weight:600;padding:12px;border:0;border-radius:999px;background:#0b0b0c;color:#fff;cursor:pointer}
.muted{opacity:.7;font-size:13px}.error{background:#d334;padding:10px 12px;border-radius:10px}.ok{background:#2a64;padding:10px 12px;border-radius:10px}
</style></head><body><main>${body}</main></body></html>`, { status, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "referrer-policy": "no-referrer", "x-frame-options": "DENY" } });
}

function form(token: string, current: Record<string, string>, error?: string): Response {
  const fields = SETUP_FIELDS.map((field) => {
    const set = Boolean(current[field.name]);
    const placeholder = set ? "déjà enregistrée : laisser vide pour la garder" : "placeholder" in field ? field.placeholder : "";
    return `<label for="${field.name}">${escape(field.label)}</label><input id="${field.name}" name="${field.name}" type="${field.secret ? "password" : "text"}"
autocomplete="off" spellcheck="false" placeholder="${escape(placeholder)}" value="${field.secret ? "" : escape(current[field.name] ?? "")}">`;
  }).join("\n");
  return page(`<h1>Installer le portail Delio</h1>
<p class="muted">Ces clés vont directement de votre navigateur à votre portail sur Cloudflare. Personne d'autre ne les voit. Cette page se ferme après l'enregistrement. Un champ laissé vide garde la valeur déjà enregistrée, et vous pourrez compléter plus tard avec un nouveau lien.</p>
${error ? `<p class="error">${escape(error)}</p>` : ""}
<form method="post" action="/setup"><input type="hidden" name="token" value="${escape(token)}">${fields}
<button>Enregistrer et ouvrir le portail</button></form>`, error ? 400 : 200);
}

function sameText(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** Handles /setup; null for any other path. `save` stores the merged settings and restarts the portal on them. */
export async function handleSetup(request: Request, deps: {
  setupToken: string | undefined; done: boolean; stored: Record<string, string>; baseEnv: Record<string, string>;
  save: (settings: Record<string, string>) => Promise<void>;
}): Promise<Response | null> {
  const url = new URL(request.url);
  if (url.pathname !== "/setup") return null;
  const closed = () => page("<h1>Page introuvable</h1>", 404);
  if (deps.done || !deps.setupToken || deps.setupToken.length < 32) return closed();
  if (request.method === "GET") {
    const token = url.searchParams.get("token") ?? "";
    return sameText(token, deps.setupToken) ? form(token, deps.stored) : closed();
  }
  if (request.method !== "POST") return closed();
  const body = new URLSearchParams(await request.text());
  const token = body.get("token") ?? "";
  if (!sameText(token, deps.setupToken)) return closed();
  const next: Record<string, string> = { ...deps.stored };
  for (const field of SETUP_FIELDS) {
    const value = (body.get(field.name) ?? "").trim();
    if (value) next[field.name] = value.slice(0, 2000);
  }
  if (!next.DELIO_ADMIN_MAIL_FROM && next.DELIO_ADMIN_MAIL_API_KEY) next.DELIO_ADMIN_MAIL_FROM = "Delio <signin@deliobot.fun>";
  try {
    portalSettings({ ...deps.baseEnv, ...next });
  } catch (error) {
    return form(token, next, error instanceof Error ? error.message : String(error));
  }
  await deps.save(next);
  return page(`<h1>C'est enregistré</h1><p class="ok">Le portail est ouvert : <a href="/">compte.deliobot.fun</a>.</p>
<p class="muted">Cette page d'installation est maintenant fermée. Pour ajouter d'autres clés plus tard, demandez un nouveau lien.</p>`);
}
