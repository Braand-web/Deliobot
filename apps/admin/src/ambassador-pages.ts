import type { Ambassador, AmbassadorRules, AmbassadorStats, Level, Payout } from "./ambassadors.ts";
import { h, notice, raw, type Html } from "./pages.ts";

export const SITE_URL = "https://deliobot.fun";
const money = (usd: number) => `${usd.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} $`;
const francs = (usd: number, rate: number) => `≈ ${Math.round(usd * rate).toLocaleString("fr-FR")} FCFA`;
const pct = (rate: number) => `${Math.round(rate * 100)} %`;
const day = (at: number) => new Intl.DateTimeFormat("fr-FR", { dateStyle: "long", timeZone: "UTC" }).format(new Date(at));
export const linkFor = (code: string) => `${SITE_URL}/?ref=${encodeURIComponent(code.toLowerCase())}`;

const whole = (usd: number) => `${usd.toLocaleString("fr-FR", { maximumFractionDigits: 0 })} $`;

function levelCondition(level: Level, rate: number): string {
  const parts = [level.clients ? `${level.clients} clients payants` : null, level.revenueUsd ? `${whole(level.revenueUsd)} de CA en 6 mois (${francs(level.revenueUsd, rate)})` : null].filter(Boolean);
  return parts.length ? parts.join(" ou ") : "Dès le départ";
}

/** The levels, their rates and months, the same everywhere the programme is explained. */
export function levelCards(rules: AmbassadorRules, rate: number, current?: Level): Html {
  return h`<div class="levels">${rules.levels.map((level) => h`<div class="${current?.id === level.id ? "on" : ""}"><b>${level.name}</b>${current?.id === level.id ? h` <span class="muted">· votre niveau</span>` : ""}
<div style="font-size:22px;font-weight:600">${pct(level.rate)}</div><div class="muted">${level.months > 6 ? `jusqu'à ${level.months} mois par client, sur demande` : `pendant ${level.months} mois par client`}</div>
<div class="muted" style="margin-top:6px">${levelCondition(level, rate)}</div></div>`)}</div>
<p class="muted">Au-delà du 6e mois d'un client (niveaux Or et Diamant, après accord), votre part passe à ${pct(rules.extendedRate)}.</p>`;
}

export function howItWorks(rules: AmbassadorRules, rate: number): Html {
  return h`<ol class="steps"><li><span>Vous recevez <b>votre lien et votre code</b>, que vous pouvez personnaliser.</span></li>
<li><span>Votre communauté s'abonne avec, et reçoit <b>+${rules.welcomeCredits.toLocaleString("fr-FR")} crédits offerts</b> à son premier abonnement.</span></li>
<li><span>Vous touchez <b>${pct(rules.levels[0]!.rate)} à ${pct(rules.levels.at(-1)!.rate)} de chaque abonnement</b> pendant 6 mois, jusqu'à 24 mois pour les meilleurs.</span></li></ol>
<ul class="muted"><li>Seuls les abonnements comptent, pas les achats de crédits.</li><li>Chaque gain devient disponible ${rules.holdDays} jours après le paiement du client.</li>
<li>Retrait en Mobile Money dès ${rules.minPayoutXof.toLocaleString("fr-FR")} FCFA (${money(rules.minPayoutXof / rate)}), ou en crédits Delio à tout moment.</li>
<li>Pas de gain sur votre propre compte.</li><li>Un client reste à l'ambassadeur dont il a utilisé le lien ou le code en premier.</li></ul>`;
}

