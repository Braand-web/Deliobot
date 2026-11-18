// Security invariant: the reviewer can only let a send skip its card when it clearly matches one of the person's own
// "allow without asking" rules and none of their "always ask" rules; any failure, timeout or doubt keeps the card. It
// reads the action, the recipient and a short cut of the text, never a key or a file. A payment never reaches it.
import type { OutboundDraft } from "../shared/outbound.ts";
import type { Decider } from "./decider/index.ts";
import { clean } from "./records-block.ts";

export const REVIEW_TIMEOUT_MS = 4_000;
/** How sure the reviewer must be before a send skips its card. */
export const REVIEW_CONFIDENCE = 0.8;

export const REVIEW_INSTRUCTIONS = {
  ask: "A bot wants to send `action` on the person's behalf. `allow_without_asking` and `always_ask` are the person's own rules. "
    + "Choose allow only when the action clearly matches an allow_without_asking rule and matches no always_ask rule; otherwise choose ask.",
  allow: "A bot wants to send `action` on the person's behalf. The person lets sends go without asking, except what their `always_ask` rules name. "
    + "Choose ask when the action could match an always_ask rule; choose allow only when it clearly matches none.",
} as const;

export interface ReviewInput {
  /** What the bot's setting does without the rules: ask for every send, or send without asking. */
  base: "ask" | "allow";
  allowRules: readonly string[];
  askRules: readonly string[];
  actions: ReadonlyArray<{ app: string | null; label: string }>;
  drafts: readonly OutboundDraft[];
}

export type OutboundReview = (input: ReviewInput) => Promise<"allow" | "ask">;

export function createOutboundReview(decider: Pick<Decider, "choose">, ready: () => boolean): OutboundReview {
  return async (input) => {
    if (!ready() || (input.base === "ask" ? input.allowRules.length === 0 : input.askRules.length === 0)) return input.base === "allow" && input.askRules.length === 0 ? "allow" : "ask";
    const state = {
      action: input.actions.map((action) => clean(action.app ? `${action.app}: ${action.label}` : action.label, 120)),
      recipients: input.drafts.flatMap((draft) => (draft.to ? [clean(draft.to, 200)] : [])),
      subjects: input.drafts.flatMap((draft) => (draft.subject ? [clean(draft.subject, 200)] : [])),
      text_start: input.drafts.flatMap((draft) => (draft.body ? [clean(draft.body, 300)] : [])),
      allow_without_asking: input.allowRules.map((rule) => clean(rule, 200)),
      always_ask: input.askRules.map((rule) => clean(rule, 200)),
    };
    const result = await decider.choose("botDecide", state, {
      instructions: REVIEW_INSTRUCTIONS[input.base],
      options: { allow: "The person's rules let this send go without asking", ask: "Ask the person first" },
    }, { timeoutMs: REVIEW_TIMEOUT_MS }).catch(() => null);
    return result?.ok && result.answers.choice === "allow" && result.answers.pTop >= REVIEW_CONFIDENCE ? "allow" : "ask";
  };
}
