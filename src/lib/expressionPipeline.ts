import { mapToExpression } from "./expressionMapper";
import {
  BlendshapeSmoother,
  ExpressionSignalTracker,
  ExpressionStabilizer,
  HeadRotationSmoother,
} from "./smoothing";
import {
  FFLExpression,
  type BlendshapeCategory,
  type ExpressionResult,
  type ExpressionScores,
  type ExpressionSignals,
  type HeadRotation,
} from "./types";
import type { TuningProfile } from "./tuningProfile";

export type ExpressionPipelineFrame = {
  expressionIndex: FFLExpression;
  mapped: ExpressionResult;
  rawMapped: ExpressionResult;
  rawBlendshapes: BlendshapeCategory[];
  calibratedBlendshapes: BlendshapeCategory[];
  smoothedBlendshapes: BlendshapeCategory[];
  signals: ExpressionSignals;
  headRotation: HeadRotation;
  remainingHoldMs: number;
};

export type MouthOpenSource = "camera" | "mic" | "max";

export function resolveMouthOpenSource(
  selectedSource: string | undefined,
  micRunning: boolean,
): MouthOpenSource {
  if (selectedSource === "camera") return "camera";
  if (selectedSource === "mic") return micRunning ? "mic" : "camera";
  if (selectedSource === "max") return "max";
  return "max";
}

export class ExpressionPipeline {
  private signalTracker: ExpressionSignalTracker;
  private expressionStabilizer: ExpressionStabilizer;
  private blendshapeSmoother: BlendshapeSmoother;
  private headRotationSmoother = new HeadRotationSmoother(0.35);

  constructor(private profile: TuningProfile) {
    this.signalTracker = new ExpressionSignalTracker(profile);
    this.expressionStabilizer = new ExpressionStabilizer(
      FFLExpression.Normal,
      profile.minimumHoldMs,
    );
    this.blendshapeSmoother = new BlendshapeSmoother(profile.oneEuro);
  }

  updateProfile(profile: TuningProfile) {
    this.profile = profile;
    this.signalTracker.updateProfile(profile);
    this.signalTracker.reset();
    this.expressionStabilizer.updateMinimumHoldMs(profile.minimumHoldMs);
    this.blendshapeSmoother.updateOptions(profile.oneEuro);
  }

  processFrame(
    blendshapes: BlendshapeCategory[],
    transformMatrix: Float32Array | undefined,
    nowMs: number,
    externalMouthOpenScore = 0,
    mouthOpenSource: MouthOpenSource = "camera",
  ): ExpressionPipelineFrame {
    const calibratedBlendshapes = calibrateBlendshapes(
      blendshapes,
      this.profile.calibration,
    );
    const smoothedBlendshapes = this.blendshapeSmoother.update(
      calibratedBlendshapes,
      nowMs,
    );
    const rawMapped = mapToExpression(
      smoothedBlendshapes,
      transformMatrix,
      undefined,
      this.profile,
    );
    rawMapped.scores.mouthOpen = selectMouthOpenScore(
      rawMapped.scores.mouthOpen,
      externalMouthOpenScore,
      mouthOpenSource,
    );
    const signals = this.signalTracker.update(rawMapped.scores);
    const mapped = mapToExpression(
      smoothedBlendshapes,
      transformMatrix,
      signals,
      this.profile,
    );
    mapped.scores.mouthOpen = rawMapped.scores.mouthOpen;
    const expressionIndex = this.expressionStabilizer.update(
      mapped.expressionIndex,
      nowMs,
    );
    const headRotation = this.headRotationSmoother.update(mapped.headRotation);

    return {
      expressionIndex,
      mapped,
      rawMapped,
      rawBlendshapes: blendshapes,
      calibratedBlendshapes,
      smoothedBlendshapes,
      signals,
      headRotation,
      remainingHoldMs: this.expressionStabilizer.getRemainingHoldMs(nowMs),
    };
  }

  reset() {
    this.signalTracker.reset();
    this.blendshapeSmoother.reset();
    this.headRotationSmoother.reset();
  }
}

function selectMouthOpenScore(
  cameraScore: number,
  externalScore: number,
  source: MouthOpenSource,
) {
  const clampedExternal = clamp01(externalScore);

  switch (source) {
    case "mic":
      return clampedExternal;
    case "max":
      return Math.max(cameraScore, clampedExternal);
    case "camera":
      return cameraScore;
  }
}

export function calibrateBlendshapes(
  blendshapes: BlendshapeCategory[],
  calibration: Record<string, number>,
): BlendshapeCategory[] {
  return blendshapes.map(({ categoryName, score }) => ({
    categoryName,
    score: clamp01(score - (calibration[categoryName] ?? 0)),
  }));
}

export function zeroExpressionScores(): ExpressionScores {
  return {
    mouthOpen: 0,
    smile: 0,
    blinkLeft: 0,
    blinkRight: 0,
    anger: 0,
    sorrow: 0,
    surprise: 0,
  };
}

export function zeroExpressionSignals(): ExpressionSignals {
  return {
    mouthOpen: false,
    smile: false,
    blinkLeft: false,
    blinkRight: false,
    anger: false,
    sorrow: false,
    surprise: false,
  };
}

export function averageBlendshapeSamples(samples: BlendshapeCategory[][]) {
  const totals = new Map<string, { sum: number; count: number }>();
  for (const sample of samples) {
    for (const { categoryName, score } of sample) {
      const total = totals.get(categoryName) ?? { sum: 0, count: 0 };
      total.sum += score;
      total.count += 1;
      totals.set(categoryName, total);
    }
  }

  return Object.fromEntries(
    [...totals.entries()].map(([categoryName, { sum, count }]) => [
      categoryName,
      sum / count,
    ]),
  );
}

function clamp01(value: number) {
  return Math.min(1, Math.max(0, value));
}
