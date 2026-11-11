import { canManage, canReach } from "./peer-roster.ts";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { MOVE_BOT_FIELDS, moveKindsRoute, type MoveKindsDeps } from "./cloud-send-kinds.ts";
import { chiefLevel, readTeamRolesWith } from "./chief-level.ts";
import { DATA_DIR } from "./config.ts";
import type { ModelSelection } from "./contracts.ts";
import { defaultBotPatchRefusal, ensureDefaultBot } from "./default-bot.ts";
import * as mdb from "./message-db.ts";
import { Store, type BotRecord } from "./store.ts";
import { availableTools, catalogProfileFromEnv } from "./drivers/agents-catalog.ts";
import { createBrief } from "./host/brief.ts";

const selection = (): ModelSelection => ({ instanceId: "claude", model: "claude-sonnet-5" });
const placeDelios = (store: Store) => store.bots.filter((bot) => bot.defaultBot && !bot.defaultBot.person);
const intros = (store: Store, bot: BotRecord) => (bot.tasks ?? []).flatMap((task) => store.messagesFor(task.threadId)).filter((message) => message.helperIntro);
const boot = (store: Store) => ensureDefaultBot(store, { dataDir: DATA_DIR });
/** Who the daily brief comes from, as the server picks it. */
const briefChief = (store: Store) => createBrief({ store, dataDir: DATA_DIR, hosted: false, watching: () => true, mainThread: (id) => store.bot(id)?.threadId,
  threadBusy: () => false, notify: () => {}, runs: () => [], needsYou: () => [], engineName: () => "Claude", hostTimeZone: () => "UTC", language: () => undefined, session: () => null,
  address: () => undefined, failRun: () => {}, keep: () => {}, items: () => null }).chief();
/** A new install from before Delio was marked: its first bot was Delio in silver, made its Chief. */
function seededBefore(store: Store): BotRecord {
  const seeded = store.createBot({ name: "Delio", color: "silver" });
  store.setChiefOfStaff(seeded.id);
  return seeded;
}

