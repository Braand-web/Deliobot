import { rmSync } from "node:fs";
import { join } from "node:path";

/** Security: a Cursor sign-in saved by an older version may still be here. Nothing reads it, so no live token stays behind. */
export function removeOldCursorSignIn(dataDir: string): void {
  try {
    rmSync(join(dataDir, "cursor-session.json"), { force: true });
  } catch {
    // retried at the next start
  }
}
