// The bots' memory kept in the Delio account: every few hours, when it changed, a desktop app sends its bots' notes,
// About me and the shared team memory to the account; another computer on the same account merges them back in.
// Security: the copy goes only to the account's own portal with this device's token, and secrets are scrubbed first.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { hostname } from "node:os";
import { join } from "node:path";
import { gunzipSync, gzipSync } from "node:zlib";
import { z } from "zod";

import { writeFileAtomic } from "./atomic.ts";
import type { DelioConnection } from "./delio-account.ts";
import { topicBody } from "./memory-topics.ts";
import { redactSecretsInText } from "./redact.ts";
import {
  isMemoryTopicName, listMemoryLogs, listMemoryTopics, readMemoryFile, readMemoryLog, readMemoryTopic,
  writeMemoryFile, writeMemoryLog, writeMemoryTopic,
} from "./workspace.ts";

/** What the portal stores per copy (gzip bytes), with room to spare under its limit. */
export const MEMORY_BACKUP_MAX_GZIP = 1_350_000;
const EVERY_MS = 6 * 60 * 60_000;
const FIRST_AFTER_MS = 5 * 60_000;
const TIMEOUT_MS = 60_000;
const LOG_DAYS = 30;
const STATUS_FILE = "delio-memory-backup.json";

const fileSchema = z.object({ name: z.string().max(220), text: z.string() });
const botSchema = z.object({
  id: z.string().max(128), name: z.string().max(200), title: z.string().max(500).optional(), description: z.string().max(5000).optional(),
  soul: z.string().max(200_000).optional(), color: z.string().max(64).optional(), section: z.string().max(200).optional(),
  memory: z.object({ file: z.string(), topics: z.array(fileSchema).max(2000), logs: z.array(fileSchema).max(2000) }),
});
const archiveSchema = z.object({
  format: z.literal("deliobot.memory"), version: z.literal(1), at: z.number(),
  aboutMe: z.string().max(200_000),
  team: z.record(z.string(), z.array(z.unknown())),
  bots: z.array(botSchema).max(500),
});
export type MemoryArchive = z.infer<typeof archiveSchema>;
type ArchiveBot = MemoryArchive["bots"][number];

export interface BackupBot { id: string; name: string; title?: string; description?: string; soul?: string; color?: string; section?: string; memoryEnabled?: boolean }

export interface MemoryBackupStatus { lastAt?: number; lastBytes?: number; lastHash?: string; lastError?: string; lastErrorAt?: number }

export interface MemoryRestoreReport { backupAt: number; bots: number; created: string[]; files: number; aboutMe: number; team: number }

export interface MemoryBackupDeps {
  dataDir: string;
  connection(): DelioConnection | null;
  enabled(): boolean;
  bots(): readonly BackupBot[];
  aboutMe(): string;
  saveAboutMe(text: string): void;
  teamSections(): string[];
  teamEntries(section: string): unknown[];
  adoptTeam(section: string, entries: readonly unknown[]): number;
  createBot(profile: Omit<ArchiveBot, "id" | "memory">): BackupBot;
  device?(): string;
  fetch?: typeof fetch;
  now?(): number;
  log?(line: string): void;
}

const sameLine = (line: string) => line.trim().replace(/\s+/g, " ");

/** The local notes, then every line of the copy they lack, in the copy's order: a restore never drops a local note. */
export function mergeNotes(local: string, copy: string): string {
  if (!local.trim()) return copy;
  const have = new Set(local.split("\n").map(sameLine).filter(Boolean));
  const missing = copy.split("\n").filter((line) => sameLine(line) && !have.has(sameLine(line)));
  return missing.length ? `${local.replace(/\n*$/, "\n")}${missing.join("\n")}\n` : local;
}

function memoryOf(botId: string, since: string): ArchiveBot["memory"] {
  const topics = listMemoryTopics(botId).flatMap((topic) => {
    const text = readMemoryTopic(botId, topic.name);
    return text === null ? [] : [{ name: topic.name, text: redactSecretsInText(text) }];
  });
  const logs = listMemoryLogs(botId).filter((name) => name >= since).flatMap((name) => {
    const text = readMemoryLog(botId, name);
    return text === null ? [] : [{ name, text: redactSecretsInText(text) }];
  });
  return { file: redactSecretsInText(readMemoryFile(botId).text), topics, logs };
}

