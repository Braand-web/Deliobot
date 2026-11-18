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

export function ambassadorDashboard(input: DashboardInput): Html {
  const { ambassador, stats, rules, rate } = input;
  if (ambassador.status === "pending") return h`<div class="narrow center"><h1>Candidature en cours d'examen</h1><p class="muted">Merci ${ambassador.name} ! Nous vous répondons par e-mail sous 48 h. Ensuite, votre lien, vos codes et vos gains apparaîtront ici.</p></div>`;
  if (ambassador.status === "suspended") return h`<div class="narrow center"><h1>Compte ambassadeur suspendu</h1><p class="muted">Écrivez-nous pour en savoir plus.</p></div>`;
  const main = input.codes.find((code) => code.active);
  return h`<h1>Bonjour ${ambassador.name.split(" ")[0] ?? ambassador.name} 👋</h1>
<p class="muted">Niveau <b>${stats.level.name}</b> · ${pct(ambassador.rateOverride ?? stats.level.rate)} de chaque abonnement pendant ${Math.max(6, ambassador.months)} mois par client.</p>
${progress(input)}
${notice(input.error, "error")}${notice(input.message)}
${stats.canExtendTo ? h`<div class="notice"><b>Bravo, vous avez atteint le niveau ${stats.level.name} !</b> Vous pouvez demander à toucher vos commissions pendant ${stats.canExtendTo} mois par client au lieu de 6.
<form class="inline" method="post" action="/ambassadeur/prolongation"><button class="primary">Demander la prolongation à ${stats.canExtendTo} mois</button></form></div>` : ""}
${ambassador.extensionRequest ? h`<div class="notice">Votre demande de prolongation à ${ambassador.extensionRequest} mois est en cours d'examen.</div>` : ""}
<h2>Ce que vous gagnez</h2>
<div class="stats"><div><span>Disponible</span><b>${money(stats.availableUsd)}</b><small>${francs(stats.availableUsd, rate)}</small></div>
<div><span>En attente</span><b>${money(stats.heldUsd)}</b><small>${stats.nextPayableAt ? `disponible dès le ${day(stats.nextPayableAt)}` : "rien en attente"}</small></div>
<div><span>Déjà versé</span><b>${money(stats.paidUsd)}</b><small>${francs(stats.paidUsd, rate)}</small></div>
<div><span>CA amené (6 mois)</span><b>${money(stats.revenueUsd)}</b><small>${francs(stats.revenueUsd, rate)}</small></div>
<div><span>Clients payants</span><b>${stats.paying.toLocaleString("fr-FR")}</b><small>${stats.signups.toLocaleString("fr-FR")} inscrits · ${stats.clicks.toLocaleString("fr-FR")} visiteurs</small></div></div>
<div class="card"><b>Retirer mes gains</b><p class="muted">Mobile Money dès ${rules.minPayoutXof.toLocaleString("fr-FR")} FCFA, envoyé sous quelques jours au ${ambassador.phone || "numéro de votre candidature"}. Ou en crédits Delio, tout de suite.</p>
<div class="actions"><form class="inline" method="post" action="/ambassadeur/retrait"><input type="hidden" name="mode" value="mobile_money"><button class="primary" ${stats.availableUsd > 0 ? "" : raw("disabled")}>Recevoir en Mobile Money</button></form>
<form class="inline" method="post" action="/ambassadeur/retrait"><input type="hidden" name="mode" value="credits"><button ${stats.availableUsd > 0 ? "" : raw("disabled")}>Recevoir en crédits</button></form></div>
${input.payouts.length ? h`<details><summary>Historique des retraits</summary>${input.payouts.map((payout) => h`<div class="row"><span class="grow">${day(payout.at)} · ${payout.mode === "credits" ? "en crédits" : "Mobile Money"}${payout.reference ? ` · réf. ${payout.reference}` : ""}</span><b>${money(payout.usd)}</b><span class="muted">${payout.status === "paid" ? "versé" : "en cours"}</span></div>`)}</details>` : ""}</div>
<h2>Mes codes et mes liens</h2>
<div class="card">${input.codes.map((code) => h`<div class="row"><div class="grow"><code style="font-size:16px"><b>${code.code}</b></code>${code.active ? "" : h` <span class="muted">· désactivé</span>`}<br><code>${linkFor(code.code)}</code>
<div class="muted">${code.signups.toLocaleString("fr-FR")} inscrits · ${code.paying.toLocaleString("fr-FR")} clients payants</div></div>
<div class="actions">${code.active ? h`<a class="button" target="_blank" rel="noopener noreferrer" href="https://wa.me/?text=${encodeURIComponent(shareText(code.code, rules.welcomeCredits))}">Partager sur WhatsApp</a>` : ""}
<form class="inline" method="post" action="/ambassadeur/codes/${code.code}/${code.active ? "desactiver" : "activer"}"><button>${code.active ? "Désactiver" : "Réactiver"}</button></form></div></div>`)}
${input.codes.length < rules.maxCodes ? h`<form method="post" action="/ambassadeur/codes" class="actions" style="margin-top:12px"><input name="code" required maxlength="20" pattern="[A-Za-z0-9\\-]{3,20}" placeholder="Votre code, ex. AWA ou AWA-TIKTOK" style="flex:1;min-width:200px;text-transform:uppercase">
<button class="primary">Créer ce code</button></form><p class="muted">3 à 20 lettres, chiffres ou tirets. Jusqu'à ${rules.maxCodes} codes, par exemple un par réseau, pour voir lequel marche le mieux.</p>` : h`<p class="muted">Vous avez vos ${rules.maxCodes} codes.</p>`}</div>
${main ? h`<h2>Textes prêts à partager</h2><div class="card">
<p><b>WhatsApp / statut</b><br>${shareText(main.code, rules.welcomeCredits)}</p>
<p><b>Instagram / TikTok (légende)</b><br>Je confie mes tâches répétitives à des bots IA avec Deliobot 🤖 Messages, rapports, contenus… ils reviennent avec le travail fini. Code ${main.code} = +${rules.welcomeCredits} crédits offerts 👉 lien en bio : ${linkFor(main.code)}</p>
<p><b>Idée de vidéo</b><br>Montrez une vraie tâche faite par un bot en 30 secondes (une réponse client, un post, un rapport), puis votre code à l'écran.</p></div>` : ""}
<details class="card"><summary>Comment ça marche</summary>${howItWorks(rules, rate)}${levelCards(rules, rate, stats.level)}<p><a href="${SITE_URL}/ambassadeurs">Le programme en détail</a></p></details>`;
}
