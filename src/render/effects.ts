import { VIEW } from '../core/config';

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  color: string;
}

interface Popup {
  x: number;
  y: number;
  text: string;
  life: number;
}

const PARTICLE_LIFE = 0.6;
const POPUP_LIFE = 0.9;
const SHAKE_SEC = 0.35;
const FLASH_SEC = 0.25;

/**
 * 収集・被弾の演出（P1）。ワールド座標で持ち、描画時にカメラ位置を引く。
 * ゲーム進行には影響しない（見た目だけ）。
 */
export class Effects {
  private particles: Particle[] = [];
  private popups: Popup[] = [];
  private shake = 0;
  private flash = 0;
  /** 今フレームの揺れ。update でだけ決めるので、ポーズ中は動かない。 */
  private offset = { dx: 0, dy: 0 };

  collect(x: number, y: number, points: number): void {
    for (let i = 0; i < 14; i++) {
      const a = (Math.PI * 2 * i) / 14 + Math.random() * 0.3;
      const v = 120 + Math.random() * 120;
      this.particles.push({
        x,
        y,
        vx: Math.cos(a) * v,
        vy: Math.sin(a) * v,
        life: PARTICLE_LIFE,
        color: i % 2 ? '#ffd34d' : '#fff3b0',
      });
    }
    this.popups.push({ x, y: y + 30, text: `+${points}`, life: POPUP_LIFE });
  }

  hit(): void {
    this.shake = SHAKE_SEC;
    this.flash = FLASH_SEC;
  }

  update(dtSec: number): void {
    for (const p of this.particles) {
      p.x += p.vx * dtSec;
      p.y += p.vy * dtSec;
      p.vy -= 300 * dtSec; // ワールド座標は上向きなので重力はマイナス
      p.life -= dtSec;
    }
    this.particles = this.particles.filter((p) => p.life > 0);
    for (const p of this.popups) {
      p.y += 60 * dtSec;
      p.life -= dtSec;
    }
    this.popups = this.popups.filter((p) => p.life > 0);
    this.shake = Math.max(0, this.shake - dtSec);
    this.flash = Math.max(0, this.flash - dtSec);
    const k = (this.shake / SHAKE_SEC) * 10;
    this.offset = this.shake > 0 ? { dx: (Math.random() * 2 - 1) * k, dy: (Math.random() * 2 - 1) * k } : { dx: 0, dy: 0 };
  }

  /** 画面の揺れ（px）。描画の前に translate する。 */
  shakeOffset(): { dx: number; dy: number } {
    return this.offset;
  }

  draw(g: CanvasRenderingContext2D, cameraX: number): void {
    for (const p of this.particles) {
      g.globalAlpha = Math.max(0, p.life / PARTICLE_LIFE);
      g.fillStyle = p.color;
      g.beginPath();
      g.arc(p.x - cameraX, VIEW.height - p.y, 4, 0, Math.PI * 2);
      g.fill();
    }
    g.font = 'bold 26px system-ui, sans-serif';
    g.textAlign = 'center';
    for (const p of this.popups) {
      g.globalAlpha = Math.max(0, p.life / POPUP_LIFE);
      g.fillStyle = '#ffd34d';
      g.fillText(p.text, p.x - cameraX, VIEW.height - p.y);
    }
    g.textAlign = 'start';
    g.globalAlpha = 1;
  }

  /** 被弾のフラッシュ。揺れの外（画面全体）に描く。 */
  drawFlash(g: CanvasRenderingContext2D): void {
    if (this.flash > 0) {
      g.fillStyle = `rgba(226,71,91,${(this.flash / FLASH_SEC) * 0.35})`;
      g.fillRect(0, 0, VIEW.width, VIEW.height);
    }
  }
}
