import { VIDEO_ASPECTS, VIDEO_SECONDS_MAX } from "../../shared/video-generation.ts";
import type { ToolCallContext, ToolCallResult } from "./agents-call.ts";
import type { Json } from "./agents-client.ts";

export const VIDEO_PROMPT_MAX_CHARS = 2000;
export const VIDEO_TOOL_NAMES: ReadonlySet<string> = new Set(["generate_video"]);

export async function callVideoTool(_name: string, args: Json, context: ToolCallContext): Promise<ToolCallResult> {
  const { ok, body } = await context.client.apiResponse("/api/internal/videos/generate", {
    method: "POST",
    body: JSON.stringify({ fromBotId: context.botId, fromThreadId: context.threadId, ...args }),
  });
  return ok ? { text: String(body.text ?? "") } : { text: String(body.error ?? "The video was not made. Try again shortly."), isError: true };
}

export const VIDEO_TOOL_DEFINITIONS = [
  {
    name: "generate_video",
    description:
      "Make one short video clip from a text description with the person's video model. It takes a minute or more and costs much more than an image, so make one only when the person asked for a video. It is attached to your reply when the turn ends: do not describe or link it again. Write the prompt in English: subject, action, camera movement, setting, style.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        prompt: { type: "string", minLength: 1, maxLength: VIDEO_PROMPT_MAX_CHARS, description: "What happens in the clip, and how it is filmed." },
        seconds: { type: "integer", minimum: 1, maximum: VIDEO_SECONDS_MAX, description: "Length in seconds; the person's limit applies. 5 when omitted." },
        aspect: { type: "string", enum: [...VIDEO_ASPECTS], description: "Shape; landscape 16:9 when omitted." },
      },
      required: ["prompt"],
    },
  },
];
