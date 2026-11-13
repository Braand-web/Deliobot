// Self-serve workspaces get their own server from the fleet agent once their first plan is paid, are suspended when the
// plan has ended past its grace, and resumed when it is paid again. Nothing here deletes a workspace or its data.
import type { SqlDatabase } from "./sql.ts";

import type { fleetRequest } from "../../../server/fleet-client.ts";
import type { Mailer } from "./mail.ts";
import { PLANS, type Billing } from "./plans.ts";
import type { AdminStore } from "./store.ts";
import type { Wallet } from "./wallet.ts";

export type HostingState = "waiting" | "creating" | "ready" | "failed" | "suspended";
export interface HostingRow { workspace: string; state: HostingState; attempts: number; error: string | null; nextTryAt: number; delio: boolean }

/** The fleet agent's create, suspend and resume, as the portal uses them. */
export interface Fleet {
  create(input: { slug: string; admins: string[]; portalUrl: string; delioToken?: string; delioModels?: string[] }): Promise<void>;
  suspend(slug: string): Promise<void>;
  resume(slug: string): Promise<void>;
}

/** The fleet agent on its Unix socket; the client loads only when a call is made, so a Worker never needs node:http. */
export function socketFleet(socketPath: string, request?: typeof fleetRequest): Fleet {
  const call = async (method: string, path: string, body?: unknown) => {
    const send = request ?? (await import("../../../server/fleet-client.ts")).fleetRequest;
    const reply = await send(socketPath, method, path, body);
    if (reply.status !== 200) {
      const error = (reply.body as { error?: unknown } | null)?.error;
      throw new Error(typeof error === "string" ? error.slice(0, 300) : `the fleet agent answered ${reply.status}`);
    }
  };
  return {
    create: (input) => call("POST", "/workspaces", { slug: input.slug, admins: input.admins, portalUrl: input.portalUrl,
      ...(input.delioToken ? { delioToken: input.delioToken, delioModels: input.delioModels } : {}) }),
    suspend: (slug) => call("POST", `/workspaces/${slug}/suspend`),
    resume: (slug) => call("POST", `/workspaces/${slug}/resume`),
  };
}

/** Slugs a customer may not take: the portal's own host names and words people would trust. */
export const RESERVED_SLUGS = new Set(["admin", "www", "api", "app", "mail", "smtp", "imap", "pop", "ns1", "ns2", "help", "support", "status", "docs", "blog",
  "cdn", "static", "assets", "dev", "staging", "test", "portal", "billing", "login", "signup", "account", "accounts", "compte", "console", "delio", "deliobot", "root", "security"]);

const MAX_ATTEMPTS = 4;
const RETRY_MS = 5 * 60_000;

export class Hosting {
  private readonly db: SqlDatabase;
  private readonly now: () => number;

  constructor(db: SqlDatabase, now: () => number = Date.now) {
    this.db = db;
    this.now = now;
    db.exec(`CREATE TABLE IF NOT EXISTS hosting (workspace TEXT PRIMARY KEY REFERENCES workspaces(slug) ON DELETE CASCADE, state TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0, error TEXT, next_try_at INTEGER NOT NULL DEFAULT 0, delio INTEGER NOT NULL DEFAULT 0, updated_at INTEGER NOT NULL);`);
  }

  /** Marks a workspace as hosted by this portal; it is created once its plan is paid. */
  request(workspace: string): void {
    this.db.prepare("INSERT INTO hosting (workspace, state, updated_at) VALUES (?, 'waiting', ?) ON CONFLICT DO NOTHING").run(workspace, this.now());
  }

  get(workspace: string): HostingRow | null {
    const row = this.db.prepare("SELECT workspace, state, attempts, error, next_try_at AS nextTryAt, delio FROM hosting WHERE workspace = ?").get(workspace) as
      (Omit<HostingRow, "delio"> & { delio: number }) | undefined;
    return row ? { ...row, delio: row.delio === 1 } : null;
  }

  all(): HostingRow[] {
    return (this.db.prepare("SELECT workspace, state, attempts, error, next_try_at AS nextTryAt, delio FROM hosting").all() as Array<Omit<HostingRow, "delio"> & { delio: number }>)
      .map((row) => ({ ...row, delio: row.delio === 1 }));
  }

  set(workspace: string, change: Partial<Omit<HostingRow, "workspace">>): void {
    const current = this.get(workspace);
    if (!current) return;
    const next = { ...current, ...change };
    this.db.prepare("UPDATE hosting SET state = ?, attempts = ?, error = ?, next_try_at = ?, delio = ?, updated_at = ? WHERE workspace = ?")
      .run(next.state, next.attempts, next.error, next.nextTryAt, next.delio ? 1 : 0, this.now(), workspace);
  }
}

