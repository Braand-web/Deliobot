import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { EMPTY_ONBOARDING, type OnboardingStatus } from "@/lib/onboarding";
import { withTourReset } from "@/lib/guided-tour";
import { DESKTOP_NOTICES } from "../../electron/desktop-prefs.mjs";
import { CLOUD_INTRO, CLOUD_NOTICE, CLOUD_TRIAL_NOTICE, dismissNotice, dismissNotices, FOLLOWERS, introShown, introStage, launchNotice, localDay, markLaunchNotice,
  nextNotice, noticeSeen, NOTICES, OLD_PRO_DISMISSALS, PHONE_UPDATE_NOTICE, phoneUpdateHint, SIMPLE_MODE_NOTICE, STAR_NOTICE, TWO_PLACES_NOTICE, UPDATES_CONSENT_NOTICE, usedBefore, WHATS_NEW_NOTICE, type NoticeFacts } from "./notices";

let storage: Map<string, string>, session: Map<string, string>;
beforeEach(() => {
  storage = new Map(); session = new Map();
  vi.stubGlobal("localStorage", { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value) });
  vi.stubGlobal("sessionStorage", { getItem: (key: string) => session.get(key) ?? null, setItem: (key: string, value: string) => session.set(key, value) });
});
afterEach(() => vi.unstubAllGlobals());

const record = (hintsSeen: string[] = []): OnboardingStatus => ({ ...EMPTY_ONBOARDING, completedAt: "2026-09-01", version: 1, hintsSeen });
const facts = (intro: boolean | null, trial: boolean | null, cloud: boolean | null, star: boolean | null, _launch: boolean | null = false, popup: boolean | null = false,
  consent: boolean | null = false, simple: boolean | null = false, _boat: boolean | null = false, two: boolean | null = false, _grok: boolean | null = false, _modelgo: boolean | null = false,
  phone: boolean | null = false): NoticeFacts =>
  ({ [PHONE_UPDATE_NOTICE]: phone, [SIMPLE_MODE_NOTICE]: simple, [WHATS_NEW_NOTICE]: popup, [UPDATES_CONSENT_NOTICE]: consent, [TWO_PLACES_NOTICE]: two, [CLOUD_INTRO]: intro, [CLOUD_TRIAL_NOTICE]: trial, [CLOUD_NOTICE]: cloud, [STAR_NOTICE]: star });
const none = () => false;
const DAY = 86_400_000, NOON = new Date(2026, 9, 9, 12).getTime();

it("is one queue: the Simple mode popup first, then What's new, the product-updates question, the launch card, the card after the update, the trial's notice, the My Cloud card, the star", () => {
  expect(nextNotice(facts(true, true, true, true, true, true, true, true), none)).toBe(SIMPLE_MODE_NOTICE);
  expect(nextNotice(facts(true, true, true, true, true, true, true, null), none), "nothing shows while the Simple mode popup waits").toBeNull();
  expect(nextNotice(facts(true, true, true, true, true, true, true, true), id => id === SIMPLE_MODE_NOTICE)).toBe(WHATS_NEW_NOTICE);
  expect(NOTICES).toEqual([PHONE_UPDATE_NOTICE, SIMPLE_MODE_NOTICE, WHATS_NEW_NOTICE, UPDATES_CONSENT_NOTICE, TWO_PLACES_NOTICE, CLOUD_INTRO, CLOUD_TRIAL_NOTICE, CLOUD_NOTICE, STAR_NOTICE]);
  expect(nextNotice(facts(true, true, true, true, true, false, false, false, false, true), none), "bots in two places come before any promotion").toBe(TWO_PLACES_NOTICE);
  expect(nextNotice(facts(true, true, true, true, true, false, true, false, false, true), none), "after the product-updates question").toBe(UPDATES_CONSENT_NOTICE);
  expect(nextNotice(facts(true, true, true, true, true, false, false, false, false, null), none), "nothing lower shows while main hasn't answered").toBeNull();
  expect(nextNotice(facts(true, true, true, true, true, true, true), none)).toBe(WHATS_NEW_NOTICE);
  expect(nextNotice(facts(true, true, true, true, true, true, true), id => id === WHATS_NEW_NOTICE)).toBe(UPDATES_CONSENT_NOTICE);
  expect(nextNotice(facts(true, true, true, true, true, null, true), none)).toBeNull();
  expect(nextNotice(facts(true, true, true, true, true, false, null), none)).toBeNull();
  expect(WHATS_NEW_NOTICE).toBe("whats-new-2026-11");
  expect(nextNotice(facts(true, true, true, true, true, true), none)).toBe(WHATS_NEW_NOTICE);
  expect(nextNotice(facts(true, true, true, true, true, null), none)).toBeNull();
  expect(nextNotice(facts(true, true, true, true, true, true), id => id === WHATS_NEW_NOTICE)).toBe(CLOUD_INTRO);
  expect(CLOUD_INTRO).toBe("cloud-trial-intro-v1");
  expect(nextNotice(facts(true, true, true, true), none)).toBe(CLOUD_INTRO);
  expect(nextNotice(facts(false, true, true, true), none)).toBe(CLOUD_TRIAL_NOTICE);
  expect(nextNotice(facts(false, false, true, true), none)).toBe(CLOUD_NOTICE);
  expect(nextNotice(facts(false, false, false, true), none)).toBe(STAR_NOTICE);
  expect(nextNotice(facts(true, true, true, true), id => id === CLOUD_INTRO || id === STAR_NOTICE)).toBe(CLOUD_TRIAL_NOTICE);
  expect(nextNotice(facts(true, true, true, true), () => true)).toBeNull();
  expect(nextNotice(facts(false, false, false, false), none)).toBeNull();
});

