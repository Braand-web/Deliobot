// Puts files on deliobot.fun, each read back and checked against its source before anything that points at it.
//   node scripts/publish-downloads.mjs <folder with both builds' artifacts> [--dry-run]
//     A release: the files, then the fixed download links the site's buttons use, then the update feeds the
//     installed apps read, last.
//   node scripts/publish-downloads.mjs --media <file>… [--dry-run]
//     The site's videos and images, served at /media/<file name>.
// The upload key comes from DELIO_UPLOAD_TOKEN and is only ever sent to deliobot.fun.
import { createHash } from "node:crypto";
import { closeSync, existsSync, openSync, readFileSync, readSync, statSync } from "node:fs";
import { basename, join } from "node:path";

const SITE = "https://deliobot.fun";
const PART = 50 * 1024 * 1024;
const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const media = args.includes("--media");
const paths = args.filter((arg) => !arg.startsWith("--"));
if (!paths.length) throw new Error("usage: node scripts/publish-downloads.mjs <folder> [--dry-run] | --media <file>… [--dry-run]");

const token = process.env.DELIO_UPLOAD_TOKEN ?? "";
const auth = { authorization: `Bearer ${token}` };
const needToken = () => { if (!dryRun && token.length < 16) throw new Error("DELIO_UPLOAD_TOKEN is not set: add it under the repository's Settings → Secrets and variables → Actions"); };

/** The `version:` line of an electron-builder feed. */
function feedVersion(text) {
  return /^version:\s*['"]?([0-9][0-9A-Za-z.+-]*)['"]?\s*$/m.exec(text)?.[1] ?? null;
}

function newerRelease(published, candidate) {
  if (!/^\d+\.\d+\.\d+$/.test(published ?? "") || !/^\d+\.\d+\.\d+$/.test(candidate)) return false;
  const left = published.split(".").map(Number), right = candidate.split(".").map(Number);
  const different = left.findIndex((part, index) => part !== right[index]);
  return different >= 0 && left[different] > right[different];
}

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
  if (dryRun) return console.log(`would upload ${basename(file)} → ${key}`);
  const base = `${SITE}/__upload/${key}`;
  const size = statSync(file).size;
  const { id } = await call(`${base}?start`, { method: "POST", headers: auth });
  const parts = [];
  const fd = openSync(file, "r");
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
  if (!response.ok || live !== digest(readFileSync(file))) throw new Error(`${key} does not read back as ${basename(file)}`);
  console.log(`checked ${key}`);
}

async function publishMedia(files) {
  for (const file of files) if (!existsSync(file)) throw new Error(`missing ${file}`);
  needToken();
  for (const file of files) await upload(file, `media/${basename(file)}`);
  for (const file of files) await verify(file, `media/${basename(file)}`);
}

async function publishRelease(folder) {
  const read = (name) => readFileSync(join(folder, name), "utf8");
  const version = feedVersion(read("latest.yml"));
  if (!version || feedVersion(read("latest-linux.yml")) !== version) throw new Error("latest.yml and latest-linux.yml must name the same version");
  const versioned = [`OpenDeliobot-${version}-setup.exe`, `OpenDeliobot-${version}-setup.exe.blockmap`, `OpenDeliobot-${version}-x64.zip`, `OpenDeliobot-${version}-x86_64.AppImage`,
    `OpenDeliobot-${version}-amd64.deb`, "SHA256SUMS-ubuntu-x64.txt"].map((file) => [file, `download/latest/${file}`]);
  const links = [[`OpenDeliobot-${version}-setup.exe`, "download/Deliobot-Setup.exe"], [`OpenDeliobot-${version}-x64.zip`, "download/Deliobot-Windows.zip"],
    [`OpenDeliobot-${version}-amd64.deb`, "download/Deliobot.deb"], [`OpenDeliobot-${version}-x86_64.AppImage`, "download/Deliobot.AppImage"]];
  const feeds = [["latest.yml", "download/latest/latest.yml"], ["latest-linux.yml", "download/latest/latest-linux.yml"]];
  for (const [file] of [...versioned, ...links, ...feeds]) if (!existsSync(join(folder, file))) throw new Error(`missing ${file}`);

  const liveVersion = async (feed) => feedVersion(await fetch(`${SITE}/download/latest/${feed}`, { cache: "no-store" }).then((r) => (r.ok ? r.text() : "")).catch(() => ""));
  const published = await Promise.all([liveVersion("latest.yml"), liveVersion("latest-linux.yml")]);
  const newer = published.find(current => newerRelease(current, version));
  if (newer) {
    console.log(`deliobot.fun already offers newer ${newer}; refusing to replace it with ${version}`);
    return;
  }
  if (published.every(current => current === version)) {
    console.log(`deliobot.fun already offers ${version}; nothing to publish`);
    return;
  }
  needToken();
  const at = ([file, key]) => [join(folder, file), key];
  for (const pair of [...versioned, ...links]) await upload(...at(pair));
  for (const pair of versioned) await verify(...at(pair));
  for (const pair of feeds) await upload(...at(pair));
  for (const pair of feeds) await verify(...at(pair));
  for (const pair of links) await verify(...at(pair));
  console.log(dryRun ? `dry run: deliobot.fun would offer ${version}` : `deliobot.fun now offers ${version}`);
}

await (media ? publishMedia(paths) : publishRelease(paths[0]));
