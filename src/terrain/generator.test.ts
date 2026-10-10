import { describe, expect, it } from 'vitest';
import type { ControlInput } from '../core/types';
import { NEUTRAL_INPUT } from '../core/types';
import { TERRAIN } from '../core/config';
import { TerrainGenerator } from './generator';

function rng(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const SPEED_PER_FRAME = 5; // 300px/s ÷ 60fps
const input = (p: Partial<ControlInput>): ControlInput => ({ ...NEUTRAL_INPUT, active: true, ...p });

function run(gen: TerrainGenerator, frames: number, f: (i: number) => ControlInput, start = 400) {
  for (let i = 0; i < frames; i++) gen.advance(f(i), start + i * SPEED_PER_FRAME, 1 / 60);
}

/** 生成済みの点列（サンプル点）が高さ・傾き・傾き変化量の上限を守っているか。 */
function expectWithinLimits(gen: TerrainGenerator) {
  const step = TERRAIN.sampleStep;
  const n = Math.round(gen.generatedUntil / step);
  const ys = Array.from({ length: n + 1 }, (_, i) => gen.heightAt(i * step));
  let prevSlope = 0;
  for (let i = 1; i < ys.length; i++) {
    expect(ys[i]).toBeGreaterThanOrEqual(TERRAIN.minHeight);
    expect(ys[i]).toBeLessThanOrEqual(TERRAIN.maxHeight);
    const s = (ys[i] - ys[i - 1]) / step;
    expect(Math.abs(s)).toBeLessThanOrEqual(TERRAIN.maxSlope + 1e-9);
    expect(Math.abs(s - prevSlope), `x=${i * step}`).toBeLessThanOrEqual(TERRAIN.maxSlopeChangePerPx * step + 1e-9);
    prevSlope = s;
  }
}

describe('TerrainGenerator', () => {
  it('ランダム入力1万フレームでも高さ・傾きの上限を守り、生成済み部分は変わらない', () => {
    const r = rng(42);
    const gen = new TerrainGenerator(400);
    let snapshot: { x: number; y: number }[] = [];
    run(gen, 10000, (i) => {
      if (i === 5000) snapshot = gen.points(0, gen.generatedUntil);
      return {
        slope: r() * 2 - 1,
        intensity: r(),
        pulse: r() < 0.05,
        active: r() < 0.8,
      };
    });

    expectWithinLimits(gen);
    for (const p of snapshot) expect(gen.heightAt(p.x)).toBeCloseTo(p.y, 9);
  });

  it('上り・下りを上限まで続けても、上限の手前で滑らかに減速する（#14）', () => {
    for (const slope of [1, -1]) {
      for (const pulse of [false, true]) {
        const gen = new TerrainGenerator(400);
        run(gen, 400, (i) => input({ slope, intensity: 1, pulse: pulse && i % 20 === 0 }));
        expectWithinLimits(gen);
      }
    }
  });

  it('上り入力で上がり、下り入力で下がる', () => {
    const up = new TerrainGenerator(400);
    run(up, 120, () => input({ slope: 1, intensity: 1 }));
    expect(up.heightAt(up.generatedUntil)).toBeGreaterThan(TERRAIN.baseHeight + 100);

    const down = new TerrainGenerator(400);
    run(down, 120, () => input({ slope: -1, intensity: 1 }));
    expect(down.heightAt(down.generatedUntil)).toBeLessThan(TERRAIN.baseHeight - 100);
  });

  it('強さが大きいほど変化が大きい', () => {
    const weak = new TerrainGenerator(400);
    const strong = new TerrainGenerator(400);
    run(weak, 60, () => input({ slope: 1, intensity: 0 }));
    run(strong, 60, () => input({ slope: 1, intensity: 1 }));
    const end = weak.generatedUntil;
    expect(strong.heightAt(end) - TERRAIN.baseHeight).toBeGreaterThan(weak.heightAt(end) - TERRAIN.baseHeight);
  });

  it('無音が続くと平坦に戻る', () => {
    const gen = new TerrainGenerator(400);
    run(gen, 60, () => input({ slope: 1, intensity: 1 }));
    run(gen, 600, () => ({ ...NEUTRAL_INPUT }), gen.generatedUntil);
    const x = gen.generatedUntil;
    expect(Math.abs(gen.heightAt(x) - gen.heightAt(x - 100))).toBeLessThan(1);
  });

  it('pulse で前方に山ができ、その後もとの高さに戻る', () => {
    const gen = new TerrainGenerator(400);
    gen.advance(input({ slope: 0, pulse: true }), 400, 1 / 60);
    run(gen, 250, () => input({ slope: 0 }), 400);
    const peak = gen.heightAt(400 + TERRAIN.pulseWidth / 2);
    expect(peak).toBeGreaterThan(TERRAIN.baseHeight + TERRAIN.pulseHeight * 0.8);
    expect(Math.abs(gen.heightAt(400 + TERRAIN.pulseWidth + 50) - TERRAIN.baseHeight)).toBeLessThan(2);
    expect(gen.heightAt(gen.generatedUntil)).toBeCloseTo(TERRAIN.baseHeight, 1);
  });

  it('天井付近で pulse しても、山のあとに地形が下がったままにならない', () => {
    const gen = new TerrainGenerator(400);
    run(gen, 300, () => input({ slope: 1, intensity: 1 }));
    const before = gen.heightAt(gen.generatedUntil);
    gen.advance(input({ slope: 0, pulse: true }), gen.generatedUntil, 1 / 60);
    const from = gen.generatedUntil;
    run(gen, 200, () => input({ slope: 0 }), from);
    // 山の途中でもへこまない
    const ys = gen.points(from, gen.generatedUntil).map((p) => p.y);
    expect(Math.min(...ys)).toBeGreaterThan(before - 5);
  });

  it('pulse を連打しても、平地から山1つ分より高くならない', () => {
    const gen = new TerrainGenerator(400);
    run(gen, 200, (i) => input({ slope: 0, pulse: i % 3 === 0 }));
    expectWithinLimits(gen);
    const ys = gen.points(400, gen.generatedUntil).map((p) => p.y);
    expect(Math.max(...ys)).toBeLessThanOrEqual(TERRAIN.baseHeight + TERRAIN.pulseHeight + 1e-6);
  });
});
