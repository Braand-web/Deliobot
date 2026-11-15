// Connected apps for Deliobot accounts only: an installation is linked to the Deliobot account it runs for, confirmed with
// the account's own portal, and installations without a recent confirmation cannot connect or use apps.
import { z } from "zod";

import { json, type InstallationRow } from "./common";

/** How long one confirmation lasts; the app confirms every few hours while it runs. */
export const DELIO_LINK_TTL_MS = 8 * 24 * 60 * 60_000;
const WORKSPACE = /^[a-z][a-z0-9-]{1,30}$/;
const ACCOUNT_TOKEN = /^odb_(?:device|workspace)_[A-Za-z0-9_-]{43}$/;
const linkSchema = z.object({ workspace: z.string().regex(WORKSPACE), token: z.string().regex(ACCOUNT_TOKEN) }).strict();

export const DELIO_ACCOUNT_REQUIRED = "Connected apps need a Deliobot account. Connect yours in Deliobot (Plans and credits), then try again.";

export function delioRequired(env: Env): boolean {
  return env.REQUIRE_DELIO === "1";
}

/** True when this installation may use connected apps: no Deliobot account is required, or one was confirmed recently. */
export function delioLinked(installation: InstallationRow, env: Env, now = Date.now()): boolean {
  if (!delioRequired(env)) return true;
  const at = installation.delio_verified_at ?? 0;
  return Boolean(installation.delio_workspace) && now - at < DELIO_LINK_TTL_MS;
}

/** POST /v1/installation/delio: confirms the app's Deliobot account with the portal and records it on the installation.
 *  Security: the device token is only forwarded to the configured portal and never stored here. */
export async function linkDelioAccount(request: Request, installation: InstallationRow, env: Env, fetchImpl: typeof fetch = fetch): Promise<Response> {
  const portal = env.DELIO_PORTAL_URL?.trim().replace(/\/+$/, "");
  if (!portal || !/^https:\/\/[^/]+$/.test(portal)) return json({ error: "Deliobot accounts are not set up on this service." }, 503);
  const parsed = linkSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return json({ error: "invalid Deliobot account" }, 400);
  const { workspace, token } = parsed.data;
  let status = 0;
  try {
    const answer = await fetchImpl(`${portal}/api/workspace/${workspace}/account`, {
      headers: { authorization: `Bearer ${token}`, accept: "application/json" }, redirect: "error", signal: AbortSignal.timeout(10_000),
    });
    status = answer.status;
    await answer.body?.cancel();
  } catch {
    return json({ error: "Deliobot could not be reached. Try again in a moment." }, 503);
  }
  if (status !== 200) return json({ error: DELIO_ACCOUNT_REQUIRED }, 403);
  const now = Date.now();
  await env.DB.prepare("UPDATE installations SET delio_workspace = ?, delio_verified_at = ? WHERE id = ?").bind(workspace, now, installation.id).run();
  installation.delio_workspace = workspace;
  installation.delio_verified_at = now;
  return json({ linked: true });
}
