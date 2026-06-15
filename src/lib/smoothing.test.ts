import { describe, expect, it } from "vitest";
import {
  ExpressionSignalTracker,
  ExpressionStabilizer,
  HeadRotationSmoother,
  HysteresisTracker,
} from "./smoothing";
import { FFLExpression } from "./types";

describe("ExpressionStabilizer", () => {
  it("holds the current expression until the minimum hold time passes", () => {
    const stabilizer = new ExpressionStabilizer(FFLExpression.Normal, 100);

    expect(stabilizer.update(FFLExpression.Smile, 50)).toBe(FFLExpression.Normal);
    expect(stabilizer.update(FFLExpression.Smile, 100)).toBe(FFLExpression.Smile);
  });

  it("does not reset the hold timer when the expression stays the same", () => {
    const stabilizer = new ExpressionStabilizer(FFLExpression.Normal, 100);

    expect(stabilizer.update(FFLExpression.Normal, 1000)).toBe(FFLExpression.Normal);
    expect(stabilizer.update(FFLExpression.Smile, 1050)).toBe(FFLExpression.Smile);
  });
});

describe("HysteresisTracker", () => {
  it("enters at the high threshold and exits at the low threshold", () => {
    const tracker = new HysteresisTracker(0.6, 0.4);

    expect(tracker.update(0.5)).toBe(false);
    expect(tracker.update(0.7)).toBe(true);
    expect(tracker.update(0.5)).toBe(true);
    expect(tracker.update(0.3)).toBe(false);
  });

  it("can reset to inactive", () => {
    const tracker = new HysteresisTracker(0.6, 0.4);

    tracker.update(0.7);
    tracker.reset();

    expect(tracker.update(0.5)).toBe(false);
  });
});

describe("ExpressionSignalTracker", () => {
  it("keeps a smile active while its score hovers near the threshold", () => {
    const tracker = new ExpressionSignalTracker();

    expect(
      tracker.update({
        mouthOpen: 0,
        smile: 0.56,
        blinkLeft: 0,
        blinkRight: 0,
        anger: 0,
        sorrow: 0,
        surprise: 0,
      }).smile,
    ).toBe(true);

    expect(
      tracker.update({
        mouthOpen: 0,
        smile: 0.5,
        blinkLeft: 0,
        blinkRight: 0,
        anger: 0,
        sorrow: 0,
        surprise: 0,
      }).smile,
    ).toBe(true);
  });
});

describe("HeadRotationSmoother", () => {
  it("moves partway toward the next head rotation", () => {
    const smoother = new HeadRotationSmoother(0.5);

    expect(smoother.update({ pitch: 10, yaw: -10, roll: 20 })).toEqual({
      pitch: 5,
      yaw: -5,
      roll: 10,
    });
  });

  it("can reset back to neutral", () => {
    const smoother = new HeadRotationSmoother(1);

    smoother.update({ pitch: 10, yaw: -10, roll: 20 });
    smoother.reset();

    expect(smoother.update({ pitch: 0, yaw: 0, roll: 0 })).toEqual({
      pitch: 0,
      yaw: 0,
      roll: 0,
    });
  });
});
