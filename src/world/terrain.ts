import { Theme, buildDirtTile, hexToRgb } from './themes';
import { Rng } from '../core/rng';
import { girderCells, girderColor } from './girder';

export const AIR = 0;
export const LAND = 1;
export const ROCK = 2; // indestructible (map border on cave layouts)
export const GIRDER = 3; // placed steel: solid and destructible, painted in its own colours

/** How many pixels of the surface band get the grass / scorch colours. */
const BAND = 4;

/** Rows of darkened dirt beneath the surface band, for a lit-from-above look. */
const SHADE = 5;

/**
 * The landscape. Collision is a 1-byte-per-pixel mask, exactly like the
 * original: every weapon just punches holes in it, and nothing about the
 * terrain is made of polygons or pre-authored art.
 */
export class Terrain {
  readonly width: number;
  readonly height: number;
  readonly mask: Uint8Array;
  /** 1 where land has been exposed by an explosion, so it renders burnt. */
  private readonly scorched: Uint8Array;
  readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly dirt: ImageData;
  private readonly grassRgb: [number, number, number][];
  private readonly scorchRgb: [number, number, number][];
  /** Paint for girder pixels, keyed by mask index; girders are few, so a map beats a full layer. */
  private readonly girderRgb = new Map<number, readonly [number, number, number]>();

