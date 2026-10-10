import type { AudioFeatures, ControlInput, Scene, SceneContext } from '../core/types';
import { MicUnavailableError } from '../core/types';
import { TERRAIN } from '../core/config';
import { KeyboardInput } from '../input/keyboard';
import { MicInput } from '../input/mic/micInput';
import { FEATURE_SETTINGS } from '../input/mic/features';
import { estimateBasePitch, estimateNoiseFloor, estimatePitchLimit, MAPPING_SETTINGS } from '../input/mic/mapper';

type Phase = 'idle' | 'opening' | 'ready' | 'noise' | 'pitch' | 'low' | 'high' | 'calibrated';
const PRACTICE_HOLD_MS = 250;
interface Controls {
  status: HTMLElement;
  allow: HTMLButtonElement;
  stop: HTMLButtonElement;
  noise: HTMLButtonElement;
  base: HTMLButtonElement;
  play: HTMLButtonElement;
  level: HTMLMeterElement;
  rms: HTMLOutputElement;
  pitch: HTMLOutputElement;
  floor: HTMLOutputElement;
  reference: HTMLOutputElement;
  progress: HTMLProgressElement;
  timer: HTMLOutputElement;
  sensitivity: HTMLSelectElement;
  response: HTMLOutputElement;
  low: HTMLButtonElement;
  high: HTMLButtonElement;
  resetRange: HTMLButtonElement;
  range: HTMLOutputElement;
  skipRange: HTMLButtonElement;
  upCheck: HTMLElement;
  downCheck: HTMLElement;
  practiceStatus: HTMLElement;
  diagnosticsPanel: HTMLDetailsElement;
  diagnostics: HTMLTextAreaElement;
  freezeDiagnostics: HTMLButtonElement;
}

/** 許可・雑音・基準音を順に準備する。更新は main.ts のループからだけ行う。 */
export class MicSetupScene implements Scene<'micSetup'> {
  private ctx: SceneContext | null = null;
  private panel: HTMLElement | null = null;
  private controls: Controls | null = null;
  private phase: Phase = 'idle';
  private noiseDone = false;
  private baseDone = false;
  private samples: AudioFeatures[] = [];
  private measuringSince: number | null = null;
  private requestId = 0;
  private leaving = false;
  private readonly practiced = { up: false, down: false };
  private practiceDirection: 'up' | 'down' | null = null;
  private practiceSince: number | null = null;
  private diagnosticsFrozen = false;

  constructor(private readonly mic = new MicInput()) {}

