import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AudioFeatures, Calibration, SceneContext } from '../../core/types';
import { MicUnavailableError, NEUTRAL_INPUT } from '../../core/types';
import { MicSetupScene } from '../../scenes/micSetup';
import { PlayScene } from '../../scenes/play';
import { MicInput } from './micInput';
import { estimateBasePitch, estimateNoiseFloor, estimatePitchLimit, mapAudioFeatures, validPitchRange } from './mapper';

const calibration: Calibration = { basePitchHz: 220, noiseFloorRms: 0.01 };
const features = (extra: Partial<AudioFeatures> = {}): AudioFeatures => ({
  timeMs: 0, rms: 0.05, pitchHz: 220, clarity: 0.99, onset: false, ...extra,
});
const frames = (rms: number, pitchHz: number | null = null, count = 100): AudioFeatures[] =>
  Array.from({ length: count }, (_, i) => features({ timeMs: i * 16, rms, pitchHz }));

describe('音声から共通入力への変換', () => {
  it.each([
    [-12, -1], [-6, -1], [-3.5, -0.5], [-2, -0.2], [-1, 0], [0, 0],
    [1, 0], [2, 0.2], [3.5, 0.5], [6, 1], [12, 1],
  ])('基準音との差%s半音はslope %s', (semitones, slope) => {
    const input = mapAudioFeatures(features({ pitchHz: 220 * 2 ** (semitones / 12) }), calibration);
    expect(input.slope).toBeCloseTo(slope, 8);
    expect(input.active).toBe(true);
  });

  it.each([0, 0.005, 0.01, NaN, Infinity])('音量%sでは中立で、onsetも抑制する', (rms) => {
    expect(mapAudioFeatures(features({ rms, onset: true }), calibration)).toEqual(NEUTRAL_INPUT);
  });

  it('雑音を引いた音量を正規化し、大きな音は1に制限する', () => {
    expect(mapAudioFeatures(features({ rms: 0.05 }), calibration).intensity).toBeCloseTo(0.5);
    expect(mapAudioFeatures(features({ rms: 1 }), calibration).intensity).toBe(1);
    expect(mapAudioFeatures(features({ rms: 0.02 }), { ...calibration, noiseFloorRms: 0.001 }).intensity).toBeGreaterThan(0);
  });

  it('pitchが不明でも短い発声のpulseを保持し、坂はつくらない', () => {
    expect(mapAudioFeatures(features({ pitchHz: null, onset: true }), calibration))
      .toEqual({ slope: 0, intensity: 0.5, pulse: true, active: false });
    expect(mapAudioFeatures(features({ clarity: 0.2 }), calibration).active).toBe(false);
  });

  it.each([
    [-2, -1], [-1, -3 / 7], [-0.5, -1 / 7], [-0.25, 0], [0, 0],
    [0.25, 0], [0.5, 1 / 7], [1, 3 / 7], [2, 1], [12, 1],
  ])('反応しやすい設定では%s半音をslope %sに変換し、小さな揺れは抑える', (semitones, slope) => {
    const input = mapAudioFeatures(features({ pitchHz: 220 * 2 ** (semitones / 12) }), calibration, 'sensitive');
    expect(input.slope).toBeCloseTo(slope, 8);
    expect(input.intensity).toBeCloseTo(0.5);
  });

  it('狭い声域の上下に反応し、無音・音程不明・信頼度不足の坂は増幅しない', () => {
    const reference = { ...calibration, basePitchHz: 130 };
    for (const [pitchHz, sign] of [[125, -1], [135, 1]]) {
      const sample = features({ pitchHz });
      expect(mapAudioFeatures(sample, reference).slope).toBe(0);
      expect(mapAudioFeatures(sample, reference, 'sensitive').slope * sign).toBeGreaterThan(0.2);
    }
    expect(mapAudioFeatures(features({ rms: 0.001, onset: true }), reference, 'sensitive')).toEqual(NEUTRAL_INPUT);
    for (const sample of [features({ pitchHz: null, onset: true }), features({ clarity: 0.2 })]) {
      expect(mapAudioFeatures(sample, reference, 'sensitive')).toMatchObject({ slope: 0, active: false });
    }
  });

  it('不正な推定値や基準値でNaNの坂をつくらず、入力も変更しない', () => {
    for (const pitchHz of [NaN, Infinity, -1, 0]) {
      expect(mapAudioFeatures(features({ pitchHz }), calibration)).toMatchObject({ slope: 0, active: false });
    }
    for (const invalid of [
      { basePitchHz: 0, noiseFloorRms: 0.01 }, { basePitchHz: NaN, noiseFloorRms: 0.01 },
      { basePitchHz: 220, noiseFloorRms: -1 }, { basePitchHz: 220, noiseFloorRms: 1 },
    ]) expect(mapAudioFeatures(features(), invalid)).toEqual(NEUTRAL_INPUT);
    const frozen = Object.freeze(features({ onset: true }));
    const settings = Object.freeze({ ...calibration });
    expect(mapAudioFeatures(frozen, settings)).toEqual(mapAudioFeatures(frozen, settings));
    expect(frozen).toEqual(features({ onset: true }));
  });
});

