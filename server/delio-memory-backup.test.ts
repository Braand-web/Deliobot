import { mkdirSync, rmSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { beforeEach, describe, expect, it } from "vitest";

import { DATA_DIR } from "./config.ts";
import { createMemoryBackup, mergeNotes, packArchive, type BackupBot, type MemoryArchive, type MemoryBackupDeps } from "./delio-memory-backup.ts";
import { closeMessageDb } from "./message-db.ts";
import { readMemoryFile, readMemoryLog, readMemoryTopic, WORKSPACES_DIR, writeMemoryFile, writeMemoryLog, writeMemoryTopic } from "./workspace.ts";

const CONNECTION = { portal: "https://compte.example.test", workspace: "acme", token: `odb_device_${"a".repeat(43)}`, gateway: "https://compte.example.test/api/gateway/acme" };

/** The account's portal: keeps what is sent, gives the newest back. */
function account() {
  const copies: Buffer[] = [];
  const calls: string[] = [];
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    calls.push(`${init?.method ?? "GET"} ${url.pathname}`);
    if (new Headers(init?.headers).get("authorization") !== `Bearer ${CONNECTION.token}`) return new Response("no", { status: 401 });
    if (init?.method === "PUT") {
      copies.push(Buffer.from(init.body as Uint8Array));
      return Response.json({ backup: { id: `copy${copies.length}xx`, at: 1, bytes: copies.at(-1)!.length, bots: Number(url.searchParams.get("bots")), device: url.searchParams.get("device") } });
    }
    if (url.pathname.endsWith("/memory")) return Response.json({ backups: copies.map((copy, i) => ({ id: `copy${i + 1}xx`, at: i, bytes: copy.length, bots: 1, device: "pc" })) });
    const newest = copies.at(-1);
    return newest ? new Response(new Uint8Array(newest), { headers: { "content-type": "application/gzip" } }) : new Response("none", { status: 404 });
  }) as typeof fetch;
  return { copies, calls, fetchImpl };
}

function computer(portal: ReturnType<typeof account>, bots: BackupBot[], state = { aboutMe: "", team: {} as Record<string, unknown[]> }) {
  const created: BackupBot[] = [];
  const deps: MemoryBackupDeps = {
    dataDir: DATA_DIR,
    connection: () => CONNECTION,
    enabled: () => true,
    bots: () => bots,
    aboutMe: () => state.aboutMe,
    saveAboutMe: (text) => { state.aboutMe = text; },
    teamSections: () => [],
    teamEntries: (section) => state.team[section] ?? [],
    adoptTeam: (section, entries) => { state.team[section] = [...(state.team[section] ?? []), ...entries]; return entries.length; },
    createBot: (profile) => {
      const bot = { id: `new-${profile.name.toLowerCase()}`, name: profile.name };
      bots.push(bot);
      created.push(bot);
      return bot;
    },
    device: () => "PC de test",
    fetch: portal.fetchImpl,
    now: () => Date.UTC(2026, 10, 27, 12),
  };
  return { backup: createMemoryBackup(deps), state, created };
}

beforeEach(() => {
  closeMessageDb();
  rmSync(WORKSPACES_DIR, { recursive: true, force: true });
  rmSync(DATA_DIR, { recursive: true, force: true });
  mkdirSync(DATA_DIR, { recursive: true });
});

describe("merging notes", () => {
  it("keeps every local line and adds the copy's missing ones in order", () => {
    expect(mergeNotes("", "- a\n- b\n")).toBe("- a\n- b\n");
    expect(mergeNotes("- a\n- c\n", "- a\n- b\n- c\n- d\n")).toBe("- a\n- c\n- b\n- d\n");
    expect(mergeNotes("- a\n", "-  a \n")).toBe("- a\n");
  });
});

