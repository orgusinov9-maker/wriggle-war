import { Camera } from './camera';
import { Particles } from './particles';
import { Worm } from '../entities/worm';
import { Projectile } from '../entities/projectile';
import { Grave } from '../entities/grave';
import { AirStrike } from '../entities/airstrike';
import { WEAPONS, WeaponId, WeaponSpec } from '../entities/weapons';
import { Tracer } from '../match';
import { menuLayout, TILE } from './menuLayout';
import { GeneratedMap } from '../world/mapgen';
import { Noise2D } from '../core/noise';
import { Rng } from '../core/rng';
import { TEAM_COLORS } from './palette';
import {
  LOOK_STEPS,
  SPRITE_ORIGIN,
  TILT_STEPS,
  TUMBLE_FRAMES,
  WALK_FRAMES,
  WormPose,
  WormSprites,
} from './wormSprite';
import { HAND, HELD_ORIGIN, HeldSprites } from './heldSprite';
import { girderCells, girderColor } from '../world/girder';

export { TEAM_COLORS } from './palette';

interface Cloud {
  x: number;
  y: number;
  scale: number;
  speed: number;
}

/** One parallax hill layer: a silhouette plus how much it lags the camera. */
interface HillLayer {
  points: { x: number; y: number }[];
  color: string;
  parallax: number;
}

/** One entry in the team strip along the bottom of the screen. */
export interface TeamStatus {
  readonly name: string;
  readonly color: string;
  readonly health: number;
  readonly maxHealth: number;
  readonly active: boolean;
}

export interface RenderState {
  readonly worms: readonly Worm[];
  readonly activeWorm: Worm | null;
  readonly projectiles: readonly Projectile[];
  readonly graves: readonly Grave[];
  readonly aimDistance: number;
  /** 0..1 while the fire key is held, otherwise null. */
  readonly charge: number | null;
  readonly wind: number;
  readonly airstrikes: readonly AirStrike[];
  readonly tracers: readonly Tracer[];
  readonly weapon: WeaponSpec;
  readonly ammo: Record<WeaponId, number>;
  readonly fuseSeconds: number | null;
  /** Open weapon panel, with the tile under the pointer highlighted. */
  readonly menuOpen: boolean;
  readonly menuHover: WeaponId | null;
  /** Chosen aim point for a targeted weapon, in world space. */
  readonly target: { x: number; y: number } | null;
  /** True while a targeted weapon is selected but no point has been picked. */
  readonly awaitingTarget: boolean;
  readonly waterLevel: number;
  /** Turn clock; null outside a running turn. */
  readonly secondsLeft: number | null;
  readonly teams: readonly TeamStatus[];
  readonly round: number;
  readonly suddenDeath: boolean;
  readonly banner: string | null;
  /** The crosshair only shows while the player actually has control. */
  readonly interactive: boolean;
  /** Weapon the active worm has out, or null when it is walking, flying or done firing. */
  readonly holding: WeaponId | null;
  /** Angle to hold it at when it is not the worm's own aim - the blowtorch snaps to 45 degrees. */
  readonly holdAim: number | null;
  /** Where a girder would go under the pointer, and whether it is allowed there. */
  readonly girderGhost: { x: number; y: number; step: number; ok: boolean } | null;
  /** The active worm's rope: hook first, then every corner it is wrapped round. */
  readonly rope: readonly { x: number; y: number }[] | null;
  /** Weapon panel scale - larger on a touch device so tiles clear a fingertip. */
  readonly menuScale: number;
}

export class Renderer {
  private readonly clouds: Cloud[] = [];
  private readonly hills: HillLayer[] = [];
  private frame = 0;
  private readonly wormSprites = new WormSprites();
  private readonly heldSprites = new HeldSprites();

  constructor(
    private readonly ctx: CanvasRenderingContext2D,
    private readonly camera: Camera,
    private readonly map: GeneratedMap,
    private readonly particles: Particles,
  ) {
    const rng = new Rng(map.seed ^ 0x9e3779b9);
    const noise = new Noise2D(rng);

    for (let i = 0; i < 14; i++) {
      this.clouds.push({
        x: rng.range(0, map.terrain.width),
        y: -map.terrain.height * 0.35 + rng.range(0, map.terrain.height * 0.55),
        scale: rng.range(0.6, 2.2),
        speed: rng.range(0.06, 0.2),
      });
    }

    // Three ridgelines behind the playfield. They are generated from the map
    // seed, so a given seed always gets the same skyline.
    const parallax = [0.28, 0.46, 0.66];
    for (let layer = 0; layer < 3; layer++) {
      const points: { x: number; y: number }[] = [];
      const base = map.terrain.height * (0.46 + layer * 0.12);
      const amp = map.terrain.height * (0.3 - layer * 0.07);
      const freq = 0.0013 + layer * 0.0009;
      const off = rng.range(0, 400);
      for (let x = -400; x <= map.terrain.width + 400; x += 12) {
        points.push({ x, y: base - noise.fbm(x * freq + off, 5.5 + layer, 4) * amp });
      }
      this.hills.push({ points, color: map.theme.hills[layer], parallax: parallax[layer] });
    }
  }

