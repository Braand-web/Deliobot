import { h, raw, type Html } from "../pages.ts";
import type { DeviceRow } from "../devices.ts";
import { MANUAL_ORDER_PREFIX, PLANS, type Order, type PlanId, type Subscription } from "../plans.ts";
import type { LedgerRow } from "../wallet.ts";
import { barChart, donut, funnel, ranking, sparkline } from "./charts.ts";
import { PERIODS, type Metrics, type Period } from "./metrics.ts";

const ICONS: Record<string, string> = {
  dash: "M3 3h7v9H3z M14 3h7v5h-7z M14 12h7v9h-7z M3 16h7v5H3z",
  traffic: "M22 12h-4l-3 9L9 3l-3 9H2",
  clients: "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2 M5 7a4 4 0 1 0 8 0a4 4 0 1 0-8 0 M22 21v-2a4 4 0 0 0-3-3.87 M16 3.13a4 4 0 0 1 0 7.75",
  orders: "M4 2v20l3-2 3 2 3-2 3 2 3-2 2 2V2l-2 2-3-2-3 2-3-2-3 2-3-2z M8 9h8 M8 13h6",
  promos: "M3 7a2 2 0 0 0 2-2h14a2 2 0 0 0 2 2v3a2 2 0 0 0 0 4v3a2 2 0 0 0-2 2H5a2 2 0 0 0-2-2v-3a2 2 0 0 0 0-4z M13 5v2 M13 11v2 M13 17v2",
  comms: "M3 11v2a1 1 0 0 0 1 1h3l5 4V6L7 10H4a1 1 0 0 0-1 1z M16 8a5 5 0 0 1 0 8 M19 5a9 9 0 0 1 0 14",
  pricing: "M20.6 13.4 13.4 20.6a2 2 0 0 1-2.8 0L3 13V3h10l7.6 7.6a2 2 0 0 1 0 2.8z M7.5 7.5h.01",
  system: "M3 4h18v6H3z M3 14h18v6H3z M7 7h.01 M7 17h.01",
  security: "M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z M9 12l2 2 4-4",
  journal: "M8 6h13 M8 12h13 M8 18h13 M3 6h.01 M3 12h.01 M3 18h.01",
  search: "M11 4a7 7 0 1 0 0 14a7 7 0 1 0 0-14 M21 21l-4.3-4.3",
  theme: "M12 3a6 6 0 0 0 9 9a9 9 0 1 1-9-9z",
  out: "M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4 M16 17l5-5-5-5 M21 12H9",
};

export type ConsoleSection = "dash" | "traffic" | "clients" | "orders" | "journal";

const NAV: ReadonlyArray<[string, string, string | null]> = [
  ["dash", "Tableau de bord", "/"], ["traffic", "Trafic", "/trafic"], ["clients", "Clients", "/clients"], ["orders", "Commandes", "/commandes"],
  ["promos", "Codes promo", null], ["comms", "Communication", null], ["pricing", "Forfaits & prix", null], ["system", "Système", null],
  ["security", "Sécurité", null], ["journal", "Journal", "/journal"],
];

export const icon = (name: string, size = 18) => h`<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${ICONS[name] ?? ""}"/></svg>`;

