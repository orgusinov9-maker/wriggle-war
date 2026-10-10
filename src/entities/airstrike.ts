/**
 * The bomber. It is not a physics object - it simply crosses the sky at a
 * constant speed and reports where each bomb leaves the bay, so the match can
 * spawn a real projectile there.
 */
export class AirStrike {
  x: number;
  readonly y = 54;
  readonly vx: number;
  /** Bombs still in the bay. */
  private left: number;
  /** World x at which the next bomb falls. */
  private nextDrop: number;
  private readonly spacing: number;

  constructor(targetX: number, mapWidth: number, count = 5, spacing = 20) {
    // Approach from whichever edge gives the longer visible run-in.
    const fromLeft = targetX > mapWidth / 2;
    this.vx = fromLeft ? 5 : -5;
    this.x = fromLeft ? -90 : mapWidth + 90;
    this.spacing = spacing;
    this.left = count;
    // The salvo straddles the target rather than starting on it.
    this.nextDrop = targetX - Math.sign(this.vx) * ((count - 1) / 2) * spacing;
  }

  /** Advances one tick and returns this tick's bomb release points. */
  tick(): { x: number; y: number }[] {
    this.x += this.vx;
    const drops: { x: number; y: number }[] = [];
    while (this.left > 0 && (this.vx > 0 ? this.x >= this.nextDrop : this.x <= this.nextDrop)) {
      drops.push({ x: this.x, y: this.y + 6 });
      this.left--;
      this.nextDrop += Math.sign(this.vx) * this.spacing;
    }
    return drops;
  }

  /** True once the bay is empty and it has flown off the far side. */
  offscreen(mapWidth: number): boolean {
    return this.left === 0 && (this.x < -150 || this.x > mapWidth + 150);
  }
}
