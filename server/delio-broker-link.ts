// Connected apps run through the managed service only for Deliobot accounts: this links the service's installation to
// the account this app is connected to (a desktop's Deliobot sign-in, or a hosted workspace's own token), again every
// few hours, so the service can confirm it with the portal.
import { brokerAccess } from "./composio-broker-access.ts";
import { hostedWorkspaceConfiguration } from "./enterprise.ts";

export interface DelioBrokerAccount { workspace: string; token: string }

const CHECK_MS = 60_000;
const REFRESH_MS = 6 * 60 * 60_000;
const RETRY_MS = 5 * 60_000;

/** The hosted workspace's own account, for a server the portal runs; null anywhere else. */
export function hostedDelioAccount(env: NodeJS.ProcessEnv = process.env): DelioBrokerAccount | null {
  const hosted = hostedWorkspaceConfiguration(env);
  const token = env.ODB_HOSTED_MODEL_TOKEN ?? "";
  return hosted?.portalMembership && /^odb_workspace_[A-Za-z0-9_-]{43}$/.test(token) ? { workspace: hosted.workspace, token } : null;
}

export function startDelioBrokerLink(options: {
  account: () => DelioBrokerAccount | null;
  /** Every installation to link: this app's own, and on a team each member's own. */
  installations?: () => Array<{ url: string; token: string }>;
  fetchImpl?: typeof fetch;
  now?: () => number;
  log?: (line: string) => void;
}) {
  const installations = options.installations ?? (() => { try { const own = brokerAccess(); return own ? [own] : []; } catch { return []; } });
  const fetchImpl = options.fetchImpl ?? fetch;
  const now = options.now ?? Date.now;
  const linked = new Map<string, number>();
  const failed = new Map<string, number>();
  let running = false;

  async function link(broker: { url: string; token: string }, account: DelioBrokerAccount, force: boolean): Promise<void> {
    const key = `${broker.url}\n${broker.token}\n${account.workspace}\n${account.token}`;
    if (!force && now() - (linked.get(key) ?? -Infinity) < REFRESH_MS || now() - (failed.get(key) ?? -Infinity) < RETRY_MS) return;
    try {
      const response = await fetchImpl(`${broker.url}/v1/installation/delio`, {
        method: "POST", redirect: "error", signal: AbortSignal.timeout(15_000),
        headers: { authorization: `Bearer ${broker.token}`, "content-type": "application/json" },
        body: JSON.stringify(account),
      });
      await response.body?.cancel().catch(() => undefined);
      if (response.ok) { linked.set(key, now()); failed.delete(key); return; }
      failed.set(key, now());
      options.log?.(`connected apps: the Deliobot account was not confirmed (HTTP ${response.status})`);
    } catch {
      failed.set(key, now());
    }
  }

  async function tick(force = false): Promise<void> {
    if (running) return;
    const account = options.account();
    if (!account) return;
    running = true;
    try {
      for (const broker of installations()) await link(broker, account, force);
    } finally {
      running = false;
    }
  }

  const timer = setInterval(() => void tick(), CHECK_MS);
  timer.unref?.();
  void tick();
  return { tick, stop: () => clearInterval(timer) };
}
