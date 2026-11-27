// For every engine: a turn that ends saying it is doing something now ("Je lance la publication maintenant",
// "I'm publishing it now") yet used no tool did nothing. Some models (seen with Mistral Vibe) write the action as
// text and stop; the bot is asked once, in the same thread, to do it with its tools or say what stops it.
import type { Message } from "./store.ts";

const FRENCH = /\b(je (lance|publie|poste|mets en ligne|m'en occupe|m’en occupe|commence|démarre|ouvre|envoie|télécharge|t[ée]l[ée]verse|reprends|continue|m'y mets|m’y mets|vais (maintenant )?(publier|poster|lancer|ouvrir|envoyer|m'en occuper|m’en occuper|faire|mettre en ligne))|c'est parti|c’est parti|publication en cours|en cours de publication)\b/iu;
const ENGLISH = /\b(i('m| am) (now )?(publishing|posting|uploading|launching|starting|opening|sending|doing it|on it|working on it)|i('ll| will) (now )?(publish|post|upload|launch|start|open|send|do it|go ahead)|let me (now )?(publish|post|upload|open|launch|start|do)|starting now|on it now)\b/iu;

/** The reply announces an action it is taking now and asks the person nothing. */
export function announcesAction(reply: string): boolean {
  const text = reply.trim();
  if (!text || /\?\s*$/u.test(text)) return false;
  return FRENCH.test(text) || ENGLISH.test(text);
}

/** A tool line of the turn (a page, a command, a file, an app call) means the bot acted. */
export function turnActed(lines: readonly Pick<Message, "role" | "kind" | "turnId">[], turnId: string): boolean {
  return lines.some((line) => line.turnId === turnId && line.role === "bot" && line.kind === "activity");
}

export const PROMISED_ACTION_TEXT =
  "Your last reply said you were doing the task now, but you called no tool, so nothing happened. Do it now with your tools (the browser, the computer, files, connected apps), step by step, and check the result before you say it is done. If something stops you, say exactly what and what the person must do. Do not announce the action again without doing it.";

export interface PromisedActionRescueDeps {
  activePath(threadId: string): readonly Message[];
  threadBusy(botId: string, threadId: string): boolean;
  threadQueued(botId: string, threadId: string): boolean;
  continueRequest(botId: string, threadId: string, text: string): Promise<unknown>;
  later?(run: () => void, ms: number): void;
  log?(line: string): void;
}

const SETTLE_MS = 1_500;

export function createPromisedActionRescue(deps: PromisedActionRescueDeps) {
  const later = deps.later ?? ((run: () => void, ms: number) => { setTimeout(run, ms).unref?.(); });
  /** Each thread's last person line a rescue was sent for: once a request, so a model that only narrates is not looped. */
  const rescued = new Map<string, string>();
  return {
    turnEnded(botId: string, threadId: string, turnId: string, reply: string): boolean {
      const path = deps.activePath(threadId);
      const asked = path.findLast((line) => line.role === "user")?.id;
      if (!asked || rescued.get(threadId) === asked) return false;
      if (!announcesAction(reply) || turnActed(path, turnId)) return false;
      rescued.set(threadId, asked);
      if (rescued.size > 500) rescued.delete(rescued.keys().next().value!);
      const endedAt = Date.now();
      later(() => {
        if (deps.activePath(threadId).some((line) => line.role === "user" && line.at > endedAt)) return;
        if (deps.threadBusy(botId, threadId) || deps.threadQueued(botId, threadId)) return;
        deps.log?.(`promised action: ${botId} announced an action in ${threadId} without a tool; asked once to do it`);
        deps.continueRequest(botId, threadId, PROMISED_ACTION_TEXT).catch((error: unknown) =>
          deps.log?.(`promised action: the follow-up could not start (${error instanceof Error ? error.message : String(error)})`));
      }, SETTLE_MS);
      return true;
    },
  };
}
