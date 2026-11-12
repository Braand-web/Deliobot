// Delio's customers' portal on Cloudflare: one Durable Object holds the portal and its SQLite database, every request
// goes through it, and an alarm runs the once-a-minute billing sweep and the Composio broker's hourly one.
import { DurableObject } from "cloudflare:workers";

import "./fetch-redirects.ts";

import { createAdminApp, type AdminApp } from "../../../apps/admin/src/app.ts";
import { portalSettings } from "../../../apps/admin/src/env-config.ts";
import { serveFetch } from "../../../apps/admin/src/fetch-adapter.ts";
import { catalog } from "../../../apps/admin/src/plans.ts";
import { handleSetup, SETTINGS_KEY, SETUP_DONE_KEY, tokenDigest } from "./setup.ts";
import { durableObjectDatabase } from "../../../apps/admin/src/sql.ts";
import { AdminStore } from "../../../apps/admin/src/store.ts";
import curious from "../../../src/assets/delio-steel/cursor.curious-88.webp";
import happy from "../../../src/assets/delio-steel/cursor.happy-88.webp";
import idle from "../../../src/assets/delio-steel/cursor-88.webp";
import sad from "../../../src/assets/delio-steel/cursor.sad-88.webp";

interface Env extends Record<string, unknown> {
  PORTAL: DurableObjectNamespace<Portal>;
  COMPOSIO_SWEEP?: { run(): Promise<void> };
}

const SWEEP_MS = 60_000;
const COMPOSIO_SWEEP_MS = 3_600_000;
const COMPOSIO_SWEPT_KEY = "composio-swept-at";
const ASSETS = new Map<string, Uint8Array>([
  ["/assets/delio-idle.webp", new Uint8Array(idle)], ["/assets/delio-happy.webp", new Uint8Array(happy)],
  ["/assets/delio-sad.webp", new Uint8Array(sad)], ["/assets/delio-curious.webp", new Uint8Array(curious)],
]);

const unavailable = () => new Response(
  "<!doctype html><meta charset=utf-8><meta name=viewport content='width=device-width,initial-scale=1'><title>Delio</title>" +
  "<body style='font:16px system-ui;display:grid;place-items:center;min-height:90vh;text-align:center'><div><h1>Bientôt disponible</h1>" +
  "<p>Les inscriptions ouvrent très prochainement. <a href='https://deliobot.fun'>Retour à deliobot.fun</a></p></div>",
  { status: 503, headers: { "content-type": "text/html; charset=utf-8", "retry-after": "3600" } });

/** The operators' console answers only on its own host, a customer's portal never serves it. */
function consoleHost(env: Env): string | null {
  return typeof env.DELIO_ADMIN_CONSOLE_URL === "string" && env.DELIO_ADMIN_CONSOLE_URL ? new URL(env.DELIO_ADMIN_CONSOLE_URL).host : null;
}

