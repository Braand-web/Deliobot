import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { BOX_ENV_NAMES, BOX_ENV_NEVER, BOX_ENV_ODB_NAMES, BOX_ENV_ODB_PREFIXES, boxEnvironment, boxEnvironmentAllows, instanceEnvNames } from "./env.ts";

/** Every other `ODB_` name the server's code knows: decided to stay on the server, never in a bot's environment. A name
 * ending in `_` is a family (`ODB_CLOUD_*`). */
const SERVER_ONLY_ODB: ReadonlySet<string> = new Set([
  "ODB_ACP_LIMIT_QUIET_MS", "ODB_ACP_NO_SIGNS_STOP_MS", "ODB_ACP_PLAN_LINES", "ODB_ACP_QUIET_NOTICE_MS",
  "ODB_ACP_QUIET_TICK_MS", "ODB_ACP_SESSION_IDLE_", "ODB_ACP_SHARED_RECYCLE_MS", "ODB_ADMIN_", "ODB_ADMIN_MEMBERSHIP",
  "ODB_ADMIN_URL", "ODB_ADMIN_WORKSPACE", "ODB_AGENT_BROWSER_PATH", "ODB_AI_CHECKS", "ODB_ANTHROPIC_API_KEY",
  "ODB_ANTHROPIC_API_URL", "ODB_APP_VERSION", "ODB_ATTACHMENTS_MAX_BYTES", "ODB_AZURE_OPENAI_LIVE_DEPLOYMENT",
  "ODB_AZURE_OPENAI_LIVE_ENDPOINT", "ODB_BOAT_API", "ODB_BOT_BOX", "ODB_BOX_CANARY", "ODB_BRAND_FILE",
  "ODB_BROWSER_CONNECTION", "ODB_BROWSER_IDLE_HANDOVER_MS", "ODB_BROWSER_LANG", "ODB_BROWSER_LEGACY_SHELL",
  "ODB_BROWSER_MAX_RUNNING", "ODB_BROWSER_SANDBOX", "ODB_BROWSER_SCREEN", "ODB_BROWSER_TIMEZONE", "ODB_BROWSER_TIMING",
  "ODB_BUG_REPORT_URL", "ODB_CADDY_PATH", "ODB_CHROME_PATH", "ODB_CLAUDE_AUTOCOMPACT",
  "ODB_CLAUDE_INHERIT_USER_CONFIG", "ODB_CLAUDE_SESSION_IDLE_", "ODB_CLI_OWNER_STDIN", "ODB_CLI_PREFIX",
  "ODB_CLOUDFLARED_PATH", "ODB_CLOUD_", "ODB_CLOUD_ADMIN_URL", "ODB_CLOUD_AI_TOKEN", "ODB_CLOUD_AI_URL",
  "ODB_CLOUD_BOAT_TOKEN", "ODB_CLOUD_BOAT_URL", "ODB_CLOUD_BOOTSTRAP_SECRET", "ODB_CLOUD_CAPS_DROPPED",
  "ODB_CLOUD_CLIENT_IP_HEADER", "ODB_CLOUD_COMPUTER_IDLE_MS", "ODB_CLOUD_COMPUTER_START_BUDGET_MS",
  "ODB_CLOUD_CONNECTED_APPS_GRANT", "ODB_CLOUD_DECIDER_TOKEN", "ODB_CLOUD_DECIDER_URL", "ODB_CLOUD_EDGE_ACME_EMAIL",
  "ODB_CLOUD_EDGE_ACME_FALLBACK_ONLY", "ODB_CLOUD_EDGE_BIN", "ODB_CLOUD_EDGE_CERT_ISSUERS",
  "ODB_CLOUD_EDGE_CLIENT_IP_HEADER", "ODB_CLOUD_EDGE_CONFIG", "ODB_CLOUD_EDGE_HOLD", "ODB_CLOUD_EDGE_STORAGE",
  "ODB_CLOUD_EDGE_TLS", "ODB_CLOUD_EDGE_TRUSTED_PROXIES", "ODB_CLOUD_EXPORT_ONLY", "ODB_CLOUD_HARDEN",
  "ODB_CLOUD_HOME", "ODB_CLOUD_IMAGE", "ODB_CLOUD_LEGACY_ORIGINS", "ODB_CLOUD_MACHINE_ID", "ODB_CLOUD_MOVES",
  "ODB_CLOUD_PUBLIC_HOST", "ODB_CLOUD_ROLE", "ODB_CLOUD_SECRETS_FD", "ODB_CLOUD_STAGING",
  "ODB_CLOUD_STOPPED_HOLD_DAYS", "ODB_CLOUD_TEAM_ID", "ODB_CLOUD_TEAM_LANGUAGE", "ODB_CLOUD_TEAM_NAME",
  "ODB_CLOUD_TRUSTED_PROXIES", "ODB_CLOUD_TUNNEL_BIN", "ODB_CLOUD_TUNNEL_TOKEN", "ODB_CLOUD_VOICE_TOKEN",
  "ODB_CLOUD_VOICE_URL", "ODB_CLOUD_X_TOKEN", "ODB_CLOUD_X_URL", "ODB_CODEX_LAUNCH_SLOTS", "ODB_COMPANION_DIR",
  "ODB_COMPANION_HOSTED_URL", "ODB_COMPANION_INTERNAL_ORIGIN", "ODB_COMPANION_PORT", "ODB_COMPANION_ROUTES",
  "ODB_COMPANION_TAILNET_NAME", "ODB_COMPOSIO_API", "ODB_COMPOSIO_BROKER", "ODB_COMPOSIO_BROKER_TOKEN",
  "ODB_COMPOSIO_BROKER_URL", "ODB_COMPOSIO_TOOLKITS_API", "ODB_COMPUTER_CALL_ACT_WITHIN_MS",
  "ODB_COMPUTER_CALL_WAIT_MS", "ODB_COMPUTER_WAIT_MAX_MS", "ODB_CONTROL_PLANE_URL", "ODB_CONTROL_PORT",
  "ODB_CREDENTIAL_STORE", "ODB_CUSTOM_IMAGE_KEY", "ODB_DATA_DIR", "ODB_DECISION_RETENTION_DAYS",
  "ODB_DEEPSEEK_API_KEY", "ODB_DESKTOP_LAUNCH_ID", "ODB_DESKTOP_PARENT", "ODB_DEVS_STATUS_MS",
  "ODB_DEV_TRUST_LOCAL_BROWSER", "ODB_DISABLE_MODEL_CATALOG_FETCH", "ODB_DISABLE_MODEL_MANIFEST_FETCH", "ODB_DUCKDB_DIR", "ODB_DUCKDB_MAX_TEMP_SIZE",
  "ODB_DUCKDB_MEMORY_LIMIT", "ODB_ELEVENLABS_API", "ODB_ENTERPRISE_DIR", "ODB_ENVIRONMENT_LABEL", "ODB_EOF",
  "ODB_FIRST_REPLY_NOTICE_MS", "ODB_FISH_AUDIO_API", "ODB_FISH_AUDIO_API_KEY", "ODB_FLEET_SOCKET", "ODB_GATE_",
  "ODB_GEMINI_API_KEY", "ODB_GEMINI_IMAGE_KEY", "ODB_GEMINI_TTS_API", "ODB_GOAL_WAIT_MAX_MS",
  "ODB_GREENFERENCE_API_KEY", "ODB_GROQ_API_KEY", "ODB_HELPER_INSTANCE", "ODB_HELPER_MODEL", "ODB_HOOKS", "ODB_HOOK_",
  "ODB_HOSTED_", "ODB_HOSTED_MODELS", "ODB_HOSTED_MODEL_TOKEN", "ODB_HOSTED_MODEL_URL", "ODB_INSTALLATION_CREDENTIAL",
  "ODB_JEV_API_KEY", "ODB_LAN", "ODB_LICENSE_KEY", "ODB_LINUX_GPU", "ODB_LIVE_PROVIDER", "ODB_LOCAL_VM_UPDATE_WAIT_MS",
  "ODB_LOOPBACK_TRUST", "ODB_LOOP_GUARD", "ODB_LOOP_GUARD_STOP_AT", "ODB_META_API_KEY", "ODB_MODELGO_API_KEY", "ODB_OPENAI_API_KEY",
  "ODB_OPENAI_IMAGE_KEY", "ODB_OPENAI_LIVE_KEY", "ODB_OPENAI_LIVE_URL", "ODB_OPENROUTER_API_KEY",
  "ODB_OPENROUTER_DECIDER_KEY", "ODB_PERSON_FIRST_MS", "ODB_PHONE_RELAY", "ODB_PHONE_RELAY_URL", "ODB_PHONE_SECRET_PUBLIC_KEY", "ODB_PORT", "ODB_SERVES_TUNNEL", "ODB_POSTIZ_API_KEY",
  "ODB_POSTIZ_CLOUD_URL", "ODB_PROCESS_ID", "ODB_PUBLIC_IPV4", "ODB_PUBLIC_URL", "ODB_QUOTA_SWITCH",
  "ODB_REPLAY_TOOL_HISTORY", "ODB_ROOM_SESSIONS", "ODB_SAFETY_FLOOR", "ODB_SERVER_COMPILE_CACHE", "ODB_SERVER_NAME",
  "ODB_SESSION_IDLE_MIN_MS", "ODB_SESSION_IDLE_MS", "ODB_SESSION_MAX_DAYS", "ODB_SESSION_TTL_DAYS",
  "ODB_SHARED_WORKSPACE_FULL_ACCESS", "ODB_SIGNIN_EMAILS", "ODB_SIGNIN_MEMBER_EMAILS", "ODB_SIGNIN_SMTP_FROM",
  "ODB_SIGNIN_SMTP_URL", "ODB_SKILLS_DIR", "ODB_SMOKE_BUNDLED_CUA", "ODB_SMOKE_CUA", "ODB_SMOKE_KEEP_OPEN",
  "ODB_SMOKE_TEST", "ODB_SSE_HEARTBEAT_MS", "ODB_STATIC_DIR", "ODB_SYNC_ROOT", "ODB_TAILNET_ADDRESSES", "ODB_TAILNET_NAME", "ODB_TAILNET_SERVED", "ODB_TEAM_AWAY_WINDOW_MS",
  "ODB_TEAM_PRESENCE_GRACE_MS", "ODB_TEST_INTERNAL_CAPABILITY_KEY", "ODB_TEST_ORG_LIBRARY_KEY",
  "ODB_TEST_PLAN_USAGE_FILE", "ODB_TEST_TAILNET_STAND_IN", "ODB_TOOL_STALL_MS", "ODB_TREG_KEY", "ODB_TREG_URL", "ODB_TTS_DEFAULT_VOICE",
  "ODB_TTS_KEY", "ODB_TUNNEL_ORIGIN_PORT", "ODB_TUNNEL_SOCKET", "ODB_TURN_STALL_MS", "ODB_UPDATE_CHANNEL", "ODB_UPDATE_INSTALL",
  "ODB_USER_DATA", "ODB_WARM_SUMMARY", "ODB_WARM_SUMMARY_TIME_SCALE", "ODB_WEBHOOK_PORT", "ODB_WEBHOOK_PUBLIC_URL", "ODB_WEBHOOK_SOCKET",
  "ODB_WORKERS_AI_TOKEN", "ODB_XAI_TTS_API",
]);

