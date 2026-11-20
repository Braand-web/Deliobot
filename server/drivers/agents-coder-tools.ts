import type { ToolCallContext, ToolCallResult } from "./agents-call.ts";
import type { Json } from "./agents-client.ts";

export const CODER_TOOL_NAMES: ReadonlySet<string> = new Set(["project_note", "parallel_attempts", "choose_attempt"]);

export async function callCoderTool(name: string, args: Json, context: ToolCallContext): Promise<ToolCallResult> {
  const [path, input] = name === "project_note" ? ["/api/internal/project-note", args ?? {}]
    : ["/api/internal/attempts", { ...args, action: name === "choose_attempt" ? "choose" : "start" }];
  const { ok, body } = await context.client.apiResponse(path, { method: "POST", body: JSON.stringify(input) });
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
  {
    name: "parallel_attempts",
    description: "Have 2 or 3 copies of this project each do the request at once, on this engine or the ones you name; each is checked and the best is written into the project, then you get the results to report. Several full turns: only when the person asks for attempts or agreed to them.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        request: { type: "string", maxLength: 8000, description: "The whole request, as each attempt reads it." },
        count: { type: "integer", minimum: 2, maximum: 3 },
        engines: { type: "array", maxItems: 3, items: { type: "object", additionalProperties: false, properties: { instanceId: { type: "string" }, model: { type: "string" } }, required: ["instanceId", "model"] }, description: "From list_models; attempts take them in turn." },
      },
      required: ["request"],
    },
  },
  {
    name: "choose_attempt",
    description: "Write another attempt of a parallel_attempts run into the project instead of the one kept, when the person prefers it.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: { run: { type: "string" }, attempt: { type: "integer", minimum: 1, maximum: 3 } },
      required: ["run", "attempt"],
    },
  },
];
