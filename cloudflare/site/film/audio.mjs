// The film's sound: one French voice-over clip per scene and a music bed, made with fal.ai, then the scenes' timing
// fitted to the real length of each clip.
//   node cloudflare/site/film/audio.mjs <out folder>
// The fal key is added to queue.fal.run requests by the session's network proxy; FAL_KEY is only a placeholder there.
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const out = process.argv[2];
if (!out) throw new Error("usage: node audio.mjs <out folder>");
mkdirSync(out, { recursive: true });
const script = JSON.parse(readFileSync(new URL("./voix.json", import.meta.url), "utf8"));
const auth = { authorization: `Key ${process.env.FAL_KEY ?? "proxy-injected"}`, "content-type": "application/json" };
/** The voice starts this long into its scene, and the scene holds this long after it ends. */
const LEAD_S = 0.7, TAIL_S = 1.1;

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

async function save(url, file) {
  writeFileSync(file, Buffer.from(await (await fetch(url)).arrayBuffer()));
  return Number(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file]).toString().trim());
}

const scenes = [];
let start = 0;
for (const [index, scene] of script.scenes.entries()) {
  const result = await fal("fal-ai/elevenlabs/tts/multilingual-v2", {
    text: scene.text, voice: script.voice, language_code: "fr", stability: 0.55, similarity_boost: 0.8, style: 0.15, speed: 1,
    previous_text: script.scenes[index - 1]?.text ?? null, next_text: script.scenes[index + 1]?.text ?? null,
  });
  const voice = await save(result.audio.url, join(out, `voice-${scene.id}.mp3`));
  const length = Math.max(scene.min, LEAD_S + voice + TAIL_S);
  scenes.push({ id: scene.id, start: Number(start.toFixed(2)), length: Number(length.toFixed(2)), voiceAt: Number((start + LEAD_S).toFixed(2)), voice: Number(voice.toFixed(2)) });
  console.log(`${scene.id}: voice ${voice.toFixed(1)} s, scene ${length.toFixed(1)} s`);
  start += length;
}
const total = Number(start.toFixed(2));
const music = await fal("fal-ai/elevenlabs/music", { prompt: script.music, music_length_ms: Math.ceil((total + 2) * 1000), force_instrumental: true });
const musicLength = await save(music.audio?.url ?? music.audio_file?.url, join(out, "music.mp3"));
writeFileSync(join(out, "timeline.json"), JSON.stringify({ total, scenes }, null, 2));
console.log(`total ${total} s, music ${musicLength.toFixed(1)} s`);