  enter(ctx: SceneContext): void {
    this.panel?.remove();
    this.ctx = ctx;
    this.leaving = false;
    this.mic.setPitchSensitivity('sensitive');
    const panel = document.createElement('section');
    panel.className = 'mic-setup';
    panel.setAttribute('aria-labelledby', 'mic-setup-title');
    panel.innerHTML = `
      <style>
        .mic-setup { position:absolute; inset:0; display:flex; flex-direction:column; align-items:center;
          justify-content:safe center; gap:clamp(6px,1.5vh,14px); padding:3%; box-sizing:border-box;
          overflow:auto; text-align:center; color:#edf4ff; font-size:clamp(12px,min(1.4vw,2.5vh),18px); }
        .mic-setup h1 { margin:0; font-size:clamp(24px,min(3.5vw,6vh),44px); }
        .mic-setup > * { flex-shrink:0; }
        .mic-setup p { margin:0; color:#c3cee4; }
        .mic-setup .steps, .mic-setup .metrics, .mic-setup .actions { display:flex; gap:12px; justify-content:center; flex-wrap:wrap; }
        .mic-setup .metrics { width:min(90%,800px); padding:12px; box-sizing:border-box;
          background:#192d42; border:1px solid #59708b; border-radius:12px; }
        .mic-setup .metrics div { min-width:140px; }
        .mic-setup output { display:block; color:#a6edcf; font-weight:700; font-variant-numeric:tabular-nums; }
        .mic-setup meter { display:block; width:180px; height:18px; }
        .mic-setup button { font:inherit; padding:10px 16px; border-radius:8px;
          border:1px solid #8397b5; color:#edf4ff; background:#263c55; cursor:pointer; }
        .mic-setup button.primary { background:#a6edcf; color:#102623; border-color:#86cbb3; font-weight:700; }
        .mic-setup button:disabled { opacity:.4; cursor:default; }
        .mic-setup button:focus-visible { outline:3px solid #fff; outline-offset:3px; }
        .mic-setup select { font:inherit; padding:6px; color:#edf4ff; background:#263c55; border:1px solid #8397b5; border-radius:6px; }
        .mic-setup select:focus-visible { outline:3px solid #fff; outline-offset:3px; }
        .mic-setup [data-status] { min-height:2.5em; max-width:90%; }
        .mic-setup progress { width:min(70%,650px); }
        .mic-setup .note { font-size:.85em; }
        .mic-setup .voice-range { width:min(90%,800px); box-sizing:border-box;
          border:1px solid #59708b; border-radius:12px; padding:12px; background:#192d42; }
        .mic-setup .voice-range h2 { margin:0 0 8px; font-size:1.1em; }
        .mic-setup .voice-range .steps { margin:8px 0; }
        .mic-setup .practice-checks { display:flex; flex-wrap:wrap; justify-content:center;
          gap:12px; margin:8px 0; color:#c3cee4; }
        .mic-setup .practice-checks [data-complete="true"] { color:#a6edcf; font-weight:700; }
        .mic-setup [data-practice-status] { margin-top:8px; }
        .mic-setup .diagnostics { width:min(90%,800px); text-align:left; }
        .mic-setup .diagnostics summary { cursor:pointer; }
        .mic-setup .diagnostics textarea { width:100%; box-sizing:border-box; margin:8px 0;
          padding:8px; color:#edf4ff; background:#192d42; border:1px solid #59708b; border-radius:8px;
          font:inherit; resize:vertical; }
        @media (max-width:600px), (max-height:440px) {
          .mic-setup { justify-content:flex-start; gap:6px; }
          .mic-setup button { padding:6px 10px; }
          .mic-setup .metrics { padding:6px; }
        }
      </style>
      <h1 id="mic-setup-title">マイクの準備</h1>
      <p>静かな場所で、普段の声を基準にします。端末の再生音は小さくしてください。</p>
      <div class="actions">
        <button type="button" data-allow>① マイクを許可</button>
        <button type="button" data-stop>マイクを停止</button>
      </div>
      <div class="metrics">
        <div>入力音量<meter data-level min="0" max="0.1" value="0" aria-label="マイク入力の音量"></meter><output data-rms>0.0000</output></div>
        <div>今の声の高さ<output data-pitch>—</output></div>
        <div>無音のしきい値<output data-floor>未測定</output></div>
        <div>基準の声の高さ<output data-reference>未測定</output></div>
      </div>
      <div class="steps">
        <button type="button" data-noise>② 2秒間静かにする</button>
        <button type="button" data-base>③「あー」と2秒間伸ばす</button>
      </div>
      <progress data-progress max="2000" value="0" aria-label="測定の進捗" hidden></progress>
      <output data-timer></output>
      <p data-status role="status" aria-live="polite"></p>
      <label>声の高さの感度
        <select data-sensitivity>
          <option value="sensitive">反応しやすい（声域が狭い方向け）</option>
          <option value="standard">標準（声の揺れを抑える）</option>
        </select>
      </label>
      <output data-response aria-label="声の高さによる操作プレビュー">基準音の測定後、上り・下りを試せます</output>
      <section class="voice-range" aria-labelledby="voice-range-title">
        <h2 id="voice-range-title">④ 自分の声域に合わせる（おすすめ・スキップ可）</h2>
        <p class="note">楽に出せる低い声・高い声を2秒ずつ測り、その高さを最大の操作にします。片方だけでも調整できます。</p>
        <div class="steps">
          <button type="button" data-low>低い「あー」を2秒測る</button>
          <button type="button" data-high>高い「あー」を2秒測る</button>
          <button type="button" data-reset-range>声域の調整を解除</button>
        </div>
        <output data-range></output>
        <p class="note">100%は声の高さによる操作量です。坂の強さは声の大きさでも変わります。</p>
        <p class="note">高い「あー」・低い「あー」を少し伸ばし、上り・下り100%を試しましょう。無理に声を出す必要はありません。</p>
        <div class="practice-checks" aria-label="上下操作の練習結果">
          <span data-up-check></span><span data-down-check></span>
        </div>
        <p data-practice-status role="status" aria-live="polite"></p>
        <button type="button" data-skip-range>声域合わせ・練習をスキップして遊ぶ</button>
      </section>
      <details class="diagnostics" data-diagnostics-panel>
        <summary>反応しないとき：音程の判定を確認</summary>
        <p class="note">反応しない声を出したまま「いまの値を固定」を押してください。下の数値は選択してコピーできます。最低音・最高音の外でも、音程を検出できれば最大入力になります。</p>
        <textarea data-diagnostics rows="10" readonly aria-label="音程判定の確認値"></textarea>
        <button type="button" data-freeze-diagnostics aria-pressed="false">いまの値を固定</button>
      </details>
      <p class="note">声は黄色い線の先、約${TERRAIN.lookaheadSec}秒先の地形になります。基準の高さは平ら。「タン」は基準の高さで短く。</p>
      <button type="button" class="primary" data-play>⑤ マイクでスタート</button>
      <div class="actions">
        <button type="button" data-keyboard>ボタン・キーで遊ぶ（K）</button>
        <button type="button" data-title>タイトルへ（Esc）</button>
      </div>
      <p class="note">高い声で上る・低い声で下る・大きい声ほど強く・「タン」で波。音声の録音保存・外部送信はしません。</p>
    `;
    const find = <T extends HTMLElement>(selector: string): T => panel.querySelector<T>(selector)!;
    this.controls = {
      status: find('[data-status]'), allow: find('[data-allow]'), stop: find('[data-stop]'),
      noise: find('[data-noise]'), base: find('[data-base]'), play: find('[data-play]'),
      level: find('[data-level]'), rms: find('[data-rms]'), pitch: find('[data-pitch]'),
      floor: find('[data-floor]'), reference: find('[data-reference]'),
      progress: find('[data-progress]'), timer: find('[data-timer]'),
      sensitivity: find('[data-sensitivity]'), response: find('[data-response]'),
      low: find('[data-low]'), high: find('[data-high]'), resetRange: find('[data-reset-range]'), range: find('[data-range]'),
      skipRange: find('[data-skip-range]'), upCheck: find('[data-up-check]'),
      downCheck: find('[data-down-check]'), practiceStatus: find('[data-practice-status]'),
      diagnosticsPanel: find('[data-diagnostics-panel]'), diagnostics: find('[data-diagnostics]'),
      freezeDiagnostics: find('[data-freeze-diagnostics]'),
    };
    this.controls.sensitivity.value = this.mic.pitchSensitivity;
    this.controls.sensitivity.addEventListener('change', () => {
      const value = this.controls?.sensitivity.value;
      if (value === 'standard' || value === 'sensitive') {
        this.mic.setPitchSensitivity(value);
        this.resetPractice();
      }
    });
    this.controls.allow.addEventListener('click', () => { void this.allowMic(); });
    this.controls.stop.addEventListener('click', () => this.stopMic('マイクを停止しました。再度許可ボタンから準備できます。'));
    this.controls.noise.addEventListener('click', () => this.measure('noise'));
    this.controls.base.addEventListener('click', () => this.measure('pitch'));
    this.controls.low.addEventListener('click', () => this.measure('low'));
    this.controls.high.addEventListener('click', () => this.measure('high'));
    this.controls.resetRange.addEventListener('click', () => {
      if (this.measuring || !this.baseDone || this.leaving) return;
      this.mic.clearPitchRange();
      this.resetPractice();
      this.refreshControls();
      this.setStatus('声域の調整を解除しました。選択中の感度で反応します。');
    });
    this.controls.play.addEventListener('click', () => this.navigate('mic'));
    this.controls.skipRange.addEventListener('click', () => this.navigate('mic'));
    this.controls.freezeDiagnostics.addEventListener('click', () => {
      if (!this.controls || !this.mic.running) return;
      this.diagnosticsFrozen = !this.diagnosticsFrozen;
      this.controls.freezeDiagnostics.textContent = this.diagnosticsFrozen ? '値の更新を再開' : 'いまの値を固定';
      this.controls.freezeDiagnostics.setAttribute('aria-pressed', String(this.diagnosticsFrozen));
    });
    find<HTMLButtonElement>('[data-keyboard]').addEventListener('click', () => this.navigate('keyboard'));
    find<HTMLButtonElement>('[data-title]').addEventListener('click', () => this.navigate('title'));
    ctx.ui.append(panel);
    this.panel = panel;
    this.stopMic('① マイクを許可してください。利用できない場合はボタン・キーでも遊べます。');
  }

