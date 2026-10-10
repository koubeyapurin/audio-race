import type { AudioFeatures, ControlInput, InputSource } from '../core/types';
import { NEUTRAL_INPUT } from '../core/types';
import { TouchControls } from './touchControls';

const CONTROL_KEYS: ReadonlySet<string> = new Set([
  'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'KeyW', 'KeyS', 'Space',
]);

/** キー状態を共通入力に変換する、DOM に依存しない計算部分。 */
export function controlFromKeys(
  down: ReadonlySet<string>,
  intensity: number,
  pulse: boolean,
): ControlInput {
  const up = down.has('ArrowUp');
  const lower = down.has('ArrowDown');
  return {
    slope: up === lower ? 0 : up ? 1 : -1,
    intensity,
    pulse,
    active: up || lower || pulse,
  };
}

/** ↑/↓: slope、←/→ または W/S: intensity、Space: pulse。 */
export class KeyboardInput implements InputSource {
  readonly kind = 'keyboard' as const;
  private readonly down = new Set<string>();
  private readonly touchDown = new Set<string>();
  private touch: TouchControls | null = null;
  // 小数の加算誤差を避けるため、強さは 0..10 の整数で保持する。
  private intensitySteps = 5;
  private pulse = false;
  private listening = false;

  // テストでは EventTarget を渡し、ブラウザでは window を使う。
  constructor(private readonly target: EventTarget = window, private readonly touchRoot?: HTMLElement) {}

  private readonly onDown: EventListener = (event) => {
    const e = event as KeyboardEvent;
    if (!CONTROL_KEYS.has(e.code)) return;
    e.preventDefault();
    // 長押しや重複した keydown で強さ・リズムを繰り返し変更しない。
    if (e.repeat || this.down.has(e.code)) return;
    this.down.add(e.code);
    if (e.code === 'Space') this.pulse = true;
    if (e.code === 'ArrowRight' || e.code === 'KeyW') {
      this.adjust(1);
    } else if (e.code === 'ArrowLeft' || e.code === 'KeyS') {
      this.adjust(-1);
    }
  };

  private readonly onUp: EventListener = (event) => {
    this.down.delete((event as KeyboardEvent).code);
  };

  private readonly clearPressed = (): void => {
    this.down.clear();
    this.touch?.reset();
    this.touchDown.clear();
    this.pulse = false;
  };

  async start(): Promise<void> {
    if (this.listening) return;
    if (this.touchRoot) this.touch = new TouchControls(this.touchRoot, {
      direction: (action, held) => {
        const code = action === 'up' ? 'ArrowUp' : 'ArrowDown';
        if (held) this.touchDown.add(code); else this.touchDown.delete(code);
      },
      adjust: (delta) => this.adjust(delta),
      pulse: () => { this.pulse = true; },
    }, this.intensitySteps / 10);
    this.target.addEventListener('keydown', this.onDown);
    this.target.addEventListener('keyup', this.onUp);
    // フォーカスを失って keyup を受け取れなくても、坂が出続けないようにする。
    this.target.addEventListener('blur', this.clearPressed);
    this.listening = true;
  }

  stop(): void {
    this.touch?.destroy();
    this.touch = null;
    if (this.listening) {
      this.target.removeEventListener('keydown', this.onDown);
      this.target.removeEventListener('keyup', this.onUp);
      this.target.removeEventListener('blur', this.clearPressed);
      this.listening = false;
    }
    this.clearPressed();
    // 調整した強さはポーズ解除・リトライでも維持する。
  }

  read(_nowMs: number): ControlInput {
    if (!this.listening) return { ...NEUTRAL_INPUT };
    const keys = this.touchDown.size ? new Set([...this.down, ...this.touchDown]) : this.down;
    const input = controlFromKeys(keys, this.intensitySteps / 10, this.pulse);
    this.pulse = false;
    return input;
  }
  debugFeatures(): AudioFeatures | null {
    return null;
  }
  private adjust(delta: number): void {
    this.intensitySteps = Math.max(0, Math.min(10, this.intensitySteps + delta));
    this.touch?.setIntensity(this.intensitySteps / 10);
  }
}
