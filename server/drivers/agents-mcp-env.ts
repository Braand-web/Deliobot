import { TOOL_BRIDGE_ENV } from "./agents-bridge.ts";
import { TOOL_LIMIT_ENV } from "../tool-count-limit.ts";
import { DEFER_TOOLS_ENV } from "./agents-claude-defer.ts";

/** The settings the harness gives the agents MCP server, and the only ones a request may carry over HTTP. */
export const AGENTS_MCP_ENV = ["ODB_BOT_ID", "ODB_THREAD_ID", "ODB_EXTERNAL_RUNTIME", "ODB_CHIEF_OF_STAFF",
  "ODB_SKILL_AUTHORING_ENABLED", "ODB_MEMORY_ENABLED", "ODB_SHARED_COMPUTERS_ENABLED", "ODB_CLOUD_HOME", "ODB_VOICE_NOTES",
  "ODB_X_RESEARCH", "ODB_RESEARCH", "ODB_TEAM_PEOPLE", "ODB_DELIO", "ODB_COMPUTER_SELECTION", "ODB_ROOM", "ODB_IMAGE_GENERATION", "ODB_VIDEO_GENERATION",
  "ODB_MUSIC_GENERATION", "ODB_MEETINGS", "ODB_APP_HOSTING", "ODB_CODER", "ODB_TOOLS_OFF", "ODB_LOCAL_VM", TOOL_BRIDGE_ENV, TOOL_LIMIT_ENV,
  // Claude's deferred catalog: the URL form carries it as the stdio proxy's environment does.
  DEFER_TOOLS_ENV] as const;
