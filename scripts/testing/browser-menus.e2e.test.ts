import { mkdtempSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir, userInfo } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { resolveAgentBrowserBinary } from "../../server/browser-engine.ts";
import { ChromeLauncher } from "../../server/browser/chrome/launcher.ts";
import { chromeHost, installedGoogleChrome, isHeadlessShell } from "../../server/browser/chrome/resolve.ts";
import { removeTempDir } from "../../server/testing/cleanup.ts";
import { withBotBrowser, type BotCall } from "../verify-browser-identity.ts";
import { ensureUiBrowser, UI_TOOLS_DIR } from "./control-odb-ui.ts";

const enabled = process.env.ODB_UI_E2E === "1" || Boolean(resolveAgentBrowserBinary({ dataDir: UI_TOOLS_DIR, env: process.env }));
if (!enabled) console.log(`skipping browser menus e2e: no agent-browser binary resolves (looked in ${UI_TOOLS_DIR}, ODB_AGENT_BROWSER_PATH and PATH); set ODB_UI_E2E=1 to install the pinned release`);
const out = mkdtempSync(join(tmpdir(), "odb-menus-e2e-"));
afterAll(async () => { await removeTempDir(out); });

const PAGE = `<!doctype html><html><head><meta charset="utf-8"><title>menus</title><style>
#menu{display:none;position:absolute;top:120px;left:20px;background:#fff;border:1px solid #888;padding:6px}
#menu.open{display:block}</style></head><body>
<select id="native" style="margin:20px;font-size:18px"><option value="a">Alpha</option><option value="b">Beta</option><option value="c">Gamma</option></select>
<button id="open-menu" style="margin:20px;font-size:18px" onclick="document.getElementById('menu').classList.toggle('open')">Menu</button>
<div id="menu" role="menu"><div role="menuitem" id="item" onclick="document.title='picked'">Item</div></div>
<script>window.__loaded = (window.__loaded || 0) + 1; window.__stamp = Math.random().toString(36).slice(2);</script>
</body></html>`;

async function realBrowser(): Promise<{ engine: string; chrome: string }> {
  const home = userInfo().homedir;
  const plan = new ChromeLauncher({ dataDir: out, env: { ...process.env, HOME: home, USERPROFILE: home }, engine: () => ({ managed: true }), log: () => {} }).plan();
  const picked = process.env.ODB_CHROME_PATH?.trim() || (plan.kind === "chrome" ? plan.chrome.path : null);
  const engine = picked ? resolveAgentBrowserBinary({ dataDir: UI_TOOLS_DIR, env: process.env }) : null;
  const browser = engine ? { binary: engine, chrome: picked } : await ensureUiBrowser(process.env, () => {}, UI_TOOLS_DIR);
  const chrome = picked || browser.chrome || installedGoogleChrome(chromeHost({ dataDir: out, env: { ...process.env, HOME: home, USERPROFILE: home } }));
  if (!chrome || isHeadlessShell(chrome)) throw new Error(`a full Chrome is needed, not ${chrome ?? "nothing"}: set ODB_CHROME_PATH`);
  return { engine: browser.binary, chrome };
}

const text = (value: unknown) => JSON.stringify(value);

/** The page's stamp: a reload, a crash or a fresh tab gives a new one. */
async function stamp(call: BotCall): Promise<string> {
  return text(await call("agent_browser_eval", { script: "JSON.stringify([window.__stamp, window.__loaded, location.pathname])" }));
}

describe.skipIf(!enabled)("a bot's browser opening menus on a real Chrome", () => {
  it("keeps the same page and the same browser through a native select, a script menu and a right-click", async () => {
    const server = createServer((_req, res) => { res.writeHead(200, { "content-type": "text/html; charset=utf-8" }); res.end(PAGE); });
    await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
    const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/menus`;
    try {
      const { engine, chrome } = await realBrowser();
      const log: string[] = [];
      await withBotBrowser({ engine, chrome, out, sessionPrefix: "odb-menus", log: (line) => log.push(line) }, async (call) => {
        await call("agent_browser_open", { url });
        await call("agent_browser_wait_for_selector", { selector: "#open-menu" });
        const first = await stamp(call);
        const steps: Array<[string, () => Promise<unknown>]> = [
          ["click the native select", () => call("agent_browser_click", { selector: "#native" })],
          ["press Escape", () => call("agent_browser_press", { key: "Escape" })],
          ["choose in the native select", () => call("agent_browser_select", { selector: "#native", values: ["b"] })],
          ["click the script menu", () => call("agent_browser_click", { selector: "#open-menu" })],
          ["click its item", () => call("agent_browser_click", { selector: "#item" })],
          ["right-click the page", () => call("agent_browser_click", { selector: "#open-menu", button: "right" })],
          ["press Escape", () => call("agent_browser_press", { key: "Escape" })],
        ];
        for (const [step, run] of steps) {
          const answer = text(await run());
          expect(answer, `${step}: ${answer}`).not.toMatch(/stopped unexpectedly|started it again|crash/iu);
          expect(await stamp(call), `${step} reloaded or replaced the page`).toBe(first);
        }
        expect(text(await call("agent_browser_eval", { script: "document.title + '|' + document.getElementById('native').value" }))).toContain("picked|b");
      });
      expect(log.filter((line) => /exited unexpectedly/u.test(line))).toEqual([]);
    } finally {
      await new Promise<void>((done) => server.close(() => done()));
    }
  }, 240_000);
});
