import { describe, expect, it } from "vitest";
import {
  MOUSE_FOLLOW_MAX_PITCH,
  MOUSE_FOLLOW_MAX_YAW,
  mouseFollowTarget,
  stepMouseFollow,
  type MouseFollowGeometry,
} from "./mouseFollow";

function geometry(overrides: Partial<MouseFollowGeometry> = {}): MouseFollowGeometry {
  return {
    cursor: { x: 960, y: 540 },
    windowInnerPosition: { x: 0, y: 0 },
    windowScaleFactor: 1,
    monitorSize: { width: 1920, height: 1080 },
    monitorScaleFactor: 1,
    primaryScaleFactor: 1,
    headCss: { x: 960, y: 540 },
    isMac: false,
    ...overrides,
  };
}

describe("mouseFollowTarget", () => {
  it("looks straight ahead when the cursor is on the head", () => {
    const target = mouseFollowTarget(geometry());
    expect(target.yaw).toBeCloseTo(0);
    expect(target.pitch).toBeCloseTo(0);
    expect(target.roll).toBe(0);
  });

  it("turns toward the cursor: right is +yaw, below is +pitch", () => {
    const target = mouseFollowTarget(geometry({ cursor: { x: 1260, y: 840 } }));
    expect(target.yaw).toBeGreaterThan(0);
    expect(target.pitch).toBeGreaterThan(0);
  });

  it("clamps to the max turn when the cursor is on another monitor", () => {
    const target = mouseFollowTarget(geometry({ cursor: { x: -3000, y: -5000 } }));
    expect(target.yaw).toBeCloseTo(-MOUSE_FOLLOW_MAX_YAW);
    expect(target.pitch).toBeCloseTo(-MOUSE_FOLLOW_MAX_PITCH);
  });

  it("measures from the head, not the window center", () => {
    const target = mouseFollowTarget(
      geometry({ headCss: { x: 200, y: 540 }, cursor: { x: 200, y: 540 } }),
    );
    expect(target.yaw).toBeCloseTo(0);
  });

  it("scales CSS head offsets by the window scale on Windows", () => {
    const target = mouseFollowTarget(
      geometry({ windowScaleFactor: 1.5, headCss: { x: 640, y: 360 } }),
    );
    expect(target.yaw).toBeCloseTo(0);
    expect(target.pitch).toBeCloseTo(0);
  });

  it("compares in logical points on macOS with mixed-scale monitors", () => {
    const target = mouseFollowTarget(
      geometry({
        isMac: true,
        primaryScaleFactor: 2,
        windowScaleFactor: 1,
        monitorScaleFactor: 1,
        windowInnerPosition: { x: 1440, y: 0 },
        headCss: { x: 500, y: 400 },
        cursor: { x: (1440 + 500) * 2, y: 400 * 2 },
      }),
    );
    expect(target.yaw).toBeCloseTo(0);
    expect(target.pitch).toBeCloseTo(0);
  });
});

describe("stepMouseFollow", () => {
  const zero = { pitch: 0, yaw: 0, roll: 0 };
  const target = { pitch: 10, yaw: 20, roll: 0 };

  it("moves part of the way per frame", () => {
    const next = stepMouseFollow(zero, target, 1000 / 60);
    expect(next.yaw).toBeCloseTo(20 * 0.14);
  });

  it("is frame-rate independent", () => {
    let at30 = zero;
    for (let i = 0; i < 30; i += 1) at30 = stepMouseFollow(at30, target, 1000 / 30);
    let at60 = zero;
    for (let i = 0; i < 60; i += 1) at60 = stepMouseFollow(at60, target, 1000 / 60);
    expect(at30.yaw).toBeCloseTo(at60.yaw);
  });

  it("does not move with no elapsed time", () => {
    expect(stepMouseFollow(zero, target, 0)).toEqual(zero);
  });
});
