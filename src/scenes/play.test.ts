import { describe, expect, it, vi } from 'vitest';
import { NEUTRAL_INPUT } from '../core/types';
import { DevKeys } from './play';

// DevKeys は window にリスナーを登録するので、node 環境用の最小スタブを置く
function stubWindow() {
  const target = new EventTarget();
  vi.stubGlobal('window', target);
  const key = (type: string, code: string) => {
    const e = new Event(type) as Event & { code: string; repeat: boolean };
    e.code = code;
    e.repeat = false;
    target.dispatchEvent(e);
  };
  return { key };
}

describe('DevKeys（#15）', () => {
  it('入力源が Space を拾ったフレームでも、DevKeys 側の pulse は消費されて二重発火しない', () => {
    const { key } = stubWindow();
    const dev = new DevKeys();
    dev.start();
    key('keydown', 'Space');

    const first = dev.merge({ ...NEUTRAL_INPUT, pulse: true, active: true }); // 本物の KeyboardInput が拾った
    const second = dev.merge({ ...NEUTRAL_INPUT }); // 次のフレームは中立
    expect(first.pulse).toBe(true);
    expect(second.pulse).toBe(false);
    dev.stop();
    vi.unstubAllGlobals();
  });

  it('Space と ↑ を同時に押して ↑ を離した後に、遅れた pulse が出ない', () => {
    const { key } = stubWindow();
    const dev = new DevKeys();
    dev.start();
    key('keydown', 'ArrowUp');
    key('keydown', 'Space');
    dev.merge({ ...NEUTRAL_INPUT, slope: 1, pulse: true, active: true });
    key('keyup', 'ArrowUp');
    expect(dev.merge({ ...NEUTRAL_INPUT }).pulse).toBe(false);
    dev.stop();
    vi.unstubAllGlobals();
  });
});