export function ambassadorJoinPage(input: { rules: AmbassadorRules; rate: number; email: string | null; sent?: boolean; error?: string; values?: Record<string, string> }): Html {
  if (input.sent) return h`<div class="narrow center"><h1>Merci, c'est envoyé !</h1><p class="muted">Nous étudions votre candidature et vous répondons par e-mail sous 48 h. Une fois validé, vous recevrez votre lien, votre code et l'accès à votre espace ambassadeur.</p><p><a href="${SITE_URL}/ambassadeurs">Revoir le programme</a></p></div>`;
  const v = input.values ?? {};
  return h`<h1>Devenez ambassadeur Deliobot</h1><p class="muted">Recommandez Deliobot à votre communauté et gagnez une part de chaque abonnement. Aucun investissement, payé en Mobile Money.</p>
<div class="card">${howItWorks(input.rules, input.rate)}</div>${levelCards(input.rules, input.rate)}
${notice(input.error, "error")}<form method="post" action="/ambassadeur/rejoindre" class="card"><h2 style="margin-top:0">Votre candidature</h2>
<label for="name">Nom ou nom de créateur</label><input id="name" name="name" required maxlength="80" value="${v.name ?? ""}">
${input.email ? h`<label>E-mail</label><p style="margin:0"><b>${input.email}</b></p>` : h`<p class="notice">Connectez-vous d'abord : votre espace ambassadeur et vos gains seront liés à ce compte. <a href="/login?next=%2Fambassadeur%2Frejoindre">Se connecter ou créer un compte</a></p>`}
<label for="phone">Numéro WhatsApp / Mobile Money</label><input id="phone" name="phone" required maxlength="30" value="${v.phone ?? ""}" placeholder="+221 70 000 00 00">
<label for="social">Votre réseau principal (lien)</label><input id="social" name="social" required maxlength="200" value="${v.social ?? ""}" placeholder="https://www.tiktok.com/@…">
<label for="audience">Taille de votre communauté</label><select id="audience" name="audience">${["Moins de 1 000", "1 000 à 10 000", "10 000 à 50 000", "50 000 à 200 000", "Plus de 200 000"].map((size) => h`<option ${v.audience === size ? raw("selected") : ""}>${size}</option>`)}</select>
<label for="why">Comment comptez-vous parler de Deliobot ?</label><textarea id="why" name="why" maxlength="1000">${v.why ?? ""}</textarea>
<p><button class="primary" style="width:100%" ${input.email ? "" : raw("disabled")}>Envoyer ma candidature</button></p></form>`;
}

export interface DashboardInput {
  ambassador: Ambassador; stats: AmbassadorStats; rules: AmbassadorRules; rate: number; now: number;
  codes: Array<{ code: string; active: boolean; signups: number; paying: number }>; payouts: Payout[]; message?: string; error?: string;
}

function progress(input: DashboardInput): Html {
  const { stats, rules, rate } = input;
  if (!stats.next) return h`<p class="muted">Vous êtes au plus haut niveau. Bravo !</p>`;
  const next = stats.next;
  const byRevenue = next.revenueUsd ? Math.min(1, stats.revenueUsd / next.revenueUsd) : 0;
  const byClients = next.clients ? Math.min(1, stats.paying / next.clients) : 0;
  const share = Math.max(byRevenue, byClients);
  const missing = [next.clients ? `${Math.max(0, next.clients - stats.paying)} clients payants` : null,
    next.revenueUsd ? `${money(Math.max(0, next.revenueUsd - stats.revenueUsd))} de CA (${francs(Math.max(0, next.revenueUsd - stats.revenueUsd), rate)})` : null].filter(Boolean).join(" ou ");
  return h`<div class="meter" role="progressbar" aria-valuenow="${String(Math.round(share * 100))}" aria-valuemin="0" aria-valuemax="100"><i style="width:${String(Math.round(share * 100))}%"></i></div>
<p class="muted">Encore ${missing} pour passer <b>${next.name}</b> : ${pct(next.rate)}${next.months > 6 ? ` et jusqu'à ${next.months} mois par client` : ""}.${rules.levels.length ? "" : ""}</p>`;
}

function shareText(code: string, credits: number): string {
  return `J'utilise Deliobot : des bots IA qui font le vrai travail (messages, rapports, contenus, relances…). Avec mon code ${code}, tu reçois +${credits} crédits offerts à ton abonnement : ${linkFor(code)}`;
}

