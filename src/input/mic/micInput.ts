import type { AudioFeatures, Calibration, ControlInput, InputSource } from '../../core/types';
import { NEUTRAL_INPUT } from '../../core/types';
import { AudioEngine } from './audioEngine';
import { DEFAULT_CALIBRATION, EMPTY_PITCH_RANGE, mapAudioFeatures, validCalibration, validPitchRange } from './mapper';
import type { PitchRange, PitchSensitivity } from './mapper';

type MicEngine = Pick<AudioEngine, 'start' | 'stop' | 'read' | 'running'>;

/** AudioEngine の解放・世代管理を利用し、特徴量をゲームの共通入力へ変換する。 */
export class MicInput implements InputSource {
  readonly kind = 'mic' as const;
  private settings: Calibration;
  private sensitivity: PitchSensitivity = 'standard';
  private range: PitchRange = { ...EMPTY_PITCH_RANGE };
  private latest: AudioFeatures | null = null;
  private lastReadMs: number | null = null;
  private lastInput: ControlInput = { ...NEUTRAL_INPUT };
  private pulse = false;

  constructor(calibration: Readonly<Calibration> = DEFAULT_CALIBRATION,
    private readonly engine: MicEngine = new AudioEngine()) {
    if (!validCalibration(calibration)) throw new RangeError('基準音と雑音レベルが不正です');
    this.settings = { ...calibration };
  }

  get running(): boolean { return this.engine.running; }
  get calibration(): Calibration { return { ...this.settings }; }
  get pitchSensitivity(): PitchSensitivity { return this.sensitivity; }
  get pitchRange(): PitchRange { return { ...this.range }; }

  setPitchRange(range: Readonly<PitchRange>): void {
    if (!validPitchRange(range, this.settings)) throw new RangeError('声域は基準音の上下で測定してください');
    this.range = { ...range };
    this.remapLatest();
  }

  clearPitchRange(): void { this.setPitchRange(EMPTY_PITCH_RANGE); }

  setPitchSensitivity(sensitivity: PitchSensitivity): void {
    if (sensitivity !== 'standard' && sensitivity !== 'sensitive') throw new RangeError('声の高さの感度が不正です');
    this.sensitivity = sensitivity;
    // 同一フレームでも表示へ反映し、消費済みのpulseは再発行しない。
    this.remapLatest();
  }

  setCalibration(calibration: Readonly<Calibration>): void {
    if (!validCalibration(calibration)) throw new RangeError('基準音と雑音レベルが不正です');
    this.settings = { ...calibration };
    this.range = { ...EMPTY_PITCH_RANGE };
    this.lastReadMs = null;
    this.pulse = false;
  }

  start(): Promise<void> { return this.engine.start(); }

  stop(): void {
    this.engine.stop();
    this.latest = null;
    this.lastReadMs = null;
    this.lastInput = { ...NEUTRAL_INPUT };
    this.pulse = false;
  }

  read(nowMs: number): ControlInput {
    if (!this.running) {
      this.latest = null;
      this.lastReadMs = null;
      return { ...NEUTRAL_INPUT };
    }
    if (nowMs !== this.lastReadMs) {
      this.latest = this.engine.read(nowMs, this.settings.noiseFloorRms);
      this.lastInput = this.latest ? mapAudioFeatures(this.latest, this.settings, this.sensitivity, this.range) : { ...NEUTRAL_INPUT };
      this.lastReadMs = nowMs;
      this.pulse = this.lastInput.pulse;
    }
    const input = { ...this.lastInput, pulse: this.pulse };
    this.pulse = false;
    return input;
  }

  debugFeatures(): AudioFeatures | null { return this.latest ? { ...this.latest } : null; }

  private remapLatest(): void {
    if (this.latest) this.lastInput = mapAudioFeatures(this.latest, this.settings, this.sensitivity, this.range);
  }
}
