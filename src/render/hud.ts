import type { HudModel } from '../core/types';

/** HUD（仮実装）。Issue「A5: HUD」で本実装する。 */
export function drawHud(g: CanvasRenderingContext2D, hud: HudModel): void {
  g.fillStyle = '#fff';
  g.font = '20px system-ui';
  g.fillText(`SCORE ${hud.score}   LIFE ${hud.lives}   残り ${hud.remainingSec.toFixed(0)}s`, 24, 36);
}
