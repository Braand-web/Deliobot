import { describeTool } from "./activity.ts";
import { chatNotice, noticeTool } from "./chat-notices.ts";
import { healthOf } from "./connection-health.ts";
import { appCallOutcome } from "./connection-outcome.ts";
import { serviceSlugFor } from "./connector-verdict.ts";

/** How often one conversation is told the same app signed out. */
export const SIGNED_OUT_NOTICE_EVERY_MS = 6 * 60 * 60_000;

/** The row that tells the person an app signed out and offers to reconnect it. */
export function appSignedOutTool(app: string, label: string) {
  return { ...noticeTool("chat.notice.appSignedOut", { app: label }, { ok: false, reconnectApp: app }), name: `notice: ${chatNotice("chat.notice.appSignedOut", { app: label })}` };
}

/** Tells a conversation, once in a while, that an app its bot called is signed out, as each call's answer shows it. */
export function createAppSignedOutNotice(deps: { append(threadId: string, tool: ReturnType<typeof appSignedOutTool>): void; now?: () => number }) {
  const now = deps.now ?? Date.now;
  const told = new Map<string, number>();
  return {
    observe(call: { threadId: string; slugs: readonly string[]; status: number; bytes: Uint8Array; contentType: string }): void {
      const outcome = appCallOutcome(call.status, call.bytes, call.contentType);
      if (!outcome || outcome.ok || healthOf(outcome.error) !== "needs-sign-in") return;
      const apps = new Map<string, string>();
      for (const slug of call.slugs) {
        const app = serviceSlugFor(slug);
        if (app && !apps.has(app)) apps.set(app, describeTool(slug).app ?? app);
      }
      if (apps.size !== 1) return;
      const [[app, label]] = [...apps];
      const key = `${call.threadId}\n${app}`;
      if (now() - (told.get(key) ?? -Infinity) < SIGNED_OUT_NOTICE_EVERY_MS) return;
      told.set(key, now());
      deps.append(call.threadId, appSignedOutTool(app, label));
    },
  };
}
