import { FFLExpression } from "./types";

export const BLINK_MODES = ["camera", "both", "auto"] as const;
export type BlinkMode = (typeof BLINK_MODES)[number];
export const DEFAULT_BLINK_MODE: BlinkMode = "both";

export function isBlinkMode(value: unknown): value is BlinkMode {
  return BLINK_MODES.includes(value as BlinkMode);
}

export function usesAutoBlink(mode: BlinkMode): boolean {
  return mode !== "camera";
}

export type AutoBlinkOptions = {
  blinksPerMinute: number;
  durationMs: number;
};

export const AUTO_BLINK_LIMITS = {
  blinksPerMinute: { min: 4, max: 30 },
  durationMs: { min: 80, max: 300 },
} as const;

export const DEFAULT_AUTO_BLINK_OPTIONS: AutoBlinkOptions = {
  blinksPerMinute: 15,
  durationMs: 150,
};

const INTERVAL_SPREAD = 0.5;

export function normalizeAutoBlinkOptions(value: unknown): AutoBlinkOptions {
  const source = (value ?? {}) as Partial<Record<keyof AutoBlinkOptions, unknown>>;
  return {
    blinksPerMinute: clampOption(
      source.blinksPerMinute,
      AUTO_BLINK_LIMITS.blinksPerMinute,
      DEFAULT_AUTO_BLINK_OPTIONS.blinksPerMinute,
    ),
    durationMs: clampOption(
      source.durationMs,
      AUTO_BLINK_LIMITS.durationMs,
      DEFAULT_AUTO_BLINK_OPTIONS.durationMs,
    ),
  };
}

function clampOption(
  value: unknown,
  limits: { min: number; max: number },
  fallback: number,
): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.min(limits.max, Math.max(limits.min, Math.round(value)));
}

export class AutoBlinker {
  private nextBlinkAt: number | null = null;
  private blinkEndsAt: number | null = null;

  constructor(
    private options: AutoBlinkOptions = DEFAULT_AUTO_BLINK_OPTIONS,
    private readonly random: () => number = Math.random,
  ) {}

  setOptions(options: AutoBlinkOptions) {
    this.options = options;
    this.reset();
  }

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
    const meanMs = 60_000 / this.options.blinksPerMinute;
    return meanMs * (1 - INTERVAL_SPREAD + this.random() * INTERVAL_SPREAD * 2);
  }
}

const BLINK_VARIANTS = new Map<FFLExpression, FFLExpression>([
  [FFLExpression.Normal, FFLExpression.Blink],
  [FFLExpression.OpenMouth, FFLExpression.BlinkOpenMouth],
]);

export function withBlink(expression: FFLExpression): FFLExpression {
  return BLINK_VARIANTS.get(expression) ?? expression;
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
