import { describe, expect, it, vi } from 'vitest';
import type { ControlInput, InputSource, SceneContext } from '../core/types';
import { NEUTRAL_INPUT } from '../core/types';
import { GAME } from '../core/config';
import { PlayScene } from './play';

/** start/stop の回数と「今動いているか」を数える入力源のスタブ。 */
function fakeSource(opts: { failStart?: boolean } = {}) {
  let resolveStart: () => void = () => {};
  const src = {
    kind: 'keyboard' as const,
    running: false,
    starts: 0,
    stops: 0,
    reads: 0,
    input: { ...NEUTRAL_INPUT } as ControlInput,
    start: vi.fn(function (this: void) {
      src.starts++;
      if (opts.failStart) return Promise.reject(new Error('denied'));
      return new Promise<void>((r) => {
        resolveStart = () => {
          src.running = true;
          r();
        };
      });
    }),
    stop: vi.fn(() => {
      src.stops++;
      src.running = false;
    }),
    read: vi.fn(() => {
      src.reads++;
      return src.input;
    }),
    debugFeatures: () => null,
    finishStart: () => resolveStart(),
  };
  return src;
}

function fakeCtx() {
  const goTo = vi.fn();
  const ctx = { goTo, ui: { append: () => {} } } as unknown as SceneContext;
  return { ctx, goTo };
}

const flush = () => new Promise((r) => setTimeout(r, 0));
const key = (code: string) => ({ code, preventDefault: () => {} }) as KeyboardEvent;

function startedScene() {
  const src = fakeSource();
  const { ctx, goTo } = fakeCtx();
  const scene = new PlayScene();
  scene.enter(ctx, { source: src as unknown as InputSource });
  return { scene, src, goTo };
}

describe('PlayScene のライフサイクル（#9）', () => {
  it('start() が終わるまで入力を読まない', async () => {
    const { scene, src } = startedScene();
    scene.update(1 / 60, 0);
    expect(src.reads).toBe(0);
    src.finishStart();
    await flush();
    scene.update(1 / 60, 16);
    expect(src.reads).toBe(1);
  });

  it('ポーズで入力源を止め、再開で start し直す。ポーズ中はゲームが進まない', async () => {
    const { scene, src } = startedScene();
    src.finishStart();
    await flush();

    scene.onKeyDown(key('Escape'));
    expect(src.stops).toBe(1);
    expect(src.running).toBe(false);
    const reads = src.reads;
    for (let i = 0; i < 300; i++) scene.update(1 / 60, i * 16);
    expect(src.reads).toBe(reads);

    scene.onKeyDown(key('Escape'));
    expect(src.starts).toBe(2);
    src.finishStart();
    await flush();
    expect(src.running).toBe(true);
  });

  it('start の途中でポーズ→再開しても start を同時に走らせず、終了後にストリームが残らない', async () => {
    // 「素直な」マイク実装の模型：start ごとにストリームを作り、stop は最後のストリームだけ止める
    let live = 0;
    let current: { on: boolean } | null = null;
    const pending: (() => void)[] = [];
    const naive = {
      kind: 'mic' as const,
      start: () =>
        new Promise<void>((r) =>
          pending.push(() => {
            current = { on: true };
            live++;
            r();
          }),
        ),
      stop: () => {
        if (current?.on) {
          current.on = false;
          live--;
        }
      },
      read: () => ({ ...NEUTRAL_INPUT }),
      debugFeatures: () => null,
    };
    const { ctx } = fakeCtx();
    const scene = new PlayScene();
    scene.enter(ctx, { source: naive as unknown as InputSource });
    for (let i = 0; i < 6; i++) scene.onKeyDown(key('Escape')); // ポーズ・再開を連打
    expect(pending.length).toBe(1); // start は1つだけ
    while (pending.length) {
      pending.shift()!();
      await flush();
    }
    expect(live).toBe(1); // 動作中は1本
    scene.exit();
    expect(live).toBe(0); // 終了後は0本
  });

  it('入力源の準備ができるまでカウントダウンが進まない', async () => {
    const { scene, src, goTo } = startedScene();
    const frames = Math.ceil((GAME.countdownSec + GAME.durationSec + 1) * 60);
    for (let i = 0; i < frames; i++) scene.update(1 / 60, i * 16);
    expect(goTo).not.toHaveBeenCalled();
    expect(src.reads).toBe(0);
  });

  it('タブが隠れたら自動でポーズしてマイクを止める', async () => {
    const { scene, src } = startedScene();
    src.finishStart();
    await flush();
    scene.onHidden();
    expect(src.running).toBe(false);
  });

  it('start() が終わる前にシーンを離れても、あとで必ず stop される（トラック残り防止）', async () => {
    const { scene, src } = startedScene();
    scene.exit();
    src.finishStart();
    await flush();
    expect(src.running).toBe(false);
  });

  it('start() に失敗したらタイトルへ戻る（マイク拒否など）', async () => {
    const src = fakeSource({ failStart: true });
    const { ctx, goTo } = fakeCtx();
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    new PlayScene().enter(ctx, { source: src as unknown as InputSource });
    await flush();
    expect(goTo).toHaveBeenCalledWith('title', undefined);
    err.mockRestore();
  });

  it('ゴールで結果画面へ1回だけ遷移する（リトライ用に同じ入力源を渡す）', async () => {
    const { scene, src, goTo } = startedScene();
    src.finishStart();
    await flush();
    const frames = Math.ceil((GAME.countdownSec + GAME.durationSec + 1) * 60);
    for (let i = 0; i < frames; i++) scene.update(1 / 60, i * 16);
    expect(goTo).toHaveBeenCalledTimes(1);
    expect(goTo.mock.calls[0][0]).toBe('result');
    expect(goTo.mock.calls[0][1].source).toBe(src);
  });
});

