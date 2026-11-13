import assert from "node:assert/strict";
import { test } from "node:test";

import { createZipUpdateCheck, feedVersion } from "./zip-update.mjs";

const feed = (body, status = 200) => async () => new Response(body, { status });

test("reads the version of an electron-builder feed", () => {
  assert.equal(feedVersion("version: 0.1.156\nfiles:\n  - url: x.exe\n"), "0.1.156");
  assert.equal(feedVersion("files: []"), null);
});

test("a ZIP copy offers the newer version to download, and opens the ZIP only then", async () => {
  const states = [];
  const opened = [];
  const check = createZipUpdateCheck({ fetchImpl: feed("version: 0.1.156\n"), currentVersion: "0.1.155", feedUrl: "https://feed/latest.yml",
    downloadUrl: "https://deliobot.fun/download/Deliobot-Windows.zip", setState: (patch) => states.push(patch), openExternal: (url) => opened.push(url) });
  await check.check(true);
  assert.deepEqual(states.at(-1), { status: "downloaded", version: "0.1.156", installMode: "download" });
  check.install();
  assert.deepEqual(opened, ["https://deliobot.fun/download/Deliobot-Windows.zip"]);
});

test("a ZIP copy on the latest version says so, and a feed failure is an error the person can retry", async () => {
  const states = [];
  const latest = createZipUpdateCheck({ fetchImpl: feed("version: 0.1.155\n"), currentVersion: "0.1.155", feedUrl: "f", downloadUrl: "d", setState: (p) => states.push(p), openExternal: () => assert.fail() });
  await latest.check(true);
  assert.equal(states.at(-1).status, "idle");
  latest.install();
  const failing = createZipUpdateCheck({ fetchImpl: feed("", 404), currentVersion: "0.1.155", feedUrl: "f", downloadUrl: "d", setState: (p) => states.push(p), openExternal: () => {} });
  await failing.check(true);
  assert.equal(states.at(-1).status, "error");
});
