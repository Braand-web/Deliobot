import type { ServerResponse } from "node:http";
import { z } from "zod";
import { allowsTool } from "../../shared/tool-scope.ts";
import type { json as sendJson } from "../harness/http.ts";
import { readPublicUrl } from "../public-web.ts";
import { PASS } from "./table.ts";

export interface PublicWebContext {
  method: string;
  path: string;
  res: ServerResponse;
  json: typeof sendJson;
  readBody(): Promise<unknown>;
  requireActive(): void;
  toolScope(): unknown;
}

const bodySchema = z.object({
  url: z.string().trim().min(1).max(8192),
  offset: z.number().int().min(0).max(2 * 1024 * 1024).default(0),
  max_chars: z.number().int().min(256).max(16000).default(12000),
}).strict();

export function createPublicWebRoutes(read = readPublicUrl) {
  return async (ctx: PublicWebContext): Promise<typeof PASS | void> => {
    if (ctx.path !== "/api/internal/public-web/read" || ctx.method !== "POST") return PASS;
    const authorize = () => {
      ctx.requireActive();
      if (!allowsTool(ctx.toolScope(), { kind: "mcp", server: "agents", name: "read_public_url" })) {
        throw Object.assign(new Error("read_public_url is not allowed for this bot."), { status: 403 });
      }
    };
    authorize();
    const parsed = bodySchema.safeParse(await ctx.readBody());
    authorize();
    if (!parsed.success) return void ctx.json(ctx.res, 400, { error: "Provide a web URL, a non-negative offset and max_chars between 256 and 16000." });
    const result = await read(parsed.data, { beforeRequest: authorize });
    authorize();
    return void ctx.json(ctx.res, result.ok ? 200 : result.refused ? 403 : 502, result);
  };
}
