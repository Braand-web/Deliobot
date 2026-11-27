// The bots' memory a desktop app sent for its workspace, so another computer signed in to the same account gets it back.
// Security: a copy holds a customer's notes; only a device token of that workspace reads it, the operators' console
// never shows it, and it goes with the workspace when the workspace is deleted.
import type { SqlDatabase } from "./sql.ts";

import { token } from "./store.ts";

/** A Durable Object row holds at most 2 MB, and a copy is stored as base64 text. */
export const MAX_MEMORY_BACKUP_BYTES = 1_400_000;
const KEEP = 5;
const DAILY = 48;
const DAY_MS = 24 * 60 * 60_000;
const GZIP = [0x1f, 0x8b];

export interface MemoryBackupMeta { id: string; at: number; bytes: number; bots: number; device: string }

export type MemoryBackupSave = { ok: true; backup: MemoryBackupMeta } | { ok: false; status: number; error: string };

export class MemoryBackups {
  private readonly db: SqlDatabase;
  private readonly now: () => number;

  constructor(db: SqlDatabase, now: () => number = Date.now) {
    this.db = db;
    this.now = now;
    this.db.exec(`CREATE TABLE IF NOT EXISTS memory_backups (id TEXT PRIMARY KEY, workspace TEXT NOT NULL REFERENCES workspaces(slug) ON DELETE CASCADE,
  at INTEGER NOT NULL, bytes INTEGER NOT NULL, bots INTEGER NOT NULL, device TEXT NOT NULL, body TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS memory_backups_workspace ON memory_backups (workspace, at);`);
  }

  /** `gzip`: the app's compressed copy, stored as sent; the portal never reads the notes inside. */
  save(workspace: string, gzip: Uint8Array, meta: { bots: number; device: string }): MemoryBackupSave {
    if (gzip.length < 18 || gzip[0] !== GZIP[0] || gzip[1] !== GZIP[1]) return { ok: false, status: 400, error: "A memory backup is a gzip file." };
    if (gzip.length > MAX_MEMORY_BACKUP_BYTES) return { ok: false, status: 413, error: "This memory backup is too large." };
    const at = this.now();
    const today = Number((this.db.prepare("SELECT COUNT(*) AS n FROM memory_backups WHERE workspace = ? AND at > ?").get(workspace, at - DAY_MS) as { n: number }).n);
    if (today >= DAILY) return { ok: false, status: 429, error: "Too many memory backups today." };
    const backup: MemoryBackupMeta = { id: token(9), at, bytes: gzip.length, bots: Math.max(0, Math.min(10_000, Math.floor(meta.bots) || 0)), device: meta.device.replace(/[\r\n]+/g, " ").slice(0, 80) };
    this.db.transaction(() => {
      this.db.prepare("INSERT INTO memory_backups (id, workspace, at, bytes, bots, device, body) VALUES (?, ?, ?, ?, ?, ?, ?)")
        .run(backup.id, workspace, backup.at, backup.bytes, backup.bots, backup.device, Buffer.from(gzip).toString("base64"));
      this.db.prepare(`DELETE FROM memory_backups WHERE workspace = ? AND id NOT IN (SELECT id FROM memory_backups WHERE workspace = ? ORDER BY at DESC LIMIT ${KEEP})`).run(workspace, workspace);
    });
    return { ok: true, backup };
  }

  list(workspace: string): MemoryBackupMeta[] {
    return this.db.prepare("SELECT id, at, bytes, bots, device FROM memory_backups WHERE workspace = ? ORDER BY at DESC").all(workspace) as unknown as MemoryBackupMeta[];
  }

  /** The newest copy, or the one named. */
  read(workspace: string, id?: string): (MemoryBackupMeta & { gzip: Buffer }) | null {
    const row = (id
      ? this.db.prepare("SELECT id, at, bytes, bots, device, body FROM memory_backups WHERE workspace = ? AND id = ?").get(workspace, id)
      : this.db.prepare("SELECT id, at, bytes, bots, device, body FROM memory_backups WHERE workspace = ? ORDER BY at DESC LIMIT 1").get(workspace)) as (MemoryBackupMeta & { body: string }) | undefined;
    if (!row) return null;
    const { body, ...meta } = row;
    return { ...meta, gzip: Buffer.from(body, "base64") };
  }
}
