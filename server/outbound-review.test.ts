import { describe, expect, it, vi } from "vitest";

import { isPaymentTool, normalizeOutboundPolicy, OUTBOUND_RULES_MAX } from "../shared/outbound.ts";
import type { Decider } from "./decider/index.ts";
import { REVIEW_CONFIDENCE, createOutboundReview, type ReviewInput } from "./outbound-review.ts";

const input = (over: Partial<ReviewInput> = {}): ReviewInput => ({
  base: "ask", allowRules: ["Replies on WhatsApp to my team"], askRules: [], actions: [{ app: "WhatsApp", label: "Send message" }],
  drafts: [{ app: "WhatsApp", to: "+221700000000", body: "On se voit à 15 h" }], ...over,
});
const decider = (choice: string, pTop: number) => {
  const choose = vi.fn(async () => ({ ok: true as const, provider: "jev" as const, latencyMs: 1, answers: { type: "choice" as const, choice, pTop, margin: 0.5, probabilities: {} } }));
  return { choose, decider: { choose } as unknown as Pick<Decider, "choose"> };
};

describe("the send reviewer", () => {
  it("lets a send skip its card only when it is sure the person's allow rule covers it", async () => {
    expect(await createOutboundReview(decider("allow", 0.95).decider, () => true)(input())).toBe("allow");
    expect(await createOutboundReview(decider("allow", REVIEW_CONFIDENCE - 0.1).decider, () => true)(input())).toBe("ask");
    expect(await createOutboundReview(decider("ask", 0.99).decider, () => true)(input())).toBe("ask");
  });

  it("asks when it cannot review: no helper, no rule, or a failed call", async () => {
    const sure = decider("allow", 0.99);
    expect(await createOutboundReview(sure.decider, () => false)(input())).toBe("ask");
    expect(await createOutboundReview(sure.decider, () => true)(input({ allowRules: [] }))).toBe("ask");
    const broken = { choose: vi.fn(async () => { throw new Error("down"); }) } as unknown as Pick<Decider, "choose">;
    expect(await createOutboundReview(broken, () => true)(input())).toBe("ask");
  });

  it("under send-without-asking, holds a send its always-ask rule names, and lets others go", async () => {
    const allowing = input({ base: "allow", allowRules: [], askRules: ["Anything to a customer"] });
    expect(await createOutboundReview(decider("ask", 0.9).decider, () => true)(allowing)).toBe("ask");
    expect(await createOutboundReview(decider("allow", 0.9).decider, () => true)(allowing)).toBe("allow");
    expect(await createOutboundReview(decider("allow", 0.9).decider, () => false)(allowing)).toBe("ask");
    expect(await createOutboundReview(decider("ask", 0.9).decider, () => true)(input({ base: "allow", allowRules: [], askRules: [] }))).toBe("allow");
  });

  it("shows the reviewer the action, the recipient, a cut of the text and the rules, nothing else", async () => {
    const seen = decider("ask", 0.9);
    await createOutboundReview(seen.decider, () => true)(input({ drafts: [{ app: "Gmail", to: "ana@example.com", subject: "Facture", body: "x".repeat(1000), files: [{ name: "secret.pdf", bytes: 5 }] }] }));
    const state = (seen.choose.mock.calls[0] as unknown[])[1] as Record<string, unknown>;
    expect(Object.keys(state).sort()).toEqual(["action", "allow_without_asking", "always_ask", "recipients", "subjects", "text_start"]);
    expect(String((state.text_start as string[])[0]).length).toBeLessThanOrEqual(300);
    expect(JSON.stringify(state)).not.toContain("secret.pdf");
  });
});

describe("rules and payments in the stored policy", () => {
  it("keeps each list trimmed, without repeats or blanks, and at most its size", () => {
    const many = Array.from({ length: 20 }, (_, index) => `rule ${index}`);
    expect(normalizeOutboundPolicy({ policy: "ask", allowRules: [" a ", "a", "", 3], askRules: many, extra: true }))
      .toEqual({ policy: "ask", allowRules: ["a"], askRules: many.slice(0, OUTBOUND_RULES_MAX) });
    expect(normalizeOutboundPolicy({ policy: "allow" })).toEqual({ policy: "allow" });
  });

  it("knows which actions move money", () => {
    for (const tool of ["STRIPE_CREATE_REFUND", "PAYPAL_CREATE_PAYOUT", "SHOPIFY_CREATE_ORDER", "WISE_TRANSFER", "STRIPE_CHARGE_CUSTOMER"]) expect(isPaymentTool(tool), tool).toBe(true);
    for (const tool of ["GMAIL_SEND_EMAIL", "STRIPE_LIST_PAYMENTS", "SHOPIFY_GET_ORDER"]) expect(isPaymentTool(tool), tool).toBe(false);
  });
});
