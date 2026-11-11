/** How this CLI was started, so every command it prints can be pasted as is: `npx opendeliobot`, `pnpm odb` in a
 * checkout, the Docker image's `docker compose exec odb opendeliobot` (ODB_CLI_PREFIX), or plain `opendeliobot`. */
export function cliPrefix(env: NodeJS.ProcessEnv = process.env, script = process.argv[1] ?? ""): string {
  const fixed = env.ODB_CLI_PREFIX?.trim();
  if (fixed) return fixed;
  if (env.npm_lifecycle_event === "odb") return "pnpm odb";
  // npm 7+ runs an `npx` package from its cache's `_npx` folder (npm_command=exec alone also marks `npx vitest`).
  if (/[\\/]_npx[\\/]/.test(script)) return "npx opendeliobot";
  return "opendeliobot";
}

/** `opendeliobot <rest>` the way this CLI was started. */
export function cliCommand(rest: string, env?: NodeJS.ProcessEnv, script?: string): string {
  return `${cliPrefix(env, script)} ${rest}`;
}
