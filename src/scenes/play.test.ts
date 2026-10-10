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