export interface HostingDeps {
  hosting: Hosting;
  fleet: Fleet;
  billing: Billing;
  wallet: Wallet;
  store: AdminStore;
  mailer: Mailer;
  portalUrl: string;
  models: string[];
  operators: ReadonlySet<string>;
  now: () => number;
}

const running = (status: string) => status === "active" || status === "trialing" || status === "grace";

/** One pass: create paid workspaces, suspend ended ones, resume renewed ones. Passes never overlap. */
export function hostingRunner(deps: HostingDeps): () => Promise<void> {
  let busy: Promise<void> | null = null;
  const pass = async () => {
    for (const row of deps.hosting.all()) {
      const workspace = deps.store.workspace(row.workspace);
      if (!workspace) continue;
      const subscription = deps.billing.subscription(row.workspace);
      const admins = deps.store.members(row.workspace).filter((member) => member.role === "admin").map((member) => member.email);
      if ((row.state === "waiting" || row.state === "failed") && running(subscription.status) && row.attempts < MAX_ATTEMPTS && row.nextTryAt <= deps.now()) {
        const delio = PLANS[subscription.plan].gateway;
        deps.hosting.set(row.workspace, { state: "creating", error: null });
        try {
          const token = delio ? deps.wallet.issueToken(row.workspace) : undefined;
          await deps.fleet.create({ slug: row.workspace, admins, portalUrl: deps.portalUrl, ...(token ? { delioToken: token, delioModels: deps.models } : {}) });
          deps.hosting.set(row.workspace, { state: "ready", attempts: 0, error: null, delio });
          deps.store.audit(row.workspace, null, "hosting.ready", workspace.tenantUrl);
          for (const email of admins) {
            await deps.mailer.send({ to: email, subject: `Votre espace Delio ${workspace.name} est prêt`,
              text: `${workspace.name} est prêt à l'adresse ${workspace.tenantUrl}\n\nConnectez-vous-y avec cette adresse e-mail : un code vous est envoyé à chaque fois.` })
              .catch(() => console.error("delio-admin: a workspace-ready email could not be sent"));
          }
        } catch (error) {
          const attempts = row.attempts + 1;
          const message = error instanceof Error ? error.message : String(error);
          deps.hosting.set(row.workspace, { state: "failed", attempts, error: message.slice(0, 300), nextTryAt: deps.now() + RETRY_MS * 2 ** (attempts - 1) });
          deps.store.audit(row.workspace, null, "hosting.failed", message.slice(0, 200));
          if (attempts === MAX_ATTEMPTS) {
            for (const email of deps.operators) {
              await deps.mailer.send({ to: email, subject: `Delio could not create the workspace ${row.workspace}`,
                text: `After ${attempts} attempts the fleet agent still refuses ${row.workspace} (${workspace.tenantUrl}):\n\n${message}\n\nIts plan is paid. Fix the server, then retry it from the workspace's Billing page.` })
                .catch(() => console.error("delio-admin: an operator alert could not be sent"));
            }
          }
        }
      } else if (row.state === "ready" && subscription.status === "expired") {
        try {
          await deps.fleet.suspend(row.workspace);
          deps.hosting.set(row.workspace, { state: "suspended" });
          deps.store.audit(row.workspace, null, "hosting.suspended", null);
        } catch (error) {
          console.error(`delio-admin: ${row.workspace} could not be suspended (${error instanceof Error ? error.message : "error"})`);
        }
      } else if (row.state === "suspended" && running(subscription.status)) {
        try {
          await deps.fleet.resume(row.workspace);
          deps.hosting.set(row.workspace, { state: "ready" });
          deps.store.audit(row.workspace, null, "hosting.resumed", null);
        } catch (error) {
          console.error(`delio-admin: ${row.workspace} could not be resumed (${error instanceof Error ? error.message : "error"})`);
        }
      }
    }
  };
  return () => {
    busy ??= pass().finally(() => { busy = null; });
    return busy;
  };
}

/** What a new Delio workspace may use through the gateway, cheapest first; Auto picks among them per message. */
export const DEFAULT_WORKSPACE_MODELS = ["google/gemini-2.5-flash", "openai/gpt-5-mini", "anthropic/claude-sonnet-4.5", "openai/gpt-5", "google/gemini-2.5-pro", "anthropic/claude-opus-4.1"];
