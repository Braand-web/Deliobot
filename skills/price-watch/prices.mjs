import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

export const WATCH_FILE = "watchlist.json";

function parseArgs(argv) {
  const args = { url: [] };
  for (let i = 0; i < argv.length; i++) {
    if (!argv[i].startsWith("--")) continue;
    const key = argv[i].slice(2);
    const next = argv[i + 1];
    const value = next === undefined || next.startsWith("--") ? true : (i++, next);
    if (key === "url") args.url.push(value); else args[key] = value;
  }
  return args;
}

const slug = (text) => String(text).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "item";
const now = () => new Date().toISOString();

function httpsUrl(value) {
  try {
    const url = new URL(String(value));
    if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error();
    return url.href;
  } catch {
    throw new Error(`not a web address: ${String(value).slice(0, 200)}`);
  }
}

function load(dir) {
  const file = join(dir, WATCH_FILE);
  return existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : { currency: null, items: [] };
}

function save(dir, list) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, WATCH_FILE), `${JSON.stringify(list, null, 2)}\n`);
}

export function itemStatus(item) {
  const latest = new Map();
  for (const seen of item.history) {
    const last = latest.get(seen.url);
    if (!last || last.at <= seen.at) latest.set(seen.url, seen);
  }
  const offers = [...latest.values()].filter((seen) => seen.inStock !== false).sort((a, b) => a.price - b.price);
  const best = offers[0] ?? null;
  const lowestEver = item.history.length ? Math.min(...item.history.map((seen) => seen.price)) : null;
  const firstPrice = item.history[0]?.price ?? null;
  return {
    id: item.id, name: item.name, status: item.status, target: item.target ?? null,
    best: best ? { price: best.price, url: best.url, at: best.at } : null,
    lowestEver,
    dropFromFirst: best && firstPrice ? Math.round(((firstPrice - best.price) / firstPrice) * 1000) / 10 : null,
    hitTarget: Boolean(best && item.target !== undefined && item.target !== null && best.price <= item.target),
    lastChecked: item.history.at(-1)?.at ?? null,
  };
}

export function run(argv) {
  const args = parseArgs(argv);
  const dir = resolve(args.dir ?? "price-watch");
  const list = load(dir);
  const find = (id) => {
    const item = list.items.find((one) => one.id === id || one.id === slug(id));
    if (!item) throw new Error(`nothing called ${id} is watched; --list shows the ids`);
    return item;
  };

  if (args.add) {
    if (!args.url.length) throw new Error("give at least one --url where the item is sold");
    const id = slug(args.add);
    if (list.items.some((one) => one.id === id)) throw new Error(`${id} is already watched`);
    const target = args.target === undefined ? null : Number(args.target);
    if (target !== null && !(target > 0)) throw new Error("--target must be a price above 0");
    if (args.currency) list.currency = String(args.currency).toUpperCase();
    list.items.push({ id, name: String(args.add), urls: args.url.map(httpsUrl), target, status: "watching", added: now(), history: [] });
    save(dir, list);
    return { ok: true, added: id, watching: list.items.filter((one) => one.status === "watching").length };
  }
  if (args.seen) {
    const item = find(args.seen);
    const price = Number(args.price);
    if (!(price > 0)) throw new Error("--price must be the price seen, above 0");
    const url = args.url[0] ? httpsUrl(args.url[0]) : item.urls[0];
    if (!item.urls.includes(url)) item.urls.push(url);
    item.history.push({ at: args.at ?? now(), url, price, inStock: args["out-of-stock"] ? false : true });
    save(dir, list);
    return { ok: true, item: itemStatus(item) };
  }
  if (args.bought || args.stop) {
    const item = find(args.bought ?? args.stop);
    item.status = args.bought ? "bought" : "stopped";
    item.closed = now();
    save(dir, list);
    return { ok: true, item: itemStatus(item) };
  }
  const shown = list.items.filter((one) => args.all || one.status === "watching").map(itemStatus);
  return { ok: true, currency: list.currency, items: shown, alerts: shown.filter((one) => one.hitTarget).map((one) => one.id) };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    process.stdout.write(`${JSON.stringify(run(process.argv.slice(2)))}\n`);
  } catch (error) {
    process.stdout.write(`${JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) })}\n`);
    process.exitCode = 1;
  }
}
