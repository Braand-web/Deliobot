import { withFailedCallHint } from "./connector-scope-hint.ts";

const DISABLED_URL_READER = /Execution of tool\s+\\?["']COMPOSIO_SEARCH_FETCH_URL_CONTENT\\?["']\s+is temporarily disabled by the administrator\b/i;

const PUBLIC_WEB_READ_HINT = "Deliobot note: Composio has disabled its COMPOSIO_SEARCH_FETCH_URL_CONTENT tool. Do not retry that tool or change its administrator settings. This service-specific refusal does not establish that Deliobot's native URL reader, separate built-in browser or the requested public website is disabled. For a user-requested public-page check, including a routine the user configured, use read_public_url when listed and permitted, or agent_browser_open and agent_browser_read when those tools are mounted and permitted. These readers do not require a Composio connection. Respect a disabled browser, denied tool permissions, sign-in requirements and human checks; do not substitute the person's computer without authorization. If no permitted reader is available, report that specific limitation, not a general administrator ban or a website outage.";

export function withPublicWebReadHint(bytes: Uint8Array, contentType: string): Uint8Array {
  return withFailedCallHint(bytes, contentType, DISABLED_URL_READER, () => PUBLIC_WEB_READ_HINT, []);
}
