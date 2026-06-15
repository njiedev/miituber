export type LipSyncOptions = {
  noiseFloor: number;
  speakingLevel: number;
  smoothing: number;
};

export const DEFAULT_LIP_SYNC_OPTIONS: LipSyncOptions = {
  noiseFloor: 0.02,
  speakingLevel: 0.12,
  smoothing: 0.35,
};

export class LipSyncEnvelope {
  private smoothed = 0;

  constructor(private options: LipSyncOptions = DEFAULT_LIP_SYNC_OPTIONS) {}

  update(samples: Float32Array) {
    const rms = rootMeanSquare(samples);
    const normalized = normalizeAmplitude(
      rms,
      this.options.noiseFloor,
      this.options.speakingLevel,
    );
    this.smoothed = lerp(this.smoothed, normalized, this.options.smoothing);
    return this.smoothed;
  }

  reset() {
    this.smoothed = 0;
  }

  updateOptions(options: LipSyncOptions) {
    this.options = options;
  }
}

export function rootMeanSquare(samples: Float32Array) {
  if (samples.length === 0) return 0;

  let sumSquares = 0;
  for (const sample of samples) {
    sumSquares += sample * sample;
  }

  return Math.sqrt(sumSquares / samples.length);
}

export function normalizeAmplitude(
  rms: number,
  noiseFloor: number,
  speakingLevel: number,
) {
  const range = Math.max(0.001, speakingLevel - noiseFloor);
  return clamp01((rms - noiseFloor) / range);
}

function lerp(current: number, next: number, response: number) {
  return current + (next - current) * clamp01(response);
}

function clamp01(value: number) {
  return Math.min(1, Math.max(0, value));
}
