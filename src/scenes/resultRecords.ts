import type { InputKind, StageItem } from '../core/types';
import { GAME, TERRAIN } from '../core/config';
import { buildStage, GOAL_X } from '../game/stage';

export interface BestScore {
  best: number | null;
  available: boolean;
}
export interface ScoreRecord extends BestScore {
  previous: number | null;
  status: 'first' | 'improved' | 'tied' | 'unchanged' | 'unavailable';
}

/** ハッシュの衝突を避け、配置・得点・地形条件そのものを記録の名前にする。 */
export function courseRecordId(items: readonly StageItem[], goalX = GOAL_X): string {
  return JSON.stringify([goalX, GAME, TERRAIN,
    items.map((item) => [item.id, item.kind, item.x, item.y, item.w, item.h])]);
}
const CURRENT_COURSE_ID = courseRecordId(buildStage());
let revision = 0;

/** HUDは初回と記録更新時だけ保存データを読む。描画ループやイベントは作らない。 */
export function scoreRecordRevision(): number { return revision; }

function key(mode: InputKind, courseId: string): string {
  return `voice-terrain-runner:best-score:v2:${mode}:${courseId}`;
}
function parseScore(value: string | null): number | null {
  if (value === null || !/^\d+$/.test(value)) return null;
  const score = Number(value);
  return Number.isSafeInteger(score) && score >= 0 ? score : null;
}

export function readBestScore(mode: InputKind, courseId = CURRENT_COURSE_ID): BestScore {
  try {
    return { best: parseScore(localStorage.getItem(key(mode, courseId))), available: true };
  } catch {
    return { best: null, available: false };
  }
}

/** 旧来のモード不明の記録は読み替えも削除もしない。失敗してもゲームを続けられる。 */
export function recordBestScore(mode: InputKind, score: number, courseId = CURRENT_COURSE_ID): ScoreRecord {
  let previous: number | null = null;
  try {
    const storage = localStorage;
    const recordKey = key(mode, courseId);
    previous = parseScore(storage.getItem(recordKey));
    if (!Number.isSafeInteger(score) || score < 0) {
      return { best: previous, previous, status: 'unchanged', available: true };
    }
    const status = previous === null ? 'first' : score > previous ? 'improved'
      : score === previous ? 'tied' : 'unchanged';
    if (status === 'first' || status === 'improved') {
      storage.setItem(recordKey, String(score));
      revision++;
    }
    return { best: Math.max(score, previous ?? 0), previous, status, available: true };
  } catch {
    return { best: previous, previous, status: 'unavailable', available: false };
  }
}
