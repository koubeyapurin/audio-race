import type { ControlInput, Terrain, Vec2 } from '../core/types';
import { TERRAIN } from '../core/config';

export type TerrainConfig = typeof TERRAIN;

/** 出力が目標の高さからずれたとき、1区間で詰める割合。 */
const POSITION_GAIN = 0.08;

/** pulse で追加する山（raised cosine）。 */
interface Bump {
  startX: number;
}

/**
 * 入力に応じて前方へ地形を伸ばしていく。
 * - 地形は sampleStep ごとの高さ配列。生成済みのサンプルは二度と変えない。
 * - base（坂）に bump（リズムの山）を足した「目標の高さ」へ向かう。
 * - 出力する点列そのものの傾き・傾き変化量・高さが上限を守るように、
 *   上下限に近づいたら手前から減速する。
 */
export class TerrainGenerator implements Terrain {
  private readonly heights: number[] = [];
  private baseY: number;
  /** 入力から決まる坂の傾き（山を足す前）。 */
  private slope = 0;
  /** 実際に出力した最後の区間の傾き。 */
  private outSlope = 0;
  private bumps: Bump[] = [];
  private prevBump = 0;
  /** 直前の区間で、上下限の手前の減速によって出力が抑えられていたか。 */
  private limited = false;

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
    const baseDelta = c.maxSlopeChangePerPx * step;
    this.slope += clamp(target - this.slope, -baseDelta, baseDelta);
    this.baseY = clamp(this.baseY + this.slope * step, c.minHeight, c.maxHeight);

    // 3) リズムの山を足す
    let bump = 0;
    for (const b of this.bumps) {
      const u = (x - b.startX) / c.pulseWidth;
      if (u > 0 && u < 1) bump += (c.pulseHeight * (1 - Math.cos(2 * Math.PI * u))) / 2;
    }
    // 連打で山が積み上がらないよう、重なっても1つ分の高さまで
    bump = Math.min(bump, c.pulseHeight);

    // 4) 出力する点列の傾きを制限する（変化量 → 傾きの上限 → 上下限の手前での減速）
    const prev = this.heights[this.heights.length - 1];
    const accel = c.maxSlopeChangePerPx;
    const maxDelta = accel * step;
    const lo = this.outSlope - maxDelta;
    const hi = this.outSlope + maxDelta;
    // 坂の傾き＋山の傾きに沿って進み、目標の高さとのずれは少しずつ詰める
    // 上下限で抑えられている間は山の傾きを足さない（山の後半でへこむのを防ぐ）
    const bumpSlope = this.limited ? 0 : (bump - this.prevBump) / step;
    this.prevBump = bump;
    const correction = (POSITION_GAIN * (this.baseY + bump - prev)) / step;
    let s = clamp(this.slope + bumpSlope + correction, lo, hi);
    s = clamp(s, -c.maxSlope, c.maxSlope);
    // 次の点から先、変化量の上限で減速しても上下限を越えない傾きに抑える
    const wanted = s;
    s = Math.min(s, Math.max(lo, brakeLimit(c.maxHeight - prev, accel, step)));
    s = Math.max(s, Math.min(hi, -brakeLimit(prev - c.minHeight, accel, step)));
    this.limited = s !== wanted;

    const y = clamp(prev + s * step, c.minHeight, c.maxHeight);
    this.outSlope = (y - prev) / step;
    this.heights.push(y);
  }
}

/**
 * 境界まで距離 dist のとき、この区間で使える最大の傾き。
 * 1区間進んだあと、毎区間 accel*step ずつ減速して境界の手前で止まれる値を返す。
 */
function brakeLimit(dist: number, accel: number, step: number): number {
  // 傾き v で進み始めて止まるまでの距離 ≒ v*step + v^2 / (2*accel)（離散化の分 step を足す）
  const d = Math.max(0, dist);
  const a = accel;
  // v*step + v^2/(2a) + v*step/2 <= d を v について解く
  const b = 1.5 * step;
  return -a * b + Math.sqrt(a * a * b * b + 2 * a * d);
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}