const STYLE = `
:root{--bg:#f6f6f9;--surface:#fff;--surface2:#f1f1f5;--line:#e3e3ea;--ink:#121216;--ink2:#5b5b66;--accent:#1068e8;--accentSoft:rgba(16,104,232,.10);--accentInk:#0b5bd0;
--okSoft:rgba(23,138,90,.10);--okInk:#137a4f;--warnSoft:rgba(196,110,0,.10);--warnInk:#9a5600;--badSoft:rgba(217,45,63,.09);--badInk:#b4202f;
--s1:#2a78d6;--s2:#eb6834;--s3:#1baf7a;--s4:#eda100;--s5:#e87ba4;--shadow:0 18px 50px -24px rgba(20,20,40,.35);color-scheme:light}
@media (prefers-color-scheme:dark){:root:where(:not([data-theme=light])){--bg:#0d0d10;--surface:#16161b;--surface2:#1e1e25;--line:#2a2a33;--ink:#f3f3f6;--ink2:#a4a4b0;--accent:#3b8bff;
--accentSoft:rgba(59,139,255,.16);--accentInk:#8cbcff;--okSoft:rgba(52,197,138,.16);--okInk:#5fd9a6;--warnSoft:rgba(240,164,58,.16);--warnInk:#f5bd6b;--badSoft:rgba(255,97,112,.15);--badInk:#ff8d98;
--s1:#3987e5;--s2:#d95926;--s3:#199e70;--s4:#c98500;--s5:#d55181;--shadow:0 18px 50px -20px rgba(0,0,0,.7);color-scheme:dark}}
:root[data-theme=dark]{--bg:#0d0d10;--surface:#16161b;--surface2:#1e1e25;--line:#2a2a33;--ink:#f3f3f6;--ink2:#a4a4b0;--accent:#3b8bff;
--accentSoft:rgba(59,139,255,.16);--accentInk:#8cbcff;--okSoft:rgba(52,197,138,.16);--okInk:#5fd9a6;--warnSoft:rgba(240,164,58,.16);--warnInk:#f5bd6b;--badSoft:rgba(255,97,112,.15);--badInk:#ff8d98;
--s1:#3987e5;--s2:#d95926;--s3:#199e70;--s4:#c98500;--s5:#d55181;--shadow:0 18px 50px -20px rgba(0,0,0,.7);color-scheme:dark}
*{box-sizing:border-box}html,body{margin:0;background:var(--bg);color:var(--ink)}
body{font:14px/1.5 "Geist",ui-sans-serif,-apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif;font-variant-numeric:tabular-nums}
a{color:var(--accentInk);text-decoration:none}a:hover{text-decoration:underline}
.app{display:grid;grid-template-columns:232px 1fr;min-height:100vh}
.side{position:sticky;top:0;height:100vh;display:flex;flex-direction:column;gap:2px;padding:16px 12px;border-right:1px solid var(--line);background:var(--surface)}
.brand{display:flex;align-items:center;gap:10px;padding:4px 8px 16px;font-weight:650;font-size:15px}.brand img{width:30px;height:30px}
.nav{display:flex;align-items:center;gap:10px;height:38px;padding:0 10px;border-radius:9px;color:var(--ink);font-weight:450}
.nav:hover{background:var(--surface2);text-decoration:none}.nav[aria-current=page]{background:var(--accentSoft);color:var(--accentInk);font-weight:600}
.nav.off{color:var(--ink2);opacity:.6;cursor:default}.nav.off:hover{background:none}.nav .soon{margin-left:auto;font-size:10.5px;border:1px solid var(--line);border-radius:999px;padding:0 6px}
.nav .count{margin-left:auto;font-size:11px;font-weight:600;background:var(--accentSoft);color:var(--accentInk);border-radius:999px;padding:1px 8px}
.side .me{margin-top:auto;border-top:1px solid var(--line);padding:12px 8px 0;font-size:12.5px;color:var(--ink2);display:flex;align-items:center;gap:8px}
.side .me span{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis}
.main{min-width:0;display:flex;flex-direction:column}
.top{position:sticky;top:0;z-index:5;display:flex;align-items:center;gap:12px;flex-wrap:wrap;padding:14px 28px;background:color-mix(in srgb,var(--bg) 88%,transparent);backdrop-filter:blur(10px);border-bottom:1px solid var(--line)}
.top h1{margin:0;font-size:19px;font-weight:650;letter-spacing:-.01em}.top p{margin:0;color:var(--ink2);font-size:12.5px}
.tools{margin-left:auto;display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.chip{height:32px;display:inline-flex;align-items:center;padding:0 12px;border-radius:999px;border:1px solid var(--line);background:var(--surface);color:var(--ink2);font-size:13px;font-weight:500}
.chip:hover{text-decoration:none;color:var(--ink)}.chip[aria-current=true]{background:var(--accentSoft);border-color:transparent;color:var(--accentInk);font-weight:600}
.iconbtn{height:34px;min-width:34px;display:inline-flex;align-items:center;justify-content:center;gap:8px;padding:0 10px;border-radius:9px;border:1px solid var(--line);background:var(--surface);color:var(--ink2);font:inherit;font-size:13px;cursor:pointer}
.iconbtn:hover{color:var(--ink)}kbd{font:11px ui-monospace,monospace;border:1px solid var(--line);border-radius:5px;padding:0 5px;background:var(--surface2)}
.content{padding:24px 28px 64px;display:flex;flex-direction:column;gap:20px;max-width:1280px;width:100%}
.grid{display:grid;gap:16px}.k4{grid-template-columns:repeat(4,minmax(0,1fr))}.k3{grid-template-columns:repeat(3,minmax(0,1fr))}.split{grid-template-columns:minmax(0,2fr) minmax(0,1fr)}.half{grid-template-columns:repeat(2,minmax(0,1fr))}
.card{background:var(--surface);border:1px solid var(--line);border-radius:14px;padding:18px;min-width:0}
.card h2{margin:0 0 12px;font-size:14px;font-weight:600;display:flex;align-items:center;gap:8px}.card h2 small{margin-left:auto;font-weight:450;color:var(--ink2);font-size:12px}
.kpi .label{color:var(--ink2);font-size:12.5px}.kpi .value{font-size:26px;font-weight:650;letter-spacing:-.02em;margin:4px 0 2px}.kpi .sub{font-size:12px;color:var(--ink2);display:flex;gap:8px;align-items:center}
.up{color:var(--okInk);font-weight:600}.down{color:var(--badInk);font-weight:600}.spark{width:100%;height:30px;margin-top:8px;display:block}
.chart{width:100%;height:auto;display:block}.chart .grid{stroke:var(--line);stroke-width:1}.chart .tick,.donut .tick{fill:var(--ink2);font-size:11px}.chart .hit:hover rect{fill:var(--surface2)}
.legend{display:flex;gap:16px;font-size:12.5px;color:var(--ink2);margin:-4px 0 8px}.legend i,.legend-list i{display:inline-block;width:10px;height:10px;border-radius:3px;margin-right:6px;vertical-align:-1px}
.donut{display:flex;align-items:center;gap:18px}.donut svg{width:140px;flex:none}.donut-n{fill:var(--ink);font-size:22px;font-weight:650}
.legend-list{list-style:none;margin:0;padding:0;flex:1;display:flex;flex-direction:column;gap:6px;font-size:13px}.legend-list li{display:flex;align-items:center}.legend-list b{margin-left:auto}
.rank{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:10px}.rank li{display:grid;grid-template-columns:1fr auto;gap:4px 12px;font-size:13px}
.rank-label{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.rank-bar{grid-column:1/-1;height:6px;border-radius:999px;background:var(--surface2);display:block;overflow:hidden}
.rank-bar i{display:block;height:100%;border-radius:999px;background:var(--s1)}
.funnel{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:14px}.funnel-head{display:flex;gap:10px;align-items:baseline;font-size:13px;margin-bottom:6px}
.funnel-head b{font-size:15px}.funnel-head em{margin-left:auto;font-style:normal;color:var(--ink2);font-size:12px}.funnel .rank-bar{height:10px}
.badge{display:inline-flex;align-items:center;height:22px;padding:0 9px;border-radius:999px;font-size:12px;font-weight:600;white-space:nowrap}
.b-ok{background:var(--okSoft);color:var(--okInk)}.b-warn{background:var(--warnSoft);color:var(--warnInk)}.b-bad{background:var(--badSoft);color:var(--badInk)}.b-info{background:var(--accentSoft);color:var(--accentInk)}.b-mute{background:var(--surface2);color:var(--ink2)}
table{width:100%;border-collapse:collapse;font-size:13px}th{text-align:left;font-weight:500;color:var(--ink2);font-size:12px;padding:8px 10px;border-bottom:1px solid var(--line);white-space:nowrap}
td{padding:11px 10px;border-bottom:1px solid var(--line);vertical-align:middle}tr:last-child td{border-bottom:0}tbody tr.link{cursor:pointer}tbody tr.link:hover td{background:var(--surface2)}
.table-wrap{overflow-x:auto;margin:0 -18px;padding:0 18px}.num{text-align:right;white-space:nowrap}.muted{color:var(--ink2)}.small{font-size:12px}.mono{font-family:ui-monospace,"Geist Mono",Menlo,monospace;font-size:12px}
.bar{display:flex;gap:8px;flex-wrap:wrap;align-items:center}.searchbox{display:flex;align-items:center;gap:8px;height:36px;padding:0 12px;border:1px solid var(--line);border-radius:10px;background:var(--surface);min-width:260px;flex:1;max-width:420px;color:var(--ink2)}
.searchbox input{border:0;outline:0;background:transparent;color:var(--ink);font:inherit;flex:1;min-width:0}
input,select,textarea{font:inherit;color:var(--ink);background:var(--bg);border:1px solid var(--line);border-radius:9px;padding:8px 10px;width:100%}
label{display:block;font-size:12.5px;color:var(--ink2);margin:10px 0 4px}
.btn{display:inline-flex;align-items:center;justify-content:center;gap:6px;height:36px;padding:0 14px;border-radius:9px;border:1px solid var(--line);background:var(--surface);color:var(--ink);font:inherit;font-weight:550;cursor:pointer;white-space:nowrap}
.btn:hover{background:var(--surface2);text-decoration:none}.btn.primary{background:var(--accent);border-color:var(--accent);color:#fff}.btn.danger{color:var(--badInk);border-color:color-mix(in srgb,var(--badInk) 40%,var(--line))}
.btn.small{height:30px;padding:0 10px;font-size:12.5px}.btn:disabled{opacity:.6;cursor:progress}
.actions{display:flex;flex-direction:column;gap:14px}.actions form{display:flex;flex-direction:column;gap:6px}.actions .row2{display:grid;grid-template-columns:1fr 1fr;gap:8px}
.actions h3{margin:0;font-size:13px;font-weight:600}.actions hr{border:0;border-top:1px solid var(--line);margin:4px 0;width:100%}
.tabs{display:flex;gap:4px;border-bottom:1px solid var(--line);margin:-4px 0 14px;overflow-x:auto}.tabs a{padding:8px 12px;color:var(--ink2);font-weight:500;border-bottom:2px solid transparent;white-space:nowrap}
.tabs a[aria-current=true]{color:var(--ink);border-color:var(--accent)}.tabs a:hover{text-decoration:none;color:var(--ink)}
.head{display:flex;align-items:center;gap:14px;flex-wrap:wrap}.avatar{width:48px;height:48px;border-radius:50%;background:var(--accentSoft);color:var(--accentInk);display:grid;place-items:center;font-size:19px;font-weight:650;flex:none}
.facts{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px}.facts div{background:var(--surface2);border-radius:10px;padding:10px 12px}.facts span{display:block;color:var(--ink2);font-size:12px}.facts b{font-size:15px}
.list{list-style:none;margin:0;padding:0}.list li{display:flex;gap:10px;align-items:center;padding:10px 0;border-bottom:1px solid var(--line);font-size:13px}.list li:last-child{border-bottom:0}.list .grow{flex:1;min-width:0}
.empty{display:flex;align-items:center;gap:10px;color:var(--ink2);font-size:13px;margin:4px 0}.empty img{width:36px;height:36px}
.pager{display:flex;gap:8px;align-items:center;justify-content:flex-end;margin-top:12px;font-size:12.5px;color:var(--ink2)}
.notice{display:flex;align-items:center;gap:10px;border-radius:10px;padding:10px 12px;font-size:13px}.notice img{width:28px;height:28px}.notice.ok{background:var(--okSoft);color:var(--okInk)}.notice.bad{background:var(--badSoft);color:var(--badInk)}.notice.info{background:var(--accentSoft);color:var(--accentInk)}
.secret{display:block;padding:10px;border-radius:9px;background:var(--surface2);word-break:break-all;margin-top:8px}
.toast{position:fixed;right:20px;bottom:20px;z-index:20;display:flex;align-items:center;gap:10px;padding:12px 16px;border-radius:12px;background:var(--ink);color:var(--bg);box-shadow:var(--shadow);font-weight:550;transition:opacity .3s,transform .3s}
.toast img{width:28px;height:28px}.toast.bad{background:var(--badInk);color:#fff}.toast.hide{opacity:0;transform:translateY(8px)}
dialog{border:1px solid var(--line);border-radius:16px;background:var(--surface);color:var(--ink);padding:0;width:min(520px,calc(100vw - 32px));box-shadow:var(--shadow)}dialog::backdrop{background:rgba(5,5,10,.45);backdrop-filter:blur(2px)}
.dlg{padding:20px;display:flex;flex-direction:column;gap:12px}.dlg h2{margin:0;font-size:16px}.dlg p{margin:0;color:var(--ink2)}.dlg .bar{justify-content:flex-end}
.palette{padding:0}.palette label{display:flex;align-items:center;gap:10px;margin:0;padding:14px 16px;border-bottom:1px solid var(--line);color:var(--ink2)}.palette input{border:0;background:transparent;outline:0;padding:0;font-size:15px}
.palette ul{list-style:none;margin:0;padding:8px;max-height:50vh;overflow:auto}.palette li a{display:flex;gap:10px;align-items:center;padding:9px 10px;border-radius:8px;color:var(--ink)}.palette li a:hover,.palette li a.on{background:var(--accentSoft);color:var(--accentInk);text-decoration:none}
@media (max-width:1100px){.k4{grid-template-columns:repeat(2,minmax(0,1fr))}.split{grid-template-columns:1fr}}
@media (max-width:760px){.app{grid-template-columns:1fr}.side{position:fixed;inset:auto 0 0 0;top:auto;height:auto;flex-direction:row;z-index:10;padding:6px;border-right:0;border-top:1px solid var(--line);overflow-x:auto}
.side .brand,.side .me,.nav.off,.nav .count,.nav .label{display:none}.nav{flex:1;justify-content:center;min-width:52px}.top{padding:12px 16px}.content{padding:16px 16px 96px}
.k4,.k3,.half{grid-template-columns:1fr}.searchbox{min-width:0;max-width:none}.tools .chip{height:30px;padding:0 10px}.donut{flex-direction:column;align-items:stretch}.donut svg{margin:0 auto}}
@media (prefers-reduced-motion:reduce){*{transition:none!important}}
`;

