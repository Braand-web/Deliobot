import { randomBytes } from "node:crypto";
import { mkdirSync } from "node:fs";
import { createServer } from "node:http";
import { dirname, resolve } from "node:path";

import { createAdminApp } from "./app.ts";
import { mascotAssets } from "./assets-node.ts";
import { portalSettings, type PortalSettings } from "./env-config.ts";
import { AdminStore } from "./store.ts";
import { nodeDatabase } from "./sql-node.ts";

function fail(message: string): never {
  console.error(`delio-admin: ${message}`);
  process.exit(1);
}

const env = process.env;
let settings: PortalSettings;
try { settings = portalSettings(env); } catch (error) { fail(error instanceof Error ? error.message : String(error)); }
for (const warning of settings.warnings) console.warn(`delio-admin: ${warning}`);
const { publicUrl, production, operators, mailer, gateway, payments, hosting, signup } = settings;
const secret = settings.secret ? Buffer.from(settings.secret) : randomBytes(32);

const file = resolve(env.DELIO_ADMIN_DB ?? "data/delio-admin.db");
mkdirSync(dirname(file), { recursive: true });
const store = new AdminStore({ db: nodeDatabase(file), secret });
const assets = mascotAssets();

const port = Number(env.PORT ?? 8790);
const host = env.HOST ?? (production ? "0.0.0.0" : "127.0.0.1");
const app = createAdminApp({ store, publicUrl, operators, mailer, gateway, payments, assets, ...(hosting ? { hosting } : {}), ...(signup ? { signup } : {}) });
const server = createServer(app);
const sweeper = setInterval(() => void app.sweep().catch((error: unknown) => console.error("delio-admin: billing sweep failed", error)), 60_000);
server.listen(port, host, () => console.log(`delio-admin: customers' portal on http://${host}:${port}, public at ${publicUrl.origin}`));

// Security: the operators' console listens on loopback only, never on a public address; operators reach it through an
// SSH tunnel, and it still lets in only DELIO_ADMIN_OPERATORS.
const consolePort = Number(env.DELIO_ADMIN_CONSOLE_PORT ?? port + 1);
if (!Number.isInteger(consolePort) || consolePort < 1 || consolePort > 65535 || consolePort === port) fail("DELIO_ADMIN_CONSOLE_PORT must be a free port other than PORT");
const consoleUrl = new URL(`http://127.0.0.1:${consolePort}`);
const consoleServer = createServer(createAdminApp({ store, publicUrl: consoleUrl, operators, mailer, payments, assets, console: true }));
consoleServer.listen(consolePort, "127.0.0.1", () => console.log(`delio-admin: operators' console on ${consoleUrl.origin} (loopback only)`));

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => { clearInterval(sweeper); consoleServer.close(); server.close(() => { store.close(); process.exit(0); }); });
}
