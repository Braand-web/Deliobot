// Renders the film: each frame of scenes.html drawn at its exact time and piped to ffmpeg, then mixed with the
// voice-over and music that audio.mjs made.
//   node cloudflare/site/film/render.mjs <audio folder> <output folder> [--stills]
// --stills writes two frames per scene as PNGs, to check the layout before the full render.
import { spawn } from "node:child_process";
import { mkdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const [audio, out, mode] = process.argv.slice(2);
if (!audio || !out) throw new Error("usage: node render.mjs <audio folder> <output folder> [--stills]");
mkdirSync(out, { recursive: true });
const FPS = 30;
const timeline = JSON.parse(readFileSync(join(audio, "timeline.json"), "utf8"));
const { chromium } = createRequire(import.meta.url)("playwright");

const run = (args, input) => new Promise((done, fail) => {
  const child = spawn("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", ...args], { stdio: [input ? "pipe" : "ignore", "inherit", "inherit"] });
  child.on("exit", (code) => (code === 0 ? done() : fail(new Error(`ffmpeg exited ${code}`))));
  if (input) input(child.stdin);
});

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
await page.addInitScript((value) => { window.TIMELINE = value; }, timeline);
await page.goto(new URL("./scenes.html", import.meta.url).href);
await page.evaluate(async () => { await document.fonts.ready; await Promise.all([...document.images].map((image) => image.decode().catch(() => {}))); });
const shot = async (t) => { await page.evaluate((at) => window.seek(at), t); return page.screenshot({ type: "png" }); };

if (mode === "--stills") {
  const { writeFileSync } = await import("node:fs");
  for (const scene of timeline.scenes) {
    for (const [name, at] of [["a", scene.length * .45], ["b", scene.length - .7]]) writeFileSync(join(out, `${scene.id}-${name}.png`), await shot(scene.start + at));
  }
  await browser.close();
  process.exit(0);
}

const frames = Math.round(timeline.total * FPS);
const silent = join(out, "picture.mp4");
await run(["-f", "image2pipe", "-framerate", String(FPS), "-i", "-", "-c:v", "libx264", "-preset", "slow", "-crf", "18", "-pix_fmt", "yuv420p", silent], async (stdin) => {
  for (let frame = 0; frame < frames; frame++) {
    const png = await shot(frame / FPS);
    if (!stdin.write(png)) await new Promise((done) => stdin.once("drain", done));
    if (frame % 150 === 0) console.log(`frame ${frame}/${frames}`);
  }
  stdin.end();
});
await browser.close();

// Voice clips at their scene's place, music under them, lowered while the voice speaks.
const voices = timeline.scenes.map((scene) => ["-i", join(audio, `voice-${scene.id}.mp3`)]).flat();
const delays = timeline.scenes.map((scene, i) => `[${i + 2}:a]adelay=${Math.round(scene.voiceAt * 1000)}|${Math.round(scene.voiceAt * 1000)},volume=1.6[v${i}]`).join(";");
const mixVoices = `${timeline.scenes.map((_, i) => `[v${i}]`).join("")}amix=inputs=${timeline.scenes.length}:normalize=0[voice]`;
const filter = `${delays};${mixVoices};[voice]asplit[voiceout][key];[1:a]volume=0.55,afade=t=in:d=1.5,afade=t=out:st=${(timeline.total - 2.5).toFixed(2)}:d=2.5[bed];`
  + `[bed][key]sidechaincompress=threshold=0.03:ratio=8:attack=20:release=400[ducked];[ducked][voiceout]amix=inputs=2:normalize=0,loudnorm=I=-16:TP=-1.5:LRA=11[mix]`;
await run(["-i", silent, "-i", join(audio, "music.mp3"), ...voices, "-filter_complex", filter, "-map", "0:v", "-map", "[mix]",
  "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-shortest", "-movflags", "+faststart", join(out, "deliobot-film.mp4")]);
await run(["-i", silent, "-an", "-vf", "scale=1280:720", "-c:v", "libx264", "-preset", "slow", "-crf", "27", "-pix_fmt", "yuv420p", "-movflags", "+faststart", join(out, "deliobot-film-loop.mp4")]);
const poster = timeline.scenes.find((scene) => scene.id === "task") ?? timeline.scenes[0];
await run(["-ss", String(poster.start + poster.length - 1.2), "-i", silent, "-frames:v", "1", "-vf", "scale=1280:720", "-q:v", "3", join(out, "deliobot-film.jpg")]);
console.log("done", fileURLToPath(new URL(`file://${out}/deliobot-film.mp4`)));
