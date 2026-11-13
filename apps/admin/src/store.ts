import { createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import type { SqlDatabase } from "./sql.ts";

export type Role = "admin" | "member";

export interface Account { id: string; email: string }
export interface Workspace { slug: string; name: string; tenantUrl: string; createdAt: number }
export interface Member { accountId: string; email: string; role: Role; joinedAt: number }
export interface Invitation { id: string; workspace: string; email: string; role: Role; expiresAt: number }
export interface SsoConfig { workspace: string; issuer: string; clientId: string; clientSecret: string; domain: string; autoJoin: boolean }

const OTP_TTL_MS = 10 * 60_000;
const OTP_MAX_ATTEMPTS = 5;
const SESSION_TTL_MS = 14 * 24 * 60 * 60_000;
const HANDOFF_CODE_TTL_MS = 60_000;
const INVITATION_TTL_MS = 7 * 24 * 60 * 60_000;

export const token = (bytes = 32) => randomBytes(bytes).toString("base64url");
export const sha256 = (value: string) => createHash("sha256").update(value).digest("base64url");
export const normalizeEmail = (email: string) => email.trim().toLowerCase();
export const validEmail = (email: string) => email.length <= 320 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
export const validSlug = (slug: string) => /^[a-z][a-z0-9-]{1,30}$/.test(slug);

function sameText(left: string, right: string): boolean {
  const a = Buffer.from(left), b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS accounts (id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS otps (email TEXT PRIMARY KEY, code_mac TEXT NOT NULL, expires_at INTEGER NOT NULL, attempts INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS rate_events (bucket TEXT NOT NULL, at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS rate_events_bucket ON rate_events (bucket, at);
CREATE TABLE IF NOT EXISTS sessions (token_hash TEXT PRIMARY KEY, account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE, expires_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS workspaces (slug TEXT PRIMARY KEY, name TEXT NOT NULL, tenant_url TEXT NOT NULL, created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS members (workspace TEXT NOT NULL REFERENCES workspaces(slug) ON DELETE CASCADE, account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('admin', 'member')), joined_at INTEGER NOT NULL, PRIMARY KEY (workspace, account_id));
CREATE TABLE IF NOT EXISTS invitations (id TEXT PRIMARY KEY, token_hash TEXT NOT NULL UNIQUE, workspace TEXT NOT NULL REFERENCES workspaces(slug) ON DELETE CASCADE,
  email TEXT NOT NULL, role TEXT NOT NULL CHECK (role IN ('admin', 'member')), expires_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS handoff_codes (code_hash TEXT PRIMARY KEY, workspace TEXT NOT NULL, account_id TEXT NOT NULL, challenge TEXT NOT NULL,
  redirect_uri TEXT NOT NULL, expires_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS grants (grant_hash TEXT PRIMARY KEY, workspace TEXT NOT NULL, account_id TEXT NOT NULL, created_at INTEGER NOT NULL,
  FOREIGN KEY (workspace, account_id) REFERENCES members(workspace, account_id) ON DELETE CASCADE);
CREATE TABLE IF NOT EXISTS sso (workspace TEXT PRIMARY KEY REFERENCES workspaces(slug) ON DELETE CASCADE, issuer TEXT NOT NULL, client_id TEXT NOT NULL,
  client_secret TEXT NOT NULL, domain TEXT NOT NULL, auto_join INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS sso_states (state TEXT PRIMARY KEY, workspace TEXT NOT NULL, verifier TEXT NOT NULL, nonce TEXT NOT NULL, next TEXT NOT NULL, expires_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS audit (id INTEGER PRIMARY KEY AUTOINCREMENT, workspace TEXT, actor TEXT, action TEXT NOT NULL, target TEXT, at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS blocked_accounts (account_id TEXT PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE, at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS suspensions (workspace TEXT PRIMARY KEY REFERENCES workspaces(slug) ON DELETE CASCADE, reason TEXT, at INTEGER NOT NULL);
`;

export type OtpResult = { ok: true; account: Account } | { ok: false; reason: "invalid" | "expired" | "locked" };

export class AdminStore {
  readonly db: SqlDatabase;
  private readonly secret: Buffer;
  private readonly now: () => number;

  constructor(options: { db: SqlDatabase; secret: Buffer; now?: () => number }) {
    this.db = options.db;
    this.db.exec(SCHEMA);
    this.secret = options.secret;
    this.now = options.now ?? Date.now;
  }

  close(): void { this.db.close(); }

  private mac(value: string): string {
    return createHmac("sha256", this.secret).update(value).digest("base64url");
  }

  /** Counts this event and answers whether the bucket is still within `limit` per `windowMs`. */
  allow(bucket: string, limit: number, windowMs: number): boolean {
    const at = this.now();
    this.db.prepare("DELETE FROM rate_events WHERE at <= ?").run(at - 24 * 60 * 60_000);
    const key = this.mac(`rate:${bucket}`);
    const { count } = this.db.prepare("SELECT COUNT(*) AS count FROM rate_events WHERE bucket = ? AND at > ?").get(key, at - windowMs) as { count: number };
    if (count >= limit) return false;
    this.db.prepare("INSERT INTO rate_events (bucket, at) VALUES (?, ?)").run(key, at);
    return true;
  }

  issueOtp(email: string): string {
    const code = String(randomInt(0, 100_000_000)).padStart(8, "0");
    this.db.prepare("INSERT INTO otps (email, code_mac, expires_at, attempts) VALUES (?, ?, ?, 0) ON CONFLICT (email) DO UPDATE SET code_mac = excluded.code_mac, expires_at = excluded.expires_at, attempts = 0")
      .run(email, this.mac(`otp:${email}:${code}`), this.now() + OTP_TTL_MS);
    return code;
  }

  verifyOtp(email: string, code: string): OtpResult {
    const row = this.db.prepare("SELECT code_mac, expires_at, attempts FROM otps WHERE email = ?").get(email) as { code_mac: string; expires_at: number; attempts: number } | undefined;
    if (!row) return { ok: false, reason: "invalid" };
    if (row.expires_at <= this.now()) {
      this.db.prepare("DELETE FROM otps WHERE email = ?").run(email);
      return { ok: false, reason: "expired" };
    }
    if (row.attempts >= OTP_MAX_ATTEMPTS) return { ok: false, reason: "locked" };
    if (!sameText(row.code_mac, this.mac(`otp:${email}:${code.trim()}`))) {
      this.db.prepare("UPDATE otps SET attempts = attempts + 1 WHERE email = ?").run(email);
      return { ok: false, reason: "invalid" };
    }
    this.db.prepare("DELETE FROM otps WHERE email = ?").run(email);
    return { ok: true, account: this.ensureAccount(email) };
  }

  ensureAccount(email: string): Account {
    const found = this.db.prepare("SELECT id, email FROM accounts WHERE email = ?").get(email) as Account | undefined;
    if (found) return found;
    const account = { id: token(16), email };
    this.db.prepare("INSERT INTO accounts (id, email, created_at) VALUES (?, ?, ?)").run(account.id, email, this.now());
    return account;
  }

  createSession(accountId: string): { token: string; maxAgeSeconds: number } {
    const value = token();
    this.db.prepare("DELETE FROM sessions WHERE expires_at <= ?").run(this.now());
    this.db.prepare("INSERT INTO sessions (token_hash, account_id, expires_at) VALUES (?, ?, ?)").run(sha256(value), accountId, this.now() + SESSION_TTL_MS);
    return { token: value, maxAgeSeconds: SESSION_TTL_MS / 1000 };
  }

  sessionAccount(value: string | undefined): Account | null {
    if (!value || value.length > 128) return null;
    return (this.db.prepare(`SELECT accounts.id, accounts.email FROM sessions JOIN accounts ON accounts.id = sessions.account_id WHERE token_hash = ? AND expires_at > ?
      AND accounts.id NOT IN (SELECT account_id FROM blocked_accounts)`).get(sha256(value), this.now()) as Account | undefined) ?? null;
  }

  endSession(value: string): void {
    this.db.prepare("DELETE FROM sessions WHERE token_hash = ?").run(sha256(value));
  }

  createWorkspace(input: { slug: string; name: string; tenantUrl: string; ownerEmail: string }, actor: string): Workspace {
    const owner = this.ensureAccount(input.ownerEmail);
    const workspace = { slug: input.slug, name: input.name, tenantUrl: input.tenantUrl, createdAt: this.now() };
    this.transaction(() => {
      this.db.prepare("INSERT INTO workspaces (slug, name, tenant_url, created_at) VALUES (?, ?, ?, ?)").run(workspace.slug, workspace.name, workspace.tenantUrl, workspace.createdAt);
      this.db.prepare("INSERT INTO members (workspace, account_id, role, joined_at) VALUES (?, ?, 'admin', ?)").run(workspace.slug, owner.id, this.now());
      this.audit(workspace.slug, actor, "workspace.create", input.ownerEmail);
    });
    return workspace;
  }

  workspace(slug: string): Workspace | null {
    return (this.db.prepare("SELECT slug, name, tenant_url AS tenantUrl, created_at AS createdAt FROM workspaces WHERE slug = ?").get(slug) as Workspace | undefined) ?? null;
  }

  allWorkspaces(): Workspace[] {
    return this.db.prepare("SELECT slug, name, tenant_url AS tenantUrl, created_at AS createdAt FROM workspaces ORDER BY slug").all() as unknown as Workspace[];
  }

  workspacesOf(accountId: string): Array<Workspace & { role: Role }> {
    return this.db.prepare(`SELECT w.slug, w.name, w.tenant_url AS tenantUrl, w.created_at AS createdAt, m.role FROM members m JOIN workspaces w ON w.slug = m.workspace
      WHERE m.account_id = ? ORDER BY w.slug`).all(accountId) as unknown as Array<Workspace & { role: Role }>;
  }

  role(workspace: string, accountId: string): Role | null {
    const row = this.db.prepare("SELECT role FROM members WHERE workspace = ? AND account_id = ?").get(workspace, accountId) as { role: Role } | undefined;
    return row?.role ?? null;
  }

  members(workspace: string): Member[] {
    return this.db.prepare(`SELECT m.account_id AS accountId, a.email, m.role, m.joined_at AS joinedAt FROM members m JOIN accounts a ON a.id = m.account_id
      WHERE m.workspace = ? ORDER BY a.email`).all(workspace) as unknown as Member[];
  }

  private admins(workspace: string): number {
    return (this.db.prepare("SELECT COUNT(*) AS count FROM members WHERE workspace = ? AND role = 'admin'").get(workspace) as { count: number }).count;
  }

  addMember(workspace: string, accountId: string, role: Role, actor: string): void {
    this.db.prepare("INSERT INTO members (workspace, account_id, role, joined_at) VALUES (?, ?, ?, ?) ON CONFLICT DO NOTHING").run(workspace, accountId, role, this.now());
    this.audit(workspace, actor, "member.add", `${accountId}:${role}`);
  }

  /** A workspace always keeps one admin: the change is refused rather than leaving nobody able to manage it. */
  setRole(workspace: string, accountId: string, role: Role, actor: string): "ok" | "last-admin" | "missing" {
    const current = this.role(workspace, accountId);
    if (!current) return "missing";
    if (current === "admin" && role !== "admin" && this.admins(workspace) <= 1) return "last-admin";
    this.db.prepare("UPDATE members SET role = ? WHERE workspace = ? AND account_id = ?").run(role, workspace, accountId);
    this.audit(workspace, actor, "member.role", `${accountId}:${role}`);
    return "ok";
  }

  removeMember(workspace: string, accountId: string, actor: string): "ok" | "last-admin" | "missing" {
    const current = this.role(workspace, accountId);
    if (!current) return "missing";
    if (current === "admin" && this.admins(workspace) <= 1) return "last-admin";
    this.db.prepare("DELETE FROM members WHERE workspace = ? AND account_id = ?").run(workspace, accountId);
    this.audit(workspace, actor, "member.remove", accountId);
    return "ok";
  }

  invite(workspace: string, email: string, role: Role, actor: string): { token: string; invitation: Invitation } {
    const value = token();
    const invitation = { id: token(12), workspace, email, role, expiresAt: this.now() + INVITATION_TTL_MS };
    this.db.prepare("DELETE FROM invitations WHERE workspace = ? AND email = ?").run(workspace, email);
    this.db.prepare("INSERT INTO invitations (id, token_hash, workspace, email, role, expires_at) VALUES (?, ?, ?, ?, ?, ?)")
      .run(invitation.id, sha256(value), workspace, email, role, invitation.expiresAt);
    this.audit(workspace, actor, "invitation.create", `${email}:${role}`);
    return { token: value, invitation };
  }

  invitations(workspace: string): Invitation[] {
    return this.db.prepare("SELECT id, workspace, email, role, expires_at AS expiresAt FROM invitations WHERE workspace = ? AND expires_at > ? ORDER BY email")
      .all(workspace, this.now()) as unknown as Invitation[];
  }

  invitation(value: string): Invitation | null {
    return (this.db.prepare("SELECT id, workspace, email, role, expires_at AS expiresAt FROM invitations WHERE token_hash = ? AND expires_at > ?")
      .get(sha256(value), this.now()) as Invitation | undefined) ?? null;
  }

  cancelInvitation(workspace: string, id: string, actor: string): void {
    this.db.prepare("DELETE FROM invitations WHERE workspace = ? AND id = ?").run(workspace, id);
    this.audit(workspace, actor, "invitation.cancel", id);
  }

  /** Only the invited address may accept, and an existing membership keeps its role. */
  acceptInvitation(value: string, account: Account): Invitation | null {
    const invitation = this.invitation(value);
    if (!invitation || invitation.email !== account.email) return null;
    this.transaction(() => {
      this.db.prepare("DELETE FROM invitations WHERE id = ?").run(invitation.id);
      this.addMember(invitation.workspace, account.id, invitation.role, account.email);
    });
    return invitation;
  }

  issueHandoffCode(input: { workspace: string; accountId: string; challenge: string; redirectUri: string }): string {
    const code = token();
    this.db.prepare("DELETE FROM handoff_codes WHERE expires_at <= ?").run(this.now());
    this.db.prepare("INSERT INTO handoff_codes (code_hash, workspace, account_id, challenge, redirect_uri, expires_at) VALUES (?, ?, ?, ?, ?, ?)")
      .run(sha256(code), input.workspace, input.accountId, input.challenge, input.redirectUri, this.now() + HANDOFF_CODE_TTL_MS);
    return code;
  }

  /** Spends the code whatever the outcome, so a code is tried at most once. */
  consumeHandoffCode(workspace: string, code: string, verifier: string): { grant: string; email: string; role: Role } | null {
    const hash = sha256(code);
    const row = this.db.prepare("SELECT workspace, account_id, challenge, expires_at FROM handoff_codes WHERE code_hash = ?").get(hash) as
      { workspace: string; account_id: string; challenge: string; expires_at: number } | undefined;
    if (!row) return null;
    this.db.prepare("DELETE FROM handoff_codes WHERE code_hash = ?").run(hash);
    if (row.workspace !== workspace || row.expires_at <= this.now() || !sameText(sha256(verifier), row.challenge)) return null;
    const role = this.role(workspace, row.account_id);
    if (!role || this.blocked(row.account_id)) return null;
    const grant = token();
    this.db.prepare("INSERT INTO grants (grant_hash, workspace, account_id, created_at) VALUES (?, ?, ?, ?)").run(sha256(grant), workspace, row.account_id, this.now());
    const { email } = this.db.prepare("SELECT email FROM accounts WHERE id = ?").get(row.account_id) as { email: string };
    return { grant, email, role };
  }

  /** The member's current role, so a demotion or removal reaches every open session on its next check. */
  checkGrant(workspace: string, grant: string): { email: string; role: Role } | null {
    return (this.db.prepare(`SELECT a.email, m.role FROM grants g JOIN members m ON m.workspace = g.workspace AND m.account_id = g.account_id
      JOIN accounts a ON a.id = g.account_id WHERE g.grant_hash = ? AND g.workspace = ? AND g.account_id NOT IN (SELECT account_id FROM blocked_accounts)`).get(sha256(grant), workspace) as { email: string; role: Role } | undefined) ?? null;
  }

  sso(workspace: string): SsoConfig | null {
    const row = this.db.prepare("SELECT workspace, issuer, client_id AS clientId, client_secret AS clientSecret, domain, auto_join AS autoJoin FROM sso WHERE workspace = ?")
      .get(workspace) as (Omit<SsoConfig, "autoJoin"> & { autoJoin: number }) | undefined;
    return row ? { ...row, autoJoin: row.autoJoin === 1 } : null;
  }

  ssoForDomain(domain: string): SsoConfig[] {
    return (this.db.prepare("SELECT workspace FROM sso WHERE domain = ?").all(domain) as Array<{ workspace: string }>).map((row) => this.sso(row.workspace)!);
  }

  setSso(config: SsoConfig, actor: string): void {
    this.db.prepare(`INSERT INTO sso (workspace, issuer, client_id, client_secret, domain, auto_join) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT (workspace) DO UPDATE SET issuer = excluded.issuer, client_id = excluded.client_id, client_secret = excluded.client_secret,
      domain = excluded.domain, auto_join = excluded.auto_join`).run(config.workspace, config.issuer, config.clientId, config.clientSecret, config.domain, config.autoJoin ? 1 : 0);
    this.audit(config.workspace, actor, "sso.set", config.issuer);
  }

  removeSso(workspace: string, actor: string): void {
    this.db.prepare("DELETE FROM sso WHERE workspace = ?").run(workspace);
    this.audit(workspace, actor, "sso.remove", null);
  }

  saveSsoState(input: { state: string; workspace: string; verifier: string; nonce: string; next: string }): void {
    this.db.prepare("DELETE FROM sso_states WHERE expires_at <= ?").run(this.now());
    this.db.prepare("INSERT INTO sso_states (state, workspace, verifier, nonce, next, expires_at) VALUES (?, ?, ?, ?, ?, ?)")
      .run(input.state, input.workspace, input.verifier, input.nonce, input.next, this.now() + 10 * 60_000);
  }

  takeSsoState(state: string): { workspace: string; verifier: string; nonce: string; next: string } | null {
    const row = this.db.prepare("SELECT workspace, verifier, nonce, next, expires_at FROM sso_states WHERE state = ?").get(state) as
      { workspace: string; verifier: string; nonce: string; next: string; expires_at: number } | undefined;
    this.db.prepare("DELETE FROM sso_states WHERE state = ?").run(state);
    return row && row.expires_at > this.now() ? { workspace: row.workspace, verifier: row.verifier, nonce: row.nonce, next: row.next } : null;
  }

  account(id: string): Account | null {
    return (this.db.prepare("SELECT id, email FROM accounts WHERE id = ?").get(id) as Account | undefined) ?? null;
  }

  /** A blocked account cannot sign in, and its sessions, workspace sign-ins and app connections stop working. */
  blocked(accountId: string): boolean {
    return Boolean(this.db.prepare("SELECT 1 FROM blocked_accounts WHERE account_id = ?").get(accountId));
  }

  setBlocked(accountId: string, blocked: boolean, actor: string): void {
    this.transaction(() => {
      if (blocked) {
        this.db.prepare("INSERT INTO blocked_accounts (account_id, at) VALUES (?, ?) ON CONFLICT DO NOTHING").run(accountId, this.now());
        this.db.prepare("DELETE FROM sessions WHERE account_id = ?").run(accountId);
      } else {
        this.db.prepare("DELETE FROM blocked_accounts WHERE account_id = ?").run(accountId);
      }
      this.audit(null, actor, blocked ? "account.block" : "account.unblock", accountId);
    });
  }

  /** A suspended workspace keeps its data, but spends no Delio credits until it is resumed. */
  suspension(slug: string): { reason: string | null; at: number } | null {
    return (this.db.prepare("SELECT reason, at FROM suspensions WHERE workspace = ?").get(slug) as { reason: string | null; at: number } | undefined) ?? null;
  }

  setSuspended(slug: string, suspended: boolean, reason: string | null, actor: string): void {
    this.transaction(() => {
      if (suspended) this.db.prepare("INSERT INTO suspensions (workspace, reason, at) VALUES (?, ?, ?) ON CONFLICT (workspace) DO UPDATE SET reason = excluded.reason").run(slug, reason, this.now());
      else this.db.prepare("DELETE FROM suspensions WHERE workspace = ?").run(slug);
      this.audit(slug, actor, suspended ? "workspace.suspend" : "workspace.resume", reason);
    });
  }

  /** Deletes a workspace and what only it uses; its orders, ledger and audit stay as the business's records. `tables`: the other per-workspace tables the portal created. */
  deleteWorkspace(slug: string, actor: string, tables: readonly string[]): void {
    this.transaction(() => {
      for (const table of ["grants", "members", "invitations", "sso", "suspensions", ...tables]) this.db.prepare(`DELETE FROM ${table} WHERE workspace = ?`).run(slug);
      this.db.prepare("DELETE FROM workspaces WHERE slug = ?").run(slug);
      this.audit(slug, actor, "workspace.delete", null);
    });
  }

  audit(workspace: string | null, actor: string | null, action: string, target: string | null): void {
    this.db.prepare("INSERT INTO audit (workspace, actor, action, target, at) VALUES (?, ?, ?, ?, ?)").run(workspace, actor, action, target, this.now());
  }

  auditLog(workspace: string, limit = 50): Array<{ actor: string | null; action: string; target: string | null; at: number }> {
    return this.db.prepare("SELECT actor, action, target, at FROM audit WHERE workspace = ? ORDER BY id DESC LIMIT ?").all(workspace, limit) as
      unknown as Array<{ actor: string | null; action: string; target: string | null; at: number }>;
  }

  private transaction(run: () => void): void {
    this.db.transaction(run);
  }
}
