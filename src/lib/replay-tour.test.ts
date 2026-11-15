import { describe, expect, it } from "vitest";

import { TOUR_STEPS } from "./guided-tour";
import { AUTO_TOUR_SINCE, replayTourPatch, shouldAutoStartTour } from "./replay-tour";
import { EMPTY_ONBOARDING } from "./onboarding";

const done = (completedAt: string, hintsSeen: string[] = []) => ({ ...EMPTY_ONBOARDING, completedAt, version: 1, hintsSeen });
const after = new Date(AUTO_TOUR_SINCE + 60_000).toISOString();

describe("the guided tour for new people", () => {
  it("starts by itself once someone new finishes setup", () => {
    expect(shouldAutoStartTour(done(after))).toBe(true);
  });

  it("does not start before setup is done, for people who set up earlier, or once any step was seen", () => {
    expect(shouldAutoStartTour(undefined)).toBe(false);
    expect(shouldAutoStartTour(done("2026-09-01"))).toBe(false);
    expect(shouldAutoStartTour(done(after, [TOUR_STEPS[0]!.id]))).toBe(false);
    expect(shouldAutoStartTour(done(after, ["tour.done"]))).toBe(false);
  });

  it("starts over from the first step when replayed", () => {
    const patch = replayTourPatch(done(after, [TOUR_STEPS[0]!.id, "other-hint"]));
    expect(patch.onboarding.hintsSeen).toEqual(["other-hint"]);
  });
});
