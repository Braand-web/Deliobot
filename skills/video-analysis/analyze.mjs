import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith("--")) args[argv[i].slice(2)] = argv[i + 1]?.startsWith("--") || argv[i + 1] === undefined ? true : argv[++i];
  }
  return args;
}

const tool = (name, tools) => tools[name] ?? name;

function ffmpeg(args, tools) {
  return spawnSync(tool("ffmpeg", tools), ["-hide_banner", "-nostats", ...args], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
}

export function probe(video, tools = {}) {
  const out = spawnSync(tool("ffprobe", tools), ["-v", "error", "-show_entries", "format=duration,size,bit_rate:stream=codec_type,codec_name,width,height,avg_frame_rate,channels,sample_rate", "-of", "json", video], { encoding: "utf8" });
  if (out.error) throw out.error;
  if (out.status !== 0) throw new Error(`cannot read ${video}: ${out.stderr.trim().slice(0, 300)}`);
  const info = JSON.parse(out.stdout);
  const v = info.streams?.find((s) => s.codec_type === "video");
  const a = info.streams?.find((s) => s.codec_type === "audio");
  const [num, den] = String(v?.avg_frame_rate ?? "0/1").split("/").map(Number);
  return {
    seconds: Math.round((Number(info.format?.duration) || 0) * 100) / 100,
    bytes: Number(info.format?.size) || 0,
    video: v ? { codec: v.codec_name, width: v.width, height: v.height, fps: den ? Math.round((num / den) * 100) / 100 : 0 } : null,
    audio: a ? { codec: a.codec_name, channels: a.channels, sampleRate: Number(a.sample_rate) } : null,
  };
}

export function sceneChanges(stderr) {
  return [...stderr.matchAll(/pts_time:(\d+(?:\.\d+)?)/g)].map((m) => Math.round(Number(m[1]) * 100) / 100);
}

export function spans(stderr, kind) {
  const start = kind === "black" ? /black_start:(\d+(?:\.\d+)?)/ : /silence_start: (-?\d+(?:\.\d+)?)/;
  const end = kind === "black" ? /black_end:(\d+(?:\.\d+)?)/ : /silence_end: (\d+(?:\.\d+)?)/;
  const out = [];
  let open = null;
  for (const line of stderr.split("\n")) {
    const s = start.exec(line);
    if (s) open = Math.max(0, Number(s[1]));
    const e = end.exec(line);
    if (e && open !== null) { out.push({ start: Math.round(open * 100) / 100, end: Math.round(Number(e[1]) * 100) / 100 }); open = null; }
  }
  return out;
}

export function pickMoments(seconds, scenes, count) {
  if (!(seconds > 0) || count < 1) return [];
  const gap = Math.max(0.5, seconds / (count * 3));
  const near = (list, t) => list.some((k) => Math.abs(k - t) < gap);
  const cuts = [];
  for (const t of scenes.filter((t) => t > 0.2 && t < seconds - 0.1).map((t) => t + 0.15)) if (!near(cuts, t)) cuts.push(t);
  const chosen = cuts.length > count ? Array.from({ length: count }, (_, i) => cuts[Math.floor((i * cuts.length) / count)]) : [...cuts];
  const even = Array.from({ length: count }, (_, i) => (seconds * (i + 0.5)) / count);
  for (const t of even) if (chosen.length < count && !near(chosen, t)) chosen.push(t);
  return chosen.sort((a, b) => a - b).map((t) => Math.round(t * 100) / 100);
}

export function run(argv, tools = {}) {
  const args = parseArgs(argv);
  if (!args.video || !args.out) throw new Error("usage: node analyze.mjs --video <file> --out <folder> [--frames 12]");
  const check = spawnSync(tool("ffmpeg", tools), ["-version"], { encoding: "utf8" });
  if (check.error || check.status !== 0) return { ok: false, error: "ffmpeg is not ready on this computer yet. Deliobot installs it by itself in the background: try again in a minute." };
  const video = resolve(args.video);
  if (!existsSync(video)) throw new Error(`not found: ${video}`);
  const out = resolve(args.out);
  mkdirSync(out, { recursive: true });
  const count = Math.min(Math.max(Number(args.frames) || 12, 1), 48);
  const info = probe(video, tools);

  const scan = ffmpeg(["-protocol_whitelist", "file", "-i", video, "-vf", "select='gt(scene,0.3)',showinfo,blackdetect=d=0.4:pix_th=0.1", ...(info.audio ? ["-af", "silencedetect=n=-40dB:d=1,volumedetect"] : ["-an"]), "-f", "null", "-"], tools);
  if (scan.status !== 0) throw new Error(`ffmpeg could not read ${basename(video)}: ${scan.stderr.trim().slice(-300)}`);
  const scenes = sceneChanges(scan.stderr.split("\n").filter((l) => l.includes("Parsed_showinfo")).join("\n"));
  const black = spans(scan.stderr, "black");
  const silence = info.audio ? spans(scan.stderr, "silence") : [];
  const mean = /mean_volume: (-?\d+(?:\.\d+)?) dB/.exec(scan.stderr);
  const peak = /max_volume: (-?\d+(?:\.\d+)?) dB/.exec(scan.stderr);

  const frames = [];
  for (const [index, at] of pickMoments(info.seconds, scenes, count).entries()) {
    const file = join(out, `frame-${String(index + 1).padStart(2, "0")}-${at.toFixed(2)}s.jpg`);
    const made = ffmpeg(["-loglevel", "error", "-ss", String(at), "-protocol_whitelist", "file", "-i", video, "-frames:v", "1", "-vf", "scale='min(768,iw)':-2", "-q:v", "4", "-y", file], tools);
    if (made.status === 0 && existsSync(file)) frames.push({ at, file });
  }
  const sheet = join(out, "contact-sheet.jpg");
  const columns = Math.min(4, Math.max(frames.length, 1));
  const tiled = frames.length && ffmpeg(["-loglevel", "error", ...frames.flatMap((f) => ["-i", f.file]), "-filter_complex",
    `${frames.map((_, i) => `[${i}:v]scale=320:-2,pad=320:ceil(ih/2)*2[f${i}]`).join(";")};${frames.map((_, i) => `[f${i}]`).join("")}xstack=inputs=${frames.length}:layout=${frames.map((_, i) => `${(i % columns) ? Array.from({ length: i % columns }, () => "w0").join("+") : "0"}_${Math.floor(i / columns) ? Array.from({ length: Math.floor(i / columns) }, () => "h0").join("+") : "0"}`).join("|")}:fill=black`,
    "-frames:v", "1", "-y", sheet], tools);

  const summary = {
    ok: true,
    file: video,
    ...info,
    shape: info.video ? (info.video.width > info.video.height ? "landscape" : info.video.width < info.video.height ? "portrait" : "square") : null,
    scenes: [0, ...scenes].filter((t, i, all) => all.indexOf(t) === i),
    black,
    silence,
    loudness: mean ? { meanDb: Number(mean[1]), peakDb: peak ? Number(peak[1]) : null } : null,
    frames,
    contactSheet: frames.length > 1 && tiled && tiled.status === 0 && existsSync(sheet) ? sheet : null,
  };
  writeFileSync(join(out, "analysis.json"), JSON.stringify(summary, null, 2));
  return summary;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const result = run(process.argv.slice(2));
    process.stdout.write(`${JSON.stringify(result)}\n`);
    if (!result.ok) process.exitCode = 1;
  } catch (error) {
    process.stdout.write(`${JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) })}\n`);
    process.exitCode = 1;
  }
}
