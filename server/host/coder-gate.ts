import type { BotRecord } from "../store.ts";
import type { HostTurnResult } from "../coordinator.ts";
import { noticeTool } from "../chat-notices.ts";
import { detectChecks as detectChecksIn, failureMessage, runChecks as runChecksIn, type CheckRun } from "../coder/verify.ts";
import { parseReview, reviewFixMessage, reviewPrompt } from "../coder/review.ts";
import { startWhenFree } from "./start-when-free.ts";
import { coderOn } from "../coder/settings.ts";

export const DEFAULT_CODER_ROUNDS = 3;
export const MAX_CODER_ROUNDS = 6;
export const MAX_REVIEW_ROUNDS = 2;
const GOAL_CHECK_WAIT_MS = 15 * 60_000;

type Coder = NonNullable<BotRecord["coder"]>;
type Row = ReturnType<typeof noticeTool<{ ok: boolean }>>;

export interface CoderGateDeps {
  bot(botId: string): BotRecord | undefined;
  /** What the person last asked in this conversation. */
  request(threadId: string): string;
  append(threadId: string, tool: Row): void;
  startTurn(botId: string, text: string, opts: { threadId: string; cardContinuation?: true; unattended?: boolean; onSettled?: (outcome: HostTurnResult) => void }): Promise<unknown>;
  /** A new conversation on this bot that runs on the reviewing engine, in the same folder. */
  openReviewThread(botId: string, review: NonNullable<Coder["review"]>, cwd: string): string | null;
  diffText(botId: string, cwd: string, fromHash: string): Promise<string | null>;
  detectChecks?: (cwd: string) => string[];
  runChecks?: (cwd: string, commands: readonly string[]) => Promise<CheckRun>;
  /** The project's checks just passed: worth remembering for its next conversations. */
  checksPassed?: (cwd: string, commands: readonly string[]) => void;
  /** A goal drives this conversation: the checks' outcome waits for its next step instead of starting a turn. */
  inGoal?: (threadId: string) => boolean;
  sleep?: (ms: number) => Promise<void>;
}

export interface CoderTurn {
  botId: string;
  threadId: string;
  cwd: string;
  /** The folder as it was before this turn. */
  fromHash: string;
  changedFiles: number;
  succeeded?: boolean;
}

type ThreadState = { round: number; reviewRound: number; baseHash: string; request: string };

/** Coder mode: after a turn that changed files, run the project's checks and send failures back to the bot, up to its
 * rounds; once they pass, have another engine review the whole change and send its fixes back the same way. */
