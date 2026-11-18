import type { IncomingMessage, ServerResponse } from "node:http";

import type { Devices } from "../devices.ts";
import type { AppHosting } from "../app-hosting.ts";
import type { Hosting } from "../hosting.ts";
import type { Reports } from "../reports.ts";
import { GRACE_MS as GRACE, MANUAL_ORDER_PREFIX, PLANS, type Billing, type Cycle, type Order, type PlanId } from "../plans.ts";
import type { SasPay } from "../saspay.ts";
import { token, type Account, type AdminStore, type Workspace } from "../store.ts";
import { MICRO, type Wallet } from "../wallet.ts";
import { PLAN_FIELDS, SWITCHES, type AnnouncementLevel, type OperatorSettings, type PlanOverride, type Switch } from "../operator-settings.ts";
import { parseGifts, type Gift } from "../env-config.ts";
import type { Outbox } from "../outbox.ts";
import { normalizeCode, type Promos } from "../promos.ts";
import { DEFAULT_XOF_PER_USD } from "../plans.ts";
import { Metrics, period } from "./metrics.ts";
import type { Ambassador, Ambassadors } from "../ambassadors.ts";
import { linkFor, SITE_URL } from "../ambassador-pages.ts";
import { ambassadorPage, ambassadorsPage } from "./ambassador-pages.ts";
import { AUDIENCES, commsPage, pricingPage, promosPage, securityPage, systemPage } from "./settings-pages.ts";
import { CLIENT_FILTERS, clientPage, clientsPage, consolePage, dashboardPage, journalPage, n, ORDER_FILTERS, ordersPage, reportPage, reportsPage, sitesPage, trafficPage, type ClientRow, type ConsoleSection, type Flash } from "./pages.ts";

export interface ConsoleContext {
  store: AdminStore; wallet: Wallet; devices: Devices; reports: Reports; billing: Billing; hosting: Hosting; saspay: SasPay | null; currency: string;
  operators: ReadonlySet<string>; now: () => number;
  /** Included app hosting; absent where no bucket is bound. */
  sites?: AppHosting;
  settings: OperatorSettings; promos: Promos; outbox: Outbox; ambassadors: Ambassadors;
  /** Gives a plan to an e-mail's personal workspace, made if needed; answers the workspace. */
  gift: (gift: Gift, actor: string) => string | null;
  /** CFA francs to the dollar, as checkouts charge them now. */
  xofRate: () => number;
  /** Each provider or feature the portal can use, and whether its key or binding is set. */
  services: Record<string, boolean>;
  /** The environment's franc rate, when set. */
  xofPerUsd?: number;
  /** The customers' portal, where promo codes are typed. */
  customerUrl: string;
  /** The signed-in operator's session cookie, kept when they close their other sessions. */
  cookie: (req: IncomingMessage) => string | undefined;
  readForm: (req: IncomingMessage) => Promise<Record<string, unknown>>;
  redirect: (res: ServerResponse, location: string) => void;
  send: (res: ServerResponse, status: number, body: string, type: string, headers: Record<string, string>) => void;
}

const SLUG = "[a-z][a-z0-9-]{1,30}";
const ORDER_ID = "(?:ord|man)_[A-Za-z0-9_-]{8,40}";
const CLIENT_ACTION = new RegExp(`^/clients/(${SLUG})/(credits|forfait|suspendre|bloquer|appareil|jeton|supprimer)$`);
const CLIENT = new RegExp(`^/clients/(${SLUG})$`);
const ORDER_ACTION = new RegExp(`^/commandes/(${ORDER_ID})/(verifier|payee)$`);
const PAGES = new Set(["/ambassadeurs", "/", "/trafic", "/clients", "/commandes", "/signalements", "/journal", "/sites", "/promos", "/communication", "/forfaits", "/systeme", "/securite"]);
const SETTINGS_ACTION = /^\/(?:promos(?:\/([A-Z0-9_-]{3,32})\/(activer|desactiver|supprimer))?|communication\/(annonce|annonce\/retirer|envoyer)|forfaits\/(taux|offrir|trial|starter|pro|max|byok)(\/retablir)?|systeme\/(signups|payments|trial)|securite\/(sessions|debloquer))$/;
/** Audit actions the security page lists. */
const SENSITIVE = ["credits.add", "plan.grant", "gateway.token", "device.revoke", "account.block", "account.unblock", "workspace.delete", "workspace.suspend", "site.taken_down",
  "promo.created", "promo.deleted", "plan.price", "settings.switch", "settings.rate", "broadcast.sent", "security.sessions"];
const UNSUBSCRIBE = "\n\n—\nVous recevez cet e-mail parce que vous avez un compte Deliobot. Pour ne plus en recevoir, répondez simplement « STOP ».";
const SITE_ACTION = /^\/sites\/([a-z2-9]{10})\/retirer$/;
const AMBASSADOR = /^\/ambassadeurs\/(amb_[a-f0-9]{16})$/;
const AMBASSADOR_ACTION = /^\/ambassadeurs(?:\/(amb_[a-f0-9]{16})\/(valider|suspendre|modifier|prolongation)|\/retraits\/(\d{1,9}))?$/;
const REPORT = /^\/signalements\/([A-Za-z0-9_-]{8,20})(\/supprimer)?$/;
const PAGE_SIZE = 25;
/** Per-workspace tables the portal keeps besides the store's own; a deleted workspace leaves no row in them. */
const WORKSPACE_TABLES = ["wallets", "gateway_tokens", "holds", "subscriptions", "device_tokens", "hosting", "boat_included"] as const;

/** Whether a path belongs to the console's own pages and actions. */
export function consoleServes(path: string): boolean {
  return PAGES.has(path) || AMBASSADOR.test(path) || AMBASSADOR_ACTION.test(path) || SETTINGS_ACTION.test(path) || SITE_ACTION.test(path) || REPORT.test(path) || CLIENT.test(path) || CLIENT_ACTION.test(path) || ORDER_ACTION.test(path);
}

