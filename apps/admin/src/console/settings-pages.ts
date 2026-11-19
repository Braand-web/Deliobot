import { h, raw, type Html } from "../pages.ts";
import type { Announcement } from "../operator-settings.ts";
import type { Broadcast } from "../outbox.ts";
import type { Plan, PlanId } from "../plans.ts";
import type { Promo } from "../promos.ts";
import { ago, badge, date, empty, n } from "./pages.ts";

const day = (at: number | null) => at === null ? "" : new Date(at).toISOString().slice(0, 10);

export function promosPage(input: { promos: Promo[]; plans: Plan[]; now: number; customerUrl: string }): Html {
  const state = (promo: Promo) => !promo.active ? badge("mute", "Désactivé")
    : promo.expiresAt !== null && promo.expiresAt <= input.now ? badge("warn", "Expiré")
    : promo.maxUses !== null && promo.uses >= promo.maxUses ? badge("warn", "Épuisé") : badge("ok", "Actif");
  const rows = input.promos.map((promo) => h`<tr><td><b class="mono">${promo.code}</b>${promo.note ? h`<div class="muted small">${promo.note}</div>` : ""}</td>
<td>${promo.kind === "percent" ? `-${promo.value} % ${promo.plans ? `(${promo.plans.join(", ")})` : "sur les forfaits"}` : `${n(promo.value)} crédits`}</td>
<td class="num">${n(promo.uses)}${promo.maxUses !== null ? ` / ${n(promo.maxUses)}` : ""}</td><td class="muted">${promo.expiresAt === null ? "Jamais" : date(promo.expiresAt)}</td><td>${state(promo)}</td>
<td class="small"><a href="${input.customerUrl}/code?code=${promo.code}" target="_blank" rel="noopener noreferrer">Lien à partager</a></td>
<td><div class="bar"><form method="post" action="/promos/${promo.code}/${promo.active ? "desactiver" : "activer"}"><button class="btn small">${promo.active ? "Désactiver" : "Activer"}</button></form>
<form method="post" action="/promos/${promo.code}/supprimer" data-confirm="Supprimer le code ${promo.code} ?" data-detail="Il ne pourra plus être utilisé. Les crédits déjà donnés et les commandes payées restent." data-danger="1" data-action="Supprimer"><button class="btn small danger">Supprimer</button></form></div></td></tr>`);
  return h`<div class="grid split"><section class="card"><h2>Codes<small>Un espace utilise chaque code une seule fois</small></h2>
${input.promos.length ? h`<div class="table-wrap"><table><thead><tr><th>Code</th><th>Effet</th><th class="num">Utilisations</th><th>Expire</th><th>État</th><th></th><th></th></tr></thead><tbody>${rows}</tbody></table></div>`
  : empty("Aucun code pour l'instant. Créez-en un à droite.")}</section>
<aside class="card actions"><h2>Nouveau code</h2><form method="post" action="/promos">
<label for="code">Code</label><input id="code" name="code" required maxlength="32" pattern="[A-Za-z0-9_\\-]{3,32}" placeholder="LANCEMENT20" autocapitalize="characters">
<div class="row2"><div><label for="kind">Type</label><select id="kind" name="kind"><option value="percent">Réduction en %</option><option value="credits">Crédits offerts</option></select></div>
<div><label for="value">Valeur</label><input id="value" name="value" type="number" min="1" max="1000000" required placeholder="20"></div></div>
<div class="row2"><div><label for="max">Utilisations max</label><input id="max" name="max" type="number" min="1" placeholder="Illimité"></div>
<div><label for="expires">Expire le</label><input id="expires" name="expires" type="date"></div></div>
<label>Forfaits concernés (réduction)</label><div class="checks">${input.plans.filter((plan) => plan.id !== "trial").map((plan) => h`<label><input type="checkbox" name="plans" value="${plan.id}">${plan.name}</label>`)}</div>
<p class="muted small" style="margin:0">Aucun coché : tous les forfaits. Une réduction ne s'applique jamais à l'essai.</p>
<label for="note">Note interne</label><input id="note" name="note" maxlength="120" placeholder="Campagne Facebook novembre">
<button class="btn primary">Créer le code</button></form>
<p class="muted small">Le client tape le code sur <a href="${input.customerUrl}/code" target="_blank" rel="noopener noreferrer">${input.customerUrl.replace(/^https?:\/\//, "")}/code</a>, ou ouvre directement le lien à partager.</p></aside></div>`;
}

export const AUDIENCES: ReadonlyArray<[string, string]> = [
  ["admins", "Administrateurs de tous les espaces"], ["paying", "Abonnés payants (forfait en cours)"], ["trial", "Personnes passées par l'essai"], ["all", "Tous les comptes"],
];

