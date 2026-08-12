import { describe, expect, it } from "vitest";
import {
  createDefaultTuningProfile,
  normalizeTuningProfile,
  parseTuningProfileJson,
  serializeTuningProfile,
} from "./tuningProfile";

describe("tuning profile", () => {
  it("creates independent default profile copies", () => {
    const first = createDefaultTuningProfile();
    const second = createDefaultTuningProfile();

    first.thresholds.smile.enter = 0.9;

    expect(second.thresholds.smile.enter).toBe(0.55);
  });

  it("normalizes invalid loaded values back into safe ranges", () => {
    const profile = normalizeTuningProfile({
      thresholds: {
        smile: { enter: 2, exit: 0.8 },
      } as never,
      gains: {
        smile: 9,
      } as never,
      oneEuro: {
        minCutoff: -1,
        beta: -2,
        derivativeCutoff: 0,
      },
      lipSync: {
        noiseFloor: 2,
        speakingLevel: 0.01,
        smoothing: -1,
        activation: { enter: 2, exit: 0.8, gain: 9 },
      },
      minimumHoldMs: -10,
      calibration: {
        jawOpen: 1.4,
        bad: Number.NaN,
      },
    });

    expect(profile.thresholds.smile).toEqual({ enter: 1, exit: 0.8 });
    expect(profile.gains.smile).toBe(3);
    expect(profile.oneEuro).toEqual({
      minCutoff: 1,
      beta: 0,
      derivativeCutoff: 1,
    });
    expect(profile.lipSync).toEqual({
      noiseFloor: 0.5,
      speakingLevel: 0.501,
      smoothing: 0,
      activation: { enter: 1, exit: 0.8, gain: 3 },
    });
    expect(profile.minimumHoldMs).toBe(0);
    expect(profile.calibration).toEqual({ jawOpen: 1 });
  });

  it("round-trips through JSON", () => {
    const profile = createDefaultTuningProfile();
    profile.minimumHoldMs = 250;

    expect(parseTuningProfileJson(serializeTuningProfile(profile)).minimumHoldMs).toBe(
      250,
    );
  });

  it("adds independent microphone activation defaults to older profiles", () => {
    const olderProfile = createDefaultTuningProfile() as unknown as {
      lipSync: Omit<ReturnType<typeof createDefaultTuningProfile>["lipSync"], "activation">;
    };
    delete (olderProfile.lipSync as { activation?: unknown }).activation;

    expect(normalizeTuningProfile(olderProfile as never).lipSync.activation).toEqual({
      enter: 0.45,
      exit: 0.32,
      gain: 1,
    });
  });
});