const THEME_BOOT = `try{var t=localStorage.getItem("delio-admin-theme");if(t)document.documentElement.dataset.theme=t}catch(e){}`;

const SCRIPT = `
(function(){
var root=document.documentElement;
document.querySelectorAll("[data-theme-toggle]").forEach(function(b){b.addEventListener("click",function(){
var dark=root.dataset.theme?root.dataset.theme==="dark":matchMedia("(prefers-color-scheme: dark)").matches;var next=dark?"light":"dark";root.dataset.theme=next;
try{localStorage.setItem("delio-admin-theme",next)}catch(e){}})});
var toast=document.querySelector(".toast");if(toast)setTimeout(function(){toast.classList.add("hide")},4500);
document.querySelectorAll("tr[data-href]").forEach(function(r){r.addEventListener("click",function(e){if(e.target.closest("a,button,form"))return;location.href=r.dataset.href})});
var palette=document.getElementById("palette"),input=palette&&palette.querySelector("input"),items=palette?[].slice.call(palette.querySelectorAll("li")):[];
function filter(){var q=input.value.trim().toLowerCase(),first=null;items.forEach(function(li){var a=li.querySelector("a");
if(li.dataset.search){a.href="/clients?q="+encodeURIComponent(input.value.trim());a.querySelector("span").textContent=q?"Chercher « "+input.value.trim()+" » dans les clients":"Chercher un client";li.hidden=false}
else li.hidden=q&&a.textContent.toLowerCase().indexOf(q)<0;a.classList.remove("on");if(!li.hidden&&!first)first=a});if(first)first.classList.add("on")}
function openPalette(){if(!palette)return;input.value="";filter();palette.showModal();input.focus()}
document.querySelectorAll("[data-palette]").forEach(function(b){b.addEventListener("click",openPalette)});
document.addEventListener("keydown",function(e){if((e.metaKey||e.ctrlKey)&&e.key.toLowerCase()==="k"){e.preventDefault();openPalette()}});
if(input){input.addEventListener("input",filter);input.addEventListener("keydown",function(e){var on=palette.querySelector("a.on");
var shown=items.filter(function(li){return!li.hidden}).map(function(li){return li.querySelector("a")});var i=shown.indexOf(on);
if(e.key==="Enter"&&on){e.preventDefault();location.href=on.href}
if(e.key==="ArrowDown"||e.key==="ArrowUp"){e.preventDefault();if(on)on.classList.remove("on");var n=shown[(i+(e.key==="ArrowDown"?1:shown.length-1))%shown.length];if(n)n.classList.add("on")}})}
var confirmDialog=document.getElementById("confirm");
document.querySelectorAll("form[data-confirm]").forEach(function(f){f.addEventListener("submit",function(e){
if(f.dataset.confirmed)return;e.preventDefault();var d=confirmDialog,typed=d.querySelector("[data-typed]"),field=d.querySelector("input");
d.querySelector("h2").textContent=f.dataset.confirm;d.querySelector("p").textContent=f.dataset.detail||"";
var expect=f.dataset.type||"";typed.hidden=!expect;field.value="";field.placeholder=expect;d.querySelector("[data-expect]").textContent=expect;
var go=d.querySelector("[data-go]");go.className="btn "+(f.dataset.danger?"danger":"primary");go.textContent=f.dataset.action||"Confirmer";
go.onclick=function(){if(expect&&field.value.trim()!==expect){field.focus();return}if(expect){var h=f.querySelector("input[name=confirm]");if(h)h.value=field.value.trim()}
d.close();f.dataset.confirmed="1";f.requestSubmit()};d.showModal();if(expect)field.focus()})});
document.querySelectorAll("[data-close]").forEach(function(b){b.addEventListener("click",function(){b.closest("dialog").close()})});
document.querySelectorAll("form").forEach(function(f){f.addEventListener("submit",function(){if(f.dataset.confirm&&!f.dataset.confirmed)return;
var b=f.querySelector("button[type=submit],button:not([type])");if(b)setTimeout(function(){b.disabled=true},0)})});
})();`;

