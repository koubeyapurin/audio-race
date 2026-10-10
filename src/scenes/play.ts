import type { ControlInput, InputSource, Scene, SceneContext, SceneParams } from '../core/types';
import { NEUTRAL_INPUT } from '../core/types';
import { GAME, STAGE_LENGTH, TERRAIN, VIEW } from '../core/config';
import { TerrainGenerator } from '../terrain/generator';
import { drawWorld } from '../render/world';
import { drawHud } from '../render/hud';

const LOOKAHEAD_PX = GAME.runSpeed * TERRAIN.lookaheadSec;
/** スタート地点の x（左側に少し地面を見せる）。 */
const START_X = GAME.runnerScreenX;

/** プレイ画面。地形生成・ランナー移動・描画をまとめる。 */
export class PlayScene implements Scene<'play'> {
  private ctx!: SceneContext;
  private source!: InputSource;
  private terrain!: TerrainGenerator;
  private devKeys = new DevKeys();
  private input: ControlInput = { ...NEUTRAL_INPUT };
  private countdown: number = GAME.countdownSec;
  private runSec = 0;
  private runnerX: number = START_X;
  private finished = false;

  enter(ctx: SceneContext, params: SceneParams['play']): void {
    this.ctx = ctx;
    this.source = params.source;
    this.terrain = new TerrainGenerator(START_X + LOOKAHEAD_PX);
    void this.source.start();
    if (this.source.kind === 'keyboard') this.devKeys.start();
  }

  update(dtSec: number, nowMs: number): void {
    this.input = this.devKeys.merge(this.source.read(nowMs));

    if (this.countdown > 0) {
      this.countdown -= dtSec;
      return;
    }
    if (this.finished) return;

    this.runSec += dtSec;
    this.runnerX = Math.min(START_X + this.runSec * GAME.runSpeed, START_X + STAGE_LENGTH);
    this.terrain.advance(this.input, this.runnerX + LOOKAHEAD_PX, dtSec);

    if (this.runnerX >= START_X + STAGE_LENGTH) {
      this.finished = true;
      this.ctx.goTo('result', {
        result: { outcome: 'clear', score: GAME.clearBonus, notesCollected: 0, notesTotal: 0 },
        source: this.source,
      });
    }
  }

  render(g: CanvasRenderingContext2D): void {
    const runner = { x: this.runnerX, y: this.terrain.heightAt(this.runnerX) };
    drawWorld(g, {
      terrain: this.terrain,
      runner,
      cameraX: this.runnerX - GAME.runnerScreenX,
      frontierX: this.terrain.generatedUntil,
      stageLength: START_X + STAGE_LENGTH,
      input: this.input,
      timeSec: this.runSec,
    });
    drawHud(g, {
      mode: this.source.kind,
      score: 0,
      lives: GAME.lives,
      progress: this.runSec / GAME.durationSec,
      remainingSec: Math.max(0, GAME.durationSec - this.runSec),
      input: this.input,
      features: this.source.debugFeatures(),
    });
    if (this.countdown > 0) drawCountdown(g, Math.ceil(this.countdown));
  }

  exit(): void {
    this.source.stop();
    this.devKeys.stop();
  }
}

function drawCountdown(g: CanvasRenderingContext2D, n: number): void {
  g.fillStyle = 'rgba(0,0,0,0.35)';
  g.fillRect(0, 0, VIEW.width, VIEW.height);
  g.fillStyle = '#fff';
  g.font = 'bold 120px system-ui, sans-serif';
  g.textAlign = 'center';
  g.fillText(String(n), VIEW.width / 2, VIEW.height / 2 + 40);
  g.textAlign = 'start';
}

/**
 * 【一時的】Issue #1（KeyboardInput 本実装）がマージされるまでの開発用キー入力。
 * 入力源が何も入力していない（active=false）ときだけ ↑↓/←→/Space を補う。
 * #1 マージ後に #9 で削除する。
 */
class DevKeys {
  private down = new Set<string>();
  private intensity = 0.5;
  private pulse = false;
  private onDown = (e: KeyboardEvent) => {
    if (['ArrowUp', 'ArrowDown', 'Space'].includes(e.code)) e.preventDefault();
    if (e.code === 'Space' && !e.repeat) this.pulse = true;
    if (e.code === 'ArrowRight' || e.code === 'KeyW') this.intensity = Math.min(1, this.intensity + 0.1);
    if (e.code === 'ArrowLeft' || e.code === 'KeyS') this.intensity = Math.max(0, this.intensity - 0.1);
    this.down.add(e.code);
  };
  private onUp = (e: KeyboardEvent) => this.down.delete(e.code);

  start(): void {
    this.stop();
    window.addEventListener('keydown', this.onDown);
    window.addEventListener('keyup', this.onUp);
  }

  stop(): void {
    window.removeEventListener('keydown', this.onDown);
    window.removeEventListener('keyup', this.onUp);
    this.down.clear();
  }

  merge(src: ControlInput): ControlInput {
    if (src.active || src.pulse) return src;
    const up = this.down.has('ArrowUp');
    const dn = this.down.has('ArrowDown');
    const slope = up === dn ? 0 : up ? 1 : -1;
    const pulse = this.pulse;
    this.pulse = false;
    return { slope, intensity: this.intensity, pulse, active: slope !== 0 || pulse };
  }
}
