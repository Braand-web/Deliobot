import { createHash } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";

import { mediaToolsRoot } from "./engine-roots.ts";
import { findCliCandidates } from "./env-path.ts";

const RELEASE = "https://github.com/eugeneware/ffmpeg-static/releases/download/b6.1.1";

/** SHA-256 of each gzipped build of ffmpeg-static b6.1.1, as published on its GitHub release. */
export const FFMPEG_BUILDS: Record<string, { ffmpeg: string; ffprobe: string }> = {
  "win32-x64": { ffmpeg: "8883a3dffbd0a16cf4ef95206ea05283f78908dbfb118f73c83f4951dcc06d77", ffprobe: "f309e6223ad89d2fe54bccd420a7709b66fd27540674e92309578ed491a43c8d" },
  "linux-x64": { ffmpeg: "bfe8a8fc511530457b528c48d77b5737527b504a3797a9bc4866aeca69c2dffa", ffprobe: "25d9b6ccb05e3d9de9e04e31e2506d8dd7f9f0418981965ac6df12e8d3afd067" },
  "linux-arm64": { ffmpeg: "754a678672298bc68156adff58aa7385a592c2b30b1d0ae8750c45c915c4bac0", ffprobe: "2ab6aba60ee84412dff9188720703376cb4e7aaf7e0b5e43aa8249f2acae5bf8" },
  "darwin-x64": { ffmpeg: "929b375c1182d956c51f7ac25e0b2b0411fb01f6f407aa15c9758efeb4242106", ffprobe: "d4da574d6e2e197bd259b47d69cf262df9e312af24ad960444f6d806d3d4c186" },
  "darwin-arm64": { ffmpeg: "8923876afa8db5585022d7860ec7e589af192f441c56793971276d450ed3bbfa", ffprobe: "d986a8ec7b030899fe66a8a288ed809a3543338705a3ce178cfb85869c5d80be" },
};

export type MediaTool = "ffmpeg" | "ffprobe";

let installedBin: string | null = null;

export function mediaToolsBin(dataDir: string): string {
  return join(mediaToolsRoot(dataDir), "bin");
}

const exe = (name: string, platform: NodeJS.Platform) => (platform === "win32" ? `${name}.exe` : name);

export function mediaCommand(tool: MediaTool, platform: NodeJS.Platform = process.platform): string {
  const own = installedBin ? join(installedBin, exe(tool, platform)) : null;
  return own && existsSync(own) ? own : tool;
}

export function useMediaToolsBin(bin: string | null): void {
  installedBin = bin;
}

export interface MediaToolsSetup {
  bin: string;
  platform?: NodeJS.Platform;
  arch?: string;
  fetchImpl?: typeof fetch;
  onPath?: (tool: MediaTool) => boolean;
}

const onPersonPath = (tool: MediaTool) => findCliCandidates(tool).length > 0;

export function mediaToolsMissing(setup: MediaToolsSetup): MediaTool[] {
  const platform = setup.platform ?? process.platform;
  const onPath = setup.onPath ?? onPersonPath;
  return (["ffmpeg", "ffprobe"] as const).filter((tool) => !existsSync(join(setup.bin, exe(tool, platform))) && !onPath(tool));
}

let running: Promise<MediaTool[]> | null = null;

/** Downloads the ffmpeg and ffprobe this computer lacks into `bin`, each checked against its pinned SHA-256; answers
 * with what was installed. Concurrent calls share one download. */
export function ensureMediaTools(setup: MediaToolsSetup): Promise<MediaTool[]> {
  running ??= install(setup).finally(() => { running = null; });
  return running;
}

async function install(setup: MediaToolsSetup): Promise<MediaTool[]> {
  const platform = setup.platform ?? process.platform;
  const target = `${platform}-${setup.arch ?? process.arch}`;
  const build = FFMPEG_BUILDS[target];
  const missing = mediaToolsMissing(setup);
  if (!missing.length || !build) return [];
  mkdirSync(setup.bin, { recursive: true });
  const installed: MediaTool[] = [];
  for (const tool of missing) {
    const response = await (setup.fetchImpl ?? fetch)(`${RELEASE}/${tool}-${target}.gz`, { redirect: "follow", signal: AbortSignal.timeout(15 * 60_000) });
    if (!response.ok) throw new Error(`${tool} download failed: HTTP ${response.status}`);
    const packed = Buffer.from(await response.arrayBuffer());
    const digest = createHash("sha256").update(packed).digest("hex");
    if (digest !== build[tool]) throw new Error(`${tool} download did not match its pinned checksum`);
    const file = join(setup.bin, exe(tool, platform));
    const partial = `${file}.partial`;
    writeFileSync(partial, gunzipSync(packed));
    if (platform !== "win32") chmodSync(partial, 0o755);
    rmSync(file, { force: true });
    renameSync(partial, file);
    installed.push(tool);
  }
  return installed;
}

/** A `node` the bots' shells can run when the computer has none: this app's own runtime, run as Node. A Node the
 * person installed comes first on PATH, so it always wins. */
export function writeNodeShim(bin: string, runtime: { execPath: string; electron: boolean }, platform: NodeJS.Platform = process.platform): void {
  mkdirSync(bin, { recursive: true });
  const unix = `#!/bin/sh\n${runtime.electron ? "ELECTRON_RUN_AS_NODE=1 " : ""}exec "${runtime.execPath}" "$@"\n`;
  const files: Array<[string, string]> = [["node", unix]];
  if (platform === "win32") files.push(["node.cmd", `@echo off\r\n${runtime.electron ? "set ELECTRON_RUN_AS_NODE=1\r\n" : ""}"${runtime.execPath}" %*\r\n`]);
  for (const [name, text] of files) {
    const file = join(bin, name);
    if (existsSync(file) && readFileSync(file, "utf8") === text) continue;
    writeFileSync(file, text);
    if (platform !== "win32") chmodSync(file, 0o755);
  }
}