export interface Flash { kind: "ok" | "bad"; text: string }

export function consolePage(input: { title: string; subtitle?: string; section: ConsoleSection; email: string; body: Html; nonce: string; period?: Period;
  periodPath?: string; flash?: Flash | null; pendingOrders?: number; tools?: Html }): string {
  const nav = NAV.map(([id, label, href]) => href
    ? h`<a class="nav" href="${href}" ${id === input.section ? raw('aria-current="page"') : ""} title="${label}">${icon(id)}<span class="label">${label}</span>
${id === "orders" && input.pendingOrders ? h`<span class="count">${input.pendingOrders}</span>` : ""}</a>`
    : h`<span class="nav off" title="${label} : bientôt">${icon(id)}<span class="label">${label}</span><span class="soon">bientôt</span></span>`);
  const periods = input.period ? PERIODS.map(([id, label]) => h`<a class="chip" href="${input.periodPath ?? ""}?p=${id}" ${id === input.period!.id ? raw('aria-current="true"') : ""}>${label}</a>`) : [];
  const flash = input.flash ? h`<div class="toast ${input.flash.kind === "bad" ? "bad" : ""}" role="status"><img src="/assets/delio-${input.flash.kind === "bad" ? "sad" : "happy"}.webp" alt="">${input.flash.text}</div>` : "";
  const commands = NAV.filter(([, , href]) => href).map(([id, label, href]) => h`<li><a href="${href}">${icon(id, 16)}<span>${label}</span></a></li>`);
  return `<!doctype html>${h`<html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex">
<title>${input.title} · Delio Admin</title><link rel="icon" href="/assets/delio-idle.webp"><script nonce="${input.nonce}">${raw(THEME_BOOT)}</script><style>${raw(STYLE)}</style></head>
<body><div class="app"><aside class="side"><div class="brand"><img src="/assets/delio-idle.webp" alt="">Delio Admin</div>${nav}
<div class="me"><span title="${input.email}">${input.email}</span><form method="post" action="/logout"><button class="iconbtn" title="Se déconnecter" aria-label="Se déconnecter">${icon("out", 16)}</button></form></div></aside>
<div class="main"><header class="top"><div><h1>${input.title}</h1>${input.subtitle ? h`<p>${input.subtitle}</p>` : ""}</div>
<div class="tools">${periods}${input.tools ?? ""}<button class="iconbtn" type="button" data-palette title="Rechercher (Ctrl+K)">${icon("search", 16)}<kbd>Ctrl K</kbd></button>
<button class="iconbtn" type="button" data-theme-toggle title="Thème clair ou sombre" aria-label="Thème clair ou sombre">${icon("theme", 16)}</button></div></header>
<div class="content">${input.body}</div></div></div>${flash}
<dialog id="palette" class="palette"><label>${icon("search")}<span hidden>Rechercher</span><input placeholder="Aller à une page ou chercher un client…" autocomplete="off"><kbd>Échap</kbd></label>
<ul>${commands}<li data-search><a href="/clients">${icon("clients", 16)}<span>Chercher un client</span></a></li></ul></dialog>
<dialog id="confirm"><div class="dlg"><h2></h2><p></p><div data-typed hidden><label>Pour confirmer, tapez <b data-expect></b></label><input autocomplete="off"></div>
<div class="bar"><button type="button" class="btn" data-close>Annuler</button><button type="button" class="btn primary" data-go>Confirmer</button></div></div></dialog>
<script nonce="${input.nonce}">${raw(SCRIPT)}</script></body></html>`.html}`;
}

const nf = new Intl.NumberFormat("fr-FR");
export const n = (value: number, digits = 0) => new Intl.NumberFormat("fr-FR", { maximumFractionDigits: digits, minimumFractionDigits: 0 }).format(value);
export const usd = (value: number) => `${new Intl.NumberFormat("fr-FR", { maximumFractionDigits: value < 100 ? 2 : 0 }).format(value)} $`;
export const francs = (value: number) => `${nf.format(Math.round(value))} FCFA`;
const dateFmt = new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
const timeFmt = new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "UTC" });
export const date = (at: number | null | undefined) => at ? dateFmt.format(new Date(at)) : "—";

export function ago(at: number | null | undefined, now: number): string {
  if (!at) return "jamais";
  const minutes = Math.round((now - at) / 60_000);
  if (minutes < 1) return "à l'instant";
  if (minutes < 60) return `il y a ${minutes} min`;
  if (minutes < 24 * 60) return `il y a ${Math.round(minutes / 60)} h`;
  if (minutes < 7 * 24 * 60) return `il y a ${Math.round(minutes / 1440)} j`;
  return `${timeFmt.format(new Date(at))} UTC`;
}

export type BadgeKind = "ok" | "warn" | "bad" | "info" | "mute";
export const badge = (kind: BadgeKind, text: string) => h`<span class="badge b-${kind}">${text}</span>`;

function trendTag(value: number | null): Html {
  if (value === null) return h`<span>—</span>`;
  return value >= 0 ? h`<span class="up">▲ ${value} %</span>` : h`<span class="down">▼ ${Math.abs(value)} %</span>`;
}

export function kpi(label: string, value: string, sub: string, trendValue?: number | null, spark?: readonly number[]): Html {
  return h`<div class="card kpi"><div class="label">${label}</div><div class="value">${value}</div>
<div class="sub">${trendValue !== undefined ? trendTag(trendValue) : ""}<span>${sub}</span></div>${spark ? sparkline(spark) : ""}</div>`;
}

const empty = (text: string) => h`<p class="empty"><img src="/assets/delio-curious.webp" alt="">${text}</p>`;

export const PLAN_COLORS: Record<PlanId, string> = { trial: "var(--s4)", starter: "var(--s3)", pro: "var(--s1)", max: "var(--s2)", byok: "var(--s5)" };

