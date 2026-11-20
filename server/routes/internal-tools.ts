// The agents tools' internal calls that need only the capability's bot and conversation, its body and its folders: research,
// the helper models' decide and extract, Delio's notifications, the usage limits, publishing an app and a coder bot's project notes. Runs inside index.ts's /api/internal/ block, after the
// capability bearer is checked; each route answers its own paths and passes the rest on.
import type { AppPublisher } from "../host/app-publisher.ts";
import { createAppHostingInternalRoutes } from "./app-hosting.ts";
import { createEngineLimitsRoutes, type EngineLimitsDeps } from "./engine-limits.ts";
import { createHelperToolRoutes, type HelperToolContext, type HelperToolDeps } from "./helper-tools.ts";
import { createDelioNotificationRoutes, type LiveNotificationsDeps } from "./delio-notifications.ts";
import { PASS } from "./table.ts";
import { createProjectNoteRoutes, type ProjectNoteDeps } from "./project-note.ts";
import { createAttemptRoutes } from "./attempts.ts";
import type { ParallelAttempts } from "../host/parallel-attempts.ts";
import { createPublicWebRoutes, type PublicWebContext } from "./public-web.ts";
import { createXResearchInternalRoutes, type XResearchDeps } from "./x-research.ts";

export function createInternalToolRoutes(deps: { helpers: HelperToolDeps; xResearch: XResearchDeps; notifications: LiveNotificationsDeps; engineLimits: EngineLimitsDeps; appPublisher: AppPublisher; projectNotes: ProjectNoteDeps; attempts: ParallelAttempts }) {
  const routes = [createXResearchInternalRoutes(deps.xResearch), createHelperToolRoutes(deps.helpers), createDelioNotificationRoutes(deps.notifications), createEngineLimitsRoutes(deps.engineLimits), createPublicWebRoutes(), createAppHostingInternalRoutes(deps.appPublisher), createProjectNoteRoutes(deps.projectNotes), createAttemptRoutes({ attempts: deps.attempts, projectFolder: deps.projectNotes.projectFolder })];
  return async (ctx: HelperToolContext & PublicWebContext & { threadId: string }): Promise<typeof PASS | void> => {
    for (const route of routes) if (await route(ctx) !== PASS) return;
    return PASS;
  };
}
