import { describe, expect, it, vi } from 'vitest';
import { NEUTRAL_INPUT } from '../core/types';
import { controlFromKeys, KeyboardInput } from './keyboard';

// Node 環境でも、実際のリスナー登録・解除とイベントのキャンセルを検証する。
function key(target: EventTarget, type: 'keydown' | 'keyup', code: string, repeat = false): Event {
  const event = new Event(type, { cancelable: true });
  Object.defineProperties(event, {
    code: { value: code },
    repeat: { value: repeat },
  });
  target.dispatchEvent(event);
  return event;
}

function press(target: EventTarget, code: string): void {
  key(target, 'keydown', code);
  key(target, 'keyup', code);
}

async function setup() {
  const target = new EventTarget();
  const source = new KeyboardInput(target);
  await source.start();
  return { target, source };
}

describe('controlFromKeys', () => {
  it.each([
    { keys: [], slope: 0, active: false },
    { keys: ['ArrowUp'], slope: 1, active: true },
    { keys: ['ArrowDown'], slope: -1, active: true },
    { keys: ['ArrowUp', 'ArrowDown'], slope: 0, active: true },
    { keys: ['ArrowRight'], slope: 0, active: false },
  ])('押下キー $keys の方向と有効状態を返す', ({ keys, slope, active }) => {
    const down = new Set(keys);
    expect(controlFromKeys(down, 0.5, false)).toEqual({ slope, intensity: 0.5, pulse: false, active });
    expect([...down]).toEqual(keys);
  });

  it('Space の入力は方向キーなしでも有効になる', () => {
    expect(controlFromKeys(new Set(), 0.5, true)).toEqual({ slope: 0, intensity: 0.5, pulse: true, active: true });
  });
});

