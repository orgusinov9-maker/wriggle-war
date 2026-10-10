import { Terrain } from '../world/terrain';
import { Theme, hexToRgb } from '../world/themes';

interface Debris {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  color: string;
  size: number;
}

interface Puff {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  radius: number;
}

interface Blast {
  x: number;
  y: number;
  radius: number;
  life: number;
  maxLife: number;
}

interface Popup {
  x: number;
  y: number;
  text: string;
  life: number;
  maxLife: number;
  color: string;
}

interface Splash {
  x: number;
  y: number;
  life: number;
  maxLife: number;
}

const FLAME_COLORS = ['#fff4b0', '#ffd24a', '#ff9a2a', '#ff5a1a'];

/**
 * All the short-lived visual noise: fireballs, smoke, flying dirt, water
 * splashes and damage numbers. Purely cosmetic - nothing here touches the
 * simulation, so it can never desync the physics.
 */
export class Particles {
  private debris: Debris[] = [];
  private puffs: Puff[] = [];
  private blasts: Blast[] = [];
  private popups: Popup[] = [];
  private splashes: Splash[] = [];
  private readonly dirtColors: string[];
  /** Screen shake amount, in world pixels, decayed every tick. */
  shake = 0;

  constructor(private readonly theme: Theme) {
    const light = hexToRgb(theme.dirtLight);
    const dark = hexToRgb(theme.dirtDark);
    this.dirtColors = [0, 0.35, 0.7, 1].map((t) => {
      const r = Math.round(dark[0] + (light[0] - dark[0]) * t);
      const g = Math.round(dark[1] + (light[1] - dark[1]) * t);
      const b = Math.round(dark[2] + (light[2] - dark[2]) * t);
      return `rgb(${r},${g},${b})`;
    });
  }

  /** Fireball, smoke ring and a spray of dirt, scaled to the blast size. */
  explosion(x: number, y: number, radius: number): void {
    this.blasts.push({ x, y, radius, life: 0, maxLife: 22 });
    this.shake = Math.min(9, this.shake + radius * 0.14);

    const count = Math.round(radius * 1.6);
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const speed = 1.2 + Math.random() * radius * 0.14;
      this.debris.push({
        x: x + Math.cos(a) * radius * 0.4,
        y: y + Math.sin(a) * radius * 0.4,
        vx: Math.cos(a) * speed,
        vy: Math.sin(a) * speed - 1.2,
        life: 0,
        maxLife: 40 + Math.random() * 50,
        color: this.dirtColors[(Math.random() * this.dirtColors.length) | 0],
        size: 1 + Math.round(Math.random() * 2),
      });
    }

