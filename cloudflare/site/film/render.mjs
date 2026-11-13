// Renders a film: each frame of its scenes page drawn at its exact time and piped to ffmpeg, then mixed with the
// voice-over and music its audio script made.
//   node cloudflare/site/film/render.mjs <audio folder> <output folder> [--stills|--mix] [--film=rush]
// --film picks the variant: "scenes" (default, 30 fps, deliobot-film.*) or "rush" (60 fps, cut on the beat, with grain,
// deliobot-rush.*). --stills writes frames per scene as PNGs, to check the layout before the full render; --mix only
// remixes the sound onto the picture already rendered.
import { spawn } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";

const args = process.argv.slice(2);
const [audio, out] = args.filter((arg) => !arg.startsWith("--"));
const mode = args.find((arg) => arg === "--stills" || arg === "--mix");
const variant = args.find((arg) => arg.startsWith("--film="))?.slice(7) ?? "scenes";
if (!audio || !out) throw new Error("usage: node render.mjs <audio folder> <output folder> [--stills|--mix] [--film=rush]");
const FILMS = {
  scenes: { page: "scenes.html", fps: 30, name: "deliobot-film", poster: "task", grain: "", duck: "threshold=0.03:ratio=8", music: 0.55 },
  rush: { page: "rush.html", fps: 60, name: "deliobot-rush", poster: "offer", grain: ",noise=alls=5:allf=t", duck: "threshold=0.06:ratio=4", music: 0.8 },
};
const film = FILMS[variant];
if (!film) throw new Error(`unknown film ${variant}`);
mkdirSync(out, { recursive: true });
const timeline = JSON.parse(readFileSync(join(audio, "timeline.json"), "utf8"));
const { chromium } = createRequire(import.meta.url)("playwright");

const run = (ffmpegArgs, input) => new Promise((done, fail) => {
  const child = spawn("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", ...ffmpegArgs], { stdio: [input ? "pipe" : "ignore", "inherit", "inherit"] });
  child.on("exit", (code) => (code === 0 ? done() : fail(new Error(`ffmpeg exited ${code}`))));
  if (input) input(child.stdin);
});

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
await page.addInitScript((value) => { window.TIMELINE = value; }, timeline);
await page.goto(new URL(`./${film.page}`, import.meta.url).href);
await page.evaluate(async () => { await document.fonts.ready; await Promise.all([...document.images].map((image) => image.decode().catch(() => {}))); });
const shot = async (t) => { await page.evaluate((at) => window.seek(at), t); return page.screenshot({ type: "png" }); };

if (mode === "--stills") {
  for (const scene of timeline.scenes) {
    const marks = variant === "rush" ? [.15, .35, .55, .8, .97] : [.45, 1 - .7 / scene.length];
    for (const [i, share] of marks.entries()) writeFileSync(join(out, `${scene.id}-${i}.png`), await shot(scene.start + scene.length * share));
  }
  await browser.close();
  process.exit(0);
}

const frames = Math.round(timeline.total * film.fps);
const silent = join(out, `${film.name}-picture.mp4`);
if (mode !== "--mix") await run(["-f", "image2pipe", "-framerate", String(film.fps), "-i", "-", "-c:v", "libx264", "-preset", "slow", "-crf", "18", "-pix_fmt", "yuv420p", silent], async (stdin) => {
  for (let frame = 0; frame < frames; frame++) {
    const png = await shot(frame / film.fps);
    if (!stdin.write(png)) await new Promise((done) => stdin.once("drain", done));
    if (frame % 300 === 0) console.log(`frame ${frame}/${frames}`);
  }
  stdin.end();
});
await browser.close();

// Voice clips at their scene's place, music from its first downbeat under them, lowered while the voice speaks.
const voices = timeline.scenes.map((scene) => ["-i", join(audio, `voice-${scene.id}.mp3`)]).flat();
const delays = timeline.scenes.map((scene, i) => `[${i + 2}:a]adelay=${Math.round(scene.voiceAt * 1000)}|${Math.round(scene.voiceAt * 1000)},volume=1.6[v${i}]`).join(";");
// The voice track lasts the whole film, so the music it lowers plays to the end.
const mixVoices = `${timeline.scenes.map((_, i) => `[v${i}]`).join("")}amix=inputs=${timeline.scenes.length}:normalize=0,apad=whole_dur=${timeline.total}[voice]`;
const offset = timeline.musicOffset ?? 0;
const filter = `${delays};${mixVoices};[voice]asplit[voiceout][key];[1:a]atrim=start=${offset},asetpts=PTS-STARTPTS,volume=${film.music},afade=t=in:d=${offset ? 0.05 : 1.5},afade=t=out:st=${(timeline.total - 2).toFixed(2)}:d=2[bed];`
  + `[bed][key]sidechaincompress=${film.duck}:attack=20:release=300[ducked];[ducked][voiceout]amix=inputs=2:normalize=0,loudnorm=I=-15:TP=-1.5:LRA=9[mix]`;
await run(["-i", silent, "-i", join(audio, "music.mp3"), ...voices, "-filter_complex", filter, "-map", "0:v", "-map", "[mix]",
  ...(film.grain ? ["-vf", film.grain.slice(1), "-c:v", "libx264", "-preset", "slow", "-crf", "19", "-pix_fmt", "yuv420p"] : ["-c:v", "copy"]),
  "-c:a", "aac", "-b:a", "192k", "-t", String(timeline.total), "-movflags", "+faststart", join(out, `${film.name}.mp4`)]);
await run(["-i", silent, "-an", "-vf", `scale=1280:720,fps=30${film.grain}`, "-c:v", "libx264", "-preset", "slow", "-crf", "27", "-pix_fmt", "yuv420p", "-movflags", "+faststart", join(out, `${film.name}-loop.mp4`)]);
const poster = timeline.scenes.find((scene) => scene.id === film.poster) ?? timeline.scenes[0];
await run(["-ss", String(poster.start + poster.length - 1.2), "-i", silent, "-frames:v", "1", "-vf", "scale=1280:720", "-q:v", "3", join(out, `${film.name}.jpg`)]);
console.log("done", join(out, `${film.name}.mp4`));