describe('個人差の補正', () => {
  it('狭い下り側と広い上り側を個別に最大入力へ対応させ、基準と無音は中立にする', () => {
    const reference = { ...calibration, basePitchHz: 130 };
    const range = Object.freeze({ lowPitchHz: 125, highPitchHz: 160 });
    const read = (pitchHz: number) => mapAudioFeatures(features({ pitchHz }), reference, 'sensitive', range);
    expect(read(125).slope).toBeCloseTo(-1);
    expect(read(160).slope).toBeCloseTo(1);
    expect(read(120).slope).toBe(-1);
    expect(read(180).slope).toBe(1);
    expect(read(130).slope).toBe(0);
    expect(read(130 * 2 ** (0.1 / 12)).slope).toBe(0);
    expect(read(130 * 2 ** (-0.1 / 12)).slope).toBe(0);
    let previous = -1;
    for (let pitchHz = 120; pitchHz <= 180; pitchHz += 0.1) {
      const slope = read(pitchHz).slope;
      expect(slope).toBeGreaterThanOrEqual(previous);
      expect(slope).toBeLessThanOrEqual(1);
      previous = slope;
    }
    expect(mapAudioFeatures(features({ rms: 0, onset: true }), reference, 'sensitive', range)).toEqual(NEUTRAL_INPUT);
    expect(mapAudioFeatures(features({ pitchHz: null }), reference, 'sensitive', range).active).toBe(false);
  });

  it('片方だけの声域調整と0.5半音の狭い声域でも最大入力に届く', () => {
    const lowPitchHz = 220 * 2 ** (-0.5 / 12);
    const range = { lowPitchHz, highPitchHz: null };
    expect(validPitchRange(range, calibration)).toBe(true);
    expect(mapAudioFeatures(features({ pitchHz: lowPitchHz }), calibration, 'standard', range).slope).toBeCloseTo(-1);
    expect(mapAudioFeatures(features({ pitchHz: 220 * 2 ** (2 / 12) }), calibration, 'sensitive', range).slope).toBeCloseTo(1);
  });

  it('声域は雑音を除いた中央値で測定し、逆方向・近すぎる声・測定不足を受け付けない', () => {
    const reference = { ...calibration, basePitchHz: 130 };
    expect(estimatePitchLimit([...frames(0.05, 125), ...frames(0, 1000, 30)], reference, 'low')).toBe(125);
    expect(estimatePitchLimit(frames(0.05, 160), reference, 'high')).toBe(160);
    expect(() => estimatePitchLimit(frames(0.05, 135), reference, 'low')).toThrow('中間の高さ');
    expect(() => estimatePitchLimit(frames(0.05, 130), reference, 'high')).toThrow('0.5半音');
    expect(() => estimatePitchLimit(frames(0, null), reference, 'low')).toThrow('十分');
    for (const range of [
      { lowPitchHz: NaN, highPitchHz: null }, { lowPitchHz: 240, highPitchHz: null },
      { lowPitchHz: null, highPitchHz: 200 }, { lowPitchHz: 219, highPitchHz: null },
    ]) {
      expect(validPitchRange(range, calibration)).toBe(false);
      expect(mapAudioFeatures(features(), calibration, 'sensitive', range)).toEqual(NEUTRAL_INPUT);
    }
  });

  it('静かな環境でも最低しきい値を設け、雑音には3倍の余裕を加える', () => {
    expect(estimateNoiseFloor(frames(0.0001))).toBe(0.001);
    expect(estimateNoiseFloor(frames(0.005))).toBeCloseTo(0.015);
  });
  it('数回だけの外れ値で雑音レベルが大きくなりすぎない', () => {
    const samples = [...frames(0.001, null, 95), ...frames(0.1, null, 5)];
    expect(estimateNoiseFloor(samples)).toBeCloseTo(0.003);
    expect(samples[0].rms).toBe(0.001);
  });
  it('基準音は中央値で求め、無音・信頼度不足・外れ値を除外する', () => {
    const samples = [
      ...frames(0.05, 219, 10), ...frames(0.05, 221, 10),
      ...frames(0, 900, 30), ...frames(0.05, 0, 30),
      ...frames(0.05, 900, 30).map((sample) => ({ ...sample, clarity: 0.1 })),
    ];
    expect(estimateBasePitch(samples, 0.01)).toBe(220);
    expect(estimateBasePitch([...samples, features({ pitchHz: 880 })], 0.01)).toBe(221);
  });
  it('測定不足や過大な雑音は再測定を促す', () => {
    expect(() => estimateNoiseFloor(frames(0, null, 19))).toThrow('十分');
    expect(() => estimateNoiseFloor(frames(0.5))).toThrow('大きすぎ');
    expect(() => estimateBasePitch(frames(0, null), 0.01)).toThrow('あー');
  });
});