export function commsPage(input: { announcement: Announcement | null; broadcasts: Broadcast[]; audiences: Record<string, number>; mail: boolean; queued: number; now: number }): Html {
  const a = input.announcement;
  const levels: Array<[string, string]> = [["info", "Information"], ["promo", "Offre"], ["warning", "Alerte"]];
  return h`<div class="grid split"><section class="card stack"><h2>Annonce sur le site<small>Le bandeau en haut de deliobot.fun</small></h2>
${a ? h`<div class="notice ${a.level === "warning" ? "bad" : "info"}"><span><b>En ligne</b> depuis ${ago(a.at, input.now)}${a.until ? ` · jusqu'au ${date(a.until)}` : ""} : ${a.text}${a.link ? h` → <span class="mono small">${a.link}</span>` : ""}</span></div>
<form method="post" action="/communication/annonce/retirer"><button class="btn small">Retirer l'annonce</button></form>` : h`<p class="muted small" style="margin:0">Aucune annonce : le site affiche son bandeau habituel.</p>`}
<form method="post" action="/communication/annonce"><label for="text">Texte</label><input id="text" name="text" required maxlength="140" value="${a?.text ?? ""}" placeholder="-20 % sur Pro avec le code LANCEMENT20">
<div class="fields"><div><label for="link">Lien (facultatif)</label><input id="link" name="link" maxlength="300" value="${a?.link ?? ""}" placeholder="https://compte.deliobot.fun/code?code=LANCEMENT20"></div>
<div><label for="level">Style</label><select id="level" name="level">${levels.map(([id, label]) => h`<option value="${id}" ${a?.level === id ? raw("selected") : ""}>${label}</option>`)}</select></div>
<div><label for="until">Jusqu'au (facultatif)</label><input id="until" name="until" type="date" value="${a?.until ? day(a.until) : ""}"></div></div>
<button class="btn primary">${a ? "Mettre à jour l'annonce" : "Publier l'annonce"}</button></form>
<h2 style="margin-top:10px">Envois précédents</h2>
${input.broadcasts.length ? h`<div class="table-wrap"><table><thead><tr><th>Objet</th><th>Destinataires</th><th class="num">Envoyés</th><th>Quand</th></tr></thead><tbody>
${input.broadcasts.map((b) => h`<tr><td>${b.subject}<div class="muted small">par ${b.actor}</div></td><td>${AUDIENCES.find(([id]) => id === b.audience)?.[1] ?? b.audience}</td>
<td class="num">${n(b.sent)} / ${n(b.total)}${b.failed ? h` ${badge("bad", `${n(b.failed)} échec${b.failed > 1 ? "s" : ""}`)}` : ""}</td><td class="muted">${ago(b.at, input.now)}</td></tr>`)}</tbody></table></div>`
  : empty("Aucun e-mail envoyé pour l'instant.")}</section>
<aside class="card actions"><h2>E-mail aux clients</h2>
${input.mail ? "" : h`<div class="notice bad">Les e-mails ne sont pas configurés sur ce portail : rien ne partirait.</div>`}
${input.queued ? h`<div class="notice info">${n(input.queued)} e-mail${input.queued > 1 ? "s" : ""} en cours d'envoi (environ 40 par minute).</div>` : ""}
<form method="post" action="/communication/envoyer" data-confirm="Envoyer cet e-mail ?" data-detail="Il part à tous les destinataires choisis, environ 40 par minute. Impossible de l'annuler ensuite." data-action="Envoyer">
<label for="audience">Destinataires</label><select id="audience" name="audience">${AUDIENCES.map(([id, label]) => h`<option value="${id}">${label} (${n(input.audiences[id] ?? 0)})</option>`)}</select>
<label for="subject">Objet</label><input id="subject" name="subject" required maxlength="140">
<label for="body">Message</label><textarea id="body" name="body" required maxlength="8000" rows="9" placeholder="Bonjour,&#10;&#10;…"></textarea>
<p class="muted small" style="margin:0">Texte simple. Une ligne de désinscription est ajoutée à la fin.</p>
<button class="btn primary" ${input.mail ? "" : raw("disabled")}>Envoyer</button></form></aside></div>`;
}

export function pricingPage(input: { plans: Array<{ plan: Plan; base: Plan; changed: boolean; subscribers: number }>; xof: { value: number; fromEnv: number; overridden: boolean } }): Html {
  const cell = (id: PlanId, key: keyof Plan, value: number | null, base: number | null, step = "1") => value === null ? h`<span class="muted">—</span>`
    : h`<input name="${key}" form="plan-${id}" type="number" min="0" step="${step}" value="${String(value)}" aria-label="${key}" style="width:96px">${value !== base ? h`<div class="muted small">code : ${String(base)}</div>` : ""}`;
  return h`<section class="card"><h2>Forfaits<small>Les nouveaux paiements, la page Tarifs du site et l'application lisent ces valeurs</small></h2>
<div class="table-wrap"><table><thead><tr><th>Forfait</th><th>Prix mensuel ($)</th><th>Prix annuel ($)</th><th>Crédits / mois</th><th>Heures d'ordinateur</th><th>Ordinateurs en même temps</th><th class="num">Abonnés</th><th></th></tr></thead><tbody>
${input.plans.map(({ plan, base, changed, subscribers }) => h`<tr><td><b>${plan.name}</b>${changed ? h` ${badge("info", "Modifié")}` : ""}${plan.listed ? "" : h`<div class="muted small">non affiché sur le site</div>`}</td>
<td>${cell(plan.id, "usd", plan.usd, base.usd, "0.01")}</td><td>${cell(plan.id, "usdYear", plan.usdYear, base.usdYear, "0.01")}</td>
<td>${plan.gateway ? cell(plan.id, "credits", plan.credits, base.credits) : h`<span class="muted">ses clés</span>`}</td>
<td>${plan.gateway ? cell(plan.id, "computerHours", plan.computerHours, base.computerHours) : h`<span class="muted">—</span>`}</td>
<td>${plan.gateway ? cell(plan.id, "computers", plan.computers, base.computers) : h`<span class="muted">—</span>`}</td><td class="num">${n(subscribers)}</td>
<td><div class="bar"><form id="plan-${plan.id}" method="post" action="/forfaits/${plan.id}" data-confirm="Enregistrer ${plan.name} ?" data-detail="Les prochains paiements et la page Tarifs utilisent ces valeurs. Les abonnements déjà payés ne changent pas." data-action="Enregistrer"><button class="btn small primary">Enregistrer</button></form>
${changed ? h`<form method="post" action="/forfaits/${plan.id}/retablir"><button class="btn small">Rétablir</button></form>` : ""}</div></td></tr>`)}
</tbody></table></div><p class="muted small">Les crédits d'un mois s'appliquent au prochain paiement ou renouvellement. Les recharges restent à 4 500 crédits pour 20 $ et 13 500 pour 50 $.</p></section>
<section class="card"><h2>Offrir un forfait par e-mail<small>Le compte et son espace sont créés s'ils n'existent pas ; la personne se connecte avec cet e-mail</small></h2>
<form method="post" action="/forfaits/offrir" class="fields" data-confirm="Offrir ce forfait ?" data-detail="Il s'applique tout de suite, comme un paiement à 0 $." data-action="Offrir">
<div><label for="g-email">E-mail</label><input id="g-email" name="email" type="email" required maxlength="160"></div>
<div><label for="g-plan">Forfait</label><select id="g-plan" name="plan">${input.plans.map(({ plan }) => h`<option value="${plan.id}" ${plan.id === "max" ? raw("selected") : ""}>${plan.name}</option>`)}</select></div>
<div><label for="g-days">Durée (jours)</label><input id="g-days" name="days" type="number" min="1" max="400" value="30" required></div>
<div><label for="g-credits">Crédits Deliobot</label><input id="g-credits" name="credits" type="number" min="0" value="0"></div>
<div><button class="btn primary">Offrir</button></div></form>
<p class="muted small">0 crédit : la personne a les droits du forfait (propres comptes et clés IA avec Max ou BYOK) sans utiliser les crédits Deliobot.</p></section>
<section class="card"><h2>Francs CFA<small>Le montant facturé par SasPay vient du prix en dollars multiplié par ce taux</small></h2>
<form method="post" action="/forfaits/taux" class="fields"><div><label for="rate">Francs CFA pour 1 $</label><input id="rate" name="rate" type="number" min="100" max="2000" step="0.01" value="${String(input.xof.value)}"></div>
<div><button class="btn primary">Enregistrer le taux</button></div></form>
<p class="muted small">${input.xof.overridden ? `Taux choisi ici ; celui de la configuration est ${n(input.xof.fromEnv, 2)}. Videz le champ pour y revenir.` : "Taux de la configuration du portail."}</p></section>`;
}

export function systemPage(input: { services: Record<string, boolean>; switches: Array<{ id: string; label: string; detail: string; open: boolean }>; counts: Array<[string, number]>; queued: number }): Html {
  return h`<div class="grid split"><section class="card stack"><h2>Ouvertures<small>Effet immédiat, sans redéploiement</small></h2>
<ul class="list">${input.switches.map((item) => h`<li><span class="grow"><b>${item.label}</b> ${item.open ? badge("ok", "Ouvert") : badge("bad", "Fermé")}<div class="muted small">${item.detail}</div></span>
<form method="post" action="/systeme/${item.id}" data-confirm="${item.open ? `Fermer : ${item.label} ?` : `Ouvrir : ${item.label} ?`}" data-detail="${item.detail}" ${item.open ? raw('data-danger="1"') : ""} data-action="${item.open ? "Fermer" : "Ouvrir"}">
<input type="hidden" name="open" value="${item.open ? "0" : "1"}"><button class="btn small ${item.open ? "danger" : "primary"}">${item.open ? "Fermer" : "Ouvrir"}</button></form></li>`)}</ul>
<h2>Services</h2><ul class="list">${Object.entries(input.services).map(([name, ready]) => h`<li><span class="grow">${name}</span>${ready ? badge("ok", "Configuré") : badge("warn", "Absent")}</li>`)}</ul>
<p class="muted small" style="margin:0">Une clé s'ajoute dans les secrets du portail sur Cloudflare, ou avec un lien de configuration.</p></section>
<aside class="card"><h2>Données</h2><div class="facts">${input.counts.map(([label, value]) => h`<div><span>${label}</span><b>${n(value)}</b></div>`)}</div>
${input.queued ? h`<p class="muted small">${n(input.queued)} e-mails en file d'envoi.</p>` : ""}</aside></div>`;
}

export function securityPage(input: { operators: Array<{ email: string; id: string | null; sessions: number; self: boolean }>; blocked: Array<{ id: string; email: string; at: number }>;
  logins: Array<{ actor: string | null; target: string | null; at: number }>; actions: Array<{ workspace: string | null; actor: string | null; action: string; target: string | null; at: number }>; now: number }): Html {
  return h`<div class="grid split"><section class="card stack"><h2>Opérateurs<small>Les seules adresses admises sur cette console</small></h2>
<ul class="list">${input.operators.map((op) => h`<li><span class="grow"><b>${op.email}</b>${op.self ? h` ${badge("info", "Vous")}` : ""}<div class="muted small">${op.id === null ? "jamais connecté" : `${n(op.sessions)} session${op.sessions > 1 ? "s" : ""} ouverte${op.sessions > 1 ? "s" : ""}`}</div></span>
${op.id !== null && op.sessions > (op.self ? 1 : 0) ? h`<form method="post" action="/securite/sessions" data-confirm="${op.self ? "Fermer vos autres sessions ?" : `Déconnecter ${op.email} partout ?`}" data-detail="${op.self ? "Cette session reste ouverte ; toutes les autres doivent se reconnecter avec un code." : "Il devra se reconnecter avec un code reçu par e-mail."}" data-action="Déconnecter">
<input type="hidden" name="account" value="${op.id}"><button class="btn small">${op.self ? "Fermer mes autres sessions" : "Déconnecter partout"}</button></form>` : ""}</li>`)}</ul>
<p class="muted small" style="margin:0">La liste des opérateurs est verrouillée dans la configuration du portail : elle ne se modifie pas depuis cette page.</p>
<h2>Comptes bloqués</h2>${input.blocked.length ? h`<ul class="list">${input.blocked.map((row) => h`<li><span class="grow"><b>${row.email}</b><div class="muted small">bloqué ${ago(row.at, input.now)}</div></span>
<form method="post" action="/securite/debloquer" data-confirm="Débloquer ${row.email} ?" data-detail="Ce compte pourra de nouveau se connecter." data-action="Débloquer"><input type="hidden" name="account" value="${row.id}"><button class="btn small">Débloquer</button></form></li>`)}</ul>`
  : empty("Aucun compte bloqué.")}</section>
<aside class="card stack"><h2>Connexions à la console</h2>${input.logins.length ? h`<ul class="list">${input.logins.map((row) => h`<li><span class="grow">${row.actor ?? "?"}<div class="muted small mono">${row.target ?? ""}</div></span><span class="muted small">${ago(row.at, input.now)}</span></li>`)}</ul>` : empty("Aucune connexion enregistrée.")}
<h2>Actions sensibles</h2>${input.actions.length ? h`<ul class="list">${input.actions.map((row) => h`<li><span class="grow"><b>${row.action}</b> ${row.workspace ? h`<a href="/clients/${row.workspace}">${row.workspace}</a>` : ""}<div class="muted small">${row.actor ?? "système"}${row.target ? ` · ${row.target}` : ""}</div></span><span class="muted small">${ago(row.at, input.now)}</span></li>`)}</ul>` : empty("Rien à signaler.")}
<p class="small" style="margin:0"><a href="/journal">Tout le journal</a></p></aside></div>`;
}

