import { useSyncExternalStore } from "react";

/** What the person is about to send: the bot's name and the conversation as they see it. */
export interface ProblemReportDraft { bot: string; transcript: string }

let draft: ProblemReportDraft | null = null;
const listeners = new Set<() => void>();
const publish = () => { for (const listener of Array.from(listeners)) listener(); };

export function openProblemReport(next: ProblemReportDraft): void {
  draft = next;
  publish();
}

export function closeProblemReport(): void {
  draft = null;
  publish();
}

export function useProblemReportDraft(): ProblemReportDraft | null {
  return useSyncExternalStore((listener) => { listeners.add(listener); return () => { listeners.delete(listener); }; }, () => draft, () => null);
}
