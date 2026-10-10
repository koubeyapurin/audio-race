import { afterEach, describe, expect, it, vi } from 'vitest';
import { AudioEngine } from './audioEngine';
import { extractFeatures, FEATURE_SETTINGS, INITIAL_FEATURE_STATE } from './features';
import type { PitchEstimator } from './features';

const SAMPLE_RATE = 44100;
const SIZE = 2048;
const noPitch: PitchEstimator = { findPitch: () => [0, 0] };

function sine(hz = 440, amplitude = 0.2, rate = SAMPLE_RATE): Float32Array {
  return Float32Array.from({ length: SIZE }, (_, i) => amplitude * Math.sin(2 * Math.PI * hz * i / rate));
}

describe('extractFeatures', () => {
  it.each([
    { hz: 110, rate: 44100 }, { hz: 220, rate: 44100 }, { hz: 440, rate: 44100 },
    { hz: 880, rate: 44100 }, { hz: 440, rate: 48000 },
  ])('$rate Hz のサンプルから $hz Hz を誤差5%以内で推定する', ({ hz, rate }) => {
    const { features } = extractFeatures(sine(hz, 0.2, rate), rate, 0);
    expect(features.pitchHz).not.toBeNull();
    expect(Math.abs(features.pitchHz! - hz) / hz).toBeLessThanOrEqual(0.05);
    expect(features.clarity).toBeGreaterThanOrEqual(FEATURE_SETTINGS.minClarity);
  });

  it('無音が続いても pitch や onset が出ない', () => {
    let state = INITIAL_FEATURE_STATE;
    for (let i = 0; i < 100; i++) {
      const result = extractFeatures(new Float32Array(SIZE), SAMPLE_RATE, i * 16, state);
      expect(result.features).toEqual({ timeMs: i * 16, rms: 0, pitchHz: null, clarity: 0, onset: false });
      state = result.state;
    }
  });

  it('小さな声と低い信頼度の pitch を無効にする', () => {
    expect(extractFeatures(sine(440, 0.001), SAMPLE_RATE, 0).features.pitchHz).toBeNull();
    const uncertain: PitchEstimator = { findPitch: () => [440, 0.2] };
    const result = extractFeatures(sine(), SAMPLE_RATE, 0, INITIAL_FEATURE_STATE, uncertain);
    expect(result.features.pitchHz).toBeNull();
    expect(result.features.clarity).toBe(0.2);
  });

  it('雑音から信頼できない pitch を返さない', () => {
    let seed = 12345;
    const noise = Float32Array.from({ length: SIZE }, () => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return (seed / 0xffffffff * 2 - 1) * 0.2;
    });
    expect(extractFeatures(noise, SAMPLE_RATE, 0).features.pitchHz).toBeNull();
  });

  it('RMS を経過時間に応じて平滑化し、更新頻度が変わっても同じ値になる', () => {
    const quiet = extractFeatures(new Float32Array(SIZE), SAMPLE_RATE, 0).state;
    const wave = new Float32Array(SIZE).fill(0.2);
    const single = extractFeatures(wave, SAMPLE_RATE, 80, quiet, noPitch);
    expect(single.features.rms).toBeCloseTo(0.2 * (1 - Math.exp(-1)), 7);
    let state = quiet;
    for (let time = 8; time <= 80; time += 8) state = extractFeatures(wave, SAMPLE_RATE, time, state, noPitch).state;
    expect(state.rms).toBeCloseTo(single.features.rms, 10);
    expect(state.rms).toBeLessThan(state.rawRms);
  });

  it('音を止めると RMS の減衰中でも pitch はすぐ無効になる', () => {
    const voiced = extractFeatures(sine(), SAMPLE_RATE, 0);
    const quiet = extractFeatures(new Float32Array(SIZE), SAMPLE_RATE, 16, voiced.state);
    expect(quiet.features.rms).toBeGreaterThan(0);
    expect(quiet.features.pitchHz).toBeNull();
    expect(quiet.features.onset).toBe(false);
  });

  it('立ち上がりは一度検出し、クールダウン後に再検出する', () => {
    const wave = sine();
    const quiet = new Float32Array(SIZE);
    const first = extractFeatures(wave, SAMPLE_RATE, 0);
    expect(first.features.onset).toBe(true);
    const held = extractFeatures(wave, SAMPLE_RATE, 20, first.state);
    expect(held.features.onset).toBe(false);
    const gap = extractFeatures(quiet, SAMPLE_RATE, 50, held.state);
    const tooSoon = extractFeatures(wave, SAMPLE_RATE, 100, gap.state);
    expect(tooSoon.features.onset).toBe(false);
    const gap2 = extractFeatures(quiet, SAMPLE_RATE, 130, tooSoon.state);
    expect(extractFeatures(wave, SAMPLE_RATE, 150, gap2.state).features.onset).toBe(true);
  });

  it.each([0.03, 0.06, 0.1])('RMS %s まで80msかけて立ち上がる短い発声を5回検出する', (peakRms) => {
    let state = INITIAL_FEATURE_STATE;
    let hits = 0;
    for (let time = 0; time < 2000; time += 16) {
      const phase = time % 400;
      const envelope = phase < 80 ? phase / 80 : phase < 160 ? 1
        : phase < 240 ? (240 - phase) / 80 : 0;
      const result = extractFeatures(sine(160, peakRms * Math.SQRT2 * envelope, 48000), 48000, time, state);
      hits += Number(result.features.onset);
      state = result.state;
    }
    expect(hits).toBe(5);
  });

  it('大きな声の平滑化が追いつく前でも、伸ばした発声を再検出しない', () => {
    let state = INITIAL_FEATURE_STATE;
    let hits = 0;
    for (let time = 0; time < 1000; time += 16) {
      const result = extractFeatures(sine(160, 0.8), SAMPLE_RATE, time, state);
      hits += Number(result.features.onset);
      state = result.state;
    }
    expect(hits).toBe(1);
  });

  it('波形と前の状態を変更せず、同じ入力には同じ結果を返す', () => {
    const wave = sine();
    const before = wave.slice();
    const first = extractFeatures(wave, SAMPLE_RATE, 16, INITIAL_FEATURE_STATE);
    expect(extractFeatures(wave, SAMPLE_RATE, 16, INITIAL_FEATURE_STATE)).toEqual(first);
    expect(wave).toEqual(before);
    expect(INITIAL_FEATURE_STATE).toEqual({ timeMs: null, rms: 0, rawRms: 0, lastOnsetMs: null, onsetArmed: true });
    expect(first.state).not.toBe(INITIAL_FEATURE_STATE);
  });

  it('空や非数値の波形、無効な推定値を安全に扱う', () => {
    for (const wave of [new Float32Array(), new Float32Array([NaN, Infinity])]) {
      expect(extractFeatures(wave, SAMPLE_RATE, 0).features).toMatchObject({ rms: 0, pitchHz: null, onset: false });
    }
    for (const pitch of [NaN, Infinity, 20, 2000]) {
      const detector: PitchEstimator = { findPitch: () => [pitch, 0.99] };
      expect(extractFeatures(sine(), SAMPLE_RATE, 0, INITIAL_FEATURE_STATE, detector).features.pitchHz).toBeNull();
    }
    expect(() => extractFeatures(sine(), 0, 0)).toThrow(RangeError);
    expect(() => extractFeatures(sine(), SAMPLE_RATE, NaN)).toThrow(RangeError);
  });
});

