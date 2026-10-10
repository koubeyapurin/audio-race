import { describe, expect, it } from 'vitest';
import { Effects } from './effects';

describe('Effects', () => {
  it('被弾の揺れは時間がたつと止まる', () => {
    const fx = new Effects();
    fx.hit();
    expect(fx.shakeOffset()).not.toEqual({ dx: 0, dy: 0 });
    for (let i = 0; i < 60; i++) fx.update(1 / 60);
    expect(fx.shakeOffset()).toEqual({ dx: 0, dy: 0 });
  });

  it('収集の粒は時間がたつと消える（たまり続けない）', () => {
    const fx = new Effects();
    for (let i = 0; i < 50; i++) fx.collect(100, 200, 100);
    for (let i = 0; i < 120; i++) fx.update(1 / 60);
    // 内部の配列が空になったことを、描画が何もしないことで確かめる
    let calls = 0;
    const g = new Proxy({}, { get: () => () => { calls++; }, set: () => true }) as unknown as CanvasRenderingContext2D;
    fx.draw(g, 0);
    expect(calls).toBe(0);
  });
});
