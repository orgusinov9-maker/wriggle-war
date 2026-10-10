import { Noise2D } from '../core/noise';
import { Rng } from '../core/rng';
import { AIR, LAND, ROCK, Terrain } from './terrain';
import { THEMES, Theme } from './themes';

/** The classic playfield size. Everything else is derived from it. */
export const MAP_WIDTH = 1920;
export const MAP_HEIGHT = 696;

export type MapStyle = 'island' | 'ridges' | 'cave';
const STYLES: readonly MapStyle[] = ['island', 'ridges', 'cave'];

export interface GeneratedMap {
  readonly terrain: Terrain;
  readonly theme: Theme;
  readonly style: MapStyle;
  readonly seed: number;
  /** Surface spots wide and flat enough to drop a worm onto, left to right. */
  readonly spawnPoints: readonly { x: number; y: number }[];
  readonly waterLevel: number;
}

export function generateMap(seed: number, style?: MapStyle): GeneratedMap {
  const rng = new Rng(seed);
  const theme = rng.pick(THEMES);
  const chosen = style ?? rng.pick(STYLES);
  const terrain = new Terrain(MAP_WIDTH, MAP_HEIGHT, theme, rng);
  const noise = new Noise2D(rng);

  switch (chosen) {
    case 'island':
      buildIsland(terrain, noise, rng);
      break;
    case 'ridges':
      buildRidges(terrain, noise, rng);
      break;
    case 'cave':
      buildCave(terrain, noise, rng);
      break;
  }

  smooth(terrain, 2);
  terrain.redrawAll();

  const waterLevel = MAP_HEIGHT - 42;
  return {
    terrain,
    theme,
    style: chosen,
    seed,
    spawnPoints: findSpawnPoints(terrain, waterLevel, rng),
    waterLevel,
  };
}

/** A floating landmass that tapers off before the map edges. */
function buildIsland(terrain: Terrain, noise: Noise2D, rng: Rng): void {
  const { width: W, height: H } = terrain;
  const yOff = rng.range(0, 500);
  const caveOff = rng.range(0, 500);
  const fadeWidth = W * rng.range(0.07, 0.13);

  for (let x = 0; x < W; x++) {
    const top = H * 0.17 + noise.fbm(x * 0.0021 + yOff, 11.5, 5) * H * 0.36;
    const bottom = H * 0.70 + noise.fbm(x * 0.0029 + yOff, 71.5, 4) * H * 0.27;
    const edge = smoothstep(clamp01(Math.min(x, W - 1 - x) / fadeWidth));
    const mid = (top + bottom) / 2;
    const half = ((bottom - top) / 2) * edge;
    if (half < 3) continue;

    const y0 = Math.round(mid - half);
    const y1 = Math.round(mid + half);
    for (let y = Math.max(0, y0); y <= Math.min(H - 1, y1); y++) {
      // Leave a solid crust under the grass and above the underside, then let
      // noise hollow out the interior into caverns and arches.
      const fromTop = y - y0;
      const fromBottom = y1 - y;
      if (fromTop > 14 && fromBottom > 8) {
        const n = noise.fbm(x * 0.0052 + caveOff, y * 0.0072, 4);
        if (n > 0.615) continue;
      }
      terrain.setPixel(x, y, LAND);
    }
  }

  for (let i = 0, n = rng.int(2, 5); i < n; i++) {
    blob(terrain, noise, rng.range(W * 0.12, W * 0.88), rng.range(H * 0.10, H * 0.42), rng.range(18, 52), rng);
  }
}

/** Mountain ridges rooted in the map floor — lots of vertical cover. */
function buildRidges(terrain: Terrain, noise: Noise2D, rng: Rng): void {
  const { width: W, height: H } = terrain;
  const off = rng.range(0, 500);
  const caveOff = rng.range(0, 500);

  for (let x = 0; x < W; x++) {
    const ridge = 1 - Math.abs(noise.fbm(x * 0.0026 + off, 3.5, 5) * 2 - 1);
    const top = H * 0.80 - Math.pow(ridge, 1.35) * H * 0.66;
    const y0 = Math.round(top);
    for (let y = Math.max(0, y0); y < H; y++) {
      if (y - y0 > 16) {
        const n = noise.fbm(x * 0.0048 + caveOff, y * 0.0062, 4);
        if (n > 0.60) continue;
      }
      terrain.setPixel(x, y, LAND);
    }
  }
}

