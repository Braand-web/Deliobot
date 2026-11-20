import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, extname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const NO_DECIMALS = new Set(["XOF", "XAF", "GNF", "JPY", "KRW", "RWF", "BIF", "DJF", "KMF", "UGX", "VND"]);
const IMAGE_TYPES = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif", ".avif", ".svg"]);

const TEXT = {
  fr: { all: "Tout", add: "Ajouter", soldOut: "Épuisé", cart: "Panier", empty: "Votre panier est vide.", total: "Total", order: "Commander sur WhatsApp",
    orderMail: "Commander par e-mail", pay: "Payer", close: "Fermer", delivery: "Livraison", payment: "Paiement", hello: "Bonjour, je souhaite commander :",
    name: "Nom", phone: "Téléphone", address: "Adresse de livraison", contact: "Vos coordonnées", search: "Rechercher un produit", qty: "Quantité", remove: "Retirer", added: "Ajouté au panier" },
  en: { all: "All", add: "Add", soldOut: "Sold out", cart: "Cart", empty: "Your cart is empty.", total: "Total", order: "Order on WhatsApp",
    orderMail: "Order by e-mail", pay: "Pay", close: "Close", delivery: "Delivery", payment: "Payment", hello: "Hello, I would like to order:",
    name: "Name", phone: "Phone", address: "Delivery address", contact: "Your details", search: "Search a product", qty: "Quantity", remove: "Remove", added: "Added to cart" },
};

const escape = (text) => String(text ?? "").replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
/** JSON placed inside a script element: "<" is escaped so no value can close the element. */
const scriptJson = (value) => JSON.stringify(value).replace(/</g, "\\u003c").replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
const slug = (text) => String(text).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "item";

export function whatsappNumber(value) {
  const digits = String(value ?? "").replace(/[^\d]/g, "");
  return digits.length >= 8 && digits.length <= 15 ? digits : null;
}

const safeLink = (value) => {
  if (!value) return null;
  try {
    const url = new URL(String(value));
    return url.protocol === "https:" ? url.href : null;
  } catch {
    return null;
  }
};

export function readCatalog(raw) {
  const errors = [];
  if (!String(raw.name ?? "").trim()) errors.push("name is required");
  const currency = String(raw.currency ?? "XOF").toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) errors.push("currency must be a 3-letter code such as XOF, EUR or USD");
  const whatsapp = raw.whatsapp ? whatsappNumber(raw.whatsapp) : null;
  if (raw.whatsapp && !whatsapp) errors.push("whatsapp must be the full international number, such as +221 77 123 45 67");
  if (!whatsapp && !raw.email && !(raw.products ?? []).some((p) => safeLink(p.payLink))) errors.push("give whatsapp, email or a payLink per product, so customers can order");
  if (!Array.isArray(raw.products) || !raw.products.length) errors.push("products must list at least one product");
  const seen = new Set();
  const products = (raw.products ?? []).map((product, index) => {
    const price = Number(product.price);
    if (!String(product.name ?? "").trim()) errors.push(`products[${index}].name is required`);
    if (!Number.isFinite(price) || price < 0) errors.push(`products[${index}].price must be a number`);
    if (product.payLink && !safeLink(product.payLink)) errors.push(`products[${index}].payLink must be an https link`);
    let id = slug(product.id ?? product.name ?? index);
    while (seen.has(id)) id = `${id}-${index}`;
    seen.add(id);
    return {
      id, name: String(product.name ?? ""), price, description: String(product.description ?? ""), category: String(product.category ?? ""),
      image: product.image ? String(product.image) : null, payLink: safeLink(product.payLink), soldOut: product.soldOut === true,
      ...(Number(product.compareAt) > price ? { compareAt: Number(product.compareAt) } : {}),
    };
  });
  return { errors, store: {
    name: String(raw.name ?? ""), tagline: String(raw.tagline ?? ""), about: String(raw.about ?? ""), language: raw.language === "en" ? "en" : "fr",
    currency, decimals: NO_DECIMALS.has(currency) ? 0 : 2, accent: /^#[0-9a-f]{6}$/i.test(raw.accent ?? "") ? raw.accent : "#0f766e",
    whatsapp, email: raw.email ? String(raw.email) : null, delivery: String(raw.delivery ?? ""), payment: String(raw.payment ?? ""),
    logo: raw.logo ? String(raw.logo) : null, url: safeLink(raw.url), products,
  } };
}

