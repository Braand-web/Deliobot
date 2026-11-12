/** Names Deliobot gives its own MCP servers; a custom server may not take one. */
export const RESERVED_MCP_NAMES: ReadonlySet<string> = new Set([
  "odb",
  "computer",
  "agents",
  "composio",
  "data",
  "browser",
  "email",
  "device",
  "phone",
  "dweb",
  "opendeliobot_connectors",
  "opendeliobot_phone",
]);

/** A server name from any text: lowercase letters, numbers, `_` and `-`, starting with a letter, at most 32. */
export function slugMcpName(raw: string): string {
  const slug = raw.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 32).replace(/-+$/, "");
  return /^[a-z]/.test(slug) ? slug : slug ? `mcp-${slug}`.slice(0, 32).replace(/-+$/, "") : "";
}

/** What Deliobot names a server another tool calls `raw`; a name Deliobot keeps for itself gets an mcp- prefix. */
export function importedMcpServerName(raw: string): string {
  const slug = slugMcpName(raw);
  return RESERVED_MCP_NAMES.has(slug) ? `mcp-${slug}`.slice(0, 32) : slug;
}
