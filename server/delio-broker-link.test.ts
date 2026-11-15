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
    account = { workspace: "acme", token: `odb_device_${"x".repeat(43)}` };
    await link.tick();
    await link.tick();
    expect(calls.map((call) => call.auth)).toEqual([`Bearer ${"a".repeat(64)}`, `Bearer ${"b".repeat(64)}`]);
    expect(calls[0]).toMatchObject({ url: "https://apps.example.test/v1/installation/delio", body: account });
    clock += 6 * 60 * 60_000 + 1;
    await link.tick();
    expect(calls).toHaveLength(4);
  });
});
