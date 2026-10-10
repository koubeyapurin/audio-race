import type { InputSource, Scene, SceneContext, SceneParams } from '../core/types';

const BEST_SCORE_KEY = 'voice-terrain-runner:best-score';

function recordBestScore(score: number): number | null {
  try {
    const saved = localStorage.getItem(BEST_SCORE_KEY);
    const previous = saved === null ? 0 : Number(saved);
    const best = Math.max(score, Number.isFinite(previous) && previous >= 0 ? previous : 0);
    localStorage.setItem(BEST_SCORE_KEY, String(best));
    return best;
  } catch {
    return null;
  }
}

/** リトライでは同じ入力源を引き継ぎ、画面を離れると DOM を解放する。 */
export class ResultScene implements Scene<'result'> {
  private ctx: SceneContext | null = null;
  private source: InputSource | null = null;
  private panel: HTMLElement | null = null;
  private leaving = false;
  private cleared = false;

  enter(ctx: SceneContext, params: SceneParams['result']): void {
    this.panel?.remove();
    this.ctx = ctx;
    this.source = params.source;
    this.source.stop();
    this.leaving = false;
    const result = params.result;
    this.cleared = result.outcome === 'clear';
    const best = recordBestScore(result.score);
    const panel = document.createElement('section');
    panel.className = 'result-screen';
    panel.setAttribute('aria-labelledby', 'result-title');
    panel.innerHTML = `
      <style>
        .result-screen { position:absolute; inset:0; display:flex; flex-direction:column;
          align-items:center; justify-content:center; gap:clamp(8px,2vh,18px); box-sizing:border-box;
          padding:3%; overflow:auto; color:#edf4ff; text-align:center;
          font-size:clamp(12px,min(1.5vw,2.7vh),20px); }
        .result-screen h1 { margin:0; font-size:clamp(30px,min(6vw,10vh),80px); line-height:1.1; }
        .result-screen p { margin:0; color:#c3cee4; }
        .result-screen .stats { display:flex; gap:clamp(16px,4vw,48px); margin:12px 0;
          padding:18px 36px; background:#192d42; border:1px solid #59708b; border-radius:16px; }
        .result-screen .stats dt { color:#c3cee4; font-size:.9em; }
        .result-screen .stats dd { margin:0; color:#a6edcf; font-size:2em; font-weight:700; }
        .result-screen .actions { display:flex; justify-content:center; gap:16px; flex-wrap:wrap; }
        .result-screen button { font:inherit; font-weight:700; padding:12px 24px;
          border-radius:10px; border:1px solid #86cbb3; color:#102623; background:#a6edcf; cursor:pointer; }
        .result-screen button.secondary { color:#edf4ff; background:#263c55; border-color:#8397b5; }
        .result-screen button:hover { filter:brightness(1.12); }
        .result-screen button:focus-visible { outline:3px solid #fff; outline-offset:4px; }
        .result-screen .mode, .result-screen .best { font-size:.9em; }
        @media (max-width:600px), (max-height:440px) {
          .result-screen { gap:6px; justify-content:flex-start; }
          .result-screen .stats { margin:0; padding:8px 20px; }
          .result-screen button { padding:8px 16px; }
        }
      </style>
      <h1 id="result-title"></h1>
      <p data-message></p>
      <dl class="stats">
        <div><dt>スコア</dt><dd data-score></dd></div>
        <div><dt>集めた音符</dt><dd data-notes></dd></div>
      </dl>
      <p class="best" data-best></p>
      <p class="mode" data-mode></p>
      <div class="actions">
        <button type="button" data-retry>リトライ（R）</button>
        <button type="button" class="secondary" data-title>タイトルへ（Esc）</button>
      </div>
    `;
    panel.querySelector('h1')!.textContent = this.cleared ? 'CLEAR!' : 'GAME OVER';
    panel.querySelector<HTMLElement>('[data-message]')!.textContent = this.cleared
      ? 'ゴール到達！ 次はもっと多くの音符を集めよう。' : 'もう一度、声やキーで道をつくって挑戦しよう。';
    panel.querySelector<HTMLElement>('[data-score]')!.textContent = result.score.toLocaleString('ja-JP');
    panel.querySelector<HTMLElement>('[data-notes]')!.textContent = `${result.notesCollected} / ${result.notesTotal}`;
    const bestLabel = panel.querySelector<HTMLElement>('[data-best]')!;
    bestLabel.hidden = best === null;
    bestLabel.textContent = best === null ? '' : `ベストスコア：${best.toLocaleString('ja-JP')}`;
    panel.querySelector<HTMLElement>('[data-mode]')!.textContent = this.source.kind === 'mic'
      ? 'マイク操作で再挑戦します。結果画面ではマイクは停止中です。' : 'キーボード操作で再挑戦します。';
    panel.querySelector<HTMLButtonElement>('[data-retry]')!.addEventListener('click', () => this.retry());
    panel.querySelector<HTMLButtonElement>('[data-title]')!.addEventListener('click', () => this.toTitle());
    ctx.ui.append(panel);
    this.panel = panel;
  }

  update(): void {}

  render(g: CanvasRenderingContext2D): void {
    g.save();
    const sky = g.createLinearGradient(0, 0, g.canvas.width, g.canvas.height);
    sky.addColorStop(0, '#152238');
    sky.addColorStop(1, this.cleared ? '#20453c' : '#3c293f');
    g.fillStyle = sky;
    g.fillRect(0, 0, g.canvas.width, g.canvas.height);
    g.restore();
  }

  exit(): void {
    this.leaving = true;
    this.panel?.remove();
    this.panel = null;
    this.ctx = null;
    this.source = null;
  }

  onKeyDown(e: KeyboardEvent): void {
    if (e.code !== 'KeyR' && e.code !== 'Escape') return;
    e.preventDefault();
    if (e.repeat) return;
    if (e.code === 'KeyR') this.retry();
    else this.toTitle();
  }

  private retry(): void {
    if (this.leaving || !this.ctx || !this.source) return;
    this.leaving = true;
    this.ctx.goTo('play', { source: this.source });
  }

  private toTitle(): void {
    if (this.leaving || !this.ctx) return;
    this.leaving = true;
    this.ctx.goTo('title', undefined);
  }
}
