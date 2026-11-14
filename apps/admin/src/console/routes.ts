import type { IncomingMessage, ServerResponse } from "node:http";

import type { Devices } from "../devices.ts";
import type { Hosting } from "../hosting.ts";
import type { Reports } from "../reports.ts";
import { MANUAL_ORDER_PREFIX, PLANS, type Billing, type Cycle, type Order, type PlanId } from "../plans.ts";
import type { SasPay } from "../saspay.ts";
import { token, type Account, type AdminStore, type Workspace } from "../store.ts";
import { MICRO, type Wallet } from "../wallet.ts";
import { Metrics, period } from "./metrics.ts";
import { CLIENT_FILTERS, clientPage, clientsPage, consolePage, dashboardPage, journalPage, n, ORDER_FILTERS, ordersPage, reportPage, reportsPage, trafficPage, type ClientRow, type ConsoleSection, type Flash } from "./pages.ts";

export interface ConsoleContext {
  store: AdminStore; wallet: Wallet; devices: Devices; reports: Reports; billing: Billing; hosting: Hosting; saspay: SasPay | null; currency: string;
  operators: ReadonlySet<string>; now: () => number;
  readForm: (req: IncomingMessage) => Promise<Record<string, unknown>>;
  redirect: (res: ServerResponse, location: string) => void;
  send: (res: ServerResponse, status: number, body: string, type: string, headers: Record<string, string>) => void;
}

const SLUG = "[a-z][a-z0-9-]{1,30}";
const ORDER_ID = "(?:ord|man)_[A-Za-z0-9_-]{8,40}";
const CLIENT_ACTION = new RegExp(`^/clients/(${SLUG})/(credits|forfait|suspendre|bloquer|appareil|jeton|supprimer)$`);
const CLIENT = new RegExp(`^/clients/(${SLUG})$`);
const ORDER_ACTION = new RegExp(`^/commandes/(${ORDER_ID})/(verifier|payee)$`);
const PAGES = new Set(["/", "/trafic", "/clients", "/commandes", "/signalements", "/journal"]);
const REPORT = /^\/signalements\/([A-Za-z0-9_-]{8,20})(\/supprimer)?$/;
const PAGE_SIZE = 25;
/** Per-workspace tables the portal keeps besides the store's own; a deleted workspace leaves no row in them. */
const WORKSPACE_TABLES = ["wallets", "gateway_tokens", "holds", "subscriptions", "device_tokens", "hosting", "boat_included"] as const;

/** Whether a path belongs to the console's own pages and actions. */
export function consoleServes(path: string): boolean {
  return PAGES.has(path) || REPORT.test(path) || CLIENT.test(path) || CLIENT_ACTION.test(path) || ORDER_ACTION.test(path);
}

const FLASH: Record<string, (count: string) => Flash> = {
  credits: (count) => ({ kind: "ok", text: Number(count) >= 0 ? `${n(Number(count))} crédits ajoutés` : `${n(-Number(count))} crédits retirés` }),
  plan: () => ({ kind: "ok", text: "Forfait offert et appliqué" }),
  suspended: () => ({ kind: "ok", text: "Espace suspendu" }), resumed: () => ({ kind: "ok", text: "Espace réactivé" }),
  blocked: () => ({ kind: "ok", text: "Compte bloqué" }), unblocked: () => ({ kind: "ok", text: "Compte débloqué" }),
  device: () => ({ kind: "ok", text: "Application déconnectée" }), "report-deleted": () => ({ kind: "ok", text: "Signalement supprimé" }), deleted: () => ({ kind: "ok", text: "Espace supprimé" }),
  paid: () => ({ kind: "ok", text: "Commande marquée payée, crédits appliqués" }), "already-paid": () => ({ kind: "bad", text: "Cette commande était déjà payée" }),
  "recheck-paid": () => ({ kind: "ok", text: "SasPay confirme le paiement : commande appliquée" }),
  "recheck-pending": () => ({ kind: "ok", text: "SasPay : paiement toujours en attente" }),
  "recheck-failed": () => ({ kind: "bad", text: "SasPay : paiement échoué ou expiré" }),
  "recheck-error": () => ({ kind: "bad", text: "SasPay n'a pas répondu, réessayez plus tard" }),
  "no-payments": () => ({ kind: "bad", text: "Les paiements SasPay ne sont pas configurés" }),
  "bad-credits": () => ({ kind: "bad", text: "Entrez un nombre de crédits (non nul)" }),
  hosted: () => ({ kind: "bad", text: "Arrêtez d'abord l'hébergement et les ordinateurs cloud de cet espace" }),
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
    const html = consolePage({ ...page, body: page.body({ now: now() }), email: user.email, nonce, flash, pendingOrders, unreadReports: reports.unread() });
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
      const reportId = REPORT.exec(path);
      if (reportId && !reportId[2]) return reportDetail(res, user, url, reportId[1]!);
      const slug = CLIENT.exec(path)?.[1];
      const workspace = slug ? store.workspace(slug) : null;
      if (workspace) { client(res, user, url, workspace); return true; }
      return false;
    }
    if (method !== "POST") return false;
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
