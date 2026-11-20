const BUSY_CODES = new Set(["thread_busy", "thread_limit", "settling"]);
export const BUSY_RETRY_MS = 500;
export const BUSY_WAIT_MS = 2 * 60_000;

/** Starts a turn, waiting while the conversation or the bot is busy, up to `waitMs`. False when it never started. */
export async function startWhenFree(start: () => Promise<unknown>, opts: { sleep?: (ms: number) => Promise<void>; waitMs?: number; onAttempt?: () => void; onRefused?: () => void } = {}): Promise<boolean> {
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const deadline = Date.now() + (opts.waitMs ?? BUSY_WAIT_MS);
  for (;;) {
    opts.onAttempt?.();
    try {
      await start();
      return true;
    } catch (error) {
      opts.onRefused?.();
      const code = (error as { code?: unknown } | null)?.code;
      if (typeof code === "string" && BUSY_CODES.has(code) && Date.now() < deadline) {
        await sleep(BUSY_RETRY_MS);
        continue;
      }
      return false;
    }
  }
}
