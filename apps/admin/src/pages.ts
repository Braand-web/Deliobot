import type { Invitation, Member, Role, SsoConfig, Workspace } from "./store.ts";
import type { DeviceRow } from "./devices.ts";
import type { HostingState } from "./hosting.ts";
import { PLANS, TRIAL_DAYS, type Catalog, type Cycle, type Order, type PlanId, type Subscription } from "./plans.ts";
import type { LedgerRow } from "./wallet.ts";

export type Html = { readonly html: string };
const raw = (html: string): Html => ({ html });

export function esc(value: unknown): string {
  return String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!);
}

/** Tagged template: interpolated values are escaped unless they are already Html. */
export function h(strings: TemplateStringsArray, ...values: unknown[]): Html {
  let out = strings[0]!;
  values.forEach((value, index) => {
    const parts = Array.isArray(value) ? value : [value];
    out += parts.map((part) => part && typeof part === "object" && "html" in part ? (part as Html).html : part === false || part == null ? "" : esc(part)).join("");
    out += strings[index + 1]!;
  });
  return raw(out);
}

const STYLE = `
:root{--canvas:#0f0f10;--surface:#1a1a1c;--hairline:#383838;--ink:#f5f5f5;--ink-2:#f5f5f5a8;--accent:#1084fe;--accent-text:#7fc0ff;--danger:#ff5667;--success:#38d591;color-scheme:dark}
@media (prefers-color-scheme:light){:root{--canvas:#f7f7f8;--surface:#fff;--hairline:#e2e2e5;--ink:#141416;--ink-2:#14141699;--accent:#1084fe;--accent-text:#0a64c8;--danger:#d92d3f;--success:#178a5a;color-scheme:light}}
*{box-sizing:border-box}body{margin:0;background:var(--canvas);color:var(--ink);font:15px/1.5 "Geist",-apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif}
header{display:flex;align-items:center;gap:10px;padding:14px 20px;border-bottom:1px solid var(--hairline)}header img{width:32px;height:32px}header b{font-weight:600}
header nav{margin-left:auto;display:flex;gap:12px;align-items:center;font-size:13px;color:var(--ink-2)}
main{max-width:760px;margin:0 auto;padding:28px 16px 64px}h1{font-size:22px;margin:0 0 6px}h2{font-size:15px;margin:28px 0 10px}
p.muted,.muted{color:var(--ink-2);font-size:13px}a{color:var(--accent-text)}
.card{background:var(--surface);border:1px solid var(--hairline);border-radius:12px;padding:16px;margin:12px 0}
.row{display:flex;align-items:center;gap:10px;padding:10px 0;border-bottom:1px solid var(--hairline)}.row:last-child{border-bottom:0}.grow{flex:1;min-width:0;overflow-wrap:anywhere}
form.inline{display:inline-flex;gap:6px;align-items:center;margin:0}
label{display:block;font-size:13px;color:var(--ink-2);margin:10px 0 4px}
input,select{font:inherit;color:var(--ink);background:var(--canvas);border:1px solid var(--hairline);border-radius:8px;padding:8px 10px;width:100%}
form.inline input,form.inline select{width:auto}
button,a.button{text-decoration:none;display:inline-block;font:inherit;font-size:14px;border:1px solid var(--hairline);background:var(--surface);color:var(--ink);border-radius:8px;padding:7px 12px;cursor:pointer}
button.primary,a.button.primary{background:var(--accent);border-color:var(--accent);color:#fff}button.danger{color:var(--danger)}
.notice{border-left:3px solid var(--accent);padding:8px 12px;background:var(--surface);border-radius:6px;margin:12px 0}.notice.error{border-color:var(--danger)}
code{font-family:"Geist Mono",ui-monospace,Menlo,monospace;font-size:13px;overflow-wrap:anywhere}
.mascot{display:block;width:88px;height:88px;margin:8px auto 16px}.center{text-align:center}.narrow{max-width:400px;margin:0 auto}
footer.help{max-width:720px;margin:0 auto;padding:8px 20px 32px;font-size:13px;color:var(--ink-2);text-align:center}footer.help a{color:var(--accent-text)}
`;

