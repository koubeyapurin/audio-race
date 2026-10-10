import type { ControlInput, GameState, InputSource, Scene, SceneContext, SceneParams, StageItem } from '../core/types';
import { NEUTRAL_INPUT } from '../core/types';
import { GAME, TERRAIN, VIEW } from '../core/config';
import { TerrainGenerator } from '../terrain/generator';
import { drawWorld } from '../render/world';
import { drawHud } from '../render/hud';
import { Effects } from '../render/effects';
import { buildStage, GOAL_X, START_X } from '../game/stage';
import { createGameState, isInvulnerable, runnerXAt, stepGame, toResult } from '../game/rules';

const LOOKAHEAD_PX = GAME.runSpeed * TERRAIN.lookaheadSec;

/** プレイ画面。地形生成・ランナー移動・描画をまとめる。 */
export class PlayScene implements Scene<'play'> {
  private ctx!: SceneContext;
  private source!: InputSource;
  private terrain!: TerrainGenerator;
  private input: ControlInput = { ...NEUTRAL_INPUT };
  private countdown: number = GAME.countdownSec;
  private items: StageItem[] = buildStage();
  private state: GameState = createGameState();
  private effects = new Effects();
  private finished = false;
  private exited = false;
  /** ポーズ中に入力源（マイク）を止めている間、ゲームを進めない。 */
  private paused = false;
  /** start() が終わるまで入力を読まない。 */
  private sourceReady = false;
  /** start() が進行中か（同時に2つ走らせない）。 */
  private starting = false;
  /** start() の途中で stop() したか（完了したら止めてやり直す）。 */
  private stoppedWhileStarting = false;
  private pauseMenu: HTMLElement | null = null;
  /** 常に見える一時停止ボタン（Esc キーのないスマホ向け、#34）。 */
  private pauseButton: HTMLButtonElement | null = null;

  enter(ctx: SceneContext, params: SceneParams['play']): void {
    this.ctx = ctx;
    this.source = params.source;
    this.terrain = new TerrainGenerator(START_X + LOOKAHEAD_PX);
    this.startSource();
    this.createPauseButton();
  }

  update(dtSec: number, nowMs: number): void {
    if (this.paused || this.finished) return;
    this.input = this.sourceReady ? this.source.read(nowMs) : { ...NEUTRAL_INPUT };

    if (this.countdown > 0) {
      // 入力源（マイク）の準備ができるまでカウントダウンを進めない
      if (this.sourceReady) this.countdown -= dtSec;
      return;
    }

    // 地形を先に伸ばしてから、その地形の上でランナーを進める
    const nextX = runnerXAt(this.state.elapsedSec + dtSec);
    this.terrain.advance(this.input, nextX + LOOKAHEAD_PX, dtSec);
    const { state, events } = stepGame(this.state, dtSec, {
      heightAt: (x) => this.terrain.heightAt(x),
      items: this.items,
    });
    this.state = state;
    for (const e of events) {
      if (e.type === 'collect') {
        const item = this.items.find((i) => i.id === e.itemId);
        if (item) this.effects.collect(item.x, item.y, GAME.notePoints);
      } else if (e.type === 'hit') {
        this.effects.hit();
      }
    }
    this.effects.update(dtSec);

    if (this.state.phase === 'cleared' || this.state.phase === 'gameover') {
      this.finished = true;
      this.ctx.goTo('result', { result: toResult(this.state, this.items), source: this.source });
    }
  }

  render(g: CanvasRenderingContext2D): void {
    const s = this.state;
    const runner = { x: s.runner.x, y: this.terrain.heightAt(s.runner.x) };
    const cameraX = s.runner.x - GAME.runnerScreenX;
    const { dx, dy } = this.effects.shakeOffset();
    g.save();
    g.translate(dx, dy);
    drawWorld(g, {
      terrain: this.terrain,
      runner,
      cameraX,
      frontierX: this.terrain.generatedUntil,
      stageLength: GOAL_X,
      input: this.input,
      timeSec: s.elapsedSec,
      items: this.items,
      collectedIds: s.collectedIds,
      invulnerable: isInvulnerable(s),
    });
    this.effects.draw(g, cameraX);
    g.restore();
    this.effects.drawFlash(g);
    drawHud(g, {
      mode: this.source.kind,
      score: s.score,
      lives: s.lives,
      progress: (s.runner.x - START_X) / (GOAL_X - START_X),
      remainingSec: Math.max(0, (GOAL_X - s.runner.x) / GAME.runSpeed),
      input: this.input,
      features: this.source.debugFeatures(),
    });
    if (this.paused) drawPaused(g, this.source.kind === 'mic');
    else if (this.countdown > 0) drawCountdown(g, Math.ceil(this.countdown));
  }

  exit(): void {
    this.exited = true;
    this.sourceReady = false;
    this.source.stop();
    this.closePauseMenu();
    this.pauseButton?.remove();
    this.pauseButton = null;
  }

  onKeyDown(e: KeyboardEvent): void {
    if (e.code === 'Escape') {
      e.preventDefault();
      if (this.paused) this.resume();
      else this.pause();
    } else if (this.paused && e.code === 'Enter') {
      e.preventDefault();
      this.resume();
    } else if (this.paused && e.code === 'KeyT') {
      this.ctx.goTo('title', undefined);
    }
  }

