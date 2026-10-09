import type { Scene, SceneContext } from '../core/types';

/** マイク準備画面（仮実装）。Issue「A3: マイク準備画面」で本実装する。 */
export class MicSetupScene implements Scene<'micSetup'> {
  private ctx!: SceneContext;
  enter(ctx: SceneContext): void {
    this.ctx = ctx;
  }
  update(): void {}
  render(g: CanvasRenderingContext2D): void {
    g.fillStyle = '#1b2033';
    g.fillRect(0, 0, g.canvas.width, g.canvas.height);
    g.fillStyle = '#fff';
    g.font = '24px system-ui';
    g.fillText('マイク準備画面（未実装） Esc: タイトルへ', 420, 360);
  }
  exit(): void {}
  onKeyDown(e: KeyboardEvent): void {
    if (e.code === 'Escape') this.ctx.goTo('title', undefined);
  }
}
