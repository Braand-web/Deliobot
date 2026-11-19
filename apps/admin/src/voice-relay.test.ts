import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { nodeDatabase } from "./sql-node.ts";
import { AdminStore } from "./store.ts";
import { createVoiceRelay, INCLUDED_SPEECH_MODEL, voiceRoute } from "./voice-relay.ts";
import { MICRO, Wallet } from "./wallet.ts";

const cleanups: Array<() => void> = [];
afterEach(() => { for (const cleanup of cleanups.splice(0)) cleanup(); });

function setup(upstreamStatus = 200) {
  const dir = mkdtempSync(join(tmpdir(), "delio-voice-"));
  const db = nodeDatabase(join(dir, "portal.db"));
  cleanups.push(() => { db.close(); rmSync(dir, { recursive: true, force: true }); });
  const store = new AdminStore({ db, secret: randomBytes(32) });
  store.createWorkspace({ slug: "acme", name: "Acme", tenantUrl: "https://acme.example.test", ownerEmail: "boss@acme.test" }, "ops@delio.test");
  const wallet = new Wallet(store.db, { creditUsd: 0.01 });
  const calls: Array<{ url: string; key: string | null; body: string }> = [];
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(input), key: new Headers(init?.headers).get("xi-api-key"), body: init?.body ? new TextDecoder().decode(init.body as Uint8Array) : "" });
    return new Response(upstreamStatus === 200 ? "AUDIO" : "{}", { status: upstreamStatus, headers: { "content-type": "audio/mpeg" } });
  }) as typeof fetch;
  const relay = createVoiceRelay({ wallet, key: "operator-key", apiUrl: "https://eleven.test/v1", fetchImpl });
  const call = async (method: string, rest: string, body = "", headers: Record<string, string> = {}) => {
    const req = { method, headers, async *[Symbol.asyncIterator]() { if (body) yield Buffer.from(body); } } as unknown as IncomingMessage;
    const out = { status: 0, body: "" };
    const res = { statusCode: 200, headersSent: false, setHeader() {}, end(chunk?: Buffer | string) { out.status = res.statusCode; out.body = chunk ? String(chunk) : ""; } } as unknown as ServerResponse;
    await relay.handle(req, res, "acme", rest);
    return out;
  };
  return { wallet, calls, call };
}

describe("the included voice", () => {
  it("speaks with Deliobot's key on Flash and charges the workspace by the characters spoken", async () => {
    const { wallet, calls, call } = setup();
    wallet.credit("acme", 100 * MICRO, "grant", null);
    const reply = await call("POST", "text-to-speech/JBFqnCBsd6RMkjVDRZzb/stream?output_format=mp3_44100_128", JSON.stringify({ text: "x".repeat(1000), model_id: "eleven_v3" }));
    expect(reply).toEqual({ status: 200, body: "AUDIO" });
    expect(calls[0]!.url).toBe("https://eleven.test/v1/text-to-speech/JBFqnCBsd6RMkjVDRZzb/stream?output_format=mp3_44100_128");
    expect(calls[0]!.key).toBe("operator-key");
    expect(JSON.parse(calls[0]!.body).model_id).toBe(INCLUDED_SPEECH_MODEL);
    expect(wallet.balance("acme")).toBe(88 * MICRO);
  });

  it("refuses without credits, and charges nothing when ElevenLabs fails", async () => {
    const empty = setup();
    expect((await empty.call("POST", "text-to-speech/abc/stream", JSON.stringify({ text: "Bonjour" }))).status).toBe(402);
    expect(empty.calls).toHaveLength(0);

    const failing = setup(500);
    failing.wallet.credit("acme", 10 * MICRO, "grant", null);
    expect((await failing.call("POST", "text-to-speech/abc/stream", JSON.stringify({ text: "Bonjour" }))).status).toBe(500);
    expect(failing.wallet.balance("acme")).toBe(10 * MICRO);
  });

  it("relays only the calls the app makes", () => {
    expect(voiceRoute("GET", "voices")).toEqual({ kind: "free", method: "GET" });
    expect(voiceRoute("POST", "speech-to-text")).toEqual({ kind: "transcription" });
    expect(voiceRoute("POST", "single-use-token/realtime_scribe")).toEqual({ kind: "realtime" });
    expect(voiceRoute("DELETE", "voices/abc")).toBeNull();
    expect(voiceRoute("GET", "user/subscription")).toBeNull();
    expect(voiceRoute("POST", "text-to-speech/../user")).toBeNull();
  });
});