const FLASH: Record<string, (count: string) => Flash> = {
  credits: (count) => ({ kind: "ok", text: Number(count) >= 0 ? `${n(Number(count))} crédits ajoutés` : `${n(-Number(count))} crédits retirés` }),
  plan: () => ({ kind: "ok", text: "Forfait offert et appliqué" }),
  suspended: () => ({ kind: "ok", text: "Espace suspendu" }), resumed: () => ({ kind: "ok", text: "Espace réactivé" }),
  blocked: () => ({ kind: "ok", text: "Compte bloqué" }), unblocked: () => ({ kind: "ok", text: "Compte débloqué" }),
  device: () => ({ kind: "ok", text: "Application déconnectée" }), "site-down": () => ({ kind: "ok", text: "Site retiré : son adresse ne répond plus" }), "report-deleted": () => ({ kind: "ok", text: "Signalement supprimé" }), deleted: () => ({ kind: "ok", text: "Espace supprimé" }),
  paid: () => ({ kind: "ok", text: "Commande marquée payée, crédits appliqués" }), "already-paid": () => ({ kind: "bad", text: "Cette commande était déjà payée" }),
  "recheck-paid": () => ({ kind: "ok", text: "SasPay confirme le paiement : commande appliquée" }),
  "recheck-pending": () => ({ kind: "ok", text: "SasPay : paiement toujours en attente" }),
  "recheck-failed": () => ({ kind: "bad", text: "SasPay : paiement échoué ou expiré" }),
  "recheck-error": () => ({ kind: "bad", text: "SasPay n'a pas répondu, réessayez plus tard" }),
  "no-payments": () => ({ kind: "bad", text: "Les paiements SasPay ne sont pas configurés" }),
  "bad-credits": () => ({ kind: "bad", text: "Entrez un nombre de crédits (non nul)" }),
  hosted: () => ({ kind: "bad", text: "Arrêtez d'abord l'hébergement et les ordinateurs cloud de cet espace" }),
  "promo-created": () => ({ kind: "ok", text: "Code créé" }), "promo-exists": () => ({ kind: "bad", text: "Ce code existe déjà" }),
  "promo-invalid": () => ({ kind: "bad", text: "Code invalide : 3 à 32 lettres, chiffres, tirets ; réduction de 1 à 100 %" }),
  "promo-on": () => ({ kind: "ok", text: "Code activé" }), "promo-off": () => ({ kind: "ok", text: "Code désactivé" }), "promo-deleted": () => ({ kind: "ok", text: "Code supprimé" }),
  announced: () => ({ kind: "ok", text: "Annonce publiée : le site l'affiche d'ici une minute" }), unannounced: () => ({ kind: "ok", text: "Annonce retirée" }),
  "bad-announcement": () => ({ kind: "bad", text: "Écrivez un texte, et un lien en https:// s'il y en a un" }),
  queued: (count) => ({ kind: "ok", text: `${n(Number(count))} e-mails en cours d'envoi` }), "no-recipients": () => ({ kind: "bad", text: "Aucun destinataire, ou objet et message vides" }),
  "plan-saved": () => ({ kind: "ok", text: "Forfait enregistré : appliqué aux prochains paiements" }), "plan-reset": () => ({ kind: "ok", text: "Valeurs d'origine rétablies" }),
  "bad-gift": () => ({ kind: "bad", text: "Vérifiez l'e-mail, le forfait, le nombre de jours (1 à 400) et les crédits" }),
  "bad-plan": () => ({ kind: "bad", text: "Valeurs invalides : des nombres positifs" }), "rate-saved": () => ({ kind: "ok", text: "Taux enregistré" }),
  switched: () => ({ kind: "ok", text: "Réglage appliqué" }), "sessions-closed": (count) => ({ kind: "ok", text: `${n(Number(count))} session${Number(count) > 1 ? "s" : ""} fermée${Number(count) > 1 ? "s" : ""}` }),
  "amb-created": () => ({ kind: "ok", text: "Ambassadeur créé : il a reçu son accès par e-mail" }), "amb-exists": () => ({ kind: "bad", text: "Cette adresse a déjà un compte ambassadeur" }),
  "amb-approved": () => ({ kind: "ok", text: "Ambassadeur validé : il a reçu son accès par e-mail" }), "amb-suspended": () => ({ kind: "ok", text: "Ambassadeur suspendu" }),
  "amb-saved": () => ({ kind: "ok", text: "Informations enregistrées" }), "amb-extended": () => ({ kind: "ok", text: "Décision envoyée à l'ambassadeur" }),
  "amb-paid": () => ({ kind: "ok", text: "Retrait marqué payé : l'ambassadeur est prévenu" }), "amb-bad": () => ({ kind: "bad", text: "Remplissez au moins le nom et un e-mail valide" }),
  "bad-confirm": () => ({ kind: "bad", text: "L'identifiant tapé ne correspond pas : rien n'a été supprimé" }),
  operator: () => ({ kind: "bad", text: "Un compte opérateur ne peut pas être bloqué ici" }),
};

const like = (value: string) => `%${value.replace(/[\\%_]/g, (char) => `\\${char}`)}%`;
const field = (body: Record<string, unknown>, key: string, max = 200) => typeof body[key] === "string" ? (body[key] as string).trim().slice(0, max) : "";

