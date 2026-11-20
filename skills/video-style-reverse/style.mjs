import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { run as analyze } from "../video-analysis/analyze.mjs";

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

const round = (n, places = 2) => Math.round(n * 10 ** places) / 10 ** places;
const seen = (value, how) => ({ value, evidence: "seen", how });

export function shotLengths(scenes, seconds) {
  const cuts = [...new Set(scenes)].filter((t) => t >= 0 && t < seconds).sort((a, b) => a - b);
  if (!cuts.length || cuts[0] > 0) cuts.unshift(0);
  return cuts.map((t, i) => round((cuts[i + 1] ?? seconds) - t)).filter((n) => n > 0);
}

export function pacing(scenes, seconds) {
  const shots = shotLengths(scenes, seconds);
  const sorted = [...shots].sort((a, b) => a - b);
  const median = sorted.length ? sorted[Math.floor(sorted.length / 2)] : 0;
  return {
    shots: shots.length,
    averageShot: round(shots.reduce((s, n) => s + n, 0) / (shots.length || 1)),
    medianShot: median,
    shortestShot: sorted[0] ?? 0,
    longestShot: sorted.at(-1) ?? 0,
    cutsPerMinute: seconds ? round(((shots.length - 1) / seconds) * 60, 1) : 0,
  };
}

const hex = ([r, g, b]) => `#${[r, g, b].map((v) => Math.round(v).toString(16).padStart(2, "0")).join("")}`;

export function colourStats(pixels) {
  const buckets = new Map();
  let light = 0;
  let saturation = 0;
  let warm = 0;
  const count = Math.floor(pixels.length / 3);
  for (let i = 0; i < count; i++) {
    const r = pixels[i * 3], g = pixels[i * 3 + 1], b = pixels[i * 3 + 2];
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    light += (max + min) / 510;
    saturation += max ? (max - min) / max : 0;
    if (r > b + 16) warm++;
    const key = ((r >> 5) << 6) | ((g >> 5) << 3) | (b >> 5);
    const bucket = buckets.get(key) ?? { n: 0, r: 0, g: 0, b: 0 };
    bucket.n++; bucket.r += r; bucket.g += g; bucket.b += b;
    buckets.set(key, bucket);
  }
  const palette = [...buckets.values()].sort((a, b) => b.n - a.n).slice(0, 6)
    .map((bucket) => ({ colour: hex([bucket.r / bucket.n, bucket.g / bucket.n, bucket.b / bucket.n]), share: round(bucket.n / (count || 1)) }));
  return { palette, brightness: round(light / (count || 1)), saturation: round(saturation / (count || 1)), warmShare: round(warm / (count || 1)) };
}