function fakeStream() {
  const tracks = Array.from({ length: 2 }, () => {
    const track = { readyState: 'live', stop: vi.fn(() => { track.readyState = 'ended'; }) };
    return track;
  });
  return { getTracks: () => tracks, getAudioTracks: () => tracks };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

function audioEnvironment() {
  const stream = fakeStream();
  const getUserMedia = vi.fn(async () => stream);
  const contexts: FakeContext[] = [];
  class FakeContext {
    state = 'suspended';
    sampleRate = SAMPLE_RATE;
    source = { connect: vi.fn(), disconnect: vi.fn() };
    analyser = {
      fftSize: 0, smoothingTimeConstant: 1,
      getFloatTimeDomainData: vi.fn((samples: Float32Array) => samples.set(sine())),
      disconnect: vi.fn(),
    };
    resume = vi.fn(async () => { this.state = 'running'; });
    close = vi.fn(async () => { this.state = 'closed'; });
    createMediaStreamSource = vi.fn(() => this.source);
    createAnalyser = vi.fn(() => this.analyser);
    constructor() { contexts.push(this); }
  }
  vi.stubGlobal('navigator', { mediaDevices: { getUserMedia } });
  vi.stubGlobal('AudioContext', FakeContext);
  vi.stubGlobal('isSecureContext', true);
  return { stream, getUserMedia, contexts };
}

// Issue #2 で許可されたテストファイルに、マイク解放の回帰テストも置く。
describe('AudioEngine のライフサイクル', () => {
  let engine: AudioEngine | null = null;
  afterEach(() => {
    engine?.stop();
    engine = null;
    vi.unstubAllGlobals();
  });

  it('前処理を無効化して取得し、実際の解析器へ波形を渡す', async () => {
    const env = audioEnvironment();
    engine = new AudioEngine();
    expect(engine.read(0)).toBeNull();
    await engine.start();
    expect(env.getUserMedia).toHaveBeenCalledWith({
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
    });
    expect(engine.running).toBe(true);
    expect(engine.sampleRate).toBe(SAMPLE_RATE);
    expect(engine.read(0)?.pitchHz).toBeCloseTo(440, 0);
    expect(env.contexts[0].source.connect).toHaveBeenCalledOnce();
    expect(env.contexts[0].source.connect).toHaveBeenCalledWith(env.contexts[0].analyser);
  });

  it('二重開始しても取得は一度で、stop は全トラックと context を解放する', async () => {
    const env = audioEnvironment();
    engine = new AudioEngine();
    engine.stop();
    await Promise.all([engine.start(), engine.start()]);
    await engine.start();
    expect(env.getUserMedia).toHaveBeenCalledOnce();
    engine.stop();
    engine.stop();
    for (const track of env.stream.getTracks()) expect(track.stop).toHaveBeenCalledOnce();
    expect(env.contexts[0].close).toHaveBeenCalledOnce();
    expect(engine.running).toBe(false);
    expect(engine.sampleRate).toBeNull();
    expect(engine.read(1)).toBeNull();
  });

  it('停止後も新しい stream で再開始できる', async () => {
    const env = audioEnvironment();
    engine = new AudioEngine();
    await engine.start();
    engine.stop();
    const nextStream = fakeStream();
    env.getUserMedia.mockResolvedValueOnce(nextStream);
    await engine.start();
    expect(engine.running).toBe(true);
    expect(env.getUserMedia).toHaveBeenCalledTimes(2);
    expect(engine.read(2)?.pitchHz).not.toBeNull();
    engine.stop();
    for (const track of nextStream.getTracks()) expect(track.readyState).toBe('ended');
  });

  it('許可待ちで停止すると、後から取得した stream も直ちに止める', async () => {
    const env = audioEnvironment();
    const permission = deferred<typeof env.stream>();
    env.getUserMedia.mockReturnValueOnce(permission.promise);
    engine = new AudioEngine();
    const starting = engine.start();
    engine.stop();
    permission.resolve(env.stream);
    await starting;
    expect(engine.running).toBe(false);
    for (const track of env.stream.getTracks()) expect(track.readyState).toBe('ended');
    expect(env.contexts[0].close).toHaveBeenCalledOnce();
  });

  it('古い許可待ちの完了が、停止後に開始した新しいマイクを壊さない', async () => {
    const env = audioEnvironment();
    const permission = deferred<typeof env.stream>();
    env.getUserMedia.mockReturnValueOnce(permission.promise);
    engine = new AudioEngine();
    const oldStart = engine.start();
    engine.stop();
    const fresh = fakeStream();
    env.getUserMedia.mockResolvedValueOnce(fresh);
    await engine.start();
    permission.resolve(env.stream);
    await oldStart;
    expect(engine.running).toBe(true);
    for (const track of env.stream.getTracks()) expect(track.readyState).toBe('ended');
    for (const track of fresh.getTracks()) expect(track.readyState).toBe('live');
    expect(engine.read(10)?.pitchHz).not.toBeNull();
  });

  it('取得済みでも context の再開待ちなら stop で即座に全トラックを止める', async () => {
    const env = audioEnvironment();
    const resumed = deferred<void>();
    const Context = globalThis.AudioContext;
    vi.stubGlobal('AudioContext', class extends Context {
      constructor() {
        super();
        this.resume = vi.fn(() => resumed.promise);
      }
    });
    engine = new AudioEngine();
    const starting = engine.start();
    await Promise.resolve();
    engine.stop();
    for (const track of env.stream.getTracks()) expect(track.readyState).toBe('ended');
    resumed.resolve();
    await starting;
    expect(engine.running).toBe(false);
    expect(env.contexts[0].close).toHaveBeenCalledOnce();
  });

  it('context の再開失敗でも取得済みのマイクを残さない', async () => {
    const env = audioEnvironment();
    const Context = globalThis.AudioContext;
    vi.stubGlobal('AudioContext', class extends Context {
      constructor() {
        super();
        this.resume = vi.fn(async () => { throw new Error('resume failed'); });
      }
    });
    engine = new AudioEngine();
    await expect(engine.start()).rejects.toMatchObject({ reason: 'unknown' });
    for (const track of env.stream.getTracks()) expect(track.readyState).toBe('ended');
    expect(env.contexts[0].close).toHaveBeenCalledOnce();
    expect(engine.running).toBe(false);
  });

  it.each([
    { name: 'NotAllowedError', reason: 'denied' },
    { name: 'NotFoundError', reason: 'not-found' },
    { name: 'NotReadableError', reason: 'unknown' },
  ])('$name を $reason に変換し、context を残さない', async ({ name, reason }) => {
    const env = audioEnvironment();
    const error = new Error('test');
    error.name = name;
    env.getUserMedia.mockRejectedValueOnce(error);
    engine = new AudioEngine();
    await expect(engine.start()).rejects.toMatchObject({ name: 'MicUnavailableError', reason });
    expect(engine.running).toBe(false);
    expect(env.contexts[0].close).toHaveBeenCalledOnce();
  });

  it('非対応と安全でないページではマイクを取得しない', async () => {
    const env = audioEnvironment();
    engine = new AudioEngine();
    vi.stubGlobal('isSecureContext', false);
    await expect(engine.start()).rejects.toMatchObject({ reason: 'insecure' });
    vi.stubGlobal('isSecureContext', true);
    vi.stubGlobal('AudioContext', undefined);
    await expect(engine.start()).rejects.toMatchObject({ reason: 'unsupported' });
    expect(env.getUserMedia).not.toHaveBeenCalled();
    expect(env.contexts).toHaveLength(0);
  });

  it('取得後の初期化失敗でも音声トラックを残さない', async () => {
    const env = audioEnvironment();
    engine = new AudioEngine();
    const starting = engine.start();
    env.contexts[0].createAnalyser.mockImplementationOnce(() => { throw new Error('analyser failed'); });
    await expect(starting).rejects.toMatchObject({ reason: 'unknown' });
    for (const track of env.stream.getTracks()) expect(track.readyState).toBe('ended');
    expect(env.contexts[0].close).toHaveBeenCalledOnce();
  });

  it('マイクが切断されたら read で停止を検知し context も閉じる', async () => {
    const env = audioEnvironment();
    engine = new AudioEngine();
    await engine.start();
    for (const track of env.stream.getTracks()) track.stop();
    expect(engine.read(0)).toBeNull();
    expect(engine.running).toBe(false);
    expect(env.contexts[0].close).toHaveBeenCalledOnce();
  });

  it('context が中断された後の start でも、古い stream を先に解放する', async () => {
    const env = audioEnvironment();
    engine = new AudioEngine();
    await engine.start();
    env.contexts[0].state = 'suspended';
    const fresh = fakeStream();
    env.getUserMedia.mockResolvedValueOnce(fresh);
    await engine.start();
    expect(engine.running).toBe(true);
    for (const track of env.stream.getTracks()) expect(track.readyState).toBe('ended');
    expect(env.contexts[0].close).toHaveBeenCalledOnce();
  });
});
