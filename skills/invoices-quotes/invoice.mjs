import { execFile } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, extname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

export const LEDGER_FILE = "ledger.json";
const NO_DECIMALS = new Set(["XOF", "XAF", "GNF", "JPY", "KRW", "RWF", "BIF", "DJF", "KMF", "UGX", "VND", "CLP", "PYG", "ISK"]);
const PREFIX = { invoice: "FAC", quote: "DEV" };

const LABELS = {
  fr: {
    invoice: "Facture", quote: "Devis", number: "N°", date: "Date", due: "Échéance", valid: "Valable jusqu'au", billedTo: "Facturé à", quotedFor: "Devis pour",
    description: "Désignation", quantity: "Qté", unitPrice: "Prix unitaire", tax: "TVA", amount: "Montant", subtotal: "Sous-total", discount: "Remise",
    totalBeforeTax: "Total HT", totalTax: "TVA", total: "Total TTC", totalNoTax: "Total", payment: "Paiement", notes: "Notes", taxId: "N° fiscal",
    paid: "PAYÉE", acceptance: "Bon pour accord, date et signature :",
  },
  en: {
    invoice: "Invoice", quote: "Quote", number: "No.", date: "Date", due: "Due", valid: "Valid until", billedTo: "Bill to", quotedFor: "Quote for",
    description: "Description", quantity: "Qty", unitPrice: "Unit price", tax: "Tax", amount: "Amount", subtotal: "Subtotal", discount: "Discount",
    totalBeforeTax: "Total before tax", totalTax: "Tax", total: "Total", totalNoTax: "Total", payment: "Payment", notes: "Notes", taxId: "Tax ID",
    paid: "PAID", acceptance: "Accepted — date and signature:",
  },
};

export const decimalsOf = (currency) => (NO_DECIMALS.has(String(currency).toUpperCase()) ? 0 : 2);

function round(value, decimals) {
  const factor = 10 ** decimals;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

export function formatMoney(value, currency, language = "fr") {
  const code = String(currency).toUpperCase();
  const decimals = decimalsOf(code);
  return new Intl.NumberFormat(language === "en" ? "en-US" : "fr-FR", { style: "currency", currency: code, minimumFractionDigits: decimals, maximumFractionDigits: decimals })
    .format(value).replace(/\u202f/g, "\u00a0");
}

const number = (value, name) => {
  const n = Number(value ?? 0);
  if (!Number.isFinite(n) || n < 0) throw new Error(`${name} must be a number of 0 or more`);
  return n;
};

export function computeTotals(doc) {
  const currency = String(doc.currency ?? "XOF").toUpperCase();
  const decimals = decimalsOf(currency);
  if (!Array.isArray(doc.items) || !doc.items.length) throw new Error("items must list at least one line");
  const defaultRate = number(doc.taxRate, "taxRate");
  const lines = doc.items.map((item, index) => {
    if (!String(item.description ?? "").trim()) throw new Error(`items[${index}].description is required`);
    const quantity = number(item.quantity ?? 1, `items[${index}].quantity`);
    const unitPrice = number(item.unitPrice, `items[${index}].unitPrice`);
    const lineDiscount = number(item.discountPercent, `items[${index}].discountPercent`);
    const taxRate = item.taxRate === undefined ? defaultRate : number(item.taxRate, `items[${index}].taxRate`);
    return { description: String(item.description), detail: item.detail ? String(item.detail) : "", quantity, unitPrice, taxRate, amount: round(quantity * unitPrice * (1 - lineDiscount / 100), decimals) };
  });
  const subtotal = round(lines.reduce((sum, line) => sum + line.amount, 0), decimals);
  const discountPercent = number(doc.discountPercent, "discountPercent");
  const discount = round(subtotal * discountPercent / 100, decimals);
  const share = subtotal ? (subtotal - discount) / subtotal : 0;
  const byRate = new Map();
  for (const line of lines) byRate.set(line.taxRate, (byRate.get(line.taxRate) ?? 0) + line.amount * share);
  const taxes = [...byRate].filter(([rate]) => rate > 0).map(([rate, base]) => ({ rate, base: round(base, decimals), amount: round(base * rate / 100, decimals) }));
  const tax = round(taxes.reduce((sum, one) => sum + one.amount, 0), decimals);
  const net = round(subtotal - discount, decimals);
  return { currency, decimals, lines, subtotal, discountPercent, discount, net, taxes, tax, total: round(net + tax, decimals) };
}

const escape = (text) => String(text ?? "").replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const lines = (text) => escape(text).replace(/\n/g, "<br>");
const addDays = (iso, days) => { const at = new Date(`${iso}T12:00:00Z`); at.setUTCDate(at.getUTCDate() + days); return at.toISOString().slice(0, 10); };
const shown = (iso, language) => new Date(`${iso}T12:00:00Z`).toLocaleDateString(language === "en" ? "en-GB" : "fr-FR", { day: "2-digit", month: "long", year: "numeric", timeZone: "UTC" });

function dataUri(file) {
  const types = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".svg": "image/svg+xml", ".gif": "image/gif" };
  const type = types[extname(file).toLowerCase()];
  if (!type) throw new Error(`the logo must be a PNG, JPEG, WebP, SVG or GIF file: ${file}`);
  return `data:${type};base64,${readFileSync(file).toString("base64")}`;
}

