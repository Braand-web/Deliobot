import { describe, expect, it, vi } from "vitest";

import { SPAWNED_PROXIES } from "../proxy-paths.ts";
import { mountMcpServer } from "./codex-mcp-mount.ts";
import { acpOwnMcpOverHttp, claudeOwnMcpOverHttp, loopbackUnproxied, noteAcpMcpHttp, OWN_MCP_HTTP_ENV, ownMcpHttpEnabled, withLoopbackNoProxy } from "./own-mcp-http.ts";

const HARNESS = "http://127.0.0.1:8799";
const agents = { command: process.execPath, args: [SPAWNED_PROXIES.agents], env: { ODB_HARNESS_URL: HARNESS, ODB_COMMS_TOKEN: "comms", ODB_BOT_ID: "b1", ODB_THREAD_ID: "t1", ODB_AGENTS_DEFER_TOOLS: "1", ELECTRON_RUN_AS_NODE: "1" } };
const browser = { command: process.execPath, args: [SPAWNED_PROXIES.harnessMcp, "browser"], env: { ODB_HARNESS_URL: HARNESS, ODB_MCP_TOKEN_BROWSER: "browse", ODB_TOOL_LIMIT: "12" } };
const odb = { command: process.execPath, args: [SPAWNED_PROXIES.permission, "/tmp/perm.sock"], env: {}, alwaysLoad: true };
const phone = { command: process.execPath, args: ["/app/phone-proxy.js"], env: { ODB_HARNESS_URL: HARNESS, ODB_PHONE_TOKEN: "p" } };
const settings = (header: string) => JSON.parse(Buffer.from(header, "base64url").toString("utf8"));

describe("the setting", () => {
  it("is off unless ODB_OWN_MCP_HTTP=1, everywhere, and always off in the bot box", () => {
    expect(ownMcpHttpEnabled({}, false)).toBe(false);
    expect(ownMcpHttpEnabled({ ODB_CLOUD_ROLE: "home" }, false)).toBe(false);
    expect(ownMcpHttpEnabled({ [OWN_MCP_HTTP_ENV]: "0" }, false)).toBe(false);
    expect(ownMcpHttpEnabled({ [OWN_MCP_HTTP_ENV]: "true" }, false)).toBe(false);
    expect(ownMcpHttpEnabled({ [OWN_MCP_HTTP_ENV]: "1" }, false)).toBe(true);
    expect(ownMcpHttpEnabled({ [OWN_MCP_HTTP_ENV]: "1" }, true)).toBe(false);
  });
});

describe("an engine set up to use a proxy", () => {
  it("reaches this server's loopback URL directly: the loopback names join NO_PROXY and no_proxy, keeping what either held", () => {
    const env: Record<string, string | undefined> = { HTTPS_PROXY: "http://proxy.internal:3128", NO_PROXY: "corp.internal, localhost", no_proxy: ".lan" };
    withLoopbackNoProxy(env);
    expect(env.NO_PROXY).toBe("corp.internal,localhost,.lan,127.0.0.1,::1");
    expect(env.no_proxy).toBe(env.NO_PROXY);
    withLoopbackNoProxy(env);
    expect(env.NO_PROXY).toBe("corp.internal,localhost,.lan,127.0.0.1,::1");
    const bare: Record<string, string | undefined> = {};
    withLoopbackNoProxy(bare);
    expect(bare).toEqual({ NO_PROXY: "127.0.0.1,localhost,::1", no_proxy: "127.0.0.1,localhost,::1" });
  });

  it("is left alone by an ACP engine that keeps the stdio form", () => {
    const env: Record<string, string | undefined> = { NO_PROXY: "corp.internal" };
    expect(loopbackUnproxied(env, false)).toBe(false);
    expect(env).toEqual({ NO_PROXY: "corp.internal" });
    expect(loopbackUnproxied(env, true)).toBe(true);
    expect(env.NO_PROXY).toBe("corp.internal,127.0.0.1,localhost,::1");
  });
});