    for (let i = 0; i < Math.round(radius * 0.5); i++) {
      const a = Math.random() * Math.PI * 2;
      const d = Math.random() * radius * 0.8;
      this.puffs.push({
        x: x + Math.cos(a) * d,
        y: y + Math.sin(a) * d,
        vx: Math.cos(a) * 0.25,
        vy: -0.3 - Math.random() * 0.4,
        life: 0,
        maxLife: 34 + Math.random() * 26,
        radius: radius * (0.2 + Math.random() * 0.3),
      });
    }
  }

  /** A blowtorch's jet: a small hot core and sparks spat along its direction. */
  flame(x: number, y: number, dx: number, dy: number): void {
    this.blasts.push({ x, y, radius: 5 + Math.random() * 2, life: 0, maxLife: 5 });
    for (let i = 0; i < 3; i++) {
      const spread = (Math.random() - 0.5) * 1.2;
      const speed = 1 + Math.random() * 1.8;
      this.debris.push({
        x,
        y,
        vx: (dx - dy * spread) * speed,
        vy: (dy + dx * spread) * speed - 0.6,
        life: 0,
        maxLife: 8 + Math.random() * 10,
        color: FLAME_COLORS[(Math.random() * FLAME_COLORS.length) | 0],
        size: 1,
      });
    }
  }

  splash(x: number, y: number): void {
    this.splashes.push({ x, y, life: 0, maxLife: 26 });
  }

  damage(x: number, y: number, amount: number, color: string): void {
    this.popups.push({ x, y, text: String(amount), life: 0, maxLife: 70, color });
  }

  tick(terrain: Terrain): void {
    this.shake *= 0.86;
    if (this.shake < 0.1) this.shake = 0;

    for (let i = this.debris.length - 1; i >= 0; i--) {
      const d = this.debris[i];
      d.vy += 0.17;
      d.x += d.vx;
      d.y += d.vy;
      d.life++;
      // Dirt clods stop dead when they hit the ground, like flung earth should.
      if (d.life >= d.maxLife || terrain.solid(d.x, d.y) || d.y > terrain.height + 60) {
        this.debris.splice(i, 1);
      }
    }

    for (let i = this.puffs.length - 1; i >= 0; i--) {
      const p = this.puffs[i];
      p.x += p.vx;
      p.y += p.vy;
      p.vy *= 0.97;
      p.life++;
      if (p.life >= p.maxLife) this.puffs.splice(i, 1);
    }

    for (let i = this.blasts.length - 1; i >= 0; i--) {
      if (++this.blasts[i].life >= this.blasts[i].maxLife) this.blasts.splice(i, 1);
    }
    for (let i = this.splashes.length - 1; i >= 0; i--) {
      if (++this.splashes[i].life >= this.splashes[i].maxLife) this.splashes.splice(i, 1);
    }
    for (let i = this.popups.length - 1; i >= 0; i--) {
      const p = this.popups[i];
      p.y -= 0.38;
      p.life++;
      if (p.life >= p.maxLife) this.popups.splice(i, 1);
    }
  }

  /** Smoke and dirt sit behind the worms; the fireball goes in front. */
  drawBehind(ctx: CanvasRenderingContext2D): void {
    ctx.save();
    for (const p of this.puffs) {
      const t = p.life / p.maxLife;
      ctx.globalAlpha = (1 - t) * 0.32;
      ctx.fillStyle = t < 0.35 ? '#6b6b6b' : '#8d8d8d';
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.radius * (0.6 + t * 1.5), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    for (const d of this.debris) {
      const t = d.life / d.maxLife;
      ctx.globalAlpha = t > 0.75 ? (1 - t) * 4 : 1;
      ctx.fillStyle = d.color;
      ctx.fillRect(Math.round(d.x), Math.round(d.y), d.size, d.size);
    }
    ctx.restore();
  }

  drawFront(ctx: CanvasRenderingContext2D): void {
    ctx.save();
    for (const b of this.blasts) {
      const t = b.life / b.maxLife;
      const r = b.radius * (0.35 + t * 1.15);
      ctx.globalAlpha = 1 - t;
      const g = ctx.createRadialGradient(b.x, b.y, 0, b.x, b.y, r);
      g.addColorStop(0, '#fffbe0');
      g.addColorStop(0.35, '#ffd24a');
      g.addColorStop(0.7, '#ff7a1a');
      g.addColorStop(1, 'rgba(120,30,0,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(b.x, b.y, r, 0, Math.PI * 2);
      ctx.fill();
    }

    for (const s of this.splashes) {
      const t = s.life / s.maxLife;
      ctx.globalAlpha = (1 - t) * 0.8;
      ctx.strokeStyle = this.theme.water[0];
      ctx.lineWidth = 2;
      for (let k = 0; k < 6; k++) {
        const a = -Math.PI / 2 + (k - 2.5) * 0.3;
        const len = 16 * (1 - t) + 6;
        ctx.beginPath();
        ctx.moveTo(s.x, s.y);
        ctx.lineTo(s.x + Math.cos(a) * len, s.y + Math.sin(a) * len * (1 - t * 0.5));
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  /** Damage numbers, drawn in screen space so they stay readable at any zoom. */
  drawPopups(ctx: CanvasRenderingContext2D, toScreen: (x: number, y: number) => { x: number; y: number }): void {
    ctx.save();
    ctx.font = 'bold 15px Verdana, sans-serif';
    ctx.textAlign = 'center';
    for (const p of this.popups) {
      const t = p.life / p.maxLife;
      const s = toScreen(p.x, p.y);
      ctx.globalAlpha = t > 0.6 ? (1 - t) / 0.4 : 1;
      ctx.lineWidth = 3;
      ctx.strokeStyle = 'rgba(0,0,0,.75)';
      ctx.strokeText(p.text, s.x, s.y);
      ctx.fillStyle = p.color;
      ctx.fillText(p.text, s.x, s.y);
    }
    ctx.restore();
  }
}
