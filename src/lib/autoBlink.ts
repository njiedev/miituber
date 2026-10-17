import { FFLExpression } from "./types";

export type AutoBlinkOptions = {
  minIntervalMs: number;
  maxIntervalMs: number;
  durationMs: number;
};

export const DEFAULT_AUTO_BLINK_OPTIONS: AutoBlinkOptions = {
  minIntervalMs: 2000,
  maxIntervalMs: 6000,
  durationMs: 150,
};

export class AutoBlinker {
  private nextBlinkAt: number | null = null;
  private blinkEndsAt: number | null = null;

  constructor(
    private readonly options: AutoBlinkOptions = DEFAULT_AUTO_BLINK_OPTIONS,
    private readonly random: () => number = Math.random,
  ) {}

  update(nowMs: number): boolean {
    if (this.nextBlinkAt === null) {
      this.nextBlinkAt = nowMs + this.nextInterval();
    }

    if (this.blinkEndsAt !== null) {
      if (nowMs < this.blinkEndsAt) return true;
      this.nextBlinkAt = this.blinkEndsAt + this.nextInterval();
      this.blinkEndsAt = null;
    }

    if (nowMs >= this.nextBlinkAt) {
      this.blinkEndsAt = nowMs + this.options.durationMs;
      return true;
    }

    return false;
  }

  reset() {
    this.nextBlinkAt = null;
    this.blinkEndsAt = null;
  }

  private nextInterval() {
    const { minIntervalMs, maxIntervalMs } = this.options;
    return minIntervalMs + this.random() * (maxIntervalMs - minIntervalMs);
  }
}

const KEEP_EYES = new Set<FFLExpression>([
  FFLExpression.Blink,
  FFLExpression.BlinkOpenMouth,
  FFLExpression.WinkLeft,
  FFLExpression.WinkRight,
  FFLExpression.WinkLeftOpenMouth,
  FFLExpression.WinkRightOpenMouth,
  FFLExpression.Like,
  FFLExpression.LikeWinkRight,
  FFLExpression.Frustrated,
]);

const MOUTH_OPEN = new Set<FFLExpression>([
  FFLExpression.OpenMouth,
  FFLExpression.Happy,
  FFLExpression.AngerOpenMouth,
  FFLExpression.SorrowOpenMouth,
  FFLExpression.SurpriseOpenMouth,
]);

export function withBlink(expression: FFLExpression): FFLExpression {
  if (KEEP_EYES.has(expression)) return expression;
  return MOUTH_OPEN.has(expression)
    ? FFLExpression.BlinkOpenMouth
    : FFLExpression.Blink;
}

export const SUSTAINED_EYE_CLOSE_MS = 500;

export class SustainedSignalGate {
  private activeSince: number | null = null;

  constructor(private readonly holdMs: number = SUSTAINED_EYE_CLOSE_MS) {}

  update(active: boolean, nowMs: number): boolean {
    if (!active) {
      this.activeSince = null;
      return false;
    }
    this.activeSince ??= nowMs;
    return nowMs - this.activeSince >= this.holdMs;
  }

  reset() {
    this.activeSince = null;
  }
}
