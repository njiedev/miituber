import { describe, expect, it } from "vitest";
import { LipSyncEnvelope, normalizeAmplitude, rootMeanSquare } from "./lipSync";

describe("lip sync amplitude envelope", () => {
  it("computes RMS volume from samples", () => {
    expect(rootMeanSquare(new Float32Array([1, -1, 1, -1]))).toBe(1);
    expect(rootMeanSquare(new Float32Array([0, 0, 0]))).toBe(0);
  });

  it("normalizes silence and speaking levels", () => {
    expect(normalizeAmplitude(0.01, 0.02, 0.12)).toBe(0);
    expect(normalizeAmplitude(0.12, 0.02, 0.12)).toBe(1);
    expect(normalizeAmplitude(0.07, 0.02, 0.12)).toBeCloseTo(0.5);
  });

  it("smooths sudden volume changes", () => {
    const envelope = new LipSyncEnvelope({
      noiseFloor: 0,
      speakingLevel: 1,
      smoothing: 0.5,
    });

    expect(envelope.update(new Float32Array([1, 1]))).toBeCloseTo(0.5);
    expect(envelope.update(new Float32Array([1, 1]))).toBeCloseTo(0.75);
  });
});