export function renderHtml(doc, totals, meta) {
  const language = doc.language === "en" ? "en" : "fr";
  const label = LABELS[language];
  const money = (value) => formatMoney(value, totals.currency, language);
  const kind = meta.kind;
  const accent = /^#[0-9a-f]{6}$/i.test(doc.accent ?? "") ? doc.accent : "#1f4e79";
  const seller = doc.seller ?? {}, client = doc.client ?? {};
  const logo = seller.logo ? `<img class="logo" src="${dataUri(resolve(meta.baseDir, seller.logo))}" alt="">` : "";
  const party = (who) => [who.address, who.phone, who.email].filter(Boolean).map(lines).join("<br>") + (who.taxId ? `<br>${label.taxId} : ${escape(who.taxId)}` : "");
  const showTax = totals.lines.some((line) => line.taxRate > 0);
  const rows = totals.lines.map((line) => `<tr><td>${escape(line.description)}${line.detail ? `<div class="detail">${lines(line.detail)}</div>` : ""}</td><td class="n">${line.quantity}</td><td class="n">${money(line.unitPrice)}</td>${showTax ? `<td class="n">${line.taxRate} %</td>` : ""}<td class="n">${money(line.amount)}</td></tr>`).join("");
  const sums = [
    [label.subtotal, money(totals.subtotal)],
    ...(totals.discount ? [[`${label.discount} (${totals.discountPercent} %)`, `− ${money(totals.discount)}`], [label.totalBeforeTax, money(totals.net)]] : []),
    ...totals.taxes.map((one) => [`${label.totalTax} ${one.rate} %`, money(one.amount)]),
  ].map(([name, value]) => `<tr><td>${name}</td><td class="n">${value}</td></tr>`).join("");
  return `<!doctype html><html lang="${language}"><head><meta charset="utf-8"><title>${label[kind]} ${escape(meta.number)}</title>
<style>
@page{size:A4;margin:16mm}*{box-sizing:border-box}body{margin:0;font:13px/1.5 "Segoe UI",system-ui,-apple-system,Helvetica,Arial,sans-serif;color:#1c1c1c}
.page{max-width:800px;margin:0 auto;padding:32px}header{display:flex;justify-content:space-between;align-items:flex-start;gap:24px;margin-bottom:28px}
.logo{max-height:64px;max-width:200px;margin-bottom:8px}.seller strong{font-size:16px}h1{margin:0;font-size:26px;color:${accent};text-align:right;letter-spacing:.5px}
.meta{text-align:right;color:#555}.meta b{color:#1c1c1c}.client{background:#f5f7fa;border-left:3px solid ${accent};padding:12px 16px;margin-bottom:24px;border-radius:4px}
.client small{text-transform:uppercase;letter-spacing:.6px;color:#777}table{width:100%;border-collapse:collapse}th{background:${accent};color:#fff;text-align:left;padding:8px 10px;font-weight:600}
td{padding:8px 10px;border-bottom:1px solid #e6e9ee;vertical-align:top}.n{text-align:right;white-space:nowrap}.detail{color:#666;font-size:12px}
.sums{width:320px;margin:16px 0 0 auto}.sums td{border:0;padding:4px 10px}.total td{border-top:2px solid ${accent};font-size:16px;font-weight:700;padding-top:8px}
.box{margin-top:28px;padding:12px 16px;border:1px solid #e6e9ee;border-radius:4px}.box h3{margin:0 0 4px;font-size:12px;text-transform:uppercase;letter-spacing:.6px;color:#777}
.stamp{display:inline-block;margin-top:8px;padding:4px 12px;border:2px solid #1b7f3b;color:#1b7f3b;font-weight:700;transform:rotate(-4deg)}
.sign{margin-top:36px;height:80px;border:1px dashed #bbb;border-radius:4px;padding:8px 12px;color:#777}footer{margin-top:32px;color:#888;font-size:11px;text-align:center}
</style></head><body><div class="page">
<header><div class="seller">${logo}<div><strong>${escape(seller.name)}</strong></div><div>${party(seller)}</div></div>
<div><h1>${label[kind]}</h1><div class="meta"><div>${label.number} <b>${escape(meta.number)}</b></div><div>${label.date} : ${shown(meta.issueDate, language)}</div>
${meta.dueDate ? `<div>${kind === "quote" ? label.valid : label.due} : ${shown(meta.dueDate, language)}</div>` : ""}${meta.paid ? `<div class="stamp">${label.paid}</div>` : ""}</div></div></header>
<div class="client"><small>${kind === "quote" ? label.quotedFor : label.billedTo}</small><div><strong>${escape(client.name)}</strong></div><div>${party(client)}</div></div>
<table><thead><tr><th>${label.description}</th><th class="n">${label.quantity}</th><th class="n">${label.unitPrice}</th>${showTax ? `<th class="n">${label.tax}</th>` : ""}<th class="n">${label.amount}</th></tr></thead><tbody>${rows}</tbody></table>
<table class="sums"><tbody>${sums}<tr class="total"><td>${totals.tax ? label.total : label.totalNoTax}</td><td class="n">${money(totals.total)}</td></tr></tbody></table>
${doc.paymentInfo ? `<div class="box"><h3>${label.payment}</h3>${lines(doc.paymentInfo)}</div>` : ""}${doc.notes ? `<div class="box"><h3>${label.notes}</h3>${lines(doc.notes)}</div>` : ""}
${kind === "quote" ? `<div class="sign">${label.acceptance}</div>` : ""}${doc.footer ? `<footer>${lines(doc.footer)}</footer>` : ""}
</div></body></html>`;
}

