import type { ControlInput, Terrain, Vec2 } from '../core/types';
import { TERRAIN } from '../core/config';

export type TerrainConfig = typeof TERRAIN;

/** pulse で追加する山（raised cosine）。 */
interface Bump {
  startX: number;
}

/**
 * 入力に応じて前方へ地形を伸ばしていく。
 * - 地形は sampleStep ごとの高さ配列。生成済みのサンプルは二度と変えない。
 * - base（坂）に bump（リズムの山）を足し、最後に傾き・高さの上限で丸める。
 */
export class TerrainGenerator implements Terrain {
  private readonly heights: number[] = [];
  private baseY: number;
  private slope = 0;
  private bumps: Bump[] = [];

  constructor(
    initialFlatUntil: number,
    private readonly cfg: TerrainConfig = TERRAIN,
  ) {
    this.baseY = cfg.baseHeight;
    const n = Math.ceil(initialFlatUntil / cfg.sampleStep) + 1;
    for (let i = 0; i < n; i++) this.heights.push(cfg.baseHeight);
  }

  get generatedUntil(): number {
    return (this.heights.length - 1) * this.cfg.sampleStep;
  }

  advance(input: ControlInput, frontierX: number, _dtSec: number): void {
    const { sampleStep: step } = this.cfg;
    if (input.pulse) this.bumps.push({ startX: this.generatedUntil });
    while (this.generatedUntil + step <= frontierX) {
      this.pushSample(input);
    }
    const until = this.generatedUntil;
    this.bumps = this.bumps.filter((b) => b.startX + this.cfg.pulseWidth > until);
  }

  heightAt(x: number): number {
    const { sampleStep: step } = this.cfg;
    const last = this.heights.length - 1;
    const f = x / step;
    if (f <= 0) return this.heights[0];
    if (f >= last) return this.heights[last];
    const i = Math.floor(f);
    const t = f - i;
    return this.heights[i] * (1 - t) + this.heights[i + 1] * t;
  }

  points(x0: number, x1: number): Vec2[] {
    const { sampleStep: step } = this.cfg;
    const from = Math.max(0, x0);
    const to = Math.min(this.generatedUntil, x1);
    if (to < from) return [];
    const pts: Vec2[] = [{ x: from, y: this.heightAt(from) }];
    for (let i = Math.floor(from / step) + 1; i * step < to; i++) {
      pts.push({ x: i * step, y: this.heights[i] });
    }
    pts.push({ x: to, y: this.heightAt(to) });
    return pts;
  }

  private pushSample(input: ControlInput): void {
    const c = this.cfg;
    const step = c.sampleStep;
    const x = this.generatedUntil + step;

    // 1) 目標の傾き。無音・認識失敗のときは平坦へ減衰させる
    let target = 0;
    if (input.active) {
      const strength = 0.3 + 0.7 * clamp(input.intensity, 0, 1);
      target = clamp(input.slope, -1, 1) * c.maxSlope * strength;
    } else {
      target = this.slope * Math.max(0, 1 - c.flattenPerPx * step);
    }
    // 上下限の近くでは外へ向かう坂を作らない（張り付き防止）
    const margin = 40;
    if (this.baseY > c.maxHeight - margin && target > 0) target = 0;
    if (this.baseY < c.minHeight + margin && target < 0) target = 0;

    // 2) 傾きの変化量を制限して急変を防ぐ
    const maxDelta = c.maxSlopeChangePerPx * step;
    this.slope += clamp(target - this.slope, -maxDelta, maxDelta);
    this.baseY = clamp(this.baseY + this.slope * step, c.minHeight, c.maxHeight);

    // 3) リズムの山を足す
    let bump = 0;
    for (const b of this.bumps) {
      const u = (x - b.startX) / c.pulseWidth;
      if (u > 0 && u < 1) bump += (c.pulseHeight * (1 - Math.cos(2 * Math.PI * u))) / 2;
    }

    // 4) 最終的な傾き・高さを制限
    const prev = this.heights[this.heights.length - 1];
    const maxRise = c.maxSlope * step;
    const y = clamp(prev + clamp(this.baseY + bump - prev, -maxRise, maxRise), c.minHeight, c.maxHeight);
    this.heights.push(y);
  }
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}
