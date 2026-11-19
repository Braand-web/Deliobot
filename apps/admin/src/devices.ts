// Connecting a desktop app to a Deliobot account (RFC 8628's device flow): the app asks for a code and polls; the person
// approves it signed in on the portal. An app on the person's own computer also names its loopback address: once signed
// in, the portal sends the browser there with a one-time nonce, and only the app holding both that nonce and its device
// code can finish, so nothing is typed. The app then holds its own revocable device token for the gateway.
import { randomInt } from "node:crypto";
import type { SqlDatabase } from "./sql.ts";

import { sha256, token } from "./store.ts";

export const DEVICE_TOKEN = /^odb_device_[A-Za-z0-9_-]{43}$/;
const USER_CODE_ALPHABET = "BCDFGHJKLMNPQRSTVWXZ";
const FLOW_TTL_MS = 10 * 60_000;
export const DEVICE_POLL_SECONDS = 3;
/** Security: the only place a signed-in browser is sent with a link nonce is the app's own loopback listener. */
export const LOOPBACK_RETURN = /^http:\/\/(?:127\.0\.0\.1|localhost|\[::1\]):\d{2,5}\/delio-linked$/;

export interface DeviceRow { id: string; workspace: string; label: string; createdAt: number; lastUsedAt: number | null }

export type DevicePoll =
  | { status: "pending" }
  | { status: "approved"; token: string; workspace: string }
  | { status: "denied" | "expired" };

/** A connected app unused this long must be connected again. */
export const DEVICE_IDLE_MS = 90 * 24 * 60 * 60_000;

export class Devices {
  private readonly db: SqlDatabase;
  private readonly now: () => number;

  constructor(db: SqlDatabase, now: () => number = Date.now) {
    this.db = db;
    this.now = now;
    this.db.exec(`
CREATE TABLE IF NOT EXISTS device_flows (device_hash TEXT PRIMARY KEY, user_code TEXT NOT NULL UNIQUE, label TEXT NOT NULL, state TEXT NOT NULL,
  workspace TEXT, account_id TEXT, expires_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS device_links (device_hash TEXT PRIMARY KEY, return_to TEXT NOT NULL, nonce_hash TEXT, workspace TEXT, account_id TEXT);
CREATE TABLE IF NOT EXISTS device_tokens (id TEXT PRIMARY KEY, token_hash TEXT NOT NULL UNIQUE, workspace TEXT NOT NULL REFERENCES workspaces(slug) ON DELETE CASCADE,
  account_id TEXT NOT NULL, label TEXT NOT NULL, created_at INTEGER NOT NULL, last_used_at INTEGER);`);
  }

  /** A new code pair: the secret one stays with the app, the short one is typed or shown on the portal. */
  start(label: string, returnTo?: string | null): { deviceCode: string; userCode: string; expiresIn: number } {
    this.db.prepare("DELETE FROM device_links WHERE device_hash IN (SELECT device_hash FROM device_flows WHERE expires_at <= ?)").run(this.now());
    this.db.prepare("DELETE FROM device_flows WHERE expires_at <= ?").run(this.now());
    const deviceCode = token();
    let userCode = "";
    do {
      userCode = Array.from({ length: 8 }, () => USER_CODE_ALPHABET[randomInt(USER_CODE_ALPHABET.length)]).join("");
      userCode = `${userCode.slice(0, 4)}-${userCode.slice(4)}`;
    } while (this.db.prepare("SELECT 1 FROM device_flows WHERE user_code = ?").get(userCode));
    this.db.prepare("INSERT INTO device_flows (device_hash, user_code, label, state, expires_at) VALUES (?, ?, ?, 'pending', ?)")
      .run(sha256(deviceCode), userCode, label.slice(0, 80) || "Desktop app", this.now() + FLOW_TTL_MS);
    if (returnTo && LOOPBACK_RETURN.test(returnTo)) this.db.prepare("INSERT INTO device_links (device_hash, return_to) VALUES (?, ?)").run(sha256(deviceCode), returnTo);
    return { deviceCode, userCode, expiresIn: FLOW_TTL_MS / 1000 };
  }

  /** The app's loopback address for a pending code, when the app named one. */
  returnTo(userCode: string): string | null {
    const row = this.db.prepare(`SELECT l.return_to FROM device_links l JOIN device_flows f ON f.device_hash = l.device_hash
      WHERE f.user_code = ? AND f.state = 'pending' AND f.expires_at > ?`).get(normalize(userCode), this.now()) as { return_to: string } | undefined;
    return row?.return_to ?? null;
  }

  /** The person signed in for a code: a one-time nonce the browser carries back to the app, kept with whose credits it spends. */
  offerLink(userCode: string, decision: { workspace: string; accountId: string }): string | null {
    const nonce = token();
    const changed = this.db.prepare(`UPDATE device_links SET nonce_hash = ?, workspace = ?, account_id = ?
      WHERE device_hash = (SELECT device_hash FROM device_flows WHERE user_code = ? AND state = 'pending' AND expires_at > ?)`)
      .run(sha256(nonce), decision.workspace, decision.accountId, normalize(userCode), this.now());
    return Number(changed.changes) === 1 ? nonce : null;
  }

  /** The app came back with its device code and the nonce its own computer received: the code is approved. */
  confirmLink(deviceCode: string, nonce: string): boolean {
    const hash = sha256(deviceCode);
    const link = this.db.prepare("SELECT nonce_hash, workspace, account_id FROM device_links WHERE device_hash = ?").get(hash) as
      { nonce_hash: string | null; workspace: string | null; account_id: string | null } | undefined;
    if (!link?.nonce_hash || !link.workspace || !link.account_id || link.nonce_hash !== sha256(nonce)) return false;
    const changed = this.db.prepare("UPDATE device_flows SET state = 'approved', workspace = ?, account_id = ? WHERE device_hash = ? AND state = 'pending' AND expires_at > ?")
      .run(link.workspace, link.account_id, hash, this.now());
    this.db.prepare("DELETE FROM device_links WHERE device_hash = ?").run(hash);
    return Number(changed.changes) === 1;
  }