it("What's new is the one notice the desktop keeps for its every page", () => {
  expect(DESKTOP_NOTICES).toEqual([WHATS_NEW_NOTICE]);
});

it("one notice a launch: What's new goes first and the star waits for a later launch; only the product-updates question may follow", () => {
  const both = facts(false, false, false, true, false, true);
  expect(nextNotice(both, none)).toBe(WHATS_NEW_NOTICE);
  expect(NOTICES.indexOf(WHATS_NEW_NOTICE), "What's new comes before the star").toBeLessThan(NOTICES.indexOf(STAR_NOTICE));
  expect([...FOLLOWERS], "the only notice that may follow another in its launch").toEqual([UPDATES_CONSENT_NOTICE]);
  expect(nextNotice(both, id => id === WHATS_NEW_NOTICE, WHATS_NEW_NOTICE), "What's new closed: nothing else this launch").toBeNull();
  expect(nextNotice(facts(false, false, false, true, false, true, true, false, true), id => id === WHATS_NEW_NOTICE, WHATS_NEW_NOTICE), "but the question may follow")
    .toBe(UPDATES_CONSENT_NOTICE);
  expect(nextNotice(both, none, WHATS_NEW_NOTICE), "a reload while it is up shows it again").toBe(WHATS_NEW_NOTICE);
  expect(nextNotice(both, id => id === WHATS_NEW_NOTICE), "the next launch").toBe(STAR_NOTICE);
  expect(nextNotice(facts(false, null, false, true), none, STAR_NOTICE), "a notice this launch didn't take never holds it back").toBe(STAR_NOTICE);
});

it("a launch keeps the notice it showed first for the window's session; storage that throws keeps it for the page", () => {
  expect(launchNotice()).toBeNull();
  markLaunchNotice(WHATS_NEW_NOTICE); markLaunchNotice(STAR_NOTICE);
  expect(launchNotice()).toBe(WHATS_NEW_NOTICE);
  expect(session.get("odb.launch.notice")).toBe(WHATS_NEW_NOTICE);
  session.set("odb.launch.notice", "something-else");
  expect(launchNotice(), "only a notice of the list").toBeNull();
  vi.stubGlobal("sessionStorage", { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); } });
  markLaunchNotice(STAR_NOTICE);
  expect(launchNotice()).toBe(STAR_NOTICE);
});

it("waits while an earlier notice's answer is unknown, so a later one never shows first", () => {
  expect(nextNotice(facts(null, false, false, true), none)).toBeNull();
  expect(nextNotice(facts(false, null, false, true), none)).toBeNull();
  expect(nextNotice(facts(null, false, false, true), id => id === CLOUD_INTRO)).toBe(STAR_NOTICE);
});

it("a dismissal holds on this device at once and in the workspace record for good", () => {
  const seen = record(["tour.done"]);
  expect(dismissNotice(seen, STAR_NOTICE)).toEqual({ onboarding: { hintsSeen: ["tour.done", STAR_NOTICE] } });
  expect(storage.get(STAR_NOTICE)).toBe("1");
  expect(noticeSeen(record(), STAR_NOTICE)).toBe(true);
  storage.clear();
  expect(noticeSeen(record(), STAR_NOTICE)).toBe(false);
  expect(noticeSeen(record([STAR_NOTICE]), STAR_NOTICE)).toBe(true);
  expect(dismissNotice(record([STAR_NOTICE]), STAR_NOTICE)).toBeNull();
  expect(withTourReset(record([CLOUD_INTRO, `${CLOUD_INTRO}:day-2`, STAR_NOTICE, "tour.done"]))).toEqual([CLOUD_INTRO, `${CLOUD_INTRO}:day-2`, STAR_NOTICE]);
});

it("browser storage that throws still leaves the workspace record in charge", () => {
  vi.stubGlobal("localStorage", { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); } });
  expect(noticeSeen(record(), STAR_NOTICE)).toBe(false);
  expect(noticeSeen(record([STAR_NOTICE]), STAR_NOTICE)).toBe(true);
  expect(dismissNotice(record(), STAR_NOTICE)).toEqual({ onboarding: { hintsSeen: [STAR_NOTICE] } });
  expect(introStage(record(), NOON)).toBe("due");
  expect(introShown(record(), NOON)).toEqual({ onboarding: { hintsSeen: [`${CLOUD_INTRO}:day-1`] } });
});