describe('KeyboardInput', () => {
  it('開始時の強さは 0.5 で、音声特徴量はない', async () => {
    const { source } = await setup();
    expect(source.kind).toBe('keyboard');
    expect(source.read(0)).toEqual({ ...NEUTRAL_INPUT, intensity: 0.5 });
    expect(source.debugFeatures()).toBeNull();
    source.stop();
  });

  it('押している方向に反応し、キーを離すと中立へ戻る', async () => {
    const { target, source } = await setup();
    key(target, 'keydown', 'ArrowUp');
    expect(source.read(0)).toMatchObject({ slope: 1, active: true });
    key(target, 'keydown', 'ArrowDown');
    expect(source.read(1)).toMatchObject({ slope: 0, active: true });
    key(target, 'keyup', 'ArrowUp');
    expect(source.read(2)).toMatchObject({ slope: -1, active: true });
    key(target, 'keyup', 'ArrowDown');
    expect(source.read(3)).toMatchObject({ slope: 0, active: false });
    source.stop();
  });

  it.each([
    { code: 'ArrowRight', intensity: 0.6 },
    { code: 'KeyW', intensity: 0.6 },
    { code: 'ArrowLeft', intensity: 0.4 },
    { code: 'KeyS', intensity: 0.4 },
  ])('$code で強さを 0.1 だけ調整する', async ({ code, intensity }) => {
    const { target, source } = await setup();
    press(target, code);
    expect(source.read(0)).toMatchObject({ intensity, active: false });
    source.stop();
  });

  it('強さは上下限を超えず、小数誤差なく初期値へ戻る', async () => {
    const { target, source } = await setup();
    for (let i = 0; i < 20; i++) press(target, 'ArrowRight');
    expect(source.read(0).intensity).toBe(1);
    for (let i = 0; i < 5; i++) press(target, 'ArrowLeft');
    expect(source.read(1).intensity).toBe(0.5);
    for (let i = 0; i < 20; i++) press(target, 'KeyS');
    expect(source.read(2).intensity).toBe(0);
    for (let i = 0; i < 5; i++) press(target, 'KeyW');
    expect(source.read(3).intensity).toBe(0.5);
    source.stop();
  });

  it('Space は read で一度だけ消費し、長押し・重複 keydown では再発火しない', async () => {
    const { target, source } = await setup();
    key(target, 'keydown', 'Space');
    expect(source.read(0)).toMatchObject({ pulse: true, active: true });
    expect(source.read(1)).toMatchObject({ pulse: false, active: false });
    key(target, 'keydown', 'Space', true);
    key(target, 'keydown', 'Space');
    expect(source.read(2).pulse).toBe(false);
    key(target, 'keyup', 'Space');
    press(target, 'Space');
    expect(source.read(3).pulse).toBe(true);
    expect(source.read(4).pulse).toBe(false);
    source.stop();
  });

  it('方向キーと Space を同時に使っても、リズムだけ一度で消費する', async () => {
    const { target, source } = await setup();
    key(target, 'keydown', 'ArrowUp');
    press(target, 'Space');
    expect(source.read(0)).toMatchObject({ slope: 1, pulse: true, active: true });
    expect(source.read(1)).toMatchObject({ slope: 1, pulse: false, active: true });
    key(target, 'keyup', 'ArrowUp');
    expect(source.read(2)).toMatchObject({ slope: 0, pulse: false, active: false });
    source.stop();
  });

  it('強さのキーも長押し・重複 keydown では増え続けない', async () => {
    const { target, source } = await setup();
    key(target, 'keydown', 'ArrowRight');
    key(target, 'keydown', 'ArrowRight', true);
    key(target, 'keydown', 'ArrowRight');
    expect(source.read(0).intensity).toBe(0.6);
    key(target, 'keyup', 'ArrowRight');
    press(target, 'ArrowRight');
    expect(source.read(1).intensity).toBe(0.7);
    source.stop();
  });

  it('start を繰り返してもリスナーを二重登録せず、再開始後も操作できる', async () => {
    const target = new EventTarget();
    const add = vi.spyOn(target, 'addEventListener');
    const source = new KeyboardInput(target);
    await source.start();
    await source.start();
    expect(add.mock.calls.filter(([type]) => type === 'keydown')).toHaveLength(1);
    press(target, 'ArrowRight');
    expect(source.read(0).intensity).toBe(0.6);
    source.stop();
    await source.start();
    expect(add.mock.calls.filter(([type]) => type === 'keydown')).toHaveLength(2);
    press(target, 'ArrowRight');
    expect(source.read(1).intensity).toBe(0.7);
    source.stop();
  });

  it('stop は何度でも安全で、停止中のキーに反応せず、未消費入力を持ち越さない', async () => {
    const target = new EventTarget();
    const source = new KeyboardInput(target);
    source.stop();
    expect(source.read(0)).toEqual(NEUTRAL_INPUT);
    await source.start();
    key(target, 'keydown', 'ArrowUp');
    key(target, 'keydown', 'Space');
    source.stop();
    source.stop();
    expect(key(target, 'keydown', 'Space').defaultPrevented).toBe(false);
    expect(source.read(1)).toEqual(NEUTRAL_INPUT);
    press(target, 'ArrowRight');
    await source.start();
    expect(source.read(2)).toEqual({ ...NEUTRAL_INPUT, intensity: 0.5 });
    source.stop();
  });

  it('フォーカスを失うと方向キーと未消費の Space を消す', async () => {
    const { target, source } = await setup();
    key(target, 'keydown', 'ArrowUp');
    key(target, 'keydown', 'Space');
    target.dispatchEvent(new Event('blur'));
    expect(source.read(0)).toEqual({ ...NEUTRAL_INPUT, intensity: 0.5 });
    // 復帰時の長押しイベントでは新しい操作を始めない。
    key(target, 'keydown', 'Space', true);
    expect(source.read(1).pulse).toBe(false);
    press(target, 'Space');
    expect(source.read(2).pulse).toBe(true);
    source.stop();
  });

  it('操作キーのブラウザ動作を防ぎ、関係ないキーは妨げない', async () => {
    const { target, source } = await setup();
    for (const code of ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'KeyW', 'KeyS', 'Space']) {
      expect(key(target, 'keydown', code).defaultPrevented).toBe(true);
      expect(key(target, 'keydown', code, true).defaultPrevented).toBe(true);
      key(target, 'keyup', code);
    }
    expect(key(target, 'keydown', 'Escape').defaultPrevented).toBe(false);
    expect(key(target, 'keydown', 'KeyA').defaultPrevented).toBe(false);
    source.stop();
  });
});
