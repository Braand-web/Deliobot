import type { Ambassador, AmbassadorRules, AmbassadorStats, Payout } from "../ambassadors.ts";
import { linkFor } from "../ambassador-pages.ts";
import { h, raw, type Html } from "../pages.ts";
import { ago, badge, date, empty, n } from "./pages.ts";

const money = (usd: number) => `${n(usd, 2)} $`;
const pct = (rate: number) => `${Math.round(rate * 100)} %`;
const STATUS: Record<Ambassador["status"], [Parameters<typeof badge>[0], string]> = { pending: ["warn", "À valider"], active: ["ok", "Actif"], suspended: ["mute", "Suspendu"] };

export interface AmbassadorRow { ambassador: Ambassador; stats: AmbassadorStats; codes: string[] }

export function ambassadorsPage(input: { rows: AmbassadorRow[]; filter: string; payouts: Array<Payout & { name: string; phone: string }>; totals: { revenueUsd: number; owedUsd: number }; rate: number; now: number }): Html {
  const filters: Array<[string, string]> = [["all", "Tous"], ["pending", "À valider"], ["active", "Actifs"], ["suspended", "Suspendus"]];
  const requested = input.payouts.filter((payout) => payout.status === "requested");
  return h`<div class="k4" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px">
<section class="card"><h2>CA via ambassadeurs</h2><b style="font-size:22px">${money(input.totals.revenueUsd)}</b><div class="muted small">abonnements seulement</div></section>
<section class="card"><h2>Commissions dues</h2><b style="font-size:22px">${money(input.totals.owedUsd)}</b><div class="muted small">≈ ${n(input.totals.owedUsd * input.rate)} FCFA</div></section>
<section class="card"><h2>Ambassadeurs actifs</h2><b style="font-size:22px">${n(input.rows.filter((row) => row.ambassador.status === "active").length)}</b></section>
<section class="card"><h2>Retraits à faire</h2><b style="font-size:22px">${n(requested.length)}</b></section></div>
${requested.length ? h`<section class="card"><h2>Retraits Mobile Money à envoyer</h2><ul class="list">${requested.map((payout) => h`<li><span class="grow"><b>${payout.name}</b> · ${payout.phone}<div class="muted small">${money(payout.usd)} ≈ ${n(payout.usd * input.rate)} FCFA · demandé ${ago(payout.at, input.now)}</div></span>
<form method="post" action="/ambassadeurs/retraits/${String(payout.id)}" class="bar" data-confirm="Marquer ce retrait comme payé ?" data-detail="Faites d'abord l'envoi Mobile Money, puis notez sa référence." data-action="Marquer payé">
<input name="reference" maxlength="80" placeholder="Référence de l'envoi" aria-label="Référence" style="width:180px"><button class="btn small primary">Marquer payé</button></form></li>`)}</ul></section>` : ""}
<div class="grid split"><section class="card"><h2>Ambassadeurs<small>${filters.map(([id, label]) => h`<a class="chip" href="/ambassadeurs?filtre=${id}" ${id === input.filter ? raw('aria-current="true"') : ""}>${label}</a> `)}</small></h2>
${input.rows.length ? h`<div class="table-wrap"><table><thead><tr><th>Ambassadeur</th><th>Niveau</th><th class="num">Clics</th><th class="num">Inscrits</th><th class="num">Payants</th><th class="num">CA 6 mois</th><th class="num">À payer</th><th>État</th></tr></thead><tbody>
${input.rows.map(({ ambassador, stats, codes }) => h`<tr class="link" data-href="/ambassadeurs/${ambassador.id}"><td><a href="/ambassadeurs/${ambassador.id}"><b>${ambassador.name}</b></a><div class="muted small">${ambassador.email}${codes.length ? ` · ${codes.join(", ")}` : ""}</div></td>
<td>${stats.level.name}${ambassador.extensionRequest ? h` ${badge("info", `demande ${ambassador.extensionRequest} mois`)}` : ""}</td><td class="num">${n(stats.clicks)}</td><td class="num">${n(stats.signups)}</td><td class="num">${n(stats.paying)}</td>
<td class="num">${money(stats.revenueUsd)}</td><td class="num">${money(stats.availableUsd)}</td><td>${badge(...STATUS[ambassador.status])}</td></tr>`)}</tbody></table></div>`
  : empty("Aucun ambassadeur ici. Ajoutez-en un à droite, ou partagez la page « Devenir ambassadeur ».")}</section>
<aside class="card actions"><h2>Nouvel ambassadeur</h2><form method="post" action="/ambassadeurs">
<label for="a-name">Nom</label><input id="a-name" name="name" required maxlength="80">
<label for="a-email">E-mail</label><input id="a-email" name="email" type="email" required maxlength="160">
<label for="a-phone">WhatsApp / Mobile Money</label><input id="a-phone" name="phone" maxlength="30">
<label for="a-social">Réseau (lien)</label><input id="a-social" name="social" maxlength="200">
<label for="a-code">Premier code (facultatif)</label><input id="a-code" name="code" maxlength="20" placeholder="Proposé à partir du nom">
<button class="btn primary">Créer et activer</button></form>
<p class="muted small">Il reçoit un e-mail avec son lien, son code et l'accès à son espace sur compte.deliobot.fun/ambassadeur. Page de candidature : <a href="https://compte.deliobot.fun/ambassadeur/rejoindre" target="_blank" rel="noopener noreferrer">compte.deliobot.fun/ambassadeur/rejoindre</a></p></aside></div>`;
}

