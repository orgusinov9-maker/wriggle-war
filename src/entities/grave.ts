import { Terrain } from '../world/terrain';
import { PHYS } from './worm';

/**
 * The headstone a worm leaves behind. It is a falling object rather than part
 * of the terrain mask, so later blasts throw it around instead of digging it up.
 */
export class Grave {
  x: number;
  y: number;
  vy = 0;
  settled = false;
  readonly teamIndex: number;
  /** One of three stone shapes, picked per worm so a graveyard looks varied. */
  readonly variant: number;

  constructor(x: number, y: number, teamIndex: number, variant: number) {
    this.x = x;
    this.y = y;
    this.teamIndex = teamIndex;
    this.variant = variant;
  }

  tick(terrain: Terrain, waterLevel: number): void {
    if (this.settled) {
      // A blast under a settled grave lets it fall again.
      if (!terrain.solid(this.x, this.y + 7)) this.settled = false;
      return;
    }

    this.vy = Math.min(this.vy + PHYS.gravity, PHYS.terminalVelocity);
    const steps = Math.max(1, Math.ceil(this.vy));
    for (let s = 0; s < steps; s++) {
      if (terrain.solid(this.x, this.y + 7)) {
        this.vy = 0;
        this.settled = true;
        return;
      }
      this.y += this.vy / steps;
      if (this.y > waterLevel + 40) return; // sunk; the match logic removes it
    }
  }
}
