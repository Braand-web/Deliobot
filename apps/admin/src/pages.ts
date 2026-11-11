import type { Invitation, Member, Role, SsoConfig, Workspace } from "./store.ts";
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
button{font:inherit;font-size:14px;border:1px solid var(--hairline);background:var(--surface);color:var(--ink);border-radius:8px;padding:7px 12px;cursor:pointer}
button.primary{background:var(--accent);border-color:var(--accent);color:#fff}button.danger{color:var(--danger)}
.notice{border-left:3px solid var(--accent);padding:8px 12px;background:var(--surface);border-radius:6px;margin:12px 0}.notice.error{border-color:var(--danger)}
code{font-family:"Geist Mono",ui-monospace,Menlo,monospace;font-size:13px;overflow-wrap:anywhere}
.mascot{display:block;width:88px;height:88px;margin:8px auto 16px}.center{text-align:center}.narrow{max-width:400px;margin:0 auto}
`;

export function page(input: { title: string; body: Html; email?: string | null; mascot?: "idle" | "happy" | "sad" | "curious" }): string {
  const mascot = input.mascot ? h`<img class="mascot" src="/assets/delio-${input.mascot}.webp" alt="">` : raw("");
  return `<!doctype html>${h`<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${input.title} · Delio Admin</title><link rel="icon" href="/assets/delio-idle.webp"><style>${raw(STYLE)}</style></head><body>
<header><img src="/assets/delio-idle.webp" alt=""><b>Delio Admin</b><nav>${input.email ? h`<span>${input.email}</span>
<form class="inline" method="post" action="/logout"><button>Sign out</button></form>` : ""}</nav></header>
<main>${mascot}${input.body}</main></body></html>`.html}`;
}

export const notice = (text: string | null | undefined, kind: "info" | "error" = "info") => text ? h`<div class="notice ${kind}">${text}</div>` : raw("");

export function loginPage(next: string, error?: string): Html {
  return h`<div class="narrow"><h1 class="center">Sign in to Delio</h1><p class="muted center">We email you a one-time code. Company accounts continue with single sign-on.</p>
${notice(error, "error")}<form method="post" action="/login" class="card"><input type="hidden" name="next" value="${next}">
<label for="email">Work email</label><input id="email" name="email" type="email" autocomplete="email" required autofocus>
<p><button class="primary" style="width:100%">Continue</button></p></form></div>`;
}

export function codePage(email: string, next: string, error?: string): Html {
  return h`<div class="narrow"><h1 class="center">Check your email</h1><p class="muted center">We sent an 8-digit code to <b>${email}</b>. It expires in 10 minutes.</p>
${notice(error, "error")}<form method="post" action="/login/verify" class="card"><input type="hidden" name="email" value="${email}"><input type="hidden" name="next" value="${next}">
<label for="code">Code</label><input id="code" name="code" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9 ]{8,9}" required autofocus>
<p><button class="primary" style="width:100%">Sign in</button></p></form><p class="center muted"><a href="/login?next=${encodeURIComponent(next)}">Use another address</a></p></div>`;
}

export function homePage(input: { workspaces: Array<Workspace & { role: Role }>; operator: boolean; all: Workspace[]; message?: string; error?: string }): Html {
  const mine = input.workspaces.length === 0
    ? h`<p class="muted">You are not in any workspace yet. Ask an administrator for an invitation.</p>`
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
  return h`<h1>Your workspaces</h1>${notice(input.message)}${notice(input.error, "error")}<div class="card">${mine}</div>${operator}`;
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

export function billingPage(input: { workspace: Workspace; operator: boolean; balance: number; usedThisMonth: number; hasToken: boolean; ledger: LedgerRow[];
  gatewayUrl: string; token?: string; message?: string; error?: string }): Html {
  const slug = input.workspace.slug;
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
<h2>History</h2><div class="card">${input.ledger.length === 0 ? h`<p class="muted">Nothing yet.</p>` : input.ledger.map((row) => h`<div class="row"><div class="grow"><code>${row.kind}</code> <span class="muted">${row.model ?? row.note ?? ""}</span></div>
<span style="color:${row.delta < 0 ? "var(--ink-2)" : "var(--success)"}">${row.delta > 0 ? "+" : ""}${credits(row.delta / 1_000_000)}</span>
<span class="muted">${new Date(row.at).toISOString().replace("T", " ").slice(0, 16)}</span></div>`)}</div>`;
}
