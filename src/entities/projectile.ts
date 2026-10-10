import { Terrain } from '../world/terrain';
import { ProjectileSpec } from './weapons';
import { PHYS, surfaceNormal } from './worm';

export { WEAPONS, PROJECTILES } from './weapons';
export type { WeaponId, WeaponSpec, ProjectileSpec } from './weapons';

/** How hard the wind pushes a wind-sensitive projectile, per tick per unit wind. */
export const WIND_ACCEL = 0.014;

/** Radius at which a projectile counts as having struck a worm. */
export const PROJECTILE_HIT_RADIUS = PHYS.radius + 2;

export type ProjectileOutcome = 'fly' | 'explode' | 'gone';

/** Everything the flight step needs to know about the world around it. */
export interface FlightContext {
  readonly terrain: Terrain;
  readonly wind: number;
  /** True when a worm other than the owner occupies this point. */
  hitsWorm(x: number, y: number): boolean;
  /** True when any living worm sits within `range`, for proximity mines. */
  wormNear(x: number, y: number, range: number): boolean;
}

export class Projectile {
  x: number;
  y: number;
  vx: number;
  vy: number;
  readonly spec: ProjectileSpec;
  /** Ticks until detonation, or -1 while nothing is counting down. */
  fuse: number;
  /** Rotation for drawing, and the trail the renderer paints behind it. */
  angle = 0;
  readonly trail: { x: number; y: number }[] = [];
  /** The worm that fired it, so the launch does not clip its own body. */
  readonly ownerIndex: number;
  /** Where a homing missile is steering, captured at launch. */
  target: { x: number; y: number } | null = null;
  /** True once a settling munition has stopped moving. */
  resting = false;
  /** Counts up; drives the arming delay and the homing delay alike. */
  age = 0;
  /** True if the last step struck the ground and bounced, for the clack. */
  bounced = false;

  constructor(
    x: number,
    y: number,
    vx: number,
    vy: number,
    spec: ProjectileSpec,
    fuseTicks: number,
    ownerIndex: number,
  ) {
    this.x = x;
    this.y = y;
    this.vx = vx;
    this.vy = vy;
    this.spec = spec;
    this.fuse = fuseTicks;
    this.ownerIndex = ownerIndex;
  }

  /** True once a mine's arming delay has elapsed. */
  get armed(): boolean {
    return this.age >= this.spec.armDelay;
  }

  /**
   * One tick of flight. Walks the path in sub-steps so a fast rocket cannot
   * tunnel through a thin wall - the reason an "impossible" shot really does
   * hit the dirt in front of the worm instead of the target behind it.
   */
  step(ctx: FlightContext): ProjectileOutcome {
    const { terrain, wind } = ctx;
    const spec = this.spec;
    this.age++;
    this.bounced = false;

    if (!this.resting) {
      this.vy += PHYS.gravity * spec.gravityScale;
      this.vx += wind * WIND_ACCEL * spec.windFactor;
      if (spec.homing && this.target && this.age >= spec.homingDelay) this.steerToTarget();

      const speed = Math.hypot(this.vx, this.vy);
      const steps = Math.max(1, Math.ceil(speed));

      for (let s = 0; s < steps; s++) {
        const nx = this.x + this.vx / steps;
        const ny = this.y + this.vy / steps;

        if (terrain.solid(nx, ny)) {
          if (!spec.bouncy) {
            this.x = nx;
            this.y = ny;
            return 'explode';
          }
          this.bounce(terrain, nx, ny);
          this.bounced = true;
          break;
        }

        this.x = nx;
        this.y = ny;
        if (this.armed && ctx.hitsWorm(nx, ny)) return 'explode';
      }

      // A homing missile that has arrived detonates rather than circling.
      if (spec.homing && this.target && Math.hypot(this.target.x - this.x, this.target.y - this.y) < 4) {
        return 'explode';
      }

      if (spec.settles && Math.hypot(this.vx, this.vy) < 0.22 && terrain.solid(this.x, this.y + 3)) {
        this.resting = true;
        this.vx = 0;
        this.vy = 0;
      }

      this.angle = spec.settles ? 0 : Math.atan2(this.vy, this.vx);
      this.trail.push({ x: this.x, y: this.y });
      if (this.trail.length > 26) this.trail.shift();
    } else if (!terrain.solid(this.x, this.y + 3)) {
      // The ground it was sitting on has been blown away.
      this.resting = false;
    }

    // Proximity fusing: a mine that senses a worm starts its short countdown.
    if (spec.proximity > 0 && this.fuse < 0 && this.armed && ctx.wormNear(this.x, this.y, spec.proximity)) {
      this.fuse = spec.triggerDelay;
    }

    if (this.fuse > 0) {
      this.fuse--;
      if (this.fuse === 0) return 'explode';
    } else if (this.fuse === 0) {
      return 'explode';
    }

    // Off the sides or over the top is simply gone; the sea is handled outside.
    if (this.x < -60 || this.x > terrain.width + 60) return 'gone';
    if (this.y > terrain.height + 120) return 'gone';
    return 'fly';
  }

  /** Turns the velocity toward the target at a limited rate, keeping speed. */
  private steerToTarget(): void {
    const t = this.target!;
    const speed = Math.hypot(this.vx, this.vy) || 0.001;
    const want = Math.atan2(t.y - this.y, t.x - this.x);
    const have = Math.atan2(this.vy, this.vx);
    let delta = want - have;
    while (delta > Math.PI) delta -= Math.PI * 2;
    while (delta < -Math.PI) delta += Math.PI * 2;
    const MAX_TURN = 0.075; // radians per tick - fast enough to chase, slow enough to miss
    const turn = Math.max(-MAX_TURN, Math.min(MAX_TURN, delta));
    const a = have + turn;
    const boost = Math.min(8.4, speed + 0.12); // gravity would otherwise bleed it dry
    this.vx = Math.cos(a) * boost;
    this.vy = Math.sin(a) * boost;
  }

  private bounce(terrain: Terrain, nx: number, ny: number): void {
    const n = surfaceNormal(terrain, nx, ny);
    const dot = this.vx * n.x + this.vy * n.y;
    const r = this.spec.restitution;
    this.vx = (this.vx - n.x * dot) * 0.82 - n.x * dot * r;
    this.vy = (this.vy - n.y * dot) * 0.82 - n.y * dot * r;
    this.x += n.x;
    this.y += n.y;
  }
}