const ROOT = new URL("../../", import.meta.url);

/** The `ODB_` names in the code the server runs, and in what starts it (the desktop app). */
function knownOdbNames(): string[] {
  const files = execFileSync("git", ["ls-files", "server", "shared", "enterprise/server", "electron"], { cwd: ROOT, encoding: "utf8" })
    .split("\n").filter((file) => /\.(?:ts|mts|mjs|cjs|js)$/.test(file) && !/\.test\.|\/testing\/|node-test/.test(file));
  const names = new Set<string>();
  for (const file of files) for (const match of readFileSync(new URL(file, ROOT), "utf8").matchAll(/\bODB_[A-Z0-9_]+\b/g)) names.add(match[0]);
  return [...names].sort();
}

describe("the box's environment allow-list", () => {
  it("keeps what an engine needs and drops the server's own settings and the control plane", () => {
    const kept = boxEnvironment({
      PATH: "/usr/bin", HOME: "/data", LANG: "C.UTF-8", TZ: "Europe/Berlin", LC_ALL: "C", TERM: "xterm",
      ANTHROPIC_API_KEY: "sk-ant-1", ANTHROPIC_BASE_URL: "http://127.0.0.1:18080/b/t/anthropic", CLAUDE_CONFIG_DIR: "/data/.claude",
      OPENAI_API_KEY: "sk-1", CODEX_HOME: "/data/.codex", ODB_HOOK_URL: "http://127.0.0.1:8799/api/internal/hook", ODB_COMMS_TOKEN: "cap",
      HTTPS_PROXY: "http://127.0.0.1:3128", NO_PROXY: "127.0.0.1", NPM_CONFIG_LOGLEVEL: "error", ELECTRON_RUN_AS_NODE: "1",
      ODB_CLOUD_BOOTSTRAP_SECRET: "s", ODB_CLOUD_MACHINE_ID: "m", ODB_CLOUD_ADMIN_URL: "https://a", ODB_LICENSE_KEY: "k",
      ODB_DATA_DIR: "/data/.opendeliobot", ODB_PORT: "8799", ODB_LOOPBACK_TRUST: "owner", AWS_SECRET_ACCESS_KEY: "aws", SSH_AUTH_SOCK: "/x",
      SOME_RANDOM_NAME: "x", EMPTY: undefined,
    });
    expect(Object.keys(kept).sort()).toEqual([
      "ANTHROPIC_API_KEY", "ANTHROPIC_BASE_URL", "CLAUDE_CONFIG_DIR", "CODEX_HOME", "ELECTRON_RUN_AS_NODE", "HOME", "HTTPS_PROXY", "LANG", "LC_ALL",
      "NO_PROXY", "NPM_CONFIG_LOGLEVEL", "ODB_COMMS_TOKEN", "ODB_HOOK_URL", "OPENAI_API_KEY", "PATH", "TERM", "TZ",
    ]);
  });

  it("a denied name loses even against an allowing list or prefix, and the never-list beats everything", () => {
    expect(boxEnvironmentAllows("ODB_COMMS_TOKEN")).toBe(true);
    expect(boxEnvironmentAllows("ODB_COMMS_TOKEN", new Set(["ODB_COMMS_TOKEN"]))).toBe(false);
    expect(boxEnvironmentAllows("ANTHROPIC_API_KEY", new Set(["ANTHROPIC_API_KEY"]))).toBe(false);
    expect(boxEnvironmentAllows("ODB_COMPOSIO_BROKER_TOKEN")).toBe(false);
    for (const name of BOX_ENV_NEVER) expect(boxEnvironmentAllows(name), name).toBe(false);
    expect(boxEnvironmentAllows("ODB_CLOUD_ANYTHING")).toBe(false);
    expect(boxEnvironmentAllows("ODB_CLOUDFLARED_PATH")).toBe(false);
    expect(BOX_ENV_NAMES.has("PATH")).toBe(true);
  });

  // The CLI's session token and server address (server/headless/client.ts, scripts/mcp-server.ts): an operator may put
  // them in the server's environment, and nothing that runs in a box reads them. The engines' own OPENDELIOBOT_ keys
  // (OPENDELIOBOT_CODEX_API_KEY, OPENDELIOBOT_CHATGPT_TOKEN) still pass, and a spawn's allowEnv never lifts these two.
  it("keeps the CLI's session token and server address on the server, and the engines' OPENDELIOBOT_ keys in the box", () => {
    const kept = boxEnvironment(
      { OPENDELIOBOT_TOKEN: "odb_sess_x", OPENDELIOBOT_URL: "http://127.0.0.1:8799", OPENDELIOBOT_CODEX_API_KEY: "k", OPENDELIOBOT_CHATGPT_TOKEN: "t" },
      new Set(), new Set(["OPENDELIOBOT_TOKEN", "OPENDELIOBOT_URL"]),
    );
    expect(Object.keys(kept).sort()).toEqual(["OPENDELIOBOT_CHATGPT_TOKEN", "OPENDELIOBOT_CODEX_API_KEY"]);
  });

  it("keeps what Antigravity's runtime is started with: its harness, its file storage switch and the browser hook", () => {
    for (const name of ["ANTIGRAVITY_HARNESS_PATH", "AGY_ACP_FORCE_FILE_STORAGE", "BROWSER", "GEMINI_HOME"]) expect(boxEnvironmentAllows(name), name).toBe(true);
  });

  it("keeps the keys one spawn vouches for, under any name, past the allow-list and the deny, never past the never-list or ODB_", () => {
    const deny = new Set(["OPENCODE_API_KEY", "ODB_COMPOSIO_BROKER_TOKEN"]);
    const allow = new Set(["NANO_GPT_API_KEY", "OPENCODE_API_KEY", "ODB_LICENSE_KEY", "ODB_CLOUD_AI_TOKEN", "ODB_COMPOSIO_BROKER_TOKEN"]);
    const env = { NANO_GPT_API_KEY: "n", OPENCODE_API_KEY: "o", ODB_LICENSE_KEY: "l", ODB_CLOUD_AI_TOKEN: "c", ODB_COMPOSIO_BROKER_TOKEN: "b", DEEPSEEK_API_KEY: "d" };
    expect(boxEnvironment(env, deny, allow)).toEqual({ NANO_GPT_API_KEY: "n", OPENCODE_API_KEY: "o" });
    expect(boxEnvironment(env, deny)).toEqual({});
  });

  it("vouches only for the names the engine instance's own environment set, with its own value", () => {
    expect(instanceEnvNames({ NANO_GPT_API_KEY: "n", OPENCODE_API_KEY: "o", GONE: "g" }, { NANO_GPT_API_KEY: "n", OPENCODE_API_KEY: "server's", PATH: "/usr/bin" }))
      .toEqual(["NANO_GPT_API_KEY"]);
  });

  it("passes only the ODB_ names a boxed process reads; an operator's own settings stay on the server", () => {
    const kept = boxEnvironment({
      ODB_SIGNIN_SMTP_URL: "smtp://user:pass@mail.example.com", ODB_SIGNIN_EMAILS: "a@example.com", ODB_PHONE_SECRET_PUBLIC_KEY: "k",
      ODB_TEST_INTERNAL_CAPABILITY_KEY: "k", ODB_PUBLIC_URL: "https://x", ODB_SOMETHING_NEW: "x", ODB_EXTRA_PATH: "/opt/tools/bin",
      ODB_MCP_TOKEN_BROWSER: "t", ODB_GATE_CONFIG_ab12: "{}", ODB_REMOTE_MCP_CONFIG_cd34: "{}", ODB_HARNESS_URL: "http://127.0.0.1:8799",
    });
    expect(Object.keys(kept).sort()).toEqual(["ODB_EXTRA_PATH", "ODB_GATE_CONFIG_ab12", "ODB_HARNESS_URL", "ODB_MCP_TOKEN_BROWSER", "ODB_REMOTE_MCP_CONFIG_cd34"]);
  });

  it("every ODB_ name the server knows has a decision: passed to a bot's box or kept on the server", () => {
    const passed = (name: string) => BOX_ENV_ODB_NAMES.has(name) || BOX_ENV_ODB_PREFIXES.includes(name);
    const undecided = knownOdbNames().filter((name) => !passed(name) && !SERVER_ONLY_ODB.has(name));
    expect(undecided, "add each to BOX_ENV_ODB_NAMES in env.ts if a bot's engine, hook or MCP proxy reads it, else to SERVER_ONLY_ODB here").toEqual([]);
    expect([...BOX_ENV_ODB_NAMES].filter((name) => SERVER_ONLY_ODB.has(name))).toEqual([]);
    for (const name of SERVER_ONLY_ODB) if (!name.endsWith("_")) expect(boxEnvironmentAllows(name), name).toBe(false);
  });

  it("returns a fresh object, never the caller's", () => {
    const source = { PATH: "/usr/bin" };
    const kept = boxEnvironment(source);
    kept.PATH = "/changed";
    expect(source.PATH).toBe("/usr/bin");
  });
});
