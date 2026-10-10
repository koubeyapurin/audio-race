import type { AudioFeatures, Calibration, ControlInput } from '../../core/types';
import { NEUTRAL_INPUT } from '../../core/types';
import { FEATURE_SETTINGS } from './features';

export const DEFAULT_CALIBRATION: Readonly<Calibration> = Object.freeze({
  basePitchHz: 220, noiseFloorRms: 0.01,
});

export const MAPPING_SETTINGS = {
  deadZoneSemitones: 1, fullSlopeSemitones: 6, fullIntensityRms: 0.08,
  calibrationMs: 2000, minimumSamples: 20, minimumNoiseFloorRms: 0.001, noiseMargin: 3,
} as const;

export const PITCH_RESPONSES = {
  standard: { deadZoneSemitones: MAPPING_SETTINGS.deadZoneSemitones, fullSlopeSemitones: MAPPING_SETTINGS.fullSlopeSemitones },
  sensitive: { deadZoneSemitones: 0.25, fullSlopeSemitones: 2 },
} as const;
export type PitchSensitivity = keyof typeof PITCH_RESPONSES;

/** 基準音の上下で、楽に出せる声をそれぞれ最大入力へ割り当てる。 */
export interface PitchRange {
  lowPitchHz: number | null;
  highPitchHz: number | null;
}
export const EMPTY_PITCH_RANGE: Readonly<PitchRange> = Object.freeze({ lowPitchHz: null, highPitchHz: null });
const MINIMUM_RANGE_SEMITONES = 0.5;

export function validPitchRange(range: Readonly<PitchRange>, calibration: Readonly<Calibration>): boolean {
  if (!validCalibration(calibration)) return false;
  return ([['lowPitchHz', -1], ['highPitchHz', 1]] as const).every(([key, direction]) => {
    const pitch = range[key];
    return pitch === null || (Number.isFinite(pitch)
      && pitch >= FEATURE_SETTINGS.minPitchHz && pitch <= FEATURE_SETTINGS.maxPitchHz
      && direction * 12 * Math.log2(pitch / calibration.basePitchHz) >= MINIMUM_RANGE_SEMITONES - 1e-9);
  });
}

export function validCalibration(calibration: Readonly<Calibration>): boolean {
  return Number.isFinite(calibration.basePitchHz) && calibration.basePitchHz > 0
    && Number.isFinite(calibration.noiseFloorRms)
    && calibration.noiseFloorRms >= 0 && calibration.noiseFloorRms < 1;
}

/** 特徴量を個人の基準に合わせて操作入力へ変換する。入力や状態を変更しない。 */
export function mapAudioFeatures(features: Readonly<AudioFeatures>, calibration: Readonly<Calibration>,
  sensitivity: PitchSensitivity = 'standard', range: Readonly<PitchRange> = EMPTY_PITCH_RANGE): ControlInput {
  if (!validPitchRange(range, calibration) || !Number.isFinite(features.rms)
    || features.rms <= calibration.noiseFloorRms) return { ...NEUTRAL_INPUT };
  const intensity = Math.min(1, (features.rms - calibration.noiseFloorRms) / MAPPING_SETTINGS.fullIntensityRms);
  const pulse = features.onset;
  const pitch = features.pitchHz;
  if (pitch === null || !Number.isFinite(pitch) || pitch <= 0
    || !Number.isFinite(features.clarity) || features.clarity < FEATURE_SETTINGS.minClarity) {
    // 無声音の「タン」でもリズムは使える。坂をつくる active は false にする。
    return { slope: 0, intensity, pulse, active: false };
  }
  const semitones = 12 * Math.log2(pitch / calibration.basePitchHz);
  const amount = Math.abs(semitones);
  const response = PITCH_RESPONSES[sensitivity];
  const limit = semitones < 0 ? range.lowPitchHz : range.highPitchHz;
  const fullSlope = limit === null ? response.fullSlopeSemitones
    : Math.abs(12 * Math.log2(limit / calibration.basePitchHz));
  // 狭い声域でも最大入力に届く余地を残し、基準付近の揺れは抑える。
  const deadZone = limit === null ? response.deadZoneSemitones : Math.min(response.deadZoneSemitones, fullSlope / 4);
  const slope = amount <= deadZone + 1e-9 ? 0
    : Math.sign(semitones) * Math.min(1, (amount - deadZone) / (fullSlope - deadZone));
  return { slope, intensity, pulse, active: true };
}

/** 一時的な小さな揺れを含め、静かなときの95パーセンタイルに余裕を加える。 */
export function estimateNoiseFloor(samples: readonly AudioFeatures[]): number {
  const values = samples.map((sample) => sample.rms)
    .filter((rms) => Number.isFinite(rms) && rms >= 0 && rms <= 1).sort((a, b) => a - b);
  if (values.length < MAPPING_SETTINGS.minimumSamples) {
    throw new Error('雑音を十分に測定できませんでした。もう一度、2秒間静かにしてください。');
  }
  const measured = values[Math.ceil(values.length * 0.95) - 1];
  const floor = Math.max(MAPPING_SETTINGS.minimumNoiseFloorRms, measured * MAPPING_SETTINGS.noiseMargin);
  if (floor >= 1) throw new Error('周囲の音が大きすぎます。静かな環境で測り直してください。');
  return floor;
}

/** 雑音より大きく、信頼できる「あー」の高さの中央値を基準音にする。 */
export function estimateBasePitch(samples: readonly AudioFeatures[], noiseFloorRms: number): number {
  const pitches = samples.filter((sample) => Number.isFinite(sample.rms) && sample.rms > noiseFloorRms
    && Number.isFinite(sample.clarity) && sample.clarity >= FEATURE_SETTINGS.minClarity
    && sample.pitchHz !== null && Number.isFinite(sample.pitchHz)
    && sample.pitchHz >= FEATURE_SETTINGS.minPitchHz && sample.pitchHz <= FEATURE_SETTINGS.maxPitchHz)
    .map((sample) => sample.pitchHz!).sort((a, b) => a - b);
  if (pitches.length < MAPPING_SETTINGS.minimumSamples) {
    throw new Error('声の高さを十分に測定できませんでした。マイクに近づき、無理のない声で「あー」と2秒間伸ばしてください。');
  }
  const middle = Math.floor(pitches.length / 2);
  return pitches.length % 2 ? pitches[middle] : (pitches[middle - 1] + pitches[middle]) / 2;
}

export function estimatePitchLimit(samples: readonly AudioFeatures[], calibration: Readonly<Calibration>,
  direction: 'low' | 'high'): number {
  const pitch = estimateBasePitch(samples, calibration.noiseFloorRms);
  const range = { ...EMPTY_PITCH_RANGE, [direction === 'low' ? 'lowPitchHz' : 'highPitchHz']: pitch };
  if (!validPitchRange(range, calibration)) {
    throw new Error(`${direction === 'low' ? '低い' : '高い'}声は、基準音から0.5半音以上離して測定してください。難しい場合は、基準音を出せる声の中間の高さで測り直してください。`);
  }
  return pitch;
}
