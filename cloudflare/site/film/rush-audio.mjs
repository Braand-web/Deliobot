// The variant film's sound: a music bed whose tempo is measured here, then one voice-over line per scene, each scene
// lasting whole bars of that music so the cuts land on the beat.
//   node cloudflare/site/film/rush-audio.mjs <out folder>
// The fal key is added to queue.fal.run requests by the session's network proxy; FAL_KEY is only a placeholder there.
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const out = process.argv[2];
if (!out) throw new Error("usage: node rush-audio.mjs <out folder>");
mkdirSync(out, { recursive: true });
const script = JSON.parse(readFileSync(new URL("./rush.json", import.meta.url), "utf8"));
const auth = { authorization: `Key ${process.env.FAL_KEY ?? "proxy-injected"}`, "content-type": "application/json" };
/** The voice starts this long into its scene, and the scene holds at least this long after it. */
const LEAD_S = 0.3, TAIL_S = 0.45;

async function fal(model, input) {
  const queued = await (await fetch(`https://queue.fal.run/${model}`, { method: "POST", headers: auth, body: JSON.stringify(input) })).json();
  if (!queued.response_url) throw new Error(`${model}: ${JSON.stringify(queued).slice(0, 300)}`);
  for (let tries = 0; tries < 200; tries++) {
    await new Promise((done) => setTimeout(done, 3000));
    const status = await (await fetch(queued.status_url, { headers: auth })).json();
    if (status.status === "COMPLETED") return (await fetch(queued.response_url, { headers: auth })).json();
    if (status.status && !["IN_QUEUE", "IN_PROGRESS"].includes(status.status)) throw new Error(`${model}: ${JSON.stringify(status).slice(0, 300)}`);
  }
  throw new Error(`${model}: no answer`);
}

const duration = (file) => Number(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file]).toString().trim());
async function save(url, file) {
  writeFileSync(file, Buffer.from(await (await fetch(url)).arrayBuffer()));
  return duration(file);
}

/** The music's tempo and where its beats fall: onset strength from short-time energy, then the beat grid that lands
 * on the most onsets; of the four beats a bar could start on, the one with the strongest hits. */
function beatGrid(file) {
  const RATE = 22050, HOP = 256;
  const pcm = execFileSync("ffmpeg", ["-v", "error", "-i", file, "-ac", "1", "-ar", String(RATE), "-f", "f32le", "-"], { maxBuffer: 1 << 28 });
  const samples = new Float32Array(pcm.buffer, pcm.byteOffset, pcm.length / 4);
  const energy = [];
  for (let i = 0; i + HOP <= samples.length; i += HOP) {
    let sum = 0;
    for (let j = i; j < i + HOP; j++) sum += samples[j] * samples[j];
    energy.push(Math.log(1e-6 + sum));
  }
  const onset = energy.map((value, i) => (i ? Math.max(0, value - energy[i - 1]) : 0));
  const hopS = HOP / RATE;
  let best = { score: -1, bpm: 0, phase: 0 };
  for (let bpm = 95; bpm <= 150; bpm += 0.05) {
    const period = 60 / bpm / hopS;
    for (let phase = 0; phase < period; phase += 1) {
      let score = 0, count = 0;
      for (let at = phase; at < onset.length; at += period, count++) score += onset[Math.round(at)] ?? 0;
      if (score / count > best.score) best = { score: score / count, bpm, phase };
    }
  }
  const beat = 60 / best.bpm, first = best.phase * hopS;
  const downbeat = [0, 1, 2, 3].map((k) => {
    let sum = 0;
    for (let t = first + k * beat; t * (1 / hopS) < onset.length; t += 4 * beat) sum += onset[Math.round(t / hopS)] ?? 0;
    return { k, sum };
  }).sort((a, b) => b.sum - a.sum)[0].k;
  return { bpm: Number(best.bpm.toFixed(2)), beat, offset: first + downbeat * beat };
}

const music = await fal("fal-ai/elevenlabs/music", { prompt: script.music, music_length_ms: script.musicSeconds * 1000, force_instrumental: true });
const musicLength = await save(music.audio?.url ?? music.audio_file?.url, join(out, "music.mp3"));
const grid = beatGrid(join(out, "music.mp3"));
const bar = grid.beat * 4;
console.log(`music ${musicLength.toFixed(1)} s, ${grid.bpm} BPM, first downbeat at ${grid.offset.toFixed(2)} s`);

const scenes = [];
let start = 0;
for (const [index, scene] of script.scenes.entries()) {
  const result = await fal("fal-ai/elevenlabs/tts/multilingual-v2", {
    text: scene.text, voice: script.voice, language_code: "fr", ...script.voiceSettings,
    previous_text: script.scenes[index - 1]?.text ?? null, next_text: script.scenes[index + 1]?.text ?? null,
  });
  const voice = await save(result.audio.url, join(out, `voice-${scene.id}.mp3`));
  const bars = Math.max(scene.minBars, Math.ceil((LEAD_S + voice + TAIL_S) / bar));
  const length = bars * bar;
  scenes.push({ id: scene.id, start: Number(start.toFixed(3)), length: Number(length.toFixed(3)), bars, voiceAt: Number((start + LEAD_S).toFixed(3)), voice: Number(voice.toFixed(2)) });
  console.log(`${scene.id}: voice ${voice.toFixed(1)} s, ${bars} bars = ${length.toFixed(1)} s`);
  start += length;
}
const total = Number(start.toFixed(3));
if (grid.offset + total > musicLength) console.warn(`the music is ${(grid.offset + total - musicLength).toFixed(1)} s shorter than the film; its end is padded with silence`);
writeFileSync(join(out, "timeline.json"), JSON.stringify({ total, bpm: grid.bpm, beat: grid.beat, musicOffset: grid.offset, scenes }, null, 2));
console.log(`total ${total} s`);
