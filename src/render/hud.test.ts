import { afterEach, describe, expect, it, vi } from 'vitest';
import type { HudModel, SceneContext } from '../core/types';
import { NEUTRAL_INPUT } from '../core/types';
import { GAME, VIEW } from '../core/config';
import { KeyboardInput } from '../input/keyboard';
import { drawHud } from './hud';
import { PlayScene } from '../scenes/play';

function model(extra: Partial<HudModel> = {}): HudModel {
  return { mode: 'keyboard', score: 400, lives: 2, progress: 0.25, remainingSec: 45,
    input: { ...NEUTRAL_INPUT, intensity: 0.5 }, features: null, ...extra };
}

/** Canvasへの出力を記録する。実ブラウザの文字描画・見た目の検証とは分ける。 */
function canvas() {
  type Op = { name: string; args: unknown[]; color: string; };
  const ops: Op[] = [];
  const styles: Record<string, unknown> = {
    fillStyle: 'original', strokeStyle: 'original', globalAlpha: 0.4, font: 'original',
    textAlign: 'center', textBaseline: 'middle', lineWidth: 4,
  };
  const original = { ...styles };
  const stack: Record<string, unknown>[] = [];
  const g = new Proxy(styles, {
    get(target, key: string) {
      if (key in target) return target[key];
      if (key === 'createLinearGradient') return () => ({ addColorStop() {} });
      return (...args: unknown[]) => {
        if (key === 'save') stack.push({ ...styles });
        else if (key === 'restore') Object.assign(styles, stack.pop());
        ops.push({ name: key, args, color: String(styles.fillStyle) });
      };
    },
    set(target, key: string, value) { target[key] = value; return true; },
  }) as unknown as CanvasRenderingContext2D;
  return { g, ops, styles, original, stack,
    texts: () => ops.filter((op) => op.name === 'fillText').map((op) => String(op.args[0])),
    clear: () => { ops.length = 0; } };
}

afterEach(() => { vi.restoreAllMocks(); });

