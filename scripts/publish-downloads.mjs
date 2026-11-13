// Puts a release's Windows and Linux builds on deliobot.fun: the files, then the fixed download links the site's buttons
// use, then a check that every file reads back unchanged, and only then the update feeds the installed apps read.
//   node scripts/publish-downloads.mjs <folder with both builds' artifacts> [--dry-run]
// The upload key comes from DELIO_UPLOAD_TOKEN and is only ever sent to deliobot.fun.
import { createHash } from "node:crypto";
import { closeSync, existsSync, openSync, readFileSync, readSync, statSync } from "node:fs";
import { join } from "node:path";

const SITE = "https://deliobot.fun";
const PART = 50 * 1024 * 1024;
const [folder, flag] = process.argv.slice(2);
const dryRun = flag === "--dry-run";
if (!folder) throw new Error("usage: node scripts/publish-downloads.mjs <folder> [--dry-run]");

/** The `version:` line of an electron-builder feed. */
function feedVersion(text) {
  return /^version:\s*['"]?([0-9][0-9A-Za-z.+-]*)['"]?\s*$/m.exec(text)?.[1] ?? null;
}

const read = (name) => readFileSync(join(folder, name), "utf8");
const version = feedVersion(read("latest.yml"));
if (!version || feedVersion(read("latest-linux.yml")) !== version) throw new Error("latest.yml and latest-linux.yml must name the same version");

const versioned = [`OpenDeliobot-${version}-setup.exe`, `OpenDeliobot-${version}-setup.exe.blockmap`, `OpenDeliobot-${version}-x86_64.AppImage`,
  `OpenDeliobot-${version}-amd64.deb`, "SHA256SUMS-ubuntu-x64.txt"].map((file) => [file, `download/latest/${file}`]);
const links = [[`OpenDeliobot-${version}-setup.exe`, "download/Deliobot-Setup.exe"], [`OpenDeliobot-${version}-x64.zip`, "download/Deliobot-Windows.zip"],
  [`OpenDeliobot-${version}-amd64.deb`, "download/Deliobot.deb"], [`OpenDeliobot-${version}-x86_64.AppImage`, "download/Deliobot.AppImage"]];
const feeds = [["latest.yml", "download/latest/latest.yml"], ["latest-linux.yml", "download/latest/latest-linux.yml"]];
for (const [file] of [...versioned, ...links, ...feeds]) if (!existsSync(join(folder, file))) throw new Error(`missing ${file}`);

const token = process.env.DELIO_UPLOAD_TOKEN ?? "";
const auth = { authorization: `Bearer ${token}` };

async function call(url, init, tries = 5) {
  for (let attempt = 1; ; attempt += 1) {
    try {
      const response = await fetch(url, init);
      if (response.ok) return response.json();
      const text = await response.text();
      if (attempt >= tries || response.status < 500) throw new Error(`${response.status} ${text.slice(0, 200)}`);
    } catch (error) {
      if (attempt >= tries) throw error;
    }
    await new Promise((done) => setTimeout(done, 2000 * attempt));
  }
}

async function upload(file, key) {
  if (dryRun) return console.log(`would upload ${file} → ${key}`);
  const base = `${SITE}/__upload/${key}`;
  const size = statSync(join(folder, file)).size;
  const { id } = await call(`${base}?start`, { method: "POST", headers: auth });
  const parts = [];
  const fd = openSync(join(folder, file), "r");
  try {
    for (let number = 1, offset = 0; offset < size; number += 1, offset += PART) {
      const chunk = Buffer.alloc(Math.min(PART, size - offset));
      readSync(fd, chunk, 0, chunk.length, offset);
      const part = await call(`${base}?id=${encodeURIComponent(id)}&part=${number}`, { method: "PUT", headers: auth, body: chunk });
      parts.push({ partNumber: part.partNumber, etag: part.etag });
    }
  } finally { closeSync(fd); }
  await call(`${base}?id=${encodeURIComponent(id)}`, { method: "POST", headers: { ...auth, "content-type": "application/json" }, body: JSON.stringify(parts) });
  console.log(`uploaded ${key}`);
}

const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");

async function verify(file, key) {
  if (dryRun) return console.log(`would check ${key}`);
  const response = await fetch(`${SITE}/${key}`, { cache: "no-store" });
  const live = digest(Buffer.from(await response.arrayBuffer()));
  if (!response.ok || live !== digest(readFileSync(join(folder, file)))) throw new Error(`${key} does not read back as ${file}`);
  console.log(`checked ${key}`);
}

const live = await fetch(`${SITE}/download/latest/latest.yml`, { cache: "no-store" }).then((response) => response.ok ? response.text() : "").catch(() => "");
if (feedVersion(live) === version && feedVersion(await fetch(`${SITE}/download/latest/latest-linux.yml`, { cache: "no-store" }).then((r) => r.ok ? r.text() : "").catch(() => "")) === version) {
  console.log(`deliobot.fun already offers ${version}; nothing to publish`);
  process.exit(0);
}
if (!dryRun && token.length < 16) throw new Error("DELIO_UPLOAD_TOKEN is not set: add it under the repository's Settings → Secrets and variables → Actions");
for (const [file, key] of [...versioned, ...links]) await upload(file, key);
for (const [file, key] of [...versioned, ...links]) await verify(file, key);
for (const [file, key] of feeds) await upload(file, key);
for (const [file, key] of feeds) await verify(file, key);
console.log(dryRun ? `dry run: deliobot.fun would offer ${version}` : `deliobot.fun now offers ${version}`);
