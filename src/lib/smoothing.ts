import type { BlendshapeCategory, ExpressionScores, FFLExpression, HeadRotation } from "./types";
import type { TuningProfile } from "./tuningProfile";

export type OneEuroFilterOptions = {
  minCutoff: number;
  beta: number;
  derivativeCutoff: number;
};

const DEFAULT_ONE_EURO_OPTIONS: OneEuroFilterOptions = {
  minCutoff: 1,
  beta: 0.02,
  derivativeCutoff: 1,
};

export class OneEuroFilter {
  private previousValue: number | null = null;
  private previousDerivative = 0;
  private previousTimeMs: number | null = null;

  constructor(private readonly options: OneEuroFilterOptions = DEFAULT_ONE_EURO_OPTIONS) {}

  update(value: number, nowMs: number) {
    if (this.previousValue === null || this.previousTimeMs === null) {
      this.previousValue = value;
      this.previousTimeMs = nowMs;
      return value;
    }

    const elapsedSeconds = Math.max((nowMs - this.previousTimeMs) / 1000, 1 / 1000);
    const rawDerivative = (value - this.previousValue) / elapsedSeconds;
    const derivative = lowPass(
      rawDerivative,
      this.previousDerivative,
      smoothingAlpha(this.options.derivativeCutoff, elapsedSeconds),
    );
    const cutoff = this.options.minCutoff + this.options.beta * Math.abs(derivative);
    const smoothed = lowPass(
      value,
      this.previousValue,
      smoothingAlpha(cutoff, elapsedSeconds),
    );

    this.previousValue = smoothed;
    this.previousDerivative = derivative;
    this.previousTimeMs = nowMs;
    return smoothed;
  }

  reset() {
    this.previousValue = null;
    this.previousDerivative = 0;
    this.previousTimeMs = null;
  }
}

export class BlendshapeSmoother {
  private readonly filters = new Map<string, OneEuroFilter>();

  constructor(private options: OneEuroFilterOptions = DEFAULT_ONE_EURO_OPTIONS) {}

  update(blendshapes: BlendshapeCategory[], nowMs: number): BlendshapeCategory[] {
    return blendshapes.map(({ categoryName, score }) => ({
      categoryName,
      score: this.filterFor(categoryName).update(score, nowMs),
    }));
  }

  reset() {
    this.filters.clear();
  }

  updateOptions(options: OneEuroFilterOptions) {
    this.options = options;
    this.reset();
  }

  private filterFor(categoryName: string) {
    const existing = this.filters.get(categoryName);
    if (existing) return existing;

    const filter = new OneEuroFilter(this.options);
    this.filters.set(categoryName, filter);
    return filter;
  }
}

export class ExpressionStabilizer {
  private currentExpression: FFLExpression;
  private lastChangedAt = 0;

  constructor(
    initialExpression: FFLExpression,
    private minimumHoldMs: number,
  ) {
    this.currentExpression = initialExpression;
  }

  update(nextExpression: FFLExpression, nowMs: number) {
    if (
      nextExpression !== this.currentExpression &&
      nowMs - this.lastChangedAt >= this.minimumHoldMs
    ) {
      this.currentExpression = nextExpression;
      this.lastChangedAt = nowMs;
    }

    return this.currentExpression;
  }

  updateMinimumHoldMs(minimumHoldMs: number) {
    this.minimumHoldMs = minimumHoldMs;
  }

  getRemainingHoldMs(nowMs: number) {
    return Math.max(0, this.minimumHoldMs - (nowMs - this.lastChangedAt));
  }
}

export class HeadRotationSmoother {
  private current: HeadRotation = { pitch: 0, yaw: 0, roll: 0 };

  constructor(private readonly response: number) {}

  update(next: HeadRotation) {
    this.current = {
      pitch: lerp(this.current.pitch, next.pitch, this.response),
      yaw: lerp(this.current.yaw, next.yaw, this.response),
      roll: lerp(this.current.roll, next.roll, this.response),
    };

    return { ...this.current };
  }

