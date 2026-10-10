import type { StageItem } from '../core/types';
import { GAME, STAGE_LENGTH, VIEW } from '../core/config';

/** スタート地点の x（左側に少し地面を見せる）。 */
export const START_X = GAME.runnerScreenX;
export const GOAL_X = START_X + STAGE_LENGTH;

const NOTE_SIZE = 44;
const OBSTACLE_W = 56;

/**
 * 固定ステージ。時刻 t（走り始めてからの秒）で位置を書く。
 * - note: 高さ y に浮かぶ音符。地面をその高さに合わせると取れる
 * - pillar: 下から生える柱（上端 top）。地面を top より高くして埋めれば越えられる
 * - ceiling: 上から垂れる壁（下端 bottom）。地面を低くしてくぐる
 */
type Entry =
  | { t: number; kind: 'note'; y: number }
  | { t: number; kind: 'pillar'; top: number }
  | { t: number; kind: 'ceiling'; bottom: number };

/**
 * コースの構成（#26）
 * - 練習区間（0〜20秒）: 上り・下り・柱・天井を1つずつ、余裕のある間隔で覚える
 * - 挑戦区間（20〜60秒）: 任意の音符群が3か所。見送れば中くらいの高さのまま安全に進め、
 *   狙えば追加得点。そのあとの障害物までに戻る時間は取ってある
 *   - A 高い音符（22.5〜24.5秒）: 大きく上ってから、27秒の天井までに下りる
 *   - B リズムの音符（35〜37.4秒）: 平らな地面から「タン」の山1つ分だけ上にある
 *   - C 低い音符（45〜47秒）: 大きく下ってから、49.5秒の柱までに上る
 */
export const CHALLENGE_GROUPS = {
  high: { from: 22, to: 25 },
  rhythm: { from: 34.5, to: 38 },
  low: { from: 44.5, to: 47.5 },
} as const;

const LAYOUT: Entry[] = [
  // ── 練習区間 ──
  { t: 3, kind: 'note', y: 290 },
  { t: 5, kind: 'note', y: 330 },
  { t: 6, kind: 'note', y: 380 },
  { t: 7, kind: 'note', y: 430 },
  { t: 10, kind: 'pillar', top: 330 },
  { t: 12.5, kind: 'note', y: 260 },
  { t: 13.5, kind: 'note', y: 210 },
  { t: 16, kind: 'ceiling', bottom: 340 },
  { t: 18, kind: 'note', y: 270 },
  // ── 挑戦区間 ──
  // A: 高い音符（任意）
  { t: 22.5, kind: 'note', y: 500 },
  { t: 23.5, kind: 'note', y: 520 },
  { t: 24.5, kind: 'note', y: 500 },
  { t: 27, kind: 'ceiling', bottom: 340 },
  { t: 29, kind: 'note', y: 270 },
  { t: 31.5, kind: 'pillar', top: 360 },
  // B: リズムの音符（任意）。地面を 400 付近で平らにすると、山1つ分（+50）で届く
  { t: 35, kind: 'note', y: 470 },
  { t: 36.2, kind: 'note', y: 470 },
  { t: 37.4, kind: 'note', y: 470 },
  { t: 40, kind: 'ceiling', bottom: 340 },
  { t: 42, kind: 'note', y: 240 },
  // C: 低い音符（任意）
  { t: 45, kind: 'note', y: 120 },
  { t: 46, kind: 'note', y: 110 },
  { t: 47, kind: 'note', y: 120 },
  { t: 49.5, kind: 'pillar', top: 340 },
  { t: 52, kind: 'note', y: 420 },
  { t: 54.5, kind: 'ceiling', bottom: 320 },
  { t: 56.5, kind: 'note', y: 240 },
];

export function buildStage(): StageItem[] {
  return LAYOUT.map((e, i): StageItem => {
    const x = START_X + e.t * GAME.runSpeed;
    const id = `${e.kind}-${i}`;
    switch (e.kind) {
      case 'note':
        return { id, kind: 'note', x, y: e.y, w: NOTE_SIZE, h: NOTE_SIZE };
      case 'pillar':
        return { id, kind: 'obstacle', x, y: e.top / 2, w: OBSTACLE_W, h: e.top };
      case 'ceiling': {
        const h = VIEW.height - e.bottom;
        return { id, kind: 'obstacle', x, y: e.bottom + h / 2, w: OBSTACLE_W, h };
      }
    }
  });
}

/** 柱（下から生える障害物）か。描画順の判定に使う。 */
export function isPillar(item: StageItem): boolean {
  return item.kind === 'obstacle' && item.y - item.h / 2 <= 0;
}