export function subscriptionBadge(subscription: Subscription, suspended: boolean): Html {
  if (suspended) return badge("bad", "Suspendu");
  const name = PLANS[subscription.plan]?.name ?? subscription.plan;
  switch (subscription.status) {
    case "active": return badge("ok", `${name} · actif`);
    case "trialing": return badge("info", "Essai en cours");
    case "grace": return badge("warn", `${name} · délai de grâce`);
    case "expired": return badge("mute", `${name} · expiré`);
    default: return badge("mute", "Sans forfait");
  }
}

export function orderBadge(order: Pick<Order, "status" | "id">): Html {
  if (order.id.startsWith(MANUAL_ORDER_PREFIX)) return badge("info", "Offert");
  return order.status === "paid" ? badge("ok", "Payée") : order.status === "failed" ? badge("bad", "Échouée") : badge("warn", "En attente");
}

export const orderWhat = (order: Pick<Order, "kind" | "plan" | "cycle" | "credits">) => order.kind === "plan" && order.plan
  ? `${PLANS[order.plan]?.name ?? order.plan}${order.plan !== "trial" ? order.cycle === "year" ? " · annuel" : " · mensuel" : ""}`
  : `Recharge ${nf.format(order.credits)} crédits`;

const ACTIONS: Record<string, string> = {
  "workspace.create": "Espace créé", "workspace.delete": "Espace supprimé", "workspace.suspend": "Espace suspendu", "workspace.resume": "Espace réactivé",
  "workspace.signin": "Connexion à l'espace", "account.signin": "Connexion au portail", "account.block": "Compte bloqué", "account.unblock": "Compte débloqué",
  "member.add": "Membre ajouté", "member.role": "Rôle changé", "member.remove": "Membre retiré", "invitation.create": "Invitation envoyée", "invitation.cancel": "Invitation annulée",
  "credits.add": "Crédits ajustés", "gateway.token": "Jeton de passerelle créé", "device.revoke": "Appareil révoqué", "device.approve": "Appareil connecté",
  "plan.grant": "Forfait offert", "order.paid": "Commande marquée payée", "order.recheck": "Commande revérifiée", "sso.set": "SSO configuré", "sso.remove": "SSO retiré",
  "billing.checkout": "Paiement ouvert", "hosting.retry": "Hébergement relancé",
};
export const actionLabel = (action: string) => ACTIONS[action] ?? action;

export interface DashboardData {
  period: Period; now: number;
  revenue: { usd: number; francs: number; orders: number }; revenuePrevious: number;
  signups: number; signupsPrevious: number; costUsd: number; costPrevious: number; credits: number;
  visitors: number; visitorsPrevious: number;
  active: Array<{ plan: PlanId; count: number }>; conversion: { trials: number; converted: number; rate: number | null };
  series: { revenue: number[]; cost: number[]; signups: number[]; visitors: number[] };
  providers: Array<{ provider: string; credits: number; costUsd: number }>;
  watch: { pending: number; ending: Array<{ workspace: string; plan: string; periodEnd: number }>; lowBalance: Array<{ workspace: string; credits: number }> };
  activity: Array<{ workspace: string | null; actor: string | null; action: string; target: string | null; at: number }>;
}

const PROVIDERS: Record<string, string> = { openrouter: "OpenRouter (texte)", fal: "fal (images, vidéo)", boat: "Boat (ordinateurs)" };

export function dashboardPage(data: DashboardData): Html {
  const margin = data.revenue.usd - data.costUsd;
  const paying = data.active.filter((item) => item.plan !== "trial").reduce((sum, item) => sum + item.count, 0);
  const trials = data.active.find((item) => item.plan === "trial")?.count ?? 0;
  const days = data.period.days;
  const watchItems = [
    ...(data.watch.pending ? [h`<li>${badge("warn", "Paiement")}<span class="grow"><a href="/commandes?statut=pending">${data.watch.pending} commande${data.watch.pending > 1 ? "s" : ""} en attente</a></span></li>`] : []),
    ...data.watch.ending.map((item) => h`<li>${badge("info", "Échéance")}<span class="grow"><a href="/clients/${item.workspace}">${item.workspace}</a> · ${PLANS[item.plan as PlanId]?.name ?? item.plan} se termine le ${date(item.periodEnd)}</span></li>`),
    ...data.watch.lowBalance.map((item) => h`<li>${badge("bad", "Crédits")}<span class="grow"><a href="/clients/${item.workspace}">${item.workspace}</a> n'a plus que ${n(item.credits)} crédits</span></li>`),
  ];
  return h`<div class="grid k4">
${kpi("Revenus", usd(data.revenue.usd), `${francs(data.revenue.francs)} · ${data.revenue.orders} paiement${data.revenue.orders > 1 ? "s" : ""}`, trendOf(data.revenue.usd, data.revenuePrevious), data.series.revenue)}
${kpi("Marge (revenus − coût IA)", usd(margin), `coût IA ${usd(data.costUsd)}`, trendOf(margin, data.revenuePrevious - data.costPrevious), data.series.revenue.map((value, index) => value - (data.series.cost[index] ?? 0)))}
${kpi("Abonnés payants", n(paying), `${trials} essai${trials > 1 ? "s" : ""} en cours · conversion ${data.conversion.rate === null ? "—" : `${data.conversion.rate} %`}`)}
${kpi("Nouveaux inscrits", n(data.signups), `${n(data.visitors)} visiteurs sur le site`, trendOf(data.signups, data.signupsPrevious), data.series.visitors)}
</div>
<div class="grid split"><section class="card"><h2>Revenus et coût IA par jour<small>en dollars · survolez une barre</small></h2>
${barChart(days, [{ name: "Revenus", color: "var(--s1)", values: data.series.revenue }, { name: "Coût IA", color: "var(--s2)", values: data.series.cost }], usd, "Revenus et coût IA par jour")}</section>
<section class="card"><h2>Abonnements actifs</h2>${donut(data.active.map((item) => ({ label: PLANS[item.plan].name, value: item.count, color: PLAN_COLORS[item.plan] })),
  n(paying + trials), "actifs")}</section></div>
<div class="grid split"><section class="card"><h2>Inscriptions par jour<small><a href="/trafic">Voir le trafic</a></small></h2>
${barChart(days, [{ name: "Inscriptions", color: "var(--s3)", values: data.series.signups }], (value) => n(value), "Inscriptions par jour")}</section>
<section class="card"><h2>Consommation IA<small>${n(data.credits)} crédits</small></h2>
${ranking(data.providers.map((item) => ({ label: PROVIDERS[item.provider] ?? item.provider, value: Math.round(item.credits), hint: `${n(item.credits)} crédits · ${usd(item.costUsd)}` })), "Aucune consommation sur la période.")}</section></div>
<div class="grid half"><section class="card"><h2>À surveiller</h2>${watchItems.length ? h`<ul class="list">${watchItems}</ul>` : empty("Rien à signaler. Tout va bien.")}</section>
<section class="card"><h2>Activité récente<small><a href="/journal">Tout le journal</a></small></h2>${activityList(data.activity, data.now)}</section></div>`;
}

