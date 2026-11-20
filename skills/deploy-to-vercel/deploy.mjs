import { createHash } from "node:crypto";
import { lstatSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import http from "node:http";
import https from "node:https";
import { basename, join, relative, resolve, sep } from "node:path";
import tls from "node:tls";
import { pathToFileURL } from "node:url";

const VERCEL_API = "https://api.vercel.com";
export const RECORD_FILE = ".vercel-deploy.json";
const USER_AGENT = "OpenDeliobot deploy-to-vercel skill";
const REQUEST_TIMEOUT_MS = 60_000;
const UPLOADS_AT_ONCE = 4;
const MAX_FILES = 5_000;
const MAX_BYTES = 100 * 1024 * 1024;

const SECRET_NAMES = [
  /^env(\.(local|development|production|staging|test))?$/i,
  /\.env(\..+)?$/i,
  /\.(pem|key|p12|pfx|jks|keystore|kdbx|ppk)$/i,
  /^id_(rsa|dsa|ecdsa|ed25519)(\.pub)?$/i,
  /^(credentials|secrets?|service-account)(\..+)?\.(json|ya?ml|toml|txt)$/i,
  /^(npmrc|netrc|htpasswd)$/i,
];
const SKIPPED_FOLDERS = new Set(["node_modules", "__MACOSX", ".git", ".next", ".vercel", ".output", ".svelte-kit", ".turbo", ".cache"]);

/** Whether a file at this path, relative to the uploaded folder, may go to Vercel. Dotfiles stay home (the record,
 * `.env`, `.opendeliobot-secrets`), except `.well-known`, which sites need. */
export function uploadable(path) {
  const parts = path.split(/[\\/]/).filter(Boolean);
  if (!parts.length) return false;
  for (const part of parts) {
    if (SKIPPED_FOLDERS.has(part)) return false;
    if (part.startsWith(".") && part !== ".well-known") return false;
  }
  return !SECRET_NAMES.some((pattern) => pattern.test(parts.at(-1)));
}

/** Every uploadable plain file under `dir`, sorted, with the ones left out. Links are never followed. */
export function collectFiles(dir) {
  const files = [];
  const skipped = [];
  const walk = (folder) => {
    for (const name of readdirSync(folder).sort()) {
      const full = join(folder, name);
      const path = relative(dir, full).split(sep).join("/");
      const info = lstatSync(full);
      if (!uploadable(path) || info.isSymbolicLink()) skipped.push(path);
      else if (info.isDirectory()) walk(full);
      else if (info.isFile()) files.push({ path, full, size: info.size });
    }
  };
  walk(dir);
  return { files, skipped };
}

/** A Vercel project name: lowercase letters, digits and dashes, up to 100. */
export function projectName(value) {
  const name = String(value ?? "").toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 100);
  return name || "app";
}

/** Only a loopback stand-in may replace Vercel's address, so a token can never be pointed at another host. */
export function apiBase(env) {
  const override = env.ODB_VERCEL_API_URL;
  return override && /^http:\/\/127\.0\.0\.1:\d{1,5}$/.test(override) ? override : VERCEL_API;
}

export function proxyFor(url, env) {
  if (url.protocol !== "https:") return null;
  const none = (env.NO_PROXY ?? env.no_proxy ?? "").split(",").map((entry) => entry.trim().toLowerCase()).filter(Boolean);
  const host = url.hostname.toLowerCase();
  if (none.some((entry) => entry === "*" || host === entry.replace(/^\./, "") || host.endsWith(`.${entry.replace(/^\./, "")}`))) return null;
  const proxy = env.HTTPS_PROXY ?? env.https_proxy ?? env.HTTP_PROXY ?? env.http_proxy;
  if (!proxy) return null;
  try {
    const parsed = new URL(proxy);
    return parsed.protocol === "http:" ? parsed : null;
  } catch {
    return null;
  }
}

function openTunnel(proxy, host, port) {
  return new Promise((done, fail) => {
    const headers = { Host: `${host}:${port}` };
    if (proxy.username) headers["Proxy-Authorization"] = `Basic ${Buffer.from(`${decodeURIComponent(proxy.username)}:${decodeURIComponent(proxy.password)}`).toString("base64")}`;
    const connect = http.request({ host: proxy.hostname, port: proxy.port || 80, method: "CONNECT", path: `${host}:${port}`, headers, timeout: REQUEST_TIMEOUT_MS });
    connect.once("connect", (response, socket) => {
      if (response.statusCode === 200) return done(socket);
      socket.destroy();
      fail(new Error(`the proxy refused the connection to ${host} (${response.statusCode})`));
    });
    connect.once("timeout", () => connect.destroy(new Error(`the proxy did not answer for ${host}`)));
    connect.once("error", fail);
    connect.end();
  });
}

