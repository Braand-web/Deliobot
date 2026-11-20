import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { extname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

export const SIZES = { "9:16": [1080, 1920], "16:9": [1920, 1080], "1:1": [1080, 1080], "4:5": [1080, 1350] };
const IMAGE = new Set([".png", ".jpg", ".jpeg", ".webp"]);
const FPS = 30;

export const INSTALL_HINT = {
  win32: "winget install --id Gyan.FFmpeg -e",
  darwin: "brew install ffmpeg",
  linux: "sudo apt-get install -y ffmpeg",
};

function parseArgs(argv) {
  const args = { clips: [] };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith("--")) { args.clips.push(arg); continue; }
    const key = arg.slice(2);
    if (["keep-clip-audio", "pad", "no-fade"].includes(key)) args[key] = true;
    else args[key] = argv[++i];
  }
  return args;
}

const seconds = (value, name) => {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) throw new Error(`${name} must be a positive number of seconds`);
  return n;
};

export function parseClip(spec) {
  const match = /^(.*?)(?::(\d+(?:\.\d+)?))?$/.exec(spec);
  const path = resolve(match[1]);
  const image = IMAGE.has(extname(path).toLowerCase());
  return { path, image, ...(match[2] ? { seconds: seconds(match[2], `the length of ${match[1]}`) } : image ? { seconds: 3 } : {}) };
}

const srtTime = (t) => {
  const ms = Math.round(t * 1000);
  const pad = (n, w = 2) => String(n).padStart(w, "0");
  return `${pad(Math.floor(ms / 3_600_000))}:${pad(Math.floor(ms / 60_000) % 60)}:${pad(Math.floor(ms / 1000) % 60)},${pad(ms % 1000, 3)}`;
};

export function captionsToSrt(captions) {
  if (!Array.isArray(captions) || !captions.length) throw new Error("captions must be a list of {start, end, text}");
  return captions.map((cue, index) => {
    const start = Number(cue.start);
    const end = Number(cue.end);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start || start < 0) throw new Error(`captions[${index}] needs start < end, in seconds`);
    const text = String(cue.text ?? "").replace(/\r/g, "").trim();
    if (!text) throw new Error(`captions[${index}].text is empty`);
    return `${index + 1}\n${srtTime(start)} --> ${srtTime(end)}\n${text}\n`;
  }).join("\n");
}

export function probe(path, tools = {}) {
  const out = spawnSync(tools.ffprobe ?? "ffprobe", ["-v", "error", "-show_entries", "format=duration:stream=codec_type,width,height", "-of", "json", path], { encoding: "utf8" });
  if (out.error) throw out.error;
  if (out.status !== 0) throw new Error(`cannot read ${path}: ${out.stderr.trim().slice(0, 300)}`);
  const info = JSON.parse(out.stdout);
  const video = info.streams?.find((s) => s.codec_type === "video");
  return { seconds: Number(info.format?.duration) || 0, audio: Boolean(info.streams?.some((s) => s.codec_type === "audio")), width: video?.width ?? 0, height: video?.height ?? 0 };
}

