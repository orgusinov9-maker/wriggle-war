import { Noise2D } from '../core/noise';
import { Rng } from '../core/rng';

export interface Theme {
  readonly name: string;
  /** Top-down band of colours painted on every land surface (index 0 = topmost pixel). */
  readonly grass: readonly string[];
  /** Same band, but for land freshly exposed by an explosion. */
  readonly scorch: readonly string[];
  readonly dirtLight: string;
  readonly dirtDark: string;
  readonly sky: readonly [string, string];
  readonly water: readonly [string, string];
  /** Three parallax hill layers, far to near. */
  readonly hills: readonly [string, string, string];
}

export const THEMES: readonly Theme[] = [
  {
    name: 'Forest',
    hills: ['#4d7fae', '#3f6b8e', '#35566f'],
    grass: ['#8fdc3c', '#6fc229', '#4e9a1e', '#3a7616'],
    scorch: ['#3b2a1c', '#4a3524', '#5a422c'],
    dirtLight: '#9d6b3f',
    dirtDark: '#6b4525',
    sky: ['#2a5f9e', '#9fd0ef'],
    water: ['#2a6fbf', '#1c4c8a'],
  },
  {
    name: 'Desert',
    hills: ['#c98f5e', '#b0733f', '#8f5a2f'],
    grass: ['#f0d98a', '#dcbf63', '#c2a248', '#a68436'],
    scorch: ['#4a3620', '#5e4529', '#725433'],
    dirtLight: '#c99a5c',
    dirtDark: '#8e6635',
    sky: ['#d97b3a', '#f5d9a8'],
    water: ['#2f8f96', '#1d5f66'],
  },
  {
    name: 'Arctic',
    hills: ['#9fbcd4', '#83a3bd', '#6a89a3'],
    grass: ['#ffffff', '#e4f1fb', '#c8ddee', '#a9c4da'],
    scorch: ['#4b5a68', '#5d6d7c', '#72828f'],
    dirtLight: '#8fa2b3',
    dirtDark: '#5d6e7e',
    sky: ['#6d8fb5', '#dceaf5'],
    water: ['#3f8fc4', '#26638d'],
  },
  {
    name: 'Hell',
    hills: ['#5e1a16', '#4a1310', '#380d0b'],
    grass: ['#ff8a2a', '#e05f14', '#b8400c', '#8a2a08'],
    scorch: ['#2a1410', '#3a1c14', '#4a241a'],
    dirtLight: '#7a3a2a',
    dirtDark: '#4a1f18',
    sky: ['#4a0d10', '#c0421c'],
    water: ['#c43a18', '#7d2210'],
  },
];

const TILE = 128;

/**
 * Builds the repeating dirt fill for a theme. Two-tone fractal noise with a
 * faint horizontal striation, which reads as rock strata once it is tiled.
 */
export function buildDirtTile(theme: Theme, rng: Rng): ImageData {
  const noise = new Noise2D(rng);
  const tile = new ImageData(TILE, TILE);
  const light = hexToRgb(theme.dirtLight);
  const dark = hexToRgb(theme.dirtDark);

  for (let y = 0; y < TILE; y++) {
    for (let x = 0; x < TILE; x++) {
      // Sample on a torus so the tile wraps seamlessly in both directions.
      const u = (x / TILE) * Math.PI * 2;
      const v = (y / TILE) * Math.PI * 2;
      const n = noise.fbm(8 + Math.cos(u) * 2.4, 8 + Math.cos(v) * 2.4 + Math.sin(u) * 0.6, 4);
      const strata = 0.12 * Math.sin(y * 0.28 + n * 3);
      const t = clamp01(n * 1.25 - 0.12 + strata);
      const i = (y * TILE + x) * 4;
      tile.data[i] = Math.round(dark[0] + (light[0] - dark[0]) * t);
      tile.data[i + 1] = Math.round(dark[1] + (light[1] - dark[1]) * t);
      tile.data[i + 2] = Math.round(dark[2] + (light[2] - dark[2]) * t);
      tile.data[i + 3] = 255;
    }
  }
  return tile;
}

export function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}
