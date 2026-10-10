import { Terrain } from '../world/terrain';

/**
 * Physics constants, all expressed per 1/50 s tick to match the simulation rate
 * of the original. These are the numbers to nudge when the feel is off.
 */
export const PHYS = {
  gravity: 0.18,
  walkSpeed: 0.95,
  /** Pixels of upward slope a worm can take per pixel walked (~71 degrees). */
  maxClimb: 3,
  /** Pixels it will step down before deciding it has walked off a ledge. */
  maxStepDown: 2,
  jumpVx: 1.12,
  jumpVy: -3.3,
  backflipVx: 0.42,
  backflipVy: -5.3,
  /** Body clearance radius used for every terrain test. */
  radius: 4,
  terminalVelocity: 9,
  /** Impact speed below which a landing is free - a worm flung by a blast and bouncing to a stop. */
  fallDamageThreshold: 3.2,
  fallDamagePerUnit: 7.5,
  /**
   * Same, but gentler - a worm that merely jumped or walked off a ledge
   * under its own steam, not one thrown by an explosion. A plain jump lands
   * at roughly its own takeoff speed (~3.3) and should never hurt; this pair
   * keeps that free and only starts charging for a real drop.
   */
  jumpFallDamageThreshold: 4.6,
  jumpFallDamagePerUnit: 4.5,
  /** Bounce energy kept when a blasted worm hits terrain. */
  restitution: 0.38,
  surfaceFriction: 0.62,
  /** Below this speed a bouncing worm is considered to have settled. */
  restSpeed: 0.34,
  aimSpeed: 0.022,

  // Ninja rope.
  /** How fast the hook flies out, px/tick. */
  ropeShotSpeed: 14,
  /** Longest rope that will catch; a shot that goes further reels back in. */
  ropeMaxLength: 280,
  /** Shortest the rope can be climbed to. */
  ropeMinLength: 8,
  /** Push per tick from the arrow keys while swinging. */
  ropeSwing: 0.075,
  /** Climb and pay-out speed, px/tick. */
  ropeClimb: 1.6,
  /** Energy kept when a swinging worm hits a wall. */
  ropeRestitution: 0.45,
  /** Swing speed cap, so a long rope cannot slingshot a worm off the map in one go. */
  ropeMaxSpeed: 9,
} as const;

export type WormState = 'idle' | 'walking' | 'airborne' | 'flying' | 'roped' | 'drowning' | 'dead';

export class Worm {
  x: number;
  y: number;
  vx = 0;
  vy = 0;
  health: number;
  facing: 1 | -1 = 1;
  /** Radians, -PI/2 (straight up) .. PI/2 (straight down), relative to facing. */
  aim = 0;
  state: WormState = 'idle';
  readonly name: string;
  readonly teamIndex: number;
  /** Carried-over fraction of a pixel, so sub-pixel walk speeds still move. */
  private walkAccum = 0;
  /** Animation bookkeeping, driven by the game tick and read by the renderer. */
  animTick = 0;
  walkPhase = 0;
  blinkTicks = 0;
  /** Set once a headstone has been placed, so death is only handled once. */
  buried = false;

  constructor(x: number, y: number, name: string, teamIndex: number, health = 100) {
    this.x = x;
    this.y = y;
    this.name = name;
    this.teamIndex = teamIndex;
    this.health = health;
  }

  get alive(): boolean {
    return this.state !== 'dead' && this.health > 0;
  }

  /** True when there is solid ground directly under the feet of the worm. */
  grounded(terrain: Terrain): boolean {
    return this.groundedAt(terrain, this.x, this.y);
  }

  /** True when the body fits in open air at the given position. */
  fits(terrain: Terrain, x: number, y: number): boolean {
    const r = PHYS.radius;
    for (let dy = -r; dy <= r; dy++) {
      const span = Math.floor(Math.sqrt(r * r - dy * dy));
      for (let dx = -span; dx <= span; dx++) {
        if (terrain.solid(x + dx, y + dy)) return false;
      }
    }
    return true;
  }

  /**
   * Walk one tick in `dir`. Climbs slopes, steps down small drops, and hands
   * over to the airborne path when it steps off an edge.
   */
  walk(terrain: Terrain, dir: 1 | -1): void {
    this.facing = dir;
    // Sub-pixel budget: banks the remainder between ticks, so a speed below
    // 1 px/tick still walks instead of standing still.
    this.walkAccum += PHYS.walkSpeed;
    while (this.walkAccum >= 1) {
      this.walkAccum -= 1;
      const nx = this.x + dir;
      let moved = false;
      for (const dy of STEP_ORDER) {
        const ny = this.y + dy;
        if (this.fits(terrain, nx, ny) && this.groundedAt(terrain, nx, ny)) {
          this.x = nx;
          this.y = ny;
          this.walkPhase += 0.34;
          moved = true;
          break;
        }
      }
      if (moved) continue;

      if (this.fits(terrain, nx, this.y)) {
        // Open air ahead with nothing to stand on: walk off the ledge.
        this.x = nx;
        this.state = 'airborne';
        this.vx = 0;
        this.vy = 0;
        return;
      }
      break; // wall
    }
    this.state = 'walking';
  }

  private groundedAt(terrain: Terrain, x: number, y: number): boolean {
    const feet = y + PHYS.radius + 1;
    for (let dx = -2; dx <= 2; dx++) {
      if (terrain.solid(x + dx, feet)) return true;
    }
    return false;
  }