async function request(target, { method = "GET", headers = {}, body, readMs } = {}, env = process.env) {
  const url = new URL(target);
  const proxy = proxyFor(url, env);
  const options = { method, headers: { "User-Agent": USER_AGENT, ...headers, ...(body ? { "Content-Length": Buffer.byteLength(body) } : {}) }, timeout: REQUEST_TIMEOUT_MS, agent: false };
  if (proxy) {
    const tunnel = await openTunnel(proxy, url.hostname, Number(url.port) || 443);
    options.createConnection = () => tls.connect({ socket: tunnel, servername: url.hostname });
  }
  return new Promise((done, fail) => {
    const call = (url.protocol === "https:" ? https : http).request(url, options, (response) => {
      const chunks = [];
      const finish = () => done({ status: response.statusCode ?? 0, headers: response.headers, text: Buffer.concat(chunks).toString("utf8") });
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", finish);
      response.on("error", fail);
      // A log stream stays open: what arrived in readMs is the answer.
      if (readMs) setTimeout(() => { finish(); response.destroy(); }, readMs);
    });
    call.once("timeout", () => call.destroy(new Error(`${url.hostname} did not answer in ${REQUEST_TIMEOUT_MS / 1000} seconds`)));
    call.once("error", fail);
    call.end(body);
  });
}

class VercelError extends Error {
  constructor(step, response) {
    let answer = response.text.slice(0, 600);
    let code;
    try {
      const parsed = JSON.parse(response.text);
      answer = parsed.error?.message ?? answer;
      code = parsed.error?.code;
    } catch {
      // A body that is not JSON is reported as it came.
    }
    super(`${step}: Vercel answered ${response.status}${answer ? `: ${answer}` : ""}`);
    this.status = response.status;
    this.code = code;
    this.body = response.text;
  }
}

function parseArgs(argv) {
  const args = {};
  for (let at = 0; at < argv.length; at += 1) {
    const flag = argv[at];
    if (["--prod", "--check", "--logs", "--delete"].includes(flag)) args[flag.slice(2)] = true;
    else if (["--dir", "--token-file", "--project", "--name", "--title", "--bot-name", "--team", "--env", "--value-file"].includes(flag) && argv[at + 1]) args[flag.slice(2)] = argv[(at += 1)];
    else throw new Error(`unknown or incomplete argument: ${flag}`);
  }
  const modes = ["dir", "check", "logs", "delete", "env"].filter((mode) => args[mode]);
  if (!args["token-file"] || modes.length !== 1) {
    throw new Error("usage: node deploy.mjs --dir <folder> --token-file <secret file> [--prod] [--project <folder>] [--name <project>] [--team <team id>] [--title <title>] [--bot-name <name>] | --check | --logs | --env <NAME> --value-file <secret file> | --delete  (each with --token-file, run from the project folder or with --project)");
  }
  if (args.env && (!args["value-file"] || !/^[A-Za-z_][A-Za-z0-9_]{0,255}$/.test(args.env))) throw new Error("--env takes a variable name (letters, digits, _) and --value-file with the secret file holding its value");
  return args;
}

function readRecord(file) {
  try {
    const record = JSON.parse(readFileSync(file, "utf8"));
    return record && typeof record.projectName === "string" ? record : null;
  } catch {
    return null;
  }
}

const oneLine = (value, max) => String(value).replace(/[\p{Cc}\s]+/gu, " ").trim().slice(0, max);
const wait = (ms) => new Promise((done) => setTimeout(done, ms));
const withScheme = (host) => (host ? (host.startsWith("http") ? host : `https://${host}`) : null);

