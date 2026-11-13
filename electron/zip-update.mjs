// A Windows copy unpacked from the ZIP cannot replace itself (the installer would put a second copy elsewhere), so it
// only looks for a newer version and offers the new ZIP to download.
import { isNewerVersion } from "./updater-coordinator.mjs";

const FEED_TIMEOUT_MS = 15_000;

/** The `version:` line of an electron-builder feed (latest.yml), or null. */
export function feedVersion(text) {
  const found = /^version:\s*['"]?([0-9][0-9A-Za-z.+-]*)['"]?\s*$/m.exec(String(text ?? ""));
  return found ? found[1] : null;
}

/**
 * @param {{ fetchImpl: typeof fetch, currentVersion: string, feedUrl: string, downloadUrl: string,
 *   setState: (patch: Record<string, unknown>) => void, openExternal: (url: string) => Promise<void> | void }} deps
 */
export function createZipUpdateCheck(deps) {
  let running = null;
  let found = null;
  const check = () => {
    if (running) return running;
    deps.setState({ status: "checking", installMode: "download", message: undefined });
    running = (async () => {
      try {
        const response = await deps.fetchImpl(deps.feedUrl, { cache: "no-store", signal: AbortSignal.timeout(FEED_TIMEOUT_MS) });
        if (!response.ok) throw new Error(`the update feed answered ${response.status}`);
        const version = feedVersion(await response.text());
        if (!version) throw new Error("the update feed names no version");
        found = isNewerVersion(version, deps.currentVersion) ? version : null;
        deps.setState(found ? { status: "downloaded", version: found, installMode: "download" } : { status: "idle", installMode: "download" });
      } catch (error) {
        deps.setState({ status: "error", installMode: "download", messageCode: "network", message: error instanceof Error ? error.message : String(error) });
      } finally {
        running = null;
      }
    })();
    return running;
  };
  return {
    check,
    /** Opens the new ZIP's download in the browser; nothing is replaced here. */
    install: () => { if (found) void Promise.resolve(deps.openExternal(deps.downloadUrl)).catch(() => {}); },
  };
}