function readLedger(books) {
  const file = join(books, LEDGER_FILE);
  if (!existsSync(file)) return { version: 1, next: {}, documents: [] };
  const ledger = JSON.parse(readFileSync(file, "utf8"));
  return { version: 1, next: ledger.next ?? {}, documents: Array.isArray(ledger.documents) ? ledger.documents : [] };
}

function writeLedger(books, ledger) {
  mkdirSync(books, { recursive: true });
  const file = join(books, LEDGER_FILE);
  writeFileSync(`${file}.tmp`, `${JSON.stringify(ledger, null, 2)}\n`);
  renameSync(`${file}.tmp`, file);
}

const CHROMES = [
  process.env.CHROME_PATH, "/usr/bin/google-chrome", "/usr/bin/google-chrome-stable", "/usr/bin/chromium", "/usr/bin/chromium-browser", "/snap/bin/chromium",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe", "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe", "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
].filter(Boolean);

export function printPdf(htmlFile, pdfFile, browsers = CHROMES) {
  const browser = browsers.find((path) => existsSync(path));
  if (!browser) return Promise.resolve(null);
  const args = ["--headless=new", "--disable-gpu", "--no-pdf-header-footer", `--print-to-pdf=${pdfFile}`, pathToFileURL(htmlFile).href];
  if (process.platform === "linux" && process.getuid?.() === 0) args.unshift("--no-sandbox");
  return new Promise((done) => execFile(browser, args, { timeout: 60_000, windowsHide: true }, () => done(existsSync(pdfFile) ? pdfFile : null)));
}

function parseArgs(argv) {
  const args = {};
  for (let at = 0; at < argv.length; at += 1) {
    const flag = argv[at];
    if (["--pdf", "--list", "--unpaid", "--overdue"].includes(flag)) args[flag.slice(2)] = true;
    else if (["--data", "--books", "--mark-paid", "--mark-sent", "--accept", "--cancel", "--today", "--paid-on"].includes(flag) && argv[at + 1]) args[flag.slice(2)] = argv[(at += 1)];
    else throw new Error(`unknown or incomplete argument: ${flag}`);
  }
  return args;
}

