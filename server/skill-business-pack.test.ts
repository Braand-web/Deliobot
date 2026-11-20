import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterAll, describe, expect, it } from "vitest";

import { parseSkillMd, scanSkillText } from "../shared/skill-md.ts";
import { loadBundledSkills, selectBundledSkills } from "./skill-library.ts";
import { removeTempDir } from "./testing/cleanup.ts";

const SKILLS = join(process.cwd(), "skills");
const bundled = loadBundledSkills(SKILLS);
const selected = (text: string) => selectBundledSkills(text, [], bundled).map((skill) => skill.manifest.id);
const dirs: string[] = [];
const scratch = () => { const dir = mkdtempSync(join(tmpdir(), "odb-business-pack-")); dirs.push(dir); return dir; };
afterAll(async () => { for (const dir of dirs) await removeTempDir(dir); });
const load = async <T>(skill: string, file: string) => await import(pathToFileURL(join(SKILLS, skill, file)).href) as T;

const sprint = await load<{
  workBackwards(input: Record<string, unknown>): Record<string, any>;
  run(argv: string[]): Record<string, any>;
}>("solo-service-business", "sprint.mjs");
const prices = await load<{ run(argv: string[]): Record<string, any> }>("price-watch", "prices.mjs");
const style = await load<{
  shotLengths(scenes: number[], seconds: number): number[];
  pacing(scenes: number[], seconds: number): Record<string, number>;
  colourStats(pixels: Uint8Array): { palette: Array<{ colour: string; share: number }>; brightness: number; saturation: number; warmShare: number };
  speech(transcript: unknown, seconds: number): Record<string, unknown>;
  compare(a: unknown, b: unknown): { overall: number; scores: Record<string, number>; gaps: string[] };
  run(argv: string[]): Record<string, any>;
}>("video-style-reverse", "style.mjs");

const ASKS: Record<string, [string, string]> = {
  "solo-service-business": ["Aide-moi à trouver mes premiers clients et lancer mon business", "help me start a one-person business"],
  "offer-builder": ["Je ne sais pas quoi vendre, aide-moi à créer une offre", "build me an irresistible offer"],
  "client-outreach": ["Écris mes e-mails de prospection pour les dentistes", "plan my cold outreach to dentists"],
  "sales-calls": ["Prépare mon appel découverte de demain", "help me handle objections on my sales call"],
  "client-delivery": ["J'ai un nouveau client signé, prépare l'onboarding client", "write the weekly report for my client"],
  "bot-team-builder": ["Aide-moi à créer mes bots pour mon entreprise", "set up my bots as an AI team"],
  "price-watch": ["Surveille le prix de cette télé pour le Black Friday", "track the price of these headphones"],
  "video-style-reverse": ["Reproduis le style de montage de cette vidéo", "reverse engineer the editing style of this reel"],
  "habit-forming-apps": ["Comment rendre mon appli addictive pour que les gens reviennent", "improve user retention in my app"],
  "youtube-growth": ["Je veux plus de vues sur ma chaîne YouTube", "what youtube strategy should I use to grow my channel"],
  "command-center": ["Fais-moi un centre de commande de tous mes bots", "a command center with everything in one place"],
};

describe.each(Object.keys(ASKS))("bundled %s skill", (id) => {
  it("is valid, clean, default-on and picked up in French and English", () => {
    const text = readFileSync(join(SKILLS, id, "SKILL.md"), "utf8");
    expect(parseSkillMd(text)).toMatchObject({ name: id });
    expect(scanSkillText(text)).toEqual([]);
    expect(bundled.find((skill) => skill.manifest.id === id)?.manifest.defaultEnabled).toBe(true);
    for (const ask of ASKS[id]!) expect(selected(ask), ask).toContain(id);
  });
});

it("stays out of everyday coding requests", () => {
  for (const text of ["fix the sprint planning board component", "add a price field to the product form", "refactor the retention policy job", "rename the offers table"]) {
    expect(selected(text).filter((id) => id in ASKS), text).toEqual([]);
  }
});

describe("the 100-day sprint", () => {

  it("works backwards from the monthly goal to outreach per day", () => {
    expect(sprint.workBackwards({ goal: 1_000_000, price: 200_000 })).toMatchObject({ clients: 5, qualifiedCalls: 16, shows: 27, booked: 34, outreach: 1700, perDay: { outreach: 17 } });
    expect(() => sprint.workBackwards({ goal: 1000, price: 100, close: 3 })).toThrow(/between 0 and 1/);
  });

  it("logs the days, keeps the streak and says when the person falls behind", () => {
    const dir = scratch();
    sprint.run(["--start", "--dir", dir, "--goal", "1000000", "--price", "200000", "--offer", "10 RDV en 30 jours", "--date", "2026-11-01"]);
    expect(() => sprint.run(["--start", "--dir", dir, "--goal", "1", "--price", "1"])).toThrow(/already exists/);
    sprint.run(["--log", "--dir", dir, "--date", "2026-11-01", "--outreach", "20", "--booked", "1"]);
    sprint.run(["--log", "--dir", dir, "--date", "2026-11-02", "--outreach", "5"]);
    const status = sprint.run(["--log", "--dir", dir, "--date", "2026-11-02", "--outreach", "5", "--closed", "1", "--revenue", "200000"]).status;
    expect(status).toMatchObject({ day: 2, streak: 2, totals: { outreach: 30, booked: 1, closed: 1, revenue: 200000 }, onPace: false, behindBy: 4, toGoal: 800000 });
    expect(sprint.run(["--dir", dir, "--date", "2026-11-04"]).status.streak).toBe(0);
  });
});

