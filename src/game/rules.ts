import type { GameEvent, GameResult, GameState, StageItem } from '../core/types';
import { GAME } from '../core/config';
import { GOAL_X, START_X } from './stage';

export interface StepWorld {
  heightAt(x: number): number;
  items: readonly StageItem[];
}

export function createGameState(): GameState {
  return {
    phase: 'running',
    elapsedSec: 0,
    runner: { x: START_X, y: 0 },
    lives: GAME.lives,
    score: 0,
    notesCollected: 0,
    invulnerableUntilSec: 0,
    collectedIds: new Set(),
  };
}

/** ランナーの当たり判定の円の中心（地面の上に乗る）。 */
export function runnerCenter(s: GameState) {
  return { x: s.runner.x, y: s.runner.y + GAME.runnerRadius };
}

export function isInvulnerable(s: GameState): boolean {
  return s.elapsedSec < s.invulnerableUntilSec;
}

/**
 * 1フレーム進める純粋関数。state は変更せず新しい state を返す。
 * running 以外の phase では何もしない（ポーズは呼び出し側で止める）。
 */
export function stepGame(prev: GameState, dtSec: number, world: StepWorld): { state: GameState; events: GameEvent[] } {
  if (prev.phase !== 'running') return { state: prev, events: [] };

  const events: GameEvent[] = [];
  const elapsedSec = prev.elapsedSec + dtSec;
  const x = Math.min(START_X + elapsedSec * GAME.runSpeed, GOAL_X);
  const s: GameState = {
    ...prev,
    elapsedSec,
    runner: { x, y: world.heightAt(x) },
  };
  const collected = new Set(prev.collectedIds);
  const c = runnerCenter(s);

  for (const item of world.items) {
    if (Math.abs(item.x - c.x) > item.w / 2 + GAME.runnerRadius) continue;
    if (!circleHitsRect(c.x, c.y, GAME.runnerRadius, item)) continue;

    if (item.kind === 'note' && !collected.has(item.id)) {
      collected.add(item.id);
      s.score += GAME.notePoints;
      s.notesCollected += 1;
      events.push({ type: 'collect', itemId: item.id });
    } else if (item.kind === 'obstacle' && !isInvulnerable(s)) {
      s.lives -= 1;
      s.invulnerableUntilSec = elapsedSec + GAME.invulnerableSec;
      events.push({ type: 'hit', itemId: item.id, livesLeft: s.lives });
    }
  }
  s.collectedIds = collected;

  if (s.lives <= 0) {
    s.phase = 'gameover';
    events.push({ type: 'gameover' });
  } else if (x >= GOAL_X) {
    s.phase = 'cleared';
    s.score += GAME.clearBonus;
    events.push({ type: 'clear' });
  }
  return { state: s, events };
}

export function toResult(s: GameState, items: readonly StageItem[]): GameResult {
  return {
    outcome: s.phase === 'cleared' ? 'clear' : 'gameover',
    score: s.score,
    notesCollected: s.notesCollected,
    notesTotal: items.filter((i) => i.kind === 'note').length,
  };
}

function circleHitsRect(cx: number, cy: number, r: number, b: StageItem): boolean {
  const nx = Math.max(b.x - b.w / 2, Math.min(cx, b.x + b.w / 2));
  const ny = Math.max(b.y - b.h / 2, Math.min(cy, b.y + b.h / 2));
  return (cx - nx) ** 2 + (cy - ny) ** 2 < r * r;
}
