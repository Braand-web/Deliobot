import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { createFishRelay, FISH_PRICES, fishRoute } from "./fish-relay.ts";
import { nodeDatabase } from "./sql-node.ts";
import { AdminStore } from "./store.ts";
import { MICRO, Wallet } from "./wallet.ts";

const cleanups: Array<() => void> = [];
afterEach(() => { for (const cleanup of cleanups.splice(0)) cleanup(); });

function setup() {
  const dir = mkdtempSync(join(tmpdir(), "delio-fish-"));
  const db = nodeDatabase(join(dir, "portal.db"));
  cleanups.push(() => { db.close(); rmSync(dir, { recursive: true, force: true }); });
  const store = new AdminStore({ db, secret: randomBytes(32) });
  for (const slug of ["acme", "other"]) store.createWorkspace({ slug, name: slug, tenantUrl: `https://${slug}.example.test`, ownerEmail: `boss@${slug}.test` }, "ops@delio.test");
  const wallet = new Wallet(store.db, { creditUsd: 0.01 });
  const clock = { now: 1_000_000 };
  const calls: Array<{ url: string; method: string; auth: string | null }> = [];
  let agents = 0;
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    calls.push({ url: url.href, method: init?.method ?? "GET", auth: new Headers(init?.headers).get("authorization") });
    if (url.pathname === "/v1/agent/agents") return Response.json({ agent_id: `agent-${++agents}` });
    if (url.pathname === "/v1/agent/sessions") return Response.json({ session_id: "sess-1", transport: "livekit", token: "t", livekit_url: "wss://lk.test" });
    if (url.pathname.endsWith("/end")) return Response.json({ ended: true });
    if (url.pathname === "/v1/tts") return new Response("AUDIO", { headers: { "content-type": "audio/mpeg" } });
    return Response.json({ items: [] });
  }) as typeof fetch;
  const relay = createFishRelay({ db: store.db, wallet, key: "operator-fish", apiUrl: "https://fish.test", fetchImpl, now: () => clock.now });
  const call = async (workspace: string, method: string, rest: string, body = "") => {
    const req = { method, headers: { "content-type": "application/json" }, async *[Symbol.asyncIterator]() { if (body) yield Buffer.from(body); } } as unknown as IncomingMessage;
    const out = { status: 0, body: "" };
    const res = { statusCode: 200, headersSent: false, setHeader() {}, end(chunk?: Buffer | string) { out.status = res.statusCode; out.body = chunk ? String(chunk) : ""; } } as unknown as ServerResponse;
    await relay.handle(req, res, workspace, rest);
    return out;
  };
  return { wallet, clock, calls, call, relay };
}

describe("the included Fish Audio voice", () => {
  it("holds ten minutes for a Live call and charges its real length when it ends", async () => {
    const { wallet, clock, calls, call } = setup();
    wallet.credit("acme", 100 * MICRO, "grant", null);
    expect((await call("acme", "POST", "v1/agent/agents", "{}")).status).toBe(200);
    expect((await call("acme", "POST", "v1/agent/sessions", JSON.stringify({ agent_id: "agent-1" }))).status).toBe(200);
    expect(wallet.balance("acme")).toBe(100 * MICRO - wallet.microFor(FISH_PRICES.liveHoldMinutes * FISH_PRICES.livePerMinute));
    clock.now += 3 * 60_000 - 1000;
    expect((await call("acme", "POST", "v1/agent/sessions/sess-1/end")).status).toBe(200);
    expect(wallet.balance("acme")).toBe(100 * MICRO - wallet.microFor(3 * FISH_PRICES.livePerMinute));
    expect(calls.every((one) => one.auth === "Bearer operator-fish")).toBe(true);
  });

  it("never lets one workspace start, change or end another's agent or call", async () => {
    const { wallet, call } = setup();
    wallet.credit("acme", 100 * MICRO, "grant", null);
    wallet.credit("other", 100 * MICRO, "grant", null);
    await call("acme", "POST", "v1/agent/agents", "{}");
    expect((await call("other", "PATCH", "v1/agent/agents/agent-1", "{}")).status).toBe(404);
    expect((await call("other", "POST", "v1/agent/sessions", JSON.stringify({ agent_id: "agent-1" }))).status).toBe(404);
    await call("acme", "POST", "v1/agent/sessions", JSON.stringify({ agent_id: "agent-1" }));
    expect((await call("other", "POST", "v1/agent/sessions/sess-1/end")).status).toBe(404);
    expect(wallet.balance("other")).toBe(100 * MICRO);
  });

  it("charges speech by the characters spoken, refuses without credits, and never lists Deliobot's own voices", async () => {
    const { wallet, calls, call } = setup();
    expect((await call("acme", "POST", "v1/tts", JSON.stringify({ text: "Bonjour" }))).status).toBe(402);
    wallet.credit("acme", 10 * MICRO, "grant", null);
    expect(await call("acme", "POST", "v1/tts", JSON.stringify({ text: "x".repeat(2000) }))).toEqual({ status: 200, body: "AUDIO" });
    expect(wallet.balance("acme")).toBe(10 * MICRO - wallet.microFor(2 * FISH_PRICES.speechPer1kChars));
    await call("acme", "GET", "model?page_size=1&self=true");
    expect(calls.at(-1)!.url).toBe("https://fish.test/model?page_size=1");
  });

  it("charges a call longer than its hold for every minute, up to the longest Fish lets it run", async () => {
    const { wallet, clock, call, relay } = setup();
    wallet.credit("acme", 100 * MICRO, "grant", null);
    await call("acme", "POST", "v1/agent/agents", "{}");
    await call("acme", "POST", "v1/agent/sessions", JSON.stringify({ agent_id: "agent-1" }));
    clock.now += 25 * 60_000;
    await call("acme", "POST", "v1/agent/sessions/sess-1/end");
    expect(wallet.balance("acme")).toBe(100 * MICRO - wallet.microFor(25 * FISH_PRICES.livePerMinute));
    void relay;
  });

  it("relays only the calls the app makes", () => {
    expect(fishRoute("POST", "v1/agent/agents/a1/publish")).toEqual({ kind: "agent", id: "a1", action: "publish" });
    expect(fishRoute("DELETE", "v1/agent/agents/a1")).toBeNull();
    expect(fishRoute("GET", "wallet/self/api-credit")).toBeNull();
  });
});
