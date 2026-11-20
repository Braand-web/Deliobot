// The engine is scripted: each goal step runs the same Bash call (the first writes a broken file, the next the fix) and
// answers with the next scripted goal decision, so this proves what the server does around a coding goal.
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";

import { CODING_GOAL_MAX_TURNS } from "./coder/settings.ts";
import { launchVerificationServer, runControlOdb } from "../scripts/control-odb.ts";

const envelope = (decision: Record<string, string>) => `<opendelio-goal>${JSON.stringify(decision)}</opendelio-goal>`;

it("checks a coding goal after every step without any setting, and hands a failure to the next step", async () => {
  const project = mkdtempSync(join(tmpdir(), "odb-coding-goal-"));
  writeFileSync(join(project, "package.json"), JSON.stringify({ name: "shop", private: true, scripts: { test: "test -f fixed.txt" } }));
  const prompts = join(project, "..", `${project.split(/[\\/]/).at(-1)}-prompts.jsonl`);
  const edit = { name: "Bash", input: { command: "if [ -f broken.txt ]; then echo ok > fixed.txt; else echo x > broken.txt; fi" } };
  const fixture = await launchVerificationServer({
    ...process.env, FAKE_CLAUDE_RUN_BASH: "1", ODB_TEST_WITH_GIT: "1", FAKE_CLAUDE_PROMPTS: prompts, FAKE_CLAUDE_TOOL_CALLS: JSON.stringify([edit]),
    FAKE_CLAUDE_REPLIES: JSON.stringify([
      `Started the cart.\n${envelope({ status: "continue", next: "Coder", instruction: "Finish the cart", detail: "Cart started" })}`,
      `The cart works.\n${envelope({ status: "completed", detail: "Cart done." })}`,
    ]),
  });
  const api = async (method: string, path: string, body?: unknown) => {
    const response = await fetch(fixture.info.url + path, { method, headers: { "content-type": "application/json", origin: fixture.info.url }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return await response.json() as any;
  };
  const rows = async (threadId: string) => (await api("GET", `/api/threads/${threadId}/messages?limit=200`)).messages as any[];
  try {
    const { bot } = await runControlOdb(["new-bot", "--name", "Coder", "--url", fixture.info.url]) as { bot: { id: string; activeTaskId: string } };
    const threadId = bot.activeTaskId;
    await api("PATCH", `/api/bots/${bot.id}`, { cwd: project });
    await api("POST", `/api/bots/${bot.id}/messages`, { text: "Build the cart", mode: "goal", threadId });

    await expect.poll(async () => (await rows(threadId)).find((row) => row.kind === "goal.run")?.goalRun?.status, { timeout: 90_000, interval: 500 }).toBe("completed");
    const thread = await rows(threadId);
    expect(thread.find((row) => row.kind === "goal.run").goalRun.maxTurns).toBe(CODING_GOAL_MAX_TURNS);
    const notices = async () => (await rows(threadId)).map((row) => row.tool?.nameCode).filter((code) => typeof code === "string" && code.startsWith("chat.notice.coder"));
    await expect.poll(notices, { timeout: 30_000, interval: 500 }).toEqual(["chat.notice.coderChecking", "chat.notice.coderGoalFailed", "chat.notice.coderChecking", "chat.notice.coderPassed"]);
    expect(existsSync(join(project, "fixed.txt"))).toBe(true);
    const sent = readFileSync(prompts, "utf8").trim().split("\n").map((line) => JSON.stringify(JSON.parse(line)));
    expect(sent.some((prompt) => prompt.includes("checks after your last step and one failed"))).toBe(true);
  } finally {
    await fixture.close();
    rmSync(project, { recursive: true, force: true });
    rmSync(prompts, { force: true });
  }
}, 150_000);