/** Runs one command of the skill and answers what it did, as one JSON object. Never returns or prints the token. */
export async function run(argv, env = process.env, options = {}) {
  const pollMs = options.pollMs ?? 3_000;
  const waitMs = options.waitMs ?? 8 * 60_000;
  const args = parseArgs(argv);
  const project = resolve(args.project ?? ".");
  const recordFile = join(project, RECORD_FILE);
  const record = readRecord(recordFile);
  const token = readFileSync(resolve(args["token-file"]), "utf8").trim();
  if (!token) throw new Error("the token file is empty");
  const base = apiBase(env);
  const team = args.team ?? record?.teamId;
  const query = (path, extra = {}) => {
    const params = new URLSearchParams({ ...(team ? { teamId: team } : {}), ...extra });
    const text = params.toString();
    return `${base}${path}${text ? `${path.includes("?") ? "&" : "?"}${text}` : ""}`;
  };
  const api = async (step, method, path, body, extra) => {
    const response = await request(query(path, extra), { method, headers: { Authorization: `Bearer ${token}`, ...(body ? { "Content-Type": "application/json" } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) }, env);
    if (response.status < 200 || response.status >= 300) throw new VercelError(step, response);
    return response.text ? JSON.parse(response.text) : {};
  };
  const save = (patch) => {
    const next = { ...readRecord(recordFile), ...patch };
    writeFileSync(recordFile, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o644 });
    return next;
  };
  const needRecord = () => {
    if (!record) throw new Error(`no ${RECORD_FILE} in ${project}: deploy once with --dir first, or pass --project with the project's folder`);
    return record;
  };

  if (args.delete) {
    const known = needRecord();
    try {
      await api("Deleting the project", "DELETE", `/v9/projects/${encodeURIComponent(known.projectId ?? known.projectName)}`);
    } catch (error) {
      if (!(error instanceof VercelError && error.status === 404)) throw error;
    }
    rmSync(recordFile, { force: true });
    return { ok: true, deleted: true, project: known.projectName };
  }

  if (args.env) {
    const known = needRecord();
    const value = readFileSync(resolve(args["value-file"]), "utf8").replace(/\r?\n$/, "");
    if (!value) throw new Error("the value file is empty");
    await api("Saving the variable", "POST", `/v10/projects/${encodeURIComponent(known.projectId ?? known.projectName)}/env`, { key: args.env, value, type: "encrypted", target: ["production", "preview"] }, { upsert: "true" });
    return { ok: true, variable: args.env, targets: ["production", "preview"], message: `${args.env} is saved, encrypted, on Vercel. It applies to the next deploy: deploy again for it to take effect.` };
  }

  if (args.logs) {
    const known = needRecord();
    const deployment = known.lastDeployment?.id;
    if (!deployment) throw new Error("this project has no deployment yet");
    const events = await api("Reading the build log", "GET", `/v3/deployments/${encodeURIComponent(deployment)}/events`, undefined, { builds: "1", direction: "backward", limit: "200" });
    const build = (Array.isArray(events) ? events : []).map((event) => oneLine(event.text ?? event.payload?.text ?? "", 500)).filter(Boolean).reverse().slice(-80);
    let runtime = [];
    if (known.projectId) {
      const stream = await request(query(`/v1/projects/${encodeURIComponent(known.projectId)}/deployments/${encodeURIComponent(deployment)}/runtime-logs`), { headers: { Authorization: `Bearer ${token}` }, readMs: options.logReadMs ?? 5_000 }, env).catch(() => null);
      runtime = (stream?.status === 200 ? stream.text.split("\n") : []).flatMap((line) => {
        try {
          const entry = JSON.parse(line);
          return [{ at: new Date(entry.timestampInMs).toISOString(), level: entry.level, request: `${entry.requestMethod ?? ""} ${entry.requestPath ?? ""}`.trim(), status: entry.responseStatusCode, message: oneLine(entry.message ?? "", 500) }];
        } catch {
          return [];
        }
      }).slice(-50);
    }
    const errors = runtime.filter((entry) => entry.level === "error" || entry.status >= 500);
    return { ok: true, deployment, state: known.lastDeployment.state, build, runtime, errors: errors.length,
      message: errors.length ? `${errors.length} recent requests failed on the server; their messages are under runtime.` : "No server errors in the last minutes of runtime logs." };
  }

  const look = async (id) => {
    const started = Date.now();
    for (;;) {
      const deployment = await api("Reading the deployment", "GET", `/v13/deployments/${encodeURIComponent(id)}`);
      const state = deployment.readyState ?? deployment.status;
      if (["READY", "ERROR", "CANCELED"].includes(state) || Date.now() - started >= waitMs) return deployment;
      await wait(pollMs);
    }
  };
  const answer = (deployment, extra = {}) => {
    const state = deployment.readyState ?? deployment.status;
    const production = deployment.target === "production";
    const live = withScheme(production ? (deployment.alias?.[0] ?? deployment.url) : deployment.url);
    const saved = save({ lastDeployment: { id: deployment.id, url: withScheme(deployment.url), target: production ? "production" : "preview", state }, ...(production && live ? { productionUrl: live } : {}) });
    const common = { url: live, deploymentUrl: withScheme(deployment.url), target: production ? "production" : "preview", state, project: saved.projectName, ...extra };
    if (state === "READY") return { ok: true, live: true, ...common, message: production ? "Live in production at url." : "A preview is ready at url. Show it to the person; deploy again with --prod when they approve." };
    if (state === "ERROR" || state === "CANCELED") return { ok: false, ...common, error: `The deployment ${state === "ERROR" ? "failed" : "was canceled"}. Read why with --logs, fix it, then deploy again.` };
    return { ok: true, pending: true, ...common, message: "Vercel is still building. Check once with --check in a minute; don't deploy again." };
  };

  if (args.check) {
    const known = needRecord();
    if (!known.lastDeployment?.id) throw new Error("this project has no deployment yet");
    return answer(await look(known.lastDeployment.id));
  }

  const dir = realpathSync(resolve(args.dir));
  const { files, skipped } = collectFiles(dir);
  if (!files.length) throw new Error(`${args.dir} has no files to deploy`);
  if (files.length > MAX_FILES) throw new Error(`${args.dir} has ${files.length} files; deploy at most ${MAX_FILES} (build output or source without node_modules)`);
  const bytes = files.reduce((sum, file) => sum + file.size, 0);
  if (bytes > MAX_BYTES) throw new Error(`${args.dir} holds ${Math.round(bytes / 1024 / 1024)} MB; deploy at most ${MAX_BYTES / 1024 / 1024} MB`);
  const contents = new Map();
  const listed = files.map((file) => {
    const data = readFileSync(file.full);
    if (data.includes(token)) throw new Error(`${file.path} contains the Vercel token; remove it before deploying`);
    const sha = createHash("sha1").update(data).digest("hex");
    contents.set(sha, data);
    return { file: file.path, sha, size: data.byteLength };
  });

  const name = record?.projectName ?? projectName(args.name ?? basename(project));
  const body = { name, project: record?.projectId ?? name, files: listed, ...(args.prod ? { target: "production" } : {}), meta: { source: "opendeliobot" } };
  const create = () => api("Creating the deployment", "POST", "/v13/deployments", body, { skipAutoDetectionConfirmation: "1" });
  let deployment;
  let uploaded = 0;
  try {
    deployment = await create();
  } catch (error) {
    if (!(error instanceof VercelError && error.code === "missing_files")) throw error;
    const missing = (() => {
      try { return JSON.parse(error.body).error?.missing ?? []; } catch { return []; }
    })();
    const queue = (missing.length ? missing : [...contents.keys()]).filter((sha) => contents.has(sha));
    await Promise.all(Array.from({ length: UPLOADS_AT_ONCE }, async () => {
      for (let sha = queue.shift(); sha; sha = queue.shift()) {
        const data = contents.get(sha);
        const response = await request(query("/v2/files"), { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/octet-stream", "x-vercel-digest": sha }, body: data }, env);
        if (response.status < 200 || response.status >= 300) throw new VercelError("Uploading a file", response);
        uploaded += 1;
      }
    }));
    deployment = await create();
  }
  save({
    version: 1, projectName: name, ...(deployment.projectId ? { projectId: deployment.projectId } : {}), ...(team ? { teamId: team } : {}),
    ...(args.title ? { title: oneLine(args.title, 120) } : {}), ...(args["bot-name"] ? { botName: oneLine(args["bot-name"], 80) } : {}), deployedAt: new Date().toISOString(),
  });
  return answer(await look(deployment.id), { files: listed.length, uploaded, skipped, created: !record });
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  run(process.argv.slice(2)).then(
    (result) => { process.stdout.write(`${JSON.stringify(result)}\n`); process.exitCode = result.ok === false ? 1 : 0; },
    (error) => { process.stdout.write(`${JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) })}\n`); process.exitCode = 1; },
  );
}

