import { describe, expect, it } from "vitest";

import { parseReview, reviewPrompt } from "./review.ts";

describe("the review by another engine", () => {
  it("reads the last verdict block, and treats a missing one as approved", () => {
    expect(parseReview('Looks fine.\n<review verdict="approve">matches the request</review>')).toEqual({ verdict: "approve", notes: "matches the request" });
    expect(parseReview('<review verdict="approve">x</review> then <review verdict="changes">\nsrc/a.ts: null check missing\n</review>'))
      .toEqual({ verdict: "changes", notes: "src/a.ts: null check missing" });
    expect(parseReview("I could not decide.")).toEqual({ verdict: "approve", notes: "" });
  });

  it("gives the reviewer the request, the checks, the diff and the preview to open", () => {
    const prompt = reviewPrompt({ request: "Add a contact form", diff: "+<form>", checks: ["pnpm run test"], previewUrl: "http://localhost:5173/" });
    expect(prompt).toContain("Add a contact form");
    expect(prompt).toContain("pnpm run test");
    expect(prompt).toContain("+<form>");
    expect(prompt).toContain("http://localhost:5173/");
    expect(prompt).toContain("Do not edit any file");
  });
});
