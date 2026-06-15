import type { ExpressionScores, FFLExpression, HeadRotation } from "./types";

export class ExpressionStabilizer {
  private currentExpression: FFLExpression;
  private lastChangedAt = 0;

  constructor(
    initialExpression: FFLExpression,
    private readonly minimumHoldMs: number,
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
    private readonly enterThreshold: number,
    private readonly exitThreshold: number,
  ) {}

  update(score: number) {
    if (this.active && score < this.exitThreshold) {
      this.active = false;
    } else if (!this.active && score > this.enterThreshold) {
      this.active = true;
    }

    return this.active;
  }

  reset() {
    this.active = false;
  }
}

export class ExpressionSignalTracker {
  private readonly mouthOpen = new HysteresisTracker(0.45, 0.32);
  private readonly smile = new HysteresisTracker(0.55, 0.42);
  private readonly blinkLeft = new HysteresisTracker(0.65, 0.42);
  private readonly blinkRight = new HysteresisTracker(0.65, 0.42);
  private readonly anger = new HysteresisTracker(0.55, 0.4);
  private readonly sorrow = new HysteresisTracker(0.55, 0.4);
  private readonly surprise = new HysteresisTracker(0.55, 0.4);

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
}

function lerp(current: number, next: number, response: number) {
  return current + (next - current) * response;
}
