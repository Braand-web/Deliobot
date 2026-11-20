import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { bundledSkillsIndex, loadBundledSkills, selectBundledSkills } from "./skill-library.ts";

const skills = loadBundledSkills(join(process.cwd(), "skills"));
const picked = (text: string) => selectBundledSkills(text, [], skills).map((skill) => skill.manifest.id);

describe("built-in skills a bot finds by itself", () => {
  it("lists every built-in skill the turn may use, with when it applies and its guide, and tells the bot to use it unasked", () => {
    const index = bundledSkillsIndex(skills, []);
    for (const id of ["publish-to-netlify", "deploy-to-vercel", "deploy-to-cloudflare", "github-pull-requests", "data-dashboards", "social-posts"]) {
      expect(index).toMatch(new RegExp(`\\n- ${id}: .+`));
    }
    const root = JSON.parse(/each guide at ("[^"]+")/.exec(index)![1]!) as string;
    expect(root).toBe(join(process.cwd(), "skills", "<id>", "SKILL.md"));
    expect(index).toContain("in any language");
    expect(index).toContain("without waiting to be asked");
    expect(index).not.toContain("phone-harness");
    expect(bundledSkillsIndex(skills, ["phoneMcp"])).toContain("phone-harness");
    expect(Buffer.byteLength(index)).toBeLessThan(6_000);
  });

  it("picks the right skill from a request written in French", () => {
    expect(picked("mets mon site en ligne s'il te plaît")).toContain("publish-to-netlify");
    expect(picked("déploie l'app next.js en production")).toContain("deploy-to-vercel");
    expect(picked("ouvre une pr sur le dépôt github avec le correctif")).toContain("github-pull-requests");
    expect(picked("fais un tableau de bord des ventes")).toContain("data-dashboards");
    expect(picked("rédige un post linkedin sur notre lancement")).toContain("social-posts");
    expect(picked("bonjour, comment vas-tu ?")).toEqual([]);
  });
});
