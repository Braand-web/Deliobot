import { describe, expect, it } from "vitest";
import { setLocale } from "@/lib/i18n";
import { accountLine, fromDelio } from "./account-summary";

describe("the account line, from the Deliobot account", () => {
  it("reads signed in, with the plan and the address, once the app is connected", () => {
    setLocale("en");
    const summary = fromDelio({ planGate: true, ownAi: false, connected: true, workspace: "me-abc", portal: "https://compte.deliobot.fun", email: "ana@example.com", plan: "pro", credits: 12 });
    expect(summary).toEqual({ signedIn: true, email: "ana@example.com", plan: "Pro", paid: true });
    expect(accountLine(summary, { browser: false, place: "This computer", openSource: false })).toBe("Pro · ana@example.com");
  });

  it("reads not signed in only when the app is not connected", () => {
    setLocale("en");
    const summary = fromDelio({ planGate: true, ownAi: false, connected: false });
    expect(accountLine(summary, { browser: false, place: "This computer", openSource: false })).toBe("Not signed in");
  });
});
