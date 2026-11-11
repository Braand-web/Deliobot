// Renders every expression of mascot.html to ../renders/<expression>.png at 1024 px.
// Needs Playwright's Chromium; serve this folder first: python3 -m http.server 8765
const { chromium } = require("playwright");
const fs = require("node:fs");
const path = require("node:path");

const EXPRESSIONS = ["idle", "happy", "thinking", "working", "surprised", "curious", "listening", "sad", "proud", "sleeping"];
const out = path.join(__dirname, "..", "renders");

(async () => {
  const browser = await chromium.launch({ args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
  const page = await browser.newPage({ viewport: { width: 1024, height: 1024 } });
  for (const expr of EXPRESSIONS) {
    await page.goto(`http://127.0.0.1:8765/mascot.html?expr=${expr}`);
    await page.waitForFunction("window.__done", null, { timeout: 120000 });
    const png = await page.evaluate("window.__png");
    fs.writeFileSync(path.join(out, `${expr}.png`), Buffer.from(png.split(",")[1], "base64"));
    console.log(`rendered ${expr}`);
  }
  await browser.close();
})();
