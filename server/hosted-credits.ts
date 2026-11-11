// A hosted workspace's Delio credits, read from its portal with the workspace token so admins see what is left here.
import { hostedWorkspaceConfiguration } from "./enterprise.ts";
import { PASS, type RouteHandler } from "./routes/table.ts";

export interface CreditsView { credits: number; usedThisMonth: number }

const TTL_MS = 60_000;

export function createHostedCredits(options: { env?: NodeJS.ProcessEnv; fetchImpl?: typeof fetch; now?: () => number } = {}) {
  const env = options.env ?? process.env;
  const hosted = hostedWorkspaceConfiguration(env);
  const token = env.ODB_HOSTED_MODEL_TOKEN ?? "";
  const now = options.now ?? Date.now;
  let cached: { at: number; view: CreditsView | null } | null = null;
  const available = Boolean(hosted?.portalMembership && /^odb_workspace_[A-Za-z0-9_-]{43}$/.test(token));

  async function load(): Promise<CreditsView | null> {
    if (!available) return null;
    if (cached && now() - cached.at < TTL_MS) return cached.view;
    let view: CreditsView | null = null;
    try {
      const response = await (options.fetchImpl ?? fetch)(new URL(`/api/workspace/${hosted!.workspace}/account`, hosted!.admin).href, {
        headers: { authorization: `Bearer ${token}`, accept: "application/json" }, redirect: "error", signal: AbortSignal.timeout(5_000),
      });
      if (response.ok) {
        const body = await response.json() as { credits?: unknown; usedThisMonth?: unknown };
        if (typeof body.credits === "number" && typeof body.usedThisMonth === "number") view = { credits: body.credits, usedThisMonth: body.usedThisMonth };
      } else {
        await response.body?.cancel().catch(() => undefined);
      }
    } catch {
      view = null;
    }
    cached = { at: now(), view };
    return view;
  }

  const routes: RouteHandler = async ({ res, path, method, json }) => {
    if (path !== "/api/credits" || method !== "GET") return PASS;
    res.setHeader("cache-control", "no-store");
    if (!available) return json(res, 404, { error: "This workspace has no Delio credits." });
    const view = await load();
    return view ? json(res, 200, view) : json(res, 503, { error: "Delio Admin did not answer. Try again in a moment." });
  };
  return { available, load, routes };
}
