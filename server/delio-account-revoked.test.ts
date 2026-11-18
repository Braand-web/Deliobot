import { describe, expect, it } from "vitest";
import type { AppConfig } from "./config.ts";
import { createDelioAccount } from "./delio-account.ts";

describe("a Delio connection the portal no longer accepts", () => {
  it("signs the app out and says the connection expired, instead of checking forever", async () => {
    const config = { delio: { portal: "https://compte.deliobot.fun", workspace: "me-abcdefgh", token: `odb_device_${"a".repeat(43)}` } } as AppConfig;
    const account = createDelioAccount({ config: () => config, save: (value) => { config.delio = value ?? undefined; }, label: () => "fixture",
      fetchImpl: (async () => new Response("{}", { status: 401 })) as typeof fetch });
    expect(await account.balance({ fresh: true })).toBeNull();
    expect(config.delio).toBeUndefined();
    expect(await account.status()).toEqual({ state: "disconnected", reason: "expired" });
  });
});