function fakeEngine() {
  const engine = {
    running: false,
    current: features({ onset: true }),
    start: vi.fn(async () => { engine.running = true; }),
    stop: vi.fn(() => { engine.running = false; }),
    read: vi.fn((nowMs: number) => ({ ...engine.current, timeMs: nowMs })),
  };
  return engine;
}

describe('MicInput', () => {
  it('声域を外部変更から守り、停止・再開では保持し、基準音の再調整では解除する', async () => {
    const engine = fakeEngine();
    engine.current.pitchHz = 210;
    const mic = new MicInput(calibration, engine);
    await mic.start();
    mic.read(16);
    const range = { lowPitchHz: 210, highPitchHz: 240 };
    mic.setPitchRange(range);
    range.lowPitchHz = 50;
    mic.pitchRange.highPitchHz = 1000;
    expect(mic.pitchRange).toEqual({ lowPitchHz: 210, highPitchHz: 240 });
    expect(mic.read(16)).toMatchObject({ slope: -1, pulse: false });
    mic.stop(); await mic.start();
    expect(mic.read(32).slope).toBe(-1);
    expect(() => mic.setPitchRange({ lowPitchHz: 230, highPitchHz: null })).toThrow(RangeError);
    expect(mic.pitchRange.lowPitchHz).toBe(210);
    mic.setCalibration({ ...calibration, basePitchHz: 200 });
    expect(mic.pitchRange).toEqual({ lowPitchHz: null, highPitchHz: null });
    expect(mic.read(48).slope).toBe(0); // 新しい基準では標準感度の平坦範囲に戻る。
    mic.stop();
  });
  it('感度変更は同じフレームに反映し、pulseを再発行せず、停止・再開でも保持する', async () => {
    const engine = fakeEngine();
    engine.current.pitchHz = 220 * 2 ** (-0.5 / 12);
    const mic = new MicInput(calibration, engine);
    await mic.start();
    expect(mic.read(16)).toMatchObject({ slope: 0, pulse: true });
    mic.setPitchSensitivity('sensitive');
    expect(mic.read(16).slope).toBeCloseTo(-1 / 7);
    expect(mic.read(16).pulse).toBe(false);
    expect(engine.read).toHaveBeenCalledOnce();
    mic.stop(); await mic.start();
    expect(mic.pitchSensitivity).toBe('sensitive');
    expect(mic.read(32).slope).toBeCloseTo(-1 / 7);
    mic.stop();
  });
  it('開始前は中立、同じ時刻のpulseは一度だけ消費し、HUDの参照では消費しない', async () => {
    const engine = fakeEngine();
    const mic = new MicInput(calibration, engine);
    expect(mic.read(0)).toEqual(NEUTRAL_INPUT);
    await mic.start();
    expect(mic.read(16).pulse).toBe(true);
    expect(mic.debugFeatures()?.onset).toBe(true);
    expect(mic.read(16).pulse).toBe(false);
    expect(engine.read).toHaveBeenCalledOnce();
    engine.current.onset = false;
    expect(mic.read(32).pulse).toBe(false);
    mic.stop();
    expect(mic.debugFeatures()).toBeNull();
    expect(mic.read(48)).toEqual(NEUTRAL_INPUT);
  });
  it('校正値は停止・再開でも保持し、外部の変更を受けない', async () => {
    const engine = fakeEngine();
    const mic = new MicInput(calibration, engine);
    const changed = { basePitchHz: 110, noiseFloorRms: 0.005 };
    mic.setCalibration(changed);
    changed.basePitchHz = 1000;
    mic.calibration.basePitchHz = 2000;
    await mic.start();
    expect(mic.read(0).slope).toBe(1);
    mic.debugFeatures()!.pitchHz = 0;
    expect(mic.debugFeatures()?.pitchHz).toBe(220);
    mic.stop(); mic.stop(); await mic.start();
    expect(mic.calibration.basePitchHz).toBe(110);
    expect(mic.read(16).slope).toBe(1);
    expect(() => mic.setCalibration({ ...calibration, basePitchHz: 0 })).toThrow(RangeError);
    mic.stop();
  });
  it('開始失敗を呼び出し側へ渡す', async () => {
    const engine = fakeEngine();
    engine.start.mockRejectedValueOnce(new MicUnavailableError('denied'));
    const mic = new MicInput(calibration, engine);
    await expect(mic.start()).rejects.toMatchObject({ reason: 'denied' });
    expect(mic.running).toBe(false);
    expect(mic.read(0)).toEqual(NEUTRAL_INPUT);
  });
});

