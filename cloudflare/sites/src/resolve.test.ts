import { describe, expect, it } from "vitest";

import { resolveSitePath, type SiteManifest } from "./resolve.ts";

const file = (sha1: string) => ({ sha1, type: "text/html; charset=utf-8" });
const site = (files: Record<string, string>): SiteManifest => ({ workspace: "acme", key: "app-1", files: Object.fromEntries(Object.entries(files).map(([path, sha1]) => [path, file(sha1)])) });

describe("resolveSitePath", () => {
  const manifest = site({ "index.html": "a", "about/index.html": "b", "contact.html": "c", "app.js": "d" });

  it("serves the file, a folder's index.html, and the .html beside a path", () => {
    expect(resolveSitePath(manifest, "/")?.file.sha1).toBe("a");
    expect(resolveSitePath(manifest, "/about")?.file.sha1).toBe("b");
    expect(resolveSitePath(manifest, "/about/")?.file.sha1).toBe("b");
    expect(resolveSitePath(manifest, "/contact")?.file.sha1).toBe("c");
    expect(resolveSitePath(manifest, "/app.js")?.file.sha1).toBe("d");
  });

  it("serves index.html for an unknown page of a single-page app, and nothing for a missing asset", () => {
    expect(resolveSitePath(manifest, "/settings/profile")).toEqual({ file: file("a"), status: 200 });
    expect(resolveSitePath(manifest, "/missing.png")).toBeNull();
  });

  it("prefers the site's own 404.html, with a 404", () => {
    expect(resolveSitePath(site({ "index.html": "a", "404.html": "e" }), "/nowhere")).toEqual({ file: file("e"), status: 404 });
  });

  it("never walks out of the site", () => {
    expect(resolveSitePath(manifest, "/../index.html")).toBeNull();
  });
});
