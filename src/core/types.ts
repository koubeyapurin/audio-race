/**
 * モジュール間の「契約」。ここを変更するときは `contract:` で始まる小さなPRに分け、
 * 相手の承認を得てからマージすること（docs/DEVELOPMENT.md 参照）。
 *
 * 座標系（ワールド座標）: x は右向き(px)、y は上向き(px, 地面の基準線からの高さ)。
 * 画面への変換（y反転・カメラ）は render 側だけが行う。
 */

export interface Vec2 {
  x: number;
  y: number;
}

// ───────────── 入力（レーンA が実装 / レーンB が利用）─────────────

/** マイク・キーボード共通の、正規化された操作入力。毎フレーム InputSource.read() で得る。 */
export interface ControlInput {
  /** -1..1。+ で上り坂、- で下り坂（声の高さ / ↑↓）。 */
  slope: number;
  /** 0..1。変化の強さ（声の大きさ / ←→・W/S）。 */
  intensity: number;
  /** この read() の間にリズム入力（onset / Space）が1回以上あったら true。読んだら消費される。 */
  pulse: boolean;
  /** 有効な入力があるか。false（無音・認識失敗）のとき地形は徐々に平坦へ戻る。 */
  active: boolean;
}

export const NEUTRAL_INPUT: Readonly<ControlInput> = Object.freeze({
  slope: 0,
  intensity: 0,
  pulse: false,
  active: false,
});

export type InputKind = 'mic' | 'keyboard';

/**
 * 入力源。play シーンが enter で start()、exit / ポーズで stop() を呼ぶ。
 * - start() は stop() の後に何度でも再呼び出しできること（リトライ・ポーズ解除）。
 * - stop() は冪等。マイクの場合は全 MediaStreamTrack を stop() し AudioContext を閉じる/停止する。
 */
export interface InputSource {
  readonly kind: InputKind;
  start(): Promise<void>;
  stop(): void;
  read(nowMs: number): ControlInput;
  /** HUD 表示用。マイクなら直近の特徴量、キーボードなら null。 */
  debugFeatures(): AudioFeatures | null;
}

/** マイクから1フレームごとに抽出する特徴量。 */
export interface AudioFeatures {
  timeMs: number;
  /** 0..1 程度の RMS（平滑化後）。 */
  rms: number;
  /** 推定ピッチ。無音・信頼度不足なら null。 */
  pitchHz: number | null;
  /** 0..1 ピッチ推定の信頼度。 */
  clarity: number;
  /** このフレームで発声の立ち上がりを検出したか。 */
  onset: boolean;
}

/** マイク準備画面で決める個人差の補正値。 */
export interface Calibration {
  /** 「あー」の基準音。これより高ければ上り、低ければ下り。 */
  basePitchHz: number;
  /** 環境雑音の RMS。これ以下は無音扱い。 */
  noiseFloorRms: number;
}

export type MicErrorReason = 'denied' | 'not-found' | 'unsupported' | 'insecure' | 'unknown';

export class MicUnavailableError extends Error {
  constructor(public readonly reason: MicErrorReason, message?: string) {
    super(message ?? `microphone unavailable: ${reason}`);
    this.name = 'MicUnavailableError';
  }
}

// ───────────── 地形（レーンB）─────────────

export interface Terrain {
  /** ここまで生成済み（固定済み）の x。 */
  readonly generatedUntil: number;
  /** frontierX まで入力に応じて地形を生成する。生成済み部分は変えない。 */
  advance(input: ControlInput, frontierX: number, dtSec: number): void;
  /** 生成済み範囲の地面の高さ。範囲外は端の値。 */
  heightAt(x: number): number;
  /** 描画用の点列（x0..x1）。 */
  points(x0: number, x1: number): Vec2[];
}

// ───────────── ゲーム進行（レーンB）─────────────

export interface StageItem {
  id: string;
  kind: 'note' | 'obstacle';
  /** 中心座標（ワールド）。 */
  x: number;
  y: number;
  w: number;
  h: number;
}

export type GamePhase = 'countdown' | 'running' | 'paused' | 'cleared' | 'gameover';

export interface GameState {
  phase: GamePhase;
  elapsedSec: number;
  runner: Vec2;
  lives: number;
  score: number;
  notesCollected: number;
  invulnerableUntilSec: number;
  collectedIds: ReadonlySet<string>;
}

export type GameEvent =
  | { type: 'collect'; itemId: string }
  | { type: 'hit'; itemId: string; livesLeft: number }
  | { type: 'clear' }
  | { type: 'gameover' };

/** play → result に渡す結果。 */
export interface GameResult {
  outcome: 'clear' | 'gameover';
  score: number;
  notesCollected: number;
  notesTotal: number;
}

/** HUD（レーンA の render/hud.ts）に play シーンが毎フレーム渡す表示用データ。 */
export interface HudModel {
  mode: InputKind;
  score: number;
  lives: number;
  /** 0..1 ゴールまでの進捗。 */
  progress: number;
  remainingSec: number;
  input: ControlInput;
  features: AudioFeatures | null;
}

// ───────────── シーン（main.ts が管理）─────────────

export type SceneName = 'title' | 'micSetup' | 'play' | 'result';

export interface SceneParams {
  title: undefined;
  micSetup: undefined;
  play: { source: InputSource };
  result: { result: GameResult; source: InputSource };
}

export interface SceneContext {
  canvas: HTMLCanvasElement;
  g: CanvasRenderingContext2D;
  /** シーン用の DOM レイヤ。シーン切替時に main.ts が空にする。 */
  ui: HTMLElement;
  goTo<N extends SceneName>(name: N, params: SceneParams[N]): void;
}

export interface Scene<N extends SceneName = SceneName> {
  enter(ctx: SceneContext, params: SceneParams[N]): void;
  update(dtSec: number, nowMs: number): void;
  render(g: CanvasRenderingContext2D): void;
  exit(): void;
  onKeyDown?(e: KeyboardEvent): void;
  /** タブが非表示になったとき（play はポーズに入る）。 */
  onHidden?(): void;
}