function framePixels(file, ffmpeg) {
  const out = spawnSync(ffmpeg, ["-v", "error", "-i", file, "-vf", "scale=48:48", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"], { maxBuffer: 1 << 20 });
  return out.status === 0 ? out.stdout : Buffer.alloc(0);
}

export function speech(transcript, seconds) {
  const segments = Array.isArray(transcript?.segments) ? transcript.segments : [];
  const words = segments.reduce((sum, s) => sum + String(s.text ?? "").split(/\s+/).filter(Boolean).length, 0);
  const spoken = segments.reduce((sum, s) => sum + Math.max(0, (s.end ?? s.start) - s.start), 0);
  const gaps = segments.slice(1).map((s, i) => s.start - (segments[i].end ?? segments[i].start)).filter((g) => g > 0.6);
  return {
    words,
    wordsPerMinute: spoken ? Math.round((words / spoken) * 60) : 0,
    talkShare: seconds ? round(spoken / seconds) : 0,
    pausesOver600ms: gaps.length,
    language: transcript?.language ?? null,
  };
}

export function styleOf(analysis, colours, transcript) {
  const style = {
    source: analysis.file,
    seconds: seen(analysis.seconds, "ffprobe"),
    shape: seen(analysis.shape, "frame size"),
    size: seen(analysis.video ? `${analysis.video.width}x${analysis.video.height} at ${analysis.video.fps} fps` : null, "ffprobe"),
    pacing: seen(pacing(analysis.scenes, analysis.seconds), "scene changes over 30% of the picture; a jump cut with little change is missed, so the count is a minimum"),
    colour: seen(colours, "pixels of the sampled stills"),
    sound: seen({ loudness: analysis.loudness, silences: analysis.silence.length, hasAudio: Boolean(analysis.audio) }, "ffmpeg volume and silence detection"),
    blackFrames: seen(analysis.black.length, "ffmpeg black detection"),
    stills: analysis.frames.map((f) => f.file),
    contactSheet: analysis.contactSheet,
    toInfer: ["on-screen text style (size, weight, case, position, colour)", "framing (close-ups, wide shots, punch-ins)", "camera motion and transitions", "graphics and overlays", "hook in the first 2 seconds", "structure (hook, problem, proof, call to action)"],
    unknown: ["the editing software and project layers", "exact font names", "effects stacks and plug-ins", "sound effects (they cannot be told apart from music reliably)"],
  };
  if (transcript) style.speech = seen(speech(transcript, analysis.seconds), "transcript timestamps");
  else style.toInfer.push("speech pace (run transcribe_audio and pass --transcript to measure it)");
  return style;
}

const closeness = (a, b) => (a === b ? 1 : 1 - Math.min(1, Math.abs(a - b) / Math.max(Math.abs(a), Math.abs(b), 1e-9)));

export function compare(original, rebuild) {
  const o = original, r = rebuild;
  const dims = {
    averageShot: closeness(o.pacing.value.averageShot, r.pacing.value.averageShot),
    cutsPerMinute: closeness(o.pacing.value.cutsPerMinute, r.pacing.value.cutsPerMinute),
    brightness: closeness(o.colour.value.brightness, r.colour.value.brightness),
    saturation: closeness(o.colour.value.saturation, r.colour.value.saturation),
    warmth: 1 - Math.min(1, Math.abs(o.colour.value.warmShare - r.colour.value.warmShare)),
    shape: o.shape.value === r.shape.value ? 1 : 0,
  };
  const oLoud = o.sound.value.loudness?.meanDb, rLoud = r.sound.value.loudness?.meanDb;
  if (typeof oLoud === "number" && typeof rLoud === "number") dims.loudness = 1 - Math.min(1, Math.abs(oLoud - rLoud) / 12);
  if (o.speech && r.speech) dims.speechPace = closeness(o.speech.value.wordsPerMinute, r.speech.value.wordsPerMinute);
  const scores = Object.fromEntries(Object.entries(dims).map(([k, v]) => [k, round(v)]));
  const overall = round(Object.values(dims).reduce((s, v) => s + v, 0) / Object.values(dims).length);
  const gaps = [];
  if (scores.averageShot < 0.8) gaps.push(`shots average ${r.pacing.value.averageShot}s against ${o.pacing.value.averageShot}s: ${r.pacing.value.averageShot > o.pacing.value.averageShot ? "cut faster" : "hold shots longer"}`);
  if (scores.cutsPerMinute < 0.8) gaps.push(`${r.pacing.value.cutsPerMinute} cuts a minute against ${o.pacing.value.cutsPerMinute}`);
  if (scores.brightness < 0.85) gaps.push(`the picture is ${r.colour.value.brightness > o.colour.value.brightness ? "brighter" : "darker"} than the original`);
  if (scores.saturation < 0.85) gaps.push(`colours are ${r.colour.value.saturation > o.colour.value.saturation ? "more" : "less"} saturated than the original`);
  if (scores.warmth < 0.85) gaps.push(`the grade is ${r.colour.value.warmShare > o.colour.value.warmShare ? "warmer" : "cooler"} than the original`);
  if (scores.shape === 0) gaps.push(`the shape is ${r.shape.value}, the original is ${o.shape.value}`);
  if (dims.loudness !== undefined && scores.loudness < 0.8) gaps.push(`the mix is ${rLoud > oLoud ? "louder" : "quieter"} (${rLoud} dB against ${oLoud} dB)`);
  if (dims.speechPace !== undefined && scores.speechPace < 0.85) gaps.push(`speech runs at ${r.speech.value.wordsPerMinute} words a minute against ${o.speech.value.wordsPerMinute}`);
  return { overall, scores, gaps };
}

export function run(argv, tools = {}) {
  const args = parseArgs(argv);
  if (args.compare) {
    const original = JSON.parse(readFileSync(resolve(args.compare), "utf8"));
    const rebuild = JSON.parse(readFileSync(resolve(args.with ?? ""), "utf8"));
    return { ok: true, ...compare(original, rebuild) };
  }
  if (!args.video || !args.out) throw new Error("usage: node style.mjs --video <file> --out <folder> [--transcript <transcript.json>] [--frames 16] | --compare <style.json> --with <rebuild-style.json>");
  const out = resolve(args.out);
  const analysis = analyze(["--video", args.video, "--out", out, "--frames", String(args.frames ?? 16)], tools);
  if (!analysis.ok) return analysis;
  const pixels = Buffer.concat(analysis.frames.map((f) => framePixels(f.file, tools.ffmpeg ?? "ffmpeg")));
  const transcript = args.transcript ? JSON.parse(readFileSync(resolve(args.transcript), "utf8")) : null;
  const style = styleOf(analysis, colourStats(pixels), transcript);
  const file = join(out, "style.json");
  writeFileSync(file, `${JSON.stringify(style, null, 2)}\n`);
  return { ok: true, style: file, pacing: style.pacing.value, colour: style.colour.value, ...(style.speech ? { speech: style.speech.value } : {}), contactSheet: style.contactSheet };
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
