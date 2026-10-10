import type { ControlInput, HudModel } from '../core/types';
import { GAME } from '../core/config';
import { readBestScore, scoreRecordRevision } from '../scenes/resultRecords';
import type { BestScore } from '../scenes/resultRecords';

const COLORS = {
  panel: 'rgba(12,24,40,0.9)', border: '#526782', text: '#edf4ff', muted: '#b4c4da',
  track: '#293d55', up: '#a6edcf', down: '#8dbfff', rhythm: '#ffd34d', life: '#ff8ca5',
} as const;
const PULSE_VISIBLE_MS = 180;
const HINT_SECONDS = 6;
interface PulseState {
  untilMs: number; wasPulse: boolean; lastInput: ControlInput | null;
  progress: number; mode: HudModel['mode'];
  record: BestScore; recordRevision: number; recordLabel: string;
}
const pulses = new WeakMap<CanvasRenderingContext2D, PulseState>();

const bounded = (value: number, low: number, high: number): number =>
  Number.isFinite(value) ? Math.max(low, Math.min(high, value)) : low;

/** 描画だけを担当する。入力の読み取り・消費や新しいゲームループは作らない。 */
export function drawHud(g: CanvasRenderingContext2D, hud: HudModel): void {
  const progress = bounded(hud.progress, 0, 1);
  const intensity = bounded(hud.input.intensity, 0, 1);
  const slope = hud.input.active && Number.isFinite(hud.input.slope) ? bounded(hud.input.slope, -1, 1) : 0;
  const nowMs = performance.now();
  let pulse = pulses.get(g);
  if (!pulse || progress < pulse.progress || hud.mode !== pulse.mode) {
    const record = readBestScore(hud.mode);
    pulse = { untilMs: -Infinity, wasPulse: false, lastInput: null, progress, mode: hud.mode,
      record, recordLabel: bestRecordLabel(record), recordRevision: scoreRecordRevision() };
    pulses.set(g, pulse);
  }
  if (pulse.recordRevision !== scoreRecordRevision()) {
    pulse.record = readBestScore(hud.mode);
    pulse.recordLabel = bestRecordLabel(pulse.record);
    pulse.recordRevision = scoreRecordRevision();
  }
  if (hud.input.pulse && (!pulse.wasPulse || hud.input !== pulse.lastInput)) pulse.untilMs = nowMs + PULSE_VISIBLE_MS;
  pulse.wasPulse = hud.input.pulse;
  pulse.lastInput = hud.input;
  pulse.progress = progress;

  g.save();
  g.globalAlpha = 1;
  g.textAlign = 'left';
  g.textBaseline = 'alphabetic';
  g.setLineDash([]);

  // 予告ライン（通常 x≈770）とランナー（x=320）の手前に収める。
  panel(g, 24, 18, 688, 100);
  text(g, 'スコア', 44, 42, 16, COLORS.muted, 180);
  text(g, String(Math.floor(bounded(hud.score, 0, Number.MAX_SAFE_INTEGER))), 44, 71, 28, COLORS.text, 180);
  text(g, 'ライフ', 250, 42, 16, COLORS.muted, 170);
  const lives = Math.floor(bounded(hud.lives, 0, GAME.lives));
  for (let i = 0; i < GAME.lives; i++) text(g, '♥', 250 + i * 34, 72, 30, i < lives ? COLORS.life : COLORS.track, 32);
  text(g, '残り時間', 446, 42, 16, COLORS.muted, 130);
  text(g, `${Math.ceil(bounded(hud.remainingSec, 0, GAME.durationSec))} 秒`, 446, 71, 28, COLORS.text, 130);
  text(g, hud.mode === 'mic' ? 'マイク操作' : 'キー操作', 592, 63, 18, COLORS.up, 100);
  bar(g, 44, 91, 440, 10, progress, COLORS.up);
  text(g, `進捗 ${Math.round(progress * 100)}% / 残り ${Math.round((1 - progress) * 100)}%`, 500, 102, 14, COLORS.muted, 192);

  // 生成ラインの説明（x≈778）を避け、右上に過去の記録を表示する。
  panel(g, 1040, 18, 216, 100);
  text(g, hud.mode === 'mic' ? 'マイクの自己ベスト' : 'キー操作の自己ベスト', 1056, 42, 16, COLORS.muted, 184);
  const best = pulse.record.best;
  text(g, pulse.recordLabel, 1056, 74, best === null ? 20 : 26, COLORS.rhythm, 184);
  text(g, 'このブラウザの記録', 1056, 102, 14, COLORS.muted, 184);

  panel(g, 24, 132, 252, 232);
  text(g, '地形の操作', 44, 160, 18, COLORS.text, 212);
  const direction = slope > 0 ? '↑ 上り' : slope < 0 ? '↓ 下り' : '→ 平坦';
  const color = slope < 0 ? COLORS.down : COLORS.up;
  text(g, `${direction} ${Math.round(Math.abs(slope) * 100)}%`, 44, 188, 22, color, 212);
  drawSlope(g, slope);
  text(g, `強さ ${Math.round(intensity * 100)}%`, 44, 240, 18, COLORS.text, 212);
  bar(g, 44, 250, 212, 12, intensity, COLORS.up);
  const glowing = nowMs < pulse.untilMs;
  g.fillStyle = glowing ? COLORS.rhythm : COLORS.track;
  g.beginPath();
  g.arc(53, 286, glowing ? 9 : 7, 0, Math.PI * 2);
  g.fill();
  text(g, glowing ? 'リズム：検出！' : 'リズム：待機', 72, 292, 16, glowing ? COLORS.rhythm : COLORS.muted, 184);
  text(g, inputStatus(hud.mode, hud.input), 44, 321, 14, COLORS.muted, 212);
  if (hud.mode === 'mic') {
    const pitch = hud.features?.pitchHz;
    const rms = hud.features?.rms;
    const pitchLabel = pitch != null && Number.isFinite(pitch) && pitch > 0 ? `${pitch.toFixed(1)} Hz` : '—';
    const rmsLabel = rms != null && Number.isFinite(rms) && rms >= 0 ? rms.toFixed(4) : '—';
    text(g, `音程 ${pitchLabel} / RMS ${rmsLabel}`, 44, 348, 14, COLORS.muted, 212);
  } else text(g, 'Esc：ポーズ / 再開', 44, 348, 14, COLORS.muted, 212);

  // 進捗から開始後の経過を求めるので、リトライでも独立したタイマーは不要。
  if (progress * GAME.durationSec < HINT_SECONDS) {
    panel(g, 24, 380, 252, 140);
    text(g, '操作ガイド', 44, 408, 18, COLORS.text, 212);
    const hints = hud.mode === 'mic'
      ? ['高い声：上り / 低い声：下り', '大きい声ほど強く変わる', '「タン」で小さな波', 'Escでポーズ・マイク停止']
      : ['↑ / ↓：上り / 下り', '← / →・W / S：強さを調整', 'Space：小さな波', 'Esc：ポーズ / 再開'];
    hints.forEach((hint, i) => text(g, hint, 44, 434 + i * 22, 14, COLORS.muted, 212));
  }
  g.restore();
}

