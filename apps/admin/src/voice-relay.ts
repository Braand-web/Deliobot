// The included voice: a connected Deliobot app reads replies aloud and transcribes meetings through ElevenLabs with
// Delio's key, and the workspace pays in Delio credits. Only the calls the app makes are relayed.
import type { IncomingMessage, ServerResponse } from "node:http";

import type { Wallet } from "./wallet.ts";

/** ElevenLabs Flash speech, what an included voice always speaks with. */
export const INCLUDED_SPEECH_MODEL = "eleven_flash_v2_5";
/** What a workspace pays, in US dollars, priced above ElevenLabs' own rates. */
export const VOICE_PRICES = { speechPer1kChars: 0.12, transcriptionPerMb: 0.03, transcriptionMinimum: 0.005, realtimeSession: 0.05 } as const;

const MAX_SPEECH_BODY = 64 * 1024;
const MAX_AUDIO_BODY = 25 * 1024 * 1024;
const VOICE_ID = /^[A-Za-z0-9]{1,64}$/;
const OUT_OF_CREDITS = "This workspace is out of Delio credits. Open Plans and credits in Deliobot to top up.";

async function readBody(req: IncomingMessage, max: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req as AsyncIterable<Buffer>) {
    size += chunk.length;
    if (size > max) throw Object.assign(new Error("Request too large."), { status: 413 });
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

function reply(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.setHeader("cache-control", "no-store");
  res.end(JSON.stringify(body));
}
const refuse = (res: ServerResponse, status: number, message: string, code?: string) => reply(res, status, { detail: { message, ...(code ? { status: code } : {}) } });

type Route =
  | { kind: "free"; method: "GET" | "POST" }
  | { kind: "speech"; voice: string }
  | { kind: "transcription" }
  | { kind: "realtime" };

/** The ElevenLabs calls the app makes; anything else is refused. */
export function voiceRoute(method: string, path: string): Route | null {
  if (method === "GET" && (path === "voices" || path === "shared-voices")) return { kind: "free", method: "GET" };
  if (method === "POST" && /^voices\/add\/[A-Za-z0-9]{1,128}\/[A-Za-z0-9]{1,64}$/.test(path)) return { kind: "free", method: "POST" };
  const speech = /^text-to-speech\/([^/]+)(?:\/stream)?$/.exec(path);
  if (method === "POST" && speech && VOICE_ID.test(speech[1]!)) return { kind: "speech", voice: speech[1]! };
  if (method === "POST" && path === "speech-to-text") return { kind: "transcription" };
  if (method === "POST" && path === "single-use-token/realtime_scribe") return { kind: "realtime" };
  return null;
}

export function createVoiceRelay(options: { wallet: Wallet; key?: string; apiUrl?: string; fetchImpl?: typeof fetch }) {
  const { wallet } = options;
  const fetchImpl = options.fetchImpl ?? fetch;
  const api = (options.apiUrl ?? "https://api.elevenlabs.io/v1").replace(/\/+$/, "");

  async function forward(res: ServerResponse, url: string, init: RequestInit): Promise<boolean> {
    const response = await fetchImpl(url, { ...init, redirect: "error", signal: AbortSignal.timeout(90_000) });
    const bytes = Buffer.from(await response.arrayBuffer());
    res.statusCode = response.status;
    res.setHeader("content-type", response.headers.get("content-type") ?? "application/octet-stream");
    res.setHeader("cache-control", "no-store");
    res.end(bytes);
    return response.ok;
  }

  return {
    available: () => Boolean(options.key),

    /** Serves /api/gateway/<workspace>/elevenlabs/v1/<rest> for an authenticated workspace whose plan spends credits. */
    async handle(req: IncomingMessage, res: ServerResponse, workspace: string, rest: string): Promise<void> {
      if (!options.key) return refuse(res, 503, "Delio's included voice is not set up yet.");
      const [path, query = ""] = rest.split("?", 2) as [string, string?];
      const method = req.method ?? "GET";
      const route = voiceRoute(method, path);
      if (!route) return refuse(res, 404, "This voice call is not offered by Delio.");
      const target = `${api}/${path}${query ? `?${query}` : ""}`;
      const headers: Record<string, string> = { "xi-api-key": options.key };

      if (route.kind === "free") {
        const body = route.method === "POST" ? await readBody(req, MAX_SPEECH_BODY) : undefined;
        if (body?.length) headers["content-type"] = "application/json";
        await forward(res, target, { method, headers, ...(body?.length ? { body: new Uint8Array(body) } : {}) });
        return;
      }

      let body: Buffer;
      try { body = await readBody(req, route.kind === "transcription" ? MAX_AUDIO_BODY : MAX_SPEECH_BODY); } catch { return refuse(res, 413, "The request is too large."); }

      let costUsd: number, model: string, outgoing: Uint8Array | undefined = new Uint8Array(body);
      if (route.kind === "speech") {
        let input: Record<string, unknown>;
        try { input = JSON.parse(body.toString("utf8")) as Record<string, unknown>; } catch { return refuse(res, 400, "The request was not valid JSON."); }
        const text = typeof input?.text === "string" ? input.text : "";
        if (!text.trim()) return refuse(res, 400, "There is no text to speak.");
        costUsd = (text.length / 1000) * VOICE_PRICES.speechPer1kChars;
        model = INCLUDED_SPEECH_MODEL;
        outgoing = new TextEncoder().encode(JSON.stringify({ ...input, model_id: INCLUDED_SPEECH_MODEL }));
        headers["content-type"] = "application/json";
        headers.accept = req.headers.accept ?? "audio/mpeg";
      } else if (route.kind === "transcription") {
        costUsd = Math.max(VOICE_PRICES.transcriptionMinimum, (body.length / 1024 / 1024) * VOICE_PRICES.transcriptionPerMb);
        model = "scribe";
        const type = req.headers["content-type"];
        if (typeof type !== "string" || !type.startsWith("multipart/form-data")) return refuse(res, 400, "Send the audio as multipart form data.");
        headers["content-type"] = type;
      } else {
        costUsd = VOICE_PRICES.realtimeSession;
        model = "scribe-realtime";
        outgoing = undefined;
        headers.accept = "application/json";
      }

      const hold = wallet.hold(workspace, wallet.microFor(costUsd));
      if (!hold) return refuse(res, 402, OUT_OF_CREDITS, "credits_exhausted");
      try {
        const ok = await forward(res, target, { method: "POST", headers, ...(outgoing ? { body: outgoing } : {}) });
        if (ok) wallet.settle(hold.id, hold.amount, "elevenlabs", model);
        else wallet.release(hold.id);
      } catch {
        wallet.release(hold.id);
        if (!res.headersSent) refuse(res, 502, "Could not reach ElevenLabs.");
      }
    },
  };
}

export type VoiceRelay = ReturnType<typeof createVoiceRelay>;
