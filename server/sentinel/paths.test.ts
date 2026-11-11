import { describe, expect, it } from "vitest";

import { defaultSentinelOut, isInside } from "./paths.ts";

describe("sentinel paths", () => {
  it("keeps Sentinel's files in the platform's state folder, outside the data dir", () => {
    expect(defaultSentinelOut("/Users/delio/.opendeliobot", "darwin", "/Users/delio", {})).toBe("/Users/delio/Library/Application Support/opendeliobot-sentinel");
    expect(defaultSentinelOut("/home/delio/.opendeliobot", "linux", "/home/delio", {})).toBe("/home/delio/.local/state/opendeliobot-sentinel");
    expect(defaultSentinelOut("/home/delio/.opendeliobot", "linux", "/home/delio", { XDG_STATE_HOME: "/var/state/delio" })).toBe("/var/state/delio/opendeliobot-sentinel");
    // a relative XDG_STATE_HOME is invalid by the spec and ignored
    expect(defaultSentinelOut("/home/delio/.opendeliobot", "linux", "/home/delio", { XDG_STATE_HOME: "state" })).toBe("/home/delio/.local/state/opendeliobot-sentinel");
    expect(defaultSentinelOut("C:\\Users\\delio\\.opendeliobot", "win32", "C:\\Users\\delio", { LOCALAPPDATA: "D:\\Local" })).toBe("D:\\Local\\opendeliobot-sentinel");
  });

  it("gives any other data dir its own subfolder, the same one every time", () => {
    const other = defaultSentinelOut("/srv/odb-data", "linux", "/home/delio", {});
    expect(other).toMatch(/^\/home\/delio\/\.local\/state\/opendeliobot-sentinel\/data-[0-9a-f]{12}$/);
    expect(defaultSentinelOut("/srv/odb-data", "linux", "/home/delio", {})).toBe(other);
    expect(defaultSentinelOut("/srv/odb-data-2", "linux", "/home/delio", {})).not.toBe(other);
  });

  it("knows when a folder is inside another", () => {
    expect(isInside("/d/odb/sentinel", "/d/odb", "linux")).toBe(true);
    expect(isInside("/d/odb", "/d/odb", "linux")).toBe(true);
    expect(isInside("/d/odb-sentinel", "/d/odb", "linux")).toBe(false);
    expect(isInside("/d", "/d/odb", "linux")).toBe(false);
    expect(isInside("C:\\d\\odb\\x", "C:\\d\\odb", "win32")).toBe(true);
  });
});