/** 最小の DOM 模型（ボタンの作成・クリック・削除だけ）。 */
type FakeEl = {
  tag: string; className: string; type: string; textContent: string; children: FakeEl[];
  attrs: Record<string, string>; style: { cssText: string }; removed: boolean;
  listeners: Record<string, (() => void)[]>;
  addEventListener(t: string, f: () => void): void; removeEventListener(): void;
  setAttribute(k: string, v: string): void; append(...c: FakeEl[]): void; remove(): void; click(): void; blur(): void;
};
function fakeDom() {
  const make = (tag: string): FakeEl => {
    const el: FakeEl = {
      tag, className: '', type: '', textContent: '', children: [], attrs: {}, style: { cssText: '' }, removed: false, listeners: {},
      addEventListener: (t, f) => { (el.listeners[t] ??= []).push(f); },
      removeEventListener: () => {},
      setAttribute: (k, v) => { el.attrs[k] = v; },
      append: (...c) => { el.children.push(...c); },
      remove: () => { el.removed = true; },
      click: () => { for (const f of el.listeners.click ?? []) f(); },
      blur: () => {},
    };
    return el;
  };
  vi.stubGlobal('document', { createElement: make });
  const ui = make('div');
  const live = () => ui.children.filter((c) => !c.removed);
  const pauseButton = () => live().find((c) => c.className === 'pause-button')!;
  const menuButton = (text: string) =>
    live().find((c) => c.className === 'pause-menu')?.children.find((b) => b.textContent.startsWith(text));
  return { ui, live, pauseButton, menuButton };
}

describe('一時停止ボタン（#34）', () => {
  function sceneWithDom() {
    const dom = fakeDom();
    const src = fakeSource();
    const goTo = vi.fn();
    const ctx = { goTo, ui: dom.ui } as unknown as SceneContext;
    const scene = new PlayScene();
    scene.enter(ctx, { source: src as unknown as InputSource });
    return { dom, src, goTo, scene };
  }

  it('プレイ中は常に見えていて、タップでポーズ（マイク停止）→ もう一度で再開（start し直す）', async () => {
    const { dom, src } = sceneWithDom();
    src.finishStart();
    await flush();
    const b = dom.pauseButton();
    expect(b.attrs['aria-label']).toBe('一時停止');
    expect(b.style.cssText).toContain('height:44px');

    b.click();
    expect(src.running).toBe(false);
    expect(b.attrs['aria-label']).toBe('再開');
    expect(dom.menuButton('再開')).toBeDefined();

    b.click();
    expect(src.starts).toBe(2);
    expect(dom.menuButton('再開')).toBeUndefined();
    vi.unstubAllGlobals();
  });

  it('ポーズメニューの「タイトルへ」でタイトルに戻る', async () => {
    const { dom, src, goTo } = sceneWithDom();
    src.finishStart();
    await flush();
    dom.pauseButton().click();
    dom.menuButton('タイトルへ')!.click();
    expect(goTo).toHaveBeenCalledWith('title', undefined);
    vi.unstubAllGlobals();
  });

  it('ポーズメニューの「再開」ボタンでも、ボタンの表示が一時停止に戻る', async () => {
    const { dom, src } = sceneWithDom();
    src.finishStart();
    await flush();
    dom.pauseButton().click();
    dom.menuButton('再開')!.click();
    expect(dom.pauseButton().attrs['aria-label']).toBe('一時停止');
    vi.unstubAllGlobals();
  });

  it('シーンを離れるとボタンもメニューも消え、入力源は止まる', async () => {
    const { dom, src, scene } = sceneWithDom();
    src.finishStart();
    await flush();
    dom.pauseButton().click();
    scene.exit();
    expect(dom.live()).toHaveLength(0);
    expect(src.running).toBe(false);
    vi.unstubAllGlobals();
  });

  it('ボタンはクリックでフォーカスを残さず、ポーズ中の Enter は既定の動作を止める', async () => {
    const { dom, src, scene } = sceneWithDom();
    src.finishStart();
    await flush();
    let blurred = 0;
    (dom.pauseButton() as unknown as { blur: () => void }).blur = () => { blurred++; };
    dom.pauseButton().click();
    expect(blurred).toBe(1);
    let prevented = 0;
    scene.onKeyDown({ code: 'Enter', preventDefault: () => { prevented++; } } as KeyboardEvent);
    expect(prevented).toBe(1);
    expect(dom.pauseButton().attrs['aria-label']).toBe('一時停止');
    vi.unstubAllGlobals();
  });

  it('Esc とタブ非表示の自動ポーズは今までどおり（ボタンの表示も連動）', async () => {
    const { dom, src, scene } = sceneWithDom();
    src.finishStart();
    await flush();
    scene.onHidden();
    expect(dom.pauseButton().attrs['aria-label']).toBe('再開');
    scene.onKeyDown(key('Escape'));
    expect(dom.pauseButton().attrs['aria-label']).toBe('一時停止');
    vi.unstubAllGlobals();
  });
});
