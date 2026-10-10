import { Rng } from './rng';

/**
 * Classic 2D value noise with fractal octaves. Used for both the surface
 * silhouette and the cave carving pass, which is how the original landscapes
 * get their lumpy, hand-drawn feel without any authored art.
 */
export class Noise2D {
  private readonly perm: Uint8Array;

  constructor(rng: Rng) {
    const p = new Uint8Array(512);
    for (let i = 0; i < 256; i++) p[i] = i;
    for (let i = 255; i > 0; i--) {
      const j = rng.int(0, i);
      const t = p[i];
      p[i] = p[j];
      p[j] = t;
    }
    for (let i = 0; i < 256; i++) p[i + 256] = p[i];
    this.perm = p;
  }

  private hash(x: number, y: number): number {
    return this.perm[(this.perm[x & 255] + (y & 255)) & 511] / 255;
  }

  /** Single octave, smoothstep-interpolated. */
  value(x: number, y: number): number {
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const fx = smooth(x - x0);
    const fy = smooth(y - y0);
    const a = this.hash(x0, y0);
    const b = this.hash(x0 + 1, y0);
    const c = this.hash(x0, y0 + 1);
    const d = this.hash(x0 + 1, y0 + 1);
    return lerp(lerp(a, b, fx), lerp(c, d, fx), fy);
  }

  /** Fractal sum; returns roughly 0..1. */
  fbm(x: number, y: number, octaves: number, lacunarity = 2, gain = 0.5): number {
    let amp = 1;
    let freq = 1;
    let sum = 0;
    let norm = 0;
    for (let i = 0; i < octaves; i++) {
      sum += amp * this.value(x * freq, y * freq);
      norm += amp;
      amp *= gain;
      freq *= lacunarity;
    }
    return sum / norm;
  }
}

function smooth(t: number): number {
  return t * t * (3 - 2 * t);
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}