const ICON: Record<string, string> = {
  overview: '<rect x="3" y="3" width="7" height="9" rx="1"/><rect x="14" y="3" width="7" height="5" rx="1"/><rect x="14" y="12" width="7" height="9" rx="1"/><rect x="3" y="16" width="7" height="5" rx="1"/>',
  earnings: '<path d="M19 7V4a1 1 0 0 0-1-1H5a2 2 0 0 0 0 4h15a1 1 0 0 1 1 1v4h-3a2 2 0 0 0 0 4h3a1 1 0 0 0 1-1v-2a1 1 0 0 0-1-1"/><path d="M3 5v14a2 2 0 0 0 2 2h15a1 1 0 0 0 1-1v-4"/>',
  codes: '<path d="M12.6 2.6A2 2 0 0 0 11.2 2H4a2 2 0 0 0-2 2v7.2a2 2 0 0 0 .6 1.4l8.7 8.7a2.4 2.4 0 0 0 3.4 0l6.6-6.6a2.4 2.4 0 0 0 0-3.4z"/><circle cx="7.5" cy="7.5" r=".5"/>',
  share: '<circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="m8.6 13.5 6.8 4M15.4 6.5l-6.8 4"/>',
  levels: '<path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6M18 9h1.5a2.5 2.5 0 0 0 0-5H18M4 22h16M10 14.7V17c0 .6-.5 1-1 1.2C7.9 18.8 7 20.2 7 22M14 14.7V17c0 .6.5 1 1 1.2 1.2.6 2 2 2 3.8M18 2H6v7a6 6 0 0 0 12 0z"/>',
  help: '<circle cx="12" cy="12" r="10"/><path d="M9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3M12 17h0"/>',
};
const icon = (name: string) => raw(`<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON[name]}</svg>`);
const SECTIONS: Array<[string, string, string]> = [["apercu", "Vue d'ensemble", "overview"], ["gains", "Gains et retraits", "earnings"], ["codes", "Mes codes", "codes"],
  ["partager", "Partager", "share"], ["niveaux", "Niveaux", "levels"], ["aide", "Comment ça marche", "help"]];

