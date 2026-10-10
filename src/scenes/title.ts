import type { Scene, SceneContext } from '../core/types';
import { KeyboardInput } from '../input/keyboard';

/** 操作説明と入力モードを選ぶタイトル画面。DOM は exit() でまとめて解放する。 */
export class TitleScene implements Scene<'title'> {
  private ctx: SceneContext | null = null;
  private panel: HTMLElement | null = null;
  private leaving = false;

  enter(ctx: SceneContext): void {
    this.panel?.remove();
    this.ctx = ctx;
    this.leaving = false;
    const panel = document.createElement('section');
    panel.className = 'title-screen';
    panel.setAttribute('aria-labelledby', 'game-title');
    panel.innerHTML = `
      <style>
        .title-screen { position:absolute; inset:0; display:flex; flex-direction:column;
          align-items:center; justify-content:center; gap:clamp(8px,2vh,18px); box-sizing:border-box;
          padding:3%; overflow:auto; color:#edf4ff; text-align:center;
          font-size:clamp(12px,min(1.5vw,2.7vh),20px); }
        .title-screen h1 { margin:0; font-size:clamp(24px,min(4.6vw,8.2vh),64px); line-height:1.15; }
        .title-screen p { margin:0; }
        .title-screen .lead { color:#b1e8d2; font-size:1.25em; font-weight:700; }
        .title-screen .intro { color:#c3cee4; }
        .title-screen .voice-guide { display:grid; grid-template-columns:repeat(4,1fr);
          gap:12px; width:min(90%,880px); margin:8px 0; }
        .title-screen .voice-guide div { border:1px solid #59708b; border-radius:12px;
          padding:12px 6px; background:#182b40; }
        .title-screen .voice-guide strong { display:block; color:#a6edcf; font-size:1.1em; }
        .title-screen .actions { display:flex; justify-content:center; gap:16px; flex-wrap:wrap; }
        .title-screen button { font:inherit; font-weight:700; padding:12px 22px;
          border-radius:10px; border:1px solid #86cbb3; color:#102623; background:#a6edcf; cursor:pointer; }
        .title-screen button.secondary { color:#edf4ff; background:#263c55; border-color:#8397b5; }
        .title-screen button:hover { filter:brightness(1.12); }
        .title-screen button:focus-visible { outline:3px solid #fff; outline-offset:4px; }
        .title-screen .keys, .title-screen .privacy { color:#c3cee4; font-size:.85em; }
        @media (max-width:600px), (max-height:440px) {
          .title-screen { gap:6px; justify-content:flex-start; }
          .title-screen .voice-guide { gap:6px; margin:0; }
          .title-screen .voice-guide div { padding:6px 3px; }
          .title-screen button { padding:8px 14px; }
        }
      </style>
      <p class="lead">声で道をつくり、ゴールまで走れ！</p>
      <h1 id="game-title">Voice Terrain Runner</h1>
      <p class="intro">前方の地形を変えて音符を集め、障害物を避けよう。ライフは3つ。</p>
      <div class="voice-guide" aria-label="声による操作">
        <div><strong>高く歌う</strong>上り坂</div>
        <div><strong>低く歌う</strong>下り坂</div>
        <div><strong>大きな声</strong>変化を強く</div>
        <div><strong>タン、タン</strong>小さな波</div>
      </div>
      <div class="actions">
        <button type="button" data-mode="mic">マイクで遊ぶ（M）</button>
        <button type="button" class="secondary" data-mode="keyboard">ボタン・キーで遊ぶ（Enter）</button>
      </div>
      <p class="keys">キーボード：↑↓ 坂の向き ／ ←→・W/S 強さ ／ Space 波 ／ Esc ポーズ</p>
      <p class="mobile-guide">スマホは横向きがおすすめ。画面のボタンでも地形を操作できます。</p>
      <p class="privacy">マイクはブラウザ内で解析します。音声の録音保存・外部送信はしません。</p>
    `;
    panel.querySelector<HTMLButtonElement>('[data-mode="mic"]')!
      .addEventListener('click', () => this.choose('mic'));
    panel.querySelector<HTMLButtonElement>('[data-mode="keyboard"]')!
      .addEventListener('click', () => this.choose('keyboard'));
    ctx.ui.append(panel);
    this.panel = panel;
  }

  update(): void {}

  render(g: CanvasRenderingContext2D): void {
    const { width, height } = g.canvas;
    g.save();
    const sky = g.createLinearGradient(0, 0, width, height);
    sky.addColorStop(0, '#152238');
    sky.addColorStop(1, '#203b48');
    g.fillStyle = sky;
    g.fillRect(0, 0, width, height);
    g.fillStyle = '#2f655a';
    g.beginPath();
    g.moveTo(0, height * 0.88);
    g.bezierCurveTo(width * 0.2, height * 0.65, width * 0.4, height, width * 0.6, height * 0.87);
    g.bezierCurveTo(width * 0.8, height * 0.7, width * 0.9, height * 0.95, width, height * 0.8);
    g.lineTo(width, height);
    g.lineTo(0, height);
    g.closePath();
    g.fill();
    g.restore();
  }

  exit(): void {
    this.leaving = true;
    this.panel?.remove();
    this.panel = null;
    this.ctx = null;
  }

  onKeyDown(e: KeyboardEvent): void {
    if (e.code !== 'Enter' && e.code !== 'KeyM') return;
    // フォーカスしたボタンの Enter は、ブラウザ標準のクリックに任せる。
    if (e.code === 'Enter' && e.target instanceof HTMLElement && e.target.closest('button')) return;
    e.preventDefault();
    if (!e.repeat) this.choose(e.code === 'KeyM' ? 'mic' : 'keyboard');
  }

  private choose(mode: 'mic' | 'keyboard'): void {
    if (this.leaving || !this.ctx) return;
    this.leaving = true;
    if (mode === 'mic') this.ctx.goTo('micSetup', undefined);
    else this.ctx.goTo('play', { source: new KeyboardInput(window, this.ctx.ui) });
  }
}
