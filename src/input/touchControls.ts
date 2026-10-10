export type TouchAction = 'up' | 'down' | 'weaker' | 'stronger' | 'pulse';
interface Actions {
  direction(action: 'up' | 'down', held: boolean): void;
  adjust(delta: number): void;
  pulse(): void;
}

/** Pointer Eventsで複数指を扱う。入力源のstart/stopと同じ寿命を持つ。 */
export class TouchControls {
  private readonly panel: HTMLElement;
  private readonly pointers = new Map<number, TouchAction>();
  private readonly keys = new Map<HTMLButtonElement, Set<string>>();
  private readonly buttons = new Map<TouchAction, HTMLButtonElement>();
  private readonly releases: (() => void)[] = [];
  private readonly strength: HTMLElement;

  constructor(root: HTMLElement, private readonly actions: Actions, intensity: number) {
    this.panel = document.createElement('section');
    this.panel.className = 'touch-controls';
    this.panel.setAttribute('aria-label', 'タッチによる地形操作');
    this.panel.innerHTML = `
      <div class="touch-help">上り・下りは長押し ／ <span data-strength></span></div>
      <div class="touch-buttons">
        <button type="button" data-action="down" aria-label="押している間、下り坂">↓ 下り</button>
        <button type="button" data-action="up" aria-label="押している間、上り坂">↑ 上り</button>
        <button type="button" data-action="weaker" aria-label="強さを10パーセント下げる">− 強さ</button>
        <button type="button" data-action="stronger" aria-label="強さを10パーセント上げる">＋ 強さ</button>
        <button type="button" data-action="pulse" aria-label="波を1つ作る">波</button>
      </div>`;
    this.strength = this.panel.querySelector<HTMLElement>('[data-strength]')!;
    for (const action of ['up', 'down', 'weaker', 'stronger', 'pulse'] as const) {
      const button = this.panel.querySelector<HTMLButtonElement>(`[data-action="${action}"]`)!;
      this.buttons.set(action, button);
      this.keys.set(button, new Set());
      this.bind(button, 'pointerdown', (event) => {
        const e = event as PointerEvent;
        if (e.button !== 0 || this.pointers.has(e.pointerId)) return;
        e.preventDefault();
        this.pointers.set(e.pointerId, action);
        button.setPointerCapture(e.pointerId);
        this.press(action);
      });
      const release: EventListener = (event) => {
        const id = (event as PointerEvent).pointerId;
        if (this.pointers.get(id) !== action) return;
        this.pointers.delete(id);
        this.refreshDirection(action);
      };
      for (const name of ['pointerup', 'pointercancel', 'lostpointercapture']) this.bind(button, name, release);
      // ボタンにフォーカスしたSpace/Enterは、ゲーム全体のSpaceと二重に扱わない。
      this.bind(button, 'keydown', (event) => {
        const e = event as KeyboardEvent;
        if (e.code !== 'Space' && e.code !== 'Enter') return;
        e.preventDefault(); e.stopPropagation();
        const held = this.keys.get(button)!;
        if (e.repeat || held.has(e.code)) return;
        held.add(e.code);
        this.press(action);
      });
      this.bind(button, 'keyup', (event) => {
        const e = event as KeyboardEvent;
        if (e.code !== 'Space' && e.code !== 'Enter') return;
        e.preventDefault(); e.stopPropagation();
        this.keys.get(button)!.delete(e.code);
        this.refreshDirection(action);
      });
      this.bind(button, 'blur', () => {
        this.keys.get(button)!.clear();
        this.refreshDirection(action);
      });
      // 支援技術のclickでも強さ・波を操作できる。通常のpointer後のclickは重ねない。
      this.bind(button, 'click', (event) => {
        if ((event as MouseEvent).detail === 0 && action !== 'up' && action !== 'down') this.press(action);
      });
    }
    this.setIntensity(intensity);
    root.append(this.panel);
  }

  setIntensity(intensity: number): void {
    this.strength.textContent = `強さ ${Math.round(intensity * 100)}%`;
  }

  reset(): void {
    this.pointers.clear();
    for (const held of this.keys.values()) held.clear();
    this.refreshDirection('up'); this.refreshDirection('down');
  }

  destroy(): void {
    this.reset();
    for (const release of this.releases) release();
    this.panel.remove();
  }

  private press(action: TouchAction): void {
    if (action === 'up' || action === 'down') this.refreshDirection(action);
    else if (action === 'pulse') this.actions.pulse();
    else this.actions.adjust(action === 'stronger' ? 1 : -1);
  }

  private refreshDirection(action: TouchAction): void {
    if (action !== 'up' && action !== 'down') return;
    const button = this.buttons.get(action)!;
    const held = [...this.pointers.values()].includes(action) || this.keys.get(button)!.size > 0;
    button.setAttribute('aria-pressed', String(held));
    this.actions.direction(action, held);
  }

  private bind(target: EventTarget, name: string, listener: EventListener): void {
    target.addEventListener(name, listener);
    this.releases.push(() => target.removeEventListener(name, listener));
  }
}
