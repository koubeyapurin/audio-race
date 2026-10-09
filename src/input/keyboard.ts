import type { AudioFeatures, ControlInput, InputSource } from '../core/types';
import { NEUTRAL_INPUT } from '../core/types';

/**
 * キーボード入力（仮実装）。Issue「A1: キーボード入力」で本実装する。
 * ↑/↓: slope, ←/→ または W/S: intensity, Space: pulse
 */
export class KeyboardInput implements InputSource {
  readonly kind = 'keyboard' as const;
  async start(): Promise<void> {}
  stop(): void {}
  read(_nowMs: number): ControlInput {
    return { ...NEUTRAL_INPUT };
  }
  debugFeatures(): AudioFeatures | null {
    return null;
  }
}