export function renderStore(store) {
  const t = TEXT[store.language];
  const categories = [...new Set(store.products.map((p) => p.category).filter(Boolean))];
  const first = store.products.find((p) => p.image);
  const cards = store.products.map((p) => `<article class="card" data-id="${escape(p.id)}" data-cat="${escape(p.category)}" data-name="${escape(p.name.toLowerCase())}">
<div class="pic">${p.image ? `<img src="${escape(p.image)}" alt="${escape(p.name)}" loading="lazy">` : `<span>${escape(p.name.slice(0, 1))}</span>`}${p.soldOut ? `<b class="tag">${t.soldOut}</b>` : ""}</div>
<div class="body"><h3>${escape(p.name)}</h3>${p.description ? `<p>${escape(p.description)}</p>` : ""}
<div class="row"><span class="price" data-price="${p.price}"></span>${p.compareAt ? `<s class="was" data-price="${p.compareAt}"></s>` : ""}</div>
<div class="act">${p.soldOut ? "" : `<button class="add" data-add="${escape(p.id)}">${t.add}</button>`}${p.payLink && !p.soldOut ? `<a class="pay" href="${escape(p.payLink)}" target="_blank" rel="noopener">${t.pay}</a>` : ""}</div></div></article>`).join("\n");
  const filters = categories.length > 1 ? `<nav class="filters"><button class="on" data-cat="">${t.all}</button>${categories.map((c) => `<button data-cat="${escape(c)}">${escape(c)}</button>`).join("")}</nav>` : "";
  const info = [store.delivery && `<div><h4>${t.delivery}</h4><p>${escape(store.delivery)}</p></div>`, store.payment && `<div><h4>${t.payment}</h4><p>${escape(store.payment)}</p></div>`].filter(Boolean).join("");
  return `<!doctype html><html lang="${store.language}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escape(store.name)}</title><meta name="description" content="${escape(store.tagline || store.about)}">
<meta property="og:title" content="${escape(store.name)}"><meta property="og:description" content="${escape(store.tagline)}">${first ? `<meta property="og:image" content="${escape(store.url ? new URL(first.image, store.url).href : first.image)}">` : ""}
${store.logo ? `<link rel="icon" href="${escape(store.logo)}">` : ""}<meta name="theme-color" content="${store.accent}">
<style>
:root{--a:${store.accent};--bg:#fafaf9;--card:#fff;--ink:#1c1917;--soft:#57534e;--line:#e7e5e4}
@media (prefers-color-scheme:dark){:root{--bg:#0c0a09;--card:#1c1917;--ink:#fafaf9;--soft:#a8a29e;--line:#292524}}
*{box-sizing:border-box}body{margin:0;font:15px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;background:var(--bg);color:var(--ink)}
header{position:sticky;top:0;z-index:5;background:color-mix(in srgb,var(--bg) 88%,transparent);backdrop-filter:blur(10px);border-bottom:1px solid var(--line)}
.bar{max-width:1100px;margin:0 auto;display:flex;align-items:center;gap:12px;padding:12px 16px}.bar img{height:36px;width:36px;object-fit:contain;border-radius:8px}
.bar strong{font-size:18px;flex:1}.cartbtn{border:0;background:var(--a);color:#fff;border-radius:999px;padding:8px 14px;font-weight:600;cursor:pointer}
.hero{max-width:1100px;margin:0 auto;padding:28px 16px 8px}.hero h1{margin:0 0 4px;font-size:clamp(24px,5vw,36px)}.hero p{margin:0;color:var(--soft)}
.tools{max-width:1100px;margin:0 auto;padding:12px 16px;display:flex;flex-wrap:wrap;gap:10px;align-items:center}
.tools input{flex:1;min-width:200px;padding:10px 12px;border-radius:10px;border:1px solid var(--line);background:var(--card);color:var(--ink)}
.filters{display:flex;gap:6px;flex-wrap:wrap}.filters button{border:1px solid var(--line);background:var(--card);color:var(--ink);border-radius:999px;padding:6px 12px;cursor:pointer}
.filters .on{background:var(--a);border-color:var(--a);color:#fff}
main{max-width:1100px;margin:0 auto;padding:8px 16px 48px;display:grid;grid-template-columns:repeat(auto-fill,minmax(158px,1fr));gap:12px}@media (min-width:700px){main{grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:16px}}
.card{background:var(--card);border:1px solid var(--line);border-radius:14px;overflow:hidden;display:flex;flex-direction:column}
.pic{position:relative;aspect-ratio:1;background:color-mix(in srgb,var(--a) 12%,var(--card));display:grid;place-items:center}.pic img{width:100%;height:100%;object-fit:cover}
.pic span{font-size:48px;font-weight:700;color:var(--a)}.tag{position:absolute;top:10px;left:10px;background:#111;color:#fff;font-size:12px;padding:3px 8px;border-radius:6px}
.body{padding:12px 14px 14px;display:flex;flex-direction:column;gap:6px;flex:1}.body h3{margin:0;font-size:16px}.body p{margin:0;color:var(--soft);font-size:14px}
.row{display:flex;gap:8px;align-items:baseline;margin-top:auto}.price{font-weight:700;font-size:17px}.was{color:var(--soft)}
.act{display:flex;gap:8px;flex-wrap:wrap}@media (max-width:699px){.body{padding:10px}.body h3{font-size:15px}.body p{font-size:13px;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}.price{font-size:15px}}.add,.pay{flex:1;text-align:center;border-radius:10px;padding:9px 10px;font-weight:600;cursor:pointer;text-decoration:none;font-size:14px}
.add{border:0;background:var(--a);color:#fff}.pay{border:1px solid var(--a);color:var(--a)}
.info{max-width:1100px;margin:0 auto;padding:0 16px 40px;display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:16px}.info h4{margin:0 0 4px}.info p{margin:0;color:var(--soft);white-space:pre-line}
dialog{border:0;border-radius:16px;padding:0;width:min(460px,calc(100vw - 24px));background:var(--card);color:var(--ink)}dialog::backdrop{background:#0008}
.sheet{padding:18px}.sheet h2{margin:0 0 12px}.line{display:flex;gap:10px;align-items:center;padding:8px 0;border-bottom:1px solid var(--line)}.line span{flex:1}
.line input{width:56px;padding:6px;border-radius:8px;border:1px solid var(--line);background:var(--bg);color:var(--ink)}.x{border:0;background:none;color:var(--soft);cursor:pointer}
.sum{display:flex;justify-content:space-between;font-weight:700;font-size:18px;margin:14px 0}.fields{display:grid;gap:8px;margin-bottom:12px}
.fields input{padding:10px;border-radius:10px;border:1px solid var(--line);background:var(--bg);color:var(--ink)}
.go{display:block;width:100%;border:0;border-radius:12px;padding:12px;font-weight:700;font-size:16px;cursor:pointer;margin-top:8px;text-align:center;text-decoration:none}
.wa{background:#25d366;color:#08310f}.mail{background:var(--a);color:#fff}.close{background:none;color:var(--soft)}
.toast{position:fixed;bottom:20px;left:50%;transform:translateX(-50%);background:#111;color:#fff;padding:8px 14px;border-radius:999px;opacity:0;transition:opacity .2s}
.toast.show{opacity:1}footer{text-align:center;color:var(--soft);font-size:13px;padding:24px}
</style></head><body>
<header><div class="bar">${store.logo ? `<img src="${escape(store.logo)}" alt="">` : ""}<strong>${escape(store.name)}</strong><button class="cartbtn" id="open">${t.cart} (<span id="count">0</span>)</button></div></header>
<section class="hero"><h1>${escape(store.name)}</h1>${store.tagline ? `<p>${escape(store.tagline)}</p>` : ""}</section>
<div class="tools"><input id="q" type="search" placeholder="${t.search}">${filters}</div>
<main id="grid">
${cards}
</main>
${info ? `<section class="info">${info}</section>` : ""}${store.about ? `<section class="info"><p>${escape(store.about)}</p></section>` : ""}
<footer>© ${new Date().getFullYear()} ${escape(store.name)}</footer>
<dialog id="cart"><div class="sheet"><h2>${t.cart}</h2><div id="lines"></div><div class="sum"><span>${t.total}</span><span id="total"></span></div>
<div class="fields"><strong>${t.contact}</strong><input id="cn" placeholder="${t.name}" autocomplete="name"><input id="cp" placeholder="${t.phone}" autocomplete="tel"><input id="ca" placeholder="${t.address}" autocomplete="street-address"></div>
${store.whatsapp ? `<a class="go wa" id="wa" href="#" target="_blank" rel="noopener">${t.order}</a>` : ""}${store.email ? `<a class="go mail" id="mail" href="#">${t.orderMail}</a>` : ""}
<button class="go close" id="shut">${t.close}</button></div></dialog><div class="toast" id="toast">${t.added}</div>
<script>
const STORE=${scriptJson({ name: store.name, currency: store.currency, decimals: store.decimals, language: store.language, whatsapp: store.whatsapp, email: store.email, hello: t.hello, empty: t.empty, remove: t.remove, products: store.products.map(({ id, name, price, soldOut }) => ({ id, name, price, soldOut })) })};
const fmt=new Intl.NumberFormat(STORE.language==="en"?"en-US":"fr-FR",{style:"currency",currency:STORE.currency,minimumFractionDigits:STORE.decimals,maximumFractionDigits:STORE.decimals});
const money=(n)=>fmt.format(n).replace(/\\u202f/g,"\\u00a0");const byId=new Map(STORE.products.map((p)=>[p.id,p]));const key="cart:"+location.pathname;
let cart={};try{cart=JSON.parse(localStorage.getItem(key)||"{}")}catch{}
const save=()=>{try{localStorage.setItem(key,JSON.stringify(cart))}catch{}};
document.querySelectorAll("[data-price]").forEach((el)=>{el.textContent=money(Number(el.dataset.price))});
const $=(id)=>document.getElementById(id);
function order(){const items=Object.entries(cart).filter(([id,q])=>byId.has(id)&&q>0);const total=items.reduce((s,[id,q])=>s+byId.get(id).price*q,0);
const who=[$("cn").value,$("cp").value,$("ca").value].map((v)=>v.trim()).filter(Boolean);
const text=[STORE.hello,...items.map(([id,q])=>"- "+q+" × "+byId.get(id).name+" = "+money(byId.get(id).price*q)),"Total : "+money(total),...(who.length?["",...who]:[])].join("\\n");return{items,total,text}}
function draw(){const{items,total,text}=order();$("count").textContent=items.reduce((s,[,q])=>s+q,0);
$("lines").innerHTML=items.length?"":"<p>"+STORE.empty+"</p>";for(const[id,q]of items){const row=document.createElement("div");row.className="line";const name=document.createElement("span");name.textContent=byId.get(id).name+" — "+money(byId.get(id).price);
const input=document.createElement("input");input.type="number";input.min="0";input.value=q;input.onchange=()=>{cart[id]=Math.max(0,Math.floor(Number(input.value)||0));if(!cart[id])delete cart[id];save();draw()};
const x=document.createElement("button");x.className="x";x.textContent="✕";x.title=STORE.remove;x.onclick=()=>{delete cart[id];save();draw()};row.append(name,input,x);$("lines").append(row)}
$("total").textContent=money(total);if($("wa"))$("wa").href="https://wa.me/"+STORE.whatsapp+"?text="+encodeURIComponent(text);if($("mail"))$("mail").href="mailto:"+STORE.email+"?subject="+encodeURIComponent(STORE.name)+"&body="+encodeURIComponent(text)}
document.addEventListener("click",(e)=>{const add=e.target.closest("[data-add]");if(add){const id=add.dataset.add;cart[id]=(cart[id]||0)+1;save();draw();$("toast").classList.add("show");setTimeout(()=>$("toast").classList.remove("show"),1200)}
const f=e.target.closest(".filters button");if(f){document.querySelectorAll(".filters button").forEach((b)=>b.classList.toggle("on",b===f));filter()}});
function filter(){const q=$("q").value.trim().toLowerCase();const cat=document.querySelector(".filters .on")?.dataset.cat||"";document.querySelectorAll(".card").forEach((c)=>{c.hidden=(cat&&c.dataset.cat!==cat)||(q&&!c.dataset.name.includes(q))})}
$("q").oninput=filter;$("open").onclick=()=>{draw();$("cart").showModal()};$("shut").onclick=()=>$("cart").close();["cn","cp","ca"].forEach((id)=>$(id).oninput=draw);draw();
</script></body></html>`;
}

