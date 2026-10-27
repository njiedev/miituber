import { describe, expect, it } from "vitest";
import type { BlinkMode } from "./autoBlink";
import {
  averageBlendshapeSamples,
  calibrateBlendshapes,
  ExpressionPipeline,
  resolveMouthOpenSource,
} from "./expressionPipeline";
import { FFLExpression, type BlendshapeCategory } from "./types";
import { createDefaultTuningProfile } from "./tuningProfile";

function shapes(scores: Record<string, number>): BlendshapeCategory[] {
  return Object.entries(scores).map(([categoryName, score]) => ({
    categoryName,
    score,
  }));
}

describe("ExpressionPipeline", () => {
  it("runs smoothed scores through hysteresis and composition", () => {
    const profile = createDefaultTuningProfile();
    profile.oneEuro = { minCutoff: 20, beta: 1, derivativeCutoff: 1 };
    profile.minimumHoldMs = 0;
    const pipeline = new ExpressionPipeline(profile);

    const neutral = pipeline.processFrame([], undefined, 0);
    const smile = pipeline.processFrame(
      shapes({ mouthSmileLeft: 0.9, mouthSmileRight: 0.9 }),
      undefined,
      33,
    );

    expect(neutral.expressionIndex).toBe(FFLExpression.Normal);
    expect(smile.expressionIndex).toBe(FFLExpression.Smile);
    expect(smile.signals.smile).toBe(true);
    expect(smile.mapped.channels).toEqual({
      eyes: "open",
      mouth: "closed",
      emotion: "smile",
    });
  });

  it("holds the previous expression until min-hold elapses", () => {
    const profile = createDefaultTuningProfile();
    profile.oneEuro = { minCutoff: 20, beta: 1, derivativeCutoff: 1 };
    profile.minimumHoldMs = 100;
    const pipeline = new ExpressionPipeline(profile);

    pipeline.processFrame([], undefined, 0);
    const earlySmile = pipeline.processFrame(
      shapes({ mouthSmileLeft: 0.9, mouthSmileRight: 0.9 }),
      undefined,
      33,
    );
    const heldSmile = pipeline.processFrame(
      shapes({ mouthSmileLeft: 0.9, mouthSmileRight: 0.9 }),
      undefined,
      100,
    );

    expect(earlySmile.expressionIndex).toBe(FFLExpression.Normal);
    expect(earlySmile.remainingHoldMs).toBeGreaterThan(0);
    expect(heldSmile.expressionIndex).toBe(FFLExpression.Smile);
  });

  it("applies calibration before signal tracking", () => {
    const profile = createDefaultTuningProfile();
    profile.oneEuro = { minCutoff: 20, beta: 1, derivativeCutoff: 1 };
    profile.minimumHoldMs = 0;
    profile.calibration = {
      mouthSmileLeft: 0.35,
      mouthSmileRight: 0.35,
    };
    const pipeline = new ExpressionPipeline(profile);

    const frame = pipeline.processFrame(
      shapes({ mouthSmileLeft: 0.7, mouthSmileRight: 0.7 }),
      undefined,
      33,
    );

    expect(frame.rawMapped.scores.smile).toBeCloseTo(0.35);
    expect(frame.expressionIndex).toBe(FFLExpression.Normal);
    expect(frame.calibratedBlendshapes).toEqual([
      { categoryName: "mouthSmileLeft", score: 0.35 },
      { categoryName: "mouthSmileRight", score: 0.35 },
    ]);
  });

  it("keeps microphone and camera mouth activation independent", () => {
    const profile = createDefaultTuningProfile();
    profile.minimumHoldMs = 0;
    profile.thresholds.mouthOpen = { enter: 0.9, exit: 0.8 };
    profile.lipSync.activation = { enter: 0.2, exit: 0.1, gain: 1 };
    const pipeline = new ExpressionPipeline(profile);

    const micFrame = pipeline.processFrame(
      shapes({ jawOpen: 0.4 }),
      undefined,
      0,
      0.3,
      "mic",
    );

    expect(micFrame.cameraMouthOpenSignal).toBe(false);
    expect(micFrame.microphoneMouthOpenSignal).toBe(true);
    expect(micFrame.signals.mouthOpen).toBe(true);

    profile.thresholds.mouthOpen = { enter: 0.2, exit: 0.1 };
    profile.lipSync.activation = { enter: 0.9, exit: 0.8, gain: 1 };
    pipeline.updateProfile(profile);
    const cameraFrame = pipeline.processFrame(
      shapes({ jawOpen: 0.4 }),
      undefined,
      33,
      0.3,
      "camera",
    );

    expect(cameraFrame.cameraMouthOpenSignal).toBe(true);
    expect(cameraFrame.microphoneMouthOpenSignal).toBe(false);
    expect(cameraFrame.signals.mouthOpen).toBe(true);
  });

  it("applies microphone gain without changing the camera score", () => {
    const profile = createDefaultTuningProfile();
    profile.minimumHoldMs = 0;
    profile.lipSync.activation = { enter: 0.5, exit: 0.3, gain: 2 };
    const pipeline = new ExpressionPipeline(profile);

    const frame = pipeline.processFrame(
      shapes({ jawOpen: 0.25 }),
      undefined,
      0,
      0.3,
      "max",
    );

    expect(frame.cameraMouthOpenScore).toBeCloseTo(0.25);
    expect(frame.microphoneMouthOpenScore).toBeCloseTo(0.6);
  });

  it("can update tuning profile at runtime", () => {
    const profile = createDefaultTuningProfile();
    profile.oneEuro = { minCutoff: 20, beta: 1, derivativeCutoff: 1 };
    profile.minimumHoldMs = 0;
    const pipeline = new ExpressionPipeline(profile);

    expect(
      pipeline.processFrame(
        shapes({ mouthSmileLeft: 0.45, mouthSmileRight: 0.45 }),
        undefined,
        33,
      ).expressionIndex,
    ).toBe(FFLExpression.Normal);

    profile.thresholds.smile.enter = 0.4;
    profile.thresholds.smile.exit = 0.3;
    pipeline.updateProfile(profile);

    expect(
      pipeline.processFrame(
        shapes({ mouthSmileLeft: 0.45, mouthSmileRight: 0.45 }),
        undefined,
        66,
      ).expressionIndex,
    ).toBe(FFLExpression.Smile);
  });
});

