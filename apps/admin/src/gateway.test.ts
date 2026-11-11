import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { falRun } from "../../../server/fal.ts";
import { createAdminApp } from "./app.ts";
import { falUnits, openrouterCost } from "./gateway.ts";
import type { MailMessage } from "./mail.ts";
import { AdminStore } from "./store.ts";

const cleanups: Array<() => void | Promise<void>> = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });

interface UpstreamCall { url: string; method: string; auth: string | null; body: unknown }

/** OpenRouter and fal.ai stand-ins reached through the portal's fetch: they record what the gateway sent them. */
function upstreams(options: { cost?: number; falUnit?: string; falPrice?: number } = {}) {
  const boats: Array<{ id: string; state: string }> = [{ id: "bx_zzzz9999", state: "idle" }];
  let nextBoat = 0;
  const calls: UpstreamCall[] = [];
  let polls = 0;
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ url: url.href, method: init?.method ?? "GET", auth: new Headers(init?.headers).get("authorization"), body });
    if (url.host === "openrouter.test" && url.pathname === "/api/v1/chat/completions") {
      const events = [
        { choices: [{ delta: { content: "Bon" } }] },
        { choices: [{ delta: { content: "jour" } }] },
        { choices: [], usage: { prompt_tokens: 10, completion_tokens: 2, cost: options.cost ?? 0.01 } },
      ].map((event) => `data: ${JSON.stringify(event)}\n\n`).join("") + "data: [DONE]\n\n";
      return new Response(events, { headers: { "content-type": "text/event-stream" } });
    }
    if (url.host === "boat.test") {
      const path = url.pathname.replace("/api/v1", "");
      if (path === "/sandboxes" && init?.method === "POST") {
        const boat = { id: ["bx_abcd2345", "bx_efgh2345"][nextBoat++]!, state: "provisioning" };
        boats.push(boat);
        return Response.json({ sandbox: boat }, { status: 202 });
      }
      if (path === "/sandboxes") return Response.json({ sandboxes: boats });
      const [, , id, action] = path.split("/");
      const boat = boats.find((item) => item.id === id);
      if (!boat) return Response.json({ error: "missing" }, { status: 404 });
      if (action === "stop") boat.state = "archived";
      if (action === "resume") boat.state = "idle";
      return Response.json({ sandbox: boat });
    }
    if (url.host === "openrouter.test" && url.pathname === "/api/v1/models") return Response.json({ data: [{ id: "openai/gpt-5" }] });
    if (url.host === "api.fal.test") return Response.json({ prices: [{ endpoint_id: url.searchParams.get("endpoint_id"), unit_price: options.falPrice ?? 0.07, unit: options.falUnit ?? "second", currency: "USD" }] });
    if (url.host === "queue.fal.test" && init?.method === "POST") {
      const base = "https://queue.fal.test/fal-ai/veo3/requests/req-123";
      return Response.json({ request_id: "req-123", status_url: `${base}/status`, response_url: base, cancel_url: `${base}/cancel` });
    }
    if (url.host === "queue.fal.test" && url.pathname.endsWith("/status")) return Response.json({ status: polls++ === 0 ? "IN_PROGRESS" : "COMPLETED", request_id: "req-123" });
    if (url.host === "queue.fal.test") return Response.json({ video: { url: "https://v3.fal.media/v.mp4" } });
    return new Response("not found", { status: 404 });
  }) as typeof fetch;
  return { fetchImpl, calls };
}

