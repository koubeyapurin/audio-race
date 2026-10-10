import { describe, expect, it } from 'vitest';
import type { ControlInput, GameState, StageItem } from '../core/types';
import { NEUTRAL_INPUT } from '../core/types';
import { GAME, TERRAIN } from '../core/config';
import { TerrainGenerator } from '../terrain/generator';
import { buildStage, GOAL_X, isPillar, START_X } from './stage';
import { createGameState, stepGame, type StepWorld } from './rules';

const DT = 1 / 60;
const flat = (h: number, items: StageItem[]): StepWorld => ({ heightAt: () => h, items });
const note = (x: number, y: number): StageItem => ({ id: `n${x}`, kind: 'note', x, y, w: 36, h: 36 });
const block = (x: number, y: number): StageItem => ({ id: `b${x}`, kind: 'obstacle', x, y, w: 56, h: 200 });

function runUntil(s: GameState, world: StepWorld, untilX: number) {
  const events = [];
  while (s.phase === 'running' && s.runner.x < untilX) {
    const r = stepGame(s, DT, world);
    s = r.state;
    events.push(...r.events);
  }
  return { s, events };
}

describe('stepGame', () => {
  it('収集がないフレームでは collectedIds を作り直さず、収集したときは前の Set を書き換えない（#29）', () => {
    const items = [note(START_X + 300, 200 + GAME.runnerRadius)];
    const s0 = createGameState();
    const s1 = stepGame(s0, DT, flat(200, items)).state;
    expect(s1.collectedIds).toBe(s0.collectedIds);
    const { s } = runUntil(s1, flat(200, items), START_X + 600);
    expect(s.collectedIds.size).toBe(1);
    expect(s0.collectedIds.size).toBe(0);
    expect(s1.collectedIds.size).toBe(0);
  });

  it('高さが合った音符を1回だけ取れる', () => {
    const items = [note(START_X + 300, 200 + GAME.runnerRadius)];
    const { s, events } = runUntil(createGameState(), flat(200, items), START_X + 600);
    expect(s.notesCollected).toBe(1);
    expect(s.score).toBe(GAME.notePoints);
    expect(events.filter((e) => e.type === 'collect')).toHaveLength(1);
  });

  it('高さが合わない音符は取れない', () => {
    const items = [note(START_X + 300, 400)];
    const { s } = runUntil(createGameState(), flat(200, items), START_X + 600);
    expect(s.notesCollected).toBe(0);
  });

  it('障害物でライフが1減り、無敵時間中は連続で減らない', () => {
    const items = [block(START_X + 300, 200), block(START_X + 340, 200)];
    const { s } = runUntil(createGameState(), flat(150, items), START_X + 600);
    expect(s.lives).toBe(GAME.lives - 1);
  });

  it('ライフ0でゲームオーバー', () => {
    const gap = GAME.runSpeed * (GAME.invulnerableSec + 0.2);
    const items = [0, 1, 2].map((i) => block(START_X + 300 + i * gap, 200));
    const { s, events } = runUntil(createGameState(), flat(150, items), GOAL_X);
    expect(s.phase).toBe('gameover');
    expect(events.at(-1)).toEqual({ type: 'gameover' });
  });

  it('ゴールでクリアボーナス', () => {
    const { s } = runUntil(createGameState(), flat(200, []), GOAL_X + 1);
    expect(s.phase).toBe('cleared');
    expect(s.score).toBe(GAME.clearBonus);
  });
});

/** ↑/↓/離す しか使わない「キーボードの人」を真似た自動操縦。 */
function autopilot(items: StageItem[], terrain: TerrainGenerator, frontierX: number): ControlInput {
  const target = items
    .filter((i) => i.x + i.w / 2 + 120 >= frontierX && i.x - i.w / 2 - (i.kind === 'note' ? 260 : 420) <= frontierX)
    .sort((a, b) => a.x - b.x)[0];
  if (!target) return { ...NEUTRAL_INPUT };
  let want: number;
  if (target.kind === 'note') want = target.y - GAME.runnerRadius;
  else if (isPillar(target)) want = target.h + 40;
  else want = target.y - target.h / 2 - GAME.runnerRadius * 2 - 40;
  const diff = want - predictStop(terrain, frontierX);
  if (Math.abs(diff) < 12) return { ...NEUTRAL_INPUT };
  return { slope: Math.sign(diff), intensity: 1, pulse: false, active: true };
}

describe('固定ステージ', () => {
  it('キーボード操作（↑↓のみ）でノーダメージ・音符8割以上でクリアできる', () => {
    const items = buildStage();
    const lookahead = GAME.runSpeed * TERRAIN.lookaheadSec;
    const terrain = new TerrainGenerator(START_X + lookahead);
    let s = createGameState();
    while (s.phase === 'running') {
      const frontier = s.runner.x + lookahead;
      terrain.advance(autopilot(items, terrain, terrain.generatedUntil), frontier, DT);
      s = stepGame(s, DT, { heightAt: (x) => terrain.heightAt(x), items }).state;
    }
    const notes = items.filter((i) => i.kind === 'note').length;
    expect(s.phase).toBe('cleared');
    expect(s.lives).toBe(GAME.lives);
    expect(s.notesCollected).toBeGreaterThanOrEqual(Math.ceil(notes * 0.8));
  });

  it('何も操作しないと障害物に当たる（声が攻略に影響する）', () => {
    const items = buildStage();
    let s = createGameState();
    while (s.phase === 'running') s = stepGame(s, DT, flat(TERRAIN.baseHeight, items)).state;
    expect(s.lives).toBeLessThan(GAME.lives);
  });
});

/** 今の傾きのままブレーキをかけたら止まる高さ（慣性を考えて早めに離す）。 */
function predictStop(terrain: TerrainGenerator, x: number): number {
  const h = terrain.heightAt(x);
  const slope = (h - terrain.heightAt(x - TERRAIN.sampleStep)) / TERRAIN.sampleStep;
  return h + (Math.sign(slope) * slope * slope) / (2 * TERRAIN.maxSlopeChangePerPx);
}
