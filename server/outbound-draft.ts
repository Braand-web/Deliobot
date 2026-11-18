import type { OutboundDraft } from "../shared/outbound.ts";

const TO_KEYS = ["recipient_email", "to", "to_email", "recipients", "recipient", "email", "channel", "chat_id", "phone_number", "to_number", "username"];
const CC_KEYS = ["cc", "cc_emails", "extra_recipients"];
const SUBJECT_KEYS = ["subject", "title"];
const BODY_KEYS = ["body", "text", "message", "message_body", "content", "markdown_text", "caption", "comment"];
export const DRAFT_BODY_LIMIT = 6_000;

function words(value: unknown): string | undefined {
  if (typeof value === "string") return value.trim() || undefined;
  if (typeof value === "number") return String(value);
  if (Array.isArray(value)) {
    const parts = value.flatMap((item) => (typeof item === "string" && item.trim() ? [item.trim()] : []));
    return parts.length ? parts.join(", ") : undefined;
  }
  return undefined;
}

function first(args: Record<string, unknown>, keys: readonly string[]): string | undefined {
  for (const key of keys) {
    const found = words(args[key]);
    if (found) return found;
  }
  return undefined;
}

/** Who a send goes to, its subject and text, and the files it uploads, read from its arguments; null when it names
 * neither a recipient nor a text. */
export function outboundDraft(
  app: string | null,
  args: unknown,
  files?: ReadonlyArray<{ name: string; bytes: number }>,
): OutboundDraft | null {
  const record = args && typeof args === "object" && !Array.isArray(args) ? (args as Record<string, unknown>) : {};
  const to = first(record, TO_KEYS);
  const cc = first(record, CC_KEYS);
  const subject = first(record, SUBJECT_KEYS);
  const body = first(record, BODY_KEYS);
  if (!to && !body) return null;
  return {
    app,
    ...(to ? { to: cc ? `${to} (cc ${cc})` : to } : {}),
    ...(subject ? { subject: subject.slice(0, 300) } : {}),
    ...(body ? { body: body.length > DRAFT_BODY_LIMIT ? `${body.slice(0, DRAFT_BODY_LIMIT)}…` : body } : {}),
    ...(files?.length ? { files: files.map(({ name, bytes }) => ({ name, bytes })) } : {}),
  };
}

const EDIT_LIMIT = 20_000;

/** The person's own version of a draft, as a card answer carries it; null for anything else. */
export function editedDraft(value: unknown): { subject?: string; body?: string } | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const { subject, body } = value as Record<string, unknown>;
  const clean = (text: unknown) => (typeof text === "string" && text.trim() ? text.slice(0, EDIT_LIMIT) : undefined);
  const edited = { ...(clean(subject) ? { subject: clean(subject) } : {}), ...(clean(body) ? { body: clean(body) } : {}) };
  return edited.subject || edited.body ? edited : null;
}

/** What the bot reads when the person edited the draft instead of sending it. */
export function editedRefusal(edited: { subject?: string; body?: string }): string {
  const lines = [
    "Deliobot did not send this: the person edited it first.",
    "Send it again with the person's version below, exactly as written, changing nothing else; it will ask them once more.",
  ];
  if (edited.subject) lines.push(`Subject: ${edited.subject}`);
  if (edited.body) lines.push(`Text:\n${edited.body}`);
  return lines.join("\n");
}
