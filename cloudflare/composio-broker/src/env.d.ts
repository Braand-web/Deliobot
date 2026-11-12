// Secrets the Worker runs without: each one's route answers 503 or 404 until the owner sets it
// (README, "App events"). Not in wrangler.jsonc's secrets.required, which would refuse a deploy without them.
interface Env {
  /** Composio project key; when unset, the one saved through /setup is used. */
  COMPOSIO_API_KEY: string;
  /** Opens the one-time /setup page; 32 characters or more. */
  SETUP_TOKEN?: string;
  COMPOSIO_WEBHOOK_SECRET?: string;
  CLOUD_GRANT_SECRET?: string;
  STATS_TOKEN?: string;
  /** A var, not in wrangler.jsonc: the Cloud Admin's origin, which wakes a sleeping Cloud for its app events. */
  CLOUD_ADMIN_URL?: string;
}
