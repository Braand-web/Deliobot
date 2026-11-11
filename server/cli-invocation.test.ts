import { describe, expect, it } from "vitest";

import { cliCommand, cliPrefix } from "./cli-invocation.ts";

describe("cliPrefix", () => {
  it("prints commands the way the CLI was started", () => {
    expect(cliPrefix({}, "/home/me/.npm/_npx/1a2b/node_modules/opendeliobot/dist-server/opendeliobot.js")).toBe("npx opendeliobot");
    expect(cliPrefix({ npm_command: "exec" }, "/repo/node_modules/vitest/vitest.mjs"), "another tool run by npx").toBe("opendeliobot");
    expect(cliPrefix({ npm_lifecycle_event: "odb" }, "/repo/server/opendeliobot.ts")).toBe("pnpm odb");
    expect(cliPrefix({ ODB_CLI_PREFIX: "docker compose exec odb opendeliobot" }, "/app/dist-server/opendeliobot.js")).toBe("docker compose exec odb opendeliobot");
    expect(cliPrefix({}, "/usr/lib/node_modules/opendeliobot/dist-server/opendeliobot.js")).toBe("opendeliobot");
    expect(cliCommand("pair", {}, "C:\\Users\\me\\AppData\\Local\\npm-cache\\_npx\\9\\node_modules\\opendeliobot\\x.js")).toBe("npx opendeliobot pair");
  });
});
