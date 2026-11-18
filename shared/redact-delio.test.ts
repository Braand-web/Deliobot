import { describe, expect, it } from "vitest";

import { holdsCredential, redactSecretsInText } from "./redact.ts";

describe("Delio account tokens in text", () => {
  it("are masked like any other credential", () => {
    const token = `odb_device_${"Ab3_-".repeat(8)}xyz`;
    expect(holdsCredential(`token ${token}`)).toBe(true);
    expect(redactSecretsInText(`the app sent ${token} to the portal`)).not.toContain(token);
    expect(redactSecretsInText(`odb_ai_${"x".repeat(43)}`)).not.toContain("x".repeat(43));
  });
});
