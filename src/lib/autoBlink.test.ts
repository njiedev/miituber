import { describe, expect, it } from "vitest";
import { AutoBlinker, SustainedSignalGate, withBlink } from "./autoBlink";
import { FFLExpression } from "./types";

describe("auto blink timing", () => {
  const options = { minIntervalMs: 2000, maxIntervalMs: 6000, durationMs: 150 };

  it("waits a randomized interval, closes the eyes briefly, then reopens", () => {
    const blinker = new AutoBlinker(options, () => 0.5);

    expect(blinker.update(0)).toBe(false);
    expect(blinker.update(3999)).toBe(false);
    expect(blinker.update(4000)).toBe(true);
    expect(blinker.update(4149)).toBe(true);
    expect(blinker.update(4150)).toBe(false);
    expect(blinker.update(8149)).toBe(false);
    expect(blinker.update(8150)).toBe(true);
  });

  it("uses the random source to vary the interval", () => {
    const early = new AutoBlinker(options, () => 0);
    early.update(0);
    expect(early.update(2000)).toBe(true);

    const late = new AutoBlinker(options, () => 0.999);
    late.update(0);
    expect(late.update(5900)).toBe(false);
  });

  it("restarts the wait after reset so it doesn't blink immediately", () => {
    const blinker = new AutoBlinker(options, () => 0.5);
    blinker.update(0);
    blinker.reset();

    expect(blinker.update(10_000)).toBe(false);
    expect(blinker.update(14_000)).toBe(true);
  });
});

describe("withBlink", () => {
  it("closes the eyes on neutral faces while keeping the mouth state", () => {
    expect(withBlink(FFLExpression.Normal)).toBe(FFLExpression.Blink);
    expect(withBlink(FFLExpression.OpenMouth)).toBe(FFLExpression.BlinkOpenMouth);
  });

  it("holds emotions instead of replacing them with a neutral blink", () => {
    for (const expression of [
      FFLExpression.Smile,
      FFLExpression.Happy,
      FFLExpression.Anger,
      FFLExpression.AngerOpenMouth,
      FFLExpression.Sorrow,
      FFLExpression.SorrowOpenMouth,
      FFLExpression.Surprise,
      FFLExpression.SurpriseOpenMouth,
    ]) {
      expect(withBlink(expression)).toBe(expression);
    }
  });

  it("leaves expressions that already close an eye untouched", () => {
    expect(withBlink(FFLExpression.Blink)).toBe(FFLExpression.Blink);
    expect(withBlink(FFLExpression.WinkLeft)).toBe(FFLExpression.WinkLeft);
    expect(withBlink(FFLExpression.LikeWinkRight)).toBe(FFLExpression.LikeWinkRight);
  });
});

describe("SustainedSignalGate", () => {
  it("only passes a signal that has stayed active for the hold time", () => {
    const gate = new SustainedSignalGate(500);

    expect(gate.update(true, 0)).toBe(false);
    expect(gate.update(true, 499)).toBe(false);
    expect(gate.update(true, 500)).toBe(true);
    expect(gate.update(false, 600)).toBe(false);
    expect(gate.update(true, 700)).toBe(false);
  });
});
