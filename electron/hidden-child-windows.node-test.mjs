import assert from "node:assert/strict";
import test from "node:test";
import { promisify } from "node:util";

import { hideChildWindows, withHiddenWindow } from "./hidden-child-windows.mjs";

const callback = () => {};

test("adds windowsHide to every call shape and keeps an explicit choice", () => {
  assert.deepEqual(withHiddenWindow(["git"]), ["git", { windowsHide: true }]);
  assert.deepEqual(withHiddenWindow(["git", ["status"]]), ["git", ["status"], { windowsHide: true }]);
  assert.deepEqual(withHiddenWindow(["git", ["status"], { cwd: "/x" }]), ["git", ["status"], { cwd: "/x", windowsHide: true }]);
  assert.deepEqual(withHiddenWindow(["dir", callback]), ["dir", { windowsHide: true }, callback]);
  assert.deepEqual(withHiddenWindow(["git", ["log"], callback]), ["git", ["log"], { windowsHide: true }, callback]);
  assert.deepEqual(withHiddenWindow(["git", ["log"], { windowsHide: false }]), ["git", ["log"], { windowsHide: false }]);
});

test("wraps the process functions on Windows only, once, and keeps promisified execFile's shape", async () => {
  const seen = [];
  const execFile = (...args) => seen.push(args);
  execFile[promisify.custom] = async (...args) => { seen.push(args); return { stdout: "ok", stderr: "" }; };
  const target = { spawn: (...args) => seen.push(args), execFile };
  assert.equal(hideChildWindows({ platform: "linux", target }), false);
  assert.equal(target.execFile, execFile);
  assert.equal(hideChildWindows({ platform: "win32", target }), true);
  assert.equal(hideChildWindows({ platform: "win32", target }), false);
  target.spawn("node", ["-v"]);
  assert.deepEqual(await promisify(target.execFile)("node", ["-v"]), { stdout: "ok", stderr: "" });
  assert.deepEqual(seen, [["node", ["-v"], { windowsHide: true }], ["node", ["-v"], { windowsHide: true }]]);
});
