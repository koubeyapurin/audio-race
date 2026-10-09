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

const LAYOUT: Entry[] = [
  { t: 4, kind: 'note', y: 300 },
  { t: 5, kind: 'note', y: 340 },
  { t: 6, kind: 'note', y: 380 },
  { t: 9, kind: 'pillar', top: 320 },
  { t: 11, kind: 'note', y: 440 },
  { t: 13.5, kind: 'ceiling', bottom: 360 },
  { t: 15.5, kind: 'note', y: 200 },
  { t: 16.5, kind: 'note', y: 180 },
  { t: 19, kind: 'pillar', top: 300 },
  { t: 21, kind: 'note', y: 470 },
  { t: 22, kind: 'note', y: 480 },
  { t: 25, kind: 'ceiling', bottom: 320 },
  { t: 27, kind: 'note', y: 160 },
  { t: 30, kind: 'pillar', top: 380 },
  { t: 32, kind: 'note', y: 490 },
  { t: 35, kind: 'ceiling', bottom: 340 },
  { t: 37, kind: 'note', y: 240 },
  { t: 38, kind: 'note', y: 260 },
  { t: 41, kind: 'pillar', top: 330 },
  { t: 43, kind: 'note', y: 450 },
  { t: 46, kind: 'ceiling', bottom: 340 },
  { t: 47.5, kind: 'note', y: 170 },
  { t: 50, kind: 'pillar', top: 300 },
  { t: 52, kind: 'note', y: 420 },
  { t: 54.5, kind: 'ceiling', bottom: 320 },
  { t: 56.5, kind: 'note', y: 230 },
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
