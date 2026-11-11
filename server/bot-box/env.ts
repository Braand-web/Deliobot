// The environment a boxed process gets: an allow-list, never the server's whole environment. The drivers already strip
// the workspace credentials and every ODB_CLOUD_ setting before a spawn (server/config.ts stripWorkspaceCredentialEnv);
// this is the second gate, applied at the box boundary, so a name a driver forgot never reaches a bot's shell.

/** Names a bot's engine, its tools and the proxies OpenDeliobot starts inside the box may read. */
export const BOX_ENV_NAMES: ReadonlySet<string> = new Set([
  "PATH", "HOME", "USER", "LOGNAME", "SHELL", "HOSTNAME", "PWD",
  "LANG", "LANGUAGE", "TZ", "TERM", "COLORTERM", "TMPDIR", "NO_COLOR", "FORCE_COLOR", "CI", "DEBUG",
  "NODE_ENV", "NODE_OPTIONS", "NODE_EXTRA_CA_CERTS", "NODE_USE_ENV_PROXY", "SSL_CERT_FILE", "SSL_CERT_DIR", "CURL_CA_BUNDLE",
  "HTTP_PROXY", "HTTPS_PROXY", "NO_PROXY", "ALL_PROXY", "http_proxy", "https_proxy", "no_proxy", "all_proxy",
  "XDG_CONFIG_HOME", "XDG_DATA_HOME", "XDG_CACHE_HOME", "XDG_RUNTIME_DIR", "DISPLAY", "WAYLAND_DISPLAY",
  "AGENT_BROWSER_EXECUTABLE_PATH", "BROWSER", "BASH_MAX_TIMEOUT_MS", "ELECTRON_RUN_AS_NODE", "PYTHONUNBUFFERED", "PYTHONDONTWRITEBYTECODE",
  "GIT_AUTHOR_NAME", "GIT_AUTHOR_EMAIL", "GIT_COMMITTER_NAME", "GIT_COMMITTER_EMAIL",
]);

/** OpenDeliobot's own variables a boxed process reads: what the harness sets for a bot's engine, its hooks and the MCP
 * proxies it starts. Security: no other `ODB_` name passes, whatever the operator set on the server (an SMTP URL, a
 * token); env.test.ts lists every `ODB_` name the server knows, so a new one needs a decision. */
export const BOX_ENV_ODB_NAMES: ReadonlySet<string> = new Set([
  "ODB_HARNESS_URL", "ODB_BOT_ID", "ODB_THREAD_ID", "ODB_COMMS_TOKEN", "ODB_TURN_DEPTH", "ODB_EXTERNAL_RUNTIME",
  "ODB_CHIEF_OF_STAFF", "ODB_DELIO", "ODB_SKILL_AUTHORING_ENABLED", "ODB_MEMORY_ENABLED", "ODB_SHARED_COMPUTERS_ENABLED",
  "ODB_VOICE_NOTES", "ODB_X_RESEARCH", "ODB_RESEARCH", "ODB_TEAM_PEOPLE", "ODB_COMPUTER_SELECTION", "ODB_ROOM",
  "ODB_IMAGE_GENERATION", "ODB_MEETINGS", "ODB_AGENTS_TOOL_BRIDGE", "ODB_TOOL_LIMIT", "ODB_TOOL_SCHEMA_PROFILE",
  "ODB_MCP_CONFIG", "ODB_MCP_RESTART", "ODB_MCP_RESULT_BUDGET",
  "ODB_HOOK_URL", "ODB_HOOK_TOKEN_FILE", "ODB_HOOK_TIMEOUT_MS", "ODB_PERMISSION_TOOL_SCOPE",
  "ODB_CONNECTOR_UPSTREAM_URL", "ODB_CONNECTOR_UPSTREAM_HEADERS", "ODB_CONNECTOR_TOKEN", "ODB_CONNECTOR_ALLOWED_TOOLS",
  "ODB_CONNECTOR_SERVICE_SLUGS", "ODB_CONNECTOR_APP_TOOLS", "ODB_CONNECTOR_APP_TOOL_NAMES",
  "ODB_GATE_NAME", "ODB_GATE_UPSTREAM", "ODB_GATE_BUDGET", "ODB_GATE_SPILL_DIR", "ODB_GATE_SPILL_HINT", "ODB_GATE_TOOL_SCOPE",
  "ODB_GATE_DIRECTORY", "ODB_GATE_APPS", "ODB_REMOTE_MCP_SERVER", "ODB_REMOTE_MCP_DIRECTORY", "ODB_REMOTE_MCP_APPS",
  "ODB_CONTROL_URL", "ODB_CONTROL_TOKEN", "ODB_COMPUTER_JOURNAL", "ODB_CUA_ARGS", "ODB_CUA_COMMAND", "ODB_CUA_PLATFORM",
  "ODB_PHONE_TOKEN", "ODB_ADB_PATH", "ODB_RESOURCES_PATH", "ODB_CODEX_AUTH_SOCKET", "ODB_CODEX_AUTH_SECRET",
  "ODB_COPILOT_MCP_CONFIG", "ODB_BROWSER_PROFILE", "ODB_BOX_PROBE", "ODB_EXTRA_PATH", "ODB_TEST_SEALED_PATH",
]);
/** Families of the same, one variable per server or kind: a harness MCP server's token, a gated or remote server's config. */
export const BOX_ENV_ODB_PREFIXES: readonly string[] = ["ODB_MCP_TOKEN_", "ODB_GATE_CONFIG_", "ODB_REMOTE_MCP_CONFIG_"];

