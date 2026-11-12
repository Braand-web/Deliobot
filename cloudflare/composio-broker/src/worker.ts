import { WorkerEntrypoint } from "cloudflare:workers";

import { runHourly } from "./app-events";
import handler from "./index";
import { withSavedKeys } from "./setup";

export default handler;

/**
 * The hourly sweep for an account without a cron slot left: another Worker of the same account calls `run()` through a
 * service binding to this entrypoint, which the Internet cannot reach.
 */
export class HourlySweep extends WorkerEntrypoint<Env> {
  async run(): Promise<void> {
    await runHourly(await withSavedKeys(this.env), Date.now());
  }
}
