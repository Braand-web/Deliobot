// The broker's one-time setup page: the operator pastes the Composio keys into a form on the broker itself, so they go
// from the operator's browser to D1 and nowhere else. It answers only with the SETUP_TOKEN secret, and closes once the
// keys are saved with that token: a new SETUP_TOKEN opens it again.

const FIELDS = [
  { name: "COMPOSIO_API_KEY", label: "Clé API Composio (projet)" },
  { name: "COMPOSIO_WEBHOOK_SECRET", label: "Secret du webhook Composio (facultatif, pour les déclencheurs)" },
] as const;
type Name = (typeof FIELDS)[number]["name"];

interface SetupEnv { DB: D1Database; SETUP_TOKEN?: string; COMPOSIO_API_KEY?: string; COMPOSIO_WEBHOOK_SECRET?: string }

const DONE = "setup-done";
const TTL_MS = 60_000;
let cached: { at: number; values: Record<string, string> } | null = null;

async function stored(db: D1Database): Promise<Record<string, string>> {
  if (cached && Date.now() - cached.at < TTL_MS) return cached.values;
  const { results } = await db.prepare("SELECT name, value FROM settings").all<{ name: string; value: string }>();
  cached = { at: Date.now(), values: Object.fromEntries(results.map((row) => [row.name, row.value])) };
  return cached.values;
}

/** The Worker's env with the saved keys filling whatever its own secrets leave unset. */
export async function withSavedKeys<T extends SetupEnv>(env: T): Promise<T> {
  if (env.COMPOSIO_API_KEY && env.COMPOSIO_WEBHOOK_SECRET) return env;
  let saved: Record<string, string> = {};
  try { saved = await stored(env.DB); } catch { return env; }
  return { ...env, COMPOSIO_API_KEY: env.COMPOSIO_API_KEY || saved.COMPOSIO_API_KEY, COMPOSIO_WEBHOOK_SECRET: env.COMPOSIO_WEBHOOK_SECRET || saved.COMPOSIO_WEBHOOK_SECRET };
}

async function digest(text: string): Promise<string> {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function sameText(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

const escape = (text: string) => text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

function page(body: string, status = 200): Response {
  return new Response(`<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex"><title>Installation · Delio Apps</title><style>
:root{color-scheme:light dark}body{margin:0;font:15px/1.55 system-ui,sans-serif;background:Canvas;color:CanvasText}main{max-width:560px;margin:40px auto;padding:0 20px}
label{display:block;font-weight:600;margin:16px 0 6px}input{width:100%;box-sizing:border-box;font:inherit;padding:10px 12px;border:1px solid #8886;border-radius:10px;background:Field;color:FieldText}
button{margin-top:22px;width:100%;font:inherit;font-weight:600;padding:12px;border:0;border-radius:999px;background:#0b0b0c;color:#fff;cursor:pointer}
.muted{opacity:.7;font-size:13px}.ok{background:#2a64;padding:10px 12px;border-radius:10px}.error{background:#d334;padding:10px 12px;border-radius:10px}
</style></head><body><main>${body}</main></body></html>`, { status, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "referrer-policy": "no-referrer", "x-frame-options": "DENY" } });
}

/** Handles /setup; null for any other path. */
export async function handleSetup(request: Request, env: SetupEnv): Promise<Response | null> {
  const url = new URL(request.url);
  if (url.pathname !== "/setup") return null;
  const closed = () => page("<h1>Page introuvable</h1>", 404);
  const expected = env.SETUP_TOKEN ?? "";
  if (expected.length < 32) return closed();
  const saved = await stored(env.DB);
  if (saved[DONE] === await digest(expected)) return closed();
  const token = request.method === "POST" ? new URLSearchParams(await request.clone().text()).get("token") ?? "" : url.searchParams.get("token") ?? "";
  if (!sameText(token, expected)) return closed();
  if (request.method === "GET") {
    const fields = FIELDS.map((field) => `<label for="${field.name}">${escape(field.label)}</label><input id="${field.name}" name="${field.name}" type="password" autocomplete="off"
placeholder="${saved[field.name] ? "déjà enregistrée : laisser vide pour la garder" : ""}">`).join("\n");
    return page(`<h1>Brancher Composio</h1><p class="muted">La clé va directement de votre navigateur à votre service Delio Apps sur Cloudflare. L'application ne la reçoit jamais : chaque installation obtient son propre accès.</p>
<form method="post" action="/setup"><input type="hidden" name="token" value="${escape(token)}">${fields}<button>Enregistrer</button></form>`);
  }
  if (request.method !== "POST") return closed();
  const form = new URLSearchParams(await request.text());
  const values: Partial<Record<Name, string>> = {};
  for (const field of FIELDS) {
    const value = (form.get(field.name) ?? "").trim();
    if (value) values[field.name] = value.slice(0, 2000);
  }
  if (!values.COMPOSIO_API_KEY && !saved.COMPOSIO_API_KEY) {
    return page(`<h1>Brancher Composio</h1><p class="error">Entrez la clé API Composio.</p><p><a href="/setup?token=${escape(token)}">Revenir au formulaire</a></p>`, 400);
  }
  const now = Date.now();
  const statements = Object.entries(values).map(([name, value]) => env.DB.prepare(
    "INSERT INTO settings (name, value, updated_at) VALUES (?, ?, ?) ON CONFLICT (name) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at").bind(name, value, now));
  statements.push(env.DB.prepare("INSERT INTO settings (name, value, updated_at) VALUES (?, ?, ?) ON CONFLICT (name) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at")
    .bind(DONE, await digest(expected), now));
  await env.DB.batch(statements);
  cached = null;
  return page(`<h1>C'est enregistré</h1><p class="ok">Composio est branché : les applications Deliobot peuvent connecter Gmail, Slack, Notion et les autres.</p><p class="muted">Cette page est maintenant fermée.</p>`);
}