const DASHBOARD_STYLE = `
.amb{--soft:color-mix(in srgb,var(--ink) 5%,transparent);--line:var(--hairline);display:grid;grid-template-columns:220px minmax(0,1fr);gap:56px;align-items:start}
.amb-side{position:sticky;top:24px;display:flex;flex-direction:column;gap:28px}
.amb-me{display:grid;grid-template-columns:auto 1fr;column-gap:12px;align-items:center}
.amb-avatar{grid-row:span 2;width:40px;height:40px;border-radius:50%;display:grid;place-items:center;font-weight:500;font-size:15px;color:var(--ink);background:var(--soft)}
.amb-me b{display:block;font-size:15px;font-weight:500;line-height:1.3}
.amb-chip{font-size:13px;color:var(--ink-2)}
.amb-me .meter,.amb-me>.muted{grid-column:1/-1}.amb-me>.muted{font-size:12.5px}
.amb .meter{height:3px;background:var(--line);margin:14px 0 6px}.amb .meter i{background:var(--ink);transition:width .8s cubic-bezier(.22,1,.36,1)}
.amb-nav{display:flex;flex-direction:column;gap:1px}
.amb-nav a{display:flex;align-items:center;gap:10px;padding:7px 10px;margin-left:-10px;border-radius:8px;color:var(--ink-2);text-decoration:none;font-size:14px;transition:color .15s,background .15s}
.amb-nav a svg{opacity:.7}
.amb-nav a:hover{color:var(--ink);background:var(--soft)}
.amb-nav a.on{color:var(--ink);background:var(--soft);font-weight:500}.amb-nav a.on svg{opacity:1}
.amb-quick{font-size:13px;padding-top:20px;border-top:1px solid var(--line)}
.amb-quick code{display:block;margin:4px 0 12px;font-size:15px;font-weight:500;letter-spacing:.02em}
.amb-main{max-width:760px}
.amb-main h1{font-size:26px;font-weight:500;letter-spacing:-.02em;margin-bottom:6px}
.amb-sec{scroll-margin-top:24px;padding:36px 0;border-top:1px solid var(--line)}
.amb-sec:first-child{border-top:0;padding-top:0}
.amb-sec>h2{margin:0 0 18px;font-size:12px;font-weight:500;letter-spacing:.08em;text-transform:uppercase;color:var(--ink-2)}
.amb .muted{color:var(--ink-2)}
.amb .card{background:none;border:1px solid var(--line);border-radius:12px;padding:18px;margin:14px 0}
.amb .stats{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:0;margin:22px 0 4px;border:1px solid var(--line);border-radius:12px}
.amb .stats div{background:none;border:0;border-left:1px solid var(--line);border-radius:0;padding:16px 18px}
.amb .stats div:first-child{border-left:0}
.amb .stats span{font-size:12.5px;color:var(--ink-2)}.amb .stats b{display:block;margin:4px 0 2px;font-size:22px;font-weight:500;letter-spacing:-.01em}
.amb .stats small{font-size:12px;color:var(--ink-2)}
.amb .levels{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:0;border:1px solid var(--line);border-radius:12px}
.amb .levels>div{background:none;border:0;border-left:1px solid var(--line);border-radius:0;padding:16px}
.amb .levels>div:first-child{border-left:0}
.amb .levels>div.on{background:var(--soft)}
.amb .levels>div>div[style]{font-size:20px!important;font-weight:500!important;margin:4px 0}
.amb .notice{background:none;border:1px solid var(--line);border-radius:12px;padding:14px 16px}
.amb .steps li::before{background:none;border:1px solid var(--line);color:var(--ink);font-weight:500}
.amb button,.amb a.button{background:none;border:1px solid var(--line);color:var(--ink);border-radius:9px;padding:7px 13px;font-size:13.5px;transition:background .15s,border-color .15s}
.amb button:hover:not(:disabled),.amb a.button:hover{background:var(--soft);border-color:color-mix(in srgb,var(--ink) 20%,transparent)}
.amb button.primary{background:var(--ink);border-color:var(--ink);color:var(--canvas)}
.amb button.primary:hover:not(:disabled){background:var(--ink);opacity:.88}
.amb button:disabled{opacity:.4;cursor:not-allowed}
.amb input{border-radius:9px}
.amb-share p{margin:0;padding:14px 0;border-bottom:1px solid var(--line);line-height:1.6}.amb-share p:last-child{border-bottom:0}
.amb-share .head{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:4px}.amb-share .head b{font-weight:500}
.amb-code{flex-wrap:wrap;align-items:flex-start;gap:12px;padding:14px 0}.amb-code .grow{flex:1 1 280px}.amb-code>.actions{flex:0 1 auto;justify-content:flex-end}
.amb-code code b{font-weight:500}
.amb-link{display:block;margin:6px 0 4px;padding:6px 10px;border-radius:8px;background:var(--soft);font-size:12.5px;color:var(--ink-2);overflow-wrap:anywhere}
.amb-paid{flex-wrap:wrap;gap:4px 10px}
details summary{font-weight:500}
@media (max-width:860px){.amb{grid-template-columns:minmax(0,1fr);gap:20px}.amb-side{position:static;gap:16px}.amb-quick{display:none}
.amb-nav{position:sticky;top:0;z-index:5;flex-direction:row;gap:4px;overflow-x:auto;scrollbar-width:none;background:var(--canvas);padding:6px 0;border-bottom:1px solid var(--line)}.amb-nav::-webkit-scrollbar{display:none}
.amb-nav a{flex:none;margin:0;padding:7px 11px}.amb-sec{scroll-margin-top:64px}
.amb .levels{grid-template-columns:1fr 1fr}.amb .levels>div:nth-child(3){border-left:0}.amb .levels>div:nth-child(n+3){border-top:1px solid var(--line)}}
@media (max-width:560px){main.wide{padding:16px 16px 48px}.amb-main h1{font-size:22px}.amb-sec{padding:28px 0}
.amb .stats{grid-template-columns:1fr 1fr}.amb .stats div{padding:13px 14px;min-width:0}
.amb .stats div:first-child{grid-column:1/-1;border-bottom:1px solid var(--line)}.amb .stats div:nth-child(2){border-left:0}
.amb .card{padding:14px}.amb-code>.actions,.amb-payout,.amb-new{display:grid;grid-template-columns:1fr 1fr;width:100%}
.amb-code>.actions>*,.amb-payout>*,.amb-new>*{width:100%;min-width:0!important}.amb-code>.actions .button,.amb-code>.actions button,.amb-payout button,.amb-new button{width:100%;text-align:center;justify-content:center;white-space:nowrap;padding:8px 6px}
.amb-code>.actions>form:last-child:nth-child(odd),.amb-new>input{grid-column:1/-1}.amb-payout{grid-template-columns:1fr}.amb-new{grid-template-columns:1fr}
.amb-share .head{flex-wrap:wrap}.amb-long{display:none}.amb-paid .grow{flex-basis:100%}
.notice .inline,.notice .inline button{width:100%}}
.js-only{display:none!important}.js .js-only{display:inline-block!important}
@media (prefers-reduced-motion:no-preference){html{scroll-behavior:smooth}}
@media (prefers-reduced-motion:reduce){.amb .meter i{transition:none}}
`;