export function createConsole(ctx: ConsoleContext) {
  const { store, wallet, devices, reports, billing, hosting, now } = ctx;
  const metrics = new Metrics(store.db, wallet.creditUsd, now);

  function render(res: ServerResponse, user: Account, url: URL, page: { title: string; subtitle?: string; section: ConsoleSection; body: (ctx: { now: number }) => ReturnType<typeof dashboardPage>;
    period?: ReturnType<typeof period>; periodPath?: string }, status = 200): void {
    const nonce = token(16);
    const flashCode = url.searchParams.get("ok") ?? url.searchParams.get("erreur");
    const flash = flashCode && Object.hasOwn(FLASH, flashCode) ? FLASH[flashCode]!(url.searchParams.get("n") ?? "0") : null;
    const pendingOrders = Number((store.db.prepare("SELECT COUNT(*) AS n FROM orders WHERE status = 'pending' AND created_at > ?").get(now() - 2 * 86_400_000) as { n: number }).n);
    const html = consolePage({ ...page, body: page.body({ now: now() }), email: user.email, nonce, flash, pendingOrders, unreadReports: reports.unread(), pendingAmbassadors: ctx.ambassadors.pendingCount() });
    ctx.send(res, status, html, "text/html; charset=utf-8", {
      "content-security-policy": `default-src 'none'; style-src 'unsafe-inline'; img-src 'self'; script-src 'nonce-${nonce}'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'`,
    });
  }

  function dashboard(res: ServerResponse, user: Account, url: URL): void {
    const p = period(url.searchParams.get("p"), now());
    const revenue = metrics.revenue(p.from, p.to);
    const usage = metrics.usage(p.from, p.to);
    const traffic = metrics.traffic(p.from, p.to);
    render(res, user, url, { title: "Tableau de bord", subtitle: "Vue d'ensemble de Deliobot", section: "dash", period: p, periodPath: "/", body: ({ now: at }) => dashboardPage({
      period: p, now: at, revenue, revenuePrevious: metrics.revenue(p.previousFrom, p.from).usd,
      signups: metrics.signups(p.from, p.to), signupsPrevious: metrics.signups(p.previousFrom, p.from),
      costUsd: usage.costUsd, costPrevious: metrics.usage(p.previousFrom, p.from).costUsd, credits: usage.credits,
      visitors: traffic.visitors, visitorsPrevious: metrics.traffic(p.previousFrom, p.from).visitors,
      active: metrics.activeByPlan(), conversion: metrics.trialConversion(),
      series: { revenue: metrics.daily("revenue", p.days), cost: metrics.daily("cost", p.days), signups: metrics.daily("signups", p.days), visitors: metrics.daily("visitors", p.days) },
      providers: metrics.usageByProvider(p.from, p.to), watch: metrics.watchlist(), activity: metrics.recentActivity(8),
    }) });
  }

  function traffic(res: ServerResponse, user: Account, url: URL): void {
    const p = period(url.searchParams.get("p"), now());
    render(res, user, url, { title: "Trafic", subtitle: "Visites, provenance et conversion", section: "traffic", period: p, periodPath: "/trafic", body: () => trafficPage({
      period: p, daily: { visitors: metrics.daily("visitors", p.days) }, stats: metrics.traffic(p.from, p.to), previousVisitors: metrics.traffic(p.previousFrom, p.from).visitors,
    }) });
  }

  function clientRows(q: string): ClientRow[] {
    const pattern = like(q);
    const rows = store.db.prepare(`SELECT w.slug, w.name, w.created_at AS createdAt,
      (SELECT a.email FROM members m JOIN accounts a ON a.id = m.account_id WHERE m.workspace = w.slug AND m.role = 'admin' ORDER BY m.joined_at LIMIT 1) AS owner,
      COALESCE((SELECT balance FROM wallets WHERE workspace = w.slug), 0) AS balance,
      (SELECT MAX(paid_at) FROM orders WHERE workspace = w.slug AND status = 'paid' AND usd > 0) AS lastPaid,
      COALESCE((SELECT SUM(usd) FROM orders WHERE workspace = w.slug AND status = 'paid'), 0) AS paidUsd,
      EXISTS (SELECT 1 FROM suspensions WHERE workspace = w.slug) AS suspended
      FROM workspaces w WHERE ? = '' OR w.slug LIKE ? ESCAPE '\\' OR w.name LIKE ? ESCAPE '\\'
        OR EXISTS (SELECT 1 FROM members m JOIN accounts a ON a.id = m.account_id WHERE m.workspace = w.slug AND a.email LIKE ? ESCAPE '\\')
      ORDER BY w.created_at DESC`).all(q, pattern, pattern, pattern) as Array<{ slug: string; name: string; createdAt: number; owner: string | null; balance: number; lastPaid: number | null; paidUsd: number; suspended: number }>;
    return rows.map((row) => ({ slug: row.slug, name: row.name, createdAt: Number(row.createdAt), owner: row.owner, credits: Number(row.balance) / MICRO,
      lastPaid: row.lastPaid === null ? null : Number(row.lastPaid), paidUsd: Number(row.paidUsd), suspended: Boolean(Number(row.suspended)), subscription: billing.subscription(row.slug) }));
  }

  function clients(res: ServerResponse, user: Account, url: URL): void {
    const q = (url.searchParams.get("q") ?? "").trim().slice(0, 120);
    const asked = url.searchParams.get("filtre") ?? "all";
    const filter = CLIENT_FILTERS.some(([id]) => id === asked) ? asked : "all";
    const all = clientRows(q).filter((row) => filter === "all" || (filter === "suspended" ? row.suspended : !row.suspended && row.subscription.status === filter));
    const pages = Math.max(1, Math.ceil(all.length / PAGE_SIZE));
    const page = Math.min(pages, Math.max(1, Number(url.searchParams.get("page")) || 1));
    const paying = clientRows("").filter((row) => !row.suspended && (row.subscription.status === "active" || row.subscription.status === "grace")).length;
    render(res, user, url, { title: "Clients", subtitle: `${n(all.length)} client${all.length > 1 ? "s" : ""} · ${n(paying)} abonné${paying > 1 ? "s" : ""} payant${paying > 1 ? "s" : ""}`, section: "clients",
      body: ({ now: at }) => clientsPage({ rows: all.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE), total: all.length, q, filter, page, pages, now: at }) });
  }

  function client(res: ServerResponse, user: Account, url: URL, workspace: Workspace, issuedToken?: string): void {
    const members = store.members(workspace.slug).map((member) => ({ ...member, blocked: store.blocked(member.accountId), operator: ctx.operators.has(member.email) }));
    render(res, user, url, { title: workspace.name, subtitle: "Fiche client", section: "clients", body: ({ now: at }) => clientPage({
      slug: workspace.slug, name: workspace.name, tenantUrl: workspace.tenantUrl, createdAt: workspace.createdAt, subscription: billing.subscription(workspace.slug),
      suspension: store.suspension(workspace.slug), members, credits: wallet.balance(workspace.slug) / MICRO, usedThisMonth: wallet.usedThisMonth(workspace.slug) / MICRO,
      ledger: wallet.ledger(workspace.slug, 100), orders: billing.orders(workspace.slug, 100), devices: devices.list(workspace.slug),
      audit: store.auditLog(workspace.slug, 100), hosted: Boolean(hosting.get(workspace.slug)), hasToken: wallet.hasToken(workspace.slug), token: issuedToken,
    }, url.searchParams.get("onglet") ?? "apercu", at) });
  }

  async function clientAction(req: IncomingMessage, res: ServerResponse, user: Account, url: URL, workspace: Workspace, action: string): Promise<void> {
    const body = await ctx.readForm(req);
    const slug = workspace.slug;
    const back = (code: string, extra = "") => ctx.redirect(res, `/clients/${slug}?ok=${code}${extra}`);
    const fail = (code: string) => ctx.redirect(res, `/clients/${slug}?erreur=${code}`);
    switch (action) {
      case "credits": {
        const credits = Math.round(Number(field(body, "credits", 16)));
        if (!Number.isFinite(credits) || credits === 0 || Math.abs(credits) > 10_000_000) return fail("bad-credits");
        wallet.credit(slug, credits * MICRO, credits > 0 ? "grant" : "adjust", field(body, "note") || null);
        store.audit(slug, user.email, "credits.add", String(credits));
        return back("credits", `&n=${credits}`);
      }
      case "forfait": {
        const plan = field(body, "plan", 16);
        if (!Object.hasOwn(PLANS, plan)) return fail("bad-credits");
        const cycle: Cycle = field(body, "cycle", 8) === "year" ? "year" : "month";
        const order = billing.grantPlan(slug, user.email, plan as PlanId, cycle, ctx.currency);
        store.audit(slug, user.email, "plan.grant", `${plan}:${order.cycle}`);
        return back("plan");
      }
      case "suspendre": {
        const suspended = field(body, "suspended", 1) === "1";
        store.setSuspended(slug, suspended, suspended ? field(body, "reason") || null : null, user.email);
        return back(suspended ? "suspended" : "resumed");
      }
      case "bloquer": {
        const account = store.account(field(body, "account", 64));
        if (!account || !store.role(slug, account.id)) return fail("bad-confirm");
        if (ctx.operators.has(account.email)) return fail("operator");
        const blocked = field(body, "blocked", 1) === "1";
        store.setBlocked(account.id, blocked, user.email);
        return back(blocked ? "blocked" : "unblocked");
      }
      case "appareil":
        devices.revoke(slug, field(body, "device", 32));
        store.audit(slug, user.email, "device.revoke", null);
        return back("device");
      case "jeton": {
        const issued = wallet.issueToken(slug);
        store.audit(slug, user.email, "gateway.token", null);
        return client(res, user, url, workspace, issued);
      }
      case "supprimer": {
        if (field(body, "confirm", 64) !== slug) return fail("bad-confirm");
        const computers = store.db.prepare("SELECT 1 FROM boat_sandboxes WHERE workspace = ? AND deleted = 0").get(slug);
        if (hosting.get(slug) || computers) return fail("hosted");
        store.deleteWorkspace(slug, user.email, WORKSPACE_TABLES);
        return ctx.redirect(res, "/clients?ok=deleted");
      }
    }
  }

  function orders(res: ServerResponse, user: Account, url: URL): void {
    const asked = url.searchParams.get("statut") ?? "all";
    const filter = ORDER_FILTERS.some(([id]) => id === asked) ? asked : "all";
    const q = (url.searchParams.get("q") ?? "").trim().slice(0, 120);
    const pattern = like(q);
    const rows = store.db.prepare(`SELECT id, workspace, email, kind, plan, cycle, credits, usd, amount, currency, session_id AS sessionId, checkout_url AS checkoutUrl, status, created_at AS createdAt
      FROM orders WHERE (? = 'all' OR status = ?) AND (? = '' OR workspace LIKE ? ESCAPE '\\' OR email LIKE ? ESCAPE '\\' OR id LIKE ? ESCAPE '\\')
      ORDER BY created_at DESC LIMIT 200`).all(filter, filter, q, pattern, pattern, pattern) as unknown as Order[];
    const totals = store.db.prepare(`SELECT COALESCE(SUM(CASE WHEN status = 'paid' THEN usd END), 0) AS paidUsd,
      COALESCE(SUM(CASE WHEN status = 'paid' AND currency IN ('XOF', 'XAF') THEN CAST(amount AS REAL) END), 0) AS paidFrancs,
      SUM(CASE WHEN status = 'paid' AND usd > 0 THEN 1 ELSE 0 END) AS paid, SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) AS pending,
      SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed FROM orders WHERE id NOT LIKE '${MANUAL_ORDER_PREFIX}%'`).get() as Record<string, number | null>;
    render(res, user, url, { title: "Commandes", subtitle: "Paiements SasPay", section: "orders", body: ({ now: at }) => ordersPage({ orders: rows, filter, q, now: at,
      totals: { paidUsd: Number(totals.paidUsd ?? 0), paidFrancs: Number(totals.paidFrancs ?? 0), paid: Number(totals.paid ?? 0), pending: Number(totals.pending ?? 0), failed: Number(totals.failed ?? 0) } }) });
  }

  async function orderAction(req: IncomingMessage, res: ServerResponse, user: Account, id: string, action: string): Promise<void> {
    await ctx.readForm(req);
    const order = billing.order(id);
    if (!order) return ctx.redirect(res, "/commandes");
    const back = (code: string) => ctx.redirect(res, `/commandes?ok=${code}`);
    if (action === "payee") {
      if (!billing.markPaid(id)) return back("already-paid");
      store.audit(order.workspace, user.email, "order.paid", id);
      return back("paid");
    }
    if (!ctx.saspay) return back("no-payments");
    if (!order.sessionId || order.status === "paid") return back("already-paid");
    let status: string;
    try { status = await ctx.saspay.sessionStatus(order.sessionId); } catch { return back("recheck-error"); }
    store.audit(order.workspace, user.email, "order.recheck", `${id}:${status}`);
    if (status === "PAID") { billing.fulfil(id); return back("recheck-paid"); }
    if (status === "FAILED" || status === "CANCELLED" || status === "EXPIRED") { billing.markFailed(id); return back("recheck-failed"); }
    return back("recheck-pending");
  }

  function journal(res: ServerResponse, user: Account, url: URL): void {
    const q = (url.searchParams.get("q") ?? "").trim().slice(0, 120);
    const page = Math.max(1, Math.min(1000, Number(url.searchParams.get("page")) || 1));
    const pattern = like(q);
    const rows = store.db.prepare(`SELECT workspace, actor, action, target, at FROM audit WHERE ? = '' OR workspace LIKE ? ESCAPE '\\' OR actor LIKE ? ESCAPE '\\'
      OR action LIKE ? ESCAPE '\\' OR target LIKE ? ESCAPE '\\' ORDER BY id DESC LIMIT ? OFFSET ?`).all(q, pattern, pattern, pattern, pattern, 51, (page - 1) * 50) as
      Array<{ workspace: string | null; actor: string | null; action: string; target: string | null; at: number }>;
    render(res, user, url, { title: "Journal", subtitle: "Toutes les actions", section: "journal",
      body: ({ now: at }) => journalPage({ rows: rows.slice(0, 50), q, page, more: rows.length > 50, now: at }) });
  }

  function reportList(res: ServerResponse, user: Account, url: URL): void {
    const page = Math.max(1, Math.min(1000, Number(url.searchParams.get("page")) || 1));
    const rows = reports.list(51, (page - 1) * 50);
    render(res, user, url, { title: "Signalements", subtitle: "Problèmes envoyés depuis l'application", section: "reports",
      body: ({ now: at }) => reportsPage({ rows: rows.slice(0, 50), page, more: rows.length > 50, now: at }) });
  }

  function reportDetail(res: ServerResponse, user: Account, url: URL, id: string): boolean {
    const report = reports.open(id);
    if (!report) return false;
    store.audit(report.workspace, user.email, "report.read", id);
    render(res, user, url, { title: "Signalement", subtitle: report.email ?? report.workspace, section: "reports", body: ({ now: at }) => reportPage(report, at) });
    return true;
  }

  const count = (sql: string, ...params: Array<string | number>) => Number((store.db.prepare(sql).get(...params) as { n: number }).n);

  function audienceEmails(audience: string): string[] {
    const paying = "SELECT workspace FROM subscriptions WHERE plan != 'trial' AND period_end > ?";
    const sql = audience === "all" ? "SELECT a.email FROM accounts a WHERE a.id NOT IN (SELECT account_id FROM blocked_accounts)"
      : `SELECT DISTINCT a.email FROM members m JOIN accounts a ON a.id = m.account_id WHERE m.role = 'admin' AND a.id NOT IN (SELECT account_id FROM blocked_accounts)${
        audience === "paying" ? ` AND m.workspace IN (${paying})` : audience === "trial" ? " AND m.workspace IN (SELECT workspace FROM trial_uses)" : ""}`;
    return (store.db.prepare(sql).all(...(audience === "paying" ? [now() - GRACE] : [])) as Array<{ email: string }>).map((row) => row.email);
  }

  const ambassadorRow = (ambassador: Ambassador) => ({ ambassador, stats: ctx.ambassadors.stats(ambassador), codes: ctx.ambassadors.codes(ambassador.id).filter((code) => code.active).map((code) => code.code) });

  /** The welcome an approved ambassador gets: their link, their code, how it works and where their space is. */
  function welcome(ambassador: Ambassador, code: string | null): void {
    const rules = ctx.ambassadors.rules();
    ctx.outbox.notify(ambassador.email, "Bienvenue dans le programme ambassadeurs Deliobot 🎉", `Bonjour ${ambassador.name},

Votre compte ambassadeur Deliobot est actif !
${code ? `\nVotre code : ${code}\nVotre lien : ${linkFor(code)}\n` : ""}
Comment ça marche :
1. Partagez votre lien ou votre code avec votre communauté.
2. Elle s'abonne avec, et reçoit +${rules.welcomeCredits} crédits offerts à son premier abonnement.
3. Vous touchez ${Math.round(rules.levels[0]!.rate * 100)} à ${Math.round(rules.levels.at(-1)!.rate * 100)} % de chaque abonnement pendant 6 mois, jusqu'à 24 mois pour les meilleurs.

Vos gains sont disponibles ${rules.holdDays} jours après chaque paiement : retrait en Mobile Money dès ${rules.minPayoutXof.toLocaleString("fr-FR")} FCFA, ou en crédits Delio à tout moment.

Votre espace (codes, liens, gains, textes prêts à partager) : ${ctx.customerUrl}/ambassadeur
Connectez-vous avec cette adresse e-mail.

Le programme en détail : ${SITE_URL}/ambassadeurs

Merci de faire grandir Deliobot avec nous !`);
  }

  function ambassadorPages(res: ServerResponse, user: Account, url: URL): boolean {
    if (url.pathname === "/ambassadeurs") {
      const asked = url.searchParams.get("filtre") ?? "all";
      const filter = ["pending", "active", "suspended"].includes(asked) ? asked : "all";
      const all = ctx.ambassadors.all(filter === "all" ? undefined : filter as Ambassador["status"]);
      const names = new Map(ctx.ambassadors.all().map((one) => [one.id, one]));
      render(res, user, url, { title: "Ambassadeurs", subtitle: "Programme d'affiliation : codes, liens et commissions", section: "ambassadors", body: ({ now: at }) => ambassadorsPage({
        rows: all.map(ambassadorRow), filter, totals: ctx.ambassadors.totals(), rate: ctx.xofRate(), now: at,
        payouts: ctx.ambassadors.payouts().map((payout) => ({ ...payout, name: names.get(payout.ambassador)?.name ?? "?", phone: names.get(payout.ambassador)?.phone ?? "" })) }) });
      return true;
    }
    const id = AMBASSADOR.exec(url.pathname)?.[1];
    const ambassador = id ? ctx.ambassadors.get(id) : null;
    if (!ambassador) return false;
    render(res, user, url, { title: ambassador.name, subtitle: "Ambassadeur", section: "ambassadors", body: ({ now: at }) => ambassadorPage({ row: ambassadorRow(ambassador), rules: ctx.ambassadors.rules(),
      commissions: ctx.ambassadors.commissions(ambassador.id), payouts: ctx.ambassadors.payouts(ambassador.id), codes: ctx.ambassadors.codes(ambassador.id), now: at }) });
    return true;
  }

  async function ambassadorAction(req: IncomingMessage, res: ServerResponse, user: Account, match: RegExpExecArray): Promise<void> {
    const body = await ctx.readForm(req);
    const [, id, action, payoutId] = match;
    const firstCode = (ambassador: Ambassador): string | null => {
      if (ctx.ambassadors.codes(ambassador.id).length) return ctx.ambassadors.codes(ambassador.id)[0]!.code;
      const made = ctx.ambassadors.createCode(ambassador, field(body, "code", 20) || ctx.ambassadors.suggestCode(ambassador));
      return made.ok ? made.code : (() => { const fallback = ctx.ambassadors.createCode(ambassador, ctx.ambassadors.suggestCode(ambassador)); return fallback.ok ? fallback.code : null; })();
    };
    if (payoutId) {
      const payout = ctx.ambassadors.markPayoutPaid(Number(payoutId), field(body, "reference", 80), user.email);
      const ambassador = payout ? ctx.ambassadors.get(payout.ambassador) : null;
      if (payout && ambassador) {
        store.audit(null, user.email, "ambassador.payout.paid", `${ambassador.email}:${payout.usd}`);
        ctx.outbox.notify(ambassador.email, "Votre retrait Deliobot a été envoyé 💸", `Bonjour ${ambassador.name},\n\nNous vous avons envoyé ${payout.usd.toFixed(2)} $ (≈ ${Math.round(payout.usd * ctx.xofRate()).toLocaleString("fr-FR")} FCFA) en Mobile Money au ${ambassador.phone}${payout.reference ? ` (réf. ${payout.reference})` : ""}.\n\nMerci et bonne continuation !\n${ctx.customerUrl}/ambassadeur`);
      }
      return ctx.redirect(res, "/ambassadeurs?ok=amb-paid");
    }
    if (!id) {
      const email = field(body, "email", 160).toLowerCase();
      if (!field(body, "name", 80) || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return ctx.redirect(res, "/ambassadeurs?erreur=amb-bad");
      const made = ctx.ambassadors.apply({ name: field(body, "name", 80), email, phone: field(body, "phone", 30), social: field(body, "social", 200) }, "active");
      if (!made) return ctx.redirect(res, "/ambassadeurs?erreur=amb-exists");
      store.audit(null, user.email, "ambassador.created", made.email);
      welcome(made, firstCode(made));
      return ctx.redirect(res, `/ambassadeurs/${made.id}?ok=amb-created`);
    }
    const ambassador = ctx.ambassadors.get(id);
    if (!ambassador) return ctx.redirect(res, "/ambassadeurs");
    const back = (code: string) => ctx.redirect(res, `/ambassadeurs/${ambassador.id}?ok=${code}`);
    switch (action) {
      case "valider": {
        const first = ambassador.status === "pending";
        ctx.ambassadors.update(ambassador.id, { status: "active" });
        store.audit(null, user.email, "ambassador.approved", ambassador.email);
        const active = ctx.ambassadors.get(ambassador.id)!;
        const code = firstCode(active);
        if (first) welcome(active, code);
        return back("amb-approved");
      }
      case "suspendre":
        ctx.ambassadors.update(ambassador.id, { status: "suspended" });
        store.audit(null, user.email, "ambassador.suspended", ambassador.email);
        return back("amb-suspended");
      case "modifier": {
        const rate = Number(field(body, "rate", 4));
        ctx.ambassadors.update(ambassador.id, { name: field(body, "name", 80) || ambassador.name, phone: field(body, "phone", 30), social: field(body, "social", 200),
          rateOverride: rate >= 1 && rate <= 50 ? rate / 100 : null });
        store.audit(null, user.email, "ambassador.updated", ambassador.email);
        return back("amb-saved");
      }
      case "prolongation": {
        const accept = field(body, "accept", 1) === "1";
        const months = ambassador.extensionRequest;
        ctx.ambassadors.decideExtension(ambassador.id, accept);
        store.audit(null, user.email, accept ? "ambassador.extended" : "ambassador.extension_refused", `${ambassador.email}:${months}`);
        if (months) ctx.outbox.notify(ambassador.email, accept ? `Prolongation accordée : ${months} mois par client 🎉` : "Votre demande de prolongation",
          accept ? `Bonjour ${ambassador.name},\n\nBonne nouvelle : vous touchez désormais vos commissions pendant ${months} mois pour chaque client (${Math.round(ctx.ambassadors.rules().extendedRate * 100)} % après le 6e mois).\n\n${ctx.customerUrl}/ambassadeur`
            : `Bonjour ${ambassador.name},\n\nNous ne pouvons pas accorder la prolongation pour le moment. Continuez comme ça : vous pourrez la redemander bientôt.\n\n${ctx.customerUrl}/ambassadeur`);
        return back("amb-extended");
      }
    }
    return back("amb-saved");
  }

  function settingsPage(res: ServerResponse, user: Account, url: URL, req: IncomingMessage): boolean {
    const { settings, promos, outbox } = ctx;
    const queued = count("SELECT COUNT(*) AS n FROM outbox WHERE state = 'queued'");
    switch (url.pathname) {
      case "/promos":
        render(res, user, url, { title: "Codes promo", subtitle: "Réductions et crédits offerts", section: "promos",
          body: ({ now: at }) => promosPage({ promos: promos.all(), plans: Object.values(settings.plans()), now: at, customerUrl: ctx.customerUrl }) });
        return true;
      case "/communication":
        render(res, user, url, { title: "Communication", subtitle: "Annonce du site et e-mails aux clients", section: "comms", body: ({ now: at }) => commsPage({
          announcement: settings.announcement(), broadcasts: outbox.broadcasts(), mail: ctx.services["E-mails (codes, rappels, annonces)"] ?? false, queued, now: at,
          audiences: Object.fromEntries(AUDIENCES.map(([id]) => [id, audienceEmails(id).length])) }) });
        return true;
      case "/forfaits": {
        const fromEnv = ctx.xofPerUsd ?? DEFAULT_XOF_PER_USD;
        render(res, user, url, { title: "Forfaits & prix", subtitle: "Prix, crédits et ordinateurs de chaque forfait", section: "pricing", body: () => pricingPage({
          plans: (Object.keys(PLANS) as PlanId[]).map((id) => ({ plan: settings.plan(id), base: PLANS[id], changed: settings.overridden(id),
            subscribers: count("SELECT COUNT(*) AS n FROM subscriptions WHERE plan = ? AND period_end > ?", id, now()) })),
          xof: { value: settings.xofPerUsd() ?? fromEnv, fromEnv, overridden: settings.xofPerUsd() !== null } }) });
        return true;
      }
      case "/systeme":
        render(res, user, url, { title: "Système", subtitle: "Ouvertures, services et données", section: "system", body: () => systemPage({
          services: ctx.services, queued,
          switches: SWITCHES.map(([id, label, detail]) => ({ id, label, detail, open: settings.isOpen(id) })),
          counts: [["Comptes", count("SELECT COUNT(*) AS n FROM accounts")], ["Espaces", count("SELECT COUNT(*) AS n FROM workspaces")],
            ["Abonnements en cours", count("SELECT COUNT(*) AS n FROM subscriptions WHERE period_end > ?", now())], ["Commandes", count("SELECT COUNT(*) AS n FROM orders")],
            ["Applications connectées", count("SELECT COUNT(*) AS n FROM device_tokens")], ["Sessions ouvertes", count("SELECT COUNT(*) AS n FROM sessions WHERE expires_at > ?", now())],
            ["Signalements", count("SELECT COUNT(*) AS n FROM problem_reports")], ["Codes promo", count("SELECT COUNT(*) AS n FROM promo_codes")]] }) });
        return true;
      case "/securite": {
        const self = ctx.cookie(req);
        const operators = [...ctx.operators].sort().map((email) => {
          const id = (store.db.prepare("SELECT id FROM accounts WHERE email = ?").get(email) as { id: string } | undefined)?.id ?? null;
          return { email, id, sessions: id ? store.sessionCount(id) : 0, self: email === user.email && Boolean(self) };
        });
        const blocked = store.db.prepare("SELECT a.id, a.email, b.at FROM blocked_accounts b JOIN accounts a ON a.id = b.account_id ORDER BY b.at DESC LIMIT 100").all() as Array<{ id: string; email: string; at: number }>;
        const logins = store.db.prepare("SELECT actor, target, at FROM audit WHERE action = 'console.login' ORDER BY id DESC LIMIT 15").all() as Array<{ actor: string | null; target: string | null; at: number }>;
        const actions = store.db.prepare(`SELECT workspace, actor, action, target, at FROM audit WHERE action IN (${SENSITIVE.map(() => "?").join(", ")}) ORDER BY id DESC LIMIT 25`).all(...SENSITIVE) as
          Array<{ workspace: string | null; actor: string | null; action: string; target: string | null; at: number }>;
        render(res, user, url, { title: "Sécurité", subtitle: "Opérateurs, sessions et comptes bloqués", section: "security",
          body: ({ now: at }) => securityPage({ operators, blocked: blocked.map((row) => ({ ...row, at: Number(row.at) })), logins, actions, now: at }) });
        return true;
      }
    }
    return false;
  }

  async function settingsAction(req: IncomingMessage, res: ServerResponse, user: Account, match: RegExpExecArray): Promise<void> {
    const { settings, promos, outbox } = ctx;
    const body = await ctx.readForm(req);
    const go = (page: string, code: string, extra = "") => ctx.redirect(res, `${page}?ok=${code}${extra}`);
    const [, promoCode, promoAction, comms, planTarget, planReset, switchName, security] = match;
    if (match[0] === "/promos") {
      const day = field(body, "expires", 10);
      const expiresAt = /^\d{4}-\d{2}-\d{2}$/.test(day) ? Date.parse(`${day}T23:59:59Z`) : null;
      const max = field(body, "max", 9);
      const chosen = ([] as unknown[]).concat(body.plans ?? []).map(String).filter((id) => Object.hasOwn(PLANS, id) && id !== "trial") as PlanId[];
      const outcome = promos.create({ code: field(body, "code", 40), kind: field(body, "kind", 8) === "credits" ? "credits" : "percent", value: Number(field(body, "value", 9)),
        maxUses: max ? Number(max) : null, expiresAt, plans: chosen.length ? chosen : null, note: field(body, "note", 120) || null }, user.email);
      if (outcome === "ok") store.audit(null, user.email, "promo.created", normalizeCode(field(body, "code", 40)));
      return go("/promos", outcome === "ok" ? "promo-created" : outcome === "exists" ? "promo-exists" : "promo-invalid");
    }
    if (promoCode) {
      if (promoAction === "supprimer") { promos.remove(promoCode); store.audit(null, user.email, "promo.deleted", promoCode); return go("/promos", "promo-deleted"); }
      promos.setActive(promoCode, promoAction === "activer");
      return go("/promos", promoAction === "activer" ? "promo-on" : "promo-off");
    }
    if (comms === "annonce/retirer") { settings.setAnnouncement(null); store.audit(null, user.email, "announcement.removed", null); return go("/communication", "unannounced"); }
    if (comms === "annonce") {
      const text = field(body, "text", 140), link = field(body, "link", 300), until = field(body, "until", 10);
      const level = (["info", "promo", "warning"] as const).find((value) => value === field(body, "level", 10)) ?? "info";
      if (!text || (link && !/^https:\/\/[^\s"'<>]+$/.test(link))) return ctx.redirect(res, "/communication?erreur=bad-announcement");
      settings.setAnnouncement({ text, link: link || null, level: level as AnnouncementLevel, until: /^\d{4}-\d{2}-\d{2}$/.test(until) ? Date.parse(`${until}T23:59:59Z`) : null });
      store.audit(null, user.email, "announcement.published", text);
      return go("/communication", "announced");
    }
    if (comms === "envoyer") {
      const audience = AUDIENCES.find(([id]) => id === field(body, "audience", 10))?.[0];
      const subject = field(body, "subject", 140), text = field(body, "body", 8000);
      const queued = audience && subject && text ? outbox.queue({ subject, text: `${text}${UNSUBSCRIBE}`, audience, emails: audienceEmails(audience) }, user.email) : 0;
      if (!queued) return ctx.redirect(res, "/communication?erreur=no-recipients");
      store.audit(null, user.email, "broadcast.sent", `${audience}:${queued}`);
      return go("/communication", "queued", `&n=${queued}`);
    }
    if (planTarget === "offrir") {
      let gift: Gift;
      try { [gift] = parseGifts([{ email: field(body, "email", 160), plan: field(body, "plan", 10), days: Number(field(body, "days", 4)), credits: Number(field(body, "credits", 9) || "0") }]) as [Gift]; }
      catch { return ctx.redirect(res, "/forfaits?erreur=bad-gift"); }
      const workspace = ctx.gift(gift, user.email);
      return ctx.redirect(res, workspace ? `/clients/${workspace}?ok=plan` : "/forfaits?erreur=bad-gift");
    }
    if (planTarget === "taux") {
      const rate = Number(field(body, "rate", 12));
      settings.setXofPerUsd(rate >= 100 && rate <= 2000 ? rate : null);
      store.audit(null, user.email, "settings.rate", String(settings.xofPerUsd() ?? "env"));
      return go("/forfaits", "rate-saved");
    }
    if (planTarget) {
      const id = planTarget as PlanId;
      if (planReset) { settings.setPlan(id, {}); store.audit(null, user.email, "plan.price", `${id}:reset`); return go("/forfaits", "plan-reset"); }
      const values: PlanOverride = {};
      for (const key of PLAN_FIELDS) {
        const raw = field(body, key, 12);
        if (!raw) continue;
        const value = Number(raw);
        const money = key === "usd" || key === "usdYear";
        if (!Number.isFinite(value) || value < 0 || value > 1_000_000 || (money && value < 0.5) || (!money && !Number.isInteger(value))) return ctx.redirect(res, "/forfaits?erreur=bad-plan");
        values[key] = money ? Math.round(value * 100) / 100 : value;
      }
      settings.setPlan(id, values);
      store.audit(null, user.email, "plan.price", `${id}:${JSON.stringify(values)}`);
      return go("/forfaits", "plan-saved");
    }
    if (switchName) {
      const open = field(body, "open", 1) === "1";
      settings.setOpen(switchName as Switch, open);
      store.audit(null, user.email, "settings.switch", `${switchName}:${open ? "open" : "closed"}`);
      return go("/systeme", "switched");
    }
    const account = store.account(field(body, "account", 64));
    if (security === "debloquer") {
      if (account) store.setBlocked(account.id, false, user.email);
      return go("/securite", "unblocked");
    }
    if (!account || !ctx.operators.has(account.email)) return ctx.redirect(res, "/securite");
    const closed = store.endSessions(account.id, account.id === user.id ? ctx.cookie(req) : undefined);
    store.audit(null, user.email, "security.sessions", `${account.email}:${closed}`);
    return go("/securite", "sessions-closed", `&n=${closed}`);
  }

  /** Serves a console page or action for a signed-in operator; false when the path is not the console's. */
  return async function handle(req: IncomingMessage, res: ServerResponse, url: URL, user: Account): Promise<boolean> {
    const method = req.method ?? "GET";
    const path = url.pathname;
    if (method === "GET") {
      if (path === "/") { dashboard(res, user, url); return true; }
      if (path === "/trafic") { traffic(res, user, url); return true; }
      if (path === "/clients") { clients(res, user, url); return true; }
      if (path === "/commandes") { orders(res, user, url); return true; }
      if (path === "/journal") { journal(res, user, url); return true; }
      if (path === "/signalements") { reportList(res, user, url); return true; }
      if (settingsPage(res, user, url, req)) return true;
      if (ambassadorPages(res, user, url)) return true;
      if (path === "/sites") {
        const rows = ctx.sites?.all() ?? [];
        render(res, user, url, { title: "Sites publiés", subtitle: "Ce que les bots de vos clients ont mis en ligne", section: "sites", body: ({ now: at }) => sitesPage({ rows, now: at, available: Boolean(ctx.sites) }) });
        return true;
      }
      const reportId = REPORT.exec(path);
      if (reportId && !reportId[2]) return reportDetail(res, user, url, reportId[1]!);
      const slug = CLIENT.exec(path)?.[1];
      const workspace = slug ? store.workspace(slug) : null;
      if (workspace) { client(res, user, url, workspace); return true; }
      return false;
    }
    if (method !== "POST") return false;
    const ambassadorMatch = AMBASSADOR_ACTION.exec(path);
    if (ambassadorMatch) { await ambassadorAction(req, res, user, ambassadorMatch); return true; }
    const settingsMatch = SETTINGS_ACTION.exec(path);
    if (settingsMatch) { await settingsAction(req, res, user, settingsMatch); return true; }
    const siteAct = SITE_ACTION.exec(path);
    if (siteAct) {
      const taken = await ctx.sites?.takeDown(siteAct[1]!);
      if (!taken) return false;
      store.audit(taken.workspace, user.email, "site.taken_down", siteAct[1]!);
      ctx.redirect(res, "/sites?ok=site-down");
      return true;
    }
    const reportAct = REPORT.exec(path);
    if (reportAct?.[2]) {
      reports.remove(reportAct[1]!);
      store.audit(null, user.email, "report.deleted", reportAct[1]!);
      ctx.redirect(res, "/signalements?ok=report-deleted");
      return true;
    }
    const clientAct = CLIENT_ACTION.exec(path);
    if (clientAct) {
      const workspace = store.workspace(clientAct[1]!);
      if (!workspace) return false;
      await clientAction(req, res, user, url, workspace, clientAct[2]!);
      return true;
    }
    const orderAct = ORDER_ACTION.exec(path);
    if (orderAct) { await orderAction(req, res, user, orderAct[1]!, orderAct[2]!); return true; }
    return false;
  };
}
