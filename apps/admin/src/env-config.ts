// The portal's settings from its environment, the same on a server (process.env) and on Cloudflare (the Worker's env).
import { DEFAULT_WORKSPACE_MODELS } from "./hosting.ts";
import { consoleMailer, httpMailer, type Mailer } from "./mail.ts";
import { normalizeEmail } from "./store.ts";

export type PortalEnv = Record<string, string | undefined>;

export interface PortalSettings {
  publicUrl: URL;
  production: boolean;
  /** At least 32 characters in production; a server in development makes one up when it is missing. */
  secret: string | undefined;
  mailer: Mailer;
  operators: Set<string>;
  gateway: { openrouterKey?: string; falKey?: string; boatKey?: string; boatUsdPerHour?: number; creditUsd?: number };
  payments: { saspayKey?: string; webhookSecret?: string; currency: string; xofPerUsd?: number };
  hosting?: { domain: string; models: string[]; fleetSocket?: string };
  signup?: { downloadUrl: string };
  warnings: string[];
}

/** Reads and checks the settings; a wrong one throws with the sentence that says how to fix it. */
export function portalSettings(env: PortalEnv): PortalSettings {
  const fail = (message: string): never => { throw new Error(message); };
  const warnings: string[] = [];
  const publicUrl = new URL(env.DELIO_ADMIN_URL ?? "http://localhost:8790");
  const production = publicUrl.protocol === "https:";
  if (publicUrl.pathname !== "/" || publicUrl.search) fail("DELIO_ADMIN_URL must be an origin, such as https://compte.deliobot.fun");

  const secret = env.DELIO_ADMIN_SECRET;
  if (production && (!secret || secret.length < 32)) fail("set DELIO_ADMIN_SECRET to at least 32 random characters (openssl rand -base64 48)");

  let mailer: Mailer = consoleMailer;
  if (env.DELIO_ADMIN_MAIL_API_KEY) {
    if (!env.DELIO_ADMIN_MAIL_FROM) fail("set DELIO_ADMIN_MAIL_FROM, such as Delio <signin@deliobot.fun>");
    mailer = httpMailer({ endpoint: env.DELIO_ADMIN_MAIL_ENDPOINT ?? "https://api.resend.com/emails", apiKey: env.DELIO_ADMIN_MAIL_API_KEY, from: env.DELIO_ADMIN_MAIL_FROM! });
  } else if (!production || env.DELIO_ADMIN_MAIL === "console") {
    warnings.push("sign-in codes and invitations are printed here, not emailed");
  } else {
    fail("set DELIO_ADMIN_MAIL_API_KEY and DELIO_ADMIN_MAIL_FROM so sign-in codes can be emailed");
  }

  const operators = new Set((env.DELIO_ADMIN_OPERATORS ?? "").split(",").map(normalizeEmail).filter(Boolean));
  if (operators.size === 0) warnings.push("no DELIO_ADMIN_OPERATORS, so nobody can open the operators' console");

  const creditUsd = env.DELIO_ADMIN_CREDIT_USD ? Number(env.DELIO_ADMIN_CREDIT_USD) : undefined;
  if (creditUsd !== undefined && !(creditUsd > 0)) fail("DELIO_ADMIN_CREDIT_USD must be a positive number of dollars, such as 0.002");
  const boatUsdPerHour = env.DELIO_ADMIN_BOAT_USD_PER_HOUR ? Number(env.DELIO_ADMIN_BOAT_USD_PER_HOUR) : undefined;
  if (boatUsdPerHour !== undefined && !(boatUsdPerHour > 0)) fail("DELIO_ADMIN_BOAT_USD_PER_HOUR must be a positive number of dollars");
  const gateway = { openrouterKey: env.DELIO_ADMIN_OPENROUTER_KEY?.trim() || undefined, falKey: env.DELIO_ADMIN_FAL_KEY?.trim() || undefined,
    boatKey: env.DELIO_ADMIN_BOAT_KEY?.trim() || undefined, boatUsdPerHour, creditUsd };
  if (!gateway.openrouterKey && !gateway.falKey) warnings.push("no DELIO_ADMIN_OPENROUTER_KEY or DELIO_ADMIN_FAL_KEY, so the AI gateway refuses every request");

  const currency = (env.DELIO_ADMIN_CURRENCY ?? "XOF").trim().toUpperCase();
  const xofPerUsd = env.DELIO_ADMIN_XOF_PER_USD ? Number(env.DELIO_ADMIN_XOF_PER_USD) : undefined;
  if (!["XOF", "XAF", "USD"].includes(currency)) fail("DELIO_ADMIN_CURRENCY must be XOF, XAF or USD");
  if (xofPerUsd !== undefined && !(xofPerUsd > 0)) fail("DELIO_ADMIN_XOF_PER_USD must be a positive number of CFA francs, such as 600");
  if (xofPerUsd === undefined && currency !== "USD") warnings.push("no DELIO_ADMIN_XOF_PER_USD, so prices in CFA francs use 600 francs to the dollar");
  const saspayKey = env.DELIO_ADMIN_SASPAY_KEY?.trim() || undefined;
  if (saspayKey && !env.DELIO_ADMIN_SASPAY_WEBHOOK_SECRET?.trim()) fail("set DELIO_ADMIN_SASPAY_WEBHOOK_SECRET to the signing secret SasPay showed when the webhook was created");
  if (production && saspayKey?.startsWith("sk_test_")) warnings.push("SasPay is in test mode, so no real payment is taken");
  if (!saspayKey) warnings.push("no DELIO_ADMIN_SASPAY_KEY, so plans and top-ups cannot be paid");
  const payments = { saspayKey, webhookSecret: env.DELIO_ADMIN_SASPAY_WEBHOOK_SECRET?.trim(), currency, xofPerUsd };

  const domain = env.DELIO_ADMIN_WORKSPACE_DOMAIN?.trim().toLowerCase() || undefined;
  if (domain && !/^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(domain)) fail("DELIO_ADMIN_WORKSPACE_DOMAIN must be a domain, such as deliobot.fun");
  const models = (env.DELIO_ADMIN_WORKSPACE_MODELS ?? "").split(",").map((id) => id.trim()).filter(Boolean);
  if (models.some((id) => !/^[A-Za-z0-9][A-Za-z0-9._-]*\/[A-Za-z0-9][A-Za-z0-9._:/+-]*$/.test(id))) fail("DELIO_ADMIN_WORKSPACE_MODELS must be OpenRouter model IDs separated by commas");
  const hosting = domain ? { domain, models: models.length ? models : DEFAULT_WORKSPACE_MODELS, fleetSocket: env.ODB_FLEET_SOCKET?.trim() || undefined } : undefined;

  const download = env.DELIO_ADMIN_DOWNLOAD_URL?.trim();
  if (download && !/^https:\/\/[^\s]+$/.test(download)) fail("DELIO_ADMIN_DOWNLOAD_URL must be an https:// address, such as https://deliobot.fun/#telecharger");
  const signup = !hosting && download ? { downloadUrl: download } : undefined;
  if (!hosting && !signup) warnings.push("no DELIO_ADMIN_WORKSPACE_DOMAIN or DELIO_ADMIN_DOWNLOAD_URL, so self-serve sign-up is off and only operators create workspaces");

  return { publicUrl, production, secret, mailer, operators, gateway, payments, ...(hosting ? { hosting } : {}), ...(signup ? { signup } : {}), warnings };
}
