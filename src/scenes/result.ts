import type { GameResult, InputSource, Scene, SceneContext, SceneParams } from '../core/types';

/** 結果画面（仮実装）。Issue「A4: タイトル・結果画面」で本実装する。 */
export class ResultScene implements Scene<'result'> {
  private ctx!: SceneContext;
  private result!: GameResult;
  private source!: InputSource;
  enter(ctx: SceneContext, params: SceneParams['result']): void {
    this.ctx = ctx;
    this.result = params.result;
    this.source = params.source;
  }
  update(): void {}
  render(g: CanvasRenderingContext2D): void {
    g.fillStyle = '#1b2033';
    g.fillRect(0, 0, g.canvas.width, g.canvas.height);
    g.fillStyle = '#fff';
    g.font = 'bold 48px system-ui';
    g.fillText(this.result.outcome === 'clear' ? 'CLEAR!' : 'GAME OVER', 480, 280);
    g.font = '24px system-ui';
    g.fillText(`SCORE ${this.result.score}  音符 ${this.result.notesCollected}/${this.result.notesTotal}`, 460, 360);
    g.fillText('R: リトライ / Esc: タイトルへ', 470, 420);
  }
  exit(): void {}
  onKeyDown(e: KeyboardEvent): void {
    if (e.code === 'KeyR') this.ctx.goTo('play', { source: this.source });
    if (e.code === 'Escape') this.ctx.goTo('title', undefined);
  }
}
