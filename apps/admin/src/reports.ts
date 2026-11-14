// Problem reports a person chose to send from the app: their note, the conversation they named and the app's version.
// Security: a report holds a customer's conversation; only the operators' console reads it, and it is deleted after 90 days.
import type { SqlDatabase } from "./sql.ts";

import { token } from "./store.ts";

const KEEP_MS = 90 * 24 * 60 * 60_000;
export const MAX_NOTE = 2000;
export const MAX_TRANSCRIPT = 200_000;

export interface ProblemReport {
  id: string; workspace: string; email: string | null; note: string; transcript: string; bot: string;
  appVersion: string; platform: string; createdAt: number; readAt: number | null;
}

export type ReportInput = Pick<ProblemReport, "workspace" | "email" | "note" | "transcript" | "bot" | "appVersion" | "platform">;

const COLUMNS = "id, workspace, email, note, transcript, bot, app_version AS appVersion, platform, created_at AS createdAt, read_at AS readAt";

export class Reports {
  private readonly db: SqlDatabase;
  private readonly now: () => number;

  constructor(db: SqlDatabase, now: () => number = Date.now) {
    this.db = db;
    this.now = now;
    this.db.exec(`CREATE TABLE IF NOT EXISTS problem_reports (id TEXT PRIMARY KEY, workspace TEXT NOT NULL, email TEXT, note TEXT NOT NULL, transcript TEXT NOT NULL,
  bot TEXT NOT NULL, app_version TEXT NOT NULL, platform TEXT NOT NULL, created_at INTEGER NOT NULL, read_at INTEGER);
CREATE INDEX IF NOT EXISTS problem_reports_created ON problem_reports (created_at);`);
  }

  add(input: ReportInput): string {
    const id = token(9);
    this.db.prepare("INSERT INTO problem_reports (id, workspace, email, note, transcript, bot, app_version, platform, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .run(id, input.workspace, input.email, input.note.slice(0, MAX_NOTE), input.transcript.slice(-MAX_TRANSCRIPT), input.bot.slice(0, 80), input.appVersion.slice(0, 32), input.platform.slice(0, 32), this.now());
    return id;
  }

  list(limit: number, offset = 0): Array<Omit<ProblemReport, "transcript">> {
    return this.db.prepare(`SELECT id, workspace, email, note, bot, app_version AS appVersion, platform, created_at AS createdAt, read_at AS readAt
      FROM problem_reports ORDER BY created_at DESC LIMIT ? OFFSET ?`).all(limit, offset) as unknown as Array<Omit<ProblemReport, "transcript">>;
  }

  unread(): number {
    return Number((this.db.prepare("SELECT COUNT(*) AS n FROM problem_reports WHERE read_at IS NULL").get() as { n: number }).n);
  }

  /** The whole report; reading it marks it read. */
  open(id: string): ProblemReport | null {
    const report = this.db.prepare(`SELECT ${COLUMNS} FROM problem_reports WHERE id = ?`).get(id) as unknown as ProblemReport | undefined;
    if (report && report.readAt === null) this.db.prepare("UPDATE problem_reports SET read_at = ? WHERE id = ?").run(this.now(), id);
    return report ?? null;
  }

  remove(id: string): void {
    this.db.prepare("DELETE FROM problem_reports WHERE id = ?").run(id);
  }

  purge(): void {
    this.db.prepare("DELETE FROM problem_reports WHERE created_at < ?").run(this.now() - KEEP_MS);
  }
}