describe("blink modes", () => {
  const closedEyes = shapes({ eyeBlinkLeft: 0.9, eyeBlinkRight: 0.9 });

  function pipeline(mode: BlinkMode) {
    const profile = createDefaultTuningProfile();
    profile.oneEuro = { minCutoff: 20, beta: 1, derivativeCutoff: 1 };
    profile.minimumHoldMs = 0;
    const subject = new ExpressionPipeline(profile);
    subject.setBlinkMode(mode);
    return subject;
  }

  it("ignores a quick tracked blink but shows eyes held closed in camera + auto mode", () => {
    const subject = pipeline("both");

    expect(subject.processFrame(closedEyes, undefined, 0).expressionIndex).toBe(
      FFLExpression.Normal,
    );
    expect(subject.processFrame(closedEyes, undefined, 200).expressionIndex).toBe(
      FFLExpression.Normal,
    );
    expect(subject.processFrame(closedEyes, undefined, 500).expressionIndex).toBe(
      FFLExpression.Blink,
    );
  });

  it("passes tracked blinks straight through in camera mode", () => {
    expect(pipeline("camera").processFrame(closedEyes, undefined, 0).expressionIndex).toBe(
      FFLExpression.Blink,
    );
  });

  it("ignores tracked eyes entirely in auto only mode", () => {
    const subject = pipeline("auto");

    expect(subject.processFrame(closedEyes, undefined, 0).expressionIndex).toBe(
      FFLExpression.Normal,
    );
    expect(subject.processFrame(closedEyes, undefined, 1000).expressionIndex).toBe(
      FFLExpression.Normal,
    );
    expect(
      subject.processFrame(shapes({ eyeBlinkLeft: 0.9 }), undefined, 2000).expressionIndex,
    ).toBe(FFLExpression.Normal);
  });
});

describe("expression pipeline helpers", () => {
  it("subtracts neutral calibration before smoothing", () => {
    expect(
      calibrateBlendshapes(shapes({ jawOpen: 0.6, eyeBlinkLeft: 0.2 }), {
        jawOpen: 0.25,
        eyeBlinkLeft: 0.4,
      }),
    ).toEqual([
      { categoryName: "jawOpen", score: 0.35 },
      { categoryName: "eyeBlinkLeft", score: 0 },
    ]);
  });

  it("averages calibration samples per blendshape category", () => {
    expect(
      averageBlendshapeSamples([
        shapes({ jawOpen: 0.2, eyeBlinkLeft: 0.4 }),
        shapes({ jawOpen: 0.4, eyeBlinkLeft: 0.8 }),
      ]),
    ).toEqual({
      jawOpen: 0.30000000000000004,
      eyeBlinkLeft: 0.6000000000000001,
    });
  });

  it("falls back from mic-only to camera jaw when mic is not running", () => {
    expect(resolveMouthOpenSource("mic", true)).toBe("mic");
    expect(resolveMouthOpenSource("mic", false)).toBe("camera");
    expect(resolveMouthOpenSource("max", false)).toBe("max");
    expect(resolveMouthOpenSource(undefined, false)).toBe("max");
  });
});
