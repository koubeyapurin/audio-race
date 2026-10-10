import type { ControlInput, Terrain, Vec2 } from '../core/types';
import { GAME, VIEW } from '../core/config';

export interface WorldView {
  terrain: Terrain;
  runner: Vec2;
  /** 画面左端に対応するワールド x。 */
  cameraX: number;
  /** ここから先が「これから声で作る」地形。 */
  frontierX: number;
  stageLength: number;
  input: ControlInput;
  timeSec: number;
}

const COLORS = {
  skyTop: '#1b2340',
  skyBottom: '#3a3f6b',
  ground: '#3fbf7f',
  groundEdge: '#b6ffd6',
  future: 'rgba(255,255,255,0.35)',
  frontier: '#ffd34d',
  runner: '#ff6b8b',
  goal: '#ffffff',
} as const;

/** ワールド座標 → 画面座標（y は上向き → 下向きに反転）。 */
const sx = (v: WorldView, x: number) => x - v.cameraX;
const sy = (y: number) => VIEW.height - y;

export function drawWorld(g: CanvasRenderingContext2D, v: WorldView): void {
  drawSky(g);
  drawGoal(g, v);
  drawTerrain(g, v);
  drawFrontier(g, v);
  drawRunner(g, v);
}

function drawSky(g: CanvasRenderingContext2D): void {
  const grad = g.createLinearGradient(0, 0, 0, VIEW.height);
  grad.addColorStop(0, COLORS.skyTop);
  grad.addColorStop(1, COLORS.skyBottom);
  g.fillStyle = grad;
  g.fillRect(0, 0, VIEW.width, VIEW.height);
}

function drawTerrain(g: CanvasRenderingContext2D, v: WorldView): void {
  const pts = v.terrain.points(v.cameraX - 10, v.cameraX + VIEW.width + 10);
  if (pts.length < 2) return;

  g.beginPath();
  g.moveTo(sx(v, pts[0].x), VIEW.height);
  for (const p of pts) g.lineTo(sx(v, p.x), sy(p.y));
  g.lineTo(sx(v, pts[pts.length - 1].x), VIEW.height);
  g.closePath();
  g.fillStyle = COLORS.ground;
  g.fill();

  g.beginPath();
  pts.forEach((p, i) => (i === 0 ? g.moveTo(sx(v, p.x), sy(p.y)) : g.lineTo(sx(v, p.x), sy(p.y))));
  g.strokeStyle = COLORS.groundEdge;
  g.lineWidth = 4;
  g.stroke();

  // まだ生成されていない部分は点線で「未定」を表す
  const last = pts[pts.length - 1];
  if (last.x < v.cameraX + VIEW.width) {
    g.setLineDash([10, 10]);
    g.beginPath();
    g.moveTo(sx(v, last.x), sy(last.y));
    g.lineTo(VIEW.width, sy(last.y));
    g.strokeStyle = COLORS.future;
    g.lineWidth = 3;
    g.stroke();
    g.setLineDash([]);
  }
}

/** 生成ライン：ここで今の入力が地形になる。入力の向き・強さを矢印で予告する。 */
function drawFrontier(g: CanvasRenderingContext2D, v: WorldView): void {
  const x = sx(v, v.frontierX);
  const y = sy(v.terrain.heightAt(v.frontierX));

  g.fillStyle = 'rgba(255,211,77,0.08)';
  g.fillRect(x, 0, VIEW.width - x, VIEW.height);

  g.setLineDash([6, 8]);
  g.beginPath();
  g.moveTo(x, 40);
  g.lineTo(x, VIEW.height);
  g.strokeStyle = COLORS.frontier;
  g.lineWidth = 2;
  g.stroke();
  g.setLineDash([]);

  // 予告矢印
  const { slope, intensity, active, pulse } = v.input;
  const len = 40 + 60 * intensity;
  const angle = active ? -Math.atan(slope * 0.9) : 0;
  g.save();
  g.translate(x, y);
  g.rotate(angle);
  g.globalAlpha = active ? 1 : 0.4;
  g.beginPath();
  g.moveTo(0, 0);
  g.lineTo(len, 0);
  g.lineTo(len - 12, -9);
  g.moveTo(len, 0);
  g.lineTo(len - 12, 9);
  g.strokeStyle = COLORS.frontier;
  g.lineWidth = 5;
  g.lineCap = 'round';
  g.stroke();
  g.restore();

  if (pulse) {
    g.beginPath();
    g.arc(x, y, 26, 0, Math.PI * 2);
    g.strokeStyle = COLORS.frontier;
    g.lineWidth = 3;
    g.stroke();
  }

  g.fillStyle = COLORS.frontier;
  g.font = 'bold 16px system-ui, sans-serif';
  g.fillText('ここから先を声でつくる ▶', x + 8, 64);
}

function drawRunner(g: CanvasRenderingContext2D, v: WorldView): void {
  const x = sx(v, v.runner.x);
  const r = GAME.runnerRadius;
  const y = sy(v.runner.y) - r;
  const bob = Math.sin(v.timeSec * 18) * 2;

  g.beginPath();
  g.arc(x, y + bob, r, 0, Math.PI * 2);
  g.fillStyle = COLORS.runner;
  g.fill();
  g.beginPath();
  g.arc(x + 6, y - 4 + bob, 4, 0, Math.PI * 2);
  g.fillStyle = '#fff';
  g.fill();
}

function drawGoal(g: CanvasRenderingContext2D, v: WorldView): void {
  const x = sx(v, v.stageLength);
  if (x < -20 || x > VIEW.width + 20) return;
  g.fillStyle = COLORS.goal;
  g.fillRect(x - 2, 0, 4, VIEW.height);
  g.font = 'bold 28px system-ui, sans-serif';
  g.fillText('GOAL', x + 10, 110);
}