/** Marks the section in view in the sidebar, and copies a link or a text with one click. */
export const DASHBOARD_SCRIPT = `document.documentElement.classList.add("js");
(function(){var links=[].slice.call(document.querySelectorAll(".amb-nav a"));if(!links.length||!("IntersectionObserver" in window))return;
var mark=function(id){links.forEach(function(a){var on=a.getAttribute("href")==="#"+id;a.classList.toggle("on",on);if(on)a.setAttribute("aria-current","true");else a.removeAttribute("aria-current")})};
var seen={};var io=new IntersectionObserver(function(entries){entries.forEach(function(e){seen[e.target.id]=e.isIntersecting});var first=links.map(function(a){return a.getAttribute("href").slice(1)}).filter(function(id){return seen[id]})[0];if(first)mark(first)},{rootMargin:"-10% 0px -55% 0px"});
links.forEach(function(a){var s=document.getElementById(a.getAttribute("href").slice(1));if(s)io.observe(s)})})();
document.addEventListener("click",function(e){var b=e.target.closest&&e.target.closest("[data-copy]");if(!b||!navigator.clipboard)return;navigator.clipboard.writeText(b.getAttribute("data-copy")).then(function(){var t=b.textContent;b.textContent="Copié ✓";setTimeout(function(){b.textContent=t},1600)})});`;

const copyButton = (text: string, label = "Copier") => h`<button type="button" class="js-only" data-copy="${text}">${label}</button>`;

