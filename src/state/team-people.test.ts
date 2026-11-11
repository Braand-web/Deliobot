import { describe, expect, it } from "vitest";

import { schedulableBots } from "./team-people";

const OLIVE = { email: "olive@acme.test", name: "Olive", role: "owner", you: true as const };
const bots = [
  { id: "scout", yourAccess: "edit" },
  { id: "payroll", yourAccess: "view" },
  { id: "olives-delio", defaultBot: { person: "Olive@acme.test" }, yourAccess: "edit" },
  { id: "bobs-delio", defaultBot: { person: "bob@acme.test" }, yourAccess: "edit" },
  { id: "archived", hidden: true, yourAccess: "edit" },
];

describe("schedulableBots", () => {
  it("on a team lists only the bots the person can chat with, their own Delio and no teammate's", () => {
    expect(schedulableBots(bots, { me: OLIVE }).map((bot) => bot.id)).toEqual(["scout", "olives-delio"]);
  });

  it("keeps the bot a routine being changed already has", () => {
    expect(schedulableBots(bots, { me: OLIVE }, "payroll").map((bot) => bot.id)).toEqual(["scout", "payroll", "olives-delio"]);
  });

  it("off a team lists every bot shown", () => {
    expect(schedulableBots(bots, null).map((bot) => bot.id)).toEqual(["scout", "payroll", "olives-delio", "bobs-delio"]);
  });
});
