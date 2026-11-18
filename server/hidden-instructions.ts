// Content a bot reads (an e-mail, a document, a chat) that talks to the bot itself, trying to steer it. Only clear
// override wording counts, so ordinary text about AI or instructions does not raise the notice.
import { describeTool } from "./activity.ts";
import { chatNotice, noticeTool } from "./chat-notices.ts";
import { serviceSlugFor } from "./connector-verdict.ts";

const PATTERNS: readonly RegExp[] = [
  /\b(?:ignore|disregard|forget|override)\s+(?:all\s+|any\s+|the\s+|your\s+)?(?:previous|prior|above|earlier|preceding|existing|original)\s+(?:instructions|prompts?|messages|rules|directions|guidelines)/i,
  /\b(?:ignore|disregard|forget|override)\s+(?:all\s+|any\s+)?(?:your|the)\s+(?:system\s+)?(?:instructions|prompt|rules|guidelines)/i,
  /\b(?:new|updated|real)\s+(?:system\s+)?instructions?\s*(?:for\s+(?:the\s+)?(?:ai|assistant|agent|bot))?\s*:/i,
  /\b(?:ai|assistant|agent|bot|llm)s?\s*[,:]\s*(?:please\s+)?(?:ignore|disregard|you\s+must|do\s+not\s+tell)/i,
  /\bdo\s+not\s+(?:tell|inform|mention\s+(?:this\s+)?to|alert|notify)\s+(?:the\s+)?(?:user|person|owner|human)/i,
  /\b(?:reveal|print|show|repeat)\s+(?:your|the)\s+system\s+prompt/i,
  /\bignore[rz]?\s+(?:toutes?\s+)?(?:les\s+|vos\s+|tes\s+)?(?:instructions|consignes|règles)\s+(?:précédentes|ci-dessus|antérieures)/i,
  /\bne\s+(?:le\s+)?(?:dis|dites)\s+pas\s+(?:à|a)\s+l['’]utilisateur/i,
];
const READ_LIMIT = 512 * 1024;
export const HIDDEN_NOTICE_EVERY_MS = 30 * 60_000;

/** `text` with control and invisible formatting characters turned into spaces. */
function printable(text: string): string {
  return [...text].map((char) => {
    const code = char.codePointAt(0)!;
    return code < 0x20 || code === 0x7f || (code >= 0x200b && code <= 0x200f) || (code >= 0x2028 && code <= 0x202e) ? " " : char;
  }).join("");
}

/** The words that tried to steer the bot, cut to a short line, or null when the text holds none. */
export function hiddenInstruction(text: string): string | null {
  for (const pattern of PATTERNS) {
    const match = pattern.exec(text);
    if (!match) continue;
    const start = Math.max(0, match.index - 20);
    const line = printable(text.slice(start, match.index + match[0].length + 80).replace(/\\[nrt]/g, " ")).replace(/\s+/g, " ").trim();
    return line.length > 160 ? `${line.slice(0, 159)}…` : line;
  }
  return null;
}

/** Tells a conversation, once in a while, that what an app returned tried to give its bot instructions. */
export function createHiddenInstructionNotice(deps: { append(threadId: string, tool: ReturnType<typeof hiddenInstructionTool>): void; now?: () => number }) {
  const now = deps.now ?? Date.now;
  const told = new Map<string, number>();
  return {
    observe(call: { threadId: string; slugs: readonly string[]; bytes: Uint8Array }): void {
      const excerpt = hiddenInstruction(Buffer.from(call.bytes.subarray(0, READ_LIMIT)).toString("utf8"));
      if (!excerpt) return;
      if (now() - (told.get(call.threadId) ?? -Infinity) < HIDDEN_NOTICE_EVERY_MS) return;
      told.set(call.threadId, now());
      const slug = call.slugs.find((one) => serviceSlugFor(one));
      deps.append(call.threadId, hiddenInstructionTool(slug ? describeTool(slug).app ?? "An app" : "An app", excerpt));
    },
  };
}

export function hiddenInstructionTool(app: string, excerpt: string) {
  return { ...noticeTool("chat.notice.hiddenInstructions", { app, excerpt }, { ok: false, hiddenInstruction: true }), name: `notice: ${chatNotice("chat.notice.hiddenInstructions", { app, excerpt })}` };
}