/** Prefixes of the engines' own settings and keys (T0b replaces the keys with per-turn broker tokens). */
export const BOX_ENV_PREFIXES: readonly string[] = [
  "LC_", "OPENDELIOBOT_", "NPM_CONFIG_", "npm_config_",
  "ANTHROPIC_", "CLAUDE_", "CODEX_", "OPENAI_", "OPENCODE_", "OPENROUTER_", "GEMINI_", "GOOGLE_", "GROK_", "XAI_",
  "MISTRAL_", "CEREBRAS_", "GROQ_", "GREENFERENCE_", "MODELGO_", "META_", "MINIMAX_", "KIMI_", "MOONSHOT_", "CURSOR_", "FACTORY_", "CLINE_", "HERMES_",
  "MUSE_", "PI_", "DWEB_", "UNSLOTH_", "FAKE_CLAUDE_", "MCP_", "ANTIGRAVITY_", "AGY_",
];

/** Never, whatever the allow-list says: the control plane's settings and secrets, and the server's own placement. The
 * CLI's session token and server address (server/headless/client.ts) too: nothing in a box reads them, and one an
 * operator set on the server would otherwise pass under the engines' OPENDELIOBOT_ prefix. */
export const BOX_ENV_NEVER: ReadonlySet<string> = new Set([
  "ODB_LICENSE_KEY", "ODB_INSTALLATION_CREDENTIAL", "ODB_LOOPBACK_TRUST", "ODB_CLOUD_SECRETS_FD",
  "ODB_DATA_DIR", "ODB_STATIC_DIR", "ODB_DUCKDB_DIR", "ODB_PORT", "ODB_WEBHOOK_PORT",
  "OPENDELIOBOT_TOKEN", "OPENDELIOBOT_URL",
]);
export const BOX_ENV_NEVER_PREFIXES: readonly string[] = ["ODB_CLOUD_"];

/** `allow` is what one spawn vouches for: the keys the person saved for its engine, under whatever name that engine reads
 * (NANO_GPT_API_KEY, OPENCODE_API_KEY). Security: it lifts the allow-list and `deny` for that process only, and never for
 * a name of OpenDeliobot's own (`ODB_`) or one on the never-list. */
export function boxEnvironmentAllows(name: string, deny: ReadonlySet<string> = new Set(), allow: ReadonlySet<string> = new Set()): boolean {
  if (BOX_ENV_NEVER.has(name) || BOX_ENV_NEVER_PREFIXES.some((prefix) => name.startsWith(prefix))) return false;
  if (allow.has(name) && !name.startsWith("ODB_")) return true;
  if (deny.has(name)) return false;
  if (name.startsWith("ODB_")) return BOX_ENV_ODB_NAMES.has(name) || BOX_ENV_ODB_PREFIXES.some((prefix) => name.startsWith(prefix));
  return BOX_ENV_NAMES.has(name) || BOX_ENV_PREFIXES.some((prefix) => name.startsWith(prefix));
}

/** The box's environment: the allowed names of `env` with a value, in a fresh object. `deny` adds names (the workspace
 * credentials) that are refused even when a prefix would allow them. */
export function boxEnvironment(
  env: Record<string, string | undefined>,
  deny: ReadonlySet<string> = new Set(),
  allow: ReadonlySet<string> = new Set(),
): Record<string, string> {
  const kept: Record<string, string> = {};
  for (const [name, value] of Object.entries(env)) {
    if (value === undefined || !boxEnvironmentAllows(name, deny, allow)) continue;
    kept[name] = value;
  }
  return kept;
}

/** The names of `env` that hold the value `instance` gave them: what the environment configured for one engine instance
 * (its saved keys) put in a spawn, for that spawn's `allowEnv`. */
export function instanceEnvNames(instance: Readonly<Record<string, string>>, env: Record<string, string | undefined>): string[] {
  return Object.keys(instance).filter((name) => env[name] !== undefined && env[name] === instance[name]);
}
