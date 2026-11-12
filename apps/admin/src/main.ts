import { randomBytes } from "node:crypto";
import { mkdirSync } from "node:fs";
import { createServer } from "node:http";
import { dirname, resolve } from "node:path";

import { createAdminApp } from "./app.ts";
import { DEFAULT_WORKSPACE_MODELS } from "./hosting.ts";
import { consoleMailer, httpMailer, type Mailer } from "./mail.ts";
import { normalizeEmail, AdminStore } from "./store.ts";

function fail(message: string): never {
  console.error(`delio-admin: ${message}`);
  process.exit(1);
}

const env = process.env;
const publicUrl = new URL(env.DELIO_ADMIN_URL ?? "http://localhost:8790");
const production = publicUrl.protocol === "https:";
if (publicUrl.pathname !== "/" || publicUrl.search) fail("DELIO_ADMIN_URL must be an origin, such as https://admin.deliobot.fun");

const secretText = env.DELIO_ADMIN_SECRET;
if (production && (!secretText || secretText.length < 32)) fail("set DELIO_ADMIN_SECRET to at least 32 random characters (openssl rand -base64 48)");
const secret = secretText ? Buffer.from(secretText) : randomBytes(32);

let mailer: Mailer;
if (env.DELIO_ADMIN_MAIL_API_KEY) {
  if (!env.DELIO_ADMIN_MAIL_FROM) fail("set DELIO_ADMIN_MAIL_FROM, such as Delio <signin@deliobot.fun>");
  mailer = httpMailer({ endpoint: env.DELIO_ADMIN_MAIL_ENDPOINT ?? "https://api.resend.com/emails", apiKey: env.DELIO_ADMIN_MAIL_API_KEY, from: env.DELIO_ADMIN_MAIL_FROM });
} else if (!production || env.DELIO_ADMIN_MAIL === "console") {
  mailer = consoleMailer;
  console.warn("delio-admin: sign-in codes and invitations are printed here, not emailed");
} else {
  fail("set DELIO_ADMIN_MAIL_API_KEY and DELIO_ADMIN_MAIL_FROM so sign-in codes can be emailed");
}

const file = resolve(env.DELIO_ADMIN_DB ?? "data/delio-admin.db");
mkdirSync(dirname(file), { recursive: true });
const store = new AdminStore({ file, secret });
const operators = new Set((env.DELIO_ADMIN_OPERATORS ?? "").split(",").map(normalizeEmail).filter(Boolean));
if (operators.size === 0) console.warn("delio-admin: no DELIO_ADMIN_OPERATORS, so nobody can create workspaces");

const port = Number(env.PORT ?? 8790);
const host = env.HOST ?? (production ? "0.0.0.0" : "127.0.0.1");
const creditUsd = env.DELIO_ADMIN_CREDIT_USD ? Number(env.DELIO_ADMIN_CREDIT_USD) : undefined;
if (creditUsd !== undefined && !(creditUsd > 0)) fail("DELIO_ADMIN_CREDIT_USD must be a positive number of dollars, such as 0.002");
const boatUsdPerHour = env.DELIO_ADMIN_BOAT_USD_PER_HOUR ? Number(env.DELIO_ADMIN_BOAT_USD_PER_HOUR) : undefined;
if (boatUsdPerHour !== undefined && !(boatUsdPerHour > 0)) fail("DELIO_ADMIN_BOAT_USD_PER_HOUR must be a positive number of dollars");
const gateway = { openrouterKey: env.DELIO_ADMIN_OPENROUTER_KEY?.trim() || undefined, falKey: env.DELIO_ADMIN_FAL_KEY?.trim() || undefined,
  boatKey: env.DELIO_ADMIN_BOAT_KEY?.trim() || undefined, boatUsdPerHour, creditUsd };
if (!gateway.openrouterKey && !gateway.falKey) console.warn("delio-admin: no DELIO_ADMIN_OPENROUTER_KEY or DELIO_ADMIN_FAL_KEY, so the AI gateway refuses every request");
const currency = (env.DELIO_ADMIN_CURRENCY ?? "XOF").trim().toUpperCase();
const xofPerUsd = env.DELIO_ADMIN_XOF_PER_USD ? Number(env.DELIO_ADMIN_XOF_PER_USD) : undefined;
if (!["XOF", "XAF", "USD"].includes(currency)) fail("DELIO_ADMIN_CURRENCY must be XOF, XAF or USD");
if (xofPerUsd !== undefined && !(xofPerUsd > 0)) fail("DELIO_ADMIN_XOF_PER_USD must be a positive number of CFA francs, such as 600");
if (xofPerUsd === undefined && currency !== "USD") console.warn("delio-admin: no DELIO_ADMIN_XOF_PER_USD, so prices in CFA francs use 600 francs to the dollar");
const saspayKey = env.DELIO_ADMIN_SASPAY_KEY?.trim() || undefined;
if (saspayKey && !env.DELIO_ADMIN_SASPAY_WEBHOOK_SECRET?.trim()) fail("set DELIO_ADMIN_SASPAY_WEBHOOK_SECRET to the signing secret SasPay showed when the webhook was created");
if (production && saspayKey?.startsWith("sk_test_")) console.warn("delio-admin: SasPay is in test mode, so no real payment is taken");
if (!saspayKey) console.warn("delio-admin: no DELIO_ADMIN_SASPAY_KEY, so plans and top-ups cannot be paid");
const payments = { saspayKey, webhookSecret: env.DELIO_ADMIN_SASPAY_WEBHOOK_SECRET?.trim(), currency, xofPerUsd };
const workspaceDomain = env.DELIO_ADMIN_WORKSPACE_DOMAIN?.trim().toLowerCase() || undefined;
if (workspaceDomain && !/^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(workspaceDomain)) fail("DELIO_ADMIN_WORKSPACE_DOMAIN must be a domain, such as deliobot.fun");
const workspaceModels = (env.DELIO_ADMIN_WORKSPACE_MODELS ?? "").split(",").map((id) => id.trim()).filter(Boolean);
if (workspaceModels.some((id) => !/^[A-Za-z0-9][A-Za-z0-9._-]*\/[A-Za-z0-9][A-Za-z0-9._:/+-]*$/.test(id))) fail("DELIO_ADMIN_WORKSPACE_MODELS must be OpenRouter model IDs separated by commas");
if (!workspaceDomain) console.warn("delio-admin: no DELIO_ADMIN_WORKSPACE_DOMAIN, so self-serve sign-up is off and only operators create workspaces");
const hosting = workspaceDomain
  ? { domain: workspaceDomain, models: workspaceModels.length ? workspaceModels : DEFAULT_WORKSPACE_MODELS, fleetSocket: env.ODB_FLEET_SOCKET?.trim() || undefined }
  : undefined;
const app = createAdminApp({ store, publicUrl, operators, mailer, gateway, payments, ...(hosting ? { hosting } : {}) });
const server = createServer(app);
const sweeper = setInterval(() => void app.sweep().catch((error: unknown) => console.error("delio-admin: billing sweep failed", error)), 60_000);
server.listen(port, host, () => console.log(`delio-admin: listening on http://${host}:${port}, public at ${publicUrl.origin}`));

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => { clearInterval(sweeper); server.close(() => { store.close(); process.exit(0); }); });
}
