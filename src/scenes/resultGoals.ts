import type { GameResult } from '../core/types';

export interface ResultGoal {
  collected: number;
  total: number;
  percent: number | null;
  message: string;
}

/** 少数の音符でも、切り上げで実際に達成できる個数を次の目標にする。 */
export function resultGoal(result: Readonly<GameResult>): ResultGoal {
  const total = safeCount(result.notesTotal);
  const collected = Math.min(total, safeCount(result.notesCollected));
  const percent = total > 0 ? collected === total ? 100 : Math.min(99, Math.floor(collected / total * 100)) : null;
  let message: string;
  if (result.outcome !== 'clear') message = '次の目標：まずはゴールまで走り切ろう！';
  else if (total === 0) message = 'ゴール到達！ 次も完走を目指そう。';
  else if (collected === total) message = '音符をすべて集めてクリア！ 完全収集達成！';
  else {
    const target = [50, 80, 100].map((value) => ({ percent: value, count: value === 100 ? total : Math.ceil(total * value / 100) }))
      .find((value) => value.count > collected)!;
    message = `次の目標：音符${target.percent}%収集！ あと${target.count - collected}個で達成。`;
  }
  return { collected, total, percent, message };
}

export function safeCount(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.min(Number.MAX_SAFE_INTEGER, Math.floor(value))) : 0;
}
