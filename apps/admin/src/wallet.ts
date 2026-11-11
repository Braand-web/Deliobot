// A workspace's prepaid credits. Amounts are integer micro-credits (1 credit = 1,000,000), so no rounding ever drifts.
// A request first holds an estimate, which leaves the balance at once; settling it charges the real cost and returns
// the rest. Every movement is a ledger row that is never edited.
import type { DatabaseSync } from "node:sqlite";

import { sha256, token } from "./store.ts";

export const MICRO = 1_000_000;
export const WORKSPACE_TOKEN = /^odb_workspace_[A-Za-z0-9_-]{43}$/;
/** The provider cost one credit stands for: plan prices carry the margin. */
export const DEFAULT_CREDIT_USD = 0.002;

export type LedgerKind = "grant" | "topup" | "usage" | "refund" | "adjust";

export interface LedgerRow { id: number; delta: number; kind: LedgerKind; provider: string | null; model: string | null; note: string | null; at: number }
export interface Hold { id: string; workspace: string; amount: number }

const SCHEMA = `
CREATE TABLE IF NOT EXISTS gateway_tokens (token_hash TEXT PRIMARY KEY, workspace TEXT NOT NULL REFERENCES workspaces(slug) ON DELETE CASCADE, created_at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS gateway_tokens_workspace ON gateway_tokens (workspace);
CREATE TABLE IF NOT EXISTS wallets (workspace TEXT PRIMARY KEY REFERENCES workspaces(slug) ON DELETE CASCADE, balance INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS credit_ledger (id INTEGER PRIMARY KEY AUTOINCREMENT, workspace TEXT NOT NULL, delta INTEGER NOT NULL,
  kind TEXT NOT NULL, provider TEXT, model TEXT, note TEXT, at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS credit_ledger_workspace ON credit_ledger (workspace, id);
CREATE TABLE IF NOT EXISTS holds (id TEXT PRIMARY KEY, workspace TEXT NOT NULL, amount INTEGER NOT NULL, expires_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS fal_jobs (request_id TEXT PRIMARY KEY, workspace TEXT NOT NULL, owner TEXT NOT NULL, app TEXT NOT NULL, model TEXT NOT NULL,
  hold TEXT, cost_micro INTEGER NOT NULL, settled INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL);
`;

const HOLD_TTL_MS = 30 * 60_000;

export class Wallet {
  readonly db: DatabaseSync;
  private readonly now: () => number;
  readonly creditUsd: number;

  constructor(db: DatabaseSync, options: { now?: () => number; creditUsd?: number } = {}) {
    this.db = db;
    this.now = options.now ?? Date.now;
    this.creditUsd = options.creditUsd ?? DEFAULT_CREDIT_USD;
    this.db.exec(SCHEMA);
  }

  /** Provider cost in USD as micro-credits, rounded up so a request is never free. */
  microFor(costUsd: number): number {
    return Math.max(1, Math.ceil((costUsd / this.creditUsd) * MICRO));
  }

  issueToken(workspace: string): string {
    const value = `odb_workspace_${token()}`;
    this.db.prepare("DELETE FROM gateway_tokens WHERE workspace = ?").run(workspace);
    this.db.prepare("INSERT INTO gateway_tokens (token_hash, workspace, created_at) VALUES (?, ?, ?)").run(sha256(value), workspace, this.now());
    return value;
  }

  revokeToken(workspace: string): void {
    this.db.prepare("DELETE FROM gateway_tokens WHERE workspace = ?").run(workspace);
  }

  hasToken(workspace: string): boolean {
    return Boolean(this.db.prepare("SELECT 1 FROM gateway_tokens WHERE workspace = ?").get(workspace));
  }

  /** The workspace a token belongs to, only when it is that workspace's current token. */
  tokenWorkspace(value: string, workspace: string): boolean {
    if (!WORKSPACE_TOKEN.test(value)) return false;
    return Boolean(this.db.prepare("SELECT 1 FROM gateway_tokens WHERE token_hash = ? AND workspace = ?").get(sha256(value), workspace));
  }

  balance(workspace: string): number {
    this.expireHolds();
    return (this.db.prepare("SELECT balance FROM wallets WHERE workspace = ?").get(workspace) as { balance: number } | undefined)?.balance ?? 0;
  }

  credit(workspace: string, micro: number, kind: Exclude<LedgerKind, "usage">, note: string | null): void {
    this.transaction(() => this.move(workspace, micro, kind, null, null, note));
  }

  /** Takes `micro` from the balance for a request, or less when less is left; null when nothing is left. */
  hold(workspace: string, micro: number): Hold | null {
    this.expireHolds();
    let held: Hold | null = null;
    this.transaction(() => {
      const available = (this.db.prepare("SELECT balance FROM wallets WHERE workspace = ?").get(workspace) as { balance: number } | undefined)?.balance ?? 0;
      if (available <= 0) return;
      const amount = Math.min(micro, available);
      const id = token(12);
      this.db.prepare("UPDATE wallets SET balance = balance - ? WHERE workspace = ?").run(amount, workspace);
      this.db.prepare("INSERT INTO holds (id, workspace, amount, expires_at) VALUES (?, ?, ?, ?)").run(id, workspace, amount, this.now() + HOLD_TTL_MS);
      held = { id, workspace, amount };
    });
    return held;
  }

