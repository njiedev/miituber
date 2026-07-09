import { describe, expect, it } from "vitest";
import { maxFpsToMinIntervalMs } from "./faceTracker";

describe("maxFpsToMinIntervalMs", () => {
  it("converts a tracking fps cap into a minimum frame interval", () => {
    expect(maxFpsToMinIntervalMs(30)).toBeCloseTo(33.333);
    expect(maxFpsToMinIntervalMs(25)).toBe(40);
  });

  it("guards against zero or negative fps caps", () => {
    expect(maxFpsToMinIntervalMs(0)).toBe(1000);
    expect(maxFpsToMinIntervalMs(-10)).toBe(1000);
  });
});
