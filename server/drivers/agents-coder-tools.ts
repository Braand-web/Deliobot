import type { ToolCallContext, ToolCallResult } from "./agents-call.ts";
import type { Json } from "./agents-client.ts";

export const CODER_TOOL_NAMES: ReadonlySet<string> = new Set(["project_note"]);

export async function callCoderTool(_name: string, args: Json, context: ToolCallContext): Promise<ToolCallResult> {
  const { ok, body } = await context.client.apiResponse("/api/internal/project-note", { method: "POST", body: JSON.stringify(args ?? {}) });
  return ok ? { text: String(body.text ?? "") } : { text: String(body.error ?? "That could not be done."), isError: true };
}

export const CODER_TOOL_DEFINITIONS = [
  {
    name: "project_note",
    description: "Keep a one-line fact about this conversation's project folder for later conversations in it: how to build, test or run it, a convention, a pitfall.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        action: { type: "string", enum: ["add", "replace", "remove"] },
        text: { type: "string", maxLength: 300 },
        old: { type: "string", maxLength: 300, description: "Words from the note to replace or remove." },
      },
      required: ["action"],
    },
  },
];