  jump(backflip: boolean): void {
    if (this.state !== 'idle' && this.state !== 'walking') return;
    this.vx = backflip ? PHYS.backflipVx * -this.facing : PHYS.jumpVx * this.facing;
    this.vy = backflip ? PHYS.backflipVy : PHYS.jumpVy;
    this.state = 'airborne';
  }

  /** Launch from an explosion - the worm now tumbles and bounces. */
  launch(vx: number, vy: number): void {
    this.vx += vx;
    this.vy += vy;
    this.state = 'flying';
  }

  aimUp(): void {
    this.aim = Math.max(-Math.PI / 2, this.aim - PHYS.aimSpeed);
  }

  aimDown(): void {
    this.aim = Math.min(Math.PI / 2, this.aim + PHYS.aimSpeed);
  }

  /** World-space unit vector the worm is currently pointing at. */
  aimVector(): { x: number; y: number } {
    return { x: Math.cos(this.aim) * this.facing, y: Math.sin(this.aim) };
  }

  /**
   * Integrate one tick of free flight. Returns the damage taken from impacts
   * this tick so the caller can drive death and damage popups.
   */
  stepPhysics(terrain: Terrain): number {
    if (this.state !== 'airborne' && this.state !== 'flying') return 0;

    this.vy = Math.min(this.vy + PHYS.gravity, PHYS.terminalVelocity);

    const speed = Math.hypot(this.vx, this.vy);
    const steps = Math.max(1, Math.ceil(speed));
    let damage = 0;

    for (let s = 0; s < steps; s++) {
      const nx = this.x + this.vx / steps;
      const ny = this.y + this.vy / steps;
      if (this.fits(terrain, nx, ny)) {
        this.x = nx;
        this.y = ny;
        continue;
      }

      const impact = Math.hypot(this.vx, this.vy);
      if (this.state === 'airborne') {
        // A plain fall: land flat, and pay for the drop - gently, since this
        // is just a jump or a walked-off ledge, not a blast throwing the worm.
        damage += this.landingDamage(impact, true);
        this.settle(terrain);
        return damage;
      }

      // Blasted worm: bounce off the surface, shedding energy each time.
      const n = surfaceNormal(terrain, nx, ny);
      const dot = this.vx * n.x + this.vy * n.y;
      const tx = this.vx - n.x * dot;
      const ty = this.vy - n.y * dot;
      this.vx = tx * PHYS.surfaceFriction - n.x * dot * PHYS.restitution;
      this.vy = ty * PHYS.surfaceFriction - n.y * dot * PHYS.restitution;
      damage += this.landingDamage(impact, false);

      // Nudge clear of the surface so the next sub-step is not stuck inside it.
      if (this.fits(terrain, this.x + n.x, this.y + n.y)) {
        this.x += n.x;
        this.y += n.y;
      }
      if (Math.hypot(this.vx, this.vy) < PHYS.restSpeed) {
        this.settle(terrain);
        return damage;
      }
    }

    if (this.state === 'flying' && Math.hypot(this.vx, this.vy) < PHYS.restSpeed && this.grounded(terrain)) {
      this.settle(terrain);
    }
    return damage;
  }

  private landingDamage(impactSpeed: number, gentle: boolean): number {
    const threshold = gentle ? PHYS.jumpFallDamageThreshold : PHYS.fallDamageThreshold;
    const perUnit = gentle ? PHYS.jumpFallDamagePerUnit : PHYS.fallDamagePerUnit;
    if (impactSpeed <= threshold) return 0;
    return Math.max(0, Math.floor((impactSpeed - threshold) * perUnit));
  }

  private settle(terrain: Terrain): void {
    this.vx = 0;
    this.vy = 0;
    this.walkAccum = 0;
    this.state = 'idle';
    // Pull the worm down onto the surface so it is never left hovering.
    for (let i = 0; i < PHYS.radius + 2; i++) {
      if (this.grounded(terrain)) break;
      if (!this.fits(terrain, this.x, this.y + 1)) break;
      this.y += 1;
    }
  }

  applyDamage(amount: number): void {
    if (amount <= 0) return;
    this.health = Math.max(0, this.health - Math.round(amount));
    if (this.health === 0) this.state = 'dead';
  }
}

/** Slope probe order: prefer climbing, then flat, then a small step down. */
const STEP_ORDER: readonly number[] = buildStepOrder();

function buildStepOrder(): number[] {
  const order: number[] = [0];
  for (let i = 1; i <= Math.max(PHYS.maxClimb, PHYS.maxStepDown); i++) {
    if (i <= PHYS.maxClimb) order.push(-i);
    if (i <= PHYS.maxStepDown) order.push(i);
  }
  return order;
}

/**
 * Approximates the terrain normal by weighting nearby solid pixels - good
 * enough to bounce believably off a noisy, pixel-defined surface.
 */
export function surfaceNormal(terrain: Terrain, x: number, y: number): { x: number; y: number } {
  let nx = 0;
  let ny = 0;
  const R = 5;
  for (let dy = -R; dy <= R; dy++) {
    for (let dx = -R; dx <= R; dx++) {
      if (dx === 0 && dy === 0) continue;
      if (!terrain.solid(x + dx, y + dy)) continue;
      const d2 = dx * dx + dy * dy;
      nx -= dx / d2;
      ny -= dy / d2;
    }
  }
  const len = Math.hypot(nx, ny);
  if (len < 1e-6) return { x: 0, y: -1 };
  return { x: nx / len, y: ny / len };
}
