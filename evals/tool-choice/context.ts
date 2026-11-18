import { DEFER_TOOLS_ENV, claudeUpFrontBytes } from "../../server/drivers/agents-claude-defer.ts";
import { agentsToolList } from "../../server/drivers/agents-mcp.ts";

const BASE = { ODB_BOT_ID: "bot-context", ODB_CHIEF_OF_STAFF: "1", ODB_COMPUTER_SELECTION: "1" };
/** A Chief's direct chat with nothing extra, and with every switch the catalog has. */
export const CONTEXT_PROFILES: Record<string, Record<string, string>> = {
  default: BASE,
  fullest: {
    ...BASE, ODB_SKILL_AUTHORING_ENABLED: "1", ODB_SHARED_COMPUTERS_ENABLED: "1", ODB_VOICE_NOTES: "1", ODB_X_RESEARCH: "1", ODB_RESEARCH: "1",
    ODB_TEAM_PEOPLE: "1", ODB_IMAGE_GENERATION: "1", ODB_APP_HOSTING: "1",
  },
};

/** Bytes of the agents server a Claude turn sends before any search, every tool whole against all but a few deferred. */
export function contextSizes() {
  return Object.entries(CONTEXT_PROFILES).map(([profile, env]) => {
    const whole = agentsToolList(env).listed;
    const deferred = agentsToolList({ ...env, [DEFER_TOOLS_ENV]: "1" }).listed;
    return {
      profile,
      tools: whole.length,
      loaded: deferred.filter((tool) => !("_meta" in tool)).map((tool) => tool.name),
      before: claudeUpFrontBytes(whole),
      after: claudeUpFrontBytes(deferred),
    };
  });
}
