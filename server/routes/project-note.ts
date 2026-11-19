import { editNotes } from "../coder/project-notes.ts";
import type { HelperToolContext } from "./helper-tools.ts";
import { PASS } from "./table.ts";

const ROUTE = "/api/internal/project-note";

export interface ProjectNoteDeps {
  dataDir: string;
  /** The project folder of a coder-mode bot's conversation, or null when the bot is not in coder mode or has no folder. */
  projectFolder(botId: string, threadId: string): string | null;
}

export function createProjectNoteRoutes(deps: ProjectNoteDeps) {
  return async (ctx: HelperToolContext & { threadId: string }): Promise<typeof PASS | void> => {
    if (ctx.method !== "POST" || ctx.path !== ROUTE) return PASS;
    const folder = deps.projectFolder(ctx.botId, ctx.threadId);
    if (!folder) return void ctx.json(ctx.res, 409, { error: "project_note works in coder mode, in a conversation with a project folder." });
    const raw = await ctx.readBody();
    const result = editNotes(deps.dataDir, folder, raw && typeof raw === "object" ? raw as Record<string, unknown> : {});
    if (!result.ok) return void ctx.json(ctx.res, 400, { error: result.error });
    ctx.json(ctx.res, 200, { text: `Saved. This project's notes now read:\n${result.notes || "(none)"}` });
  };
}
