import { PitchDetector } from 'pitchy';
import type { AudioFeatures, MicErrorReason } from '../../core/types';
import { MicUnavailableError } from '../../core/types';
import { extractFeatures, INITIAL_FEATURE_STATE } from './features';
import type { FeatureState } from './features';

const BUFFER_SIZE = 2048;

interface AudioSession {
  stream: MediaStream;
  source: MediaStreamAudioSourceNode;
  analyser: AnalyserNode;
  samples: Float32Array<ArrayBuffer>;
  detector: PitchDetector<Float32Array>;
  featuresState: Readonly<FeatureState>;
}

const ERROR_MESSAGES: Record<MicErrorReason, string> = {
  denied: 'マイクの利用が許可されませんでした。キーボード操作も利用できます。',
  'not-found': '利用できるマイクが見つかりませんでした。接続を確認してください。',
  unsupported: 'このブラウザはマイク解析に対応していません。ChromeまたはEdgeでお試しください。',
  insecure: 'マイクはHTTPSまたはlocalhostで開いたページから利用してください。',
  unknown: 'マイクを開始できませんでした。接続や、ほかのアプリでの使用状況を確認してください。',
};

function micError(error: unknown): MicUnavailableError {
  if (error instanceof MicUnavailableError) return error;
  const name = error instanceof Error ? error.name : '';
  const reason: MicErrorReason = name === 'NotAllowedError' || name === 'SecurityError' ? 'denied'
    : name === 'NotFoundError' ? 'not-found' : 'unknown';
  return new MicUnavailableError(reason, ERROR_MESSAGES[reason]);
}

/** マイクの取得・解放だけを管理する。録音・外部送信・独自の更新ループは作らない。 */
export class AudioEngine {
  private context: AudioContext | null = null;
  private session: AudioSession | null = null;
  private openingStream: MediaStream | null = null;
  private pending: Promise<void> | null = null;
  private generation = 0;
  private readonly closingContexts = new WeakSet<AudioContext>();

  get running(): boolean {
    return this.session !== null && this.context?.state === 'running';
  }

  get sampleRate(): number | null {
    return this.running ? this.context!.sampleRate : null;
  }

  start(): Promise<void> {
    if (this.running) return Promise.resolve();
    if (this.pending) return this.pending;
    if (this.context || this.session) this.stop();
    const generation = this.generation;
    const pending = this.open(generation).finally(() => {
      if (this.pending === pending) this.pending = null;
    });
    this.pending = pending;
    return pending;
  }

  private async open(generation: number): Promise<void> {
    let context: AudioContext | null = null;
    let stream: MediaStream | null = null;
    try {
      if (globalThis.isSecureContext === false) {
        throw new MicUnavailableError('insecure', ERROR_MESSAGES.insecure);
      }
      if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia
        || typeof AudioContext === 'undefined') {
        throw new MicUnavailableError('unsupported', ERROR_MESSAGES.unsupported);
      }
      context = new AudioContext();
      this.context = context;
      // クリック直後に resume を呼ぶ。許可待ちの間に停止した場合の拒否も処理する。
      const resumed = context.resume();
      void resumed.catch(() => {});
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
      });
      if (generation !== this.generation) {
        this.release(stream, context);
        return;
      }
      this.openingStream = stream;
      await resumed;
      if (generation !== this.generation) {
        this.release(stream, context);
        return;
      }
      const source = context.createMediaStreamSource(stream);
      const analyser = context.createAnalyser();
      analyser.fftSize = BUFFER_SIZE;
      analyser.smoothingTimeConstant = 0;
      // destination にはつながず、入力音声をスピーカーへ再生しない。
      source.connect(analyser);
      this.session = {
        stream, source, analyser,
        samples: new Float32Array(BUFFER_SIZE),
        detector: PitchDetector.forFloat32Array(BUFFER_SIZE),
        featuresState: INITIAL_FEATURE_STATE,
      };
      this.openingStream = null;
    } catch (error) {
      this.release(stream, context);
      if (generation !== this.generation) return;
      this.stop();
      throw micError(error);
    }
  }

  /** 許可待ちも無効化し、後から取得された stream は open() 側で即時停止する。 */
  stop(): void {
    this.generation++;
    this.pending = null;
    this.session?.source.disconnect();
    this.session?.analyser.disconnect();
    this.release(this.session?.stream ?? this.openingStream, this.context);
    this.session = null;
    this.openingStream = null;
    this.context = null;
  }

  read(nowMs: number): AudioFeatures | null {
    const session = this.session;
    if (!this.running || !session || !this.context) return null;
    if (!session.stream.getAudioTracks().some((track) => track.readyState === 'live')) {
      this.stop();
      return null;
    }
    session.analyser.getFloatTimeDomainData(session.samples);
    const result = extractFeatures(session.samples, this.context.sampleRate, nowMs,
      session.featuresState, session.detector);
    session.featuresState = result.state;
    return result.features;
  }

  private release(stream: MediaStream | null, context: AudioContext | null): void {
    stream?.getTracks().forEach((track) => track.stop());
    if (context && context.state !== 'closed' && !this.closingContexts.has(context)) {
      this.closingContexts.add(context);
      void context.close().catch(() => {});
    }
  }
}
