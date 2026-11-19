import { describe, expect, it } from "vitest";

import { coderPatch } from "./settings.ts";

describe("coder settings from a request", () => {
  it("keeps valid fields, drops empty ones and refuses the rest", () => {
    expect(coderPatch({ enabled: true, verify: [" npm test ", ""], maxRounds: 2, review: { instanceId: "codex", model: "gpt-5" }, previewUrl: "http://localhost:3000" }))
      .toEqual({ value: { enabled: true, verify: ["npm test"], maxRounds: 2, review: { instanceId: "codex", model: "gpt-5" }, previewUrl: "http://localhost:3000/" } });
    expect(coderPatch(null)).toEqual({ value: undefined });
    expect(coderPatch({ enabled: "yes" })).toHaveProperty("error");
    expect(coderPatch({ enabled: true, maxRounds: 9 })).toHaveProperty("error");
    expect(coderPatch({ enabled: true, verify: ["a\nb"] })).toHaveProperty("error");
    expect(coderPatch({ enabled: true, previewUrl: "file:///etc/passwd" })).toHaveProperty("error");
  });
});