export class Portal extends DurableObject<Env> {
  private app: AdminApp | null = null;
  private operatorsConsole: { host: string; app: AdminApp } | null = null;
  private stored: Record<string, string> = {};
  private setupDone = false;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    void ctx.blockConcurrencyWhile(async () => {
      this.stored = (await ctx.storage.get<Record<string, string>>(SETTINGS_KEY)) ?? {};
      const token = typeof env.SETUP_TOKEN === "string" ? env.SETUP_TOKEN : "";
      this.setupDone = Boolean(token) && (await ctx.storage.get<string>(SETUP_DONE_KEY)) === await tokenDigest(token);
      this.start();
      if (this.app && !(await ctx.storage.getAlarm())) await ctx.storage.setAlarm(Date.now() + SWEEP_MS);
    });
  }

  private baseEnv(): Record<string, string> {
    return Object.fromEntries(Object.entries(this.env).filter(([name, value]) => typeof value === "string" && name !== "SETUP_TOKEN")) as Record<string, string>;
  }

  /** Builds the portal from the Worker's settings, with those saved by the setup page on top. */
  private start(): void {
    try {
      const base = this.baseEnv();
      const settings = portalSettings({ ...base, ...this.stored, ...(base.DELIO_ADMIN_OPERATORS ? { DELIO_ADMIN_OPERATORS: base.DELIO_ADMIN_OPERATORS } : {}) });
      for (const warning of settings.warnings) console.warn(`delio-admin: ${warning}`);
      const store = new AdminStore({ db: durableObjectDatabase(this.ctx.storage), secret: Buffer.from(settings.secret ?? "") });
      this.app = createAdminApp({ store, publicUrl: settings.publicUrl, operators: settings.operators, mailer: settings.mailer, gateway: settings.gateway,
        payments: settings.payments, assets: ASSETS, ...(settings.signup ? { signup: settings.signup } : {}) });
      const consoleUrl = base.DELIO_ADMIN_CONSOLE_URL ? new URL(base.DELIO_ADMIN_CONSOLE_URL) : null;
      this.operatorsConsole = consoleUrl && settings.operators.size > 0 ? { host: consoleUrl.host, app: createAdminApp({ store, publicUrl: consoleUrl,
        operators: settings.operators, mailer: settings.mailer, payments: settings.payments, assets: ASSETS, console: true }) } : null;
    } catch (error) {
      this.app = null;
      this.operatorsConsole = null;
      console.error(`delio-admin: not configured: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async fetch(request: Request): Promise<Response> {
    const host = new URL(request.url).host;
    if (host === consoleHost(this.env)) {
      if (!this.operatorsConsole) return new Response("Not found.", { status: 404 });
      return serveFetch(this.operatorsConsole.app, request, request.headers.get("cf-connecting-ip") ?? "unknown");
    }
    const setup = await handleSetup(request, {
      setupToken: typeof this.env.SETUP_TOKEN === "string" ? this.env.SETUP_TOKEN : undefined, done: this.setupDone, stored: this.stored, baseEnv: this.baseEnv(),
      save: async (settings) => {
        await this.ctx.storage.put(SETTINGS_KEY, settings);
        await this.ctx.storage.put(SETUP_DONE_KEY, await tokenDigest(String(this.env.SETUP_TOKEN)));
        this.stored = settings;
        this.setupDone = true;
        this.start();
        if (this.app && !(await this.ctx.storage.getAlarm())) await this.ctx.storage.setAlarm(Date.now() + SWEEP_MS);
      },
    });
    if (setup) return setup;
    if (!this.app && new URL(request.url).pathname === "/api/public/plans") {
      const rate = Number(this.env.DELIO_ADMIN_XOF_PER_USD);
      return Response.json(catalog(rate > 0 ? rate : undefined), { headers: { "access-control-allow-origin": "*", "cache-control": "public, max-age=300" } });
    }
    if (!this.app) return unavailable();
    return serveFetch(this.app, request, request.headers.get("cf-connecting-ip") ?? "unknown");
  }

  async alarm(): Promise<void> {
    try { await this.app?.sweep(); } catch (error) { console.error("delio-admin: billing sweep failed", error); }
    await this.sweepComposio();
    await this.ctx.storage.setAlarm(Date.now() + SWEEP_MS);
  }

  private async sweepComposio(): Promise<void> {
    const now = Date.now();
    if (!this.env.COMPOSIO_SWEEP || now - ((await this.ctx.storage.get<number>(COMPOSIO_SWEPT_KEY)) ?? 0) < COMPOSIO_SWEEP_MS) return;
    await this.ctx.storage.put(COMPOSIO_SWEPT_KEY, now);
    try { await this.env.COMPOSIO_SWEEP.run(); } catch (error) { console.error("delio-apps: hourly sweep failed", error); }
  }
}

export default {
  fetch(request: Request, env: Env): Promise<Response> {
    return env.PORTAL.get(env.PORTAL.idFromName("portal")).fetch(request);
  },
} satisfies ExportedHandler<Env>;