/** Where customers write for help; the sign-in emails name it too. */
export const SUPPORT_EMAIL = "support@deliobot.fun";

/** `brand`: "Delio" for customers, "Delio Admin" on the operators' console. */
export function page(input: { title: string; body: Html; email?: string | null; mascot?: "idle" | "happy" | "sad" | "curious"; brand?: string }): string {
  const brand = input.brand ?? "Delio";
  const mascot = input.mascot ? h`<img class="mascot" src="/assets/delio-${input.mascot}.webp" alt="">` : raw("");
  return `<!doctype html>${h`<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${input.title} · ${brand}</title><link rel="icon" href="/assets/delio-idle.webp"><style>${raw(STYLE)}</style></head><body>
<header><img src="/assets/delio-idle.webp" alt=""><b>${brand}</b><nav>${input.email ? h`<span>${input.email}</span>
<form class="inline" method="post" action="/logout"><button>Sign out</button></form>` : ""}</nav></header>
<main>${mascot}${input.body}</main>
<footer class="help">Need help? <a href="mailto:${SUPPORT_EMAIL}">${SUPPORT_EMAIL}</a></footer></body></html>`.html}`;
}

export const notice = (text: string | null | undefined, kind: "info" | "error" = "info") => text ? h`<div class="notice ${kind}">${text}</div>` : raw("");

export function loginPage(next: string, error?: string): Html {
  return h`<div class="narrow"><h1 class="center">Sign in to Delio</h1><p class="muted center">We email you a one-time code. Company accounts continue with single sign-on.</p>
${notice(error, "error")}<form method="post" action="/login" class="card"><input type="hidden" name="next" value="${next}">
<label for="email">Work email</label><input id="email" name="email" type="email" autocomplete="email" required autofocus>
<p><button class="primary" style="width:100%">Continue</button></p></form></div>`;
}

/** A customer names a workspace; it is created on the server once its plan is paid. */
/** Without `domain` the workspace is an account for the desktop app, and the slug is only its short name. */
export function signupPage(input: { domain?: string; plan: string; cycle: string; name?: string; slug?: string; error?: string }): Html {
  return h`<div class="narrow"><h1 class="center">Create your workspace</h1>
<p class="muted center">${input.domain ? "Your bots and your team live there. You pay for a plan next, then it is ready in a few minutes." : "Your plan, your credits and your team. You pay for a plan next, then connect the Deliobot app to it."}</p>
${notice(input.error, "error")}<form method="post" action="/signup" class="card">
<input type="hidden" name="plan" value="${input.plan}"><input type="hidden" name="cycle" value="${input.cycle}">
<label for="name">Name</label><input id="name" name="name" required maxlength="80" placeholder="Acme" value="${input.name ?? ""}" autofocus>
<label for="slug">${input.domain ? "Address" : "Short name"}</label><div class="row" style="gap:6px"><input id="slug" name="slug" required pattern="[a-z][a-z0-9-]{1,30}" maxlength="31" placeholder="acme" value="${input.slug ?? ""}" style="flex:1">
${input.domain ? h`<span class="muted">.${input.domain}</span>` : ""}</div>
<p class="muted" style="font-size:12px">Lowercase letters, digits and dashes. It cannot be changed later.</p>
<p><button class="primary" style="width:100%">Continue to payment</button></p></form></div>`;
}

export function codePage(email: string, next: string, error?: string): Html {
  return h`<div class="narrow"><h1 class="center">Check your email</h1><p class="muted center">We sent an 8-digit code to <b>${email}</b>. It expires in 10 minutes.</p>
${notice(error, "error")}<form method="post" action="/login/verify" class="card"><input type="hidden" name="email" value="${email}"><input type="hidden" name="next" value="${next}">
<label for="code">Code</label><input id="code" name="code" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9 ]{8,9}" required autofocus>
<p><button class="primary" style="width:100%">Sign in</button></p></form><p class="center muted"><a href="/login?next=${encodeURIComponent(next)}">Use another address</a></p></div>`;
}