  update(_dtSec: number, nowMs: number): void {
    if (!this.controls || this.leaving || this.phase === 'idle' || this.phase === 'opening') return;
    try {
      const input = this.mic.read(nowMs);
      const features = this.mic.debugFeatures();
      if (!this.mic.running || !features) {
        this.stopMic('マイク入力が中断されました。接続を確認し、もう一度許可してください。');
        return;
      }
      this.controls.level.value = features.rms;
      this.controls.rms.value = features.rms.toFixed(4);
      this.controls.pitch.value = features.pitchHz === null ? '—' : `${features.pitchHz.toFixed(1)} Hz`;
      this.updateDiagnostics(input, features);
      if (this.baseDone) {
        if (!input.active) {
          this.controls.response.value = features.rms <= this.mic.calibration.noiseFloorRms
            ? '声が小さい・無音：マイクに近づいて試してください'
            : '音程を検出できません：無理のない音量で「あー」と伸ばしてください';
        } else {
          const semitones = 12 * Math.log2(features.pitchHz! / this.mic.calibration.basePitchHz);
          const direction = input.slope < 0 ? '下り' : input.slope > 0 ? '上り' : '平坦';
          this.controls.response.value = `${direction} ${Math.round(Math.abs(input.slope) * 100)}%（基準から${semitones >= 0 ? '+' : ''}${semitones.toFixed(2)}半音）`;
        }
      }
      this.updatePractice(input, nowMs);
      if (!this.measuring) return;
      this.measuringSince ??= nowMs;
      this.samples.push(features);
      const elapsed = nowMs - this.measuringSince;
      this.controls.progress.value = Math.min(elapsed, MAPPING_SETTINGS.calibrationMs);
      this.controls.timer.value = `あと${Math.max(0, (MAPPING_SETTINGS.calibrationMs - elapsed) / 1000).toFixed(1)}秒`;
      if (elapsed >= MAPPING_SETTINGS.calibrationMs) this.finishMeasurement();
    } catch (error) {
      this.stopMic(error instanceof Error ? error.message : 'マイクを解析できませんでした。もう一度お試しください。');
    }
  }