export function createCoderGate(deps: CoderGateDeps) {
  const detect = deps.detectChecks ?? detectChecksIn;
  const run = deps.runChecks ?? runChecksIn;
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const states = new Map<string, ThreadState>();
  const continuing = new Set<string>();
  const reviewThreads = new Set<string>();
  const goalChecks = new Map<string, Promise<void>>();
  const goalChecksDone = new Map<string, () => void>();
  const goalNotes = new Map<string, string>();
  const endGoalCheck = (threadId: string) => {
    const done = goalChecksDone.get(threadId);
    goalChecksDone.delete(threadId);
    goalChecks.delete(threadId);
    done?.();
  };
  const row = (threadId: string, key: Parameters<typeof noticeTool>[0], params: Record<string, string>, ok: boolean) =>
    deps.append(threadId, noticeTool(key, params, { ok }));

  const continueTurn = (botId: string, threadId: string, text: string): Promise<boolean> => startWhenFree(
    () => deps.startTurn(botId, text, { threadId, cardContinuation: true }),
    { sleep, onAttempt: () => continuing.add(threadId), onRefused: () => continuing.delete(threadId) },
  );

  async function review(bot: BotRecord, coder: Coder, threadId: string, cwd: string, state: ThreadState, checks: readonly string[]): Promise<void> {
    const reviewer = coder.review!;
    const diff = await deps.diffText(bot.id, cwd, state.baseHash);
    if (!diff?.trim()) { states.delete(threadId); return; }
    const reviewThread = deps.openReviewThread(bot.id, reviewer, cwd);
    if (!reviewThread) { states.delete(threadId); return; }
    reviewThreads.add(reviewThread);
    row(threadId, "chat.notice.coderReviewing", { reviewer: reviewer.model }, true);
    const settled = new Promise<HostTurnResult>((resolve) => {
      deps.startTurn(bot.id, reviewPrompt({ request: state.request, diff, checks, ...(coder.previewUrl ? { previewUrl: coder.previewUrl } : {}) }), {
        threadId: reviewThread, unattended: true, onSettled: resolve,
      }).catch(() => resolve({ ok: false, text: "" } as HostTurnResult));
    });
    const outcome = await settled;
    if (!outcome.ok) { row(threadId, "chat.notice.coderReviewFailed", { reviewer: reviewer.model }, false); states.delete(threadId); return; }
    const verdict = parseReview(outcome.text ?? "");
    if (verdict.verdict === "approve") {
      row(threadId, "chat.notice.coderReviewApproved", { reviewer: reviewer.model }, true);
      states.delete(threadId);
      return;
    }
    state.reviewRound += 1;
    row(threadId, "chat.notice.coderReviewChanges", { reviewer: reviewer.model }, false);
    if (!(await continueTurn(bot.id, threadId, reviewFixMessage(reviewer.model, verdict.notes)))) states.delete(threadId);
  }

  async function checkForGoal(turn: CoderTurn, coder: Coder): Promise<void> {
    const commands = coder.verify?.length ? coder.verify : detect(turn.cwd);
    if (!commands.length) return;
    row(turn.threadId, "chat.notice.coderChecking", { checks: commands.join(", ") }, true);
    const result = await run(turn.cwd, commands);
    if (result.ok) {
      row(turn.threadId, "chat.notice.coderPassed", { checks: commands.join(", ") }, true);
      deps.checksPassed?.(turn.cwd, commands);
      goalNotes.set(turn.threadId, `Deliobot ran this project's checks after your last step and they passed (${commands.join(", ")}).`);
      return;
    }
    const failed = result.results.filter((one) => !one.ok).map((one) => one.command).join(", ");
    row(turn.threadId, "chat.notice.coderGoalFailed", { failed }, false);
    goalNotes.set(turn.threadId, failureMessage(result, 1, 1, { goalStep: true }));
  }

  return {
    /** Before a goal's next step: waits for the checks of the step that just ended, and says how they went. */
    async beforeGoalStep(threadId: string): Promise<string> {
      const pending = goalChecks.get(threadId);
      if (pending) await Promise.race([pending, sleep(GOAL_CHECK_WAIT_MS)]);
      const note = goalNotes.get(threadId) ?? "";
      goalNotes.delete(threadId);
      return note;
    },

    /** A goal's turn just ended with a snapshot of its folder: its next step waits for the checks of this one. */
    expectChecks(threadId: string): void {
      if (!deps.inGoal?.(threadId) || goalChecks.has(threadId)) return;
      goalChecks.set(threadId, new Promise<void>((resolve) => goalChecksDone.set(threadId, resolve)));
    },

    /** The turn's digest ended without handing the turn to the gate. */
    releaseChecks(threadId: string): void {
      if (goalChecksDone.has(threadId)) endGoalCheck(threadId);
    },

    /** Whether this conversation is one the gate opened for a review. */
    isReviewThread: (threadId: string) => reviewThreads.has(threadId),

    async afterTurn(turn: CoderTurn): Promise<void> {
      if (reviewThreads.has(turn.threadId)) return;
      const bot = deps.bot(turn.botId);
      const coder: Coder = bot?.coder ?? { enabled: true };
      if (!bot || !coderOn(coder)) return;
      if (deps.inGoal?.(turn.threadId)) {
        try {
          if (turn.changedFiles > 0 && turn.succeeded !== false) await checkForGoal(turn, coder);
        } finally {
          endGoalCheck(turn.threadId);
        }
        return;
      }
      const mine = continuing.delete(turn.threadId);
      let state = states.get(turn.threadId);
      if (!mine || !state) {
        if (turn.changedFiles === 0) return;
        state = { round: 0, reviewRound: 0, baseHash: turn.fromHash, request: deps.request(turn.threadId) };
        states.set(turn.threadId, state);
      }
      if (turn.succeeded === false) { states.delete(turn.threadId); return; }
      const commands = coder.verify?.length ? coder.verify : detect(turn.cwd);
      if (commands.length) {
        row(turn.threadId, "chat.notice.coderChecking", { checks: commands.join(", ") }, true);
        const result = await run(turn.cwd, commands);
        if (!result.ok) {
          const max = Math.min(MAX_CODER_ROUNDS, Math.max(1, coder.maxRounds ?? DEFAULT_CODER_ROUNDS));
          const failed = result.results.filter((one) => !one.ok).map((one) => one.command).join(", ");
          state.round += 1;
          if (state.round > max) {
            row(turn.threadId, "chat.notice.coderGaveUp", { failed, max: String(max) }, false);
            states.delete(turn.threadId);
            return;
          }
          row(turn.threadId, "chat.notice.coderFailed", { failed, round: String(state.round), max: String(max) }, false);
          if (!(await continueTurn(bot.id, turn.threadId, failureMessage(result, state.round, max)))) states.delete(turn.threadId);
          return;
        }
        row(turn.threadId, "chat.notice.coderPassed", { checks: commands.join(", ") }, true);
        deps.checksPassed?.(turn.cwd, commands);
      }
      if (coder.review && state.reviewRound < MAX_REVIEW_ROUNDS) return review(bot, coder, turn.threadId, turn.cwd, state, commands);
      states.delete(turn.threadId);
    },
  };
}
