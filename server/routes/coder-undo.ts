import type { CheckpointDiff } from "../checkpoints.ts";
import type { Store } from "../store.ts";
import { noticeTool } from "../chat-notices.ts";
import { PASS, type RouteHandler } from "./table.ts";

export interface CoderUndoDeps {
  store: Pick<Store, "activePath" | "patchMessage" | "taskByThread" | "appendMessage">;
  threadBusy(botId: string, threadId: string): boolean;
  restore(botId: string, cwd: string, hash: string): Promise<CheckpointDiff | null>;
}

/** POST /api/bots/:botId/threads/:threadId/messages/:messageId/undo: puts the folder back as it was before that turn. */
export function createCoderUndoRoutes(deps: CoderUndoDeps): RouteHandler {
  return async ({ req, res, path, method, auth, json }) => {
    const m = path.match(/^\/api\/bots\/([\w-]+)\/threads\/([\w-]+)\/messages\/([\w-]+)\/undo$/);
    if (!m || method !== "POST") return PASS;
    if ((auth.kind === "session" && !auth.scopes.includes("admin")) || req.headers["x-opendeliobot-companion"] === "1") {
      return json(res, 403, { error: "Only an admin can undo a bot's changes." });
    }
    const [, botId, threadId, messageId] = m as unknown as [string, string, string, string];
    const task = deps.store.taskByThread(botId, threadId);
    const message = task ? deps.store.activePath(threadId).find((row) => row.id === messageId) : undefined;
    if (!task?.cwd || !message?.undo) return json(res, 404, { error: "There is nothing to undo here any more." });
    if (deps.threadBusy(botId, threadId)) return json(res, 409, { error: "The bot is still working in this conversation. Stop it first." });
    const undone = await deps.restore(botId, task.cwd, message.undo);
    if (!undone) return json(res, 409, { error: "These changes could not be undone: the saved copy is gone or the folder changed." });
    deps.store.patchMessage(threadId, messageId, { undo: undefined, undone: true });
    const count = undone.changed.length + undone.added.length + undone.deleted.length;
    deps.store.appendMessage(threadId, { role: "bot", kind: "activity", tool: noticeTool("chat.notice.coderUndone", { files: String(count) }, { ok: true }) });
    return json(res, 200, { undone: count });
  };
}
