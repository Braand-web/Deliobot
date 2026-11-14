import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { launchVerificationServer, runControlOdb } from "../scripts/control-odb.ts";
import { callTool } from "./drivers/agents-call.ts";
import { createHarnessClient } from "./drivers/agents-client.ts";
import { hostTimeout } from "./testing/host-timeout.ts";

it("keeps the native URL reader behind the owning live capability and the bot's tool selection", async () => {
  const key = randomUUID();
  const fixture = await launchVerificationServer({ ...process.env, ODB_TEST_INTERNAL_CAPABILITY_KEY: key });
  const path = "/api/internal/public-web/read";
  try {
    const created = await runControlOdb(["new-bot", "--name", "Public reader fixture", "--url", fixture.info.url]) as { bot: { id: string; activeTaskId: string } };
    const bot = created.bot;
    const untrusted = await fetch(fixture.info.url + path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ url: "https://example.com" }) });
    expect(untrusted.status).toBe(401);
    const minted = await fetch(fixture.info.url + "/api/testing/internal-capability", {
      method: "POST", headers: { "content-type": "application/json", "x-opendeliobot-test-capability": key },
      body: JSON.stringify({ botId: bot.id, threadId: bot.activeTaskId }),
    });
    expect(minted.status).toBe(201);
    const { token } = await minted.json() as { token: string };
    const context = { botId: bot.id, threadId: bot.activeTaskId, depth: 0, externalRuntime: false, sharedComputers: false, client: createHarnessClient(fixture.info.url, token) };
    const local = await callTool("read_public_url", { url: fixture.info.url + "/api/config" }, context);
    expect(local.isError).toBe(true);
    expect(JSON.parse(local.text)).toMatchObject({ ok: false, refused: true });
    const patched = await fetch(fixture.info.url + `/api/bots/${bot.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ toolScope: { deny: ["mcp:agents:read_public_url"] } }) });
    expect(patched.status).toBe(200);
    const denied = await callTool("read_public_url", { url: "https://example.com" }, context);
    expect(denied.isError).toBe(true);
    expect(denied.text).toContain("not allowed");
    expect((await fetch(fixture.info.url + `/api/bots/${bot.id}`, { method: "DELETE" })).status).toBe(200);
    const stale = await context.client.apiResponse(path, { method: "POST", body: JSON.stringify({ url: "https://example.com" }) });
    expect(stale.status).toBe(401);
  } finally { await fixture.close(); }
}, hostTimeout(45_000));
