import { Terrain } from '../world/terrain';
import { PHYS, Worm, surfaceNormal } from './worm';

/**
 * The Ninja Rope.
 *
 * A hook flies out along the aim until it bites into the ground. From then on
 * the worm is a pendulum bob: gravity pulls it, the rope stops it going
 * further than its length from the pivot, and the arrow keys add swing and
 * reel the rope in or out.
 *
 * The rope wraps. When the straight line from the pivot to the worm passes
 * through terrain, a new pivot is set at the corner it caught on, and the
 * swing carries on around that. Swinging back past the corner unwraps it.
 * Each pivot remembers which way the rope was turning when it caught, and
 * the rope comes off the corner once it turns back the other way.
 */

export interface Pivot {
  readonly x: number;
  readonly y: number;
  /** Turning direction when the rope wrapped here: +1 or -1; 0 for the hook itself. */
  readonly side: number;
}

export type ShotOutcome = 'flying' | 'caught' | 'missed';

export interface SwingInput {
  /** -1 pushes the swing left, +1 right. */
  readonly swing: -1 | 0 | 1;
  /** -1 climbs (shortens the rope), +1 pays it out. */
  readonly climb: -1 | 0 | 1;
}

export class Rope {
  phase: 'flying' | 'attached' = 'flying';
  /** The hook's head while it is still in flight. */
  tipX: number;
  tipY: number;
  /** Pivot points from the hook to the one the worm currently swings from. */
  readonly pivots: Pivot[] = [];
  /** Length of the free end, from the last pivot to the worm. */
  length = 0;

  private readonly dirX: number;
  private readonly dirY: number;
  private travelled = 0;
  /** The solid pixel the hook bit into; if it is blown away, the rope lets go. */
  private bite = { x: 0, y: 0 };

  constructor(x: number, y: number, dirX: number, dirY: number) {
    this.tipX = x;
    this.tipY = y;
    const len = Math.hypot(dirX, dirY) || 1;
    this.dirX = dirX / len;
    this.dirY = dirY / len;
  }

  get pivot(): Pivot {
    return this.pivots[this.pivots.length - 1];
  }

  /** Rope already spent wrapped around corners, which the free end cannot have back. */
  private get wrapped(): number {
    let sum = 0;
    for (let i = 1; i < this.pivots.length; i++) {
      sum += Math.hypot(this.pivots[i].x - this.pivots[i - 1].x, this.pivots[i].y - this.pivots[i - 1].y);
    }
    return sum;
  }

  /** One tick of the hook in flight. */
  fly(terrain: Terrain, worm: Worm): ShotOutcome {
    for (let i = 0; i < PHYS.ropeShotSpeed; i++) {
      const nx = this.tipX + this.dirX;
      const ny = this.tipY + this.dirY;
      this.travelled++;
      if (terrain.solid(nx, ny)) {
        this.bite = { x: nx, y: ny };
        this.pivots.push({ x: this.tipX, y: this.tipY, side: 0 });
        this.length = Math.max(PHYS.ropeMinLength, Math.hypot(worm.x - this.tipX, worm.y - this.tipY));
        this.phase = 'attached';
        return 'caught';
      }
      this.tipX = nx;
      this.tipY = ny;
      if (this.travelled >= PHYS.ropeMaxLength) return 'missed';
    }
    return 'flying';
  }

  /**
   * One tick of swinging. Moves the worm itself; returns false when the rope
   * has lost its grip because the ground under the hook was blown away.
   */
  swing(worm: Worm, terrain: Terrain, input: SwingInput): boolean {
    if (!terrain.solid(this.bite.x, this.bite.y)) return false;

    if (input.climb !== 0) {
      const most = PHYS.ropeMaxLength - this.wrapped;
      this.length = Math.max(PHYS.ropeMinLength, Math.min(most, this.length + input.climb * PHYS.ropeClimb));
    }

    worm.vy += PHYS.gravity;
    const p = this.pivot;
    const rx = worm.x - p.x;
    const ry = worm.y - p.y;
    const r = Math.hypot(rx, ry) || 1;
    if (input.swing !== 0) {
      // Along the tangent; below the pivot, +1 pushes toward +x.
      worm.vx += (ry / r) * PHYS.ropeSwing * input.swing;
      worm.vy += (-rx / r) * PHYS.ropeSwing * input.swing;
    }
    const speed = Math.hypot(worm.vx, worm.vy);
    if (speed > PHYS.ropeMaxSpeed) {
      worm.vx *= PHYS.ropeMaxSpeed / speed;
      worm.vy *= PHYS.ropeMaxSpeed / speed;
    }

    this.move(worm, terrain);
    this.constrain(worm, terrain);
    this.wrap(worm, terrain);
    this.unwrap(worm, terrain);
    if (Math.abs(worm.vx) > 0.2) worm.facing = worm.vx > 0 ? 1 : -1;
    return true;
  }