describe("Claude's --mcp-config", () => {
  it("gets OpenDeliobot's own proxies by URL with their capability, settings, tool limit and alwaysLoad; nothing else changes", () => {
    const servers: Record<string, unknown> = { agents: { ...agents, alwaysLoad: true }, browser, odb, phone, mine: { command: "npx", args: ["my-server"] } };
    expect(claudeOwnMcpOverHttp(servers, true)).toBe(true);
    expect(servers.agents).toEqual({ type: "http", url: `${HARNESS}/api/internal/mcp-http/agents`, alwaysLoad: true,
      headers: { authorization: "Bearer comms", "x-odb-agents-env": expect.any(String) } });
    expect(settings((servers.agents as { headers: Record<string, string> }).headers["x-odb-agents-env"]!)).toEqual({ ODB_BOT_ID: "b1", ODB_THREAD_ID: "t1", ODB_AGENTS_DEFER_TOOLS: "1" });
    expect(servers.browser).toEqual({ type: "http", url: `${HARNESS}/api/internal/mcp-http/browser`, headers: { authorization: "Bearer browse", "x-odb-tool-limit": "12" } });
    expect(servers.odb).toBe(odb);
    expect(servers.phone).toBe(phone);
    expect(servers.mine).toEqual({ command: "npx", args: ["my-server"] });
  });

  it("is left as it is with the setting off", () => {
    const servers: Record<string, unknown> = { agents, browser };
    expect(claudeOwnMcpOverHttp(servers, false)).toBe(false);
    expect(servers).toEqual({ agents, browser });
    expect(claudeOwnMcpOverHttp({ phone }, true)).toBe(false);
  });
});

describe("Codex's own servers", () => {
  it("mount by URL with the token named, never written, in argv", () => {
    vi.stubEnv(OWN_MCP_HTTP_ENV, "1");
    try {
      const args: string[] = [];
      const env: Record<string, string | undefined> = { NO_PROXY: "corp.internal" };
      mountMcpServer(args, env, "agents", agents, "approve");
      const joined = args.join(" ");
      expect(joined).toContain(`mcp_servers.agents.url="${HARNESS}/api/internal/mcp-http/agents"`);
      expect(joined).toContain('mcp_servers.agents.bearer_token_env_var="ODB_COMMS_TOKEN"');
      expect(joined).toContain('mcp_servers.agents.http_headers={ "x-odb-agents-env" = ');
      expect(joined).toContain('mcp_servers.agents.default_tools_approval_mode="approve"');
      expect(joined).not.toContain("comms");
      expect(joined).not.toContain("command=");
      expect(env.ODB_COMMS_TOKEN).toBe("comms");
      expect([env.NO_PROXY, env.no_proxy]).toEqual(["corp.internal,127.0.0.1,localhost,::1", "corp.internal,127.0.0.1,localhost,::1"]);
      const stdio: string[] = [];
      const stdioEnv: Record<string, string | undefined> = {};
      mountMcpServer(stdio, stdioEnv, "notes", { command: "npx", args: ["notes"], env: { KEY: "k" } });
      expect(stdio.join(" ")).toContain('mcp_servers.notes.command="npx"');
      expect(stdioEnv.NO_PROXY).toBeUndefined();
    } finally {
      vi.unstubAllEnvs();
    }
  });
});

describe("an ACP engine", () => {
  it("gets the URL form once its agent said it takes MCP servers by URL, and not when its servers come from its launcher", () => {
    expect(acpOwnMcpOverHttp("gemini-test", false, true)).toBe(false);
    noteAcpMcpHttp("gemini-test", { agentCapabilities: { mcpCapabilities: { http: true, sse: false } } });
    expect(acpOwnMcpOverHttp("gemini-test", false, true)).toBe(true);
    expect(acpOwnMcpOverHttp("gemini-test", true, true)).toBe(false);
    expect(acpOwnMcpOverHttp("gemini-test", false, false)).toBe(false);
    noteAcpMcpHttp("gemini-test", { agentCapabilities: {} });
    expect(acpOwnMcpOverHttp("gemini-test", false, true)).toBe(false);
  });
});