export function homePage(input: { workspaces: Array<Workspace & { role: Role }>; operator: boolean; all: Workspace[]; signup?: boolean; message?: string; error?: string }): Html {
  const mine = input.workspaces.length === 0
    ? h`<p class="muted">You are not in any workspace yet. ${input.signup ? h`<a href="/signup">Create one</a>, or ask` : "Ask"} an administrator for an invitation.</p>`
    : input.workspaces.map((workspace) => h`<div class="row"><div class="grow"><b>${workspace.name}</b><div class="muted">${workspace.slug} · ${workspace.role}</div></div>
<a href="${workspace.tenantUrl}">Open</a>${workspace.role === "admin" ? h` <a href="/people?workspace=${workspace.slug}">People</a> <a href="/sso?workspace=${workspace.slug}">SSO</a> <a href="/billing?workspace=${workspace.slug}">Billing</a>` : ""}</div>`);
  const operator = input.operator ? h`<h2>All workspaces</h2><div class="card">${input.all.length === 0 ? h`<p class="muted">None yet.</p>`
    : input.all.map((workspace) => h`<div class="row"><div class="grow"><b>${workspace.slug}</b><div class="muted">${workspace.tenantUrl}</div></div><a href="/people?workspace=${workspace.slug}">People</a> <a href="/billing?workspace=${workspace.slug}">Billing</a></div>`)}</div>
<h2>New workspace</h2><form method="post" action="/workspaces" class="card">
<label for="slug">Slug</label><input id="slug" name="slug" pattern="[a-z][a-z0-9-]{1,30}" required placeholder="acme">
<label for="name">Name</label><input id="name" name="name" required maxlength="80" placeholder="Acme">
<label for="tenant">Workspace address</label><input id="tenant" name="tenantUrl" type="url" required placeholder="https://acme.deliobot.com">
<label for="owner">First administrator's email</label><input id="owner" name="ownerEmail" type="email" required>
<p><button class="primary">Create workspace</button></p></form>` : raw("");
  return h`<h1>Your workspaces</h1>${notice(input.message)}${notice(input.error, "error")}<div class="card">${mine}</div>
${input.signup && input.workspaces.length ? h`<p><a href="/signup">Create another workspace</a></p>` : ""}${operator}`;
}

export function peoplePage(input: { workspace: Workspace; members: Member[]; invitations: Invitation[]; self: string; inviteLink?: string; message?: string; error?: string;
  audit: Array<{ actor: string | null; action: string; target: string | null; at: number }> }): Html {
  const slug = input.workspace.slug;
  const roleSelect = (role: Role) => h`<select name="role" aria-label="Role"><option value="member"${role === "member" ? raw(" selected") : ""}>Member</option><option value="admin"${role === "admin" ? raw(" selected") : ""}>Admin</option></select>`;
  return h`<h1>${input.workspace.name}</h1><p class="muted">People who can sign in to <a href="${input.workspace.tenantUrl}">${input.workspace.tenantUrl}</a>.
Removing someone or changing their role reaches their open sessions within 15 seconds.</p>
${notice(input.message)}${notice(input.error, "error")}
${input.inviteLink ? h`<div class="notice">Invitation link (also emailed): <code>${input.inviteLink}</code></div>` : ""}
<h2>Members</h2><div class="card">${input.members.map((member) => h`<div class="row"><div class="grow">${member.email}${member.accountId === input.self ? h` <span class="muted">(you)</span>` : ""}</div>
<form class="inline" method="post" action="/people/role"><input type="hidden" name="workspace" value="${slug}"><input type="hidden" name="account" value="${member.accountId}">${roleSelect(member.role)}<button>Save</button></form>
<form class="inline" method="post" action="/people/remove"><input type="hidden" name="workspace" value="${slug}"><input type="hidden" name="account" value="${member.accountId}"><button class="danger">Remove</button></form></div>`)}</div>
<h2>Invite</h2><form method="post" action="/people/invite" class="card"><input type="hidden" name="workspace" value="${slug}">
<label for="invite-email">Email</label><input id="invite-email" name="email" type="email" required><label for="invite-role">Role</label>${roleSelect("member")}
<p><button class="primary">Send invitation</button></p></form>
${input.invitations.length ? h`<h2>Pending invitations</h2><div class="card">${input.invitations.map((invitation) => h`<div class="row"><div class="grow">${invitation.email}<div class="muted">${invitation.role} · expires ${new Date(invitation.expiresAt).toISOString().slice(0, 10)}</div></div>
<form class="inline" method="post" action="/people/cancel"><input type="hidden" name="workspace" value="${slug}"><input type="hidden" name="invitation" value="${invitation.id}"><button>Cancel</button></form></div>`)}</div>` : ""}
<h2>Recent activity</h2><div class="card">${input.audit.length === 0 ? h`<p class="muted">Nothing yet.</p>` : input.audit.map((entry) => h`<div class="row"><div class="grow"><code>${entry.action}</code> <span class="muted">${entry.target ?? ""}</span></div><span class="muted">${entry.actor ?? "system"} · ${new Date(entry.at).toISOString().replace("T", " ").slice(0, 16)}</span></div>`)}</div>`;
}

