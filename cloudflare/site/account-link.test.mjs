import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const PUBLIC = join(import.meta.dirname, "public");
const pages = (dir) => readdirSync(dir).flatMap((name) => statSync(join(dir, name)).isDirectory() ? pages(join(dir, name)) : name.endsWith(".html") ? [join(dir, name)] : []);

describe("the account link on the public site", () => {
  it("is marked on every page that links to the portal's sign-in, and the page loads the script that names it", () => {
    const linked = pages(PUBLIC).filter((file) => readFileSync(file, "utf8").includes("compte.deliobot.fun/login"));
    expect(linked.length).toBeGreaterThan(5);
    for (const file of linked) {
      const html = readFileSync(file, "utf8");
      const links = html.match(/<a [^>]*href="https:\/\/compte\.deliobot\.fun\/login"[^>]*>/g) ?? [];
      expect(links.length, file).toBeGreaterThan(0);
      for (const link of links) expect(link, file).toContain("data-account-link");
      expect(html, file).toContain('<script src="/account.js" defer></script>');
    }
  });

  it("welcomes a new account above the downloads", () => {
    const home = readFileSync(join(PUBLIC, "index.html"), "utf8");
    expect(home.indexOf("data-welcome hidden")).toBeGreaterThan(home.indexOf('id="telecharger"'));
    const script = readFileSync(join(PUBLIC, "account.js"), "utf8");
    expect(script).toContain('"/login?intent=signup"');
    expect(script).toContain("delio-known=1");
  });
});
