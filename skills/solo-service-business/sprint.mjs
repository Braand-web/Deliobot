import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

export const SPRINT_FILE = "sprint.json";
export const DAY_FIELDS = ["outreach", "conversations", "booked", "showed", "qualified", "closed", "revenue"];

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    if (!argv[i].startsWith("--")) continue;
    const key = argv[i].slice(2);
    const next = argv[i + 1];
    args[key] = next === undefined || next.startsWith("--") ? true : (i++, next);
  }
  return args;
}

const rate = (value, name) => {
  const n = Number(value);
  if (!(n > 0 && n <= 1)) throw new Error(`${name} must be a share between 0 and 1, such as 0.33`);
  return n;
};
const positive = (value, name) => {
  const n = Number(value);
  if (!(n > 0)) throw new Error(`${name} must be a positive number`);
  return n;
};

export function workBackwards(input) {
  const goal = positive(input.goal, "goal");
  const price = positive(input.price, "price");
  const days = Math.round(positive(input.days ?? 100, "days"));
  const close = rate(input.close ?? 0.33, "close");
  const qualified = rate(input.qualified ?? 0.6, "qualified");
  const show = rate(input.show ?? 0.8, "show");
  const book = rate(input.book ?? 0.02, "book");
  const clients = Math.ceil(goal / price);
  const qualifiedCalls = Math.ceil(clients / close);
  const shows = Math.ceil(qualifiedCalls / qualified);
  const booked = Math.ceil(shows / show);
  const outreach = Math.ceil(booked / book);
  return {
    goal, price, days, clients, qualifiedCalls, shows, booked, outreach,
    perDay: { outreach: Math.ceil(outreach / days), booked: Math.round((booked / days) * 100) / 100 },
    rates: { book, show, qualified, close },
  };
}

const today = () => new Date().toISOString().slice(0, 10);

function load(dir) {
  const file = join(dir, SPRINT_FILE);
  return existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : null;
}

function save(dir, sprint) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, SPRINT_FILE), `${JSON.stringify(sprint, null, 2)}\n`);
}

export function summary(sprint, on = today()) {
  const totals = Object.fromEntries(DAY_FIELDS.map((field) => [field, sprint.days.reduce((sum, day) => sum + (Number(day[field]) || 0), 0)]));
  const started = new Date(`${sprint.start}T12:00:00Z`);
  const day = Math.max(1, Math.floor((new Date(`${on}T12:00:00Z`).getTime() - started.getTime()) / 86_400_000) + 1);
  const logged = new Set(sprint.days.map((d) => d.date));
  let streak = 0;
  for (let back = 0; back < day; back++) {
    const date = new Date(new Date(`${on}T12:00:00Z`).getTime() - back * 86_400_000).toISOString().slice(0, 10);
    if (!logged.has(date)) break;
    streak++;
  }
  const expectedOutreach = sprint.plan.perDay.outreach * Math.min(day, sprint.plan.days);
  const share = (a, b) => (b ? Math.round((a / b) * 1000) / 1000 : null);
  return {
    day: Math.min(day, sprint.plan.days), of: sprint.plan.days, streak, totals,
    actual: { book: share(totals.booked, totals.outreach), show: share(totals.showed, totals.booked), qualified: share(totals.qualified, totals.showed), close: share(totals.closed, totals.qualified) },
    onPace: totals.outreach >= expectedOutreach,
    behindBy: Math.max(0, expectedOutreach - totals.outreach),
    toGoal: Math.max(0, sprint.plan.goal - totals.revenue),
  };
}

export function run(argv) {
  const args = parseArgs(argv);
  const dir = resolve(args.dir ?? "sprint");
  if (args.plan) return { ok: true, plan: workBackwards(args) };
  if (args.start) {
    if (load(dir) && !args.restart) throw new Error(`a sprint already exists in ${dir}; pass --restart to replace it`);
    const sprint = { start: args.date ?? today(), offer: args.offer ? String(args.offer) : null, plan: workBackwards(args), days: [] };
    save(dir, sprint);
    return { ok: true, sprint: { start: sprint.start, offer: sprint.offer }, plan: sprint.plan };
  }
  const sprint = load(dir);
  if (!sprint) throw new Error(`no sprint in ${dir}: start one with --start --goal <monthly revenue> --price <per client>`);
  if (args.log) {
    const date = args.date ?? today();
    const entry = sprint.days.find((d) => d.date === date) ?? (sprint.days.push({ date }), sprint.days.at(-1));
    for (const field of DAY_FIELDS) {
      if (args[field] === undefined) continue;
      const n = Number(args[field]);
      if (!Number.isFinite(n) || n < 0) throw new Error(`${field} must be a number of 0 or more`);
      entry[field] = (Number(entry[field]) || 0) + n;
    }
    if (args.note) entry.note = String(args.note);
    sprint.days.sort((a, b) => a.date.localeCompare(b.date));
    save(dir, sprint);
    return { ok: true, logged: entry, status: summary(sprint, date) };
  }
  return { ok: true, offer: sprint.offer, plan: sprint.plan, status: summary(sprint, args.date ?? today()) };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    process.stdout.write(`${JSON.stringify(run(process.argv.slice(2)))}\n`);
  } catch (error) {
    process.stdout.write(`${JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) })}\n`);
    process.exitCode = 1;
  }
}
