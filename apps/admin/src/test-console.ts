import { createServer } from "node:http";
import type { AddressInfo } from "node:net";

import { createAdminApp, type AdminAppOptions } from "./app.ts";
import type { MailMessage } from "./mail.ts";

/** Tests only: the operators' console on its own server over the same store, already signed in as an operator. */
export async function operatorConsole(options: Omit<AdminAppOptions, "publicUrl" | "console">, mail: MailMessage[], email = "ops@delio.test") {
  const server = createServer();
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  server.on("request", createAdminApp({ ...options, publicUrl: new URL(origin), console: true }));
  let cookie = "";
  const post = async (path: string, form: Record<string, string>) => {
    const response = await fetch(new URL(path, origin), { method: "POST", redirect: "manual", body: new URLSearchParams(form).toString(),
      headers: { origin, "content-type": "application/x-www-form-urlencoded", ...(cookie ? { cookie } : {}) } });
    const set = response.headers.getSetCookie()[0];
    if (set) cookie = set.split(";")[0]!;
    return response;
  };
  const get = (path: string) => fetch(new URL(path, origin), { redirect: "manual", headers: cookie ? { cookie } : {} });
  await post("/login", { email, next: "/" });
  const code = /code is (\d{4}) (\d{4})/.exec(mail.at(-1)!.text)!;
  await post("/login/verify", { email, code: code[1]! + code[2]!, next: "/" });
  return { origin, post, get, close: () => new Promise<void>((done) => server.close(() => done())) };
}
