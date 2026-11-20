import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";

import { createAdminApp } from "./app.ts";
import { serveFetch } from "./fetch-adapter.ts";
import type { MailMessage } from "./mail.ts";
import { nodeDatabase } from "./sql-node.ts";
import { AdminStore } from "./store.ts";

const ORIGIN = "https://compte.deliobot.test";

function portal(options: { console?: boolean; signup?: boolean } = {}) {
  const store = new AdminStore({ db: nodeDatabase(":memory:"), secret: randomBytes(32) });
  const mail: MailMessage[] = [];
  const app = createAdminApp({ store, publicUrl: new URL(ORIGIN), operators: new Set(["ops@deliobot.test"]), mailer: { send: async (message) => void mail.push(message) },
    ...(options.signup === false ? {} : { signup: { downloadUrl: "https://deliobot.test/#telecharger" } }), ...(options.console ? { console: true } : {}) });
  const send = (path: string, init: RequestInit = {}) => serveFetch(app, new Request(new URL(path, ORIGIN), init), "203.0.113.7");
  const form = (fields: Record<string, string>, cookie = "") => ({ method: "POST", body: new URLSearchParams(fields).toString(), redirect: "manual" as const,
    headers: { origin: ORIGIN, "content-type": "application/x-www-form-urlencoded", "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)", ...(cookie ? { cookie } : {}) } });
  const signIn = async (email: string, next = "") => {
    expect((await send("/login", form({ email, next }))).status).toBe(200);
    const code = /Deliobot est (\d{4}) (\d{4})/.exec(mail.at(-1)!.text)!;
    return await send("/login/verify", form({ email, code: code[1]! + code[2]!, next }));
  };
  return { store, send, form, signIn };
}

const sessionOf = (response: Response) => response.headers.getSetCookie().find((cookie) => cookie.startsWith("__Host-delio-admin="))!.split(";")[0]!;
const hintOf = (response: Response) => response.headers.getSetCookie().find((cookie) => cookie.startsWith("delio-known="));

describe("signing in from the public site", () => {
  it("sends a new account to the download, with a welcome, and marks the browser as known", async () => {
    const target = portal();
    const verified = await target.signIn("new@acme.test");
    expect(verified.status).toBe(303);
    expect(verified.headers.get("location")).toBe("https://deliobot.test/?bienvenue=1#telecharger");
    expect(hintOf(verified)).toBe("delio-known=1; Domain=deliobot.test; Path=/; Max-Age=31536000; SameSite=Lax; Secure");
  });

  it("opens the desktop app for an existing account, with the download as a way out", async () => {
    const target = portal();
    await target.signIn("client@acme.test");
    const again = await target.signIn("client@acme.test");
    expect(again.headers.get("location")).toBe("/ouvrir");
    expect(hintOf(again)).toBeDefined();
    const page = await target.send("/ouvrir", { headers: { cookie: sessionOf(again), "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" } });
    expect(page.status).toBe(200);
    const body = await page.text();
    expect(body).toContain("Ouverture de Deliobot");
    expect(body).toContain('href="opendeliobot://cloud"');
    expect(body).toContain("location.href=\"opendeliobot://cloud\"");
    expect(body).toContain("Deliobot-Setup.exe");
    expect(body).toContain("Gérer mon compte");

    const visit = await target.send("/login", { headers: { cookie: sessionOf(again) }, redirect: "manual" });
    expect(visit.headers.get("location"), "a signed-in visitor who clicks Se connecter goes to the app too").toBe("/ouvrir");
  });

  it("keeps every flow that asked for a page of its own", async () => {
    const target = portal();
    const paying = await target.signIn("buyer@acme.test", "/pay?plan=pro&cycle=month");
    expect(paying.headers.get("location")).toBe("/pay?plan=pro&cycle=month");
    const signingUp = await target.signIn("founder@acme.test", "/signup");
    expect(signingUp.headers.get("location")).toBe("/signup");
  });

  it("titles the form for someone creating an account", async () => {
    const target = portal();
    const body = await (await target.send("/login?intent=signup")).text();
    expect(body).toContain("Créer votre compte");
    expect(body).toContain("Créer mon compte");
    expect(await (await target.send("/login")).text()).toContain("Connexion ou inscription");
  });

  it("changes nothing on the operator console or without the desktop-app sign-up", async () => {
    const operatorPortal = portal({ console: true });
    const operator = await operatorPortal.signIn("ops@deliobot.test");
    expect(operator.headers.get("location")).toBe("/");
    expect(hintOf(operator)).toBeUndefined();

    const hosted = portal({ signup: false });
    const member = await hosted.signIn("member@acme.test");
    expect(member.headers.get("location")).toBe("/");
    expect(hintOf(member)).toBeUndefined();
  });
});
