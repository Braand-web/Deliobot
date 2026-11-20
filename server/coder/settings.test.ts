import { describe, expect, it } from "vitest";

import { CODING_GOAL_MAX_TURNS, coderOn, coderPatch, codingGoalTurns } from "./settings.ts";

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

  it("gives a goal in a project folder the long coding budget, and leaves other goals to the room default", () => {
    expect(codingGoalTurns({ cwd: "/home/a/shop" }, undefined, "/data/task-workspaces")).toBe(CODING_GOAL_MAX_TURNS);
    expect(codingGoalTurns({ cwd: undefined }, "/data/task-workspaces/b/t", "/data/task-workspaces")).toBeUndefined();
    expect(codingGoalTurns({ cwd: "/home/a/shop", coder: { enabled: false } }, undefined, "/data/task-workspaces")).toBeUndefined();
    expect(codingGoalTurns(null, "/x", "/data/task-workspaces")).toBeUndefined();
    expect(CODING_GOAL_MAX_TURNS).toBeGreaterThanOrEqual(200);
    expect(coderOn(undefined)).toBe(true);
  });
});