  pendingLabel(userCode: string): string | null {
    const row = this.db.prepare("SELECT label FROM device_flows WHERE user_code = ? AND state = 'pending' AND expires_at > ?").get(normalize(userCode), this.now()) as { label: string } | undefined;
    return row?.label ?? null;
  }

  decide(userCode: string, decision: { workspace: string; accountId: string } | "deny"): boolean {
    const code = normalize(userCode);
    const changed = decision === "deny"
      ? this.db.prepare("UPDATE device_flows SET state = 'denied' WHERE user_code = ? AND state = 'pending' AND expires_at > ?").run(code, this.now())
      : this.db.prepare("UPDATE device_flows SET state = 'approved', workspace = ?, account_id = ? WHERE user_code = ? AND state = 'pending' AND expires_at > ?")
        .run(decision.workspace, decision.accountId, code, this.now());
    return Number(changed.changes) === 1;
  }

  /** What the app learns when it polls; an approved flow hands out its token once and is gone. */
  poll(deviceCode: string): DevicePoll {
    const hash = sha256(deviceCode);
    const row = this.db.prepare("SELECT label, state, workspace, account_id, expires_at FROM device_flows WHERE device_hash = ?").get(hash) as
      { label: string; state: string; workspace: string | null; account_id: string | null; expires_at: number } | undefined;
    if (!row || row.expires_at <= this.now()) return { status: "expired" };
    if (row.state === "pending") return { status: "pending" };
    this.db.prepare("DELETE FROM device_flows WHERE device_hash = ?").run(hash);
    this.db.prepare("DELETE FROM device_links WHERE device_hash = ?").run(hash);
    if (row.state !== "approved" || !row.workspace || !row.account_id) return { status: "denied" };
    const value = `odb_device_${token()}`;
    this.db.prepare("INSERT INTO device_tokens (id, token_hash, workspace, account_id, label, created_at) VALUES (?, ?, ?, ?, ?, ?)")
      .run(token(9), sha256(value), row.workspace, row.account_id, row.label, this.now());
    return { status: "approved", token: value, workspace: row.workspace };
  }

  /** True when the token is a live device token of this workspace, connected by someone who still administers it; its last use is noted. */
  check(value: string, workspace: string): boolean {
    if (!DEVICE_TOKEN.test(value)) return false;
    // Security: a token lives only as long as its account administers the workspace, so removing or demoting someone ends their apps' access to its credits.
    const found = this.db.prepare(`SELECT id FROM device_tokens WHERE token_hash = ? AND workspace = ? AND COALESCE(last_used_at, created_at) > ?
      AND account_id NOT IN (SELECT account_id FROM blocked_accounts)
      AND account_id IN (SELECT account_id FROM members WHERE workspace = device_tokens.workspace AND role = 'admin')`).get(sha256(value), workspace, this.now() - DEVICE_IDLE_MS) as { id: string } | undefined;
    if (found) this.db.prepare("UPDATE device_tokens SET last_used_at = ? WHERE id = ?").run(this.now(), found.id);
    return Boolean(found);
  }

  /** The address of the account that connected this device token; null when the token is not a live one of this workspace. */
  ownerEmail(value: string, workspace: string): string | null {
    if (!DEVICE_TOKEN.test(value)) return null;
    const row = this.db.prepare(`SELECT a.email FROM device_tokens d JOIN accounts a ON a.id = d.account_id WHERE d.token_hash = ? AND d.workspace = ?`)
      .get(sha256(value), workspace) as { email: string } | undefined;
    return row?.email ?? null;
  }

  identity(value: string): { workspace: string; id: string; email: string } | null {
    if (!DEVICE_TOKEN.test(value)) return null;
    return this.db.prepare(`SELECT d.workspace, a.id, a.email FROM device_tokens d JOIN accounts a ON a.id = d.account_id
      JOIN members m ON m.account_id = a.id AND m.workspace = d.workspace AND m.role = 'admin'
      WHERE d.token_hash = ? AND COALESCE(d.last_used_at, d.created_at) > ? AND a.id NOT IN (SELECT account_id FROM blocked_accounts)`)
      .get(sha256(value), this.now() - DEVICE_IDLE_MS) as { workspace: string; id: string; email: string } | undefined ?? null;
  }

  /** A device signing itself out: its own token stops working. */
  revokeToken(value: string, workspace: string): void {
    if (DEVICE_TOKEN.test(value)) this.db.prepare("DELETE FROM device_tokens WHERE token_hash = ? AND workspace = ?").run(sha256(value), workspace);
  }

  list(workspace: string): DeviceRow[] {
    return this.db.prepare("SELECT id, workspace, label, created_at AS createdAt, last_used_at AS lastUsedAt FROM device_tokens WHERE workspace = ? ORDER BY created_at DESC")
      .all(workspace) as unknown as DeviceRow[];
  }

  revoke(workspace: string, id: string): void {
    this.db.prepare("DELETE FROM device_tokens WHERE workspace = ? AND id = ?").run(workspace, id);
  }
}

const normalize = (userCode: string) => {
  const letters = userCode.toUpperCase().replace(/[^A-Z]/g, "");
  return letters.length === 8 ? `${letters.slice(0, 4)}-${letters.slice(4)}` : "";
};