export function ambassadorPage(input: { row: AmbassadorRow; rules: AmbassadorRules; commissions: Array<{ orderId: string; workspace: string; kind: string; orderUsd: number; rate: number; usd: number; status: string; createdAt: number }>;
  payouts: Payout[]; codes: Array<{ code: string; active: boolean; signups: number; paying: number }>; now: number }): Html {
  const { ambassador, stats } = input.row;
  const statusLabel: Record<string, string> = { held: "En attente", payable: "Disponible", void: "Annulée", trial: "Essai (attend un forfait)" };
  return h`<div class="card head"><span class="avatar">${(ambassador.name[0] ?? "?").toUpperCase()}</span><div style="flex:1;min-width:0"><h2 style="margin:0;font-size:18px">${ambassador.name} ${badge(...STATUS[ambassador.status])}</h2>
<div class="muted small">${ambassador.email} · ${ambassador.phone || "pas de numéro"} · ${ambassador.social ? h`<a href="${ambassador.social}" target="_blank" rel="noopener noreferrer">réseau</a>` : "pas de réseau"} · inscrit ${date(ambassador.createdAt)}</div></div>
<a class="btn small" href="/ambassadeurs">← Tous les ambassadeurs</a></div>
<div class="grid split"><section class="card stack">
<div class="facts"><div><span>Niveau</span><b>${stats.level.name}</b></div><div><span>Taux</span><b>${pct(ambassador.rateOverride ?? stats.level.rate)}${ambassador.rateOverride !== null ? " (perso)" : ""}</b></div>
<div><span>Durée par client</span><b>${n(Math.max(6, ambassador.months))} mois</b></div><div><span>CA 6 mois</span><b>${money(stats.revenueUsd)}</b></div>
<div><span>Clics · inscrits · payants</span><b>${n(stats.clicks)} · ${n(stats.signups)} · ${n(stats.paying)}</b></div>
<div><span>En attente · disponible · versé</span><b>${money(stats.heldUsd)} · ${money(stats.availableUsd)} · ${money(stats.paidUsd)}</b></div></div>
${ambassador.audience || ambassador.why ? h`<p class="small"><b>Communauté :</b> ${ambassador.audience || "—"}<br>${ambassador.why}</p>` : ""}
<h2>Codes</h2>${input.codes.length ? h`<ul class="list">${input.codes.map((code) => h`<li><span class="grow"><b class="mono">${code.code}</b> ${code.active ? "" : badge("mute", "désactivé")}<div class="muted small mono">${linkFor(code.code)}</div></span><span class="muted small">${n(code.signups)} inscrits · ${n(code.paying)} payants</span></li>`)}</ul>` : empty("Pas encore de code.")}
<h2>Commissions</h2>${input.commissions.length ? h`<div class="table-wrap"><table><thead><tr><th>Date</th><th>Client</th><th>Type</th><th class="num">Paiement</th><th class="num">Taux</th><th class="num">Gain</th><th>État</th></tr></thead><tbody>
${input.commissions.map((row) => h`<tr><td class="muted">${date(row.createdAt)}</td><td><a href="/clients/${row.workspace}">${row.workspace}</a></td><td>${row.kind === "trial" ? "Bonus essai" : "Abonnement"}</td>
<td class="num">${money(row.orderUsd)}</td><td class="num">${row.kind === "trial" ? "fixe" : pct(row.rate)}</td><td class="num">${money(row.usd)}</td><td>${statusLabel[row.status] ?? row.status}</td></tr>`)}</tbody></table></div>` : empty("Aucune commission pour l'instant.")}
<h2>Retraits</h2>${input.payouts.length ? h`<ul class="list">${input.payouts.map((payout) => h`<li><span class="grow">${date(payout.at)} · ${payout.mode === "credits" ? "en crédits" : "Mobile Money"}${payout.reference ? ` · réf. ${payout.reference}` : ""}</span><b>${money(payout.usd)}</b> ${payout.status === "paid" ? badge("ok", "versé") : badge("warn", "à envoyer")}</li>`)}</ul>` : empty("Aucun retrait.")}
</section>
<aside class="card actions"><h2>Actions</h2>
${ambassador.status === "pending" ? h`<form method="post" action="/ambassadeurs/${ambassador.id}/valider"><h3>Candidature</h3><label for="v-code">Premier code (facultatif)</label><input id="v-code" name="code" maxlength="20" placeholder="Proposé à partir du nom">
<button class="btn primary">Valider et envoyer l'accès</button></form>
<form method="post" action="/ambassadeurs/${ambassador.id}/suspendre" data-confirm="Refuser cette candidature ?" data-danger="1" data-action="Refuser"><button class="btn danger">Refuser</button></form><hr>` : ""}
${ambassador.extensionRequest ? h`<h3>Prolongation demandée : ${n(ambassador.extensionRequest)} mois</h3><div class="bar"><form method="post" action="/ambassadeurs/${ambassador.id}/prolongation"><input type="hidden" name="accept" value="1"><button class="btn small primary">Accepter</button></form>
<form method="post" action="/ambassadeurs/${ambassador.id}/prolongation"><input type="hidden" name="accept" value="0"><button class="btn small">Refuser</button></form></div><hr>` : ""}
<form method="post" action="/ambassadeurs/${ambassador.id}/modifier"><h3>Informations</h3><input name="name" value="${ambassador.name}" maxlength="80" aria-label="Nom"><input name="phone" value="${ambassador.phone}" maxlength="30" placeholder="WhatsApp / Mobile Money" aria-label="Téléphone">
<input name="social" value="${ambassador.social}" maxlength="200" placeholder="Réseau" aria-label="Réseau"><label>Taux personnalisé (%, vide = niveau)</label><input name="rate" type="number" min="1" max="50" step="1" value="${ambassador.rateOverride === null ? "" : String(Math.round(ambassador.rateOverride * 100))}">
<button class="btn">Enregistrer</button></form><hr>
${ambassador.status === "active" ? h`<form method="post" action="/ambassadeurs/${ambassador.id}/suspendre" data-confirm="Suspendre ${ambassador.name} ?" data-detail="Ses codes ne donnent plus de crédits et il ne gagne plus rien sur les nouveaux paiements." data-danger="1" data-action="Suspendre"><button class="btn danger">Suspendre</button></form>`
  : ambassador.status === "suspended" ? h`<form method="post" action="/ambassadeurs/${ambassador.id}/valider"><button class="btn">Réactiver</button></form>` : ""}
<p class="muted small">Niveaux : ${input.rules.levels.map((level) => `${level.name} ${pct(level.rate)}`).join(" · ")}. Au-delà de 6 mois : ${pct(input.rules.extendedRate)}.</p></aside></div>`;
}
