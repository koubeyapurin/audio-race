import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GameResult, InputKind, InputSource, SceneContext } from '../core/types';
import { NEUTRAL_INPUT } from '../core/types';
import { ResultScene } from './result';
import { readBestScore, recordBestScore } from './resultRecords';

/** HTMLから対象要素を拾う最低限のDOM。レイアウト確認は実ブラウザで行う。 */
class Element {
  children: Element[] = [];
  attrs: Record<string, string> = {};
  textContent = '';
  private listeners = new Map<string, (() => void)[]>();
  private parent: Element | null = null;
  constructor(public tag: string) {}
  set innerHTML(html: string) {
    this.children = [];
    for (const match of html.matchAll(/<([a-z][\w-]*)\b([^>]*)>/g)) {
      const child = new Element(match[1]);
      for (const attr of match[2].matchAll(/(data-[\w-]+)(?:="([^"]*)")?/g)) child.attrs[attr[1]] = attr[2] ?? '';
      this.append(child);
    }
  }
  setAttribute(name: string, value: string) { this.attrs[name] = value; }
  querySelector(selector: string) {
    return this.children.find((child) => selector.startsWith('[')
      ? selector.slice(1, -1) in child.attrs : child.tag === selector) ?? null;
  }
  append(child: Element) { this.children.push(child); child.parent = this; }
  remove() { if (this.parent) this.parent.children = this.parent.children.filter((child) => child !== this); }
  addEventListener(name: string, callback: () => void) {
    this.listeners.set(name, [...(this.listeners.get(name) ?? []), callback]);
  }
  click() { this.listeners.get('click')?.forEach((callback) => callback()); }
}

beforeEach(() => {
  const values = new Map<string, string>();
  vi.stubGlobal('localStorage', { getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); } });
  vi.stubGlobal('document', { createElement: (tag: string) => new Element(tag) });
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

function setup(mode: InputKind = 'keyboard', extra: Partial<GameResult> = {}) {
  const ui = new Element('main'); const goTo = vi.fn();
  const source: InputSource = { kind: mode, start: vi.fn(async () => {}), stop: vi.fn(),
    read: () => ({ ...NEUTRAL_INPUT }), debugFeatures: () => null };
  const scene = new ResultScene();
  const ctx = { ui, goTo } as unknown as SceneContext;
  scene.enter(ctx, { source, result: { outcome: 'clear', score: 800, notesCollected: 5, notesTotal: 10, ...extra } });
  const text = (name: string) => ui.children[0].querySelector(`[data-${name}]`)!.textContent;
  const node = (name: string) => ui.children[0].querySelector(`[data-${name}]`)!;
  return { scene, source, ctx, ui, goTo, text, node };
}

describe('結果画面の記録と再挑戦', () => {
  it('収集率・次の目標・操作モードの初回記録を表示し、マイクを停止する', () => {
    const s = setup('mic');
    expect(s.source.stop).toHaveBeenCalledOnce(); expect(s.source.start).not.toHaveBeenCalled();
    expect(s.text('notes')).toBe('5 / 10（50%）');
    expect(s.text('message')).toContain('80%収集！ あと3個');
    expect(s.text('best')).toBe('マイクの自己ベスト：800 点');
    expect(s.text('record')).toContain('最初の記録');
    expect(readBestScore('mic').best).toBe(800); expect(readBestScore('keyboard').best).toBeNull();
  });

  it('更新・同点・未更新を表示し、ゲームオーバーの得点も保存する', () => {
    recordBestScore('keyboard', 500);
    expect(setup().text('record')).toContain('前回から300点アップ');
    expect(setup().text('record')).toContain('同点');
    const lower = setup('keyboard', { score: 700, outcome: 'gameover' });
    expect(lower.text('best')).toContain('800 点');
    expect(lower.text('message')).toContain('まずはゴール');
    expect(lower.text('record')).toContain('次は自己ベスト');
    const higher = setup('keyboard', { score: 900, outcome: 'gameover' });
    expect(higher.text('record')).toContain('自己ベスト更新');
    expect(readBestScore('keyboard').best).toBe(900);
  });

  it('保存拒否や不正な結果でも表示とリトライを使える', () => {
    vi.stubGlobal('localStorage', { getItem: () => { throw new Error('denied'); } });
    const s = setup('mic', { score: NaN, notesCollected: Infinity, notesTotal: 0 });
    expect(s.text('record')).toContain('保存できません');
    expect(s.text('best')).toContain('利用できません');
    expect([s.text('score'), s.text('notes'), s.text('message')].join(' ')).not.toMatch(/NaN|Infinity/);
    s.node('retry').click();
    expect(s.goTo).toHaveBeenCalledWith('play', { source: s.source });
  });

  it.each(['button', 'key'] as const)('%sのリトライは入力源を引き継ぎ、二重遷移を防ぐ', (method) => {
    const s = setup('mic');
    const retry = () => method === 'button' ? s.node('retry').click()
      : s.scene.onKeyDown({ code: 'KeyR', repeat: false, preventDefault() {} } as KeyboardEvent);
    retry(); retry();
    expect(s.goTo).toHaveBeenCalledOnce(); expect(s.goTo).toHaveBeenCalledWith('play', { source: s.source });
    s.scene.exit(); expect(s.ui.children).toHaveLength(0);
  });

  it.each(['button', 'key'] as const)('%sでタイトルに戻り、キー長押しは遷移しない', (method) => {
    const s = setup();
    s.scene.onKeyDown({ code: 'Escape', repeat: true, preventDefault() {} } as KeyboardEvent);
    expect(s.goTo).not.toHaveBeenCalled();
    if (method === 'button') s.node('title').click();
    else s.scene.onKeyDown({ code: 'Escape', repeat: false, preventDefault() {} } as KeyboardEvent);
    expect(s.goTo).toHaveBeenCalledWith('title', undefined);
    s.scene.exit(); expect(s.ui.children).toHaveLength(0);
  });

  it('同じシーンを入り直してもパネルは1つで、最新結果を表示する', () => {
    const s = setup();
    s.scene.enter(s.ctx, { source: s.source, result: { outcome: 'clear', score: 1300, notesCollected: 10, notesTotal: 10 } });
    expect(s.ui.children).toHaveLength(1); expect(s.text('message')).toContain('完全収集達成');
    expect(s.text('record')).toContain('自己ベスト更新');
  });
});