export function ambassadorDashboard(input: DashboardInput): Html {
  const { ambassador, stats, rules, rate } = input;
  if (ambassador.status === "pending") return h`<div class="narrow center"><h1>Candidature en cours d'examen</h1><p class="muted">Merci ${ambassador.name} ! Nous vous répondons par e-mail sous 48 h. Ensuite, votre lien, vos codes et vos gains apparaîtront ici.</p></div>`;
  if (ambassador.status === "suspended") return h`<div class="narrow center"><h1>Compte ambassadeur suspendu</h1><p class="muted">Écrivez-nous pour en savoir plus.</p></div>`;
  const main = input.codes.find((code) => code.active);
  const first = ambassador.name.split(" ")[0] || ambassador.name;
  const share = pct(ambassador.rateOverride ?? stats.level.rate);
  return h`<style>${raw(DASHBOARD_STYLE)}</style><div class="amb">
<aside class="amb-side">
<div class="amb-me"><div class="amb-avatar" aria-hidden="true">${first.slice(0, 1).toUpperCase()}</div><b>${ambassador.name}</b><span class="amb-chip">${stats.level.name} · ${share}</span>
<div class="meter" style="margin-top:12px"><i style="width:${String(stats.next ? Math.round(Math.max(stats.next.revenueUsd ? Math.min(1, stats.revenueUsd / stats.next.revenueUsd) : 0, stats.next.clients ? Math.min(1, stats.paying / stats.next.clients) : 0) * 100) : 100)}%"></i></div>
<div class="muted">${stats.next ? `Prochain niveau : ${stats.next.name}` : "Niveau maximum atteint"}</div></div>
<nav class="amb-nav" aria-label="Espace ambassadeur">${SECTIONS.map(([id, label, name]) => h`<a href="#${id}" class="${id === "apercu" ? "on" : ""}">${icon(name)}<span>${label}</span></a>`)}</nav>
${main ? h`<div class="amb-quick"><span class="muted">Votre code principal</span><code>${main.code}</code><div class="actions">${copyButton(linkFor(main.code), "Copier le lien")}<a class="button" target="_blank" rel="noopener noreferrer" href="https://wa.me/?text=${encodeURIComponent(shareText(main.code, rules.welcomeCredits))}">WhatsApp</a></div></div>` : ""}
</aside>
<div class="amb-main">
<section id="apercu" class="amb-sec"><h1>Bonjour ${first}</h1>
<p class="muted">Niveau <b>${stats.level.name}</b> · ${share} de chaque abonnement pendant ${Math.max(6, ambassador.months)} mois par client.</p>
${progress(input)}
${notice(input.error, "error")}${notice(input.message)}
${stats.canExtendTo ? h`<div class="notice"><b>Bravo, vous avez atteint le niveau ${stats.level.name} !</b> Vous pouvez demander à toucher vos commissions pendant ${stats.canExtendTo} mois par client au lieu de 6.
<form class="inline" method="post" action="/ambassadeur/prolongation"><button class="primary">Demander la prolongation à ${stats.canExtendTo} mois</button></form></div>` : ""}
${ambassador.extensionRequest ? h`<div class="notice">Votre demande de prolongation à ${ambassador.extensionRequest} mois est en cours d'examen.</div>` : ""}
<div class="stats"><div><span>Disponible</span><b>${money(stats.availableUsd)}</b><small>${francs(stats.availableUsd, rate)}</small></div>
<div><span>Clients payants</span><b>${stats.paying.toLocaleString("fr-FR")}</b><small>${stats.signups.toLocaleString("fr-FR")} inscrits · ${stats.clicks.toLocaleString("fr-FR")} visiteurs</small></div>
<div><span>CA amené (6 mois)</span><b>${money(stats.revenueUsd)}</b><small>${francs(stats.revenueUsd, rate)}</small></div></div></section>
<section id="gains" class="amb-sec"><h2>Gains et retraits</h2>
<div class="stats"><div><span>Total gagné</span><b>${money(stats.availableUsd + stats.heldUsd + stats.paidUsd)}</b><small>${francs(stats.availableUsd + stats.heldUsd + stats.paidUsd, rate)}</small></div>
<div><span>En attente</span><b>${money(stats.heldUsd)}</b><small>${stats.nextPayableAt ? `disponible dès le ${day(stats.nextPayableAt)}` : "rien en attente"}</small></div>
<div><span>Déjà versé</span><b>${money(stats.paidUsd)}</b><small>${francs(stats.paidUsd, rate)}</small></div></div>
<div class="card"><b>Retirer mes gains</b><p class="muted">Mobile Money dès ${rules.minPayoutXof.toLocaleString("fr-FR")} FCFA, envoyé sous quelques jours au ${ambassador.phone || "numéro de votre candidature"}. Ou en crédits Delio, tout de suite.</p>
<div class="actions amb-payout"><form class="inline" method="post" action="/ambassadeur/retrait"><input type="hidden" name="mode" value="mobile_money"><button class="primary" ${stats.availableUsd > 0 ? "" : raw("disabled")}>Recevoir en Mobile Money</button></form>
<form class="inline" method="post" action="/ambassadeur/retrait"><input type="hidden" name="mode" value="credits"><button ${stats.availableUsd > 0 ? "" : raw("disabled")}>Recevoir en crédits</button></form></div>
${input.payouts.length ? h`<details><summary>Historique des retraits</summary>${input.payouts.map((payout) => h`<div class="row amb-paid"><span class="grow">${day(payout.at)} · ${payout.mode === "credits" ? "en crédits" : "Mobile Money"}${payout.reference ? ` · réf. ${payout.reference}` : ""}</span><b>${money(payout.usd)}</b><span class="muted">${payout.status === "paid" ? "versé" : "en cours"}</span></div>`)}</details>` : h`<p class="muted" style="margin-bottom:0">Aucun retrait pour l'instant.</p>`}</div></section>
<section id="codes" class="amb-sec"><h2>Mes codes et mes liens</h2>
<div class="card">${input.codes.map((code) => h`<div class="row amb-code"><div class="grow"><code style="font-size:16px"><b>${code.code}</b></code>${code.active ? "" : h` <span class="muted">· désactivé</span>`}<code class="amb-link">${linkFor(code.code)}</code>
<div class="muted">${code.signups.toLocaleString("fr-FR")} inscrits · ${code.paying.toLocaleString("fr-FR")} clients payants</div></div>
<div class="actions">${code.active ? h`${copyButton(linkFor(code.code), "Copier le lien")}<a class="button" target="_blank" rel="noopener noreferrer" href="https://wa.me/?text=${encodeURIComponent(shareText(code.code, rules.welcomeCredits))}"><span class="amb-long">Partager sur </span>WhatsApp</a>` : ""}
<form class="inline" method="post" action="/ambassadeur/codes/${code.code}/${code.active ? "desactiver" : "activer"}"><button>${code.active ? "Désactiver" : "Réactiver"}</button></form></div></div>`)}
${input.codes.length < rules.maxCodes ? h`<form method="post" action="/ambassadeur/codes" class="actions amb-new" style="margin-top:12px"><input name="code" required maxlength="20" pattern="[A-Za-z0-9\\-]{3,20}" placeholder="Votre code, ex. AWA ou AWA-TIKTOK" style="flex:1;min-width:200px;text-transform:uppercase">
<button class="primary">Créer ce code</button></form><p class="muted">3 à 20 lettres, chiffres ou tirets. Jusqu'à ${rules.maxCodes} codes, par exemple un par réseau, pour voir lequel marche le mieux.</p>` : h`<p class="muted">Vous avez vos ${rules.maxCodes} codes.</p>`}</div></section>
<section id="partager" class="amb-sec"><h2>Textes prêts à partager</h2>
${main ? h`<div class="card amb-share">
<p><span class="head"><b>WhatsApp / statut</b>${copyButton(shareText(main.code, rules.welcomeCredits))}</span>${shareText(main.code, rules.welcomeCredits)}</p>
<p><span class="head"><b>Instagram / TikTok (légende)</b>${copyButton(captionText(main.code, rules.welcomeCredits))}</span>${captionText(main.code, rules.welcomeCredits)}</p>
<p><span class="head"><b>Idée de vidéo</b></span>Montrez une vraie tâche faite par un bot en 30 secondes (une réponse client, un post, un rapport), puis votre code à l'écran.</p></div>`
    : h`<div class="card"><p class="muted" style="margin:0">Réactivez ou créez un code pour obtenir vos textes.</p></div>`}</section>
<section id="niveaux" class="amb-sec"><h2>Niveaux</h2>${levelCards(rules, rate, stats.level)}</section>
<section id="aide" class="amb-sec"><h2>Comment ça marche</h2><div class="card">${howItWorks(rules, rate)}<p style="margin-bottom:0"><a href="${SITE_URL}/ambassadeurs">Le programme en détail</a></p></div>
<p class="muted">Pour revenir ici : <b>deliobot.fun/ambassadeur</b>, ou le menu de votre application Deliobot. Pensez à l'ajouter à vos favoris.</p></section>
</div></div>`;
}

function captionText(code: string, credits: number): string {
  return `Je confie mes tâches répétitives à des bots IA avec Deliobot 🤖 Messages, rapports, contenus… ils reviennent avec le travail fini. Code ${code} = +${credits} crédits offerts 👉 lien en bio : ${linkFor(code)}`;
}
