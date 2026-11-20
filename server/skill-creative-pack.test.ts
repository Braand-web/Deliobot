import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
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

const ASKS: Record<string, [string, string]> = {
  "video-montage": ["Monte la vidéo avec une voix off et des sous-titres", "edit my video and add captions"],
  "product-photoshoot": ["Fais des photos produit de mon parfum", "I need a product photo for my shop"],
  "consistent-character": ["Je veux le même visage dans toutes les pubs", "use my face in every picture"],
  "brand-kit": ["Crée une charte graphique pour ma marque", "design a logo for my bakery"],
  "marketplace-listing-images": ["Prépare des images pour Amazon et une infographie produit", "make amazon listing images"],
  "youtube-thumbnail": ["Fais une miniature pour ma vidéo", "a youtube thumbnail for my vlog"],
  "faceless-video": ["Une vidéo explicative avec voix off sur l'histoire du café", "make a faceless video about Mars"],
  "ugc-video-ads": ["Une vidéo UGC pour mon sérum", "create video ads for my serum"],
  "cinematic-video": ["Fais une bande-annonce de mon roman", "a cinematic shot of a lighthouse"],
  "3d-cgi-video": ["Une animation 3D de ma mascotte", "a 3d render of my sneaker"],
  "cartoon-animation": ["Un dessin animé pour enfants", "a 2d animation of a fox"],
  "comic-to-video": ["Anime ma BD en vidéo", "turn this manga panel into a video"],
  "fight-scenes": ["Une scène de combat au sabre", "a sword fight on a rooftop"],
  "motion-design-ad": ["Une pub pour mon app en motion design", "an app promo video for my startup"],
  "ecommerce-ad": ["Fais une pub pour mon produit", "ads for my product on tiktok shop"],
  "anime-video": ["Une scène en style anime", "an anime style opening"],
  "product-360": ["Une vidéo 360 de ma montre", "a turntable of my watch"],
  "music-video": ["Un clip pour ma musique", "a music video for my single"],
  "social-hook": ["Les 3 premières secondes de ma vidéo TikTok", "a video hook that will stop the scroll"],
  "brand-story": ["Le film de marque de notre entreprise", "our brand story film"],
  "fashion-lookbook": ["Un lookbook de ma nouvelle collection de vêtements", "a fashion shoot for my brand"],
  "food-beverage": ["Une vidéo restaurant pour mon menu", "a cocktail video for our bar"],
  "real-estate-video": ["Une visite virtuelle de la villa", "a house tour video of the villa"],
};
const ADAPTED = Object.keys(ASKS).filter((id) => id !== "video-montage");

describe.each(Object.keys(ASKS))("bundled %s skill", (id) => {
  const dir = join(SKILLS, id);
  const text = readFileSync(join(dir, "SKILL.md"), "utf8");

  it("is a valid, clean, default-on skill whose references all exist", () => {
    expect(parseSkillMd(text)).toMatchObject({ name: id });
    expect(scanSkillText(text)).toEqual([]);
    expect(bundled.find((skill) => skill.manifest.id === id)?.manifest.defaultEnabled).toBe(true);
    for (const reference of text.match(/references\/[\w.-]+\.md/g) ?? []) {
      expect(existsSync(join(dir, reference)), `${id} → ${reference}`).toBe(true);
      expect(scanSkillText(readFileSync(join(dir, reference), "utf8"))).toEqual([]);
    }
    expect(text).not.toMatch(/higgsfield|mcp__|--wait --json/i);
    if (ADAPTED.includes(id)) expect(readFileSync(join(dir, "LICENSE"), "utf8")).toMatch(/^MIT License/);
  });

  it("is picked up from a French and an English request", () => {
    for (const ask of ASKS[id]!) expect(selected(ask), ask).toContain(id);
  });
});

it("stays out of everyday coding and admin requests", () => {
  for (const text of ["fix the webhook handler", "animer la page d'accueil", "open the shopify admin panel", "load video file from disk", "the product added to cart is wrong", "a mechanical keyboard review page", "add a thumbnail component to the gallery", "deploy on runway", "add a visualizer component"]) {
    expect(selected(text).filter((id) => id in ASKS), text).toEqual([]);
  }
});