function inputStatus(mode: HudModel['mode'], input: Readonly<ControlInput>): string {
  if (input.active) return '前方の生成ラインで反映';
  if (mode === 'keyboard') return '方向キーなし → 平らに戻ります';
  return input.pulse ? '音程不明 → 波だけを作ります' : '無音・音程不明 → 平らに戻ります';
}

function bestRecordLabel(record: BestScore): string {
  return !record.available ? '読み込み不可' : record.best === null ? '記録なし' : `${record.best.toLocaleString('ja-JP')} 点`;
}

function text(g: CanvasRenderingContext2D, value: string, x: number, y: number,
  size: number, color: string, maxWidth: number): void {
  g.fillStyle = color;
  g.font = `bold ${size}px system-ui, "Yu Gothic UI", sans-serif`;
  g.fillText(value, x, y, maxWidth);
}

function panel(g: CanvasRenderingContext2D, x: number, y: number, width: number, height: number): void {
  g.fillStyle = COLORS.panel;
  g.fillRect(x, y, width, height);
  g.strokeStyle = COLORS.border;
  g.lineWidth = 1;
  g.strokeRect(x, y, width, height);
}

function bar(g: CanvasRenderingContext2D, x: number, y: number, width: number, height: number,
  value: number, color: string): void {
  g.fillStyle = COLORS.track;
  g.fillRect(x, y, width, height);
  g.fillStyle = color;
  g.fillRect(x, y, width * value, height);
}

function drawSlope(g: CanvasRenderingContext2D, slope: number): void {
  const center = 150;
  g.fillStyle = COLORS.track;
  g.fillRect(44, 202, 212, 12);
  g.fillStyle = slope < 0 ? COLORS.down : COLORS.up;
  g.fillRect(center + Math.min(0, slope) * 106, 202, Math.abs(slope) * 106, 12);
  g.fillStyle = COLORS.text;
  g.fillRect(center - 1, 199, 2, 18);
}
