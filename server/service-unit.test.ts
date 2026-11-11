import { describe, expect, it } from "vitest";

import {
  checkSentinelInstall, launchdPlist, sentinelCommand, sentinelLaunchdPlist, sentinelServicePlan, sentinelSystemdService, sentinelSystemdTimer,
  sentinelUnitCommand, serviceCommand, servicePlan, shippedSentinelCli, systemdUnit, unstableInstallWarning, type ServiceSpec,
} from "./service-unit.ts";

const spec: ServiceSpec = {
  node: "/usr/bin/node",
  script: "/usr/lib/node_modules/opendeliobot/cli.js",
  serveArgs: ["--port", "8799", "--data-dir", "/home/delio/.opendeliobot", "--domain", "delio.example.com", "--no-pair"],
  dataDir: "/home/delio/.opendeliobot",
  user: "delio",
  home: "/home/delio",
  bindsLowPorts: true,
  label: "agentada",
};

describe("service units", () => {
  it("runs the same serve command, with strip-types only for a checkout", () => {
    expect(serviceCommand(spec)).toEqual(["/usr/bin/node", "/usr/lib/node_modules/opendeliobot/cli.js", "serve", ...spec.serveArgs]);
    expect(serviceCommand({ ...spec, script: "/srv/OpenDeliobot/server/opendeliobot.ts" })[1]).toBe("--experimental-strip-types");
  });

  it("renders a systemd unit that restarts, runs as the user, and grants low ports only for --domain", () => {
    const unit = systemdUnit(spec);
    expect(unit).toContain("Description=OpenDeliobot (agentada)");
    expect(unit).toContain("User=delio");
    expect(unit).toContain("Environment=ODB_DATA_DIR=/home/delio/.opendeliobot");
    expect(unit).toContain("ExecStart=/usr/bin/node /usr/lib/node_modules/opendeliobot/cli.js serve --port 8799 --data-dir /home/delio/.opendeliobot --domain delio.example.com --no-pair");
    expect(unit).toContain("Restart=always");
    expect(unit).toContain("AmbientCapabilities=CAP_NET_BIND_SERVICE");
    expect(unit).toContain("WantedBy=multi-user.target");
    const local = systemdUnit({ ...spec, bindsLowPorts: false, serveArgs: ["--port", "8799", "--data-dir", "/home/delio/.opendeliobot"] });
    expect(local).not.toContain("CAP_NET_BIND_SERVICE");
    expect(systemdUnit({ ...spec, dataDir: "/home/delio/My Data", serveArgs: ["--data-dir", "/home/delio/My Data"] })).toContain('ExecStart=/usr/bin/node /usr/lib/node_modules/opendeliobot/cli.js serve --data-dir "/home/delio/My Data"');
  });

  it("renders a launchd agent that keeps the server alive and logs under the data dir", () => {
    const plist = launchdPlist({ ...spec, home: "/Users/delio", dataDir: "/Users/delio/.opendeliobot" });
    expect(plist).toContain("<string>com.opendeliobot.serve</string>");
    expect(plist).toContain("<string>/usr/bin/node</string>");
    expect(plist).toContain("<string>serve</string>");
    expect(plist).toContain("<string>delio.example.com</string>");
    expect(plist).toContain("<key>KeepAlive</key>");
    expect(plist).toContain("/Users/delio/.opendeliobot/logs/service.log");
    expect(launchdPlist({ ...spec, serveArgs: ["--label", "a & b <c>"] })).toContain("<string>a &amp; b &lt;c&gt;</string>");
  });

  it("refuses to point a service at an npx cache, and knows where each platform's file goes", () => {
    expect(unstableInstallWarning("/home/delio/.npm/_npx/abc123/node_modules/opendeliobot/cli.js")).toMatch(/npm install -g opendeliobot/);
    expect(unstableInstallWarning("/usr/lib/node_modules/opendeliobot/cli.js")).toBeNull();
    const linux = servicePlan("linux", "/home/delio/.opendeliobot");
    expect(linux?.installed).toBe("/etc/systemd/system/opendeliobot.service");
    expect(linux?.activate.join("\n")).toContain("systemctl enable --now opendeliobot");
    const mac = servicePlan("darwin", "/Users/delio/.opendeliobot", "/Users/delio");
    expect(mac?.installed).toBe("/Users/delio/Library/LaunchAgents/com.opendeliobot.serve.plist");
    expect(mac?.activate.join("\n")).toContain("launchctl bootstrap gui/$(id -u)");
    expect(servicePlan("win32", "C:\\x")).toBeNull();
  });

  it("renders Sentinel as a launchd agent on an interval, under its own label, logging outside the data dir", () => {
    const out = "/Users/delio/Library/Application Support/opendeliobot-sentinel";
    const sentinel = { node: "/usr/bin/node", script: "/usr/lib/node_modules/opendeliobot/cli.js", dataDir: "/Users/delio/.opendeliobot", home: "/Users/delio", out };
    expect(sentinelCommand(sentinel)).toEqual(["/usr/bin/node", "/usr/lib/node_modules/opendeliobot/cli.js", "sentinel", "--once", "--data-dir", "/Users/delio/.opendeliobot", "--out", out]);
    expect(sentinelCommand({ ...sentinel, script: "/srv/OpenDeliobot/server/opendeliobot.ts" })[1]).toBe("--experimental-strip-types");
    const plist = sentinelLaunchdPlist(sentinel);
    expect(plist).toContain("<string>com.opendeliobot.sentinel</string>");
    expect(plist).toContain("<key>StartInterval</key>\n\t<integer>120</integer>");
    expect(plist).toContain("<string>sentinel</string>");
    expect(plist).not.toContain("KeepAlive");
    expect(plist).toContain(`<string>${out}/sentinel.log</string>`);
    expect(plist).not.toContain(".opendeliobot/logs");
    const mac = sentinelServicePlan("darwin", out, "/Users/delio");
    expect(mac?.files).toEqual([{ name: "com.opendeliobot.sentinel.plist", installed: "/Users/delio/Library/LaunchAgents/com.opendeliobot.sentinel.plist" }]);
    // a path with a space is one argument in the printed commands
    expect(mac?.activate[0]).toBe("mkdir -p /Users/delio/Library/LaunchAgents && cp '/Users/delio/Library/Application Support/opendeliobot-sentinel/com.opendeliobot.sentinel.plist' /Users/delio/Library/LaunchAgents/com.opendeliobot.sentinel.plist");
    expect(mac?.deactivate[0]).toBe("launchctl bootout gui/$(id -u)/com.opendeliobot.sentinel");
  });

  it("renders Sentinel as a systemd user timer, with no root", () => {
    const sentinel = { node: "/usr/bin/node", script: "/usr/lib/node_modules/opendeliobot/cli.js", dataDir: "/home/delio/My Data", home: "/home/delio", out: "/home/delio/.local/state/opendeliobot-sentinel" };
    const unit = sentinelSystemdService(sentinel);
    expect(unit).toContain("Type=oneshot");
    expect(unit).toContain('ExecStart=/usr/bin/node /usr/lib/node_modules/opendeliobot/cli.js sentinel --once --data-dir "/home/delio/My Data" --out /home/delio/.local/state/opendeliobot-sentinel');
    expect(unit).not.toContain("User=");
    expect(sentinelSystemdTimer()).toContain("OnUnitActiveSec=120s");
    expect(sentinelSystemdTimer()).toContain("WantedBy=timers.target");
    const linux = sentinelServicePlan("linux", sentinel.out, "/home/delio");
    expect(linux?.files.map((file) => file.installed)).toEqual(["/home/delio/.config/systemd/user/opendeliobot-sentinel.service", "/home/delio/.config/systemd/user/opendeliobot-sentinel.timer"]);
    expect(linux?.activate[0]).toContain("cp /home/delio/.local/state/opendeliobot-sentinel/opendeliobot-sentinel.service");
    expect(linux?.activate.join("\n")).toContain("systemctl --user enable --now opendeliobot-sentinel.timer");
    expect(linux?.activate.join("\n")).not.toContain("sudo");
    expect(sentinelServicePlan("win32", "C:\\x")).toBeNull();
  });

  it("finds the CLI the installed desktop app ships, and runs it as Node", () => {
    const app = "/Applications/OpenDeliobot.app/Contents";
    const present = new Set([`${app}/MacOS/OpenDeliobot`, `${app}/Resources/server/opendeliobot.js`]);
    expect(shippedSentinelCli("darwin", "/Users/delio", (path) => present.has(path))).toEqual({ node: `${app}/MacOS/OpenDeliobot`, script: `${app}/Resources/server/opendeliobot.js` });
    const user = "/Users/delio/Applications/OpenDeliobot.app/Contents";
    expect(shippedSentinelCli("darwin", "/Users/delio", (path) => path.startsWith(user))?.script).toBe(`${user}/Resources/server/opendeliobot.js`);
    expect(shippedSentinelCli("linux", "/home/delio", (path) => path.startsWith("/opt/OpenDeliobot/"))).toEqual({ node: "/opt/OpenDeliobot/opendeliobot", script: "/opt/OpenDeliobot/resources/server/opendeliobot.js" });
    // an app with its script missing, or one released before Sentinel, is no CLI for it
    expect(shippedSentinelCli("darwin", "/Users/delio", (path) => path.endsWith("MacOS/OpenDeliobot"))).toBeNull();
    expect(shippedSentinelCli("darwin", "/Users/delio", (path) => present.has(path), () => false)).toBeNull();
    expect(shippedSentinelCli("win32", "C:\\Users\\delio", () => true)).toBeNull();

    const spec = { node: `${app}/MacOS/OpenDeliobot`, script: `${app}/Resources/server/opendeliobot.js`, dataDir: "/Users/delio/.opendeliobot", home: "/Users/delio", out: "/tmp/s", electronRunAsNode: true };
    expect(sentinelLaunchdPlist(spec)).toContain("<key>ELECTRON_RUN_AS_NODE</key>\n\t\t<string>1</string>");
    expect(sentinelSystemdService(spec)).toContain("Environment=ELECTRON_RUN_AS_NODE=1");
    expect(sentinelLaunchdPlist({ ...spec, electronRunAsNode: false })).not.toContain("ELECTRON_RUN_AS_NODE");
  });

  it("keeps every path one quoted value in the systemd unit, and refuses one no unit can hold", () => {
    const spec = { node: "/usr/bin/node", script: "/srv/odb/cli.js", dataDir: "/home/delio/100% $HOME\\", home: "/home/my delio", out: "/home/my delio/.local/state/opendeliobot-sentinel" };
    const unit = sentinelSystemdService(spec);
    expect(unit).toContain('Environment="HOME=/home/my delio"');
    // % is no specifier, $ no variable, and the trailing backslash no continuation
    expect(unit).toContain('"/home/delio/100%% $$HOME\\\\"');
    expect(sentinelUnitCommand(unit)).toEqual({ node: "/usr/bin/node", script: "/srv/odb/cli.js" });
    expect(sentinelUnitCommand(sentinelSystemdService({ ...spec, script: "/srv/100% $x/cli.js" }))?.script).toBe("/srv/100% $x/cli.js");
    for (const bad of ["/home/delio\n[Service]\nExecStartPre=/bin/true", "/home/delio\r", "/home/\0delio"]) {
      expect(() => sentinelSystemdService({ ...spec, home: bad })).toThrow(/line break or NUL/);
      expect(() => sentinelLaunchdPlist({ ...spec, dataDir: bad })).toThrow(/line break or NUL/);
    }
  });

  it("reads back what an installed unit runs, and calls it stale when either path is gone", () => {
    const spec = { node: "/opt/node & co/bin/node", script: "/srv/odb/cli.js", dataDir: "/home/delio/My Data", home: "/home/delio", out: "/home/delio/.local/state/opendeliobot-sentinel" };
    expect(sentinelUnitCommand(sentinelLaunchdPlist(spec))).toEqual({ node: "/opt/node & co/bin/node", script: "/srv/odb/cli.js" });
    expect(sentinelUnitCommand(sentinelSystemdService(spec))).toEqual({ node: "/opt/node & co/bin/node", script: "/srv/odb/cli.js" });
    expect(sentinelUnitCommand("[Service]\nType=oneshot\n")).toBeNull();

    const unit = "/home/delio/.config/systemd/user/opendeliobot-sentinel.service";
    const timer = "/home/delio/.config/systemd/user/opendeliobot-sentinel.timer";
    const files = new Map([[unit, sentinelSystemdService(spec)]]);
    const fs = (present: string[]) => ({ exists: (path: string) => files.has(path) || present.includes(path), read: (path: string) => files.get(path)! });
    expect(checkSentinelInstall("linux", "/home/delio", fs([spec.node, spec.script, timer]))).toMatchObject({ status: "ok", unit });
    expect(checkSentinelInstall("linux", "/home/delio", fs([spec.node, timer]))).toMatchObject({ status: "stale", missing: ["/srv/odb/cli.js"] });
    // the service without its timer never runs
    expect(checkSentinelInstall("linux", "/home/delio", fs([spec.node, spec.script]))).toMatchObject({ status: "stale", missing: [timer] });
    expect(checkSentinelInstall("darwin", "/Users/delio", fs([]))).toEqual({ status: "not_installed", unit: "/Users/delio/Library/LaunchAgents/com.opendeliobot.sentinel.plist" });
    files.set(unit, "garbage");
    expect(checkSentinelInstall("linux", "/home/delio", fs([]))).toEqual({ status: "unreadable", unit });
    expect(checkSentinelInstall("win32", "C:\\Users\\delio", fs([]))).toEqual({ status: "unsupported" });
  });
});
