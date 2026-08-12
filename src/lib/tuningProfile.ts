import type { ExpressionScores } from "./types";

export type SignalName = keyof ExpressionScores;

export type HysteresisSetting = {
  enter: number;
  exit: number;
};

export type TuningProfile = {
  version: 1;
  thresholds: Record<SignalName, HysteresisSetting>;
  gains: Record<SignalName, number>;
  oneEuro: {
    minCutoff: number;
    beta: number;
    derivativeCutoff: number;
  };
  lipSync: {
    noiseFloor: number;
    speakingLevel: number;
    smoothing: number;
    activation: HysteresisSetting & { gain: number };
  };
  minimumHoldMs: number;
  calibration: Record<string, number>;
};

export const SIGNAL_NAMES: SignalName[] = [
  "mouthOpen",
  "smile",
  "blinkLeft",
  "blinkRight",
  "anger",
  "sorrow",
  "surprise",
];

export const DEFAULT_TUNING_PROFILE: TuningProfile = {
  version: 1,
  thresholds: {
    mouthOpen: { enter: 0.45, exit: 0.32 },
    smile: { enter: 0.55, exit: 0.42 },
    blinkLeft: { enter: 0.65, exit: 0.42 },
    blinkRight: { enter: 0.65, exit: 0.42 },
    anger: { enter: 0.55, exit: 0.4 },
    sorrow: { enter: 0.55, exit: 0.4 },
    surprise: { enter: 0.55, exit: 0.4 },
  },
  gains: {
    mouthOpen: 1,
    smile: 1,
    blinkLeft: 1,
    blinkRight: 1,
    anger: 1,
    sorrow: 1,
    surprise: 1,
  },
  oneEuro: {
    minCutoff: 1,
    beta: 0.02,
    derivativeCutoff: 1,
  },
  lipSync: {
    noiseFloor: 0.02,
    speakingLevel: 0.12,
    smoothing: 0.35,
    activation: { enter: 0.45, exit: 0.32, gain: 1 },
  },
  minimumHoldMs: 100,
  calibration: {},
};

export function createDefaultTuningProfile(): TuningProfile {
  return cloneTuningProfile(DEFAULT_TUNING_PROFILE);
}

export function cloneTuningProfile(profile: TuningProfile): TuningProfile {
  return {
    version: 1,
    thresholds: Object.fromEntries(
      SIGNAL_NAMES.map((name) => [
        name,
        {
          enter: profile.thresholds[name].enter,
          exit: profile.thresholds[name].exit,
        },
      ]),
    ) as Record<SignalName, HysteresisSetting>,
    gains: Object.fromEntries(
      SIGNAL_NAMES.map((name) => [name, profile.gains[name]]),
    ) as Record<SignalName, number>,
    oneEuro: { ...profile.oneEuro },
    lipSync: {
      ...profile.lipSync,
      activation: { ...profile.lipSync.activation },
    },
    minimumHoldMs: profile.minimumHoldMs,
    calibration: { ...profile.calibration },
  };
}

export function parseTuningProfileJson(json: string): TuningProfile {
  const parsed = JSON.parse(json) as Partial<TuningProfile>;
  return normalizeTuningProfile(parsed);
}

export function serializeTuningProfile(profile: TuningProfile) {
  return JSON.stringify(profile, null, 2);
}

export function normalizeTuningProfile(profile: Partial<TuningProfile>): TuningProfile {
  const fallback = createDefaultTuningProfile();
  const thresholds = { ...fallback.thresholds };
  const gains = { ...fallback.gains };
  const lipSyncNoiseFloor = clamp(
    finiteOrDefault(profile.lipSync?.noiseFloor, fallback.lipSync.noiseFloor),
    0,
    0.5,
  );
  const lipSyncActivationEnter = clamp01(
    finiteOrDefault(
      profile.lipSync?.activation?.enter,
      fallback.lipSync.activation.enter,
    ),
  );

  for (const name of SIGNAL_NAMES) {
    const setting = profile.thresholds?.[name];
    if (setting) {
      const enter = clamp01(setting.enter);
      const exit = clamp01(Math.min(setting.exit, enter));
      thresholds[name] = { enter, exit };
    }

    const gain = profile.gains?.[name];
    if (typeof gain === "number" && Number.isFinite(gain)) {
      gains[name] = clamp(gain, 0, 3);
    }
  }

  return {
    version: 1,
    thresholds,
    gains,
    oneEuro: {
      minCutoff: positiveOrDefault(
        profile.oneEuro?.minCutoff,
        fallback.oneEuro.minCutoff,
      ),
      beta: Math.max(0, profile.oneEuro?.beta ?? fallback.oneEuro.beta),
      derivativeCutoff: positiveOrDefault(
        profile.oneEuro?.derivativeCutoff,
        fallback.oneEuro.derivativeCutoff,
      ),
    },
    lipSync: {
      noiseFloor: lipSyncNoiseFloor,
      speakingLevel: clampSpeakingLevel(
        finiteOrDefault(profile.lipSync?.speakingLevel, fallback.lipSync.speakingLevel),
        lipSyncNoiseFloor,
      ),
      smoothing: clamp(
        finiteOrDefault(profile.lipSync?.smoothing, fallback.lipSync.smoothing),
        0,
        1,
      ),
      activation: {
        enter: lipSyncActivationEnter,
        exit: clamp01(
          Math.min(
            finiteOrDefault(
              profile.lipSync?.activation?.exit,
              fallback.lipSync.activation.exit,
            ),
            lipSyncActivationEnter,
          ),
        ),
        gain: clamp(
          finiteOrDefault(
            profile.lipSync?.activation?.gain,
            fallback.lipSync.activation.gain,
          ),
          0,
          3,
        ),
      },
    },
    minimumHoldMs: Math.max(0, profile.minimumHoldMs ?? fallback.minimumHoldMs),
    calibration: normalizeCalibration(profile.calibration),
  };
}

function normalizeCalibration(calibration?: Record<string, number>) {
  const normalized: Record<string, number> = {};
  if (!calibration) return normalized;

  for (const [categoryName, baseline] of Object.entries(calibration)) {
    if (Number.isFinite(baseline)) {
      normalized[categoryName] = clamp01(baseline);
    }
  }

  return normalized;
}

function positiveOrDefault(value: number | undefined, fallback: number) {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : fallback;
}

function finiteOrDefault(value: number | undefined, fallback: number) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function clampSpeakingLevel(speakingLevel: number, noiseFloor: number) {
  return clamp(Math.max(speakingLevel, noiseFloor + 0.001), 0.001, 1);
}

function clamp01(value: number) {
  return clamp(value, 0, 1);
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}
