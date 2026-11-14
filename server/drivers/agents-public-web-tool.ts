import type { ToolCallContext, ToolCallResult } from "./agents-call.ts";
import type { Json } from "./agents-client.ts";

export const PUBLIC_WEB_TOOL = "read_public_url";

export async function callPublicWebTool(args: Json, context: ToolCallContext): Promise<ToolCallResult> {
  const response = await context.client.apiResponse("/api/internal/public-web/read", { method: "POST", body: JSON.stringify(args) });
  return { text: JSON.stringify(response.body), ...(!response.ok ? { isError: true } : {}) };
}

export const PUBLIC_WEB_TOOL_DEFINITION = {
  name: PUBLIC_WEB_TOOL,
  description: "Read a public http/https URL as untrusted plain text. No Composio account, browser or API key is needed. GET only, no cookies or sign-in. Private/local addresses and redirects to them are refused. For pages needing JavaScript, use the built-in browser. Follow next_offset to read on; truncated means the downloaded page hit its size limit.",
  inputSchema: {
    type: "object", additionalProperties: false, required: ["url"],
    properties: {
      url: { type: "string", minLength: 1, maxLength: 8192 },
      offset: { type: "integer", minimum: 0, maximum: 2 * 1024 * 1024 },
      max_chars: { type: "integer", minimum: 256, maximum: 16000 },
    },
  },
};