  /** Charges the real cost of a held request and returns the rest; a cost above the hold is charged in full. */
  settle(holdId: string, costMicro: number, provider: string, model: string): void {
    this.transaction(() => {
      const hold = this.db.prepare("SELECT workspace, amount FROM holds WHERE id = ?").get(holdId) as { workspace: string; amount: number } | undefined;
      if (!hold) return;
      this.db.prepare("DELETE FROM holds WHERE id = ?").run(holdId);
      this.db.prepare("UPDATE wallets SET balance = balance + ? WHERE workspace = ?").run(hold.amount - costMicro, hold.workspace);
      this.db.prepare("INSERT INTO credit_ledger (workspace, delta, kind, provider, model, note, at) VALUES (?, ?, 'usage', ?, ?, NULL, ?)")
        .run(hold.workspace, -costMicro, provider, model, this.now());
    });
  }

  /** Charges work already done, such as a cloud computer's minutes, without a hold. */
  charge(workspace: string, micro: number, provider: string, model: string): void {
    this.transaction(() => {
      this.db.prepare("INSERT INTO wallets (workspace, balance) VALUES (?, 0) ON CONFLICT (workspace) DO NOTHING").run(workspace);
      this.db.prepare("UPDATE wallets SET balance = balance - ? WHERE workspace = ?").run(micro, workspace);
      this.db.prepare("INSERT INTO credit_ledger (workspace, delta, kind, provider, model, note, at) VALUES (?, ?, 'usage', ?, ?, NULL, ?)")
        .run(workspace, -micro, provider, model, this.now());
    });
  }

  /** A request that made nothing gives its hold back whole. */
  release(holdId: string): void {
    this.transaction(() => {
      const hold = this.db.prepare("SELECT workspace, amount FROM holds WHERE id = ?").get(holdId) as { workspace: string; amount: number } | undefined;
      if (!hold) return;
      this.db.prepare("DELETE FROM holds WHERE id = ?").run(holdId);
      this.db.prepare("UPDATE wallets SET balance = balance + ? WHERE workspace = ?").run(hold.amount, hold.workspace);
    });
  }

  ledger(workspace: string, limit = 50): LedgerRow[] {
    return this.db.prepare("SELECT id, delta, kind, provider, model, note, at FROM credit_ledger WHERE workspace = ? ORDER BY id DESC LIMIT ?")
      .all(workspace, limit) as unknown as LedgerRow[];
  }

  usedThisMonth(workspace: string): number {
    const start = new Date(this.now());
    const from = Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 1);
    const row = this.db.prepare("SELECT COALESCE(SUM(-delta), 0) AS used FROM credit_ledger WHERE workspace = ? AND kind = 'usage' AND at >= ?").get(workspace, from) as { used: number };
    return row.used;
  }

  recordFalJob(job: { requestId: string; workspace: string; owner: string; app: string; model: string; hold: string; costMicro: number }): void {
    this.db.prepare("INSERT INTO fal_jobs (request_id, workspace, owner, app, model, hold, cost_micro, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
      .run(job.requestId, job.workspace, job.owner, job.app, job.model, job.hold, job.costMicro, this.now());
  }

  /** A fal.ai job, only to the workspace that started it. */
  falJob(workspace: string, requestId: string): { owner: string; app: string; model: string; hold: string | null; costMicro: number; settled: boolean } | null {
    const row = this.db.prepare("SELECT owner, app, model, hold, cost_micro AS costMicro, settled FROM fal_jobs WHERE request_id = ? AND workspace = ?").get(requestId, workspace) as
      { owner: string; app: string; model: string; hold: string | null; costMicro: number; settled: number } | undefined;
    return row ? { ...row, settled: row.settled === 1 } : null;
  }

  settleFalJob(workspace: string, requestId: string, outcome: "made" | "failed"): void {
    const job = this.falJob(workspace, requestId);
    if (!job || job.settled || !job.hold) return;
    this.db.prepare("UPDATE fal_jobs SET settled = 1 WHERE request_id = ?").run(requestId);
    if (outcome === "made") this.settle(job.hold, job.costMicro, "fal", job.model);
    else this.release(job.hold);
  }

  /** A hold whose request vanished (a crash, a dropped connection) is charged in full after half an hour, like the work it paid for. */
  private expireHolds(): void {
    const stale = this.db.prepare("SELECT id, workspace, amount FROM holds WHERE expires_at <= ?").all(this.now()) as Array<{ id: string; workspace: string; amount: number }>;
    for (const hold of stale) this.settle(hold.id, hold.amount, "unknown", "unsettled");
  }

  private move(workspace: string, micro: number, kind: LedgerKind, provider: string | null, model: string | null, note: string | null): void {
    this.db.prepare("INSERT INTO wallets (workspace, balance) VALUES (?, ?) ON CONFLICT (workspace) DO UPDATE SET balance = balance + excluded.balance").run(workspace, micro);
    this.db.prepare("INSERT INTO credit_ledger (workspace, delta, kind, provider, model, note, at) VALUES (?, ?, ?, ?, ?, ?, ?)").run(workspace, micro, kind, provider, model, note, this.now());
  }

  private transaction(run: () => void): void {
    if (this.db.isTransaction) return run();
    this.db.exec("BEGIN IMMEDIATE");
    try { run(); this.db.exec("COMMIT"); } catch (error) { this.db.exec("ROLLBACK"); throw error; }
  }
}