export function build(catalogFile, out) {
  const raw = JSON.parse(readFileSync(catalogFile, "utf8"));
  const { errors, store } = readCatalog(raw);
  if (errors.length) return { ok: false, errors };
  const base = dirname(catalogFile);
  mkdirSync(join(out, "images"), { recursive: true });
  const copied = [];
  const place = (path) => {
    if (!path || path.startsWith("https://")) return path;
    const source = resolve(base, path);
    if (!existsSync(source)) throw new Error(`image not found: ${path}`);
    if (!IMAGE_TYPES.has(extname(source).toLowerCase())) throw new Error(`not an image file: ${path}`);
    const name = `${slug(basename(source, extname(source)))}${extname(source).toLowerCase()}`;
    copyFileSync(source, join(out, "images", name));
    copied.push(name);
    return `images/${name}`;
  };
  for (const product of store.products) product.image = place(product.image);
  store.logo = place(store.logo);
  writeFileSync(join(out, "index.html"), renderStore(store));
  return { ok: true, out, index: join(out, "index.html"), products: store.products.length, images: copied.length, ordering: [store.whatsapp && "whatsapp", store.email && "email", store.products.some((p) => p.payLink) && "payment links"].filter(Boolean) };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const argv = process.argv.slice(2);
  const flag = (name) => { const at = argv.indexOf(name); return at >= 0 ? argv[at + 1] : undefined; };
  try {
    const catalog = flag("--catalog"), out = flag("--out");
    if (!catalog || !out) throw new Error("usage: node store.mjs --catalog <store.json> --out <folder to publish>");
    const result = build(resolve(catalog), resolve(out));
    process.stdout.write(`${JSON.stringify(result)}\n`);
    if (!result.ok) process.exitCode = 1;
  } catch (error) {
    process.stdout.write(`${JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) })}\n`);
    process.exitCode = 1;
  }
}
