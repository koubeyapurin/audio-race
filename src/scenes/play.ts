import type { ControlInput, InputSource, Scene, SceneContext, SceneParams } from '../core/types';
import { NEUTRAL_INPUT } from '../core/types';
import { GAME } from '../core/config';
import { drawHud } from '../render/hud';

/** プレイ画面（仮実装）。レーンB の Issue で地形・ゲーム進行を実装する。 */
export class PlayScene implements Scene<'play'> {
  private ctx!: SceneContext;
  private source!: InputSource;
  private t = 0;
  private input: ControlInput = { ...NEUTRAL_INPUT };
  enter(ctx: SceneContext, params: SceneParams['play']): void {
    this.ctx = ctx;
    this.source = params.source;
    void this.source.start();
  }
  update(dtSec: number, nowMs: number): void {
    this.t += dtSec;
    this.input = this.source.read(nowMs);
    if (this.t > 3) {
      this.ctx.goTo('result', {
        result: { outcome: 'clear', score: 0, notesCollected: 0, notesTotal: 0 },
        source: this.source,
      });
    }
  }
  render(g: CanvasRenderingContext2D): void {
    g.fillStyle = '#1b2033';
    g.fillRect(0, 0, g.canvas.width, g.canvas.height);
    drawHud(g, {
      mode: this.source.kind,
      score: 0,
      lives: GAME.lives,
      progress: this.t / GAME.durationSec,
      remainingSec: GAME.durationSec - this.t,
      input: this.input,
      features: this.source.debugFeatures(),
    });
  }
  exit(): void {
    this.source.stop();
  }
}
