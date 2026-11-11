import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PINNED_CIRCLES_KEY, SIDEBAR_TOOLS_LAYOUT_KEY, UNIVERSAL_PINS_KEY } from "./sidebar-preferences";

const values = new Map<string, string>();
const local = {
  getItem: vi.fn((key: string) => values.get(key) ?? null),
  setItem: vi.fn((key: string, value: string) => { values.set(key, value); }),
  removeItem: vi.fn((key: string) => { values.delete(key); }),
};

// Each case boots fresh modules over the same storage, as a launch would. simpleOnly false is the switch put back.
async function boot(simpleOnly = true) {
  vi.resetModules();
  vi.doMock("./simple-only", () => ({ SIMPLE_ONLY: simpleOnly }));
  const [look, mode, fonts, width] = await Promise.all([import("./new-look"), import("./interface-mode"), import("./fonts"), import("./chat-width")]);
  look.settleInterfaceMode();
  return { ...look, mode, font: fonts.readFont(), width: width.readChatWidth() };
}

const ADVANCED_PREFS = {
  "odb-font": "serif", "odb-chat-width": "full", "odb-show-threads": "1", "openopendeliobot.comdebarToolsLayout": "toolbar",
  "opendeliobot.pinnedCircles": "1", "opendeliobot.universalPins": "1", "odb-show-run-card": "0", "odb-web-panels": "[]",
};
const KEPT = { "odb-skin": "lagoon", "openopendeliobot.comdebarDensity": "avatars", "odb-drafts": "{}" };

beforeEach(() => {
  values.clear();
  vi.clearAllMocks();
  vi.stubGlobal("localStorage", local);
  vi.stubGlobal("window", new EventTarget());
});

afterEach(() => {
  vi.doUnmock("./simple-only");
  vi.unstubAllGlobals();
});

describe("the move to Simple as the only mode", () => {
  it("owes the notice to a browser that chose Advanced, retires its mode key, and puts Advanced's own settings back once", async () => {
    for (const [key, value] of Object.entries({ ...ADVANCED_PREFS, ...KEPT, "odb-advanced-mode": "1" })) values.set(key, value);
    const first = await boot();
    expect(first.newLookDue()).toBe(true);
    expect(values.get("odb-new-look")).toBe("due");
    expect(values.has("odb-advanced-mode")).toBe(false);
    for (const key of Object.keys(ADVANCED_PREFS)) expect(values.has(key), key).toBe(false);
    for (const [key, value] of Object.entries(KEPT)) expect(values.get(key), key).toBe(value);
    expect([first.font, first.width]).toEqual(["skin", "standard"]);
    expect(first.mode.readAdvancedMode()).toBe(false);

    // Once: what is set after the move stays, and the notice stays owed until it is closed.
    values.set("odb-font", "inter");
    const second = await boot();
    expect(second.font).toBe("inter");
    expect(second.newLookDue()).toBe(true);
  });

  it("owes it where Advanced was the default for an earlier install that never chose", async () => {
    values.set("odb-installed", "2026-01-01T00:00:00.000Z");
    expect((await boot()).newLookDue()).toBe(true);
  });

  it("never owes it to a browser on Simple, nor to a new install, even once prior-run keys pile up", async () => {
    for (const [key, value] of Object.entries({ ...ADVANCED_PREFS, "odb-skin": "midnight", "odb-advanced-mode": "0" })) values.set(key, value);
    expect((await boot()).newLookDue()).toBe(false);
    expect(values.get("odb-new-look")).toBe("none");
    for (const key of Object.keys(ADVANCED_PREFS)) expect(values.has(key), key).toBe(false);
    expect((await boot()).newLookDue(), "the retired key is not read as an old default").toBe(false);

    values.clear();
    expect((await boot()).newLookDue()).toBe(false);
    values.set("odb-skin", "system");
    values.set("odb-show-threads", "1");
    expect((await boot()).newLookDue()).toBe(false);
  });

  it("closes for good, and for the session where storage will not take it", async () => {
    values.set("odb-advanced-mode", "1");
    const look = await boot();
    look.markNewLookSeen();
    expect(look.newLookDue()).toBe(false);
    expect(values.get("odb-new-look")).toBe("seen");
    expect((await boot()).newLookDue()).toBe(false);

    values.set("odb-new-look", "due");
    const blocked = await boot();
    local.setItem.mockImplementationOnce(() => { throw new Error("quota"); });
    blocked.markNewLookSeen();
    expect(blocked.newLookDue()).toBe(false);
    expect(values.get("odb-new-look")).toBe("due");
  });

  it("never throws at boot when storage cannot be read", async () => {
    local.getItem.mockImplementation(() => { throw new Error("blocked"); });
    const look = await boot();
    expect(look.newLookDue()).toBe(false);
    local.getItem.mockImplementation((key: string) => values.get(key) ?? null);
  });

  it("spells out the sidebar's keys as sidebar-preferences.ts names them", async () => {
    const { ADVANCED_ONLY_PREFS } = await import("./new-look");
    expect(ADVANCED_ONLY_PREFS).toEqual(expect.arrayContaining([SIDEBAR_TOOLS_LAYOUT_KEY, PINNED_CIRCLES_KEY, UNIVERSAL_PINS_KEY]));
    expect(ADVANCED_ONLY_PREFS).toEqual(expect.arrayContaining(Object.keys(ADVANCED_PREFS)));
  });
});

