// Delio's customers' portal on Cloudflare: one Durable Object holds the portal and its SQLite database, every request
// goes through it, and an alarm runs the once-a-minute billing sweep.
import { DurableObject } from "cloudflare:workers";

import { createAdminApp, type AdminApp } from "../../../apps/admin/src/app.ts";
import { portalSettings } from "../../../apps/admin/src/env-config.ts";
import { serveFetch } from "../../../apps/admin/src/fetch-adapter.ts";
import { catalog } from "../../../apps/admin/src/plans.ts";
import { durableObjectDatabase } from "../../../apps/admin/src/sql.ts";
import { AdminStore } from "../../../apps/admin/src/store.ts";
import curious from "../../../src/assets/delio-steel/cursor.curious-88.webp";
import happy from "../../../src/assets/delio-steel/cursor.happy-88.webp";
import idle from "../../../src/assets/delio-steel/cursor-88.webp";
import sad from "../../../src/assets/delio-steel/cursor.sad-88.webp";

interface Env extends Record<string, unknown> {
  PORTAL: DurableObjectNamespace<Portal>;
}

const SWEEP_MS = 60_000;
const ASSETS = new Map<string, Uint8Array>([
  ["/assets/delio-idle.webp", new Uint8Array(idle)], ["/assets/delio-happy.webp", new Uint8Array(happy)],
  ["/assets/delio-sad.webp", new Uint8Array(sad)], ["/assets/delio-curious.webp", new Uint8Array(curious)],
]);

const unavailable = () => new Response(
  "<!doctype html><meta charset=utf-8><meta name=viewport content='width=device-width,initial-scale=1'><title>Delio</title>" +
  "<body style='font:16px system-ui;display:grid;place-items:center;min-height:90vh;text-align:center'><div><h1>Bientôt disponible</h1>" +
  "<p>Les inscriptions ouvrent très prochainement. <a href='https://deliobot.fun'>Retour à deliobot.fun</a></p></div>",
  { status: 503, headers: { "content-type": "text/html; charset=utf-8", "retry-after": "3600" } });

export class Portal extends DurableObject<Env> {
  private readonly app: AdminApp | null;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    let app: AdminApp | null = null;
    try {
      const settings = portalSettings(Object.fromEntries(Object.entries(env).filter(([, value]) => typeof value === "string")) as Record<string, string>);
      for (const warning of settings.warnings) console.warn(`delio-admin: ${warning}`);
      const store = new AdminStore({ db: durableObjectDatabase(ctx.storage), secret: Buffer.from(settings.secret ?? "") });
      app = createAdminApp({ store, publicUrl: settings.publicUrl, operators: settings.operators, mailer: settings.mailer, gateway: settings.gateway,
        payments: settings.payments, assets: ASSETS, ...(settings.signup ? { signup: settings.signup } : {}) });
    } catch (error) {
      console.error(`delio-admin: not configured: ${error instanceof Error ? error.message : String(error)}`);
    }
    this.app = app;
    if (app) void ctx.blockConcurrencyWhile(async () => { if (!(await ctx.storage.getAlarm())) await ctx.storage.setAlarm(Date.now() + SWEEP_MS); });
  }

  async fetch(request: Request): Promise<Response> {
    if (!this.app && new URL(request.url).pathname === "/api/public/plans") {
      const rate = Number(this.env.DELIO_ADMIN_XOF_PER_USD);
      return Response.json(catalog(rate > 0 ? rate : undefined), { headers: { "access-control-allow-origin": "*", "cache-control": "public, max-age=300" } });
    }
    if (!this.app) return unavailable();
    return serveFetch(this.app, request, request.headers.get("cf-connecting-ip") ?? "unknown");
  }

  async alarm(): Promise<void> {
    try { await this.app?.sweep(); } catch (error) { console.error("delio-admin: billing sweep failed", error); }
    await this.ctx.storage.setAlarm(Date.now() + SWEEP_MS);
  }
}

export default {
  fetch(request: Request, env: Env): Promise<Response> {
    return env.PORTAL.get(env.PORTAL.idFromName("portal")).fetch(request);
  },
} satisfies ExportedHandler<Env>;