  /** タブが隠れたら自動でポーズ（戻ってきたときに勝手に進んでいないように）。 */
  onHidden(): void {
    this.pause();
  }

  /** ポーズ：ゲームを止め、マイクも止める（F09）。 */
  pause(): void {
    if (this.paused || this.finished || this.exited) return;
    this.paused = true;
    this.sourceReady = false;
    this.source.stop();
    if (this.starting) this.stoppedWhileStarting = true;
    this.openPauseMenu();
    this.updatePauseButton();
  }

  /** 再開：入力源を再開し、1秒のカウントダウンをはさむ。 */
  resume(): void {
    if (!this.paused || this.exited) return;
    this.paused = false;
    this.closePauseMenu();
    this.updatePauseButton();
    this.countdown = Math.max(this.countdown, RESUME_COUNTDOWN_SEC);
    this.startSource();
  }

  /** 入力源を開始する。終わる前にシーンを離れたりポーズしたりしたら、すぐ止める。 */
  private startSource(): void {
    this.sourceReady = false;
    if (this.starting) return; // 進行中の start の完了を待つ（下でやり直す）
    this.starting = true;
    this.stoppedWhileStarting = false;
    this.source.start().then(
      () => {
        this.starting = false;
        if (this.exited || this.paused) {
          this.source.stop();
          return;
        }
        if (this.stoppedWhileStarting) {
          // 途中で stop されていた：入力源の実装によっては古いストリームが残るので、止めてやり直す
          // TODO(#34): ここはタップの外。iOS で開き直せない場合は、ポーズ画面に戻して ▶ を押してもらう案（実機で確認してから）
          this.source.stop();
          this.startSource();
          return;
        }
        this.sourceReady = true;
      },
      (err: unknown) => {
        this.starting = false;
        console.error('[play] 入力の開始に失敗しました', err);
        if (!this.exited) this.ctx.goTo('title', undefined);
      },
    );
  }

  private openPauseMenu(): void {
    if (typeof document === 'undefined') return;
    const menu = document.createElement('div');
    menu.className = 'pause-menu';
    // 狭い画面や横向きの低い画面でも収まるように折り返す。下の手動操作エリア（#33）は避ける
    menu.style.cssText =
      'position:absolute;left:50%;top:min(60%, calc(100% - 200px));transform:translate(-50%,0);' +
      'display:flex;flex-wrap:wrap;justify-content:center;gap:12px;width:max-content;max-width:90%;';
    const button = (label: string, onClick: () => void) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = label;
      b.style.cssText =
        'font-size:20px;min-height:44px;padding:10px 24px;border-radius:8px;border:0;cursor:pointer;';
      b.addEventListener('click', onClick);
      menu.append(b);
    };
    button('再開（Esc）', () => this.resume());
    button('タイトルへ（T）', () => this.ctx.goTo('title', undefined));
    this.ctx.ui.append(menu);
    this.pauseMenu = menu;
  }

  /** 右上の一時停止ボタン。タップで pause / resume の既存の経路を通る。 */
  private createPauseButton(): void {
    if (typeof document === 'undefined') return;
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'pause-button';
    b.style.cssText =
      // 右上の自己ベスト表示（HUD）の左隣の空き。下の手動操作エリア（#33）は避ける
      'position:absolute;top:max(8px, env(safe-area-inset-top));right:21%;' +
      'width:44px;height:44px;font-size:20px;line-height:1;border-radius:22px;border:2px solid rgba(255,255,255,.6);' +
      'background:rgba(16,19,28,.7);color:#fff;cursor:pointer;touch-action:manipulation;';
    // マウスで押してもフォーカスを残さない（残ると、ポーズ中の Enter でボタンも押されてしまう）
    b.addEventListener('mousedown', (e) => e.preventDefault());
    b.addEventListener('click', () => {
      b.blur();
      if (this.paused) this.resume();
      else this.pause();
    });
    this.ctx.ui.append(b);
    this.pauseButton = b;
    this.updatePauseButton();
  }

  private updatePauseButton(): void {
    if (!this.pauseButton) return;
    this.pauseButton.textContent = this.paused ? '▶' : 'Ⅱ';
    this.pauseButton.setAttribute('aria-label', this.paused ? '再開' : '一時停止');
  }

  private closePauseMenu(): void {
    this.pauseMenu?.remove();
    this.pauseMenu = null;
  }
}

const RESUME_COUNTDOWN_SEC = 1;

function drawPaused(g: CanvasRenderingContext2D, mic: boolean): void {
  g.fillStyle = 'rgba(0,0,0,0.55)';
  g.fillRect(0, 0, VIEW.width, VIEW.height);
  g.fillStyle = '#fff';
  g.font = 'bold 72px system-ui, sans-serif';
  g.textAlign = 'center';
  g.fillText('PAUSE', VIEW.width / 2, VIEW.height / 2 - 20);
  g.font = '22px system-ui, sans-serif';
  const note = mic ? '　（マイクは停止中）' : '';
  g.fillText(`Esc / Enter: 再開　T: タイトルへ${note}`, VIEW.width / 2, VIEW.height / 2 + 30);
  g.textAlign = 'start';
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