/** A fully enclosed cavern with indestructible walls, so nothing escapes. */
function buildCave(terrain: Terrain, noise: Noise2D, rng: Rng): void {
  const { width: W, height: H } = terrain;
  const off = rng.range(0, 500);
  const border = 10;

  for (let x = 0; x < W; x++) {
    for (let y = 0; y < H; y++) {
      const n = contrast(noise.fbm(x * 0.0040 + off, y * 0.0062, 5), 2.4);
      // Keep the roof and floor thick; open up the middle into chambers.
      const vert = Math.abs(y / H - 0.5) * 2;
      const open = n < 0.62 - vert * 0.34;
      terrain.setPixel(x, y, open ? AIR : LAND);
    }
  }

  for (let x = 0; x < W; x++) {
    for (let b = 0; b < border; b++) {
      terrain.setPixel(x, b, ROCK);
      terrain.setPixel(x, H - 1 - b, ROCK);
    }
  }
  for (let y = 0; y < H; y++) {
    for (let b = 0; b < border; b++) {
      terrain.setPixel(b, y, ROCK);
      terrain.setPixel(W - 1 - b, y, ROCK);
    }
  }
}

function blob(terrain: Terrain, noise: Noise2D, cx: number, cy: number, r: number, rng: Rng): void {
  const off = rng.range(0, 500);
  for (let y = Math.round(cy - r * 1.4); y <= Math.round(cy + r * 1.4); y++) {
    for (let x = Math.round(cx - r * 1.6); x <= Math.round(cx + r * 1.6); x++) {
      const a = Math.atan2(y - cy, x - cx);
      const wobble = 0.65 + noise.fbm(Math.cos(a) * 2 + off, Math.sin(a) * 2 + off, 3) * 0.75;
      const dx = (x - cx) / (r * wobble * 1.25);
      const dy = (y - cy) / (r * wobble * 0.7);
      if (dx * dx + dy * dy <= 1) terrain.setPixel(x, y, LAND);
    }
  }
}

/** Majority filter — knocks the single-pixel fuzz off noise-generated edges. */
function smooth(terrain: Terrain, passes: number): void {
  const { width: W, height: H, mask } = terrain;
  for (let p = 0; p < passes; p++) {
    const copy = mask.slice();
    for (let y = 1; y < H - 1; y++) {
      for (let x = 1; x < W - 1; x++) {
        const i = y * W + x;
        if (copy[i] === ROCK) continue;
        let n = 0;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            if (dx === 0 && dy === 0) continue;
            if (copy[i + dy * W + dx] !== AIR) n++;
          }
        }
        if (n >= 6) mask[i] = copy[i] === AIR ? LAND : copy[i];
        else if (n <= 2) mask[i] = AIR;
      }
    }
  }
}

/**
 * Every ledge worth dropping a worm onto: an air-to-land transition with
 * headroom above and solid footing either side. Scans whole columns, so it
 * finds platforms inside caves as well as the open surface.
 */
function findSpawnPoints(terrain: Terrain, waterLevel: number, rng: Rng): { x: number; y: number }[] {
  const points: { x: number; y: number }[] = [];
  const { width: W } = terrain;
  const HEADROOM = 22;
  const maxY = waterLevel - 14;

  for (let x = 24; x < W - 24; x += 6) {
    let airRun = 0;
    for (let y = 2; y < maxY; y++) {
      if (!terrain.solid(x, y)) {
        airRun++;
        continue;
      }
      // Land pixel: qualifies if the air above it was tall enough to stand in.
      if (airRun >= HEADROOM && terrain.solid(x - 3, y + 2) && terrain.solid(x + 3, y + 2)) {
        points.push({ x, y: y - 12 });
      }
      airRun = 0;
    }
  }

  // Shuffle so team placement is not left-to-right predictable.
  for (let i = points.length - 1; i > 0; i--) {
    const j = rng.int(0, i);
    const t = points[i];
    points[i] = points[j];
    points[j] = t;
  }
  return points;
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/** Pushes fractal noise away from its mean so thresholds bite harder. */
function contrast(n: number, k: number): number {
  return clamp01((n - 0.5) * k + 0.5);
}

function smoothstep(t: number): number {
  return t * t * (3 - 2 * t);
}
