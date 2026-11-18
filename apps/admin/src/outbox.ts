// E-mails the operator sends to many customers at once. They wait here and leave a few at a time from the sweep, slowly
// enough for the mail provider's rate limit (Resend allows 2 a second by default).
import type { Mailer } from "./mail.ts";
import type { SqlDatabase } from "./sql.ts";

export const SEND_SPACING_MS = 600;
const PER_SWEEP = 40;

export interface Broadcast { id: number; subject: string; audience: string; total: number; sent: number; failed: number; at: number; actor: string }

export class Outbox {
  private readonly db: SqlDatabase;
  private readonly now: () => number;

  constructor(db: SqlDatabase, now: () => number = Date.now) {
    this.db = db;
    this.now = now;
    db.exec(`
CREATE TABLE IF NOT EXISTS broadcasts (id INTEGER PRIMARY KEY AUTOINCREMENT, subject TEXT NOT NULL, text TEXT NOT NULL, audience TEXT NOT NULL, actor TEXT NOT NULL, at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS outbox (id INTEGER PRIMARY KEY AUTOINCREMENT, broadcast INTEGER NOT NULL, email TEXT NOT NULL, state TEXT NOT NULL DEFAULT 'queued', at INTEGER);
CREATE INDEX IF NOT EXISTS outbox_state ON outbox (state, id);`);
  }

  /** Queues one message per distinct address; answers how many were queued. */
  queue(input: { subject: string; text: string; audience: string; emails: readonly string[] }, actor: string): number {
    const emails = [...new Set(input.emails.map((email) => email.trim().toLowerCase()).filter(Boolean))];
    if (!emails.length) return 0;
    return this.db.transaction(() => {
      this.db.prepare("INSERT INTO broadcasts (subject, text, audience, actor, at) VALUES (?, ?, ?, ?, ?)").run(input.subject, input.text, input.audience, actor, this.now());
      const id = Number((this.db.prepare("SELECT MAX(id) AS id FROM broadcasts").get() as { id: number }).id);
      for (const email of emails) this.db.prepare("INSERT INTO outbox (broadcast, email) VALUES (?, ?)").run(id, email);
      return emails.length;
    });
  }

  /** One message to one person, sent with the next batch; kept out of the operator's list of broadcasts. */
  notify(email: string, subject: string, text: string): void {
    this.queue({ subject, text, audience: "system", emails: [email] }, "system");
  }

  broadcasts(limit = 20): Broadcast[] {
    return (this.db.prepare(`SELECT b.id, b.subject, b.audience, b.actor, b.at, COUNT(o.id) AS total,
      SUM(CASE WHEN o.state = 'sent' THEN 1 ELSE 0 END) AS sent, SUM(CASE WHEN o.state = 'failed' THEN 1 ELSE 0 END) AS failed
      FROM broadcasts b LEFT JOIN outbox o ON o.broadcast = b.id WHERE b.audience != 'system' GROUP BY b.id ORDER BY b.id DESC LIMIT ?`).all(limit) as Array<Record<string, unknown>>)
      .map((row) => ({ id: Number(row.id), subject: String(row.subject), audience: String(row.audience), actor: String(row.actor), at: Number(row.at),
        total: Number(row.total), sent: Number(row.sent ?? 0), failed: Number(row.failed ?? 0) }));
  }

  /** Sends the next queued messages; answers how many left. `pause` waits between two messages. */
  async drain(mailer: Mailer, pause: (ms: number) => Promise<void> = (ms) => new Promise((done) => setTimeout(done, ms))): Promise<number> {
    const due = this.db.prepare(`SELECT o.id, o.email, b.subject, b.text FROM outbox o JOIN broadcasts b ON b.id = o.broadcast WHERE o.state = 'queued' ORDER BY o.id LIMIT ?`)
      .all(PER_SWEEP) as Array<{ id: number; email: string; subject: string; text: string }>;
    let sent = 0;
    for (const message of due) {
      if (Number(this.db.prepare("UPDATE outbox SET state = 'sending' WHERE id = ? AND state = 'queued'").run(message.id).changes) !== 1) continue;
      if (sent) await pause(SEND_SPACING_MS);
      const state = await mailer.send({ to: message.email, subject: message.subject, text: message.text }).then(() => "sent", () => "failed");
      this.db.prepare("UPDATE outbox SET state = ?, at = ? WHERE id = ?").run(state, this.now(), message.id);
      sent += 1;
    }
    return sent;
  }
}
