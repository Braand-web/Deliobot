import { describe, expect, it } from "vitest";

import { handleSetup, SETUP_LINK_TTL_MS } from "./setup.ts";

const TOKEN = "t".repeat(40);
const base = { DELIO_ADMIN_URL: "http://localhost:8790", DELIO_ADMIN_SECRET: "s".repeat(40) };

function setup(options: { stored?: Record<string, string>; openedAt?: number; now?: number } = {}) {
  const saved: Array<Record<string, string>> = [];
  const deps = {
    setupToken: TOKEN, done: false, stored: options.stored ?? {}, baseEnv: base,
    openedAt: async () => options.openedAt ?? 0, now: () => options.now ?? 0,
    save: async (settings: Record<string, string>) => { saved.push(settings); },
  };
  const get = () => handleSetup(new Request(`https://compte.example.test/setup?token=${TOKEN}`), deps);
  const post = (fields: Record<string, string>) => handleSetup(new Request("https://compte.example.test/setup", {
    method: "POST", body: new URLSearchParams({ token: TOKEN, ...fields }),
  }), deps);
  return { saved, get, post };
}

describe("the portal setup page", () => {
  it("opens with its token and saves the keys typed into it", async () => {
    const { saved, get, post } = setup();
    expect((await get())?.status).toBe(200);
    expect((await post({ DELIO_ADMIN_FAL_KEY: "fal-key" }))?.status).toBe(200);
    expect(saved[0]).toMatchObject({ DELIO_ADMIN_FAL_KEY: "fal-key" });
  });

  it("closes an hour after its link was first opened", async () => {
    const { saved, get, post } = setup({ openedAt: 0, now: SETUP_LINK_TTL_MS + 1 });
    expect((await get())?.status).toBe(404);
    expect((await post({ DELIO_ADMIN_FAL_KEY: "fal-key" }))?.status).toBe(404);
    expect(saved).toEqual([]);
  });

  it("never changes who runs the console once an operator is set", async () => {
    const { saved, get, post } = setup({ stored: { DELIO_ADMIN_OPERATORS: "owner@example.test" } });
    expect(await (await get())!.text()).not.toContain('name="DELIO_ADMIN_OPERATORS"');
    await post({ DELIO_ADMIN_OPERATORS: "attacker@example.test", DELIO_ADMIN_FAL_KEY: "fal-key" });
    expect(saved[0]).toMatchObject({ DELIO_ADMIN_OPERATORS: "owner@example.test", DELIO_ADMIN_FAL_KEY: "fal-key" });
  });
});
