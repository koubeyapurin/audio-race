import { AudioEngine } from '../src/input/mic/audioEngine';
import { FEATURE_SETTINGS } from '../src/input/mic/features';
import { MicUnavailableError } from '../src/core/types';
import type { AudioFeatures } from '../src/core/types';

function element<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`要素が見つかりません: ${id}`);
  return node as T;
}

const startButton = element<HTMLButtonElement>('start');
const stopButton = element<HTMLButtonElement>('stop');
const phaseSelect = element<HTMLSelectElement>('phase');
const status = element('status');
const rms = element<HTMLOutputElement>('rms');
const rmsMeter = element<HTMLMeterElement>('rms-meter');
const pitch = element<HTMLOutputElement>('pitch');
const clarity = element<HTMLOutputElement>('clarity');
const clarityMeter = element<HTMLMeterElement>('clarity-meter');
const onset = element<HTMLOutputElement>('onset');
const onsetCount = element('onset-count');
const report = element<HTMLTextAreaElement>('report');
const engine = new AudioEngine();

const PHASES = ['quiet', 'low', 'high', 'rhythm'] as const;
type Phase = typeof PHASES[number];
const LABELS: Record<Phase, string> = { quiet: '無音', low: '低い声', high: '高い声', rhythm: '短いタン' };
interface Measurement {
  frames: number;
  pitchFrames: number;
  rmsMin: number;
  rmsMax: number;
  rmsSum: number;
  pitchMin: number;
  pitchMax: number;
  onsets: number;
}
function emptyMeasurement(): Measurement {
  return { frames: 0, pitchFrames: 0, rmsMin: Infinity, rmsMax: 0, rmsSum: 0, pitchMin: Infinity, pitchMax: 0, onsets: 0 };
}
function newMeasurements(): Record<Phase, Measurement> {
  return { quiet: emptyMeasurement(), low: emptyMeasurement(), high: emptyMeasurement(), rhythm: emptyMeasurement() };
}
let measurements = newMeasurements();
let totalOnsets = 0;
let onsetUntil = 0;
let timer: ReturnType<typeof setTimeout> | null = null;
let requestId = 0;
let lastReportAt = -Infinity;
let measuredSampleRate: number | null = null;

function writeReport(): void {
  const lines = [
    `サンプルレート: ${measuredSampleRate ?? '未取得'} Hz`,
    `無音 RMS: ${FEATURE_SETTINGS.silenceRms} / 最小 clarity: ${FEATURE_SETTINGS.minClarity} / クールダウン: ${FEATURE_SETTINGS.onsetCooldownMs} ms`,
  ];
  for (const phase of PHASES) {
    const stats = measurements[phase];
    if (!stats.frames) { lines.push(`${LABELS[phase]}: 未測定`); continue; }
    const pitchRange = stats.pitchFrames
      ? `${stats.pitchMin.toFixed(1)}〜${stats.pitchMax.toFixed(1)} Hz` : '推定なし';
    lines.push(`${LABELS[phase]}: RMS ${stats.rmsMin.toFixed(4)}〜${stats.rmsMax.toFixed(4)}（平均 ${(stats.rmsSum / stats.frames).toFixed(4)}）, pitch ${pitchRange}, onset ${stats.onsets} 回, pitch検出 ${stats.pitchFrames}/${stats.frames} 回`);
  }
  report.value = lines.join('\n');
}

function showFeatures(features: AudioFeatures | null): void {
  rms.value = (features?.rms ?? 0).toFixed(4);
  rmsMeter.value = features?.rms ?? 0;
  pitch.value = features?.pitchHz === null || !features ? '—' : `${features.pitchHz.toFixed(1)} Hz`;
  clarity.value = `${Math.round((features?.clarity ?? 0) * 100)}%`;
  clarityMeter.value = features?.clarity ?? 0;
  const detected = features !== null && features.timeMs < onsetUntil;
  onset.value = detected ? '検出！' : '待機';
  onset.dataset.active = String(detected);
  onsetCount.textContent = `検出 ${totalOnsets} 回`;
}

function stop(message = '停止中。再度開始できます。'): void {
  requestId++;
  if (timer !== null) clearTimeout(timer);
  timer = null;
  engine.stop();
  startButton.disabled = false;
  stopButton.disabled = true;
  onsetUntil = 0;
  showFeatures(null);
  writeReport();
  status.textContent = message;
}

// 独立した測定ページだけで表示を更新する。ゲーム側は main.ts から read() を呼ぶ。
function poll(): void {
  timer = null;
  try {
    const nowMs = performance.now();
    const features = engine.read(nowMs);
    if (!features) { stop('マイク入力が中断されました。接続を確認して再度開始してください。'); return; }
    const phase = phaseSelect.value as Phase;
    const stats = measurements[phase];
    stats.frames++;
    stats.rmsMin = Math.min(stats.rmsMin, features.rms);
    stats.rmsMax = Math.max(stats.rmsMax, features.rms);
    stats.rmsSum += features.rms;
    if (features.pitchHz !== null) {
      stats.pitchFrames++;
      stats.pitchMin = Math.min(stats.pitchMin, features.pitchHz);
      stats.pitchMax = Math.max(stats.pitchMax, features.pitchHz);
    }
    if (features.onset) {
      stats.onsets++;
      totalOnsets++;
      onsetUntil = nowMs + 150;
    }
    showFeatures(features);
    if (nowMs - lastReportAt >= 500) { writeReport(); lastReportAt = nowMs; }
    timer = setTimeout(poll, 1000 / 60);
  } catch {
    stop('解析を続けられませんでした。マイクを停止しました。再度開始してください。');
  }
}

startButton.addEventListener('click', async () => {
  const currentRequest = ++requestId;
  startButton.disabled = true;
  stopButton.disabled = false;
  status.textContent = 'マイクの許可を待っています…（停止ボタンで中止できます）';
  try {
    await engine.start();
    if (currentRequest !== requestId) return;
    if (!engine.running) { stop('マイク入力を開始できませんでした。再度開始してください。'); return; }
    measurements = newMeasurements();
    totalOnsets = 0;
    onsetUntil = 0;
    lastReportAt = -Infinity;
    measuredSampleRate = engine.sampleRate;
    status.textContent = `マイク解析中（${measuredSampleRate} Hz）。停止ボタンでマイクを解放します。`;
    poll();
  } catch (error) {
    if (currentRequest !== requestId) return;
    stop(error instanceof MicUnavailableError ? `${error.message}（${error.reason}）` : 'マイクを開始できませんでした。');
  }
});
stopButton.addEventListener('click', () => stop());
document.addEventListener('visibilitychange', () => {
  if (document.hidden) stop('タブが非表示になったためマイクを停止しました。再度開始できます。');
});
window.addEventListener('pagehide', () => stop());
if (import.meta.hot) import.meta.hot.dispose(() => stop());
writeReport();