// Issue #3で許可されたテストファイルに、準備画面とマイク解放の回帰検証も置く。
// DOMは最小の模型。レイアウトや実機のマイク許可ダイアログはここでは検証しない。
class Element extends EventTarget {
  children: Element[] = [];
  parent: Element | null = null;
  textContent = '';
  hidden = false;
  disabled = false;
  value: string | number = '';
  style = { cssText: '' };
  constructor(public tag = 'div', public attrs: Record<string, string> = {}) { super(); }
  setAttribute(key: string, value: string) { this.attrs[key] = value; }
  set innerHTML(html: string) {
    this.children = Array.from(html.matchAll(/<([a-z][a-z0-9-]*)([^>]*)>/g), ([, tag, attributes]) => {
      const attrs = Object.fromEntries(Array.from(attributes.matchAll(/([a-z][a-z0-9-]*)(?:="([^"]*)")?/g),
        ([, key, value]) => [key, value ?? '']));
      const child = new Element(tag, attrs); child.parent = this; return child;
    });
  }
  querySelector(selector: string) { return this.children.find((child) => selector.slice(1, -1) in child.attrs) ?? null; }
  append(child: Element) { this.children.push(child); child.parent = this; }
  remove() { if (this.parent) this.parent.children = this.parent.children.filter((child) => child !== this); this.parent = null; }
  replaceChildren() { this.children.forEach((child) => { child.parent = null; }); this.children = []; }
}

