import type { Scene, SceneContext } from '../core/types';
import { KeyboardInput } from '../input/keyboard';

/** タイトル画面（仮実装）。Issue「A4: タイトル・結果画面」で本実装する。 */
export class TitleScene implements Scene<'title'> {
  private ctx!: SceneContext;
  enter(ctx: SceneContext): void {
    this.ctx = ctx;
  }
  update(): void {}
  render(g: CanvasRenderingContext2D): void {
    g.fillStyle = '#1b2033';
    g.fillRect(0, 0, g.canvas.width, g.canvas.height);
    g.fillStyle = '#fff';
    g.font = 'bold 56px system-ui';
    g.fillText('Voice Terrain Runner', 340, 300);
    g.font = '24px system-ui';
    g.fillText('Enter: キーボードで開始 / M: マイクで開始', 400, 400);
  }
  exit(): void {}
  onKeyDown(e: KeyboardEvent): void {
    if (e.code === 'Enter') this.ctx.goTo('play', { source: new KeyboardInput() });
    if (e.code === 'KeyM') this.ctx.goTo('micSetup', undefined);
  }
}
