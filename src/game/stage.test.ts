import { describe, expect, it } from 'vitest';
import type { ControlInput, GameState } from '../core/types';
import { NEUTRAL_INPUT } from '../core/types';
import { GAME, STAGE_LENGTH, TERRAIN, VIEW } from '../core/config';
import { TerrainGenerator } from '../terrain/generator';
import { buildStage, CHALLENGE_GROUPS, GOAL_X, START_X } from './stage';
import { createGameState, stepGame } from './rules';

const DT = 1 / 60;
const LOOKAHEAD = GAME.runSpeed * TERRAIN.lookaheadSec;

/**
 * 入力の計画: 「生成ラインがこの時刻の位置に来たら、地面をこの高さにしたい」の列。
 * キーボードの人と同じく ↑ / ↓ / 離す（強さ100%）だけで、目標の高さに向かう。
 * 時刻は、ランナーがその位置を通る時刻（走り始めてからの秒）。
 */
type Plan = [fromSec: number, ground: number][];

/** 1つ目から3つ目の各任意グループで、どちらを選ぶかだけが違う計画を作る。 */
function plan(greedy: { high: boolean; rhythm: boolean; low: boolean }): Plan {
  return [
    // 練習区間
    [0, 272], [4, 312], [5.5, 362], [6.5, 412], [8, 385], [11.5, 242], [13, 192], [14.5, 250], [17.5, 252],
    // A: 高い音符を狙うなら上る、見送るなら中くらい
    [20, greedy.high ? 495 : 260], [25.3, 250], [28.5, 252],
    [30, 400],
    // B: 地面は 400 付近で平ら（リズムの有無は pulses で切り替える）
    [38.3, 250], [41.5, 222],
    // C: 低い音符を狙うなら下る
    [43, greedy.low ? 95 : 260], [47.4, 390], [51.5, 362], [53, 240], [56, 222],
  ];
}

/** B の音符のちょうど手前で「タン」：山の頂上（幅の半分先）が音符に来るように。 */
const RHYTHM_PULSES = [35, 36.2, 37.4].map((t) => t - TERRAIN.pulseWidth / 2 / GAME.runSpeed);

const xAt = (t: number) => START_X + t * GAME.runSpeed;
const tAt = (x: number) => (x - START_X) / GAME.runSpeed;

function play(p: Plan, pulses: readonly number[] = []) {
  const items = buildStage();
  const terrain = new TerrainGenerator(START_X + LOOKAHEAD);
  let s: GameState = createGameState();
  const fired = new Set<number>();
  while (s.phase === 'running') {
    const f = terrain.generatedUntil;
    const tf = tAt(f);
    const want = [...p].reverse().find(([from]) => from <= tf)?.[1] ?? TERRAIN.baseHeight;
    const diff = want - predictStop(terrain, f);
    // 「タン」の山が生成ラインを通っている間は ↑↓ を押さない（人も山を打ち消さない）
    const bumping = pulses.some((t) => tf >= t && tf < t + TERRAIN.pulseWidth / GAME.runSpeed);
    const input: ControlInput =
      bumping || Math.abs(diff) < 12
        ? { ...NEUTRAL_INPUT }
        : { slope: Math.sign(diff), intensity: 1, pulse: false, active: true };
    const pulseIdx = pulses.findIndex((t, i) => !fired.has(i) && tf >= t);
    if (pulseIdx >= 0) {
      fired.add(pulseIdx);
      input.pulse = true;
      input.active = true;
    }
    terrain.advance(input, s.runner.x + LOOKAHEAD, DT);
    s = stepGame(s, DT, { heightAt: (x) => terrain.heightAt(x), items }).state;
  }
  const inGroup = (g: { from: number; to: number }) =>
    items.filter((i) => i.kind === 'note' && s.collectedIds.has(i.id) && tAt(i.x) >= g.from && tAt(i.x) <= g.to).length;
  return { s, items, inGroup };
}

/** 今の傾きのままブレーキをかけたら止まる高さ（慣性を考えて早めに離す）。 */
function predictStop(terrain: TerrainGenerator, x: number): number {
  const h = terrain.heightAt(x);
  const slope = (h - terrain.heightAt(x - TERRAIN.sampleStep)) / TERRAIN.sampleStep;
  return h + (Math.sign(slope) * slope * slope) / (2 * TERRAIN.maxSlopeChangePerPx);
}

const SAFE = plan({ high: false, rhythm: false, low: false });
const GREEDY = plan({ high: true, rhythm: true, low: true });

describe('コース（#26）', () => {
  it('安全な入力列: 任意の音符を見送ってもノーダメージでゴールできる', () => {
    const { s, inGroup } = play(SAFE);
    expect(s.phase).toBe('cleared');
    expect(s.lives).toBe(GAME.lives);
    expect(inGroup(CHALLENGE_GROUPS.high)).toBe(0);
    expect(inGroup(CHALLENGE_GROUPS.low)).toBe(0);
  });

  it('狙う入力列: 任意の音符を取ってもゴールでき、安全な入力列より多く取れる', () => {
    const safe = play(SAFE);
    const greedy = play(GREEDY, RHYTHM_PULSES);
    expect(greedy.s.phase).toBe('cleared');
    expect(greedy.s.lives).toBe(GAME.lives);
    expect(greedy.inGroup(CHALLENGE_GROUPS.high)).toBe(3);
    expect(greedy.inGroup(CHALLENGE_GROUPS.low)).toBe(3);
    expect(greedy.s.notesCollected).toBeGreaterThan(safe.s.notesCollected + 6);
  });

  it('リズムの区間: 同じ上下・強さの入力でも「タン」を使うと音符が多く取れる', () => {
    const without = play(GREEDY);
    const withPulse = play(GREEDY, RHYTHM_PULSES);
    expect(without.inGroup(CHALLENGE_GROUPS.rhythm)).toBe(0);
    expect(withPulse.inGroup(CHALLENGE_GROUPS.rhythm)).toBe(3);
    expect(withPulse.s.lives).toBe(GAME.lives);
  });

  it('アイテムの ID が一意で、位置がステージと画面の範囲内', () => {
    const items = buildStage();
    expect(new Set(items.map((i) => i.id)).size).toBe(items.length);
    for (const i of items) {
      expect(i.x).toBeGreaterThan(START_X);
      expect(i.x).toBeLessThan(GOAL_X);
      expect(i.y - i.h / 2).toBeGreaterThanOrEqual(0);
      expect(i.y + i.h / 2).toBeLessThanOrEqual(VIEW.height);
      if (i.kind === 'note') {
        expect(i.y).toBeGreaterThan(TERRAIN.minHeight);
        expect(i.y).toBeLessThan(TERRAIN.maxHeight + GAME.runnerRadius * 2);
      }
    }
  });

  it('固定配置: 何度作っても同じ', () => {
    expect(buildStage()).toEqual(buildStage());
    expect(STAGE_LENGTH).toBe(GAME.runSpeed * GAME.durationSec);
    expect(xAt(0)).toBe(START_X);
  });
});
