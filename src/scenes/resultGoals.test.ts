import { describe, expect, it } from 'vitest';
import type { GameResult } from '../core/types';
import { resultGoal } from './resultGoals';

const clear = (collected: number, total: number): GameResult =>
  ({ outcome: 'clear', score: 100, notesCollected: collected, notesTotal: total });

describe('次の収集目標', () => {
  it.each([
    [0, 10, 0, '50%収集！ あと5個'],
    [4, 10, 40, '50%収集！ あと1個'],
    [5, 10, 50, '80%収集！ あと3個'],
    [7, 10, 70, '80%収集！ あと1個'],
    [8, 10, 80, '100%収集！ あと2個'],
    [9, 10, 90, '100%収集！ あと1個'],
    [1, 3, 33, '50%収集！ あと1個'],
    [2, 3, 66, '80%収集！ あと1個'],
    [0, 1, 0, '50%収集！ あと1個'],
    [1, 2, 50, '80%収集！ あと1個'],
  ])('%s/%s個なら未達成の目標を切り上げて提示する', (collected, total, percent, message) => {
    const goal = resultGoal(clear(collected, total));
    expect(goal.percent).toBe(percent);
    expect(goal.message).toContain(message);
  });

  it('全収集を祝い、達成済みの目標を再提示しない', () => {
    for (const total of [1, 2, 10]) {
      const goal = resultGoal(clear(total, total));
      expect(goal.percent).toBe(100);
      expect(goal.message).toContain('完全収集達成');
      expect(goal.message).not.toContain('あと');
    }
  });

  it('ゲームオーバーでは収集数によらず完走を優先する', () => {
    expect(resultGoal({ ...clear(10, 10), outcome: 'gameover' }).message).toContain('まずはゴール');
  });

  it('音符なしや不正値でも安全に表示し、入力を変更しない', () => {
    for (const total of [0, -1, NaN, Infinity]) {
      const result = Object.freeze(clear(Infinity, total));
      const goal = resultGoal(result);
      expect(goal).toMatchObject({ total: 0, collected: 0, percent: null });
      expect(goal.message).not.toMatch(/NaN|Infinity|あと-/);
      expect(result.notesTotal).toBe(total);
    }
    expect(resultGoal(clear(-2, 10)).collected).toBe(0);
    expect(resultGoal(clear(100, 10)).collected).toBe(10);
    expect(resultGoal(clear(1.9, 3.9))).toMatchObject({ collected: 1, total: 3 });
    expect(resultGoal(clear(Number.MAX_SAFE_INTEGER - 1, Number.MAX_SAFE_INTEGER)).message).toContain('あと1個');
  });
});
