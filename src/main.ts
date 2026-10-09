import type { Scene, SceneContext, SceneName, SceneParams } from './core/types';
import { VIEW } from './core/config';
import { TitleScene } from './scenes/title';
import { MicSetupScene } from './scenes/micSetup';
import { PlayScene } from './scenes/play';
import { ResultScene } from './scenes/result';

const canvas = document.querySelector<HTMLCanvasElement>('#game')!;
const ui = document.querySelector<HTMLElement>('#ui')!;
const g = canvas.getContext('2d')!;
canvas.width = VIEW.width;
canvas.height = VIEW.height;

const factories: { [N in SceneName]: () => Scene<N> } = {
  title: () => new TitleScene(),
  micSetup: () => new MicSetupScene(),
  play: () => new PlayScene(),
  result: () => new ResultScene(),
};

let current: Scene | null = null;

const ctx: SceneContext = {
  canvas,
  g,
  ui,
  goTo(name, params) {
    current?.exit();
    ui.replaceChildren();
    const next = factories[name]() as Scene;
    current = next;
    next.enter(ctx, params as SceneParams[SceneName]);
  },
};

window.addEventListener('keydown', (e) => current?.onKeyDown?.(e));
document.addEventListener('visibilitychange', () => {
  if (document.hidden) current?.onHidden?.();
});

// ループは1本だけ。シーン側で requestAnimationFrame を呼ばないこと（重複ループ防止）。
let last = performance.now();
function frame(now: number) {
  const dt = Math.min((now - last) / 1000, 1 / 20); // タブ復帰時などの巨大な dt を抑える
  last = now;
  current?.update(dt, now);
  if (current) current.render(g);
  requestAnimationFrame(frame);
}

ctx.goTo('title', undefined);
requestAnimationFrame(frame);