export function invitePage(input: { invitation: Invitation; workspace: Workspace; token: string; email: string | null }): Html {
  const matches = input.email === input.invitation.email;
  return h`<div class="narrow center"><h1>Join ${input.workspace.name}</h1><p class="muted">Invitation for <b>${input.invitation.email}</b> as ${input.invitation.role}.</p>
${!input.email ? h`<p><a href="/login?next=${encodeURIComponent(`/invite?token=${input.token}`)}">Sign in as ${input.invitation.email} to accept</a></p>`
    : matches ? h`<form method="post" action="/invite/accept"><input type="hidden" name="token" value="${input.token}"><button class="primary">Accept invitation</button></form>`
    : h`${notice(`You are signed in as ${input.email}. Sign out, then sign in as ${input.invitation.email} to accept.`, "error")}`}</div>`;
}

export function ssoPage(input: { workspace: Workspace; sso: SsoConfig | null; redirectUri: string; message?: string; error?: string }): Html {
  const sso = input.sso;
  return h`<h1>Single sign-on · ${input.workspace.name}</h1><p class="muted">Connect an OpenID Connect provider (Google Workspace, Microsoft Entra ID, Okta, Auth0…).
People whose verified email ends with the domain below sign in through it instead of email codes.</p>
${notice(input.message)}${notice(input.error, "error")}
<div class="card"><label>Redirect URI to register with your provider</label><code>${input.redirectUri}</code></div>
<form method="post" action="/sso" class="card"><input type="hidden" name="workspace" value="${input.workspace.slug}">
<label for="issuer">Issuer URL</label><input id="issuer" name="issuer" type="url" required value="${sso?.issuer ?? ""}" placeholder="https://accounts.google.com">
<label for="client">Client ID</label><input id="client" name="clientId" required value="${sso?.clientId ?? ""}">
<label for="secret">Client secret</label><input id="secret" name="clientSecret" type="password" ${sso ? "" : raw("required")} placeholder="${sso ? "Unchanged" : ""}" autocomplete="off">
<label for="domain">Email domain</label><input id="domain" name="domain" required value="${sso?.domain ?? ""}" placeholder="acme.com">
<label><input type="checkbox" name="autoJoin" value="1" style="width:auto"${sso?.autoJoin ? raw(" checked") : ""}> Add people from this domain as members on their first sign-in</label>
<p><button class="primary">Save</button></p></form>
${sso ? h`<form method="post" action="/sso/remove"><input type="hidden" name="workspace" value="${input.workspace.slug}"><button class="danger">Turn off single sign-on</button></form>` : ""}`;
}

export function slackPage(workspace: Workspace): Html {
  return h`<h1>Slack · ${workspace.name}</h1><p class="muted">Slack is connected from the workspace itself: open <a href="${workspace.tenantUrl}">${workspace.tenantUrl}</a> and add Slack to a bot from its settings.</p>`;
}

export function messagePage(title: string, text: string, link?: { href: string; label: string }): Html {
  return h`<div class="narrow center"><h1>${title}</h1><p class="muted">${text}</p>${link ? h`<p><a href="${link.href}">${link.label}</a></p>` : ""}</div>`;
}

