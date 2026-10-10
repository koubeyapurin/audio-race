import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { KeyboardInput } from './keyboard';
import { NEUTRAL_INPUT } from '../core/types';

/** Pointer Eventsのライフサイクルを検証する小さなDOM。Safariの表示確認とは分ける。 */
class Element extends EventTarget {
  children: Element[] = [];
  attrs: Record<string, string> = {};
  textContent = '';
  className = '';
  captures = new Set<number>();
  parent: Element | null = null;
  set innerHTML(html: string) {
    this.children = [];
    for (const match of html.matchAll(/<(button|span)\b([^>]*)>/g)) {
      const child = new Element();
      for (const attr of match[2].matchAll(/(data-[\w-]+)(?:="([^"]*)")?/g)) child.attrs[attr[1]] = attr[2] ?? '';
      this.append(child);
    }
  }
  querySelector(selector: string): Element | null {
    const [name, value] = selector.slice(1, -1).split('=');
    return this.children.find((child) => name in child.attrs
      && (value === undefined || child.attrs[name] === value.replaceAll('"', ''))) ?? null;
  }
  setAttribute(name: string, value: string) { this.attrs[name] = value; }
  setPointerCapture(id: number) { this.captures.add(id); }
  append(child: Element) { this.children.push(child); child.parent = this; }
  remove() { if (this.parent) this.parent.children = this.parent.children.filter((child) => child !== this); }
}

beforeEach(() => { vi.stubGlobal('document', { createElement: () => new Element() }); });
afterEach(() => { vi.unstubAllGlobals(); });

function event(target: EventTarget, type: string, data: Record<string, unknown>): Event {
  const e = new Event(type, { cancelable: true }); Object.assign(e, data); target.dispatchEvent(e); return e;
}
const pointer = (target: Element, type: string, id = 1, button = 0) => event(target, type, { pointerId: id, button });
const key = (target: EventTarget, type: string, code: string, repeat = false) => event(target, type, { code, repeat });

async function setup() {
  const target = new EventTarget(); const root = new Element();
  const source = new KeyboardInput(target, root as unknown as HTMLElement); await source.start();
  const button = (action: string) => root.children[0].querySelector(`[data-action="${action}"]`)!;
  return { source, target, root, button };
}

describe('タッチを共通の手動入力へ変換する', () => {
  it('長押しの向き・複数指・片方だけの解放を扱い、capture外でも解放できる', async () => {
    const s = await setup(); const up = s.button('up'); const down = s.button('down');
    expect(pointer(up, 'pointerdown').defaultPrevented).toBe(true); expect(up.captures.has(1)).toBe(true);
    expect(s.source.read(0)).toMatchObject({ slope: 1, active: true });
    pointer(up, 'pointerdown', 2); pointer(up, 'pointerup', 1);
    expect(s.source.read(1).slope).toBe(1); expect(up.attrs['aria-pressed']).toBe('true');
    pointer(down, 'pointerdown', 3); expect(s.source.read(2)).toMatchObject({ slope: 0, active: true });
    pointer(up, 'lostpointercapture', 2); expect(s.source.read(3).slope).toBe(-1);
    pointer(down, 'pointercancel', 3); expect(s.source.read(4)).toEqual({ ...NEUTRAL_INPUT, intensity: 0.5 });
    expect(down.attrs['aria-pressed']).toBe('false'); s.source.stop();
  });

  it('波は1タップ1回で長押し・重複pointerdown・互換clickで繰り返さない', async () => {
    const s = await setup(); const pulse = s.button('pulse');
    pointer(pulse, 'pointerdown'); expect(s.source.read(0).pulse).toBe(true);
    pointer(pulse, 'pointerdown'); event(pulse, 'click', { detail: 1 });
    expect(s.source.read(1).pulse).toBe(false);
    pointer(pulse, 'pointerup'); pointer(pulse, 'pointerdown');
    expect(s.source.read(2).pulse).toBe(true); expect(s.source.read(3).pulse).toBe(false); s.source.stop();
  });

  it('強さは1回10%で上下限に収まり、キーと表示も同期する', async () => {
    const s = await setup(); const plus = s.button('stronger'); const minus = s.button('weaker');
    for (let i = 0; i < 20; i++) { pointer(plus, 'pointerdown', i); pointer(plus, 'pointerup', i); }
    expect(s.source.read(0).intensity).toBe(1);
    for (let i = 0; i < 20; i++) { pointer(minus, 'pointerdown', i); pointer(minus, 'pointerup', i); }
    expect(s.source.read(1).intensity).toBe(0);
    key(s.target, 'keydown', 'ArrowRight'); expect(s.source.read(2).intensity).toBe(0.1);
    expect(s.root.children[0].querySelector('[data-strength]')!.textContent).toBe('強さ 10%'); s.source.stop();
  });

  it('同じ向きのタッチを離しても、押している物理キーは維持する', async () => {
    const s = await setup(); key(s.target, 'keydown', 'ArrowUp');
    pointer(s.button('up'), 'pointerdown'); pointer(s.button('up'), 'pointerup');
    expect(s.source.read(0).slope).toBe(1);
    key(s.target, 'keyup', 'ArrowUp'); expect(s.source.read(1).active).toBe(false); s.source.stop();
  });

  it('blur・stopで未消費の波と押下を解除し、再開・リトライで強さだけ維持する', async () => {
    const s = await setup(); pointer(s.button('up'), 'pointerdown'); pointer(s.button('pulse'), 'pointerdown', 2);
    s.target.dispatchEvent(new Event('blur'));
    expect(s.source.read(0)).toEqual({ ...NEUTRAL_INPUT, intensity: 0.5 });
    pointer(s.button('stronger'), 'pointerdown', 3); const oldUp = s.button('up');
    pointer(oldUp, 'pointerdown', 4); pointer(s.button('pulse'), 'pointerdown', 5);
    s.source.stop(); expect(s.root.children).toHaveLength(0); expect(s.source.read(1)).toEqual(NEUTRAL_INPUT);
    await s.source.start(); await s.source.start(); expect(s.root.children).toHaveLength(1);
    pointer(oldUp, 'pointerdown', 6); expect(s.source.read(2)).toEqual({ ...NEUTRAL_INPUT, intensity: 0.6 });
    pointer(s.button('down'), 'pointerdown', 7); expect(s.source.read(3).slope).toBe(-1); s.source.stop();
  });

  it('フォーカスしたボタンはSpace/Enterでも操作でき、リピートやblurで固着しない', async () => {
    const s = await setup(); const down = s.button('down'); const pulse = s.button('pulse');
    expect(key(down, 'keydown', 'Space').defaultPrevented).toBe(true);
    expect(s.source.read(0).slope).toBe(-1); key(down, 'keyup', 'Space'); expect(s.source.read(1).active).toBe(false);
    key(pulse, 'keydown', 'Enter'); expect(s.source.read(2).pulse).toBe(true);
    key(pulse, 'keydown', 'Enter', true); expect(s.source.read(3).pulse).toBe(false);
    key(down, 'keydown', 'Enter'); down.dispatchEvent(new Event('blur')); expect(s.source.read(4).slope).toBe(0);
    event(pulse, 'click', { detail: 0 }); expect(s.source.read(5).pulse).toBe(true); s.source.stop();
  });

  it('マウスの右ボタンや関係ないキーではゲーム入力を作らない', async () => {
    const s = await setup(); expect(pointer(s.button('up'), 'pointerdown', 1, 2).defaultPrevented).toBe(false);
    expect(key(s.button('up'), 'keydown', 'KeyA').defaultPrevented).toBe(false);
    expect(s.source.read(0)).toEqual({ ...NEUTRAL_INPUT, intensity: 0.5 }); s.source.stop();
  });
});