  tick(): void {
    this.frame++;
    for (const c of this.clouds) {
      c.x += c.speed;
      if (c.x > this.map.terrain.width + 400) c.x = -400;
    }
  }

  draw(state: RenderState): void {
    const { ctx, camera } = this;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.drawSky();
    this.drawHills();

    // Screen shake is applied as a camera offset, so everything in the world
    // shakes together and the HUD stays rock steady.
    const shake = this.particles.shake;
    const sx = shake ? (Math.random() - 0.5) * shake : 0;
    const sy = shake ? (Math.random() - 0.5) * shake : 0;
    camera.apply(ctx);
    ctx.translate(sx, sy);
    ctx.imageSmoothingEnabled = false;

    this.drawClouds();
    ctx.drawImage(this.map.terrain.canvas, 0, 0);
    this.particles.drawBehind(ctx);
    for (const grave of state.graves) this.drawGrave(grave);

    for (const worm of state.worms) {
      if (!worm.alive) continue;
      const active = worm === state.activeWorm;
      if (active && state.rope) this.drawRope(worm, state.rope);
      this.drawWorm(worm, active, active ? state.rope : null);
      if (active && state.holding) this.drawHeld(worm, state.holding, state.holdAim ?? worm.aim);
    }
    for (const p of state.projectiles) this.drawProjectile(p);
    for (const plane of state.airstrikes) this.drawPlane(plane);
    this.drawTracers(state.tracers);
    if (state.target) this.drawTargetMark(state.target);
    if (state.girderGhost && !state.menuOpen) this.drawGirderGhost(state.girderGhost);

    this.particles.drawFront(ctx);
    if (state.interactive && state.activeWorm && state.activeWorm.alive && state.weapon.mode !== 'girder') {
      this.drawCrosshair(state.activeWorm, state.aimDistance);
    }
    this.drawWater(state.waterLevel);

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    for (const worm of state.worms) {
      if (worm.alive) this.drawLabel(worm, worm === state.activeWorm);
    }
    this.particles.drawPopups(ctx, (x, y) => ({ x: camera.screenX(x), y: camera.screenY(y) }));
    this.drawWindGauge(state.wind);
    if (state.charge !== null) this.drawPowerBar(state.charge);
    this.drawWeaponBadge(state.weapon, state.ammo[state.weapon.id], state.fuseSeconds);
    this.drawTeamStrip(state.teams);
    this.drawTurnClock(state.secondsLeft, state.round, state.suddenDeath);
    if (state.awaitingTarget && !state.menuOpen) this.drawTargetPrompt();
    if (state.banner) this.drawBanner(state.banner);
    if (state.menuOpen) this.drawWeaponMenu(state.ammo, state.weapon.id, state.menuHover, state.menuScale);
  }

  private drawSky(): void {
    const { ctx, camera } = this;
    const [top, bottom] = this.map.theme.sky;
    const g = ctx.createLinearGradient(0, 0, 0, camera.viewHeight);
    g.addColorStop(0, top);
    g.addColorStop(1, bottom);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, camera.viewWidth, camera.viewHeight);

