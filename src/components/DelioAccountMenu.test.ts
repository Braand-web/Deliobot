import { describe, expect, it, vi } from "vitest";

import { delioMenuItems } from "./DelioAccountMenu";

const actions = () => ({ signIn: vi.fn(), manage: vi.fn(), switchAccount: vi.fn(), signOut: vi.fn() });

describe("the You menu's Deliobot account rows", () => {
  it("offers to sign in or create an account while the app is not connected", () => {
    const calls = actions();
    const rows = delioMenuItems({ connected: false, planGate: true, ownAi: false }, calls);
    expect(rows.map((row) => row.key)).toEqual(["delio-sign-in"]);
    rows[0]!.onSelect?.();
    expect(calls.signIn).toHaveBeenCalled();
  });

  it("names the signed-in address with its plan and credits, and offers manage, switch and sign out", () => {
    const calls = actions();
    const rows = delioMenuItems({ connected: true, planGate: true, ownAi: false, workspace: "me-abc", portal: "https://compte.deliobot.fun", email: "ana@acme.test", plan: "trial", credits: 300 }, calls);
    expect(rows.map((row) => row.key)).toEqual(["delio-account", "delio-manage", "delio-switch", "delio-sign-out"]);
    expect(rows[0]).toMatchObject({ label: "ana@acme.test", checked: true });
    expect(rows[0]!.subtitle).toMatch(/300/);
    rows[3]!.onSelect?.();
    expect(calls.signOut).toHaveBeenCalled();
  });

  it("shows nothing until the account is known", () => {
    expect(delioMenuItems(null, actions())).toEqual([]);
  });
});