describe("the bots' memory in the Delio account", () => {
  it("sends only when something changed, and another computer gets the notes, the profile and the shared memory back", async () => {
    const portal = account();
    writeMemoryFile("momo", "- 2026-11-20 · The person sells shea butter in Lomé\n");
    writeMemoryTopic("momo", "clients.md", "---\ntitle: Clients\naliases: [customers]\n---\n\n- Awa buys 20 kg a month\n");
    writeMemoryLog("momo", "2026-11-26.md", "- Wrote the November invoice\n");
    const first = computer(portal, [{ id: "momo", name: "Momo", soul: "You are Momo, a sales assistant." }],
      { aboutMe: "I run a shea butter shop.", team: { "": [{ id: "t1", kind: "person", name: "Moussa", detail: "Moussa prints the flyers.", aliases: [], status: "accepted" }] } });
    expect((await first.backup.backUp()).lastBytes).toBeGreaterThan(0);
    await first.backup.backUp();
    expect(portal.copies).toHaveLength(1);
    const archive = JSON.parse(gunzipSync(portal.copies[0]!).toString("utf8")) as MemoryArchive;
    expect(archive.bots.map((bot) => [bot.name, bot.memory.topics.map((topic) => topic.name), bot.memory.logs.map((log) => log.name)])).toEqual([["Momo", ["clients.md"], ["2026-11-26.md"]]]);

    rmSync(WORKSPACES_DIR, { recursive: true, force: true });
    closeMessageDb();
    writeMemoryFile("other-id", "- 2026-11-27 · The person wants invoices in FCFA\n");
    writeMemoryTopic("other-id", "clients.md", "- Kofi pays on delivery\n");
    const second = computer(portal, [{ id: "other-id", name: "momo" }], { aboutMe: "Lives in Lomé.", team: {} });
    const report = await second.backup.restore();
    expect(report).toMatchObject({ bots: 1, created: [], aboutMe: 1, team: 1 });
    expect(readMemoryFile("other-id").text).toBe("- 2026-11-27 · The person wants invoices in FCFA\n- 2026-11-20 · The person sells shea butter in Lomé\n");
    expect(readMemoryTopic("other-id", "clients.md")).toBe("- Kofi pays on delivery\n- Awa buys 20 kg a month\n");
    expect(readMemoryLog("other-id", "2026-11-26.md")).toBe("- Wrote the November invoice\n");
    expect(second.state.aboutMe).toBe("Lives in Lomé.\nI run a shea butter shop.\n");
    expect(second.state.team[""]).toHaveLength(1);
  });

  it("creates a bot this computer lacks, and refuses without an account or a copy", async () => {
    const portal = account();
    writeMemoryFile("momo", "- A note\n");
    await computer(portal, [{ id: "momo", name: "Momo" }]).backup.backUp();
    rmSync(WORKSPACES_DIR, { recursive: true, force: true });
    closeMessageDb();
    const fresh = computer(portal, []);
    expect((await fresh.backup.restore()).created).toEqual(["Momo"]);
    expect(readMemoryFile("new-momo").text).toBe("- A note\n");
    await expect(computer(account(), []).backup.restore()).rejects.toThrow("no memory backup yet");
  });

  it("drops the oldest daily logs until the copy fits, and gives up when the notes alone do not", () => {
    const noise = (n: number) => Array.from({ length: n }, (_, i) => `${i}-${Math.random().toString(36)}`).join("\n");
    const archive: MemoryArchive = { format: "deliobot.memory", version: 1, at: 0, aboutMe: "", team: {}, bots: [{ id: "b", name: "B", memory: { file: "- keep", topics: [],
      logs: [{ name: "2026-01-01.md", text: noise(4000) }, { name: "2026-01-02.md", text: "- small" }] } }] };
    expect(packArchive(archive, 2_000)).not.toBeNull();
    expect(archive.bots[0]!.memory.logs.map((log) => log.name)).toEqual(["2026-01-02.md"]);
    expect(packArchive({ ...archive, bots: [{ id: "b", name: "B", memory: { file: noise(4000), topics: [], logs: [] } }] }, 2_000)).toBeNull();
  });
});