async function portal(upstream: ReturnType<typeof upstreams>, clock: { now: number } = { now: Date.now() }) {
  const dir = mkdtempSync(join(tmpdir(), "delio-gateway-"));
  const store = new AdminStore({ file: join(dir, "admin.db"), secret: randomBytes(32) });
  const mail: MailMessage[] = [];
  const server: Server = createServer();
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  cleanups.push(() => new Promise<void>((done) => server.close(() => { store.close(); rmSync(dir, { recursive: true, force: true }); done(); })));
  const app = createAdminApp({
    store, publicUrl: new URL(origin), operators: new Set(["ops@delio.test"]), mailer: { send: async (message) => void mail.push(message) }, fetchImpl: upstream.fetchImpl,
    gateway: { openrouterKey: "sk-or-operator", falKey: "fal-operator", openrouterUrl: "https://openrouter.test/api/v1", falQueueUrl: "https://queue.fal.test", falApiUrl: "https://api.fal.test/v1",
      boatKey: "boat-operator", boatUrl: "https://boat.test/api/v1", boatUsdPerHour: 0.12 },
    now: () => clock.now,
  });
  server.on("request", app);
  let cookie = "";
  const post = async (path: string, form: Record<string, string>) => {
    const response = await fetch(new URL(path, origin), { method: "POST", redirect: "manual", body: new URLSearchParams(form).toString(),
      headers: { origin, "content-type": "application/x-www-form-urlencoded", ...(cookie ? { cookie } : {}) } });
    const set = response.headers.getSetCookie()[0];
    if (set) cookie = set.split(";")[0]!;
    return response;
  };
  await post("/login", { email: "ops@delio.test", next: "/" });
  const code = /code is (\d{4}) (\d{4})/.exec(mail.at(-1)!.text)!;
  await post("/login/verify", { email: "ops@delio.test", code: code[1]! + code[2]!, next: "/" });
  const workspace = async (slug: string, credits: number) => {
    await post("/workspaces", { slug, name: slug, tenantUrl: `https://${slug}.example.test`, ownerEmail: "ops@delio.test" });
    const page = await (await post("/billing/token", { workspace: slug })).text();
    const token = /odb_workspace_[A-Za-z0-9_-]{43}/.exec(page)![0];
    if (credits) await post("/billing/credit", { workspace: slug, credits: String(credits), note: "test" });
    return token;
  };
  const gateway = (slug: string, path: string, token: string, init: RequestInit = {}) =>
    fetch(new URL(`/api/gateway/${slug}/${path}`, origin), { ...init, headers: { authorization: `Bearer ${token}`, "content-type": "application/json", ...init.headers as Record<string, string> } });
  const account = async (slug: string, token: string) => (await fetch(new URL(`/api/workspace/${slug}/account`, origin), { headers: { authorization: `Bearer ${token}` } })).json() as Promise<{ credits: number; usedThisMonth: number }>;
  return { origin, workspace, gateway, account, page: (path: string) => fetch(new URL(path, origin), { headers: { cookie } }), sweep: () => app.sweep() };
}

describe("cost and length readers", () => {
  it("finds the cost in a JSON answer or the last SSE event that has one", () => {
    expect(openrouterCost(JSON.stringify({ usage: { cost: 0.0123 } }))).toBe(0.0123);
    expect(openrouterCost('data: {"choices":[]}\n\ndata: {"usage":{"cost":0.5}}\n\ndata: [DONE]\n\n')).toBe(0.5);
    expect(openrouterCost("data: {broken")).toBeNull();
  });
  it("counts seconds only for per-second pricing, in each way models spell a length", () => {
    expect(falUnits({ duration: "8s" }, "second")).toBe(8);
    expect(falUnits({ seconds_total: 30 }, "seconds")).toBe(30);
    expect(falUnits({ music_length_ms: 45_000 }, "second")).toBe(45);
    expect(falUnits({ duration: "8s" }, "image")).toBe(1);
  });
});

