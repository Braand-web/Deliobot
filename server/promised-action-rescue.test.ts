import { describe, expect, it } from "vitest";
import { announcesAction, createPromisedActionRescue, PROMISED_ACTION_TEXT, turnActed } from "./promised-action-rescue.ts";
import type { Message } from "./store.ts";

const line = (fields: Partial<Message>): Message => ({ id: "m", role: "bot", kind: "text", at: 1, ...fields }) as Message;

describe("a reply that announces an action", () => {
  it("is caught in French and English", () => {
    expect(announcesAction("Je lance la publication maintenant sur @deliobot :\n(Navigateur intégré — surface : Browser)")).toBe(true);
    expect(announcesAction("Je ne m'arrête pas — je publie la vidéo maintenant.")).toBe(true);
    expect(announcesAction("Je vais publier la vidéo sur YouTube.")).toBe(true);
    expect(announcesAction("I'm publishing it now.")).toBe(true);
    expect(announcesAction("Let me open YouTube Studio.")).toBe(true);
  });

  it("is not a question to the person, a report or plain chat", () => {
    expect(announcesAction("Je lance la publication maintenant, ou tu préfères la programmer ?")).toBe(false);
    expect(announcesAction("La vidéo est publiée : https://youtu.be/abc")).toBe(false);
    expect(announcesAction("Bonjour ! Comment puis-je t'aider ?")).toBe(false);
    expect(announcesAction("")).toBe(false);
  });

  it("counts a tool line of the same turn as acting, not its summary", () => {
    expect(turnActed([line({ turnId: "t1" }), line({ turnId: "t1", kind: "activity" })], "t1")).toBe(true);
    expect(turnActed([line({ turnId: "t1" }), line({ turnId: "t1", kind: "digest" as Message["kind"] })], "t1")).toBe(false);
    expect(turnActed([line({ turnId: "t1" }), line({ turnId: "t0", kind: "activity" })], "t1")).toBe(false);
  });
});

describe("the rescue", () => {
  function fixture(path: Message[]) {
    const runs: Array<() => void> = [];
    const sent: Array<{ botId: string; threadId: string; text: string }> = [];
    let busy = false;
    const rescue = createPromisedActionRescue({
      activePath: () => path, threadBusy: () => busy, threadQueued: () => false,
      continueRequest: async (botId, threadId, text) => { sent.push({ botId, threadId, text }); },
      later: (run) => { runs.push(run); },
    });
    return { rescue, runs, sent, path, setBusy: (value: boolean) => { busy = value; } };
  }

  it("asks the bot once per request to do what it announced, and never when it acted", () => {
    const path = [line({ id: "u1", role: "user", at: 1 }), line({ id: "b1", turnId: "t1", at: 2 })];
    const f = fixture(path);
    expect(f.rescue.turnEnded("bot", "thread", "t1", "Je lance la publication maintenant.")).toBe(true);
    f.runs.splice(0).forEach((run) => run());
    expect(f.sent).toEqual([{ botId: "bot", threadId: "thread", text: PROMISED_ACTION_TEXT }]);
    expect(f.rescue.turnEnded("bot", "thread", "t2", "Je publie la vidéo maintenant.")).toBe(false);
    path.push(line({ id: "u2", role: "user", at: 5 }), line({ id: "a", turnId: "t3", kind: "activity", at: 6 }));
    expect(f.rescue.turnEnded("bot", "thread", "t3", "Je lance la publication maintenant.")).toBe(false);
  });

  it("stays quiet when the person wrote since or the thread runs again", () => {
    const path = [line({ id: "u1", role: "user", at: 1 })];
    const f = fixture(path);
    f.rescue.turnEnded("bot", "thread", "t1", "I'm publishing it now.");
    f.setBusy(true);
    f.runs.splice(0).forEach((run) => run());
    expect(f.sent).toEqual([]);
    const g = fixture([line({ id: "u1", role: "user", at: 1 })]);
    g.rescue.turnEnded("bot", "thread", "t1", "I'm publishing it now.");
    g.path.push(line({ id: "u2", role: "user", at: Date.now() + 1_000 }));
    g.runs.splice(0).forEach((run) => run());
    expect(g.sent).toEqual([]);
  });
});