/** Oldest daily logs go first until the copy fits; null when even the notes alone do not. */
export function packArchive(archive: MemoryArchive, max = MEMORY_BACKUP_MAX_GZIP): Buffer | null {
  const logs = archive.bots.flatMap((bot) => bot.memory.logs.map((log) => ({ bot, log }))).sort((a, b) => a.log.name.localeCompare(b.log.name));
  for (;;) {
    const gzip = gzipSync(JSON.stringify(archive), { level: 9 });
    if (gzip.length <= max) return gzip;
    const oldest = logs.shift();
    if (!oldest) return null;
    oldest.bot.memory.logs = oldest.bot.memory.logs.filter((log) => log !== oldest.log);
  }
}

export function createMemoryBackup(deps: MemoryBackupDeps) {
  const now = deps.now ?? Date.now;
  const fetchImpl = deps.fetch ?? fetch;
  const statusPath = join(deps.dataDir, STATUS_FILE);
  let running: Promise<MemoryBackupStatus> | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const readStatus = (): MemoryBackupStatus => {
    try { return JSON.parse(readFileSync(statusPath, "utf8")) as MemoryBackupStatus; } catch { return {}; }
  };
  const writeStatus = (status: MemoryBackupStatus) => {
    try { writeFileAtomic(statusPath, JSON.stringify(status), { mode: 0o600 }); } catch { /* the next run tries again */ }
  };

  function collect(): MemoryArchive {
    const since = new Date(now() - LOG_DAYS * 24 * 60 * 60_000).toISOString().slice(0, 10);
    const team: Record<string, unknown[]> = {};
    for (const section of ["", ...deps.teamSections()]) {
      const entries = deps.teamEntries(section);
      if (entries.length) team[section] = entries;
    }
    return {
      format: "deliobot.memory", version: 1, at: now(),
      aboutMe: redactSecretsInText(deps.aboutMe()),
      team,
      bots: deps.bots().filter((bot) => bot.memoryEnabled !== false).map((bot) => ({
        id: bot.id, name: bot.name,
        ...(bot.title ? { title: bot.title } : {}), ...(bot.description ? { description: bot.description } : {}),
        ...(bot.soul ? { soul: redactSecretsInText(bot.soul) } : {}), ...(bot.color ? { color: bot.color } : {}), ...(bot.section ? { section: bot.section } : {}),
        memory: memoryOf(bot.id, since),
      })),
    };
  }

  const portal = (connection: DelioConnection, path = "") => `${connection.portal}/api/workspace/${connection.workspace}/memory${path}`;
  const headers = (connection: DelioConnection) => ({ authorization: `Bearer ${connection.token}` });

  async function send(force: boolean): Promise<MemoryBackupStatus> {
    const previous = readStatus();
    const connection = deps.connection();
    if (!connection) return previous;
    const archive = collect();
    const hash = createHash("sha256").update(JSON.stringify({ ...archive, at: 0 })).digest("hex");
    if (!force && previous.lastHash === hash) return previous;
    const gzip = packArchive(archive);
    const failed = (error: string): MemoryBackupStatus => {
      const status = { ...previous, lastError: error, lastErrorAt: now() };
      writeStatus(status);
      deps.log?.(`delio memory backup: ${error}`);
      return status;
    };
    if (!gzip) return failed("the bots' memory is too large to keep in the account");
    try {
      const query = new URLSearchParams({ bots: String(archive.bots.length), device: (deps.device ?? hostname)().slice(0, 80) });
      const response = await fetchImpl(`${portal(connection)}?${query}`, { method: "PUT", headers: { ...headers(connection), "content-type": "application/gzip" }, body: gzip, signal: AbortSignal.timeout(TIMEOUT_MS) });
      if (!response.ok) return failed(`the account refused the copy (${response.status})`);
    } catch (error) {
      return failed(`the account could not be reached (${error instanceof Error ? error.message : String(error)})`);
    }
    const status: MemoryBackupStatus = { lastAt: now(), lastBytes: gzip.length, lastHash: hash };
    writeStatus(status);
    deps.log?.(`delio memory backup: sent ${archive.bots.length} bot(s), ${gzip.length} bytes`);
    return status;
  }

  function backUp(force = false): Promise<MemoryBackupStatus> {
    running ??= send(force).finally(() => { running = null; });
    return running;
  }

  async function remote(): Promise<Array<{ id: string; at: number; bytes: number; bots: number; device: string }>> {
    const connection = deps.connection();
    if (!connection) return [];
    const response = await fetchImpl(portal(connection), { headers: headers(connection), signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!response.ok) throw new Error(`the account answered ${response.status}`);
    return ((await response.json()) as { backups?: Array<{ id: string; at: number; bytes: number; bots: number; device: string }> }).backups ?? [];
  }

  function restoreArchive(archive: MemoryArchive): MemoryRestoreReport {
    const report: MemoryRestoreReport = { backupAt: archive.at, bots: 0, created: [], files: 0, aboutMe: 0, team: 0 };
    const fold = (name: string) => name.trim().toLowerCase();
    for (const saved of archive.bots) {
      const local = deps.bots();
      let bot = local.find((candidate) => candidate.id === saved.id) ?? local.find((candidate) => fold(candidate.name) === fold(saved.name));
      if (!bot) {
        const { id: _id, memory: _memory, ...profile } = saved;
        bot = deps.createBot(profile);
        report.created.push(bot.name);
      }
      report.bots += 1;
      const current = readMemoryFile(bot.id).text;
      const merged = mergeNotes(current, saved.memory.file);
      if (merged !== current) { writeMemoryFile(bot.id, merged); report.files += 1; }
      for (const topic of saved.memory.topics) {
        if (!isMemoryTopicName(topic.name)) continue;
        const here = readMemoryTopic(bot.id, topic.name);
        const next = here === null ? topic.text : mergeNotes(here, topicBody(topic.text));
        if (next !== here) { writeMemoryTopic(bot.id, topic.name, next); report.files += 1; }
      }
      for (const log of saved.memory.logs) {
        if (readMemoryLog(bot.id, log.name) !== null) continue;
        try { writeMemoryLog(bot.id, log.name, log.text); report.files += 1; } catch { /* a name this version does not accept */ }
      }
    }
    const aboutMe = deps.aboutMe();
    const mergedAboutMe = mergeNotes(aboutMe, archive.aboutMe);
    if (mergedAboutMe !== aboutMe) {
      deps.saveAboutMe(mergedAboutMe);
      report.aboutMe = mergedAboutMe.split("\n").filter(Boolean).length - aboutMe.split("\n").filter(Boolean).length;
    }
    for (const [section, entries] of Object.entries(archive.team)) report.team += deps.adoptTeam(section, entries);
    return report;
  }

  async function restore(id?: string): Promise<MemoryRestoreReport> {
    const connection = deps.connection();
    if (!connection) throw Object.assign(new Error("Connect a Delio account first."), { status: 409 });
    const response = await fetchImpl(portal(connection, `/${id ?? "latest"}`), { headers: headers(connection), signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (response.status === 404) throw Object.assign(new Error("This account holds no memory backup yet."), { status: 404 });
    if (!response.ok) throw Object.assign(new Error(`The account answered ${response.status}.`), { status: 502 });
    const archive = archiveSchema.parse(JSON.parse(gunzipSync(Buffer.from(await response.arrayBuffer()), { maxOutputLength: 64 * 1024 ** 2 }).toString("utf8")));
    const report = restoreArchive(archive);
    deps.log?.(`delio memory backup: restored ${report.bots} bot(s), ${report.created.length} created, ${report.files} file(s), ${report.team} shared note(s)`);
    return report;
  }

  return {
    collect,
    backUp,
    remote,
    restore,
    restoreArchive,
    status: readStatus,
    start(): void {
      const tick = () => {
        timer = setTimeout(() => {
          if (deps.enabled() && deps.connection()) void backUp().catch(() => undefined);
          tick();
        }, EVERY_MS);
        timer.unref?.();
      };
      timer = setTimeout(() => {
        if (deps.enabled() && deps.connection()) void backUp().catch(() => undefined);
        tick();
      }, FIRST_AFTER_MS);
      timer.unref?.();
    },
    stop(): void {
      if (timer) clearTimeout(timer);
      timer = null;
    },
  };
}

export type MemoryBackup = ReturnType<typeof createMemoryBackup>;