describe("Delio AI gateway", () => {
  it("refuses a missing or another workspace's token, and shows a workspace its own credits", async () => {
    const upstream = upstreams();
    const target = await portal(upstream);
    const acme = await target.workspace("acme", 100);
    const beta = await target.workspace("beta", 0);
    expect((await target.gateway("acme", "openrouter/v1/models", "odb_workspace_" + "x".repeat(43))).status).toBe(401);
    expect((await target.gateway("acme", "openrouter/v1/models", beta)).status).toBe(401);
    expect(await target.account("acme", acme)).toMatchObject({ credits: 100, usedThisMonth: 0 });
    expect(upstream.calls).toEqual([]);
  });

  it("streams an OpenRouter answer, asks for its cost, charges it, and never forwards the workspace token", async () => {
    const upstream = upstreams({ cost: 0.01 });
    const target = await portal(upstream);
    const acme = await target.workspace("acme", 100);
    const response = await target.gateway("acme", "openrouter/v1/chat/completions", acme, { method: "POST", body: JSON.stringify({ model: "openai/gpt-5", stream: true, messages: [{ role: "user", content: "hi" }] }) });
    expect(response.status).toBe(200);
    expect(await response.text()).toContain('"content":"jour"');
    const sent = upstream.calls.find((call) => call.url.endsWith("/chat/completions"))!;
    expect(sent.auth).toBe("Bearer sk-or-operator");
    expect(sent.body).toMatchObject({ model: "openai/gpt-5", usage: { include: true } });
    expect(await target.account("acme", acme), "0.01 USD at 0.002 USD a credit").toMatchObject({ credits: 95, usedThisMonth: 5 });
    expect(await (await target.page("/billing?workspace=acme")).text()).toContain("openai/gpt-5");
  });

  it("refuses with credits_exhausted at zero, before the provider is called, and never takes more than is left", async () => {
    const upstream = upstreams({ cost: 0.5 });
    const target = await portal(upstream);
    const empty = await target.workspace("empty", 0);
    const refused = await target.gateway("empty", "openrouter/v1/chat/completions", empty, { method: "POST", body: JSON.stringify({ model: "openai/gpt-5", messages: [] }) });
    expect(refused.status).toBe(402);
    expect(await refused.json()).toMatchObject({ error: { code: "credits_exhausted" } });
    expect(upstream.calls).toEqual([]);

    const low = await target.workspace("low", 10);
    const answered = await target.gateway("low", "openrouter/v1/chat/completions", low, { method: "POST", body: JSON.stringify({ model: "openai/gpt-5", messages: [] }) });
    await answered.text();
    expect((await target.account("low", low)).credits, "a cost above the balance is charged, then the wallet refuses").toBeLessThan(0);
    expect((await target.gateway("low", "openrouter/v1/chat/completions", low, { method: "POST", body: "{}" })).status).toBe(402);
  });

  it("runs a fal.ai job for the workspace's own client: queue URLs on the portal, priced per second, out of other workspaces' reach", async () => {
    const upstream = upstreams({ falPrice: 0.07, falUnit: "second" });
    const target = await portal(upstream);
    const acme = await target.workspace("acme", 1000);
    const beta = await target.workspace("beta", 1000);
    const result = await falRun("fal-ai/veo3", { prompt: "waves", duration: "5" }, {
      key: acme, baseUrl: `${target.origin}/api/gateway/acme/fal`, timeoutMs: 10_000, pollMs: 5,
    });
    expect(result).toEqual({ video: { url: "https://v3.fal.media/v.mp4" } });
    expect(upstream.calls.filter((call) => call.url.startsWith("https://queue.fal.test")).every((call) => call.auth === "Key fal-operator")).toBe(true);
    expect(await target.account("acme", acme), "0.35 USD").toMatchObject({ credits: 825, usedThisMonth: 175 });
    expect((await target.gateway("beta", "fal/fal-ai/veo3/requests/req-123/status", beta)).status).toBe(404);
  });
});

describe("Delio Boat relay", () => {
  it("ties each cloud computer to its workspace, holds the plan's limit, bills awake minutes and puts it to sleep at zero", async () => {
    const clock = { now: Date.now() };
    const upstream = upstreams();
    const target = await portal(upstream, clock);
    const acme = await target.workspace("acme", 15);
    const beta = await target.workspace("beta", 100);
    const created = await target.gateway("acme", "boat/v1/sandboxes", acme, { method: "POST", body: JSON.stringify({ name: "odb-test" }) });
    expect(created.status).toBe(202);
    expect(((await created.json()) as { sandbox: { id: string } }).sandbox.id).toBe("bx_abcd2345");
    expect(upstream.calls.at(-1)!.auth).toBe("Bearer boat-operator");
    expect((await target.gateway("acme", "boat/v1/sandboxes", acme, { method: "POST", body: "{}" })).status, "one awake computer on this plan").toBe(409);

    const listed = await (await target.gateway("acme", "boat/v1/sandboxes", acme)).json() as { sandboxes: Array<{ id: string }> };
    expect(listed.sandboxes.map((item: { id: string }) => item.id), "the operator account's other computers stay hidden").toEqual(["bx_abcd2345"]);
    expect((await target.gateway("beta", "boat/v1/sandboxes/bx_abcd2345", beta)).status).toBe(404);
    expect((await target.gateway("beta", "boat/v1/sandboxes/bx_abcd2345/commands", beta, { method: "POST", body: "{}" })).status).toBe(404);

    clock.now += 10 * 60_000;
    await target.sweep();
    expect((await target.account("acme", acme)).usedThisMonth, "10 minutes at 0.12 USD an hour, 0.002 USD a credit").toBeCloseTo(10, 5);
    expect(upstream.calls.some((call) => call.url.endsWith("/stop")), "credits left: it keeps running").toBe(false);

    clock.now += 60 * 60_000;
    await target.sweep();
    expect(upstream.calls.filter((call) => call.url.endsWith("/sandboxes/bx_abcd2345/stop"))).toHaveLength(1);
    expect((await target.gateway("acme", "boat/v1/sandboxes/bx_abcd2345/resume", acme, { method: "POST" })).status, "out of credits: it cannot wake").toBe(402);
    expect((await target.gateway("acme", "boat/v1/sandboxes", acme, { method: "POST", body: "{}" })).status).toBe(402);
  });
});
