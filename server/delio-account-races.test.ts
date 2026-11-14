import { describe, expect, it } from "vitest";
import type { AppConfig } from "./config.ts";
import { createDelioAccount } from "./delio-account.ts";

function fixture() {
  const config = {} as AppConfig;
  const polls: Array<(response: Response) => void> = [];
  const starts: Array<(response: Response) => void> = [];
  const account = createDelioAccount({ config: () => config, save: value => { config.delio = value; }, label: () => "fixture",
    fetchImpl: ((input: string | URL | Request) => new Promise<Response>(resolve => {
      if (String(input).endsWith("/start")) starts.push(resolve); else polls.push(resolve);
    })) as typeof fetch });
  const begin = async (code: string) => {
    const starting = account.start();
    starts.at(-1)!(Response.json({ device_code: code, user_code: code, verification_uri_complete: `https://compte.deliobot.fun/device?code=${code}` }));
    await starting;
  };
  const approve = (index: number, workspace = "me-original") => polls[index]!(Response.json({ workspace, token: `odb_device_${"a".repeat(43)}` }));
  return { account, config, starts, begin, approve };
}

describe("Delio sign-in concurrency", () => {
  it("ignores approval of an old flow while a newer flow waits", async () => {
    const f = fixture();
    await f.begin("old");
    const old = f.account.status();
    await f.begin("new");
    f.approve(0);
    expect(await old).toMatchObject({ state: "waiting", userCode: "new" });
    expect(f.config.delio).toBeUndefined();
    const latest = f.account.status();
    f.approve(1, "me-current");
    expect(await latest).toMatchObject({ state: "connected", workspace: "me-current" });
  });

  it("never signs back in when an in-flight approval arrives after sign-out", async () => {
    const f = fixture();
    await f.begin("old");
    const old = f.account.status();
    await f.account.disconnect();
    f.approve(0);
    expect(await old).toEqual({ state: "disconnected" });
    expect(f.config.delio).toBeNull();
  });

  it("does not let a late start replace a later start", async () => {
    const f = fixture();
    const old = f.account.start();
    const rejected = expect(old).rejects.toMatchObject({ status: 409 });
    await f.begin("new");
    f.starts[0]!(Response.json({ device_code: "old", user_code: "old", verification_uri_complete: "https://compte.deliobot.fun/device" }));
    await rejected;
    const current = f.account.status();
    f.approve(0, "me-current");
    expect(await current).toMatchObject({ state: "connected", workspace: "me-current" });
  });
});
