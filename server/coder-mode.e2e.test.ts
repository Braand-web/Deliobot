// The engine's edits are scripted (FAKE_CLAUDE_RUN_BASH runs the scripted Bash call in the bot's folder), so this proves
// what the server does after a turn that changed files, not what a model chooses to write.
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";

import { launchVerificationServer, runControlOdb } from "../scripts/control-odb.ts";

it("checks a change, sends the failure back, sees the fix pass, then puts the folder back on request", async () => {
  const project = mkdtempSync(join(tmpdir(), "odb-coder-project-"));
  writeFileSync(join(project, "app.txt"), "v1\n");
  const edit = { name: "Bash", input: { command: "if [ -f broken.txt ]; then echo ok > fixed.txt; else echo v2 > app.txt; echo x > broken.txt; fi" } };
  const fixture = await launchVerificationServer({ ...process.env, FAKE_CLAUDE_RUN_BASH: "1", ODB_TEST_WITH_GIT: "1", FAKE_CLAUDE_TOOL_CALLS: JSON.stringify([edit]) });
  const api = async <T = any>(path: string, method = "GET", body?: unknown, status = 200): Promise<T> => {
    const response = await fetch(fixture.info.url + path, {
      method, headers: { "content-type": "application/json", origin: fixture.info.url }, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    expect(response.status, `${method} ${path}: ${response.status}`).toBe(status);
    return response.json() as Promise<T>;
  };
  const cli = (...args: string[]) => runControlOdb([...args, "--url", fixture.info.url]) as Promise<any>;
  const rows = async (threadId: string) => (await api<{ messages: any[] }>(`/api/threads/${threadId}/messages?limit=100`)).messages;
  const notices = async (threadId: string) => (await rows(threadId)).map((row) => row.tool?.nameCode).filter((code) => typeof code === "string" && code.startsWith("chat.notice.coder"));
  try {
    const { bot } = await cli("new-bot", "--name", "Coder");
    await api(`/api/bots/${bot.id}`, "PATCH", { cwd: project, coder: { enabled: true, verify: ["test -f fixed.txt"] } });
    await cli("send", "--bot", bot.id, "--task", bot.activeTaskId, "--text", "Update app.txt to v2");
    await expect.poll(() => notices(bot.activeTaskId), { timeout: 60_000, interval: 500 })
      .toEqual(["chat.notice.coderChecking", "chat.notice.coderFailed", "chat.notice.coderChecking", "chat.notice.coderPassed"]);
    expect(existsSync(join(project, "fixed.txt"))).toBe(true);

    const first = (await rows(bot.activeTaskId)).find((row) => row.kind === "digest" && row.undo);
    expect(first, "the first turn's summary offers to undo").toBeTruthy();
    await api(`/api/bots/${bot.id}/threads/${bot.activeTaskId}/messages/${first.id}/undo`, "POST", {});
    expect(existsSync(join(project, "broken.txt"))).toBe(false);
    expect(existsSync(join(project, "fixed.txt"))).toBe(false);
    expect(readFileSync(join(project, "app.txt"), "utf8")).toBe("v1\n");
    expect((await rows(bot.activeTaskId)).find((row) => row.id === first.id)).toMatchObject({ undone: true });
    await api(`/api/bots/${bot.id}/threads/${bot.activeTaskId}/messages/${first.id}/undo`, "POST", {}, 404);
  } finally {
    await fixture.close();
    rmSync(project, { recursive: true, force: true });
  }
}, 120_000);