const filterPath = (path) => path.replace(/\\/g, "/").replace(/:/g, "\\:").replace(/'/g, "\\'");

const ENCODERS = ["libx264", "h264_videotoolbox", "h264_mf", "libopenh264", "mpeg4"];

export function videoCodecArgs(encoder) {
  return encoder === "libx264" ? ["-c:v", "libx264", "-preset", "medium", "-crf", "20"] : ["-c:v", encoder, "-b:v", "8M"];
}

export function abilities(ffmpeg) {
  const encoders = spawnSync(ffmpeg, ["-hide_banner", "-encoders"], { encoding: "utf8" }).stdout ?? "";
  const filters = spawnSync(ffmpeg, ["-hide_banner", "-filters"], { encoding: "utf8" }).stdout ?? "";
  return {
    encoder: ENCODERS.find((name) => new RegExp(`\\s${name}\\s`).test(encoders)) ?? "mpeg4",
    subtitles: /\ssubtitles\s/.test(filters),
  };
}

export function plan(options) {
  const [width, height] = SIZES[options.aspect ?? "9:16"] ?? (() => { throw new Error(`aspect must be one of ${Object.keys(SIZES).join(", ")}`); })();
  if (!options.clips.length) throw new Error("give at least one clip: a video file, or an image as path:seconds");
  const inputs = [];
  const parts = [];
  let total = 0;
  options.clips.forEach((clip, index) => {
    const length = clip.image ? clip.seconds : Math.min(clip.seconds ?? clip.probe.seconds, clip.probe.seconds);
    if (!(length > 0)) throw new Error(`${clip.path} has no length`);
    inputs.push(...(clip.image ? ["-loop", "1", "-t", String(length)] : ["-t", String(length)]), "-i", clip.path);
    const fit = options.pad
      ? `scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:color=black`
      : `scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height}`;
    const motion = clip.image ? `,zoompan=z='min(zoom+0.0008,1.12)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${Math.round(length * FPS)}:s=${width}x${height}:fps=${FPS}` : "";
    parts.push(`[${index}:v]${fit}${motion},setsar=1,fps=${FPS},format=yuv420p,trim=duration=${length},setpts=PTS-STARTPTS[v${index}]`);
    if (options.keepClipAudio) {
      parts.push(clip.image || !clip.probe.audio
        ? `anullsrc=r=48000:cl=stereo,atrim=duration=${length}[a${index}]`
        : `[${index}:a]aresample=48000,aformat=channel_layouts=stereo,atrim=duration=${length},asetpts=PTS-STARTPTS[a${index}]`);
    }
    total += length;
  });
  const n = options.clips.length;
  const joined = options.keepClipAudio
    ? `${options.clips.map((_, i) => `[v${i}][a${i}]`).join("")}concat=n=${n}:v=1:a=1[vj][aj]`
    : `${options.clips.map((_, i) => `[v${i}]`).join("")}concat=n=${n}:v=1:a=0[vj]`;
  parts.push(joined);
  let video = "vj";
  const fades = options.fade === false ? "" : `,fade=t=in:st=0:d=0.3,fade=t=out:st=${Math.max(0, total - 0.4).toFixed(3)}:d=0.4`;
  const subtitles = options.srt ? `,subtitles='${filterPath(options.srt)}':force_style='FontName=${options.font ?? "Arial"},FontSize=${options.aspect === "16:9" ? 22 : 15},Bold=1,PrimaryColour=&H00FFFFFF,OutlineColour=&H00000000,BorderStyle=1,Outline=3,Shadow=0,Alignment=2,MarginV=${options.aspect === "16:9" ? 40 : 90}'` : "";
  parts.push(`[${video}]null${fades}${subtitles}[vout]`);
  video = "vout";

  const sources = [];
  let next = n;
  if (options.keepClipAudio) sources.push({ label: "aj", kind: "clips" });
  if (options.voice) { inputs.push("-i", options.voice); sources.push({ label: `${next++}:a`, kind: "voice" }); }
  if (options.music) { inputs.push("-stream_loop", "-1", "-i", options.music); sources.push({ label: `${next++}:a`, kind: "music" }); }
  let audio = null;
  if (sources.length) {
    const named = sources.map((source, i) => {
      parts.push(`[${source.label}]aresample=48000,aformat=channel_layouts=stereo,apad,atrim=duration=${total}${source.kind === "music" ? `,volume=${options.musicVolume ?? 0.3}` : ""}[s${i}]`);
      return { ...source, label: `s${i}` };
    });
    const voice = named.find((s) => s.kind === "voice");
    const music = named.find((s) => s.kind === "music");
    const others = named.filter((s) => s.kind !== "music" && s.kind !== "voice");
    const layers = others.map((s) => `[${s.label}]`);
    if (voice && music) {
      parts.push(`[${voice.label}]asplit=2[vk][vm]`, `[${music.label}][vk]sidechaincompress=threshold=0.03:ratio=8:attack=20:release=400[ducked]`);
      layers.push("[vm]", "[ducked]");
    } else {
      if (voice) layers.push(`[${voice.label}]`);
      if (music) layers.push(`[${music.label}]`);
    }
    if (layers.length === 1) parts.push(`${layers[0]}anull[aout]`);
    else parts.push(`${layers.join("")}amix=inputs=${layers.length}:duration=first:normalize=0,alimiter=limit=0.95[aout]`);
    audio = "aout";
  }
  const args = ["-y", "-hide_banner", "-loglevel", "error", ...inputs, "-filter_complex", parts.join(";"), "-map", `[${video}]`,
    ...(audio ? ["-map", `[${audio}]`, "-c:a", "aac", "-b:a", "192k"] : []),
    ...videoCodecArgs(options.encoder ?? "libx264"), "-pix_fmt", "yuv420p", "-movflags", "+faststart", "-t", total.toFixed(3), options.out];
  return { args, seconds: total, width, height, audio: Boolean(audio) };
}

export function run(argv, tools = {}) {
  const args = parseArgs(argv);
  const ffmpeg = tools.ffmpeg ?? "ffmpeg";
  const check = spawnSync(ffmpeg, ["-version"], { encoding: "utf8" });
  if (check.error || check.status !== 0) {
    return { ok: false, error: "ffmpeg is not ready on this computer yet. Deliobot installs it by itself in the background: try again in a minute. If it is still missing after a few minutes, ask the person before installing it with the command in `install`.", install: INSTALL_HINT[process.platform] ?? INSTALL_HINT.linux };
  }
  if (!args.out) throw new Error("usage: node montage.mjs --out final.mp4 [--aspect 9:16|16:9|1:1|4:5] [--voice voice.mp3] [--music music.mp3] [--music-volume 0.3] [--captions captions.json|captions.srt] [--keep-clip-audio] [--pad] [--no-fade] clip1.mp4 image.png:3 …");
  const clips = args.clips.map(parseClip);
  for (const clip of clips) {
    if (!existsSync(clip.path)) throw new Error(`not found: ${clip.path}`);
    if (!clip.image) clip.probe = probe(clip.path, tools);
  }
  for (const file of [args.voice, args.music, args.captions].filter(Boolean)) if (!existsSync(resolve(file))) throw new Error(`not found: ${file}`);
  const can = abilities(ffmpeg);
  const work = mkdtempSync(join(tmpdir(), "montage-"));
  try {
    let srt;
    if (args.captions && can.subtitles) {
      const raw = readFileSync(resolve(args.captions), "utf8");
      srt = join(work, "captions.srt");
      writeFileSync(srt, extname(args.captions).toLowerCase() === ".srt" ? raw : captionsToSrt(JSON.parse(raw)));
    }
    const built = plan({
      clips, out: resolve(args.out), aspect: args.aspect ?? "9:16", voice: args.voice && resolve(args.voice), music: args.music && resolve(args.music),
      musicVolume: args["music-volume"] === undefined ? undefined : Number(args["music-volume"]), keepClipAudio: Boolean(args["keep-clip-audio"]),
      pad: Boolean(args.pad), fade: !args["no-fade"], srt, font: args.font, encoder: can.encoder,
    });
    const result = spawnSync(ffmpeg, built.args, { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
    if (result.status !== 0) throw new Error(`ffmpeg failed: ${(result.stderr || "").trim().slice(-800)}`);
    const made = probe(resolve(args.out), tools);
    return { ok: true, out: resolve(args.out), seconds: Math.round(made.seconds * 100) / 100, width: made.width, height: made.height, audio: made.audio, clips: clips.length,
      ...(args.captions && !can.subtitles ? { captions: "not burned in: this ffmpeg cannot draw subtitles; send the .srt with the video instead" } : {}) };
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
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
