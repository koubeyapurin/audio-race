import type { ControlInput, GameState, InputSource, Scene, SceneContext, SceneParams, StageItem } from '../core/types';
import { NEUTRAL_INPUT } from '../core/types';
import { GAME, TERRAIN, VIEW } from '../core/config';
import { TerrainGenerator } from '../terrain/generator';
import { drawWorld } from '../render/world';
import { drawHud } from '../render/hud';
import { buildStage, GOAL_X, START_X } from '../game/stage';
import { createGameState, isInvulnerable, runnerXAt, stepGame, toResult } from '../game/rules';

const LOOKAHEAD_PX = GAME.runSpeed * TERRAIN.lookaheadSec;

/** プレイ画面。地形生成・ランナー移動・描画をまとめる。 */
export class PlayScene implements Scene<'play'> {
  private ctx!: SceneContext;
  private source!: InputSource;
  private terrain!: TerrainGenerator;
  private devKeys = new DevKeys();
  private input: ControlInput = { ...NEUTRAL_INPUT };
  private countdown: number = GAME.countdownSec;
  private items: StageItem[] = buildStage();
  private state: GameState = createGameState();
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

    // 地形を先に伸ばしてから、その地形の上でランナーを進める
    const nextX = runnerXAt(this.state.elapsedSec + dtSec);
    this.terrain.advance(this.input, nextX + LOOKAHEAD_PX, dtSec);
    this.state = stepGame(this.state, dtSec, {
      heightAt: (x) => this.terrain.heightAt(x),
      items: this.items,
    }).state;

    if (this.state.phase === 'cleared' || this.state.phase === 'gameover') {
      this.finished = true;
      this.ctx.goTo('result', { result: toResult(this.state, this.items), source: this.source });
    }
  }

  render(g: CanvasRenderingContext2D): void {
    const s = this.state;
    const runner = { x: s.runner.x, y: this.terrain.heightAt(s.runner.x) };
    drawWorld(g, {
      terrain: this.terrain,
      runner,
      cameraX: s.runner.x - GAME.runnerScreenX,
      frontierX: this.terrain.generatedUntil,
      stageLength: GOAL_X,
      input: this.input,
      timeSec: s.elapsedSec,
      items: this.items,
      collectedIds: s.collectedIds,
      invulnerable: isInvulnerable(s),
    });
    drawHud(g, {
      mode: this.source.kind,
      score: s.score,
      lives: s.lives,
      progress: (s.runner.x - START_X) / (GOAL_X - START_X),
      remainingSec: Math.max(0, (GOAL_X - s.runner.x) / GAME.runSpeed),
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
export class DevKeys {
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
    // 入力源を優先するときも自分の pulse は必ず消費する（古い Space の二重発火を防ぐ #15）
    const pulse = this.pulse;
    this.pulse = false;
    if (src.active || src.pulse) return src;
    const up = this.down.has('ArrowUp');
    const dn = this.down.has('ArrowDown');
    const slope = up === dn ? 0 : up ? 1 : -1;
    return { slope, intensity: this.intensity, pulse, active: slope !== 0 || pulse };
  }
}
