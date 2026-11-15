import { describe, expect, it } from "vitest";

import { DELIO_DEFAULT_FEATURES, withDelioFeatureDefaults } from "./delio-feature-defaults.ts";

describe("the Deliobot desktop app's feature defaults", () => {
  const packaged = { ODB_DELIO_FEATURE_DEFAULTS: "1" };

  it("turns the switches on for someone who never set them", () => {
    expect(withDelioFeatureDefaults(undefined, packaged)).toEqual(DELIO_DEFAULT_FEATURES);
  });

  it("keeps a switch the person turned off, and leaves the technical ones alone", () => {
    const features = withDelioFeatureDefaults({ skillReview: false }, packaged);
    expect(features).toMatchObject({ skillReview: false, skillsLibrary: true, parallelRoomJobs: true });
    expect(features).not.toHaveProperty("acpPlanLines");
    expect(features).not.toHaveProperty("agentsToolBridge");
  });

  it("changes nothing outside the packaged app", () => {
    expect(withDelioFeatureDefaults({ skillReview: false }, {})).toEqual({ skillReview: false });
    expect(withDelioFeatureDefaults(undefined, {})).toBeUndefined();
  });
});
