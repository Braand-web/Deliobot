// Windows opens a console window for every child process started without `windowsHide: true` (Node child_process
// options), and with Windows Terminal as the default console that window stays open beside the app. Importing this
// module first makes hidden windows the default for every spawn in the process; an explicit `windowsHide: false` is kept.
import childProcess from "node:child_process";
import { syncBuiltinESMExports } from "node:module";
import { promisify } from "node:util";

const LAUNCHERS = ["spawn", "exec", "execFile"];
const NAMES = [...LAUNCHERS, ...LAUNCHERS.map((name) => `${name}Sync`), "fork"];
const WRAPPED = Symbol.for("deliobot.hiddenChildWindows");

const isOptions = (value) => value !== null && typeof value === "object" && !Array.isArray(value);

/** The same call arguments with `windowsHide: true` in its options, added when the call passed none. */
export function withHiddenWindow(args) {
  const next = [...args];
  for (let index = 1; index < next.length; index++) {
    if (!isOptions(next[index])) continue;
    if (next[index].windowsHide === undefined) next[index] = { ...next[index], windowsHide: true };
    return next;
  }
  const at = typeof next.at(-1) === "function" ? next.length - 1 : next.length;
  next.splice(Math.max(1, at), 0, { windowsHide: true });
  return next;
}

export function hideChildWindows({ platform = process.platform, target = childProcess } = {}) {
  if (platform !== "win32" || target[WRAPPED]) return false;
  for (const name of NAMES) {
    const original = target[name];
    if (typeof original !== "function") continue;
    const wrapped = function (...args) { return original.apply(this, withHiddenWindow(args)); };
    const custom = original[promisify.custom];
    if (typeof custom === "function") wrapped[promisify.custom] = (...args) => custom.apply(original, withHiddenWindow(args));
    target[name] = wrapped;
  }
  target[WRAPPED] = true;
  if (target === childProcess) syncBuiltinESMExports();
  return true;
}

hideChildWindows();