export async function run(argv, options = {}) {
  const args = parseArgs(argv);
  const books = resolve(args.books ?? "invoices");
  const today = args.today ?? options.today ?? new Date().toISOString().slice(0, 10);
  const ledger = readLedger(books);
  const find = (num) => {
    const found = ledger.documents.find((one) => one.number === num);
    if (!found) throw new Error(`no document ${num} in ${join(books, LEDGER_FILE)}`);
    return found;
  };

  if (args.list) {
    const late = (one) => one.kind === "invoice" && one.status !== "paid" && one.status !== "cancelled" && one.dueDate && one.dueDate < today;
    const shownDocs = ledger.documents.filter((one) => (!args.unpaid || (one.kind === "invoice" && !["paid", "cancelled"].includes(one.status))) && (!args.overdue || late(one)));
    const owed = shownDocs.filter((one) => one.kind === "invoice" && !["paid", "cancelled"].includes(one.status));
    const byCurrency = {};
    for (const one of owed) byCurrency[one.currency] = (byCurrency[one.currency] ?? 0) + one.total;
    return { ok: true, documents: shownDocs.map((one) => ({ ...one, overdue: late(one) })), owed: byCurrency };
  }

  for (const [flag, status] of [["mark-paid", "paid"], ["mark-sent", "sent"], ["accept", "accepted"], ["cancel", "cancelled"]]) {
    if (!args[flag]) continue;
    const doc = find(args[flag]);
    if (status === "accepted" && doc.kind !== "quote") throw new Error(`${doc.number} is an invoice; only a quote is accepted`);
    if (status === "paid" && doc.kind !== "invoice") throw new Error(`${doc.number} is a quote; invoice it first`);
    doc.status = status;
    if (status === "paid") doc.paidAt = args["paid-on"] ?? today;
    writeLedger(books, ledger);
    return { ok: true, document: doc };
  }

  if (!args.data) throw new Error("usage: node invoice.mjs --data <document.json> [--books <folder>] [--pdf] | --list [--unpaid|--overdue] | --mark-sent|--mark-paid|--accept|--cancel <number>");
  const dataFile = resolve(args.data);
  const doc = JSON.parse(readFileSync(dataFile, "utf8"));
  const kind = doc.kind === "quote" ? "quote" : "invoice";
  if (!String(doc.seller?.name ?? "").trim() || !String(doc.client?.name ?? "").trim()) throw new Error("seller.name and client.name are required");
  const totals = computeTotals(doc);
  const issueDate = /^\d{4}-\d{2}-\d{2}$/.test(doc.issueDate ?? "") ? doc.issueDate : today;
  const days = kind === "quote" ? number(doc.validDays ?? 30, "validDays") : number(doc.dueDays ?? 30, "dueDays");
  const dueDate = days ? addDays(issueDate, days) : null;
  const existing = doc.number ? ledger.documents.find((one) => one.number === doc.number) : undefined;
  let docNumber = existing?.number;
  if (!docNumber) {
    const series = `${PREFIX[kind]}-${issueDate.slice(0, 4)}`;
    const next = (ledger.next[series] ?? 0) + 1;
    ledger.next[series] = next;
    docNumber = `${series}-${String(next).padStart(4, "0")}`;
  }
  const meta = { kind, number: docNumber, issueDate, dueDate, paid: existing?.status === "paid", baseDir: dirname(dataFile) };
  const html = renderHtml(doc, totals, meta);
  mkdirSync(books, { recursive: true });
  const htmlFile = join(books, `${docNumber}.html`);
  writeFileSync(htmlFile, html);
  const pdf = args.pdf ? await printPdf(htmlFile, join(books, `${docNumber}.pdf`), options.browsers) : null;
  const record = {
    number: docNumber, kind, client: String(doc.client.name), clientEmail: doc.client.email ?? null, clientPhone: doc.client.phone ?? null,
    currency: totals.currency, total: totals.total, issueDate, dueDate, status: existing?.status ?? "draft", file: htmlFile, ...(pdf ? { pdf } : {}),
    ...(doc.fromQuote ? { fromQuote: String(doc.fromQuote) } : {}),
  };
  if (existing) Object.assign(existing, record);
  else ledger.documents.push(record);
  if (doc.fromQuote) { const quote = ledger.documents.find((one) => one.number === doc.fromQuote); if (quote) quote.invoicedAs = docNumber; }
  writeLedger(books, ledger);
  return {
    ok: true, number: docNumber, kind, total: totals.total, totalShown: formatMoney(totals.total, totals.currency, doc.language === "en" ? "en" : "fr"),
    html: htmlFile, pdf, ...(args.pdf && !pdf ? { message: "No Chrome or Edge was found to make the PDF: send the HTML file, or open it in a browser and print it to PDF." } : {}),
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  run(process.argv.slice(2)).then(
    (result) => process.stdout.write(`${JSON.stringify(result)}\n`),
    (error) => { process.stdout.write(`${JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) })}\n`); process.exitCode = 1; },
  );
}
