import { describe, expect, it } from "vitest";

import { localPath } from "./app.ts";

describe("where the portal sends someone back after signing in", () => {
  it("keeps paths on this portal and refuses every way of reaching another site", () => {
    expect(localPath("/pay?plan=pro&cycle=month")).toBe("/pay?plan=pro&cycle=month");
    expect(localPath("/billing#paid")).toBe("/billing#paid");
    for (const bad of ["//evil.test", "/\\evil.test", "/\t/evil.test", "/%09/evil.test".replace("%09", "\t"), "https://evil.test", "/\n/evil.test", "", null]) {
      expect(localPath(bad), String(bad)).toBe("/");
    }
  });
});
