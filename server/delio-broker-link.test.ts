import { describe, expect, it } from "vitest";

import { startDelioBrokerLink } from "./delio-broker-link.ts";

describe("linking connected apps to the Deliobot account", () => {
  it("links every installation once, again after six hours, and never without an account", async () => {
    const calls: Array<{ url: string; auth: string | null; body: unknown }> = [];
    const fetchImpl = (async (url: string, init?: RequestInit) => {
      calls.push({ url, auth: new Headers(init?.headers).get("authorization"), body: JSON.parse(String(init?.body)) });
      return new Response("{}", { status: 200 });
    }) as typeof fetch;
    let clock = 0, account: { workspace: string; token: string } | null = null;
    const link = startDelioBrokerLink({
      account: () => account, fetchImpl, now: () => clock,
      installations: () => [{ url: "https://apps.example.test", token: "a".repeat(64) }, { url: "https://apps.example.test", token: "b".repeat(64) }],
    });
    link.stop();
    await link.tick();
    expect(calls).toEqual([]);
    const connection = { portal: "https://compte.example.test", workspace: "acme", token: `odb_device_${"x".repeat(43)}`, gateway: "https://compte.example.test/api/gateway/acme" };
    account = connection;
    await link.tick();
    await link.tick();
    expect(calls.map((call) => call.auth)).toEqual([`Bearer ${"a".repeat(64)}`, `Bearer ${"b".repeat(64)}`]);
    expect(calls[0]).toEqual({ url: "https://apps.example.test/v1/installation/delio", auth: `Bearer ${"a".repeat(64)}`, body: { workspace: "acme", token: connection.token } });
    clock += 6 * 60 * 60_000 + 1;
    await link.tick();
    expect(calls).toHaveLength(4);
  });
});
