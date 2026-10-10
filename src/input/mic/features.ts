import { PitchDetector } from 'pitchy';
import type { AudioFeatures } from '../../core/types';

export const FEATURE_SETTINGS = {
  silenceRms: 0.01,
  minClarity: 0.85,
  minPitchHz: 50,
  maxPitchHz: 1000,
  rmsTimeConstantMs: 80,
  onsetRiseRms: 0.015,
  onsetRatio: 1.5,
  onsetCooldownMs: 150,
} as const;

export interface FeatureState {
  timeMs: number | null;
  rms: number;
  rawRms: number;
  lastOnsetMs: number | null;
  onsetArmed: boolean;
}

export const INITIAL_FEATURE_STATE: Readonly<FeatureState> = Object.freeze({
  timeMs: null,
  rms: 0,
  rawRms: 0,
  lastOnsetMs: null,
  onsetArmed: true,
});

/** FFT の作業バッファは呼び出し側で再利用できる。波形と前の状態は変更しない。 */
export type PitchEstimator = Pick<PitchDetector<Float32Array>, 'findPitch'>;

/** 波形と直前の状態から特徴量と次の状態を計算する、DOM 非依存の関数。 */
export function extractFeatures(
  samples: Float32Array,
  sampleRate: number,
  nowMs: number,
  previous: Readonly<FeatureState> = INITIAL_FEATURE_STATE,
  detector?: PitchEstimator,
): { features: AudioFeatures; state: FeatureState } {
  if (!Number.isFinite(sampleRate) || sampleRate <= 0 || !Number.isFinite(nowMs)) {
    throw new RangeError('sampleRate は正の数、nowMs は有限の数にしてください');
  }

  let squares = 0;
  let valid = samples.length > 0;
  for (const sample of samples) {
    if (!Number.isFinite(sample)) valid = false;
    squares += sample * sample;
  }
  const rawRms = valid ? Math.min(1, Math.sqrt(squares / samples.length)) : 0;
  const elapsedMs = previous.timeMs === null ? 1000 / 60 : Math.max(0, nowMs - previous.timeMs);
  const alpha = 1 - Math.exp(-elapsedMs / FEATURE_SETTINGS.rmsTimeConstantMs);
  const rms = previous.rms + alpha * (rawRms - previous.rms);

  let pitchHz: number | null = null;
  let clarity = 0;
  // 平滑化前の音量でゲートし、音を止めた瞬間から古い pitch を返さない。
  if (valid && rawRms > FEATURE_SETTINGS.silenceRms) {
    const estimator = detector ?? PitchDetector.forFloat32Array(samples.length);
    const [pitch, confidence] = estimator.findPitch(samples, sampleRate);
    clarity = Number.isFinite(confidence) ? Math.max(0, Math.min(1, confidence)) : 0;
    if (clarity >= FEATURE_SETTINGS.minClarity && Number.isFinite(pitch)
      && pitch >= FEATURE_SETTINGS.minPitchHz && pitch <= FEATURE_SETTINGS.maxPitchHz) {
      pitchHz = pitch;
    }
  }

  const outsideCooldown = previous.lastOnsetMs === null
    || nowMs - previous.lastOnsetMs >= FEATURE_SETTINGS.onsetCooldownMs;
  // 1フレーム差では弱い「タン」の数フレームに渡る立ち上がりを見逃すため、
  // 平滑化した直前の音量を基準にする。同じ立ち上がりは再武装まで1回だけ。
  const rising = rawRms > FEATURE_SETTINGS.silenceRms
    && rawRms - previous.rms >= FEATURE_SETTINGS.onsetRiseRms
    && rawRms >= previous.rms * FEATURE_SETTINGS.onsetRatio;
  const onset = rising && previous.onsetArmed && outsideCooldown;

  return {
    features: { timeMs: nowMs, rms, pitchHz, clarity, onset },
    state: {
      timeMs: nowMs, rms, rawRms,
      lastOnsetMs: onset ? nowMs : previous.lastOnsetMs,
      onsetArmed: !rising,
    },
  };
}
