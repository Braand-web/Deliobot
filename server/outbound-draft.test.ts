import { describe, expect, it } from "vitest";

import { DRAFT_BODY_LIMIT, editedDraft, editedRefusal, outboundDraft } from "./outbound-draft.ts";
import { outboundCard } from "./outbound-requests.ts";

describe("the draft a send card shows", () => {
  it("reads who an e-mail goes to, its subject, its text and the files it uploads", () => {
    expect(outboundDraft("Gmail", { recipient_email: "ana@example.com", cc: ["bo@example.com"], subject: "Facture", body: "Bonjour Ana" }, [{ name: "facture.pdf", bytes: 2048 }]))
      .toEqual({ app: "Gmail", to: "ana@example.com (cc bo@example.com)", subject: "Facture", body: "Bonjour Ana", files: [{ name: "facture.pdf", bytes: 2048 }] });
  });

  it("reads a chat message's channel and text, and cuts a very long text", () => {
    expect(outboundDraft("Slack", { channel: "#ventes", text: "x".repeat(DRAFT_BODY_LIMIT + 10) })).toMatchObject({ to: "#ventes", body: `${"x".repeat(DRAFT_BODY_LIMIT)}…` });
  });

  it("shows nothing for a send that names neither a recipient nor a text", () => {
    expect(outboundDraft("Stripe", { amount: 1000 })).toBeNull();
    expect(outboundDraft("Gmail", "not an object")).toBeNull();
  });

  it("puts each send's draft on the card", () => {
    const card = outboundCard([{ slug: "GMAIL_SEND_EMAIL", arguments: { to: "ana@example.com", subject: "Hello", body: "Hi" } }, { slug: "STRIPE_CREATE_REFUND", arguments: { amount: 5 } }]);
    expect(card.drafts).toEqual([{ app: "Gmail", to: "ana@example.com", subject: "Hello", body: "Hi" }]);
  });
});

describe("the person's own version", () => {
  it("keeps only a subject and a text, and nothing empty", () => {
    expect(editedDraft({ subject: "Nouvel objet", body: "Nouveau texte", to: "evil@example.com" })).toEqual({ subject: "Nouvel objet", body: "Nouveau texte" });
    expect(editedDraft({ body: "   " })).toBeNull();
    expect(editedDraft("text")).toBeNull();
  });

  it("tells the bot to send that version as written, and that it asks again", () => {
    const text = editedRefusal({ subject: "Objet", body: "Texte" });
    expect(text).toMatch(/edited it first/);
    expect(text).toMatch(/it will ask them once more/);
    expect(text).toContain("Subject: Objet");
    expect(text).toContain("Text:\nTexte");
  });
});
