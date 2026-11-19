import { describe, expect, it } from "vitest";

import { siteAuth } from "../../../apps/admin/src/app-hosting.ts";
import { hasSession, loginPage, passwordMatches, safeNext, sessionCookie, SESSION_SECONDS } from "./auth.ts";

describe("a private site", () => {
  const auth = siteAuth("correct horse battery");

  it("opens with the password the portal stored, and only with it", async () => {
    expect(await passwordMatches(auth, "correct horse battery")).toBe(true);
    expect(await passwordMatches(auth, "correct horse batterY")).toBe(false);
    expect(await passwordMatches(auth, "")).toBe(false);
  });

  it("keeps a visitor in with a cookie for this site only, until it expires or the password changes", async () => {
    const now = 1_800_000_000;
    const cookie = (await sessionCookie(auth, "abcdefghjk", now)).split(";")[0]!;
    expect(await hasSession(auth, "abcdefghjk", `other=1; ${cookie}`, now + 60)).toBe(true);
    expect(await hasSession(auth, "abcdefghjm", cookie, now + 60)).toBe(false);
    expect(await hasSession(auth, "abcdefghjk", cookie, now + SESSION_SECONDS + 1)).toBe(false);
    expect(await hasSession(siteAuth("a new password"), "abcdefghjk", cookie, now + 60)).toBe(false);
    expect(await hasSession(auth, "abcdefghjk", cookie.replace(/.$/, (c) => (c === "0" ? "1" : "0")), now + 60)).toBe(false);
    expect(await hasSession(auth, "abcdefghjk", null, now)).toBe(false);
  });

  it("sends a visitor back only to a page of the same site", () => {
    expect(safeNext("/shop?x=1")).toBe("/shop?x=1");
    expect(safeNext("//evil.example")).toBe("/");
    expect(safeNext("/\\evil.example")).toBe("/");
    expect(safeNext("https://evil.example")).toBe("/");
    expect(loginPage('/"><script>', false)).not.toContain("<script>");
  });
});
