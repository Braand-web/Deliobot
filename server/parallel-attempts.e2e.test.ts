// The engine is scripted: every turn runs the same Bash call, which writes only inside an attempt's copy, so this proves
// what the server does around the attempts, not what a model would write.
import { randomUUID } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";

import { launchVerificationServer, runControlOdb } from "../scripts/control-odb.ts";
import { callTool } from "./drivers/agents-call.ts";
import { createHarnessClient } from "./drivers/agents-client.ts";

it("runs two attempts in their own copies, writes the kept one into the project, and switches on request", async () => {
  const project = mkdtempSync(join(tmpdir(), "odb-attempts-project-"));
  writeFileSync(join(project, "app.txt"), "v1\n");
  const edit = { name: "Bash", input: { command: 'case "$PWD" in */attempts/*) echo "fixed by ${PWD##*/}" > result.txt;; esac' } };
  const key = randomUUID();
  const fixture = await launchVerificationServer({ ...process.env, FAKE_CLAUDE_RUN_BASH: "1", ODB_TEST_WITH_GIT: "1", ODB_TEST_INTERNAL_CAPABILITY_KEY: key, FAKE_CLAUDE_TOOL_CALLS: JSON.stringify([edit]) });
  const api = async (path: string, init: RequestInit = {}) => {
    const response = await fetch(fixture.info.url + path, { ...init, headers: { "content-type": "application/json", origin: fixture.info.url, ...init.headers } });
    return { status: response.status, body: await response.json() as any };
  };
  try {
    const { bot } = await runControlOdb(["new-bot", "--name", "Coder", "--url", fixture.info.url]) as { bot: { id: string; activeTaskId: string } };
    expect((await api(`/api/bots/${bot.id}`, { method: "PATCH", body: JSON.stringify({ cwd: project, coder: { enabled: true, verify: ["test -f result.txt"] } }) })).status).toBe(200);
    const minted = await api("/api/testing/internal-capability", { method: "POST", headers: { "x-opendeliobot-test-capability": key }, body: JSON.stringify({ botId: bot.id, threadId: bot.activeTaskId }) });
    const context = { botId: bot.id, threadId: bot.activeTaskId, depth: 0, externalRuntime: false, sharedComputers: false, client: createHarnessClient(fixture.info.url, minted.body.token) };

    const started = await callTool("parallel_attempts", { request: "Write result.txt", count: 2 }, context);
    expect(started.isError).toBeFalsy();
    const run = /run ([0-9a-f]{12})/.exec(started.text)![1]!;
    const notices = async () => ((await api(`/api/threads/${bot.activeTaskId}/messages?limit=100`)).body.messages as any[])
      .map((row) => row.tool?.nameCode).filter((code) => typeof code === "string" && code.startsWith("chat.notice.attempts"));
    await expect.poll(notices, { timeout: 60_000, interval: 500 }).toEqual(["chat.notice.attemptsStarted", "chat.notice.attemptsKept"]);
    expect(readFileSync(join(project, "result.txt"), "utf8")).toBe("fixed by 1\n");
    expect(readFileSync(join(project, "app.txt"), "utf8")).toBe("v1\n");
    const tasks = (await api(`/api/bots/${bot.id}`)).body.bot.tasks as Array<{ title: string }>;
    expect(tasks.map((task) => task.title)).toEqual(expect.arrayContaining(["Attempt 1 of 2", "Attempt 2 of 2"]));

    const later = await api("/api/testing/internal-capability", { method: "POST", headers: { "x-opendeliobot-test-capability": key }, body: JSON.stringify({ botId: bot.id, threadId: bot.activeTaskId }) });
    const chosen = await callTool("choose_attempt", { run, attempt: 2 }, { ...context, client: createHarnessClient(fixture.info.url, later.body.token) });
    expect(chosen.text).toContain("Attempt 2 is now in the project");
    expect(readFileSync(join(project, "result.txt"), "utf8")).toBe("fixed by 2\n");
    expect(existsSync(join(project, "app.txt"))).toBe(true);
  } finally {
    await fixture.close();
    rmSync(project, { recursive: true, force: true });
  }
}, 120_000);