const credits = (value: number) => value.toLocaleString("en-US", { maximumFractionDigits: 1 });

function hostingCard(workspace: Workspace, hosting: { state: HostingState; error: string | null; retry: boolean }): Html {
  const line: Record<HostingState, string> = {
    waiting: "Choose a plan below: the workspace is created as soon as it is paid.",
    creating: "Being created. This takes a few minutes; you get an email when it is ready.",
    ready: "Ready.",
    failed: "Creating it did not work yet. It is tried again automatically, and the Delio team is told if it keeps failing.",
    suspended: "Paused because its plan has ended. Renew it below: your bots and data are kept.",
  };
  return h`<h2>Workspace</h2><div class="card" data-hosting="${hosting.state}"><div class="row"><div class="grow"><b>${workspace.tenantUrl}</b><div class="muted">${line[hosting.state]}</div>
${hosting.error ? h`<div class="muted" style="font-size:12px">${hosting.error}</div>` : ""}</div>
${hosting.state === "ready" ? h`<a class="button primary" href="${workspace.tenantUrl}">Open</a>` : ""}
${hosting.retry ? h`<form class="inline" method="post" action="/billing/hosting/retry"><input type="hidden" name="workspace" value="${workspace.slug}"><button>Try again now</button></form>` : ""}</div></div>`;
}

/** A dollar price as the site shows it, with the francs a payer is charged in small type beneath. */
function price(usd: number, francs: number, per: string): Html {
  const dollars = `$${usd.toLocaleString("en-US", { minimumFractionDigits: Number.isInteger(usd) ? 0 : 2, maximumFractionDigits: 2 })}`;
  return h`<div><span style="font-size:24px;font-weight:600">${dollars}</span> <span class="muted">${per}</span></div>
<div class="muted" style="font-size:12px">≈ ${francs.toLocaleString("fr-FR")} FCFA</div>`;
}