const trendOf = (value: number, previous: number) => previous > 0 ? Math.round(((value - previous) / previous) * 100) : null;

function activityList(rows: DashboardData["activity"], now: number): Html {
  if (rows.length === 0) return empty("Aucune action pour l'instant.");
  return h`<ul class="list">${rows.map((row) => h`<li><span class="grow"><b>${actionLabel(row.action)}</b>${row.workspace ? h` · <a href="/clients/${row.workspace}">${row.workspace}</a>` : ""}
<span class="muted small"> · ${row.actor ?? "système"}</span></span><span class="muted small">${ago(row.at, now)}</span></li>`)}</ul>`;
}

export interface TrafficData {
  period: Period;
  daily: { visitors: number[] };
  stats: ReturnType<Metrics["traffic"]>;
  previousVisitors: number;
}

export function trafficPage(data: TrafficData): Html {
  const s = data.stats;
  const list = (rows: Array<{ label: string; visitors: number; views: number }>, emptyText: string, rename?: (label: string) => string) =>
    ranking(rows.map((row) => ({ label: rename ? rename(row.label) : row.label, value: row.visitors, hint: `${n(row.visitors)} visiteurs · ${n(row.views)} pages vues` })), emptyText);
  const country = (code: string) => { try { return new Intl.DisplayNames(["fr"], { type: "region" }).of(code) ?? code; } catch { return code; } };
  return h`<div class="grid k4">
${kpi("Visiteurs uniques", n(s.visitors), "deliobot.fun, par jour", trendOf(s.visitors, data.previousVisitors), data.daily.visitors)}
${kpi("Pages vues", n(s.views), `${s.visitors ? n(s.views / s.visitors, 1) : 0} par visiteur`)}
${kpi("Téléchargements", n(s.downloads), "installateur, ZIP, .deb, AppImage")}
${kpi("En ce moment", n(s.now), `visiteurs ces 5 dernières minutes · ${n(s.apps)} applis actives (7 j)`)}
</div>
<section class="card"><h2>Visiteurs par jour<small>sans cookie · un visiteur = une personne par jour</small></h2>
${barChart(data.period.days, [{ name: "Visiteurs", color: "var(--s1)", values: data.daily.visitors }], (value) => n(value), "Visiteurs par jour", 1180)}</section>
<div class="grid split"><section class="card"><h2>Entonnoir de conversion<small>sur la période</small></h2>${funnel(s.funnel)}</section>
<section class="card"><h2>Provenance</h2>${list(s.sources, "Aucune visite sur la période.")}</section></div>
<div class="grid k3"><section class="card"><h2>Pages les plus vues</h2>${list(s.pages, "Aucune page vue.")}</section>
<section class="card"><h2>Pays</h2>${list(s.countries, "Pays inconnus.", country)}</section>
<section class="card"><h2>Villes</h2>${list(s.cities, "Villes inconnues.")}</section></div>
<div class="grid k3"><section class="card"><h2>Appareils</h2>${list(s.devices, "Aucun appareil.", (label) => label[0]!.toUpperCase() + label.slice(1))}</section>
<section class="card"><h2>Systèmes</h2>${list(s.systems, "Aucun système.")}</section>
<section class="card"><h2>Téléchargements par plateforme</h2>${list(s.downloadsByPlatform, "Aucun téléchargement sur la période.")}</section></div>`;
}

export interface ClientRow {
  slug: string; name: string; owner: string | null; createdAt: number; subscription: Subscription; suspended: boolean; credits: number; lastPaid: number | null; paidUsd: number;
}

export const CLIENT_FILTERS: ReadonlyArray<[string, string]> = [["all", "Tous"], ["active", "Payants"], ["trialing", "Essai"], ["grace", "Délai de grâce"], ["expired", "Expirés"], ["none", "Sans forfait"], ["suspended", "Suspendus"]];

export function clientsPage(input: { rows: ClientRow[]; total: number; q: string; filter: string; page: number; pages: number; now: number }): Html {
  const query = (extra: Record<string, string | number>) => `?${new URLSearchParams({ ...(input.q ? { q: input.q } : {}), ...(input.filter !== "all" ? { filtre: input.filter } : {}),
    ...Object.fromEntries(Object.entries(extra).map(([key, value]) => [key, String(value)])) })}`;
  return h`<section class="card"><form class="bar" method="get" action="/clients" style="margin-bottom:14px">
<label class="searchbox">${icon("search", 16)}<span hidden>Rechercher</span><input name="q" value="${input.q}" placeholder="E-mail, nom ou identifiant…" type="search"></label>
${input.filter !== "all" ? h`<input type="hidden" name="filtre" value="${input.filter}">` : ""}<button class="btn">Rechercher</button></form>
<div class="bar" style="margin-bottom:10px">${CLIENT_FILTERS.map(([id, label]) => h`<a class="chip" href="/clients?${new URLSearchParams({ ...(input.q ? { q: input.q } : {}), ...(id !== "all" ? { filtre: id } : {}) })}" ${id === input.filter ? raw('aria-current="true"') : ""}>${label}</a>`)}</div>
${input.rows.length === 0 ? empty(input.q ? `Aucun client ne correspond à « ${input.q} ».` : "Aucun client pour l'instant.") : h`<div class="table-wrap"><table><thead><tr><th>Client</th><th>Forfait</th>
<th class="num">Crédits</th><th class="num">Payé au total</th><th>Dernier paiement</th><th>Inscrit le</th></tr></thead><tbody>
${input.rows.map((row) => h`<tr class="link" data-href="/clients/${row.slug}"><td><a href="/clients/${row.slug}"><b>${row.name}</b></a><div class="muted small">${row.owner ?? "—"} · ${row.slug}</div></td>
<td>${subscriptionBadge(row.subscription, row.suspended)}</td><td class="num">${n(row.credits)}</td><td class="num">${usd(row.paidUsd)}</td>
<td class="muted">${row.lastPaid ? ago(row.lastPaid, input.now) : "—"}</td><td class="muted">${date(row.createdAt)}</td></tr>`)}</tbody></table></div>`}
<div class="pager">${input.total} client${input.total > 1 ? "s" : ""}${input.pages > 1 ? h` · page ${input.page} sur ${input.pages}
${input.page > 1 ? h`<a class="btn small" href="/clients${query({ page: input.page - 1 })}">Précédente</a>` : ""}
${input.page < input.pages ? h`<a class="btn small" href="/clients${query({ page: input.page + 1 })}">Suivante</a>` : ""}` : ""}</div></section>`;
}

export interface ClientDetail {
  slug: string; name: string; tenantUrl: string; createdAt: number; subscription: Subscription; suspension: { reason: string | null; at: number } | null;
  members: Array<{ accountId: string; email: string; role: string; joinedAt: number; blocked: boolean; operator: boolean }>;
  credits: number; usedThisMonth: number; ledger: LedgerRow[]; orders: Order[]; devices: DeviceRow[]; audit: Array<{ actor: string | null; action: string; target: string | null; at: number }>;
  hosted: boolean; hasToken: boolean; token?: string;
}

