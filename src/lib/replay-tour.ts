import { completionPatch, type OnboardingStatus } from "@/lib/onboarding";
import { TOUR_STEPS, withTourReset } from "@/lib/guided-tour";

/** The guided tour starts by itself once, for someone who finished first-run setup on or after this day. */
export const AUTO_TOUR_SINCE = Date.UTC(2026, 10, 15);

/** True for a new person who finished setup and has seen no step of the tour yet. */
export function shouldAutoStartTour(record: OnboardingStatus | undefined, since = AUTO_TOUR_SINCE): boolean {
  const finished = Date.parse(record?.completedAt ?? "");
  if (!Number.isFinite(finished) || finished < since) return false;
  const seen = new Set(record?.hintsSeen ?? []);
  return !TOUR_STEPS.some((step) => seen.has(step.id));
}

/** The config patch that starts the tour over from its first step. */
export function replayTourPatch(record: OnboardingStatus | undefined) {
  return { onboarding: { ...(!record?.completedAt ? completionPatch().onboarding : {}), hintsSeen: withTourReset(record) } };
}
