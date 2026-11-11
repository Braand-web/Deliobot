// What crosses from the launching shell into a fixture server: only what a
// test scripted on purpose. A real OpenAI key must never reach a fixture that
// could send it to OpenAI.
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";

import { verificationServerEnvironment } from "./control-odb.ts";

const childEnv = (parentEnv: NodeJS.ProcessEnv) => verificationServerEnvironment(parentEnv, join(tmpdir(), "odb-fixture-env"), 9100);

describe("a fixture driven from a real browser", () => {
  it("trusts this machine's browsers as `pnpm dev` does, unless the caller tests the sign-in", () => {
    expect(childEnv({}).ODB_DEV_TRUST_LOCAL_BROWSER).toBe("1");
    expect(childEnv({ ODB_DEV_TRUST_LOCAL_BROWSER: "0" })).not.toHaveProperty("ODB_DEV_TRUST_LOCAL_BROWSER");
  });
});

describe("the fixture's fake engine knobs", () => {
  it("lets the Claude fake's knobs and the Codex fake's background-call knobs cross, and nothing else", () => {
    const env = childEnv({
      FAKE_CLAUDE_TEXT_ROUTES: "/tmp/routes.json", FAKE_CODEX_TEXT_ROUTES: "/tmp/codex-routes.json", FAKE_CODEX_TEXT_LOG: "/tmp/codex.jsonl",
      FAKE_CODEX_MODE: "approval", FAKE_CODEX_DUMP: "/tmp/codex-dump.json", SOME_SECRET: "x",
    });
    expect(env).toMatchObject({ FAKE_CLAUDE_TEXT_ROUTES: "/tmp/routes.json", FAKE_CODEX_TEXT_ROUTES: "/tmp/codex-routes.json", FAKE_CODEX_TEXT_LOG: "/tmp/codex.jsonl" });
    for (const key of ["FAKE_CODEX_MODE", "FAKE_CODEX_DUMP", "SOME_SECRET"]) expect(env, key).not.toHaveProperty(key);
  });
});

describe("the fixture's Live call environment", () => {
  it("passes a loopback fake GPT-Live and its key through", () => {
    expect(childEnv({ ODB_OPENAI_LIVE_URL: " http://127.0.0.1:4100 ", ODB_OPENAI_LIVE_KEY: "sk-fake" }))
      .toMatchObject({ ODB_OPENAI_LIVE_URL: "http://127.0.0.1:4100", ODB_OPENAI_LIVE_KEY: "sk-fake" });
    const noKey = childEnv({ ODB_OPENAI_LIVE_URL: "http://127.0.0.1:4100" });
    expect(noKey.ODB_OPENAI_LIVE_URL).toBe("http://127.0.0.1:4100");
    expect(noKey).not.toHaveProperty("ODB_OPENAI_LIVE_KEY");
  });

  it("drops any other Live URL, and never lets the key cross without the fake", () => {
    for (const url of ["https://api.openai.com", "http://localhost:4100", "http://127.0.0.1:4100/v1", "http://192.0.2.1:4100", "http://127.0.0.1", ""]) {
      const env = childEnv({ ODB_OPENAI_LIVE_URL: url, ODB_OPENAI_LIVE_KEY: "sk-real" });
      expect(env, url).not.toHaveProperty("ODB_OPENAI_LIVE_URL");
      expect(env, url).not.toHaveProperty("ODB_OPENAI_LIVE_KEY");
    }
    expect(childEnv({ ODB_OPENAI_LIVE_KEY: "sk-real" })).not.toHaveProperty("ODB_OPENAI_LIVE_KEY");
  });
});

describe("the fixture's X research relay", () => {
  it("passes a loopback relay stub and its token through, the token only with the stub", () => {
    expect(childEnv({ ODB_CLOUD_X_URL: " http://127.0.0.1:4200/api/cloud/services/x ", ODB_CLOUD_X_TOKEN: "odb_x_fixture" }))
      .toMatchObject({ ODB_CLOUD_X_URL: "http://127.0.0.1:4200/api/cloud/services/x", ODB_CLOUD_X_TOKEN: "odb_x_fixture" });
    for (const url of ["https://cloud.opendeliobot.com/api/cloud/services/x", "http://localhost:4200/api/cloud/services/x", "http://192.0.2.1:4200", "http://127.0.0.1:4200/../x?y", ""]) {
      const env = childEnv({ ODB_CLOUD_X_URL: url, ODB_CLOUD_X_TOKEN: "odb_x_real" });
      expect(env, url).not.toHaveProperty("ODB_CLOUD_X_URL");
      expect(env, url).not.toHaveProperty("ODB_CLOUD_X_TOKEN");
    }
    expect(childEnv({ ODB_TREG_URL: " http://127.0.0.1:4300 " })).toMatchObject({ ODB_TREG_URL: "http://127.0.0.1:4300" });
    for (const url of ["https://treg.to", "http://localhost:4300", "http://127.0.0.1:4300/x", ""]) expect(childEnv({ ODB_TREG_URL: url }), url).not.toHaveProperty("ODB_TREG_URL");
  });
});

describe("the fixture's @devs reports", () => {
  it("go to a loopback fake endpoint, else to a closed port: never to the Delio team", () => {
    const closed = "http://127.0.0.1:9/api/bug-reports";
    expect(childEnv({ ODB_BUG_REPORT_URL: " http://127.0.0.1:4400/api/bug-reports " }).ODB_BUG_REPORT_URL).toBe("http://127.0.0.1:4400/api/bug-reports");
    for (const url of ["https://cloud.opendeliobot.com/api/bug-reports", "http://localhost:4400/api/bug-reports", "http://192.0.2.1:4400/x", "http://127.0.0.1:4400/../x?y", ""]) {
      expect(childEnv({ ODB_BUG_REPORT_URL: url }).ODB_BUG_REPORT_URL, url).toBe(closed);
    }
    expect(childEnv({}).ODB_BUG_REPORT_URL).toBe(closed);
  });
});