it("the card after the update shows at most once a calendar day, on at most three days, then counts as dismissed", () => {
  let hints: string[] = [];
  const show = (at: number) => { const patch = introShown(record(hints), at); if (patch) hints = patch.onboarding.hintsSeen; };
  expect(introStage(record(hints), NOON)).toBe("due");
  show(NOON);
  expect(hints).toEqual([`${CLOUD_INTRO}:day-1`]);
  expect(JSON.parse(storage.get(`${CLOUD_INTRO}:days`)!)).toEqual([localDay(NOON)]);
  expect(introStage(record(hints), NOON + 3 * 3600_000)).toBe("shown-today");
  expect(introShown(record(hints), NOON + 3 * 3600_000)).toBeNull();
  const midnight = new Date(2026, 9, 10, 0, 30).getTime();
  expect(introStage(record(hints), midnight)).toBe("due");
  show(midnight); show(NOON + 5 * DAY);
  expect(hints).toEqual([`${CLOUD_INTRO}:day-1`, `${CLOUD_INTRO}:day-2`, `${CLOUD_INTRO}:day-3`]);
  expect(introStage(record(hints), NOON + 5 * DAY + 3600_000)).toBe("shown-today");
  expect(introStage(record(hints), NOON + 6 * DAY)).toBe("done");
  storage.clear();
  expect(introStage(record(hints), NOON + 6 * DAY)).toBe("done");
  expect(introStage(record([`${CLOUD_INTRO}:day-3`]), NOON + 6 * DAY)).toBe("done");
  expect(introStage(record([`${CLOUD_INTRO}:day-2`]), NOON + 6 * DAY)).toBe("due");
  expect(introStage(record([CLOUD_INTRO]), NOON)).toBe("done");
  storage.set(CLOUD_INTRO, "1");
  expect(introStage(record(), NOON)).toBe("done");
});

it("someone who closed the earlier Pro card sees this one on one day only", () => {
  expect([...OLD_PRO_DISMISSALS]).toEqual(["pro-introduction-dismissed-v2", "pro-introduction-dismissed-v3"]);
  for (const earlier of OLD_PRO_DISMISSALS) {
    storage.clear();
    expect(introStage(record([earlier]), NOON)).toBe("due");
    const patch = introShown(record([earlier]), NOON)!;
    expect(introStage({ ...record(), hintsSeen: patch.onboarding.hintsSeen }, NOON + DAY)).toBe("done");
    storage.clear(); storage.set(earlier, "1");
    introShown(record(), NOON);
    expect(introStage(record(), NOON + DAY)).toBe("done");
  }
  storage.clear();
  introShown(record(["pro-introduction-dismissed"]), NOON);
  expect(introStage(record(["pro-introduction-dismissed"]), NOON + DAY)).toBe("due");
});

it("someone has used the app before when a conversation from before this launch has had a reply", () => {
  const launch = 1_000_000;
  const task = (createdAt: number, turns?: number) => ({ createdAt, ...(turns === undefined ? {} : { usage: { turns } }) });
  expect(usedBefore([], launch)).toBe(false);
  expect(usedBefore([{ tasks: [task(launch - 1, 1)] }], launch)).toBe(true);
  expect(usedBefore([{ tasks: [task(launch, 3)] }], launch)).toBe(false);
  expect(usedBefore([{ tasks: [task(launch - 1, 0), task(launch - 1)] }, {}], launch)).toBe(false);
  expect(usedBefore([{}, { tasks: [task(launch + 5, 2), task(launch - 9, 2)] }], launch)).toBe(true);
});


it("Update Delio on your phone goes first, ahead of every promotion", () => {
  const all = (phone: boolean | null, grok: boolean | null = false) => facts(true, true, true, true, true, true, true, true, true, true, grok, true, phone);
  expect(nextNotice(all(true), none)).toBe(PHONE_UPDATE_NOTICE);
  expect(nextNotice(all(null), none), "nothing lower while it is unknown").toBeNull();
  expect(nextNotice(all(false), none)).toBe(SIMPLE_MODE_NOTICE);
  expect(nextNotice(facts(false, false, false, true, false, false, false, false, false, false, false, false, true), none), "ahead of the star").toBe(PHONE_UPDATE_NOTICE);
});

it("an Update Delio on your phone dismissal is kept per phone, in short hints, all in one patch", () => {
  expect(phoneUpdateHint("0f8c2a41-1111-4222-8333-444455556666")).toBe("phone-app-update:0f8c2a41");
  expect(phoneUpdateHint("0f8c2a41-1111-4222-8333-444455556666").length).toBeLessThanOrEqual(60);
  const ids = [phoneUpdateHint("aaaaaaaa-1"), phoneUpdateHint("bbbbbbbb-2")];
  expect(dismissNotices(record(["star"]), ids)).toEqual({ onboarding: { hintsSeen: ["star", ...ids] } });
  for (const id of ids) expect(noticeSeen(undefined, id)).toBe(true);
  expect(dismissNotices(record(ids), ids), "nothing new").toBeNull();
  expect(dismissNotices(record([ids[0]!]), [...ids, ids[1]!])).toEqual({ onboarding: { hintsSeen: ids } });
});