    // Soft sun glow, high and to one side.
    const gx = camera.viewWidth * 0.78;
    const gy = camera.viewHeight * 0.12;
    const glow = ctx.createRadialGradient(gx, gy, 0, gx, gy, camera.viewHeight * 0.5);
    glow.addColorStop(0, 'rgba(255,248,214,.45)');
    glow.addColorStop(1, 'rgba(255,248,214,0)');
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, camera.viewWidth, camera.viewHeight);
  }

  /** Ridgelines drawn in screen space at reduced camera response. */
  private drawHills(): void {
    const { ctx, camera } = this;
    for (const layer of this.hills) {
      ctx.save();
      ctx.beginPath();
      let started = false;
      for (const p of layer.points) {
        const x = (p.x - camera.x * layer.parallax) * camera.zoom + camera.viewWidth / 2;
        const y = (p.y - camera.y * layer.parallax) * camera.zoom + camera.viewHeight / 2;
        if (!started) {
          ctx.moveTo(x, y);
          started = true;
        } else {
          ctx.lineTo(x, y);
        }
      }
      ctx.lineTo(camera.viewWidth + 200, camera.viewHeight + 200);
      ctx.lineTo(-200, camera.viewHeight + 200);
      ctx.closePath();
      ctx.fillStyle = layer.color;
      ctx.globalAlpha = 0.55 + layer.parallax * 0.4;
      ctx.fill();
      ctx.restore();
    }
  }

  private drawClouds(): void {
    const { ctx } = this;
    ctx.save();
    ctx.globalAlpha = 0.3;
    ctx.fillStyle = '#ffffff';
    for (const c of this.clouds) {
      const s = c.scale;
      ctx.beginPath();
      ctx.ellipse(c.x, c.y, 46 * s, 14 * s, 0, 0, Math.PI * 2);
      ctx.ellipse(c.x - 30 * s, c.y + 5 * s, 26 * s, 10 * s, 0, 0, Math.PI * 2);
      ctx.ellipse(c.x + 34 * s, c.y + 4 * s, 30 * s, 11 * s, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  /** Two-tone animated sea, drawn last so worms sink into it. */
  private drawWater(level: number): void {
    const { ctx } = this;
    const width = this.map.terrain.width;
    const [light, dark] = this.map.theme.water;
    const t = this.frame * 0.03;

    ctx.save();
    ctx.globalAlpha = 0.78;
    ctx.fillStyle = dark;
    ctx.fillRect(-200, level + 4, width + 400, this.map.terrain.height + 300 - level);

    for (let band = 0; band < 4; band++) {
      ctx.globalAlpha = 0.55 - band * 0.11;
      ctx.fillStyle = band % 2 === 0 ? light : dark;
      ctx.beginPath();
      ctx.moveTo(-200, level + band * 5 + 8);
      for (let x = -200; x <= width + 200; x += 8) {
        ctx.lineTo(x, level + band * 5 + Math.sin(x * 0.019 + t + band * 1.3) * 2.4);
      }
      ctx.lineTo(width + 200, level + band * 5 + 8);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
  }

  /**
   * The worm, as a pixel-art frame from `WormSprites`. The pose follows what
   * the worm is doing; the pupils follow its aim. Drawn at whole world pixels
   * with smoothing off, so it stays crisp at every zoom.
   */
  private drawWorm(worm: Worm, active: boolean, rope: readonly { x: number; y: number }[] | null): void {
    const { ctx } = this;
    const color = TEAM_COLORS[worm.teamIndex % TEAM_COLORS.length];
    const airborne = worm.state === 'airborne' || worm.state === 'flying';

    // Contact shadow, so the worm sits on the ground instead of floating on it.
    if (!airborne) {
      ctx.save();
      ctx.globalAlpha = 0.22;
      ctx.fillStyle = '#000';
      ctx.beginPath();
      ctx.ellipse(worm.x, worm.y + 5.5, 6.5, 1.5, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    let pose: WormPose;
    if (worm.state === 'roped' && rope && rope.length > 0) {
      // Hanging, the body lines up with the rope toward its pivot.
      const pivot = rope[rope.length - 1];
      const lean = Math.atan2(pivot.x - worm.x, worm.y - pivot.y) * worm.facing;
      const tilt = Math.round((lean / 0.6) * TILT_STEPS);
      pose = { kind: 'jump', tilt: Math.max(-TILT_STEPS, Math.min(TILT_STEPS, tilt)) };
    } else if (worm.state === 'flying') {
      pose = { kind: 'tumble', turn: Math.floor(worm.animTick / 2) % TUMBLE_FRAMES };
    } else if (worm.state === 'airborne') {
      // Leans back while rising and pitches forward on the way down.
      const angle = Math.atan2(worm.vy, Math.abs(worm.vx) + 1.5) * 0.7;
      const tilt = Math.round((angle / 0.6) * TILT_STEPS);
      pose = { kind: 'jump', tilt: Math.max(-TILT_STEPS, Math.min(TILT_STEPS, tilt)) };
    } else if (worm.state === 'walking') {
      const cycle = worm.walkPhase / (Math.PI * 2);
      pose = { kind: 'walk', frame: Math.floor((cycle - Math.floor(cycle)) * WALK_FRAMES) % WALK_FRAMES };
    } else {
      pose = { kind: 'idle', breath: Math.sin(worm.animTick * 0.07) > 0 ? 1 : 0 };
    }
    const look = Math.round(((worm.aim / (Math.PI / 2) + 1) / 2) * (LOOK_STEPS - 1));
    const sprite = this.wormSprites.get(pose, look, worm.blinkTicks > 0);

    ctx.save();
    ctx.translate(Math.round(worm.x), Math.round(worm.y));
    ctx.scale(worm.facing, 1);
    ctx.drawImage(sprite, -SPRITE_ORIGIN.x, -SPRITE_ORIGIN.y);
    ctx.restore();

    if (active) {
      const pulse = 13 + Math.sin(this.frame * 0.11) * 1.6;
      ctx.save();
      ctx.strokeStyle = color;
      ctx.globalAlpha = 0.45;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(worm.x, worm.y - 2, pulse, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
  }

  /**
   * The rope as one-pixel line work: a dark core with a pale strand beside
   * it, so it reads against both sky and dirt. Runs from the worm back
   * through every wrapped corner to the hook.
   */
  private drawRope(worm: Worm, path: readonly { x: number; y: number }[]): void {
    const { ctx } = this;
    const points = [{ x: worm.x, y: worm.y - 3 }, ...[...path].reverse()];
    const hook = path[0];
    ctx.save();
    ctx.lineJoin = 'round';
    for (const [color, width] of [['#2a1e14', 1.6], ['#d9c79a', 0.7]] as const) {
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      ctx.beginPath();
      points.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
      ctx.stroke();
    }
    // The hook: a small steel claw.
    ctx.fillStyle = '#1c1418';
    ctx.fillRect(Math.round(hook.x) - 2, Math.round(hook.y) - 2, 4, 4);
    ctx.fillStyle = '#a9b0bc';
    ctx.fillRect(Math.round(hook.x) - 1, Math.round(hook.y) - 1, 2, 2);
    ctx.restore();
  }

  /** The weapon in the active worm's hand, turned to its aim. */
  private drawHeld(worm: Worm, weapon: WeaponId, aim: number): void {
    const sprite = this.heldSprites.get(weapon, aim);
    if (!sprite) return;
    const { ctx } = this;
    ctx.save();
    ctx.translate(Math.round(worm.x), Math.round(worm.y));
    ctx.scale(worm.facing, 1);
    ctx.drawImage(sprite, HAND.x - HELD_ORIGIN, HAND.y - HELD_ORIGIN);
    ctx.restore();
  }

  /** A see-through girder under the pointer: steel where it may go, red where it may not. */
  private drawGirderGhost(g: { x: number; y: number; step: number; ok: boolean }): void {
    const { ctx } = this;
    ctx.save();
    ctx.globalAlpha = g.ok ? 0.55 + Math.sin(this.frame * 0.15) * 0.1 : 0.5;
    girderCells(g.x, g.y, g.step, (x, y, u, v) => {
      const [r, gr, b] = girderColor(u, v);
      ctx.fillStyle = g.ok ? `rgb(${r},${gr},${b})` : `rgb(${Math.min(255, r + 90)},${gr >> 1},${b >> 1})`;
      ctx.fillRect(x, y, 1, 1);
    });
    ctx.restore();
  }

  private drawProjectile(p: Projectile): void {
    const { ctx } = this;

    // Smoke trail: older points are fainter and smaller. A munition sitting on
    // the ground has no business smoking, so resting ones skip it.
    if (!p.resting) {
      ctx.save();
      for (let i = 0; i < p.trail.length; i++) {
        const t = i / p.trail.length;
        ctx.globalAlpha = t * 0.4;
        ctx.fillStyle = '#d8d8d8';
        ctx.beginPath();
        ctx.arc(p.trail[i].x, p.trail[i].y, 0.6 + t * 2.2, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }

    ctx.save();
    ctx.translate(p.x, p.y);
    switch (p.spec.sprite) {
      case 'grenade':
      case 'cluster':
        this.drawSphereBomb(p, p.spec.sprite === 'cluster' ? '#5a4a2e' : '#3c4a36');
        break;
      case 'banana':
        this.drawBanana(p);
        break;
      case 'holy':
        this.drawHolyGrenade(p);
        break;
      case 'dynamite':
        this.drawDynamite(p);
        break;
      case 'mine':
        this.drawMine(p);
        break;
      case 'fire':
        this.drawFireball();
        break;
      case 'shard':
        this.drawShard(p);
        break;
      case 'bomb':
        this.drawBomb(p);
        break;
      default:
        this.drawRocket(p);
    }
    ctx.restore();
  }

  /** Body along the velocity vector, with an exhaust flame behind it. */
  private drawRocket(p: Projectile): void {
    const { ctx } = this;
    ctx.rotate(p.angle);
    const flame = 5 + Math.random() * 4;
    const g = ctx.createLinearGradient(-4 - flame, 0, -4, 0);
    g.addColorStop(0, 'rgba(255,120,0,0)');
    g.addColorStop(1, '#ffe08a');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(-4, -1.6);
    ctx.lineTo(-4 - flame, 0);
    ctx.lineTo(-4, 1.6);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = '#c9ccd2';
    ctx.strokeStyle = '#4a4e55';
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    ctx.moveTo(5.5, 0);
    ctx.lineTo(1, -2.1);
    ctx.lineTo(-4, -1.8);
    ctx.lineTo(-4, 1.8);
    ctx.lineTo(1, 2.1);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#d94a3a';
    ctx.fillRect(-1.5, -2.1, 1.8, 4.2);
  }

  /** Grenade and cluster bomb: a spinning ball with a sparking fuse. */
  private drawSphereBomb(p: Projectile, body: string): void {
    const { ctx } = this;
    ctx.rotate(p.x * 0.14);
    ctx.fillStyle = body;
    ctx.strokeStyle = '#1e2419';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(0, 0, 3.8, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    this.drawFuseSpark(-5.2);
  }

  private drawBanana(p: Projectile): void {
    const { ctx } = this;
    ctx.rotate(p.x * 0.12);
    ctx.fillStyle = '#f5d02e';
    ctx.strokeStyle = '#8a6a10';
    ctx.lineWidth = 0.9;
    ctx.beginPath();
    ctx.moveTo(-4.5, 2.4);
    ctx.quadraticCurveTo(0, -5.4, 4.5, 2.4);
    ctx.quadraticCurveTo(0, -1.4, -4.5, 2.4);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    this.drawFuseSpark(-5.6);
  }

  private drawHolyGrenade(p: Projectile): void {
    const { ctx } = this;
    ctx.rotate(Math.sin(p.x * 0.05) * 0.3);
    // Halo: unmistakable even at a glance, which is the point of this weapon.
    ctx.globalAlpha = 0.55;
    ctx.strokeStyle = '#ffe98a';
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.ellipse(0, -7.5, 5.2, 1.7, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.globalAlpha = 1;

    ctx.fillStyle = '#e8c23a';
    ctx.strokeStyle = '#7a5c10';
    ctx.lineWidth = 0.9;
    ctx.beginPath();
    ctx.arc(0, 0, 4.6, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#fff6cf';
    ctx.fillRect(-0.8, -3.4, 1.6, 6.8);
    ctx.fillRect(-2.8, -1.4, 5.6, 1.6);
  }

  private drawDynamite(p: Projectile): void {
    const { ctx } = this;
    ctx.fillStyle = '#b8352c';
    ctx.strokeStyle = '#5e1a15';
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    ctx.rect(-3.2, -7, 6.4, 12);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = 'rgba(0,0,0,.3)';
    ctx.fillRect(-3.2, -2.4, 6.4, 1.6);
    ctx.fillRect(-3.2, 1.2, 6.4, 1.6);
    // The fuse visibly burns down as the count runs out.
    const left = p.fuse > 0 ? Math.min(1, p.fuse / (5 * 50)) : 0;
    ctx.strokeStyle = '#3a2a12';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, -7);
    ctx.lineTo(0, -7 - 4 * left);
    ctx.stroke();
    this.drawFuseSpark(-7 - 4 * left);
  }

  private drawMine(p: Projectile): void {
    const { ctx } = this;
    ctx.fillStyle = '#4b4f55';
    ctx.strokeStyle = '#23262a';
    ctx.lineWidth = 0.9;
    ctx.beginPath();
    ctx.arc(0, 0, 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    // Spikes, so it reads as a mine rather than a pebble.
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2 + 0.3;
      ctx.beginPath();
      ctx.moveTo(Math.cos(a) * 3.4, Math.sin(a) * 3.4);
      ctx.lineTo(Math.cos(a) * 6, Math.sin(a) * 6);
      ctx.stroke();
    }
    // The lamp blinks slowly while dormant and fast once triggered.
    const rate = p.fuse > 0 ? 4 : 22;
    const lit = !p.armed || this.frame % rate < rate / 2;
    ctx.fillStyle = lit ? '#ff4b3a' : '#5a2320';
    ctx.beginPath();
    ctx.arc(0, -1, 1.5, 0, Math.PI * 2);
    ctx.fill();
  }

  private drawFireball(): void {
    const { ctx } = this;
    const r = 5 + Math.random();
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, r * 1.8);
    g.addColorStop(0, '#fffbe0');
    g.addColorStop(0.4, '#ffa423');
    g.addColorStop(1, 'rgba(255,60,0,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(0, 0, r * 1.8, 0, Math.PI * 2);
    ctx.fill();
  }

  private drawShard(p: Projectile): void {
    const { ctx } = this;
    ctx.rotate(p.angle);
    ctx.fillStyle = '#8c9199';
    ctx.strokeStyle = '#3d4147';
    ctx.lineWidth = 0.7;
    ctx.beginPath();
    ctx.moveTo(3.2, 0);
    ctx.lineTo(-2.2, -2);
    ctx.lineTo(-2.2, 2);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }

  private drawBomb(p: Projectile): void {
    const { ctx } = this;
    ctx.rotate(p.angle - Math.PI / 2);
    ctx.fillStyle = '#3f4a52';
    ctx.strokeStyle = '#1d2327';
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    ctx.moveTo(0, -5.5);
    ctx.quadraticCurveTo(2.6, -1, 2, 3.5);
    ctx.lineTo(-2, 3.5);
    ctx.quadraticCurveTo(-2.6, -1, 0, -5.5);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#6d757c';
    ctx.beginPath();
    ctx.moveTo(-2.6, 5.4);
    ctx.lineTo(2.6, 5.4);
    ctx.lineTo(0, 2.6);
    ctx.closePath();
    ctx.fill();
  }

  private drawFuseSpark(y: number): void {
    const { ctx } = this;
    ctx.fillStyle = this.frame % 6 < 3 ? '#fff0a0' : '#ff9a2a';
    ctx.beginPath();
    ctx.arc(0, y - 1, 1.3, 0, Math.PI * 2);
    ctx.fill();
  }

  /** The air strike bomber, drawn in world space as it crosses the sky. */
  private drawPlane(plane: AirStrike): void {
    const { ctx } = this;
    ctx.save();
    ctx.translate(plane.x, plane.y);
    ctx.scale(plane.vx > 0 ? 1 : -1, 1);
    ctx.fillStyle = '#3d4d3a';
    ctx.strokeStyle = '#1e2a1c';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(-16, 0);
    ctx.lineTo(8, -3);
    ctx.quadraticCurveTo(16, -2, 16, 0);
    ctx.lineTo(-10, 4);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    // Wing and tail, enough to read as an aircraft at a glance.
    ctx.beginPath();
    ctx.moveTo(-2, -1);
    ctx.lineTo(-8, -9);
    ctx.lineTo(-2, -9);
    ctx.lineTo(4, -1);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(-16, 0);
    ctx.lineTo(-18, -7);
    ctx.lineTo(-12, -1);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }

  /** Bullet paths, drawn for the handful of ticks after a gun goes off. */
  private drawTracers(tracers: readonly Tracer[]): void {
    if (tracers.length === 0) return;
    const { ctx } = this;
    ctx.save();
    ctx.lineCap = 'round';
    for (const t of tracers) {
      ctx.globalAlpha = Math.min(1, t.life / 4) * 0.85;
      ctx.strokeStyle = '#fff3c4';
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.moveTo(t.x0, t.y0);
      ctx.lineTo(t.x1, t.y1);
      ctx.stroke();
    }
    ctx.restore();
  }

  /** The marker left where a homing missile or air strike has been aimed. */
  private drawTargetMark(target: { x: number; y: number }): void {
    const { ctx } = this;
    ctx.save();
    ctx.translate(target.x, target.y);
    ctx.strokeStyle = '#ff4d4d';
    ctx.lineWidth = 1.4;
    ctx.globalAlpha = 0.9;
    ctx.beginPath();
    ctx.arc(0, 0, 8, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(-13, 0);
    ctx.lineTo(-4, 0);
    ctx.moveTo(4, 0);
    ctx.lineTo(13, 0);
    ctx.moveTo(0, -13);
    ctx.lineTo(0, -4);
    ctx.moveTo(0, 4);
    ctx.lineTo(0, 13);
    ctx.stroke();
    ctx.restore();
  }

  private drawTargetPrompt(): void {
    const { ctx, camera } = this;
    ctx.save();
    ctx.font = 'bold 13px Verdana, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillStyle = '#ffd24d';
    ctx.strokeStyle = 'rgba(0,0,0,.7)';
    ctx.lineWidth = 3;
    const text = 'CLICK A TARGET';
    ctx.strokeText(text, camera.viewWidth / 2, 92);
    ctx.fillText(text, camera.viewWidth / 2, 92);
    ctx.restore();
  }

  /** The weapon panel: a row per group, a tile per weapon, ammo in the corner. */
  private drawWeaponMenu(
    ammo: Record<WeaponId, number>,
    selected: WeaponId,
    hover: WeaponId | null,
    scale: number,
  ): void {
    const { ctx, camera } = this;
    const L = menuLayout(camera.viewWidth, camera.viewHeight, scale);

    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,.45)';
    ctx.fillRect(0, 0, camera.viewWidth, camera.viewHeight);

    ctx.fillStyle = 'rgba(14,20,26,.94)';
    ctx.fillRect(L.x, L.y, L.w, L.h);
    ctx.strokeStyle = 'rgba(255,255,255,.22)';
    ctx.lineWidth = 1;
    ctx.strokeRect(L.x + 0.5, L.y + 0.5, L.w - 1, L.h - 1);

    ctx.textBaseline = 'middle';
    for (const row of L.rows) {
      ctx.font = '11px Verdana, sans-serif';
      ctx.textAlign = 'right';
      ctx.fillStyle = 'rgba(255,255,255,.45)';
      ctx.fillText(row.label, L.x + 10 * scale + L.labelW - 8 * scale, row.y + (row.tiles[0]?.h ?? TILE) / 2);

      for (const tile of row.tiles) {
        const spec = WEAPONS[tile.id];
        const rounds = ammo[tile.id];
        const empty = rounds === 0;

        ctx.fillStyle = empty ? 'rgba(255,255,255,.04)' : 'rgba(255,255,255,.1)';
        ctx.fillRect(tile.x, tile.y, tile.w, tile.h);
        if (tile.id === hover && !empty) {
          ctx.fillStyle = 'rgba(255,255,255,.12)';
          ctx.fillRect(tile.x, tile.y, tile.w, tile.h);
        }
        ctx.strokeStyle = tile.id === selected ? '#ffe14d' : 'rgba(255,255,255,.18)';
        ctx.lineWidth = tile.id === selected ? 2 : 1;
        ctx.strokeRect(tile.x + 0.5, tile.y + 0.5, tile.w - 1, tile.h - 1);

        ctx.globalAlpha = empty ? 0.3 : 1;
        ctx.textAlign = 'center';
        ctx.font = `bold ${Math.round(20 * scale)}px Verdana, sans-serif`;
        ctx.fillStyle = '#e8f2f8';
        ctx.fillText(spec.glyph, tile.x + tile.w / 2, tile.y + tile.h / 2 - 5 * scale);
        ctx.font = `${Math.round(8 * scale)}px Verdana, sans-serif`;
        ctx.fillStyle = 'rgba(255,255,255,.6)';
        ctx.fillText(shortName(spec.name), tile.x + tile.w / 2, tile.y + tile.h - 8 * scale);
        ctx.globalAlpha = 1;

        if (rounds >= 0) {
          ctx.textAlign = 'right';
          ctx.font = 'bold 9px Verdana, sans-serif';
          ctx.fillStyle = empty ? '#ff6a5a' : '#9de06b';
          ctx.fillText(String(rounds), tile.x + tile.w - 4, tile.y + 7);
        }
      }
    }

    ctx.font = '10px Verdana, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillStyle = 'rgba(255,255,255,.4)';
    ctx.fillText('click to equip  -  TAB or ESC to close', L.x + L.w / 2, L.y + L.h + 14);
    ctx.restore();
  }

  /** A headstone, in the colours of the team that lost the worm. */
  private drawGrave(grave: Grave): void {
    const { ctx } = this;
    const color = TEAM_COLORS[grave.teamIndex % TEAM_COLORS.length];
    ctx.save();
    ctx.translate(Math.round(grave.x), Math.round(grave.y));

    ctx.globalAlpha = 0.25;
    ctx.fillStyle = '#000';
    ctx.beginPath();
    ctx.ellipse(0, 7, 5, 1.6, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;

    ctx.fillStyle = '#9aa0a8';
    ctx.strokeStyle = '#4c5158';
    ctx.lineWidth = 1;
    ctx.beginPath();
    if (grave.variant === 0) {
      ctx.moveTo(-4, 7);
      ctx.lineTo(-4, -2);
      ctx.arc(0, -2, 4, Math.PI, 0);
      ctx.lineTo(4, 7);
      ctx.closePath();
    } else if (grave.variant === 1) {
      ctx.rect(-1.6, -7, 3.2, 14);
      ctx.rect(-4.5, -4, 9, 3);
    } else {
      ctx.rect(-4.5, -6, 9, 13);
    }
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = color;
    ctx.fillRect(-3, 4, 6, 1.6);
    ctx.restore();
  }

  /** Per-team health strip along the bottom, like the original scoreboard. */
  private drawTeamStrip(teams: readonly TeamStatus[]): void {
    if (teams.length === 0) return;
    const { ctx, camera } = this;
    const barW = 150;
    const rowH = 17;
    const x = camera.viewWidth / 2 - barW / 2;
    const y = camera.viewHeight - 10 - teams.length * rowH;

    ctx.save();
    ctx.font = '11px Verdana, sans-serif';
    ctx.textBaseline = 'middle';
    teams.forEach((team, i) => {
      const ty = y + i * rowH;
      ctx.fillStyle = 'rgba(0,0,0,.5)';
      ctx.fillRect(x - 2, ty - 1, barW + 4, rowH - 2);

      ctx.globalAlpha = team.active ? 1 : 0.62;
      ctx.fillStyle = team.color;
      ctx.textAlign = 'right';
      ctx.fillText(team.name, x - 8, ty + rowH / 2 - 1);

      const frac = team.maxHealth === 0 ? 0 : team.health / team.maxHealth;
      ctx.fillStyle = 'rgba(255,255,255,.14)';
      ctx.fillRect(x, ty + 3, barW, rowH - 8);
      ctx.fillStyle = team.color;
      ctx.fillRect(x, ty + 3, barW * frac, rowH - 8);

      ctx.fillStyle = '#e8f2f8';
      ctx.textAlign = 'left';
      ctx.fillText(String(team.health), x + barW + 8, ty + rowH / 2 - 1);
      ctx.globalAlpha = 1;

      if (team.active) {
        ctx.strokeStyle = team.color;
        ctx.lineWidth = 1;
        ctx.strokeRect(x - 2.5, ty - 1.5, barW + 5, rowH - 1);
      }
    });
    ctx.restore();
  }

  /** Turn clock, round number and the sudden death warning. */
  private drawTurnClock(secondsLeft: number | null, round: number, suddenDeath: boolean): void {
    const { ctx, camera } = this;
    const cx = camera.viewWidth / 2;
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';

    if (secondsLeft !== null) {
      ctx.font = 'bold 40px Verdana, sans-serif';
      ctx.lineWidth = 5;
      ctx.strokeStyle = 'rgba(0,0,0,.65)';
      const text = String(secondsLeft);
      ctx.strokeText(text, cx, 48);
      ctx.fillStyle = secondsLeft <= 5 ? '#ff5a4d' : '#ffffff';
      ctx.fillText(text, cx, 48);
    }

    ctx.font = 'bold 12px Verdana, sans-serif';
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(0,0,0,.6)';
    const label = suddenDeath ? 'ROUND ' + round + '  -  SUDDEN DEATH' : 'ROUND ' + round;
    ctx.strokeText(label, cx, 66);
    ctx.fillStyle = suddenDeath ? '#ff9a6b' : 'rgba(255,255,255,.8)';
    ctx.fillText(label, cx, 66);
    ctx.restore();
  }

  /** Centre-screen announcement: time up, sudden death, the winner. */
  private drawBanner(text: string): void {
    const { ctx, camera } = this;
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.font = 'bold 44px Verdana, sans-serif';
    const w = ctx.measureText(text).width;
    const cx = camera.viewWidth / 2;
    const cy = camera.viewHeight * 0.36;

    ctx.fillStyle = 'rgba(0,0,0,.55)';
    ctx.fillRect(cx - w / 2 - 26, cy - 40, w + 52, 58);
    ctx.lineWidth = 6;
    ctx.strokeStyle = 'rgba(0,0,0,.8)';
    ctx.strokeText(text, cx, cy);
    ctx.fillStyle = '#ffe14d';
    ctx.fillText(text, cx, cy);
    ctx.restore();
  }

  /** The classic dotted aim line plus a ring reticle. */
  private drawCrosshair(worm: Worm, distance: number): void {
    const { ctx } = this;
    const v = worm.aimVector();
    const cx = worm.x + v.x * distance;
    const cy = worm.y - 3 + v.y * distance;

    ctx.save();
    ctx.strokeStyle = 'rgba(255,255,255,.7)';
    ctx.lineWidth = 1;
    ctx.setLineDash([1, 5]);
    ctx.beginPath();
    ctx.moveTo(worm.x + v.x * 12, worm.y - 3 + v.y * 12);
    ctx.lineTo(cx, cy);
    ctx.stroke();

    ctx.setLineDash([]);
    ctx.strokeStyle = '#ffe14d';
    ctx.beginPath();
    ctx.arc(cx, cy, 5.5, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    for (const [ax, ay, bx, by] of [
      [-9, 0, -3, 0],
      [3, 0, 9, 0],
      [0, -9, 0, -3],
      [0, 3, 0, 9],
    ]) {
      ctx.moveTo(cx + ax, cy + ay);
      ctx.lineTo(cx + bx, cy + by);
    }
    ctx.stroke();
    ctx.restore();
  }

  /** Name plate and health bar, in screen space so text stays crisp. */
  private drawLabel(worm: Worm, active: boolean): void {
    const { ctx, camera } = this;
    const sx = Math.round(camera.screenX(worm.x));
    const sy = Math.round(camera.screenY(worm.y - 17) - 7);
    if (sx < -80 || sx > camera.viewWidth + 80 || sy < -40 || sy > camera.viewHeight + 40) return;

    const color = TEAM_COLORS[worm.teamIndex % TEAM_COLORS.length];
    ctx.save();
    ctx.font = `${active ? 'bold ' : ''}11px Verdana, sans-serif`;
    const label = worm.name;
    const w = Math.max(38, ctx.measureText(label).width + 10);

    ctx.fillStyle = 'rgba(0,0,0,.5)';
    ctx.fillRect(sx - w / 2, sy - 22, w, 24);

    ctx.fillStyle = color;
    ctx.textAlign = 'center';
    ctx.fillText(label, sx, sy - 12);

    // Health bar in team colour, draining left to right.
    const bw = w - 8;
    ctx.fillStyle = 'rgba(0,0,0,.6)';
    ctx.fillRect(sx - bw / 2, sy - 8, bw, 4);
    ctx.fillStyle = color;
    ctx.fillRect(sx - bw / 2, sy - 8, (bw * worm.health) / 100, 4);
    ctx.restore();
  }

  /** Segmented charge bar along the bottom, green through to red. */
  private drawPowerBar(charge: number): void {
    const { ctx, camera } = this;
    const w = Math.min(420, camera.viewWidth * 0.5);
    const h = 13;
    const x = (camera.viewWidth - w) / 2;
    const y = camera.viewHeight - 34;

    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,.6)';
    ctx.fillRect(x - 2, y - 2, w + 4, h + 4);
    const segments = 30;
    for (let i = 0; i < segments; i++) {
      if (i / segments > charge) break;
      const t = i / (segments - 1);
      ctx.fillStyle = `hsl(${Math.round(120 - t * 120)},95%,50%)`;
      ctx.fillRect(x + (i * w) / segments + 1, y, w / segments - 2, h);
    }
    ctx.strokeStyle = 'rgba(255,255,255,.35)';
    ctx.lineWidth = 1;
    ctx.strokeRect(x - 2.5, y - 2.5, w + 5, h + 5);
    ctx.restore();
  }

  /** Wind gauge, bottom right, matching the original left/right arrow strip. */
  private drawWindGauge(wind: number): void {
    const { ctx, camera } = this;
    const w = 128;
    const h = 12;
    const x = camera.viewWidth - w - 14;
    const y = camera.viewHeight - 24;

    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,.5)';
    ctx.fillRect(x - 2, y - 2, w + 4, h + 4);
    ctx.strokeStyle = 'rgba(255,255,255,.25)';
    ctx.strokeRect(x - 2.5, y - 2.5, w + 5, h + 5);

    const mid = x + w / 2;
    ctx.fillStyle = 'rgba(255,255,255,.3)';
    ctx.fillRect(mid - 0.5, y, 1, h);

    const len = (Math.abs(wind) * w) / 2;
    ctx.fillStyle = wind >= 0 ? '#6fd2ff' : '#ffb36f';
    ctx.fillRect(wind >= 0 ? mid : mid - len, y + 2, len, h - 4);

    ctx.fillStyle = '#cfe6f2';
    ctx.font = '10px Verdana, sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText('WIND', x - 8, y + h - 2);
    ctx.restore();
  }

  private drawWeaponBadge(spec: WeaponSpec, rounds: number, fuseSeconds: number | null): void {
    const { ctx, camera } = this;
    ctx.save();
    ctx.font = 'bold 13px Verdana, sans-serif';
    let text = spec.name;
    if (rounds >= 0) text += ` x${rounds}`;
    if (fuseSeconds !== null) text += `  ${fuseSeconds}s`;
    const w = ctx.measureText(text).width + 18;
    const x = 14;
    const y = camera.viewHeight - 24;
    ctx.fillStyle = 'rgba(0,0,0,.5)';
    ctx.fillRect(x - 2, y - 2, w, 16);
    ctx.strokeStyle = 'rgba(255,255,255,.25)';
    ctx.strokeRect(x - 2.5, y - 2.5, w + 1, 17);
    ctx.fillStyle = '#ffe14d';
    ctx.textAlign = 'left';
    ctx.fillText(text, x + 7, y + 11);
    ctx.restore();
  }
}

/** Two words is one word too many for a 46px tile. */
function shortName(name: string): string {
  const words = name.split(' ');
  return words.length === 1 ? name : words[words.length - 1];
}