  render(g: CanvasRenderingContext2D): void {
    g.save();
    g.fillStyle = '#152638';
    g.fillRect(0, 0, g.canvas.width, g.canvas.height);
    g.restore();
  }

  exit(): void {
    this.leaving = true;
    this.requestId++;
    this.mic.stop();
    this.samples = [];
    this.diagnosticsFrozen = false;
    this.panel?.remove();
    this.panel = null;
    this.controls = null;
    this.ctx = null;
  }

  onHidden(): void { this.stopMic('タブが非表示になったためマイクを停止しました。再度許可ボタンから準備してください。'); }

  onKeyDown(e: KeyboardEvent): void {
    if (e.code !== 'Escape' && e.code !== 'KeyK') return;
    e.preventDefault();
    if (!e.repeat) this.navigate(e.code === 'Escape' ? 'title' : 'keyboard');
  }

  private async allowMic(): Promise<void> {
    if (!this.ctx || !this.controls || this.leaving || this.phase === 'opening' || this.mic.running) return;
    const request = ++this.requestId;
    this.phase = 'opening';
    this.setStatus('マイクの許可を待っています。停止・タイトル・キーボードへの切替で中止できます。');
    this.refreshControls();
    try {
      await this.mic.start();
      if (request !== this.requestId || !this.ctx) return;
      if (!this.mic.running) { this.stopMic('マイクを開始できませんでした。もう一度許可してください。'); return; }
      this.phase = 'ready';
      this.setStatus('② を押して、2秒間静かにしてください。');
      this.refreshControls();
    } catch (error) {
      if (request !== this.requestId || !this.ctx) return;
      const message = error instanceof MicUnavailableError ? error.message : 'マイクを開始できませんでした。接続を確認してください。';
      this.stopMic(`${message} キーボードで遊ぶこともできます。`);
    }
  }

  private get measuring(): boolean {
    return this.phase === 'noise' || this.phase === 'pitch' || this.phase === 'low' || this.phase === 'high';
  }

  private measure(phase: 'noise' | 'pitch' | 'low' | 'high'): void {
    if (this.leaving || !this.mic.running || this.measuring
      || (phase === 'pitch' && !this.noiseDone)
      || ((phase === 'low' || phase === 'high') && !this.baseDone)) return;
    if (phase === 'noise' || phase === 'pitch') {
      this.baseDone = false;
      this.mic.clearPitchRange();
    }
    if (phase === 'noise') this.noiseDone = false;
    this.phase = phase;
    this.resetPractice(phase === 'low' ? 'down' : phase === 'high' ? 'up' : undefined);
    this.samples = [];
    this.measuringSince = null;
    this.setStatus(phase === 'noise' ? 'そのまま2秒間、声を出さずにお待ちください。'
      : phase === 'pitch' ? '普段の高さで「あー」と2秒間伸ばしてください。'
      : `楽に出せる${phase === 'low' ? '低い' : '高い'}声で「あー」と2秒間伸ばしてください。限界まで声を出す必要はありません。`);
    this.refreshControls();
  }

