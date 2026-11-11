// Side-effect import that scrubs ambient ODB env before a module snapshots it (scripts/mcp-server.ts reads
// OPENDELIOBOT_URL / ODB_PORT at evaluation). Import order is the contract: keep it above the module under test.
import { isAmbientOdbKey } from "./odb-env.ts";

for (const key of Object.keys(process.env)) {
  if (isAmbientOdbKey(key)) delete process.env[key];
}
