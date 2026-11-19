// The agents catalog's tools for the plan's included app hosting and the internal route behind them. Shown only where
// that hosting reaches this server; the route answers for itself on every call.
import type { ToolCallContext, ToolCallResult } from "./agents-call.ts";
import type { Json } from "./agents-client.ts";

export const HOSTING_TOOL_NAMES: ReadonlySet<string> = new Set(["publish_app", "check_app_hosting"]);

export async function callHostingTool(name: string, args: Json, context: ToolCallContext): Promise<ToolCallResult> {
  const actions = new Set(["delete", "rollback", "protect", "unprotect"]);
  const input = name === "check_app_hosting" ? { ...args, action: "status" } : { ...args, action: typeof args.action === "string" && actions.has(args.action) ? args.action : "publish" };
  const { ok, body } = await context.client.apiResponse("/api/internal/apps/publish", { method: "POST", body: JSON.stringify(input) });
  return ok ? { text: JSON.stringify(body) } : { text: String(body.error ?? "Included hosting did not answer. Try again shortly."), isError: true };
}

const PROJECT = { type: "string", description: "The project's folder when the output is inside it (project \"shop\", path \"shop/dist\"); pass the same one every time." };

export const HOSTING_TOOL_DEFINITIONS = [
  {
    name: "publish_app",
    description:
      "Put a site or app you built online on the hosting the person's Cloud plan includes: static files, no account or token; a folder with a build script is built first. The link is public at once: publish only after the person saw or was told what it is and said yes. Publishing the same project again keeps its link as a new version; rollback puts an earlier one back. protect makes the app ask a password, given to you once for the person; unprotect opens it. delete takes it down for good, only when the person asks. Follow the publish-to-netlify skill; when the plan can't take the app, offer the person's own Netlify account.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        action: { type: "string", enum: ["publish", "rollback", "protect", "unprotect", "delete"], description: "Default publish." },
        path: { type: "string", description: "The folder to publish: one with index.html at its top, or a project with a build script. A relative path is looked for in your shared bot folder first (sites/<app>), so every conversation names the same app." },
        project: PROJECT,
        title: { type: "string", maxLength: 120, description: "publish: what the app is, in a few words." },
        version: { type: "integer", minimum: 1, description: "rollback: which one, from check_app_hosting." },
      },
      required: ["path"],
    },
  },
  {
    name: "check_app_hosting",
    description:
      "Read the plan's included app hosting: how many of its apps and this month's publishes are in use (\"3 of 10\") and its size limits. Without path, also the projects already published from your folders: look there before starting a new one. With path, how the app published from that folder is doing, and its kept versions. Changes nothing.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: { path: { type: "string", description: "The folder an app was published from." }, project: PROJECT },
    },
  },
];