describe("with the switch put back", () => {
  it("gives each browser the mode it had before the move, and leaves the notice alone", async () => {
    values.set("odb-new-look", "seen");
    let rolled = await boot(false);
    expect(rolled.mode.readAdvancedMode()).toBe(true);
    expect(values.get("odb-advanced-mode")).toBe("1");

    values.clear();
    values.set("odb-new-look", "none");
    values.set("odb-skin", "midnight");
    rolled = await boot(false);
    expect(rolled.mode.readAdvancedMode()).toBe(false);
    expect(values.get("odb-advanced-mode")).toBe("0");
    expect(values.get("odb-new-look")).toBe("none");
  });

  it("keeps the old default for a browser the move never reached", async () => {
    values.set("odb-skin", "midnight");
    const rolled = await boot(false);
    expect(rolled.mode.readAdvancedMode()).toBe(true);
    expect(values.get("odb-advanced-mode")).toBe("1");
    expect(values.has("odb-new-look")).toBe(false);
  });
});

describe("Advanced mode back, as shipped", () => {
  it("ships with the switch off", async () => {
    vi.resetModules();
    expect((await vi.importActual<typeof import("./simple-only")>("./simple-only")).SIMPLE_ONLY).toBe(false);
  });

  it.each(["due", "seen"])("puts a browser the move found on Advanced (%s) back on it once, with word that it is back, and keeps a later switch to Simple", async (look) => {
    values.set("odb-new-look", look);
    values.set("odb-skin", "lagoon");
    const first = await boot(false);
    expect(first.mode.readAdvancedMode()).toBe(true);
    expect(values.get("odb-advanced-mode")).toBe("1");
    expect(first.advancedBackDue()).toBe(true);
    expect(values.get("odb-new-look"), "the record of the move stays").toBe(look);

    expect((await boot(false)).advancedBackDue(), "owed until it is closed").toBe(true);
    first.markAdvancedBackSeen();
    expect(values.get("odb-advanced-back")).toBe("seen");
    const again = await boot(false);
    expect(again.advancedBackDue()).toBe(false);
    expect(again.mode.readAdvancedMode()).toBe(true);

    again.mode.setAdvancedMode(false);
    const later = await boot(false);
    expect(later.mode.readAdvancedMode(), "Simple, once chosen, stays").toBe(false);
    expect(values.get("odb-advanced-back")).toBe("seen");
  });

  it("restores nothing it cannot know: the reset settings stay at their defaults, which Advanced reads as threads shown, and a choice made since stays", async () => {
    values.set("odb-new-look", "seen");
    values.set("opendeliobot.universalPins", "true");
    const back = await boot(false);
    expect(back.mode.readAdvancedMode()).toBe(true);
    for (const key of Object.keys(ADVANCED_PREFS).filter((key) => key !== "opendeliobot.universalPins")) expect(values.has(key), key).toBe(false);
    expect(values.get("opendeliobot.universalPins")).toBe("true");
    expect([back.font, back.width]).toEqual(["skin", "standard"]);
  });

  it("leaves a browser that was on Simple on Simple, with no word", async () => {
    values.set("odb-new-look", "none");
    values.set("odb-skin", "midnight");
    const simple = await boot(false);
    expect(simple.mode.readAdvancedMode()).toBe(false);
    expect(simple.advancedBackDue()).toBe(false);
    expect(values.has("odb-advanced-back")).toBe(false);
  });

  it.each(["1", "0"])("never runs the one-time cleanup where it has not run: a browser straight from an earlier version keeps its mode (%s) and settings", async (stored) => {
    for (const [key, value] of Object.entries({ ...ADVANCED_PREFS, ...KEPT, "odb-advanced-mode": stored })) values.set(key, value);
    const kept = await boot(false);
    for (const [key, value] of Object.entries({ ...ADVANCED_PREFS, ...KEPT })) expect(values.get(key), key).toBe(value);
    expect(kept.mode.readAdvancedMode()).toBe(stored === "1");
    expect([kept.font, kept.width]).toEqual(["serif", "full"]);
    expect(values.has("odb-new-look")).toBe(false);
    expect(kept.advancedBackDue()).toBe(false);
  });

  it("is safe with no record of the move, an unknown one, or storage that cannot be read", async () => {
    expect((await boot(false)).mode.readAdvancedMode(), "a new install").toBe(false);
    expect(values.has("odb-advanced-back")).toBe(false);

    values.clear();
    values.set("odb-new-look", "garbled");
    const unknown = await boot(false);
    expect(unknown.mode.readAdvancedMode()).toBe(false);
    expect(unknown.advancedBackDue()).toBe(false);

    local.getItem.mockImplementation(() => { throw new Error("blocked"); });
    const blocked = await boot(false);
    expect(blocked.advancedBackDue()).toBe(false);
    local.getItem.mockImplementation((key: string) => values.get(key) ?? null);
  });
});
