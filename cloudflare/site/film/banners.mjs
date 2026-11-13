// Renders the Facebook cover and the YouTube channel banner from banners.html, at the sizes each site asks for.
//   node cloudflare/site/film/banners.mjs <output folder> [--guides]
// --guides draws the area every device shows, to check the layout; the files to upload are rendered without it.
import { mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";

const [out, flag] = process.argv.slice(2);
if (!out) throw new Error("usage: node banners.mjs <output folder> [--guides]");
mkdirSync(out, { recursive: true });
const { chromium } = createRequire(import.meta.url)("playwright");
const SIZES = { facebook: [1640, 624], youtube: [2560, 1440] };

const browser = await chromium.launch();
for (const [kind, [width, height]] of Object.entries(SIZES)) {
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
  const url = new URL("./banners.html", import.meta.url);
  url.searchParams.set("kind", kind);
  if (flag === "--guides") url.searchParams.set("guides", "1");
  await page.goto(url.href);
  await page.evaluate(() => window.ready);
  const file = join(out, `deliobot-${kind}${flag === "--guides" ? "-guides" : ""}.png`);
  await page.screenshot({ path: file, clip: { x: 0, y: 0, width, height } });
  console.log(file);
}
await browser.close();
