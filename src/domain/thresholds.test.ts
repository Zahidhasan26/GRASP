import { describe, expect, it } from "vitest";

import {
  inTherapeuticWindow,
  normalizeThresholds,
  recommendedGripLevel,
  type ThresholdProfile,
} from "./thresholds";

describe("threshold profile", () => {
  it("normalizes out-of-order levels", () => {
    const profile: ThresholdProfile = { sensory: 6, motor: 3, tolerance: 2 };
    expect(normalizeThresholds(profile, 10)).toEqual({
      sensory: 6,
      motor: 6,
      tolerance: 6,
    });
  });

  it("computes midpoint grip level", () => {
    expect(recommendedGripLevel({ sensory: 4, motor: 6, tolerance: 8 })).toBe(5);
  });

  it("checks therapeutic range inclusively", () => {
    const profile: ThresholdProfile = { sensory: 4, motor: 6, tolerance: 8 };
    expect(inTherapeuticWindow(4, profile)).toBe(true);
    expect(inTherapeuticWindow(6, profile)).toBe(true);
    expect(inTherapeuticWindow(7, profile)).toBe(false);
  });
});