describe("Delio, every person's helper", () => {
  beforeEach(() => rmSync(DATA_DIR, { recursive: true, force: true }));
  afterEach(() => readTeamRolesWith(() => null));

  it("gives a fresh install one Delio, its Chief, in chrome, introduced once", () => {
    const store = new Store(selection);
    store.seedIfEmpty();
    boot(store);
    boot(store);
    const again = new Store(selection);
    again.seedIfEmpty();
    boot(again);
    expect(again.bots).toHaveLength(1);
    const delio = placeDelios(again)[0]!;
    expect(delio).toMatchObject({ name: "Delio", color: "chrome", chiefOfStaff: true, defaultBot: {} });
    expect(intros(again, delio)).toHaveLength(1);
  });

  it("leaves a Team Cloud member's Delio uncrowned: only its person's own requests reach a bot everyone sees, and it manages none", () => {
    const store = new Store(selection);
    store.seedIfEmpty({ defaultBot: false });
    const own = ensureDefaultBot(store, { dataDir: DATA_DIR, person: "ada@acme.test", team: "Acme" })!;
    expect(own.chiefOfStaff).toBeFalsy();
    const fox = store.createBot({ name: "Fox", reportsTo: "ada@acme.test" } as never);
    expect(canReach(own, fox)).toBe(false);
    expect(canManage(own, fox)).toBe(false);
  });

  it("gives an existing install without one a Delio once on update, beside its Chief, which stays exactly as it was", () => {
    const store = new Store(selection);
    const chief = store.createBot({ name: "Pixel" });
    store.setChiefOfStaff(chief.id);
    store.createBot({ name: "Writer", title: "Writer", soul: "Write." });
    const before = structuredClone(store.bot(chief.id));
    const delio = boot(store)!;
    expect(delio).toMatchObject({ name: "Delio", color: "chrome", defaultBot: {} });
    expect(delio.chiefOfStaff).toBeFalsy();
    expect(chiefLevel(delio)).toBe(true);
    expect(store.bot(chief.id)).toEqual(before);
    expect(intros(store, delio)).toHaveLength(1);
    const restarted = new Store(selection);
    boot(restarted);
    expect(placeDelios(restarted).map((bot) => bot.id)).toEqual([delio.id]);
    expect(restarted.bots).toHaveLength(3);
    expect(restarted.bots.filter((bot) => bot.chiefOfStaff).map((bot) => bot.id)).toEqual([chief.id]);
  });

  it("adopts a new install's renamed Delio with its history instead of making another, and puts the intro on top of a new conversation", () => {
    const store = new Store(selection);
    const seeded = seededBefore(store);
    const first = seeded.threadId;
    store.appendMessage(first, { role: "user", kind: "text", text: "Book my flights." });
    store.patchBot(seeded.id, { name: "Jarvis" });
    const history = store.messagesFor(first).map((message) => message.id);
    store.createBot({ name: "Writer" });
    const adopted = boot(store)!;
    expect(adopted.id).toBe(seeded.id);
    expect(adopted).toMatchObject({ name: "Jarvis", color: "chrome", chiefOfStaff: true, defaultBot: {} });
    expect(store.bots).toHaveLength(2);
    expect(history).toHaveLength(2);
    expect(store.messagesFor(first).map((message) => message.id)).toEqual(history);
    expect(adopted.threadId).not.toBe(first);
    expect(store.messagesFor(adopted.threadId).map((message) => message.helperIntro)).toEqual([true]);
    boot(new Store(selection));
    expect(intros(new Store(selection), new Store(selection).bot(seeded.id)!)).toHaveLength(1);
  });

  it("keeps the colour the person gave an adopted Delio", () => {
    const store = new Store(selection);
    const seeded = seededBefore(store);
    store.patchBot(seeded.id, { color: "blue" });
    expect(boot(store)).toMatchObject({ id: seeded.id, color: "blue" });
  });

  it("makes Delio the Chief of a place that has none, so the brief has someone to come from", () => {
    const store = new Store(selection);
    store.createBot({ name: "Pixel" });
    const delio = boot(store)!;
    expect(store.bot(delio.id)?.chiefOfStaff).toBe(true);
    expect(briefChief(store)?.id).toBe(delio.id);
    expect(intros(store, delio)[0]?.text).toContain("Hey! I'm Delio. I'm new here. I'm here to be your Chief of Staff. I can manage your other bots.");
  });

  it("makes an adopted Delio the Chief when its place has none left", () => {
    const store = new Store(selection);
    const seeded = seededBefore(store);
    store.setChiefOfStaff(null);
    expect(store.bot(seeded.id)?.chiefOfStaff).toBeFalsy();
    expect(boot(store)?.id).toBe(seeded.id);
    expect(store.bot(seeded.id)?.chiefOfStaff).toBe(true);
    expect(briefChief(store)?.id).toBe(seeded.id);
  });

  it("leaves a place's own Chief as the Chief, and the brief comes from Delio, which says so", () => {
    const store = new Store(selection);
    const chief = store.createBot({ name: "Clive" });
    store.setChiefOfStaff(chief.id);
    const delio = boot(store)!;
    expect(store.bot(delio.id)?.chiefOfStaff).toBeFalsy();
    expect(briefChief(store)?.id).toBe(delio.id);
    expect(intros(store, delio)[0]?.text).toContain("your helper for everything here");
    expect(intros(store, delio)[0]?.text).toContain("keep an eye on your day");
    expect(intros(store, delio)[0]?.text).not.toContain("Chief of Staff");
  });

  it("keeps a Delio Chief hidden from the sidebar working as the Chief", () => {
    const store = new Store(selection);
    const delio = boot(store)!;
    store.patchBot(delio.id, { sidebarHidden: true });
    const restarted = new Store(selection);
    boot(restarted);
    expect(restarted.bot(delio.id)).toMatchObject({ chiefOfStaff: true, sidebarHidden: true });
    expect(briefChief(restarted)?.id).toBe(delio.id);
  });

  it("shows a hidden Delio again after a profile rename or a department move", () => {
    const store = new Store(selection);
    const delio = boot(store)!;
    const hiddenAfter = (change: () => unknown) => {
      store.patchBot(delio.id, { sidebarHidden: true });
      change();
      return store.bot(delio.id)?.sidebarHidden;
    };
    expect(hiddenAfter(() => store.patchBotProfile(delio.id, { title: "Helper" }))).toBe(true);
    expect(hiddenAfter(() => store.patchBotProfile(delio.id, { name: "Nova" }))).toBe(false);
    expect(hiddenAfter(() => store.setBotsSection([delio.id], "Work"))).toBe(false);
    expect(hiddenAfter(() => store.setBotsSection([delio.id], "Work"))).toBe(true);
    expect(hiddenAfter(() => store.updateTeamMembers("Work", [], [delio.id]))).toBe(false);
    expect(hiddenAfter(() => store.updateTeamMembers("Work", [delio.id], []))).toBe(false);
  });

  it("shows a hidden Delio again after its department is deleted or a reviewed setup renames it", () => {
    const store = new Store(selection);
    const delio = boot(store)!;
    store.setBotsSection([delio.id], "Work");
    store.patchBot(delio.id, { sidebarHidden: true });
    expect(store.deleteSection("Work")).toBeUndefined();
    expect(store.bot(delio.id)?.sidebarHidden).toBe(false);
    store.patchBot(delio.id, { sidebarHidden: true });
    store.applyTeamSetup({ version: 1, requestId: "setup-rename", botId: delio.id, threadId: delio.threadId,
      reason: "Requested", createdAt: 1, requesterRevision: "fixture", newTeams: [], operations: [
        { action: "update", botId: delio.id, fields: { name: "Nova" } },
      ] });
    expect(store.bot(delio.id)).toMatchObject({ name: "Nova", sidebarHidden: false });
  });

  it("knows a renamed Delio by its mark: no second one on update, Chief tools kept", () => {
    const store = new Store(selection);
    store.createBot({ name: "Writer" });
    const chief = store.createBot({ name: "Clive" });
    store.setChiefOfStaff(chief.id);
    const delio = boot(store)!;
    store.patchBot(delio.id, { name: "Jarvis", color: "blue" });
    const restarted = new Store(selection);
    boot(restarted);
    expect(placeDelios(restarted).map((bot) => [bot.id, bot.name])).toEqual([[delio.id, "Jarvis"]]);
    expect(chiefLevel(restarted.bot(delio.id))).toBe(true);
    expect(restarted.bots).toHaveLength(3);
  });

  it("never takes a first bot that is not a new install's Delio: it gets a Delio beside it", () => {
    const store = new Store(selection);
    const pixel = store.createBot({ name: "Pixel" });
    const delio = boot(store)!;
    expect(delio.id).not.toBe(pixel.id);
    expect(store.bot(pixel.id)?.defaultBot).toBeUndefined();
  });

  it("introduces itself once: not again after the asks were answered or dismissed, nor after a restart", () => {
    const store = new Store(selection);
    const delio = boot(store)!;
    const [intro] = intros(store, delio);
    expect(intro?.card?.options).toHaveLength(4);
    store.appendMessage(delio.threadId, { role: "user", kind: "text", text: "What can you do?" });
    expect(store.messagesFor(delio.threadId).find((message) => message.id === intro!.id)?.card?.dismissed).toBe(true);
    for (let restart = 0; restart < 2; restart++) boot(new Store(selection));
    const after = new Store(selection);
    expect(intros(after, after.bot(delio.id)!)).toHaveLength(1);
  });

  it("never counts its intro as something that needs the person", () => {
    const store = new Store(selection);
    const delio = boot(store)!;
    expect(intros(store, delio)).toHaveLength(1);
    expect(mdb.attentionRows(0).filter((row) => row.kind === "options")).toEqual([]);
  });

  it("is hidden, never deleted or archived, and a hidden Delio is never made again", () => {
    const store = new Store(selection);
    const delio = boot(store)!;
    const other = store.createBot({ name: "Writer" });
    expect(() => store.deleteBot(delio.id)).toThrow(/Delio can't be deleted or archived/);
    expect(store.bot(delio.id)).toBeTruthy();
    expect(defaultBotPatchRefusal(delio, { hidden: true })).toMatch(/Show Delio in the sidebar/);
    expect(defaultBotPatchRefusal(other, { sidebarHidden: true })).toMatch(/Only Delio/);
    expect(defaultBotPatchRefusal(delio, { sidebarHidden: "yes" })).toBe("sidebarHidden must be true or false");
    expect(defaultBotPatchRefusal(delio, { sidebarHidden: true })).toBeNull();
    store.patchBot(delio.id, { sidebarHidden: true });
    const restarted = new Store(selection);
    boot(restarted);
    expect(placeDelios(restarted).map((bot) => [bot.id, bot.sidebarHidden])).toEqual([[delio.id, true]]);
    restarted.patchBot(delio.id, { sidebarHidden: false });
    expect(new Store(selection).bot(delio.id)?.sidebarHidden).toBe(false);
  });

  it("is never made twice for one place, even once its mark is gone", () => {
    const store = new Store(selection);
    const delio = boot(store)!;
    store.patchBot(delio.id, { defaultBot: undefined });
    expect(boot(store)).toBeNull();
    expect(store.bots).toHaveLength(1);
  });

  it("keeps the oldest when two are marked", () => {
    const store = new Store(selection);
    const first = boot(store)!;
    const second = store.createBot({ name: "Delio 2" });
    store.patchBot(second.id, { defaultBot: {} });
    expect(boot(store)?.id).toBe(first.id);
    expect(placeDelios(store).map((bot) => bot.id)).toEqual([first.id]);
  });

  it("gives each Team Cloud member their own private Delio, and the team no Delio of its own", () => {
    const store = new Store(selection);
    store.seedIfEmpty({ defaultBot: false });
    expect(store.bots).toHaveLength(1);
    expect(store.bots[0]).toMatchObject({ chiefOfStaff: true });
    expect(store.bots[0]?.defaultBot).toBeUndefined();
    const ada = ensureDefaultBot(store, { dataDir: DATA_DIR, person: "Ada@Example.com", team: "Acme" })!;
    const bea = ensureDefaultBot(store, { dataDir: DATA_DIR, person: "bea@example.com", team: "Acme" })!;
    expect(ensureDefaultBot(store, { dataDir: DATA_DIR, person: "ada@example.com", team: "Acme" })?.id).toBe(ada.id);
    expect(ada).toMatchObject({ name: "Delio", defaultBot: { person: "ada@example.com" }, visibility: { people: ["ada@example.com"] } });
    expect(bea).toMatchObject({ defaultBot: { person: "bea@example.com" }, visibility: { people: ["bea@example.com"] } });
    expect(ada.chiefOfStaff).toBeFalsy();
    expect(intros(store, ada)[0]?.text).toContain("On Acme, I'm here for you and look after your own bots.");
    expect(intros(store, ada)[0]?.text).not.toContain("keep an eye on your day");
    expect(store.bots).toHaveLength(3);
  });

  it("holds a Chief's tools, never more than its member: a User's Delio holds none", () => {
    const store = new Store(selection);
    const place = boot(store)!;
    const member = ensureDefaultBot(store, { dataDir: DATA_DIR, person: "user@example.com", team: "Acme" })!;
    const admin = ensureDefaultBot(store, { dataDir: DATA_DIR, person: "admin@example.com", team: "Acme" })!;
    const tools = (bot: BotRecord) => availableTools(catalogProfileFromEnv({ ODB_CHIEF_OF_STAFF: chiefLevel(bot) ? "1" : "0", ODB_BOT_ID: bot.id })).map((tool) => tool.name);
    expect(tools(place)).toEqual(expect.arrayContaining(["create_bot", "propose_team_setup", "retry_thread", "manage_room"]));
    expect([chiefLevel(member), chiefLevel(admin)]).toEqual([false, false]);
    readTeamRolesWith((email) => email === "admin@example.com" ? "admin" : email === "user@example.com" ? "member" : null);
    expect([chiefLevel(member), chiefLevel(admin)]).toEqual([false, true]);
    expect(tools(member)).not.toContain("create_bot");
    expect(tools(admin)).toContain("create_bot");
  });

  describe("moves", () => {
    const OWNER = { person: "p_owner0000000000000000", name: "Amit" };
    const deps = (store: Store): MoveKindsDeps => ({ dataDir: DATA_DIR, store, routines: () => null, calls: () => null, webhooks: () => null, appEvents: () => null,
      claudeCodeSkills: () => [], instanceExists: () => true, owner: () => OWNER, ownRoutine: () => {} } as unknown as MoveKindsDeps);
    async function arrive(store: Store, id: string, record: Record<string, unknown>, computer?: string, extra: Record<string, unknown> = {}) {
      let status = 0;
      await moveKindsRoute(deps(store), { path: "/api/cloud-send/kind", method: "PUT", url: new URL("http://127.0.0.1/api/cloud-send/kind"), auth: {} as never, req: {} as never,
        res: { setHeader() {} } as never, json: ((_res: unknown, code: number) => { status = code; }) as never,
        readBody: (async () => ({ v: 1, key: `bot:${id}`, dataDir: "/Users/amit/.opendeliobot", record, ...(computer ? { computer } : {}), ...extra })) as never });
      return status;
    }
    const fields = (bot: Record<string, unknown>) => Object.fromEntries(MOVE_BOT_FIELDS.map((name) => [name, bot[name] ?? null]));

    it("leaves My Cloud exactly one Delio when this computer's arrives: My Cloud's unused one is archived, whatever order the Chief comes in", async () => {
      const cloud = new Store(selection);
      cloud.seedIfEmpty();
      boot(cloud);
      const starter = placeDelios(cloud)[0]!;
      const arrivingDelio = cloud.createBot({ name: "Delio" }, { id: "desk-delio-000001", seedMessages: false });
      expect(await arrive(cloud, arrivingDelio.id, fields({ defaultBot: {}, sidebarHidden: true, welcomed: true }))).toBe(200);
      expect(placeDelios(cloud).map((bot) => bot.id)).toEqual([arrivingDelio.id]);
      expect(cloud.bot(arrivingDelio.id)).toMatchObject({ sidebarHidden: true, welcomed: true });
      expect(cloud.bot(starter.id)).toMatchObject({ chiefOfStaff: true });
      expect(cloud.bot(starter.id)?.hidden).toBeFalsy();
      const pixel = cloud.createBot({ name: "Pixel" }, { id: "desk-chief-00001", seedMessages: false });
      expect(await arrive(cloud, pixel.id, fields({ chiefOfStaff: true }))).toBe(200);
      expect(cloud.bot(starter.id)).toMatchObject({ hidden: true });
      expect(cloud.bot(starter.id)?.defaultBot).toBeUndefined();
      expect(cloud.bots.filter((bot) => bot.chiefOfStaff).map((bot) => bot.id)).toEqual([pixel.id]);
      expect(placeDelios(cloud).map((bot) => bot.id)).toEqual([arrivingDelio.id]);
    });

    it("still makes one Delio on My Cloud when this computer's arrives renamed and with its own picture", async () => {
      const cloud = new Store(selection);
      cloud.seedIfEmpty();
      boot(cloud);
      const starter = placeDelios(cloud)[0]!;
      cloud.patchBot(starter.id, { name: "Starter" });
      const arriving = cloud.createBot({ name: "Jarvis" }, { id: "desk-delio-000003", seedMessages: false });
      cloud.patchBot(arriving.id, { avatarUrl: "/api/attachments/jarvis.png", avatarCrop: "circle" });
      expect(await arrive(cloud, arriving.id, fields({ defaultBot: {}, welcomed: true }))).toBe(200);
      expect(placeDelios(cloud).map((bot) => [bot.id, bot.name, bot.avatarUrl])).toEqual([[arriving.id, "Jarvis", "/api/attachments/jarvis.png"]]);
      expect(cloud.bot(starter.id)?.defaultBot).toBeUndefined();
    });

    it("keeps a My Cloud Delio someone already used as the Delio, and the arriving one becomes an ordinary bot named for its computer (email 1a1c22b6)", async () => {
      const cloud = new Store(selection);
      cloud.seedIfEmpty();
      const theirs = boot(cloud)!;
      cloud.appendMessage(theirs.threadId, { role: "user", kind: "text", text: "Hi" });
      const arriving = cloud.createBot({ name: "Delio" }, { id: "desk-delio-000002", seedMessages: false });
      expect(await arrive(cloud, arriving.id, fields({ defaultBot: {}, sidebarHidden: true }), "Amit's MacBook")).toBe(200);
      expect(placeDelios(cloud).map((bot) => bot.id)).toEqual([theirs.id]);
      expect(cloud.bot(theirs.id)).toMatchObject({ name: "Delio", chiefOfStaff: true });
      expect(cloud.bot(theirs.id)?.hidden).toBeFalsy();
      const moved = cloud.bot(arriving.id)!;
      expect(moved).toMatchObject({ name: "Delio (from Amit's MacBook)" });
      expect([moved.defaultBot, moved.sidebarHidden, moved.hidden]).toEqual([undefined, undefined, undefined]);
      expect(defaultBotPatchRefusal(moved, { hidden: true })).toBeNull();
      expect(defaultBotPatchRefusal(cloud.bot(theirs.id), { hidden: true })).toContain("can't be deleted or archived");
      expect(boot(cloud)?.id).toBe(theirs.id);
      // A Mac Delio that was the Chief there doesn't take the crown from the one kept here.
      const chief = cloud.createBot({ name: "Delio" }, { id: "desk-delio-000006", seedMessages: false });
      expect(await arrive(cloud, chief.id, fields({ defaultBot: {}, chiefOfStaff: true }), "Amit's MacBook")).toBe(200);
      expect(cloud.bots.filter((bot) => bot.chiefOfStaff).map((bot) => bot.id)).toEqual([theirs.id]);
      // Nor on a later pass that sends only its Chief fields: the computer it comes from says it is the Delio there.
      expect(await arrive(cloud, chief.id, { chiefOfStaff: true, managedSections: ["General"] }, "Amit's MacBook", { sourceDefault: true })).toBe(200);
      expect(cloud.bots.filter((bot) => bot.chiefOfStaff).map((bot) => bot.id)).toEqual([theirs.id]);
      expect(placeDelios(cloud).map((bot) => bot.id)).toEqual([theirs.id]);
      // Nor from a Chief here that is not the Delio.
      const lee = cloud.createBot({ name: "Lee" }, { id: "cloud-lee-000008", seedMessages: false });
      cloud.setChiefOfStaff(lee.id);
      const third = cloud.createBot({ name: "Delio" }, { id: "desk-delio-000009", seedMessages: false });
      expect(await arrive(cloud, third.id, fields({ defaultBot: {}, chiefOfStaff: true, managedSections: ["General"] }), "Amit's MacBook")).toBe(200);
      expect(cloud.bots.filter((bot) => bot.chiefOfStaff).map((bot) => bot.id)).toEqual([lee.id]);
      // A Chief that is not a Delio takes the crown.
      const ada = cloud.createBot({ name: "Ada" }, { id: "desk-ada-000007", seedMessages: false });
      expect(await arrive(cloud, ada.id, { chiefOfStaff: true }, "Amit's MacBook")).toBe(200);
      expect(cloud.bots.filter((bot) => bot.chiefOfStaff).map((bot) => bot.id)).toEqual([ada.id]);
    });

    it("keeps a used Delio here and leaves a renamed arriving one its own name, or names an unknown computer plainly", async () => {
      const cloud = new Store(selection);
      const theirs = boot(cloud)!;
      cloud.patchBot(theirs.id, { soul: "Answer in French." });
      const jarvis = cloud.createBot({ name: "Jarvis" }, { id: "desk-delio-000004", seedMessages: false });
      expect(await arrive(cloud, jarvis.id, fields({ defaultBot: {} }), "Amit's MacBook")).toBe(200);
      expect(cloud.bot(jarvis.id)).toMatchObject({ name: "Jarvis" });
      expect(cloud.bot(jarvis.id)?.defaultBot).toBeUndefined();
      const unnamed = cloud.createBot({ name: "Delio" }, { id: "desk-delio-000005", seedMessages: false });
      expect(await arrive(cloud, unnamed.id, fields({ defaultBot: {} }))).toBe(200);
      expect(cloud.bot(unnamed.id)).toMatchObject({ name: "Delio (from another computer)" });
      expect(placeDelios(cloud).map((bot) => bot.id)).toEqual([theirs.id]);
    });

    it("comes home to exactly the one Delio My Cloud had, and makes none", () => {
      const cloud = new Store(selection);
      cloud.seedIfEmpty();
      const delioOnCloud = boot(cloud)!;
      cloud.patchBot(delioOnCloud.id, { name: "Jarvis", sidebarHidden: true });
      const backup = readFileSync(join(DATA_DIR, "bots.json"), "utf8");
      for (const file of ["bots.json", "default-bot.json"]) rmSync(join(DATA_DIR, file), { force: true });
      const desk = new Store(selection);
      desk.seedIfEmpty();
      boot(desk);
      rmSync(join(DATA_DIR, "bots.json"));
      writeFileSync(join(DATA_DIR, "bots.json"), backup);
      const home = new Store(selection);
      home.seedIfEmpty();
      boot(home);
      expect(home.bots.map((bot) => bot.id)).toEqual([delioOnCloud.id]);
      expect(placeDelios(home)[0]).toMatchObject({ name: "Jarvis", sidebarHidden: true });
    });
  });
});
