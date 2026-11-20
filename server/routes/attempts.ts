import { z } from "zod";

import type { ParallelAttempts } from "../host/parallel-attempts.ts";
import type { HelperToolContext } from "./helper-tools.ts";
import type { ProjectNoteDeps } from "./project-note.ts";
import { PASS } from "./table.ts";

const ROUTE = "/api/internal/attempts";
const engine = z.object({ instanceId: z.string().min(1).max(200), model: z.string().min(1).max(200) });
const body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("start"), request: z.string().trim().min(1).max(8000), count: z.number().int().min(2).max(3).optional(), engines: z.array(engine).max(3).optional() }),
  z.object({ action: z.literal("choose"), run: z.string().regex(/^[0-9a-f]{12}$/), attempt: z.number().int().min(1).max(3) }),
]);

export function createAttemptRoutes(deps: { attempts: ParallelAttempts; projectFolder: ProjectNoteDeps["projectFolder"] }) {
  return async (ctx: HelperToolContext & { threadId: string }): Promise<typeof PASS | void> => {
    if (ctx.method !== "POST" || ctx.path !== ROUTE) return PASS;
    const folder = deps.projectFolder(ctx.botId, ctx.threadId);
    if (!folder) return void ctx.json(ctx.res, 409, { error: "Parallel attempts work in coder mode, in a conversation with a project folder." });
    const parsed = body.safeParse(await ctx.readBody());
    if (!parsed.success) return void ctx.json(ctx.res, 400, { error: "parallel_attempts takes request, count 2 or 3 and engines; choose_attempt takes run and attempt." });
    const input = parsed.data;
    const answer = input.action === "start"
      ? await deps.attempts.start({ botId: ctx.botId, threadId: ctx.threadId, cwd: folder, request: input.request, count: input.count ?? 2, ...(input.engines ? { engines: input.engines } : {}) })
      : await deps.attempts.choose({ botId: ctx.botId, threadId: ctx.threadId, run: input.run, attempt: input.attempt });
    if ("error" in answer) return void ctx.json(ctx.res, 409, { error: answer.error });
    ctx.json(ctx.res, 200, { text: "run" in answer
      ? `Started ${answer.attempts} attempts (run ${answer.run}). They work on their own; when all are done you get the results in this conversation. End your turn now and say they are running.`
      : answer.message });
  };
}