  reset() {
    this.current = { pitch: 0, yaw: 0, roll: 0 };
  }
}

export class HysteresisTracker {
  private active = false;

  constructor(
    private enterThreshold: number,
    private exitThreshold: number,
  ) {}

  update(score: number) {
    if (this.active && score <= this.exitThreshold) {
      this.active = false;
    } else if (!this.active && score >= this.enterThreshold) {
      this.active = true;
    }

    return this.active;
  }

  reset() {
    this.active = false;
  }

  updateThresholds(enterThreshold: number, exitThreshold: number) {
    this.enterThreshold = enterThreshold;
    this.exitThreshold = exitThreshold;
  }
}

export class ExpressionSignalTracker {
  private readonly mouthOpen: HysteresisTracker;
  private readonly smile: HysteresisTracker;
  private readonly blinkLeft: HysteresisTracker;
  private readonly blinkRight: HysteresisTracker;
  private readonly anger: HysteresisTracker;
  private readonly sorrow: HysteresisTracker;
  private readonly surprise: HysteresisTracker;

  constructor(profile: TuningProfile) {
    this.mouthOpen = createTracker(profile, "mouthOpen");
    this.smile = createTracker(profile, "smile");
    this.blinkLeft = createTracker(profile, "blinkLeft");
    this.blinkRight = createTracker(profile, "blinkRight");
    this.anger = createTracker(profile, "anger");
    this.sorrow = createTracker(profile, "sorrow");
    this.surprise = createTracker(profile, "surprise");
  }

  update(scores: ExpressionScores) {
    return {
      mouthOpen: this.mouthOpen.update(scores.mouthOpen),
      smile: this.smile.update(scores.smile),
      blinkLeft: this.blinkLeft.update(scores.blinkLeft),
      blinkRight: this.blinkRight.update(scores.blinkRight),
      anger: this.anger.update(scores.anger),
      sorrow: this.sorrow.update(scores.sorrow),
      surprise: this.surprise.update(scores.surprise),
    };
  }

  reset() {
    this.mouthOpen.reset();
    this.smile.reset();
    this.blinkLeft.reset();
    this.blinkRight.reset();
    this.anger.reset();
    this.sorrow.reset();
    this.surprise.reset();
  }

  updateProfile(profile: TuningProfile) {
    this.mouthOpen.updateThresholds(
      profile.thresholds.mouthOpen.enter,
      profile.thresholds.mouthOpen.exit,
    );
    this.smile.updateThresholds(
      profile.thresholds.smile.enter,
      profile.thresholds.smile.exit,
    );
    this.blinkLeft.updateThresholds(
      profile.thresholds.blinkLeft.enter,
      profile.thresholds.blinkLeft.exit,
    );
    this.blinkRight.updateThresholds(
      profile.thresholds.blinkRight.enter,
      profile.thresholds.blinkRight.exit,
    );
    this.anger.updateThresholds(
      profile.thresholds.anger.enter,
      profile.thresholds.anger.exit,
    );
    this.sorrow.updateThresholds(
      profile.thresholds.sorrow.enter,
      profile.thresholds.sorrow.exit,
    );
    this.surprise.updateThresholds(
      profile.thresholds.surprise.enter,
      profile.thresholds.surprise.exit,
    );
  }
}

function createTracker(profile: TuningProfile, name: keyof ExpressionScores) {
  const thresholds = profile.thresholds[name];
  return new HysteresisTracker(thresholds.enter, thresholds.exit);
}

function lerp(current: number, next: number, response: number) {
  return current + (next - current) * response;
}

function smoothingAlpha(cutoff: number, elapsedSeconds: number) {
  const tau = 1 / (2 * Math.PI * cutoff);
  return 1 / (1 + tau / elapsedSeconds);
}

function lowPass(value: number, previousValue: number, alpha: number) {
  return alpha * value + (1 - alpha) * previousValue;
}