describe('HUD', () => {
  it('スコア・残り時間・進捗・残り割合・ライフを表示し、描画状態を復元する', () => {
    const c = canvas(); drawHud(c.g, model());
    expect(c.texts()).toEqual(expect.arrayContaining(['400', '45 秒', '進捗 25% / 残り 75%', 'キー操作']));
    const hearts = c.ops.filter((op) => op.name === 'fillText' && op.args[0] === '♥');
    expect(hearts).toHaveLength(GAME.lives);
    expect(hearts.filter((op) => op.color === '#ff8ca5')).toHaveLength(2);
    expect(c.styles).toEqual(c.original); expect(c.stack).toHaveLength(0);
  });

  it.each([[-1, '↓ 下り 100%'], [0, '→ 平坦 0%'], [0.4, '↑ 上り 40%']])(
    '方向%sを即座に表示し、メーターを左右に伸ばす', (slope, label) => {
      const c = canvas();
      drawHud(c.g, model({ input: { slope, intensity: 0.7, active: true, pulse: false } }));
      expect(c.texts()).toContain(label); expect(c.texts()).toContain('強さ 70%');
      const fill = c.ops.filter((op) => op.name === 'fillRect' && op.args[1] === 202).at(-1)!;
      expect(Number(fill.args[0])).toBeCloseTo(150 + Math.min(0, slope) * 106);
      expect(Number(fill.args[2])).toBeCloseTo(Math.abs(slope) * 106);
    });

  it('無音・音程不明では方向を中立にし、音程とRMSをマイク時だけ表示する', () => {
    const c = canvas();
    drawHud(c.g, model({ mode: 'mic', input: { slope: 1, intensity: 0.3, active: false, pulse: false },
      features: { timeMs: 16, pitchHz: null, rms: 0.02, clarity: 0.1, onset: false } }));
    expect(c.texts()).toContain('→ 平坦 0%');
    expect(c.texts()).toContain('無音・音程不明 → 平らに戻ります');
    expect(c.texts()).toContain('音程 — / RMS 0.0200');
    c.clear();
    drawHud(c.g, model({ mode: 'mic', features: { timeMs: 32, pitchHz: 130.123, rms: 0.035678, clarity: 0.99, onset: false } }));
    expect(c.texts()).toContain('音程 130.1 Hz / RMS 0.0357');
    c.clear(); drawHud(c.g, model());
    expect(c.texts().some((value) => value.includes('Hz') || value.includes('RMS'))).toBe(false);
  });

  it('無声音のリズム入力は無音と区別し、光を180ms残してから消す', () => {
    let now = 1000; vi.spyOn(performance, 'now').mockImplementation(() => now);
    const c = canvas(); const input = { ...NEUTRAL_INPUT, intensity: 0.5, pulse: true };
    drawHud(c.g, model({ mode: 'mic', input }));
    expect(c.texts()).toContain('リズム：検出！');
    expect(c.texts()).toContain('音程不明 → 波だけを作ります'); expect(input.pulse).toBe(true);
    now += 100; c.clear(); drawHud(c.g, model({ mode: 'mic' }));
    expect(c.texts()).toContain('リズム：検出！');
    now += 80; c.clear(); drawHud(c.g, model({ mode: 'mic' }));
    expect(c.texts()).toContain('リズム：待機');
  });

  it('同じpulseを描画し続けても光を延長せず、リトライや操作モード変更で残さない', () => {
    let now = 0; vi.spyOn(performance, 'now').mockImplementation(() => now);
    const c = canvas(); const hud = model({ input: { ...NEUTRAL_INPUT, pulse: true } });
    drawHud(c.g, hud);
    now = 200; c.clear(); drawHud(c.g, hud);
    expect(c.texts()).toContain('リズム：待機');
    now = 300; c.clear(); drawHud(c.g, model()); drawHud(c.g, hud);
    c.clear(); drawHud(c.g, model({ progress: 0 })); expect(c.texts()).toContain('リズム：待機');
    drawHud(c.g, model({ progress: 0, input: { ...NEUTRAL_INPUT, pulse: true } }));
    c.clear(); drawHud(c.g, model({ mode: 'mic', progress: 0 })); expect(c.texts()).toContain('リズム：待機');
  });

  it('連続した別フレームのpulseはどちらも検出する', () => {
    let now = 0; vi.spyOn(performance, 'now').mockImplementation(() => now);
    const c = canvas();
    drawHud(c.g, model({ input: { ...NEUTRAL_INPUT, pulse: true } }));
    now = 150; drawHud(c.g, model({ input: { ...NEUTRAL_INPUT, pulse: true } }));
    now = 200; c.clear(); drawHud(c.g, model());
    expect(c.texts()).toContain('リズム：検出！');
  });

  it.each(['keyboard', 'mic'] as const)('%sの開始後6秒だけ操作ヒントを出し、リトライで再表示する', (mode) => {
    const c = canvas(); drawHud(c.g, model({ mode, progress: 5 / GAME.durationSec }));
    expect(c.texts()).toContain('操作ガイド');
    expect(c.texts()).toContain(mode === 'mic' ? '「タン」で小さな波' : 'Space：小さな波');
    c.clear(); drawHud(c.g, model({ mode, progress: 6 / GAME.durationSec }));
    expect(c.texts()).not.toContain('操作ガイド');
    c.clear(); drawHud(c.g, model({ mode, progress: 0 })); expect(c.texts()).toContain('操作ガイド');
  });

  it('不正値を表示・描画へ広げず、画面内・予告ラインの左側に収め、モデルを変更しない', () => {
    const c = canvas();
    const hud = Object.freeze(model({ score: Infinity, lives: -5, progress: NaN, remainingSec: -10,
      mode: 'mic', input: Object.freeze({ slope: Infinity, intensity: 10, active: true, pulse: false }),
      features: Object.freeze({ timeMs: 16, pitchHz: NaN, rms: Infinity, clarity: 0, onset: false }) }));
    drawHud(c.g, hud); expect(c.texts().join(' ')).not.toMatch(/NaN|Infinity/);
    for (const op of c.ops) {
      for (const arg of op.args) if (typeof arg === 'number') expect(Number.isFinite(arg)).toBe(true);
      if (op.name === 'fillRect' || op.name === 'strokeRect') {
        const [x, y, w, h] = op.args as number[];
        expect(x).toBeGreaterThanOrEqual(0); expect(y).toBeGreaterThanOrEqual(0);
        expect(w).toBeGreaterThanOrEqual(0); expect(h).toBeGreaterThanOrEqual(0);
        expect(x + w).toBeLessThan(770); expect(y + h).toBeLessThanOrEqual(VIEW.height);
      }
    }
    expect(hud.input.intensity).toBe(10); expect(hud.features!.rms).toBe(Infinity);
  });

  it('本物のKeyboardInputの↑↓・強さ・Spaceを、そのフレームのHUDへ反映する', async () => {
    const target = new EventTarget(); const source = new KeyboardInput(target); const c = canvas();
    const key = (type: string, code: string) => {
      const event = new Event(type, { cancelable: true });
      Object.assign(event, { code, repeat: false }); target.dispatchEvent(event);
    };
    await source.start();
    try {
      key('keydown', 'ArrowUp'); key('keydown', 'ArrowRight'); drawHud(c.g, model({ input: source.read(0) }));
      expect(c.texts()).toContain('↑ 上り 100%'); expect(c.texts()).toContain('強さ 60%');
      key('keyup', 'ArrowUp'); key('keydown', 'ArrowDown');
      key('keyup', 'ArrowRight'); key('keydown', 'ArrowLeft'); key('keydown', 'Space');
      c.clear(); drawHud(c.g, model({ input: source.read(16) }));
      expect(c.texts()).toContain('↓ 下り 100%'); expect(c.texts()).toContain('強さ 50%');
      expect(c.texts()).toContain('リズム：検出！'); expect(source.read(16).pulse).toBe(false);
    } finally { source.stop(); }
  });

  it('PlaySceneから渡される入力を描画し、ポーズ・再開後も上下・強さ・リズムを表示する', async () => {
    const target = new EventTarget(); const source = new KeyboardInput(target);
    const c = canvas(); const play = new PlayScene();
    play.enter({ goTo: vi.fn() } as unknown as SceneContext, { source });
    const key = (code: string) => {
      const event = new Event('keydown', { cancelable: true });
      Object.assign(event, { code, repeat: false }); target.dispatchEvent(event);
    };
    try {
      await Promise.resolve();
      key('ArrowUp'); key('ArrowRight'); play.update(1 / 60, 16); play.render(c.g);
      expect(c.texts()).toContain('↑ 上り 100%'); expect(c.texts()).toContain('強さ 60%');
      play.pause(); expect(source.read(32).active).toBe(false);
      play.resume(); await Promise.resolve();
      key('ArrowDown'); key('Space'); c.clear(); play.update(1 / 60, 48); play.render(c.g);
      expect(c.texts()).toContain('↓ 下り 100%'); expect(c.texts()).toContain('強さ 60%');
      expect(c.texts()).toContain('リズム：検出！');
    } finally { play.exit(); }
    expect(source.read(64)).toEqual(NEUTRAL_INPUT);
  });
});
