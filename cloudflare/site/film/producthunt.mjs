// Renders the Product Hunt gallery from producthunt.html: six 1270×760 images and the 240×240 thumbnail.
//   node cloudflare/site/film/producthunt.mjs <output folder>
import { mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";

const [out] = process.argv.slice(2);
if (!out) throw new Error("usage: node producthunt.mjs <output folder>");
mkdirSync(out, { recursive: true });
const { chromium } = createRequire(import.meta.url)("playwright");
const GALLERY = 6;

const browser = await chromium.launch();
for (let slide = 1; slide <= GALLERY + 1; slide++) {
  const thumbnail = slide > GALLERY;
  const size = thumbnail ? { width: 240, height: 240 } : { width: 1270, height: 760 };
  const page = await browser.newPage({ viewport: size, deviceScaleFactor: 1 });
  const url = new URL("./producthunt.html", import.meta.url);
  url.searchParams.set("slide", String(slide));
  await page.goto(url.href);
  await page.evaluate(() => window.ready);
  const file = join(out, thumbnail ? "deliobot-ph-thumbnail.png" : `deliobot-ph-${slide}.png`);
  await page.screenshot({ path: file, clip: { x: 0, y: 0, ...size } });
  console.log(file);
}
await browser.close();
