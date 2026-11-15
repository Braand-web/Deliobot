// Stage a pinned uv (Astral's Python manager) for every desktop target electron-builder packages on this host; --current
// stages only this host's. The desktop app puts it on the bots' PATH and uses it to install Python where the computer
// has none. Every archive is checked against its pinned SHA-256 before it is extracted.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync, copyFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const UV_VERSION = "0.13.4";

export const UV_ASSETS = Object.freeze({
  "win32-x64": Object.freeze({ name: "uv-x86_64-pc-windows-msvc.zip", sha256: "ccec7508a07d9933d7cb1261880633efcf1f30d6e6eddab21823f1dae6f23225", binaries: ["uv.exe", "uvx.exe"] }),
  "linux-x64": Object.freeze({ name: "uv-x86_64-unknown-linux-gnu.tar.gz", sha256: "2b428396f12572d4429cf210ca234dd599a33b3af0958a4d5ed569d63e3f344f", binaries: ["uv", "uvx"] }),
  "darwin-arm64": Object.freeze({ name: "uv-aarch64-apple-darwin.tar.gz", sha256: "e0b1d4743ce64c55d9f0f4a444afa6b81125680070ee04e853fcd0f6c1ebf8f1", binaries: ["uv", "uvx"] }),
  "darwin-x64": Object.freeze({ name: "uv-x86_64-apple-darwin.tar.gz", sha256: "7be2dcd316122f4b3e5a0a7889f6248266c14425374e105ff7dc9779184603a6", binaries: ["uv", "uvx"] }),
});

export function uvTargets({ current = false, platform = process.platform, arch = process.arch } = {}) {
  if (current) {
    const target = `${platform}-${arch}`;
    if (!Object.hasOwn(UV_ASSETS, target)) throw new Error(`uv is not packaged for ${target}`);
    return [target];
  }
  if (platform === "darwin") return ["darwin-arm64", "darwin-x64"];
  if (platform === "linux") return ["linux-x64"];
  if (platform === "win32") return ["win32-x64"];
  throw new Error(`uv packaging is unsupported on ${platform}`);
}

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

/** Every file under `dir`, at any depth. */
function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

export async function stageUv(target, outRoot, fetchImpl = fetch) {
  const asset = UV_ASSETS[target];
  const out = join(outRoot, target);
  const stamp = join(out, ".version");
  if (existsSync(stamp) && asset.binaries.every((name) => existsSync(join(out, name)))) return out;
  const response = await fetchImpl(`https://github.com/astral-sh/uv/releases/download/${UV_VERSION}/${asset.name}`, { redirect: "follow" });
  if (!response.ok) throw new Error(`uv ${asset.name}: HTTP ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  const actual = sha256(bytes);
  if (actual !== asset.sha256) throw new Error(`uv ${asset.name}: SHA-256 ${actual} is not the pinned ${asset.sha256}`);
  const work = mkdtempSync(join(tmpdir(), "odb-uv-"));
  try {
    const archive = join(work, asset.name);
    writeFileSync(archive, bytes);
    const extracted = join(work, "x");
    mkdirSync(extracted);
    const tar = spawnSync("tar", ["-xf", archive, "-C", extracted], { stdio: "inherit" });
    if (tar.status !== 0) throw new Error(`uv ${asset.name}: extraction failed`);
    rmSync(out, { recursive: true, force: true });
    mkdirSync(out, { recursive: true });
    const files = walk(extracted);
    for (const name of asset.binaries) {
      const found = files.find((file) => file.endsWith(`/${name}`) || file.endsWith(`\\${name}`));
      if (!found) throw new Error(`uv ${asset.name}: ${name} is missing from the archive`);
      copyFileSync(found, join(out, name));
      if (!name.endsWith(".exe")) chmodSync(join(out, name), 0o755);
    }
    writeFileSync(stamp, `${UV_VERSION}\n`);
    return out;
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const root = fileURLToPath(new URL("../dist-native/uv/", import.meta.url));
  for (const target of uvTargets({ current: process.argv.includes("--current") })) {
    console.log(`uv ${UV_VERSION} for ${target}: ${await stageUv(target, root)}`);
  }
}