const montage = await import(pathToFileURL(join(SKILLS, "video-montage", "montage.mjs")).href) as {
  SIZES: Record<string, [number, number]>;
  parseClip(spec: string): { path: string; image: boolean; seconds?: number };
  captionsToSrt(captions: unknown): string;
  plan(options: Record<string, unknown>): { args: string[]; seconds: number; width: number; height: number; audio: boolean };
  run(argv: string[], tools?: { ffmpeg?: string; ffprobe?: string }): Record<string, any>;
};
const dirs: string[] = [];
afterAll(async () => { for (const dir of dirs) await removeTempDir(dir); });
const hasFfmpeg = spawnSync("ffmpeg", ["-version"]).status === 0;

describe("video montage", () => {
  it("reads pictures with a length and writes timed captions", () => {
    expect(montage.parseClip("/tmp/a.png:2.5")).toMatchObject({ image: true, seconds: 2.5 });
    expect(montage.parseClip("/tmp/a.jpg")).toMatchObject({ image: true, seconds: 3 });
    expect(montage.parseClip("/tmp/clip.mp4")).toEqual({ path: "/tmp/clip.mp4", image: false });
    expect(montage.captionsToSrt([{ start: 0, end: 2.25, text: "Bonjour" }, { start: 61.5, end: 63, text: "Fin" }]))
      .toBe("1\n00:00:00,000 --> 00:00:02,250\nBonjour\n\n2\n00:01:01,500 --> 00:01:03,000\nFin\n");
    expect(() => montage.captionsToSrt([{ start: 2, end: 1, text: "x" }])).toThrow(/start < end/);
  });

  it("plans the length from the clips and ducks the music under the voice", () => {
    const built = montage.plan({
      clips: [{ path: "a.mp4", image: false, probe: { seconds: 4, audio: false } }, { path: "b.png", image: true, seconds: 2 }],
      out: "out.mp4", aspect: "16:9", voice: "v.mp3", music: "m.mp3",
    });
    expect(built).toMatchObject({ seconds: 6, width: 1920, height: 1080, audio: true });
    const graph = built.args[built.args.indexOf("-filter_complex") + 1]!;
    expect(graph).toContain("sidechaincompress");
    expect(graph).toContain("concat=n=2:v=1:a=0");
    expect(built.args).toContain("-stream_loop");
    expect(built.args.slice(-3)).toEqual(["-t", "6.000", "out.mp4"]);
    expect(() => montage.plan({ clips: [], out: "x.mp4" })).toThrow(/at least one clip/);
  });

  it("says how to install ffmpeg when it is missing", () => {
    expect(montage.run(["--out", "x.mp4", "a.mp4"], { ffmpeg: "/nonexistent/ffmpeg" })).toMatchObject({ ok: false, install: expect.any(String) });
  });

  it.runIf(hasFfmpeg)("edits clips of different shapes and a picture into one captioned video", () => {
    const dir = mkdtempSync(join(tmpdir(), "odb-montage-"));
    dirs.push(dir);
    const make = (...args: string[]) => expect(spawnSync("ffmpeg", ["-loglevel", "error", "-y", ...args]).status).toBe(0);
    make("-f", "lavfi", "-i", "testsrc=size=720x1280:rate=24", "-t", "2", "-pix_fmt", "yuv420p", join(dir, "a.mp4"));
    make("-f", "lavfi", "-i", "testsrc=size=1280x720:rate=30", "-f", "lavfi", "-i", "sine=f=300", "-t", "1.5", "-pix_fmt", "yuv420p", "-shortest", join(dir, "b.mp4"));
    make("-f", "lavfi", "-i", "color=c=orange:s=600x600", "-frames:v", "1", join(dir, "c.png"));
    make("-f", "lavfi", "-i", "sine=f=600:d=2", join(dir, "voice.mp3"));
    make("-f", "lavfi", "-i", "sine=f=200:d=1", join(dir, "music.mp3"));
    writeFileSync(join(dir, "captions.json"), JSON.stringify([{ start: 0, end: 2, text: "Bonjour à tous" }]));
    const result = montage.run(["--out", join(dir, "final.mp4"), "--aspect", "9:16", "--voice", join(dir, "voice.mp3"), "--music", join(dir, "music.mp3"),
      "--captions", join(dir, "captions.json"), "--keep-clip-audio", join(dir, "a.mp4"), join(dir, "b.mp4"), `${join(dir, "c.png")}:1`]);
    expect(result).toMatchObject({ ok: true, width: 1080, height: 1920, audio: true, clips: 3 });
    expect(result.seconds).toBeGreaterThan(4.3);
    expect(result.seconds).toBeLessThan(4.7);
  }, 120_000);
});