export function billingPage(input: { workspace: Workspace; operator: boolean; balance: number; usedThisMonth: number; hasToken: boolean; ledger: LedgerRow[];
  gatewayUrl: string; devices: DeviceRow[]; subscription: Subscription; orders: Order[]; payments: boolean; currency: string; trialAvailable: boolean;
  catalog: Catalog; chosen?: PlanId; cycle?: Cycle; hosting?: { state: HostingState; error: string | null; retry: boolean } | null; token?: string; message?: string; error?: string }): Html {
  const slug = input.workspace.slug;
  const sub = input.subscription;
  const cycle = input.cycle ?? "month";
  const francs = input.currency === "XOF" || input.currency === "XAF";
  const money = (amount: string) => `${Number(amount).toLocaleString("fr-FR", { maximumFractionDigits: 2 })} ${francs ? "FCFA" : input.currency}`;
  const day = (at: number) => new Date(at).toISOString().slice(0, 10);
  const status = sub.status === "none" ? "No plan yet"
    : sub.status === "trialing" ? `Trial until ${day(sub.periodEnd)}`
    : sub.status === "active" ? `${PLANS[sub.plan].name} · ${sub.cycle === "year" ? "yearly" : "monthly"} · until ${day(sub.periodEnd)}`
    : sub.status === "grace" ? `${PLANS[sub.plan].name} ended on ${day(sub.periodEnd)}: renew before ${day(sub.periodEnd + 7 * 24 * 60 * 60_000)}`
    : `${PLANS[sub.plan].name} ended on ${day(sub.periodEnd)}`;
  const disabled = input.payments ? "" : raw(" disabled");
  const hidden = (fields: Record<string, string>) => Object.entries(fields).map(([name, value]) => h`<input type="hidden" name="${name}" value="${value}">`);
  const cycleLink = (value: Cycle, label: string) => value === cycle
    ? h`<b style="padding:6px 12px;border-radius:999px;background:rgba(127,127,127,.18)">${label}</b>`
    : h`<a href="/billing?workspace=${slug}&cycle=${value}${input.chosen ? `&plan=${input.chosen}` : ""}" style="padding:6px 12px">${label}</a>`;
  const planCard = (plan: Catalog["plans"][number]) => {
    const yearly = cycle === "year" && plan.usdYear !== null && plan.francsYear !== null;
    const current = sub.plan === plan.id && sub.cycle === cycle && (sub.status === "active" || sub.status === "grace");
    const highlight = input.chosen === plan.id || (!input.chosen && plan.id === input.catalog.recommended);
    return h`<form method="post" action="/billing/checkout" class="card" style="margin:0${highlight ? ";outline:2px solid #0a84ff" : ""}">
${hidden({ workspace: slug, kind: "plan", plan: plan.id, cycle })}
<div class="row"><b class="grow">${plan.name}</b>${plan.id === input.catalog.recommended ? h`<span class="muted" style="font-size:12px">Most popular</span>` : ""}</div>
${yearly ? price(plan.usdYear!, plan.francsYear!, "/year") : price(plan.usd, plan.francs, "/month")}
${yearly ? h`<div class="muted" style="font-size:12px">One month free · $${(plan.usdYear! / 12).toFixed(2)} a month</div>` : ""}
<ul class="muted" style="padding-left:18px;margin:10px 0">${plan.gateway
      ? h`<li>${plan.credits.toLocaleString("en-US")} AI credits a month</li><li>${plan.computerHours} cloud computer hours a month</li><li>${plan.computers === 1 ? "1 cloud computer" : `${plan.computers} cloud computers at once`}</li>`
      : h`<li>Your own AI keys (OpenRouter, fal.ai)</li><li>Your own cloud computer key (Boat)</li><li>Every Deliobot feature</li>`}</ul>
<p><button class="primary"${disabled}>${current ? "Renew" : "Choose"}</button></p></form>`;
  };
  const trial = input.catalog.plans.find((plan) => plan.id === "trial")!;
  const sold = input.catalog.plans.filter((plan) => plan.id !== "trial");
  return h`<h1>Billing · ${input.workspace.name}</h1><p class="muted">Delio credits pay for the AI this workspace uses through Delio's own keys: text, images, video and music.</p>
${notice(input.message)}${notice(input.error, "error")}
<div class="card"><div class="row"><div class="grow"><div class="muted">Balance</div><div style="font-size:28px;font-weight:600">${credits(input.balance)} credits</div></div>
<div class="grow"><div class="muted">Used this month</div><div style="font-size:20px">${credits(input.usedThisMonth)} credits</div></div></div></div>
${input.operator ? h`<h2>Add credits</h2><form method="post" action="/billing/credit" class="card"><input type="hidden" name="workspace" value="${slug}">
<label for="credits">Credits (a negative number takes some back)</label><input id="credits" name="credits" inputmode="decimal" required placeholder="2000">
<label for="note">Note</label><input id="note" name="note" maxlength="200" placeholder="Monthly Pro credits">
<p><button class="primary">Add</button></p></form>
<h2>Workspace token</h2><div class="card"><p class="muted">The workspace's server uses this token to reach Delio's AI gateway at <code>${input.gatewayUrl}</code>. Issuing a new one revokes the old one.</p>
${input.token ? h`<div class="notice">Copy it now, it is shown only once: <code>${input.token}</code></div>` : input.hasToken ? h`<p>A token is active.</p>` : h`<p>No token yet.</p>`}
<form method="post" action="/billing/token"><input type="hidden" name="workspace" value="${slug}"><button>${input.hasToken ? "Issue a new token" : "Issue a token"}</button></form></div>` : ""}
${input.hosting ? hostingCard(input.workspace, input.hosting) : ""}
<h2>Plan</h2><div class="card"><b>${status}</b>${!input.payments ? h`<p class="muted">Payments are not set up on this deployment yet.</p>` : ""}</div>
${input.trialAvailable && sub.status === "none" ? h`<form method="post" action="/billing/checkout" class="card">${hidden({ workspace: slug, kind: "plan", plan: "trial" })}
<div class="row"><div class="grow"><b>Try Delio for ${TRIAL_DAYS} days</b><div class="muted">${trial.credits} AI credits · ${trial.computerHours} cloud computer hours</div></div>
<div style="text-align:right">${price(trial.usd, trial.francs, `for ${TRIAL_DAYS} days`)}</div></div>
<p><button class="primary"${disabled}>Start the trial</button></p></form>` : ""}
<div class="row" style="margin:8px 0 12px">${cycleLink("month", "Monthly")}${cycleLink("year", "Yearly · 1 month free")}</div>
<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:12px">${sold.map(planCard)}</div>
<h2>Top up credits</h2><div class="card"><div style="display:flex;flex-wrap:wrap;gap:8px">${input.catalog.topups.map((pack) => h`<form class="inline" method="post" action="/billing/checkout">
${hidden({ workspace: slug, kind: "topup", topup: pack.id })}<button${disabled} style="text-align:left;line-height:1.35">${pack.credits.toLocaleString("en-US")} credits · $${pack.usd}<br><small class="muted">≈ ${pack.francs.toLocaleString("fr-FR")} FCFA</small></button></form>`)}</div>
<p class="muted">Paid with mobile money or card through SasPay, in CFA francs. Credits from top-ups stay until used.</p></div>
${input.orders.length ? h`<h2>Payments</h2><div class="card">${input.orders.map((order) => h`<div class="row"><div class="grow">${order.kind === "plan" && order.plan ? `${PLANS[order.plan].name}${order.plan === "trial" ? "" : order.cycle === "year" ? " · yearly" : " · monthly"}` : "Top-up"} · ${order.credits.toLocaleString("en-US")} credits</div>
<span class="muted">${money(order.amount)}</span><code>${order.status}</code><span class="muted">${day(order.createdAt)}</span></div>`)}</div>` : ""}
<h2>Connected apps</h2><div class="card">${input.devices.length === 0 ? h`<p class="muted">No desktop app is connected. In the app: Settings → API keys → Delio account.</p>`
  : input.devices.map((device) => h`<div class="row"><div class="grow">${device.label}<div class="muted">connected ${new Date(device.createdAt).toISOString().slice(0, 10)}${device.lastUsedAt ? ` · last used ${new Date(device.lastUsedAt).toISOString().slice(0, 10)}` : ""}</div></div>
<form class="inline" method="post" action="/billing/device"><input type="hidden" name="workspace" value="${slug}"><input type="hidden" name="device" value="${device.id}"><button class="danger">Disconnect</button></form></div>`)}</div>
<h2>History</h2><div class="card">${input.ledger.length === 0 ? h`<p class="muted">Nothing yet.</p>` : input.ledger.map((row) => h`<div class="row"><div class="grow"><code>${row.kind}</code> <span class="muted">${row.model ?? row.note ?? ""}</span></div>
<span style="color:${row.delta < 0 ? "var(--ink-2)" : "var(--success)"}">${row.delta > 0 ? "+" : ""}${credits(row.delta / 1_000_000)}</span>
<span class="muted">${new Date(row.at).toISOString().replace("T", " ").slice(0, 16)}</span></div>`)}</div>`;
}

export function devicePage(input: { code: string; label: string | null; workspaces: Array<Workspace & { role: Role }>; error?: string }): Html {
  return h`<div class="narrow"><h1 class="center">Connect an app</h1>
<p class="muted center">${input.label ? `“${input.label}” asks to use your Delio credits.` : "Enter the code your app shows."} Check that the code matches the one on your screen.</p>
${notice(input.error, "error")}<form method="post" action="/device" class="card">
<label for="code">Code</label><input id="code" name="code" value="${input.code}" required autocomplete="off" placeholder="BCDF-GHJK" style="font-size:20px;letter-spacing:.12em;text-transform:uppercase">
<label for="workspace">Spend the credits of</label><select id="workspace" name="workspace">
${input.workspaces.map((workspace) => h`<option value="${workspace.slug}">${workspace.name}</option>`)}<option value="personal">A new personal workspace</option></select>
<p style="display:flex;gap:8px"><button class="primary" name="decision" value="allow" style="flex:1">Connect</button><button name="decision" value="deny">Refuse</button></p></form></div>`;
}