const TABS: ReadonlyArray<[string, string]> = [["apercu", "Aperçu"], ["credits", "Crédits"], ["commandes", "Commandes"], ["appareils", "Applications"], ["journal", "Journal"]];
const LEDGER_KINDS: Record<string, string> = { grant: "Crédits du forfait", topup: "Recharge", usage: "Consommation", refund: "Remboursement", adjust: "Ajustement" };

export function clientPage(c: ClientDetail, tab: string, now: number): Html {
  const current = TABS.some(([id]) => id === tab) ? tab : "apercu";
  const owner = c.members.find((member) => member.role === "admin");
  const facts = h`<div class="facts"><div><span>Forfait</span><b>${subscriptionBadge(c.subscription, Boolean(c.suspension))}</b></div>
<div><span>Échéance</span><b>${c.subscription.periodEnd ? date(c.subscription.periodEnd) : "—"}</b></div>
<div><span>Crédits restants</span><b>${n(c.credits)}</b></div><div><span>Consommés ce mois</span><b>${n(c.usedThisMonth)}</b></div>
<div><span>Payé au total</span><b>${usd(c.orders.filter((order) => order.status === "paid").reduce((sum, order) => sum + order.usd, 0))}</b></div>
<div><span>Inscrit le</span><b>${date(c.createdAt)}</b></div></div>`;
  const body = current === "credits" ? ledgerTable(c.ledger, now)
    : current === "commandes" ? ordersTable(c.orders, now, false)
    : current === "appareils" ? devicesList(c, now)
    : current === "journal" ? auditTable(c.audit.map((row) => ({ ...row, workspace: null })), now)
    : h`${facts}${c.suspension ? h`<div class="notice bad" style="margin-top:14px">Espace suspendu ${ago(c.suspension.at, now)}${c.suspension.reason ? ` : ${c.suspension.reason}` : ""}. L'IA Delio est coupée, les données restent.</div>` : ""}
<h2 style="margin:20px 0 8px">Membres</h2><ul class="list">${c.members.map((member) => h`<li><span class="grow"><b>${member.email}</b> <span class="muted small">· ${member.role === "admin" ? "administrateur" : "membre"} depuis ${date(member.joinedAt)}</span></span>
${member.blocked ? badge("bad", "Bloqué") : ""}${member.operator ? badge("info", "Opérateur") : h`<form method="post" action="/clients/${c.slug}/bloquer" data-confirm="${member.blocked ? `Débloquer ${member.email} ?` : `Bloquer ${member.email} ?`}"
  data-detail="${member.blocked ? "Ce compte pourra de nouveau se connecter." : "Ce compte ne pourra plus se connecter ; ses sessions et ses applications connectées sont coupées."}" ${member.blocked ? "" : raw('data-danger="1"')} data-action="${member.blocked ? "Débloquer" : "Bloquer"}">
<input type="hidden" name="account" value="${member.accountId}"><input type="hidden" name="blocked" value="${member.blocked ? "0" : "1"}"><button class="btn small ${member.blocked ? "" : "danger"}">${member.blocked ? "Débloquer" : "Bloquer"}</button></form>`}</li>`)}</ul>
<p class="small"><a href="/people?workspace=${c.slug}">Gérer les membres et les invitations</a></p>
<h2 style="margin:20px 0 8px">Dernières commandes</h2>${ordersTable(c.orders.slice(0, 5), now, false)}`;
  const planOptions = Object.values(PLANS).map((plan) => h`<option value="${plan.id}" ${plan.id === "pro" ? raw("selected") : ""}>${plan.name} — ${plan.gateway ? `${n(plan.credits)} crédits` : "ses propres clés"}</option>`);
  const actions = h`<aside class="card actions"><h2>Actions</h2>
${c.token ? h`<div class="notice info">Copiez ce jeton maintenant, il ne sera plus affiché :<code class="secret mono">${c.token}</code></div>` : ""}
<form method="post" action="/clients/${c.slug}/credits" data-confirm="Modifier les crédits de ${c.name} ?" data-detail="Un nombre négatif en retire. L'opération est inscrite au journal." data-action="Valider">
<h3>Ajouter ou retirer des crédits</h3><div class="row2"><input name="credits" type="number" step="1" required placeholder="1000 ou -500" aria-label="Crédits"><input name="note" maxlength="200" placeholder="Motif (facultatif)" aria-label="Motif"></div>
<button class="btn">Valider</button></form><hr>
<form method="post" action="/clients/${c.slug}/forfait" data-confirm="Offrir ce forfait à ${c.name} ?" data-detail="Comme un vrai paiement : crédits du forfait et échéance prolongée. Visible dans les commandes, à 0 $." data-action="Offrir">
<h3>Offrir ou prolonger un forfait</h3><div class="row2"><select name="plan" aria-label="Forfait">${planOptions}</select><select name="cycle" aria-label="Durée"><option value="month">1 mois</option><option value="year">1 an</option></select></div>
<button class="btn">Offrir</button></form><hr>
${c.suspension
  ? h`<form method="post" action="/clients/${c.slug}/suspendre" data-confirm="Réactiver ${c.name} ?" data-detail="Ses applications pourront de nouveau utiliser l'IA Delio." data-action="Réactiver"><h3>Suspension</h3><input type="hidden" name="suspended" value="0"><button class="btn">Réactiver l'espace</button></form>`
  : h`<form method="post" action="/clients/${c.slug}/suspendre" data-confirm="Suspendre ${c.name} ?" data-detail="L'IA Delio s'arrête pour cet espace ; ses données et ses crédits restent." data-danger="1" data-action="Suspendre">
<h3>Suspendre l'espace</h3><input type="hidden" name="suspended" value="1"><input name="reason" maxlength="200" placeholder="Motif (facultatif)" aria-label="Motif"><button class="btn danger">Suspendre</button></form>`}<hr>
<form method="post" action="/clients/${c.slug}/jeton" data-confirm="Créer un nouveau jeton de passerelle ?" data-detail="${c.hasToken ? "L'ancien jeton cessera de fonctionner." : "Il permet d'utiliser les crédits de cet espace hors de l'application."}" data-action="Créer">
<h3>Jeton de passerelle</h3><button class="btn">${c.hasToken ? "Remplacer le jeton" : "Créer un jeton"}</button></form><hr>
<form method="post" action="/clients/${c.slug}/supprimer" data-confirm="Supprimer définitivement ${c.name} ?" data-detail="${c.hosted ? "Cet espace est hébergé : arrêtez d'abord son hébergement." : "Membres, crédits, forfait et applications connectées sont effacés. Les commandes et le journal restent."}"
  data-type="${c.slug}" data-danger="1" data-action="Supprimer"><h3>Supprimer l'espace</h3><input type="hidden" name="confirm" value=""><button class="btn danger" ${c.hosted ? raw("disabled") : ""}>Supprimer</button></form></aside>`;
  return h`<div class="card head"><span class="avatar">${(c.name[0] ?? "?").toUpperCase()}</span><div style="flex:1;min-width:0"><h2 style="margin:0;font-size:18px">${c.name}</h2>
<div class="muted small">${owner?.email ?? "sans administrateur"} · <span class="mono">${c.slug}</span>${c.hosted ? h` · <a href="${c.tenantUrl}">${c.tenantUrl}</a>` : ""}</div></div>
<a class="btn small" href="/clients">← Tous les clients</a></div>
<div class="grid split"><section class="card"><nav class="tabs">${TABS.map(([id, label]) => h`<a href="/clients/${c.slug}?onglet=${id}" ${id === current ? raw('aria-current="true"') : ""}>${label}</a>`)}</nav>${body}</section>${actions}</div>`;
}