describe("price watch", () => {

  it("keeps the best current offer per shop and alerts at the target", () => {
    const dir = scratch();
    prices.run(["--dir", dir, "--add", "Téléviseur 55\"", "--url", "https://a.example/tv", "--url", "https://b.example/tv", "--target", "300000", "--currency", "xof"]);
    expect(() => prices.run(["--dir", dir, "--add", "x", "--url", "javascript:alert(1)"])).toThrow(/not a web address/);
    prices.run(["--dir", dir, "--seen", "televiseur-55", "--price", "350000", "--url", "https://a.example/tv", "--at", "2026-11-20T08:00:00Z"]);
    prices.run(["--dir", dir, "--seen", "televiseur-55", "--price", "290000", "--url", "https://b.example/tv", "--at", "2026-11-20T09:00:00Z", "--out-of-stock"]);
    let item = prices.run(["--dir", dir]).items[0];
    expect(item).toMatchObject({ best: { price: 350000 }, hitTarget: false, lowestEver: 290000 });
    prices.run(["--dir", dir, "--seen", "televiseur-55", "--price", "299000", "--url", "https://b.example/tv", "--at", "2026-11-20T10:00:00Z"]);
    const list = prices.run(["--dir", dir]);
    item = list.items[0];
    expect(item).toMatchObject({ best: { price: 299000, url: "https://b.example/tv" }, hitTarget: true, dropFromFirst: 14.6 });
    expect(list).toMatchObject({ currency: "XOF", alerts: ["televiseur-55"] });
    prices.run(["--dir", dir, "--bought", "televiseur-55"]);
    expect(prices.run(["--dir", dir]).items).toEqual([]);
    expect(prices.run(["--dir", dir, "--all"]).items[0].status).toBe("bought");
  });
});

describe("video style reverse-engineering", () => {

  it("measures pacing, colour and speech pace", () => {
    expect(style.shotLengths([0, 2, 5], 6)).toEqual([2, 3, 1]);
    expect(style.pacing([0, 2, 5], 6)).toMatchObject({ shots: 3, averageShot: 2, medianShot: 2, cutsPerMinute: 20 });
    const red = new Uint8Array(Array.from({ length: 100 }, () => [230, 20, 20]).flat());
    expect(style.colourStats(red)).toMatchObject({ palette: [{ colour: "#e61414", share: 1 }], warmShare: 1 });
    expect(style.speech({ language: "fr", segments: [{ start: 0, end: 3, text: "un deux trois quatre cinq six" }, { start: 4, end: 6, text: "sept huit" }] }, 10))
      .toEqual({ words: 8, wordsPerMinute: 96, talkShare: 0.5, pausesOver600ms: 1, language: "fr" });
  });

  it("scores a rebuild against the original and names the gaps", () => {
    const make = (averageShot: number, cuts: number, brightness: number, warm: number) => ({
      shape: { value: "portrait" }, pacing: { value: { averageShot, cutsPerMinute: cuts } },
      colour: { value: { brightness, saturation: 0.5, warmShare: warm } }, sound: { value: { loudness: { meanDb: -18 } } },
    });
    expect(style.compare(make(2, 30, 0.5, 0.5), make(2, 30, 0.5, 0.5))).toMatchObject({ overall: 1, gaps: [] });
    const result = style.compare(make(2, 30, 0.5, 0.6), make(4, 15, 0.7, 0.2));
    expect(result.overall).toBeLessThan(0.8);
    expect(result.gaps).toEqual(expect.arrayContaining([expect.stringMatching(/cut faster/), expect.stringMatching(/brighter/), expect.stringMatching(/cooler/)]));
  });

  it.runIf(spawnSync("ffmpeg", ["-version"]).status === 0)("writes a style file with measured evidence and what stays unknown", () => {
    const dir = scratch();
    expect(spawnSync("ffmpeg", ["-loglevel", "error", "-y", "-f", "lavfi", "-i", "color=c=orange:s=320x568:rate=25:d=2", "-f", "lavfi", "-i", "color=c=navy:s=320x568:rate=25:d=2",
      "-filter_complex", "[0:v][1:v]concat=n=2:v=1:a=0[v]", "-map", "[v]", "-pix_fmt", "yuv420p", join(dir, "v.mp4")]).status).toBe(0);
    const result = style.run(["--video", join(dir, "v.mp4"), "--out", join(dir, "style"), "--frames", "4"]);
    expect(result).toMatchObject({ ok: true, pacing: { shots: 2, averageShot: 2 } });
    const saved = JSON.parse(readFileSync(result.style, "utf8"));
    expect(saved.pacing.evidence).toBe("seen");
    expect(saved.unknown).toEqual(expect.arrayContaining([expect.stringMatching(/font/)]));
    expect(saved.colour.value.palette.length).toBeGreaterThan(0);
  }, 120_000);
});