  constructor(width: number, height: number, theme: Theme, rng: Rng) {
    this.width = width;
    this.height = height;
    this.mask = new Uint8Array(width * height);
    this.scorched = new Uint8Array(width * height);
    this.dirt = buildDirtTile(theme, rng);
    this.grassRgb = theme.grass.map(hexToRgb);
    this.scorchRgb = theme.scorch.map(hexToRgb);

    this.canvas = document.createElement('canvas');
    this.canvas.width = width;
    this.canvas.height = height;
    const ctx = this.canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) throw new Error('2d context unavailable');
    this.ctx = ctx;
  }

  private idx(x: number, y: number): number {
    return y * this.width + x;
  }

  /** Out of bounds is open air on every side — worms can be blasted off the map. */
  solid(x: number, y: number): boolean {
    const ix = x | 0;
    const iy = y | 0;
    if (ix < 0 || iy < 0 || ix >= this.width || iy >= this.height) return false;
    return this.mask[iy * this.width + ix] !== AIR;
  }

  at(x: number, y: number): number {
    const ix = x | 0;
    const iy = y | 0;
    if (ix < 0 || iy < 0 || ix >= this.width || iy >= this.height) return AIR;
    return this.mask[iy * this.width + ix];
  }

  /** Blow a circular hole. Returns the number of land pixels removed. */
  destroy(cx: number, cy: number, radius: number, scorch = true): number {
    const r = Math.max(1, Math.round(radius));
    const x0 = Math.max(0, Math.round(cx) - r);
    const x1 = Math.min(this.width - 1, Math.round(cx) + r);
    const y0 = Math.max(0, Math.round(cy) - r);
    const y1 = Math.min(this.height - 1, Math.round(cy) + r);
    const rr = r * r;
    const scorchR = (r + BAND + 2) * (r + BAND + 2);
    let removed = 0;

    for (let y = y0; y <= y1; y++) {
      const dy = y - cy;
      for (let x = x0; x <= x1; x++) {
        const dx = x - cx;
        const d = dx * dx + dy * dy;
        const i = this.idx(x, y);
        if (d <= rr) {
          if (this.mask[i] === LAND || this.mask[i] === GIRDER) {
            this.mask[i] = AIR;
            removed++;
          }
        } else if (scorch && d <= scorchR && this.mask[i] === LAND) {
          this.scorched[i] = 1;
        }
      }
    }
    if (scorch) {
      // The rim of the crater itself must read as burnt, not as fresh grass.
      this.markScorchRing(cx, cy, r + BAND + 2);
    }
    this.redraw(x0 - BAND - 3, y0 - BAND - 3, x1 + BAND + 3, y1 + BAND + 3);
    return removed;
  }

  private markScorchRing(cx: number, cy: number, r: number): void {
    const x0 = Math.max(0, Math.round(cx - r));
    const x1 = Math.min(this.width - 1, Math.round(cx + r));
    const y0 = Math.max(0, Math.round(cy - r));
    const y1 = Math.min(this.height - 1, Math.round(cy + r));
    const rr = r * r;
    for (let y = y0; y <= y1; y++) {
      const dy = y - cy;
      for (let x = x0; x <= x1; x++) {
        const dx = x - cx;
        if (dx * dx + dy * dy > rr) continue;
        const i = this.idx(x, y);
        if (this.mask[i] === LAND) this.scorched[i] = 1;
      }
    }
  }

  /** Add land (girders, and the initial build). */
  setPixel(x: number, y: number, value: number): void {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return;
    this.mask[this.idx(x, y)] = value;
  }

  /**
   * Lays a girder into the mask. It fills air and overwrites dirt, but never
   * indestructible rock.
   */
  placeGirder(cx: number, cy: number, step: number): void {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    girderCells(cx, cy, step, (x, y, u, v) => {
      if (x < 0 || y < 0 || x >= this.width || y >= this.height) return;
      const i = this.idx(x, y);
      if (this.mask[i] === ROCK) return;
      this.mask[i] = GIRDER;
      this.girderRgb.set(i, girderColor(u, v));
      x0 = Math.min(x0, x); y0 = Math.min(y0, y);
      x1 = Math.max(x1, x); y1 = Math.max(y1, y);
    });
    // One row further down, so dirt under the beam gets its grass edge back.
    if (x1 >= x0) this.redraw(x0, y0, x1, y1 + BAND + SHADE + 1);
  }

  /** First solid pixel at or below `y` in column `x`, or -1 if the column is clear. */
  groundBelow(x: number, y: number): number {
    for (let yy = Math.max(0, y | 0); yy < this.height; yy++) {
      if (this.mask[this.idx(x | 0, yy)] !== AIR) return yy;
    }
    return -1;
  }

  /** Walks a ray one pixel at a time; used by hitscan weapons and line-of-sight. */
  raycast(x0: number, y0: number, x1: number, y1: number): { x: number; y: number } | null {
    const dx = x1 - x0;
    const dy = y1 - y0;
    const steps = Math.max(1, Math.ceil(Math.hypot(dx, dy)));
    for (let s = 0; s <= steps; s++) {
      const x = x0 + (dx * s) / steps;
      const y = y0 + (dy * s) / steps;
      if (x < 0 || x >= this.width || y >= this.height) return null;
      if (y < 0) continue;
      if (this.solid(x, y)) return { x, y };
    }
    return null;
  }

  redrawAll(): void {
    this.redraw(0, 0, this.width - 1, this.height - 1);
  }

  /**
   * Repaints a rectangle of the land bitmap from the mask: dirt fill, then a
   * top-lit surface band whose palette depends on whether that patch has been
   * scorched by an explosion.
   */
  redraw(rx0: number, ry0: number, rx1: number, ry1: number): void {
    const x0 = Math.max(0, rx0 | 0);
    const y0 = Math.max(0, ry0 | 0);
    const x1 = Math.min(this.width - 1, rx1 | 0);
    const y1 = Math.min(this.height - 1, ry1 | 0);
    if (x1 < x0 || y1 < y0) return;

    const w = x1 - x0 + 1;
    const h = y1 - y0 + 1;
    const img = this.ctx.createImageData(w, h);
    const out = img.data;
    const dirt = this.dirt.data;
    const tw = this.dirt.width;
    const th = this.dirt.height;

    for (let x = x0; x <= x1; x++) {
      // Continue the surface band correctly when the rectangle starts mid-rock.
      let depth = BAND + 1;
      for (let k = 1; k <= BAND; k++) {
        const above = this.at(x, y0 - k);
        if (above === AIR || above === GIRDER) {
          depth = k - 1;
          break;
        }
      }

      for (let y = y0; y <= y1; y++) {
        const i = this.idx(x, y);
        const o = ((y - y0) * w + (x - x0)) * 4;
        if (this.mask[i] === AIR) {
          depth = 0;
          out[o + 3] = 0;
          continue;
        }
        if (this.mask[i] === GIRDER) {
          // Steel keeps its own paint, and whatever lies under it starts a fresh surface.
          const c = this.girderRgb.get(i) ?? [150, 160, 178];
          out[o] = c[0];
          out[o + 1] = c[1];
          out[o + 2] = c[2];
          out[o + 3] = 255;
          depth = 0;
          continue;
        }
        depth++;

        let r: number;
        let g: number;
        let b: number;
        if (depth <= BAND) {
          const band = this.scorched[i] ? this.scorchRgb : this.grassRgb;
          const c = band[Math.min(depth - 1, band.length - 1)];
          [r, g, b] = c;
        } else {
          const d = (((y % th) + th) % th) * tw * 4 + (((x % tw) + tw) % tw) * 4;
          r = dirt[d];
          g = dirt[d + 1];
          b = dirt[d + 2];
          // Ambient occlusion just under the surface band: reads as the land
          // catching light from above rather than being a flat fill.
          if (depth <= BAND + SHADE) {
            const k = 0.62 + ((depth - BAND) / SHADE) * 0.38;
            r *= k;
            g *= k;
            b *= k;
          }
          if (this.mask[i] === ROCK) {
            // Indestructible rock is the same texture, desaturated and cooler.
            const lum = (r + g + b) / 3;
            r = (r + lum * 2) / 3.2;
            g = (g + lum * 2) / 3.1;
            b = (b + lum * 2) / 2.8;
          }
        }
        out[o] = r;
        out[o + 1] = g;
        out[o + 2] = b;
        out[o + 3] = 255;
      }
    }

    this.ctx.putImageData(img, x0, y0);
  }
}