function audioEnvironment() {
  const streams: { getTracks(): { readyState: string; stop(): void }[]; getAudioTracks(): { readyState: string; stop(): void }[] }[] = [];
  const makeStream = () => {
    const tracks = Array.from({ length: 2 }, () => ({ readyState: 'live', stop() { this.readyState = 'ended'; } }));
    const stream = { getTracks: () => tracks, getAudioTracks: () => tracks };
    streams.push(stream); return stream;
  };
  let hz: number | null = null;
  let amplitude = 0.2;
  const getUserMedia = vi.fn(async () => makeStream());
  const contexts: Context[] = [];
  class Context {
    state = 'suspended';
    sampleRate = 48000;
    source = { connect: vi.fn(), disconnect: vi.fn() };
    analyser = {
      fftSize: 0, smoothingTimeConstant: 0, disconnect: vi.fn(),
      getFloatTimeDomainData(samples: Float32Array) {
        for (let i = 0; i < samples.length; i++) samples[i] = hz === null ? 0.0001 : amplitude * Math.sin(2 * Math.PI * hz * i / 48000);
      },
    };
    resume = vi.fn(async () => { this.state = 'running'; });
    close = vi.fn(async () => { this.state = 'closed'; });
    createMediaStreamSource = () => this.source;
    createAnalyser = () => this.analyser;
    constructor() { contexts.push(this); }
  }
  vi.stubGlobal('navigator', { mediaDevices: { getUserMedia } });
  vi.stubGlobal('AudioContext', Context);
  vi.stubGlobal('isSecureContext', true);
  vi.stubGlobal('window', new EventTarget());
  vi.stubGlobal('document', { createElement: (tag: string) => new Element(tag) });
  return { getUserMedia, streams, contexts, makeStream,
    setHz: (value: number | null) => { hz = value; },
    setAmplitude: (value: number) => { amplitude = value; } };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('マイク準備画面', () => {
  let scene: MicSetupScene | null = null;
  afterEach(() => { scene?.exit(); scene = null; vi.unstubAllGlobals(); });
  function setup() {
    const env = audioEnvironment();
    const ui = new Element();
    const goTo = vi.fn(() => { scene!.exit(); ui.replaceChildren(); });
    const ctx = { ui, goTo } as unknown as SceneContext;
    scene = new MicSetupScene(); scene.enter(ctx);
    const node = (name: string) => ui.children[0].querySelector(`[data-${name}]`)!;
    const click = (name: string) => { if (!node(name).disabled) node(name).dispatchEvent(new Event('click')); };
    const measure = (from: number) => { for (let time = from; time <= from + 2016; time += 16) scene!.update(0.016, time); };
    return { env, ui, node, click, measure, goTo };
  }

  it.each([[120, -1], [180, 1]])('準備から渡した入力は、声域外の小声%sHzでも最大勾配%sを保つ（#39）', async (hz, slope) => {
    const { env, node, click, measure, goTo } = setup();
    click('allow'); await flush(); click('noise'); measure(0);
    env.setHz(130); click('base'); measure(2100);
    env.setHz(125); click('low'); measure(4200);
    env.setHz(160); click('high'); measure(6300);
    expect(node('floor').value).toBe('0.0010');
    click('play');
    const params = goTo.mock.calls[0] as unknown as ['play', { source: MicInput }];
    const source = params[1].source;
    try {
      env.setHz(hz); env.setAmplitude(0.012); await source.start();
      let input = source.read(8400);
      for (let time = 8416; time <= 8900; time += 16) input = source.read(time);
      expect(source.debugFeatures()?.rms).toBeGreaterThan(0.001);
      expect(source.debugFeatures()?.rms).toBeLessThan(0.01);
      expect(source.debugFeatures()?.pitchHz).toBeCloseTo(hz, 0);
      expect(input).toMatchObject({ slope, active: true, pulse: false });
      // 音が止まったら、平滑化RMSが残っていても坂は即座に止める。
      env.setHz(null); expect(source.read(8916)).toMatchObject({ slope: 0, active: false });
      env.setHz(hz); source.stop(); await source.start();
      expect(source.read(9000)).toMatchObject({ slope, active: true });
      // 測り直した高い雑音しきい値を、同じ時刻のreadにも反映する。
      source.setCalibration({ basePitchHz: 130, noiseFloorRms: 0.02 });
      expect(source.read(9000)).toEqual(NEUTRAL_INPUT);
      expect(source.debugFeatures()?.pitchHz).toBeNull();
    } finally { source.stop(); }
    expect(env.streams.every((stream) => stream.getTracks().every((track) => track.readyState === 'ended'))).toBe(true);
    expect(env.contexts.every((context) => context.state === 'closed')).toBe(true);
  });

  it('雑音を測った後は、小声でも基準音と上下の声域を準備できる（#39）', async () => {
    const { env, node, click, measure } = setup();
    click('allow'); await flush(); click('noise'); measure(0);
    env.setAmplitude(0.012);
    env.setHz(130); click('base'); measure(2100);
    expect(node('reference').value).toContain('130.');
    env.setHz(125); click('low'); measure(4200); scene!.update(0.016, 6250);
    expect(node('response').value).toContain('下り 100%');
    env.setHz(160); click('high'); measure(6300); scene!.update(0.016, 8350);
    expect(node('response').value).toContain('上り 100%');
    expect(node('range').value).toContain('125.');
    expect(node('range').value).toContain('160.');
    expect(node('play').disabled).toBe(false);
  });

  it('低い声と高い声を個別に測り、最大入力をプレビューし、設定をゲームへ引き継ぐ', async () => {
    const { env, node, click, measure, goTo } = setup();
    expect(node('low').disabled).toBe(true);
    click('allow'); await flush(); click('noise'); measure(0);
    env.setHz(130); click('base'); measure(2100);
    expect(node('low').disabled).toBe(false);
    env.setHz(125); click('low');
    expect(node('play').disabled).toBe(true);
    expect(node('high').disabled).toBe(true);
    measure(4200); scene!.update(0.016, 6250);
    expect(node('response').value).toContain('下り 100%');
    expect(node('play').disabled).toBe(false);
    env.setHz(160); click('high'); measure(6300); scene!.update(0.016, 8350);
    expect(node('response').value).toContain('上り 100%');
    expect(node('range').value).toContain('125.');
    expect(node('range').value).toContain('160.');
    click('play');
    const params = goTo.mock.calls[0] as unknown as ['play', { source: MicInput }];
    expect(params[1].source.pitchRange.lowPitchHz).toBeCloseTo(125, 0);
    expect(params[1].source.pitchRange.highPitchHz).toBeCloseTo(160, 0);
    env.setHz(125); await params[1].source.start();
    expect(params[1].source.read(8400).slope).toBeCloseTo(-1);
    params[1].source.stop(); await params[1].source.start();
    expect(params[1].source.read(8500).slope).toBeCloseTo(-1);
    params[1].source.stop();
  });

  it('声域の測定失敗でも開始でき、解除と基準音の測り直しで古い声域を使わない', async () => {
    const { env, node, click, measure } = setup();
    click('allow'); await flush(); click('noise'); measure(0);
    env.setHz(130); click('base'); measure(2100);
    env.setHz(125); click('low'); measure(4200);
    env.setHz(135); click('low'); measure(6300);
    expect(node('status').textContent).toContain('中間の高さ');
    expect(node('play').disabled).toBe(false);
    expect(node('range').value).toContain('125.');
    click('reset-range');
    expect(node('range').value).not.toContain('125.');
    expect(node('reset-range').disabled).toBe(true);
    env.setHz(125); click('low'); measure(8400);
    env.setHz(140); click('base');
    expect(node('low').disabled).toBe(true);
    expect(node('range').value).not.toContain('125.');
    measure(10500);
    expect(node('play').disabled).toBe(false);
  });

  it.each(['low', 'high'])('声域の%s測定中も停止で測定を破棄し、全トラックを解放する', async (direction) => {
    const { env, node, click, measure } = setup();
    click('allow'); await flush(); click('noise'); measure(0);
    env.setHz(130); click('base'); measure(2100);
    env.setHz(direction === 'low' ? 125 : 160); click(direction);
    scene!.update(0.016, 4200);
    expect(node('progress').hidden).toBe(false);
    click('stop'); measure(4300);
    expect(node('progress').hidden).toBe(true);
    expect(node('play').disabled).toBe(true);
    expect(node('reference').value).toBe('未測定');
    expect(env.streams.every((stream) => stream.getTracks().every((track) => track.readyState === 'ended'))).toBe(true);
  });

  it('狭い声域をプレビューして感度を切り替えられ、ゲームにも選んだ感度を渡す', async () => {
    const { env, node, click, measure, goTo } = setup();
    expect(node('sensitivity').value).toBe('sensitive');
    click('allow'); await flush(); click('noise'); measure(0);
    env.setHz(130); click('base'); measure(2100);
    env.setHz(125); scene!.update(0.016, 4200);
    expect(node('response').value).toContain('下り');
    expect(node('response').value).toContain('半音');
    node('sensitivity').value = 'standard'; node('sensitivity').dispatchEvent(new Event('change'));
    scene!.update(0.016, 4216);
    expect(node('response').value).toContain('平坦 0%');
    node('sensitivity').value = 'sensitive'; node('sensitivity').dispatchEvent(new Event('change'));
    env.setHz(135); scene!.update(0.016, 4232);
    expect(node('response').value).toContain('上り');
    env.setHz(null); scene!.update(0.016, 4248);
    expect(node('response').value).toContain('音程を検出できません');
    for (let time = 4264; time < 6000; time += 16) scene!.update(0.016, time);
    expect(node('response').value).toContain('声が小さい・無音');
    click('play');
    const params = goTo.mock.calls[0] as unknown as ['play', { source: MicInput }];
    expect(params[1].source.pitchSensitivity).toBe('sensitive');
    env.setHz(125); await params[1].source.start();
    expect(params[1].source.read(6100).slope).toBeLessThan(-0.2);
    params[1].source.stop();
  });

  it('測定順を守り、補正した同じMicInputでplayへ移る。準備用のマイクはexitで止める', async () => {
    const { env, node, click, measure, goTo } = setup();
    expect(node('noise').disabled).toBe(true); expect(node('play').disabled).toBe(true);
    click('allow'); await flush();
    expect(node('noise').disabled).toBe(false); expect(node('base').disabled).toBe(true);
    click('noise'); measure(0);
    expect(node('floor').value).toBe('0.0010'); expect(node('base').disabled).toBe(false);
    env.setHz(220); click('base'); measure(2100);
    expect(node('play').disabled).toBe(false);
    click('play');
    expect(goTo).toHaveBeenCalledOnce();
    const params = goTo.mock.calls[0] as unknown as ['play', { source: MicInput }];
    expect(params[0]).toBe('play');
    expect(params[1].source.calibration.basePitchHz).toBeCloseTo(220, 0);
    expect(params[1].source.calibration.noiseFloorRms).toBe(0.001);
    for (const stream of env.streams) for (const track of stream.getTracks()) expect(track.readyState).toBe('ended');
    env.setHz(440); await params[1].source.start();
    expect(params[1].source.read(5000).slope).toBe(1);
    params[1].source.stop();
  });

  it.each(['denied', 'not-found', 'unsupported', 'insecure', 'unknown'] as const)('%sでもキーボードに切り替えられる', async (reason) => {
    const { env, node, click, goTo } = setup();
    if (reason === 'unsupported') vi.stubGlobal('AudioContext', undefined);
    else if (reason === 'insecure') vi.stubGlobal('isSecureContext', false);
    else env.getUserMedia.mockRejectedValueOnce(new MicUnavailableError(reason));
    click('allow'); await flush();
    expect(node('status').textContent).toContain('キーボード');
    expect(node('allow').disabled).toBe(false);
    click('keyboard');
    const call = goTo.mock.calls[0] as unknown as ['play', { source: { kind: string } }];
    expect(call[0]).toBe('play'); expect(call[1].source.kind).toBe('keyboard');
    expect(env.contexts.every((context) => context.state === 'closed')).toBe(true);
  });

  it.each(['title', 'escape', 'hidden', 'stop', 'keyboard'])('許可待ち中の%sでも、後から届いた全トラックを止める', async (action) => {
    const { env, ui, click } = setup();
    let resolve!: (stream: ReturnType<typeof env.makeStream>) => void;
    env.getUserMedia.mockReturnValueOnce(new Promise((done) => { resolve = done; }));
    click('allow');
    if (action === 'escape') scene!.onKeyDown({ code: 'Escape', repeat: false, preventDefault() {} } as KeyboardEvent);
    else if (action === 'hidden') scene!.onHidden();
    else click(action);
    const stream = env.makeStream(); resolve(stream); await flush();
    for (const track of stream.getTracks()) expect(track.readyState).toBe('ended');
    expect(env.contexts[0].state).toBe('closed');
    expect(ui.children.length).toBe(action === 'hidden' || action === 'stop' ? 1 : 0);
  });

  it('開始連打は1回だけ。停止後に新しく開始しても古い許可待ちが画面を壊さない', async () => {
    const { env, node, click } = setup();
    let resolve!: (stream: ReturnType<typeof env.makeStream>) => void;
    env.getUserMedia.mockReturnValueOnce(new Promise((done) => { resolve = done; }));
    click('allow'); node('allow').dispatchEvent(new Event('click'));
    expect(env.getUserMedia).toHaveBeenCalledOnce();
    click('stop'); click('allow'); await flush();
    const fresh = env.streams[0];
    const old = env.makeStream(); resolve(old); await flush();
    expect(node('noise').disabled).toBe(false);
    expect(fresh.getTracks().every((track) => track.readyState === 'live')).toBe(true);
    expect(old.getTracks().every((track) => track.readyState === 'ended')).toBe(true);
  });

  it('基準音の測定不足は再測定でき、雑音の測り直しは古い基準音を無効にする', async () => {
    const { env, node, click, measure } = setup();
    click('allow'); await flush(); click('noise'); measure(0);
    click('base'); measure(2100);
    expect(node('status').textContent).toContain('十分'); expect(node('play').disabled).toBe(true);
    expect(node('base').disabled).toBe(false);
    env.setHz(220); click('base'); measure(4200);
    expect(node('play').disabled).toBe(false);
    env.setHz(null); click('noise'); measure(6300);
    expect(node('play').disabled).toBe(true); expect(node('reference').value).toBe('未測定');
  });

  it('準備画面とタイトルを10往復してもDOMと音声トラックが残らない', async () => {
    const { env, ui, click } = setup();
    for (let i = 0; i < 10; i++) {
      click('allow'); await flush();
      click('title');
      expect(ui.children).toHaveLength(0);
      expect(env.streams.every((stream) => stream.getTracks().every((track) => track.readyState === 'ended'))).toBe(true);
      scene = new MicSetupScene();
      scene.enter({ ui, goTo: () => { scene!.exit(); ui.replaceChildren(); } } as unknown as SceneContext);
      expect(ui.children).toHaveLength(1);
    }
  });

  it('実際のPlaySceneとMicInputでも許可待ち中のポーズ・再開連打後にトラックが残らない', async () => {
    const env = audioEnvironment();
    const mic = new MicInput();
    let resolve!: (stream: ReturnType<typeof env.makeStream>) => void;
    env.getUserMedia.mockReturnValueOnce(new Promise((done) => { resolve = done; }));
    const ui = new Element();
    const play = new PlayScene();
    play.enter({ ui, goTo: vi.fn() } as unknown as SceneContext, { source: mic });
    try {
      for (let i = 0; i < 6; i++) play.onKeyDown({ code: 'Escape', preventDefault() {} } as KeyboardEvent);
      expect(env.getUserMedia).toHaveBeenCalledOnce();
      const old = env.makeStream(); resolve(old); await flush();
      expect(old.getTracks().every((track) => track.readyState === 'ended')).toBe(true);
      expect(env.getUserMedia).toHaveBeenCalledTimes(2);
      expect(mic.running).toBe(true);
      expect(env.streams.filter((stream) => stream.getTracks().some((track) => track.readyState === 'live'))).toHaveLength(1);
      play.onHidden(); expect(mic.running).toBe(false);
      play.resume(); await flush(); expect(mic.running).toBe(true);
    } finally { play.exit(); }
    expect(env.streams.every((stream) => stream.getTracks().every((track) => track.readyState === 'ended'))).toBe(true);
    expect(env.contexts.every((context) => context.state === 'closed')).toBe(true);
  });
});
