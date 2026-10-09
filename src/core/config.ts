/** 調整用の定数。値の変更は誰が行ってもよいが、キーの追加・削除は contract PR で。 */
export const VIEW = { width: 1280, height: 720 } as const;

export const GAME = {
  runSpeed: 300, // px/s
  durationSec: 60,
  countdownSec: 3,
  lives: 3,
  invulnerableSec: 1.2,
  notePoints: 100,
  clearBonus: 300,
  /** ランナーの画面上の x 位置。 */
  runnerScreenX: 320,
  runnerRadius: 18,
} as const;

export const TERRAIN = {
  /** ランナーの何秒先まで地形を生成するか。 */
  lookaheadSec: 1.5,
  sampleStep: 8, // px
  baseHeight: 260,
  minHeight: 80,
  maxHeight: 560,
  /** |dy/dx| の上限。 */
  maxSlope: 0.9,
  /** 1px あたりの傾き変化の上限（急変防止）。 */
  maxSlopeChangePerPx: 0.006,
  /** 無音時に平坦へ戻る速さ（1px あたりの減衰率）。 */
  flattenPerPx: 0.004,
  pulseHeight: 60,
  pulseWidth: 160,
} as const;

export const STAGE_LENGTH = GAME.runSpeed * GAME.durationSec;