  private finishMeasurement(): void {
    try {
      const calibration = this.mic.calibration;
      if (this.phase === 'noise') {
        calibration.noiseFloorRms = estimateNoiseFloor(this.samples);
        this.mic.setCalibration(calibration);
        this.noiseDone = true;
        this.phase = 'ready';
        this.setStatus('雑音を測定しました。③ を押し、普段の高さで「あー」と2秒間伸ばしてください。');
      } else if (this.phase === 'pitch') {
        calibration.basePitchHz = estimateBasePitch(this.samples, calibration.noiseFloorRms);
        this.mic.setCalibration(calibration);
        this.baseDone = true;
        this.phase = 'calibrated';
        this.setStatus('基準音を測定しました。④で声域を合わせ、上り・下りを練習しましょう。スキップして⑤から始めることもできます。');
      } else if (this.phase === 'low' || this.phase === 'high') {
        const range = this.mic.pitchRange;
        const pitch = estimatePitchLimit(this.samples, calibration, this.phase);
        range[this.phase === 'low' ? 'lowPitchHz' : 'highPitchHz'] = pitch;
        this.mic.setPitchRange(range);
        this.setStatus(`${this.phase === 'low' ? '下り' : '上り'}の最大入力を${pitch.toFixed(1)} Hzに合わせました。同じ高さの声で操作プレビューが100%になるか試してください。`);
        this.phase = 'calibrated';
      }
    } catch (error) {
      this.phase = this.baseDone ? 'calibrated' : 'ready';
      this.setStatus(error instanceof Error ? error.message : '測定できませんでした。もう一度お試しください。');
    }
    this.samples = [];
    this.measuringSince = null;
    this.refreshControls();
  }

  private stopMic(message: string): void {
    this.requestId++;
    this.mic.stop();
    this.mic.clearPitchRange();
    this.phase = 'idle';
    this.noiseDone = false;
    this.baseDone = false;
    this.resetPractice();
    this.diagnosticsFrozen = false;
    this.samples = [];
    this.measuringSince = null;
    if (this.controls) {
      this.controls.level.value = 0;
      this.controls.rms.value = '0.0000';
      this.controls.pitch.value = '—';
      this.controls.diagnostics.value = 'マイク停止中。許可してこの欄を開くと、現在の判定値を表示します。';
      this.controls.freezeDiagnostics.textContent = 'いまの値を固定';
      this.controls.freezeDiagnostics.setAttribute('aria-pressed', 'false');
    }
    this.setStatus(message);
    this.refreshControls();
  }

  private refreshControls(): void {
    const controls = this.controls;
    if (!controls) return;
    const measuring = this.measuring;
    controls.allow.disabled = this.phase !== 'idle';
    controls.stop.disabled = this.phase === 'idle';
    controls.freezeDiagnostics.disabled = !this.mic.running;
    controls.noise.disabled = !this.mic.running || measuring;
    controls.base.disabled = !this.mic.running || !this.noiseDone || measuring;
    controls.play.disabled = !this.mic.running || !this.baseDone || this.phase !== 'calibrated';
    controls.skipRange.disabled = controls.play.disabled;
    controls.low.disabled = controls.high.disabled = !this.mic.running || !this.baseDone || measuring;
    const range = this.mic.pitchRange;
    controls.resetRange.disabled = measuring || !this.baseDone || (range.lowPitchHz === null && range.highPitchHz === null);
    controls.range.value = `最大の下り：${range.lowPitchHz === null ? '感度設定に従う' : `${range.lowPitchHz.toFixed(1)} Hz`} / 最大の上り：${range.highPitchHz === null ? '感度設定に従う' : `${range.highPitchHz.toFixed(1)} Hz`}`;
    const calibration = this.mic.calibration;
    controls.floor.value = this.noiseDone ? calibration.noiseFloorRms.toFixed(4) : '未測定';
    controls.reference.value = this.baseDone ? `${calibration.basePitchHz.toFixed(1)} Hz` : '未測定';
    controls.progress.hidden = !measuring;
    controls.progress.value = 0;
    controls.timer.value = '';
    if (!this.baseDone) controls.response.value = '基準音の測定後、上り・下りを試せます';
    this.refreshPractice();
  }

  private setStatus(message: string): void { if (this.controls) this.controls.status.textContent = message; }