function ledgerTable(rows: LedgerRow[], now: number): Html {
  if (rows.length === 0) return empty("Aucun mouvement de crédits.");
  return h`<div class="table-wrap"><table><thead><tr><th>Quand</th><th>Mouvement</th><th>Détail</th><th class="num">Crédits</th></tr></thead><tbody>
${rows.map((row) => h`<tr><td class="muted">${ago(row.at, now)}</td><td>${LEDGER_KINDS[row.kind] ?? row.kind}</td><td class="muted small">${row.provider ? `${row.provider} · ${row.model ?? ""}` : row.note ?? ""}</td>
<td class="num ${row.delta < 0 ? "down" : "up"}">${row.delta > 0 ? "+" : ""}${n(row.delta / 1_000_000, 2)}</td></tr>`)}</tbody></table></div>`;
}

function devicesList(c: ClientDetail, now: number): Html {
  if (c.devices.length === 0) return empty("Aucune application connectée à cet espace.");
  return h`<ul class="list">${c.devices.map((device) => h`<li><span class="grow"><b>${device.label}</b><div class="muted small">connectée le ${date(device.createdAt)} · dernière activité ${ago(device.lastUsedAt, now)}</div></span>
<form method="post" action="/clients/${c.slug}/appareil" data-confirm="Déconnecter « ${device.label} » ?" data-detail="Cette application devra être reconnectée pour utiliser les crédits." data-danger="1" data-action="Déconnecter">
<input type="hidden" name="device" value="${device.id}"><button class="btn small danger">Déconnecter</button></form></li>`)}</ul>`;
}

export function ordersTable(orders: Order[], now: number, withClient: boolean, actions = false): Html {
  if (orders.length === 0) return empty("Aucune commande.");
  return h`<div class="table-wrap"><table><thead><tr><th>Date</th>${withClient ? h`<th>Client</th>` : ""}<th>Achat</th><th class="num">Montant</th><th>Statut</th>${actions ? h`<th></th>` : ""}</tr></thead><tbody>
${orders.map((order) => h`<tr><td class="muted">${ago(order.createdAt, now)}</td>${withClient ? h`<td><a href="/clients/${order.workspace}">${order.workspace}</a><div class="muted small">${order.email}</div></td>` : ""}
<td>${orderWhat(order)}<div class="muted small mono">${order.id}</div></td>
<td class="num">${order.usd > 0 ? h`${usd(order.usd)}<div class="muted small">${order.currency === "XOF" || order.currency === "XAF" ? francs(Number(order.amount)) : `${order.amount} ${order.currency}`}</div>` : "0 $"}</td>
<td>${orderBadge(order)}</td>${actions ? h`<td class="num">${order.status !== "paid" ? h`<div class="bar" style="justify-content:flex-end">
${order.sessionId ? h`<form method="post" action="/commandes/${order.id}/verifier"><button class="btn small">Revérifier chez SasPay</button></form>` : ""}
<form method="post" action="/commandes/${order.id}/payee" data-confirm="Marquer ${order.id} comme payée ?" data-detail="Les crédits et le forfait sont appliqués tout de suite. À faire seulement si vous avez reçu l'argent." data-action="Marquer payée">
<button class="btn small">Marquer payée</button></form></div>` : ""}</td>` : ""}</tr>`)}</tbody></table></div>`;
}

export const ORDER_FILTERS: ReadonlyArray<[string, string]> = [["all", "Toutes"], ["paid", "Payées"], ["pending", "En attente"], ["failed", "Échouées"]];

export function ordersPage(input: { orders: Order[]; filter: string; q: string; now: number; totals: { paidUsd: number; paidFrancs: number; paid: number; pending: number; failed: number } }): Html {
  return h`<div class="grid k4">${kpi("Encaissé", usd(input.totals.paidUsd), francs(input.totals.paidFrancs))}${kpi("Payées", n(input.totals.paid), "commandes")}
${kpi("En attente", n(input.totals.pending), "le client n'a pas fini de payer")}${kpi("Échouées ou expirées", n(input.totals.failed), "commandes")}</div>
<section class="card"><form class="bar" method="get" action="/commandes" style="margin-bottom:14px"><label class="searchbox">${icon("search", 16)}<span hidden>Rechercher</span>
<input name="q" type="search" value="${input.q}" placeholder="Client, e-mail ou numéro de commande…"></label>${input.filter !== "all" ? h`<input type="hidden" name="statut" value="${input.filter}">` : ""}<button class="btn">Rechercher</button></form>
<div class="bar" style="margin-bottom:10px">${ORDER_FILTERS.map(([id, label]) => h`<a class="chip" href="/commandes?${new URLSearchParams({ ...(input.q ? { q: input.q } : {}), ...(id !== "all" ? { statut: id } : {}) })}" ${id === input.filter ? raw('aria-current="true"') : ""}>${label}</a>`)}</div>
${ordersTable(input.orders, input.now, true, true)}</section>`;
}

export function auditTable(rows: Array<{ workspace: string | null; actor: string | null; action: string; target: string | null; at: number }>, now: number): Html {
  if (rows.length === 0) return empty("Le journal est vide.");
  return h`<div class="table-wrap"><table><thead><tr><th>Quand</th><th>Action</th><th>Espace</th><th>Par</th><th>Détail</th></tr></thead><tbody>
${rows.map((row) => h`<tr><td class="muted">${ago(row.at, now)}</td><td><b>${actionLabel(row.action)}</b></td><td>${row.workspace ? h`<a href="/clients/${row.workspace}">${row.workspace}</a>` : "—"}</td>
<td class="muted">${row.actor ?? "système"}</td><td class="muted small mono">${row.target ?? ""}</td></tr>`)}</tbody></table></div>`;
}

export function journalPage(input: { rows: Array<{ workspace: string | null; actor: string | null; action: string; target: string | null; at: number }>; q: string; page: number; more: boolean; now: number }): Html {
  return h`<section class="card"><form class="bar" method="get" action="/journal" style="margin-bottom:14px"><label class="searchbox">${icon("search", 16)}<span hidden>Rechercher</span>
<input name="q" type="search" value="${input.q}" placeholder="Espace, e-mail ou action…"></label><button class="btn">Filtrer</button></form>
${auditTable(input.rows, input.now)}<div class="pager">${input.page > 1 ? h`<a class="btn small" href="/journal?${new URLSearchParams({ q: input.q, page: String(input.page - 1) })}">Plus récent</a>` : ""}
${input.more ? h`<a class="btn small" href="/journal?${new URLSearchParams({ q: input.q, page: String(input.page + 1) })}">Plus ancien</a>` : ""}</div></section>`;
}

