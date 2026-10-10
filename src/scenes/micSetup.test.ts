import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AudioFeatures, SceneContext } from '../core/types';
import { MicUnavailableError } from '../core/types';
import { MicInput } from '../input/mic/micInput';
import { MicSetupScene } from './micSetup';

/** UIの操作と後片付けを検証する。表示の実機確認・録音には使わない。 */
class Element extends EventTarget {
  children: Element[] = [];
  parent: Element | null = null;
  attrs: Record<string, string> = {};
  textContent = '';
  value: string | number = '';
  disabled = false;
  hidden = false;
  html = '';
  setAttribute(name: string, value: string) { this.attrs[name] = value; }
  set innerHTML(html: string) {
    this.html = html;
    this.children = Array.from(html.matchAll(/<([a-z][a-z0-9-]*)\b([^>]*)>/g), ([, , attributes]) => {
      const child = new Element();
      for (const [, name, value] of attributes.matchAll(/(data-[\w-]+)(?:="([^"]*)")?/g)) child.attrs[name] = value ?? '';
      child.parent = this; return child;
    });
  }
  querySelector(selector: string) { return this.children.find((child) => selector.slice(1, -1) in child.attrs) ?? null; }
  append(child: Element) { this.children.push(child); child.parent = this; }
  remove() { if (this.parent) this.parent.children = this.parent.children.filter((child) => child !== this); }
}

let currentScene: MicSetupScene | null = null;
afterEach(() => { currentScene?.exit(); currentScene = null; vi.unstubAllGlobals(); });

function setup() {
  vi.stubGlobal('document', { createElement: () => new Element() });
  vi.stubGlobal('window', new EventTarget());
  let running = false;
  let voice: Partial<AudioFeatures> = { pitchHz: null, rms: 0.0001 };
  const engine = {
    get running() { return running; },
    start: vi.fn(async () => { running = true; }),
    stop: vi.fn(() => { running = false; }),
    read: (nowMs: number): AudioFeatures => ({ timeMs: nowMs, rms: 0.06, pitchHz: 130, clarity: 1, onset: false, ...voice }),
  };
  const mic = new MicInput(undefined, engine);
  const ui = new Element(); const scene = new MicSetupScene(mic); currentScene = scene;
  const goTo = vi.fn((_name: string, _params: unknown) => { scene.exit(); ui.children = []; });
  scene.enter({ ui, goTo } as unknown as SceneContext);
  const panel = ui.children[0];
  const node = (name: string) => panel.querySelector(`[data-${name}]`)!;
  const click = (name: string) => { if (!node(name).disabled) node(name).dispatchEvent(new Event('click')); };
  const setVoice = (pitchHz: number | null, rms = 0.06, clarity = 1) => { voice = { pitchHz, rms, clarity }; };
  const update = (now: number) => scene.update(0.016, now);
  const measure = (from: number) => { for (let now = from; now <= from + 2000; now += 100) update(now); };
  const prepare = async () => {
    click('allow'); await Promise.resolve(); await Promise.resolve();
    click('noise'); measure(0); setVoice(130); click('base'); measure(2100);
  };
  const done = (direction: string) => node(`${direction}-check`).attrs['data-complete'] === 'true';
  return { engine, mic, scene, ui, goTo, panel, node, click, setVoice, update, measure, prepare, done };
}

describe('おすすめの声域合わせと上下の練習（#35）', () => {
  it('声域合わせは折りたたまずに表示し、基準音の後は練習未完了でもスキップできる', async () => {
    const s = setup(); expect(s.panel.html).not.toContain('<details>');
    expect(s.panel.html).toContain('④ 自分の声域に合わせる（おすすめ・スキップ可）');
    expect(s.panel.html).toContain('⑤ マイクでスタート');
    expect(s.panel.html).toContain('約1.5秒先'); expect(s.node('skip-range').disabled).toBe(true);
    await s.prepare(); expect(s.node('skip-range').disabled).toBe(false);
    expect(s.done('up')).toBe(false); expect(s.done('down')).toBe(false);
    s.click('skip-range'); expect(s.goTo).toHaveBeenCalledOnce();
    expect(s.goTo).toHaveBeenCalledWith('play', { source: s.mic });
    expect(s.mic.pitchRange).toEqual({ lowPitchHz: null, highPitchHz: null }); expect(s.ui.children).toHaveLength(0);
  });

  it('最大入力を250ms続けた向きにチェックを付け、両方で準備OKにする', async () => {
    const s = setup(); await s.prepare(); s.setVoice(150); s.update(4200); s.update(4400);
    expect(s.done('up')).toBe(false); s.update(4450); expect(s.done('up')).toBe(true);
    expect(s.done('down')).toBe(false); expect(s.node('practice-status').textContent).not.toContain('準備OK！');
    s.setVoice(110); s.update(4500); s.update(4750);
    expect(s.done('down')).toBe(true); expect(s.node('practice-status').textContent).toContain('準備OK！');
    expect(s.node('up-check').textContent).toContain('✓ ↑ 上り100%');
    expect(s.node('down-check').textContent).toContain('✓ ↓ 下り100%');
    expect(s.node('play').disabled).toBe(false);
  });

  it('一瞬の最大入力・無音・音程不明・小さい操作量で練習を完了にしない', async () => {
    const s = setup(); await s.prepare(); s.setVoice(150); s.update(4200);
    s.setVoice(null, 0.0001); s.update(4216);
    s.setVoice(150); s.update(4500); s.update(4700); expect(s.done('up')).toBe(false);
    s.setVoice(null); s.update(4750); s.setVoice(150, 0.06, 0.2); s.update(5000);
    expect(s.done('up')).toBe(false);
    s.setVoice(135); s.update(5300); s.update(5600); expect(s.done('up')).toBe(false);
    expect(s.node('play').disabled).toBe(false);
  });

  it('測定中の声を練習済みにせず、測った狭い声域と感度をゲーム・再開に引き継ぐ', async () => {
    const s = setup(); await s.prepare(); s.setVoice(125); s.click('low'); s.measure(4200);
    expect(s.done('down')).toBe(false); expect(s.node('skip-range').disabled).toBe(false);
    s.update(6300); s.update(6550); expect(s.done('down')).toBe(true);
    s.setVoice(135); s.click('high'); s.measure(6600); expect(s.done('up')).toBe(false);
    s.update(8700); s.update(8950); expect(s.done('up')).toBe(true);
    s.click('play'); expect(s.goTo).toHaveBeenCalledWith('play', { source: s.mic });
    expect(s.mic.running).toBe(false); expect(s.mic.pitchSensitivity).toBe('sensitive');
    expect(s.mic.pitchRange).toEqual({ lowPitchHz: 125, highPitchHz: 135 });
    await s.mic.start(); s.setVoice(125); expect(s.mic.read(9100).slope).toBe(-1);
    s.mic.stop(); await s.mic.start(); s.setVoice(135); expect(s.mic.read(9200).slope).toBe(1); s.mic.stop();
  });

  it.each(['sensitivity', 'reset-range', 'base', 'noise', 'stop', 'hidden'])(
    '%sで変更・停止した場合は古い練習結果を残さない', async (action) => {
      const s = setup(); await s.prepare(); s.setVoice(150); s.update(4200); s.update(4450);
      s.setVoice(110); s.update(4500); s.update(4750); expect(s.done('up') && s.done('down')).toBe(true);
      if (action === 'sensitivity') {
        s.node('sensitivity').value = 'standard'; s.node('sensitivity').dispatchEvent(new Event('change'));
      } else if (action === 'reset-range') {
        s.mic.setPitchRange({ lowPitchHz: 125, highPitchHz: null });
        s.click('low'); s.setVoice(125); s.measure(4800); s.click('reset-range');
      } else if (action === 'hidden') s.scene.onHidden();
      else s.click(action);
      expect(s.done('up')).toBe(false); expect(s.done('down')).toBe(false);
      if (action === 'stop' || action === 'hidden') {
        expect(s.engine.running).toBe(false); expect(s.node('play').disabled).toBe(true);
      }
    },
  );

  it.each(['denied', 'not-found'] as const)('%sでも手動操作へ切り替え、準備画面を解放する', async (reason) => {
    const s = setup(); s.engine.start.mockRejectedValueOnce(new MicUnavailableError(reason));
    s.click('allow'); await Promise.resolve(); await Promise.resolve();
    expect(s.node('allow').disabled).toBe(false); expect(s.node('skip-range').disabled).toBe(true);
    s.click('keyboard'); expect(s.goTo).toHaveBeenCalledOnce();
    expect(s.goTo.mock.calls[0][0]).toBe('play');
    expect((s.goTo.mock.calls[0][1] as { source: { kind: string } }).source.kind).toBe('keyboard');
    expect(s.engine.running).toBe(false); expect(s.ui.children).toHaveLength(0);
  });
});
