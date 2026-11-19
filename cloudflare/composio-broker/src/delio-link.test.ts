import { describe, expect, it } from "vitest";

import { DELIO_LINK_TTL_MS, delioLinked, linkDelioAccount } from "./delio-link";

const TOKEN = `odb_device_${"a".repeat(43)}`;
const installation = () => ({ id: "inst-1", composio_user_id: "odb_x", session_id: null, disabled_at: null } as Parameters<typeof delioLinked>[0]);

function env(portal = "https://compte.example.test") {
  const runs: unknown[][] = [];
  return {
    runs,
    env: {
      REQUIRE_DELIO: "1", DELIO_PORTAL_URL: portal,
      DB: { prepare: () => ({ bind: (...values: unknown[]) => ({ run: async () => { runs.push(values); return { meta: { changes: 1 } }; } }) }) },
    } as unknown as Env,
  };
}

const link = (body: unknown) => new Request("https://broker.test/v1/installation/delio", { method: "POST", body: JSON.stringify(body) });

describe("connected apps for Deliobot accounts", () => {
  it("links an installation once the portal confirms the account, sending the token only there", async () => {
    const { env: e, runs } = env();
    const calls: Array<{ url: string; auth: string | null }> = [];
    const fetchImpl = (async (url: string, init?: RequestInit) => { calls.push({ url, auth: new Headers(init?.headers).get("authorization") }); return new Response("{}", { status: 200 }); }) as typeof fetch;
    const row = installation();
    const answer = await linkDelioAccount(link({ workspace: "acme", token: TOKEN }), row, e, fetchImpl);
    expect(answer.status).toBe(200);
    expect(calls).toEqual([{ url: "https://compte.example.test/api/workspace/acme/account", auth: `Bearer ${TOKEN}` }]);
    expect(runs[0]?.slice(0, 1)).toEqual(["acme"]);
    expect(delioLinked(row, e)).toBe(true);
  });

  it("links the account as older apps send it, with the portal and gateway addresses alongside", async () => {
    const { env: e } = env();
    const fetchImpl = (async () => new Response("{}", { status: 200 })) as unknown as typeof fetch;
    const body = { portal: "https://compte.example.test", workspace: "acme", token: TOKEN, gateway: "https://compte.example.test/api/gateway/acme" };
    expect((await linkDelioAccount(link(body), installation(), e, fetchImpl)).status).toBe(200);
  });

  it("refuses an account the portal does not confirm, and a malformed one without asking", async () => {
    const { env: e, runs } = env();
    let asked = 0;
    const fetchImpl = (async () => { asked += 1; return new Response("{}", { status: 401 }); }) as unknown as typeof fetch;
    expect((await linkDelioAccount(link({ workspace: "acme", token: TOKEN }), installation(), e, fetchImpl)).status).toBe(403);
    expect((await linkDelioAccount(link({ workspace: "../x", token: "nope" }), installation(), e, fetchImpl)).status).toBe(400);
    expect(asked).toBe(1);
    expect(runs).toEqual([]);
  });

  it("needs a recent confirmation only when Deliobot accounts are required", () => {
    const { env: e } = env();
    const now = 10 * DELIO_LINK_TTL_MS;
    expect(delioLinked(installation(), e, now)).toBe(false);
    expect(delioLinked({ ...installation(), delio_workspace: "acme", delio_verified_at: now - 1000 }, e, now)).toBe(true);
    expect(delioLinked({ ...installation(), delio_workspace: "acme", delio_verified_at: now - DELIO_LINK_TTL_MS - 1 }, e, now)).toBe(false);
    expect(delioLinked(installation(), { ...e, REQUIRE_DELIO: undefined } as Env, now)).toBe(true);
  });
});
