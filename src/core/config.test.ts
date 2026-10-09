import { describe, expect, it } from 'vitest';
import { GAME, STAGE_LENGTH, TERRAIN } from './config';

describe('config', () => {
  it('ステージ長は速度×時間', () => {
    expect(STAGE_LENGTH).toBe(GAME.runSpeed * GAME.durationSec);
  });
  it('地形の高さ範囲が正しい', () => {
    expect(TERRAIN.minHeight).toBeLessThan(TERRAIN.baseHeight);
    expect(TERRAIN.baseHeight).toBeLessThan(TERRAIN.maxHeight);
  });
});
