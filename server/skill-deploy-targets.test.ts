import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { parseSkillMd, scanSkillText } from "../shared/skill-md.ts";
import { loadBundledSkills, selectBundledSkills } from "./skill-library.ts";

const skills = loadBundledSkills(join(process.cwd(), "skills"));
const picked = (text: string) => selectBundledSkills(text, [], skills).map((entry) => entry.manifest.id);

describe("deploying to the person's own accounts and GitHub", () => {
  it.each(["deploy-to-cloudflare", "github-pull-requests"])("%s is a valid skill the scanner has nothing to say about", (id) => {
    const skill = skills.find((entry) => entry.manifest.id === id);
    expect(skill?.manifest.defaultEnabled).toBe(true);
    expect(parseSkillMd(skill!.instructions)).toMatchObject({ name: id });
    expect(scanSkillText(skill!.instructions)).toEqual([]);
  });

  it("is picked for what the person asks", () => {
    expect(picked("put my worker and its D1 database on cloudflare")).toContain("deploy-to-cloudflare");
    expect(picked("open a pull request on github for this fix")).toContain("github-pull-requests");
  });

  it("never writes a token into a command: wrangler and git read it from its file", () => {
    const cloudflare = skills.find((entry) => entry.manifest.id === "deploy-to-cloudflare")!.instructions;
    expect(cloudflare).toContain('CLOUDFLARE_API_TOKEN="$(cat <the token file\'s path>)"');
    expect(cloudflare).toMatch(/wrangler@\d+\.\d+\.\d+/);
  });

  it("hands git the token from its file through the one-off credential helper the guide gives", () => {
    const guide = skills.find((entry) => entry.manifest.id === "github-pull-requests")!.instructions;
    const helper = /git -c credential\.helper= -c credential\.helper='(.+?)' <git command>/.exec(guide)![1]!;
    const dir = mkdtempSync(join(tmpdir(), "odb-git-helper-"));
    const tokenFile = join(dir, "token");
    writeFileSync(tokenFile, "ghp_test_value\n");
    const filled = execFileSync("git", ["-c", "credential.helper=", "-c", `credential.helper=${helper.replace("<token file path>", tokenFile)}`, "credential", "fill"], {
      input: "protocol=https\nhost=github.com\n\n", env: { ...process.env, GIT_TERMINAL_PROMPT: "0" }, encoding: "utf8",
    });
    expect(filled).toContain("username=x-access-token");
    expect(filled).toContain("password=ghp_test_value");
    expect(readFileSync(tokenFile, "utf8")).toBe("ghp_test_value\n");
  });
});