  private updateDiagnostics(input: Readonly<ControlInput>, features: Readonly<AudioFeatures>): void {
    const controls = this.controls;
    // 開いたときだけ数値を更新する。固定は表示だけで、操作やマイク解析を止めない。
    if (!controls?.diagnosticsPanel.open || this.diagnosticsFrozen) return;
    const calibration = this.mic.calibration;
    const range = this.mic.pitchRange;
    const pitchLabel = (pitch: number | null) => pitch !== null && Number.isFinite(pitch) ? `${pitch.toFixed(1)} Hz` : '未検出';
    const text = [
      `入力RMS（平滑化後）: ${features.rms.toFixed(4)}`,
      `無音しきい値: ${calibration.noiseFloorRms.toFixed(4)}`,
      `音程: ${pitchLabel(features.pitchHz)}`,
      `音程の信頼度: ${(features.clarity * 100).toFixed(1)}%（判定は${FEATURE_SETTINGS.minClarity * 100}%以上）`,
      `解析対象の音程: ${FEATURE_SETTINGS.minPitchHz}〜${FEATURE_SETTINGS.maxPitchHz} Hz`,
      `基準音: ${this.baseDone ? pitchLabel(calibration.basePitchHz) : '未測定'}`,
      `下り100%の声: ${range.lowPitchHz === null ? '未設定（感度に従う）' : pitchLabel(range.lowPitchHz)}`,
      `上り100%の声: ${range.highPitchHz === null ? '未設定（感度に従う）' : pitchLabel(range.highPitchHz)}`,
      `操作: ${!this.baseDone ? '基準音未測定' : !input.active ? '0%（音程入力なし）'
        : `${input.slope < 0 ? '下り' : input.slope > 0 ? '上り' : '平坦'} ${Math.round(Math.abs(input.slope) * 100)}%`}`,
    ].join('\n');
    if (controls.diagnostics.value !== text) controls.diagnostics.value = text;
  }

  private resetPractice(direction?: 'up' | 'down'): void {
    if (direction) this.practiced[direction] = false;
    else { this.practiced.up = false; this.practiced.down = false; }
    this.practiceDirection = null;
    this.practiceSince = null;
    this.refreshPractice();
  }

  private updatePractice(input: Readonly<ControlInput>, nowMs: number): void {
    const direction = this.phase === 'calibrated' && input.active && Number.isFinite(input.slope)
      ? input.slope >= 0.995 ? 'up' : input.slope <= -0.995 ? 'down' : null : null;
    if (!direction || !Number.isFinite(nowMs)) {
      this.practiceDirection = null;
      this.practiceSince = null;
      return;
    }
    if (direction !== this.practiceDirection || this.practiceSince === null || nowMs < this.practiceSince) {
      this.practiceDirection = direction;
      this.practiceSince = nowMs;
    }
    // 瞬間的な誤検出で「できた」にせず、表示の練習確認だけを250ms待つ。操作入力は遅らせない。
    if (!this.practiced[direction] && nowMs - this.practiceSince >= PRACTICE_HOLD_MS) {
      this.practiced[direction] = true;
      this.refreshPractice();
    }
  }

  private refreshPractice(): void {
    const controls = this.controls;
    if (!controls) return;
    for (const direction of ['up', 'down'] as const) {
      const node = direction === 'up' ? controls.upCheck : controls.downCheck;
      const done = this.practiced[direction];
      node.textContent = `${done ? '✓' : '○'} ${direction === 'up' ? '↑ 上り' : '↓ 下り'}100%：${done ? 'できました' : 'これから'}`;
      node.setAttribute('data-complete', String(done));
    }
    controls.practiceStatus.textContent = !this.baseDone ? '①〜③を終えると、声域合わせと上下の練習を試せます。'
      : this.practiced.up && this.practiced.down
      ? '準備OK！ 上り・下りの両方を操れました。⑤でスタートできます。'
      : '両方を試せると準備OK。届かない向きは声域を測ってみましょう。練習はスキップできます。';
  }

  private navigate(destination: 'mic' | 'keyboard' | 'title'): void {
    if (this.leaving || !this.ctx) return;
    if (destination === 'mic' && (!this.baseDone || this.phase !== 'calibrated' || !this.mic.running)) return;
    this.leaving = true;
    if (destination === 'title') this.ctx.goTo('title', undefined);
    else this.ctx.goTo('play', { source: destination === 'mic' ? this.mic : new KeyboardInput(window, this.ctx.ui) });
  }
}
