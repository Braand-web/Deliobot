import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";

import { createAdminApp } from "./app.ts";
import { serveFetch } from "./fetch-adapter.ts";
import type { MailMessage } from "./mail.ts";
import { MICRO, Wallet } from "./wallet.ts";
import { nodeDatabase } from "./sql-node.ts";
import { AdminStore } from "./store.ts";

const ORIGIN = "https://compte.deliobot.test";

function portal() {
  const store = new AdminStore({ db: nodeDatabase(":memory:"), secret: randomBytes(32) });
  const mail: MailMessage[] = [];
  const upstream = (async (input: string | URL | Request) => {
    const url = new URL(String(input));
    if (url.pathname === "/api/v1/chat/completions") {
      const events = [{ choices: [{ delta: { content: "Bon" } }] }, { choices: [{ delta: { content: "jour" } }] }, { choices: [], usage: { cost: 0.01 } }]
        .map((event) => `data: ${JSON.stringify(event)}\n\n`).join("") + "data: [DONE]\n\n";
      return new Response(events, { headers: { "content-type": "text/event-stream" } });
    }
    return new Response("{}", { status: 404 });
  }) as typeof fetch;
  const app = createAdminApp({ store, publicUrl: new URL(ORIGIN), operators: new Set(), mailer: { send: async (message) => void mail.push(message) },
    fetchImpl: upstream, gateway: { openrouterKey: "sk-or", openrouterUrl: "https://openrouter.test/api/v1" }, signup: { downloadUrl: "https://deliobot.test/#telecharger" } });
  const send = (path: string, init: RequestInit = {}) => serveFetch(app, new Request(new URL(path, ORIGIN), init), "203.0.113.7");
  return { store, mail, send };
}

describe("the portal behind a Fetch API Request", () => {
  it("answers JSON, signs in with a code and a cookie, signs up for the app, and streams an AI answer", async () => {
    const target = portal();
    const plans = await target.send("/api/public/plans");
    expect(plans.status).toBe(200);
    expect(plans.headers.get("access-control-allow-origin")).toBe("*");
    expect(((await plans.json()) as { plans: unknown[] }).plans.length).toBeGreaterThan(3);

    const form = (fields: Record<string, string>, cookie = "") => ({ method: "POST", body: new URLSearchParams(fields).toString(), redirect: "manual" as const,
      headers: { origin: ORIGIN, "content-type": "application/x-www-form-urlencoded", ...(cookie ? { cookie } : {}) } });
    expect((await target.send("/login", form({ email: "founder@acme.test", next: "/signup" }))).status).toBe(200);
    const code = /code is (\d{4}) (\d{4})/.exec(target.mail.at(-1)!.text)!;
    const verified = await target.send("/login/verify", form({ email: "founder@acme.test", code: code[1]! + code[2]!, next: "/signup" }));
    expect(verified.status).toBe(303);
    const cookie = verified.headers.get("set-cookie")!.split(";")[0]!;
    expect(cookie).toMatch(/^__Host-delio-admin=/);

    const signup = await target.send("/signup", form({ name: "Acme", slug: "acme", plan: "pro", cycle: "month" }, cookie));
    expect(signup.headers.get("location")).toBe("/billing?workspace=acme&plan=pro&cycle=month");
    expect(target.store.workspace("acme")?.tenantUrl, "an app account leads to the download, not to a hosted workspace").toBe("https://deliobot.test/#telecharger");
    const billing = await target.send("/billing?workspace=acme&plan=pro&cycle=month", { headers: { cookie } });
    expect(await billing.text()).toContain("Billing · Acme");

    const wallet = new Wallet(target.store.db);
    wallet.credit("acme", 100 * MICRO, "grant", null);
    const token = wallet.issueToken("acme");
    const chat = await target.send("/api/gateway/acme/openrouter/v1/chat/completions", { method: "POST", body: JSON.stringify({ model: "openai/gpt-5-mini", stream: true, messages: [] }),
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" } });
    expect(chat.status).toBe(200);
    expect(chat.headers.get("content-type")).toContain("text/event-stream");
    expect(await chat.text()).toContain('"content":"jour"');
    expect(wallet.balance("acme") / MICRO, "charged at the real cost: 0.01 USD is 5 credits").toBeCloseTo(95, 5);
  });
});
