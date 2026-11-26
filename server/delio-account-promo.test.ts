import { describe, expect, it } from "vitest";
import type { AppConfig } from "./config.ts";
import { createDelioAccount } from "./delio-account.ts";

const TOKEN = `odb_device_${"a".repeat(43)}`;

function fixture(answer: (body: unknown) => Response) {
  const config = { delio: { portal: "https://compte.deliobot.fun", workspace: "me-abcdefgh", token: TOKEN } } as AppConfig;
  const calls: Array<{ url: string; method: string; auth: string | null; body: unknown }> = [];
  let plan: string | null = null;
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ url, method: init?.method ?? "GET", auth: new Headers(init?.headers).get("authorization"), body });
    if (url.endsWith("/promo")) {
      const response = answer(body);
      if (response.ok) plan = "pro";
      return response;
    }
    return Response.json({ credits: plan ? 2000 : 0, usedThisMonth: 0, plan, ownAi: false });
  }) as typeof fetch;
  const account = createDelioAccount({ config: () => config, save: (value) => { config.delio = value ?? undefined; }, label: () => "fixture", fetchImpl });
  return { account, calls, config };
}

describe("a promo code typed in the app", () => {
  it("sends it with the app's token and shows the plan it started", async () => {
    const { account, calls } = fixture(() => Response.json({ ok: true, plan: "pro", message: "Forfait Pro activé jusqu'au 26 décembre 2026, avec 2 000 crédits." }));
    expect(await account.redeemPromo("  delio-7kq4-m2xp ")).toEqual({ status: 200, ok: true, message: "Forfait Pro activé jusqu'au 26 décembre 2026, avec 2 000 crédits." });
    expect(calls[0]).toEqual({ url: "https://compte.deliobot.fun/api/workspace/me-abcdefgh/promo", method: "POST", auth: `Bearer ${TOKEN}`, body: { code: "delio-7kq4-m2xp" } });
    expect(await account.balance()).toMatchObject({ plan: "pro", credits: 2000 });
  });

  it("passes the portal's refusal on and keeps the connection", async () => {
    const { account, config } = fixture(() => Response.json({ error: { message: "Ce code a déjà été utilisé le nombre de fois prévu.", code: "promo_refused" } }, { status: 400 }));
    expect(await account.redeemPromo("DELIO-AAAA-BBBB")).toEqual({ status: 400, ok: false, message: "Ce code a déjà été utilisé le nombre de fois prévu." });
    expect(config.delio?.token).toBe(TOKEN);
  });

  it("says when the app is not connected", async () => {
    const { account, config, calls } = fixture(() => Response.json({}));
    config.delio = undefined;
    expect(await account.redeemPromo("DELIO-AAAA-BBBB")).toMatchObject({ status: 409, ok: false });
    expect(calls).toHaveLength(0);
  });
});