  /** Free motion in sub-steps, bouncing off anything it swings into. */
  private move(worm: Worm, terrain: Terrain): void {
    const steps = Math.max(1, Math.ceil(Math.hypot(worm.vx, worm.vy)));
    for (let s = 0; s < steps; s++) {
      const nx = worm.x + worm.vx / steps;
      const ny = worm.y + worm.vy / steps;
      if (worm.fits(terrain, nx, ny)) {
        worm.x = nx;
        worm.y = ny;
        continue;
      }
      const n = surfaceNormal(terrain, nx, ny);
      const dot = worm.vx * n.x + worm.vy * n.y;
      if (dot < 0) {
        worm.vx -= n.x * dot * (1 + PHYS.ropeRestitution);
        worm.vy -= n.y * dot * (1 + PHYS.ropeRestitution);
      }
      if (worm.fits(terrain, worm.x + n.x, worm.y + n.y)) {
        worm.x += n.x;
        worm.y += n.y;
      }
      return;
    }
  }

  /** The rope goes taut: no further from the pivot than its length, and no outward speed. */
  private constrain(worm: Worm, terrain: Terrain): void {
    const p = this.pivot;
    const dx = worm.x - p.x;
    const dy = worm.y - p.y;
    const dist = Math.hypot(dx, dy);
    if (dist <= this.length || dist === 0) return;
    const ux = dx / dist;
    const uy = dy / dist;
    const tx = p.x + ux * this.length;
    const ty = p.y + uy * this.length;
    if (worm.fits(terrain, tx, ty)) {
      worm.x = tx;
      worm.y = ty;
    }
    const outward = worm.vx * ux + worm.vy * uy;
    if (outward > 0) {
      worm.vx -= ux * outward;
      worm.vy -= uy * outward;
    }
  }

  /** Distance along pivot->worm at which terrain first blocks the rope, or -1. */
  private blocked(terrain: Terrain, p: { x: number; y: number }, worm: Worm): number {
    const dx = worm.x - p.x;
    const dy = worm.y - p.y;
    const dist = Math.hypot(dx, dy);
    // Stop short of the worm, or the ground it brushes would count as a corner.
    for (let t = 2; t < dist - PHYS.radius - 2; t++) {
      if (terrain.solid(p.x + (dx / dist) * t, p.y + (dy / dist) * t)) return t;
    }
    return -1;
  }

  private wrap(worm: Worm, terrain: Terrain): void {
    for (let guard = 0; guard < 4; guard++) {
      const p = this.pivot;
      const hit = this.blocked(terrain, p, worm);
      if (hit < 0) return;
      const dx = worm.x - p.x;
      const dy = worm.y - p.y;
      const dist = Math.hypot(dx, dy);
      const at = Math.max(1, hit - 1.5);
      const corner = { x: p.x + (dx / dist) * at, y: p.y + (dy / dist) * at };
      // Which way the rope is sweeping round the old pivot right now.
      const turn = Math.sign(dx * worm.vy - dy * worm.vx) || 1;
      this.pivots.push({ ...corner, side: turn });
      this.length = Math.max(PHYS.ropeMinLength, this.length - at);
    }
  }

  private unwrap(worm: Worm, terrain: Terrain): void {
    while (this.pivots.length > 1) {
      const a = this.pivots[this.pivots.length - 1];
      const p = this.pivots[this.pivots.length - 2];
      // Bend at the corner: positive when turning the way it wrapped.
      const bend = (a.x - p.x) * (worm.y - a.y) - (a.y - p.y) * (worm.x - a.x);
      if (bend * a.side >= 0) return;
      if (this.blocked(terrain, p, worm) >= 0) return;
      this.pivots.pop();
      this.length += Math.hypot(a.x - p.x, a.y - p.y);
    }
  }

  /** Every point the rope passes through, hook first, for drawing. */
  path(): { x: number; y: number }[] {
    return this.phase === 'flying' ? [{ x: this.tipX, y: this.tipY }] : this.pivots.map((p) => ({ x: p.x, y: p.y }));
  }
}
