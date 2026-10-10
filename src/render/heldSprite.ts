import type { WeaponId } from '../entities/weapons';

/**
 * What the worm holds while it aims, as pixel art in the same spirit as the
 * worm: each item is a few rectangles and discs laid along the aim line, and
 * it is rasterised at its angle rather than rotated as an image, so a bazooka
 * at 37 degrees is as crisp as one held level.
 */

type Rgb = readonly [number, number, number];

/**
 * A part of an item in its own frame: +u runs along the aim, +v is "down"
 * relative to it. The grip sits at the origin.
 */
type Part =
  | { kind: 'rect'; u0: number; u1: number; v0: number; v1: number; color: Rgb }
  | { kind: 'disc'; u: number; v: number; r: number; color: Rgb };

/** How an item is carried: along the aim line, or upright in the hand whatever the aim. */
interface Item {
  readonly parts: readonly Part[];
  readonly upright?: boolean;
}

const OLIVE: Rgb = [92, 112, 58];
const OLIVE_DARK: Rgb = [58, 72, 36];
const STEEL: Rgb = [128, 134, 146];
const GUNMETAL: Rgb = [66, 70, 82];
const WOOD: Rgb = [150, 94, 48];
const RED: Rgb = [210, 48, 40];
const GREEN: Rgb = [70, 142, 58];
const GOLD: Rgb = [236, 190, 60];
const YELLOW: Rgb = [250, 222, 70];
const WHITE: Rgb = [245, 245, 245];

const rect = (u0: number, u1: number, v0: number, v1: number, color: Rgb): Part => ({ kind: 'rect', u0, u1, v0, v1, color });
const disc = (u: number, v: number, r: number, color: Rgb): Part => ({ kind: 'disc', u, v, r, color });

/** Weapons with nothing drawn in hand are simply absent. */
const ITEMS: Partial<Record<WeaponId, Item>> = {
  // Launcher tube resting on the shoulder, reaching back past the grip.
  bazooka: { parts: [rect(-6, 9, -3, 0, OLIVE), rect(7, 9, -3.5, 0.5, OLIVE_DARK), rect(-1, 1, 0, 2, OLIVE_DARK)] },
  homing: { parts: [rect(-6, 9, -3, 0, STEEL), rect(7, 9, -3.5, 0.5, RED), rect(-1, 1, 0, 2, GUNMETAL)] },
  mortar: { parts: [rect(-4, 8, -3.5, 0.5, GUNMETAL), rect(6, 8, -4, 1, STEEL), rect(-1, 1, 0.5, 2.5, GUNMETAL)] },
  grenade: { parts: [disc(3, -1, 2.2, GREEN), rect(2.5, 3.5, -4, -2.5, STEEL)] },
  cluster: { parts: [disc(3, -1, 2.2, RED), rect(2.5, 3.5, -4, -2.5, STEEL)] },
  banana: { parts: [disc(2.5, -1, 2.2, YELLOW), disc(4.5, -2.5, 1.5, YELLOW)] },
  holy: { parts: [disc(3, -1, 2.6, GOLD), rect(2.5, 3.5, -5.5, -2.5, GOLD), rect(1.5, 4.5, -4.8, -4, GOLD)] },
  shotgun: { parts: [rect(-3, 1, -1, 1.5, WOOD), rect(1, 10, -1.5, 0, GUNMETAL), rect(1, 7, 0, 1, GUNMETAL)] },
  uzi: { parts: [rect(-1, 6, -1.5, 0.5, GUNMETAL), rect(1, 2.5, 0.5, 4, GUNMETAL)] },
  bat: { parts: [rect(-1, 3, -0.8, 0.8, WOOD), rect(3, 11, -1.4, 1.2, WOOD)] },
  // A stubby grapple gun with the hook seated in its muzzle.
  rope: { parts: [rect(-1, 5, -1.5, 1, GUNMETAL), rect(5, 7, -2, 1.5, STEEL), rect(0, 1.5, 1, 3, GUNMETAL)] },
  // A gas bottle with the burner nozzle pointing along the aim.
  blowtorch: { parts: [rect(-2, 3, -2.5, 2, RED), rect(3, 9, -1, 0.5, STEEL), rect(9, 10.5, -1.5, 1, GUNMETAL), rect(0, 1.5, 2, 3.5, GUNMETAL)] },
  // Carried low and forward, clear of the face.
  dynamite: { upright: true, parts: [rect(1, 4, -1, 5, RED), rect(2, 3, -3, -1, WHITE)] },
  mine: { upright: true, parts: [rect(0.5, 5.5, 2, 4.5, GUNMETAL), disc(3, 2, 1, RED)] },
};

export const HELD_SIZE = 36;
const ORIGIN = HELD_SIZE / 2;
/** Aim is quantised over the half-turn from straight up to straight down. */
export const AIM_STEPS = 32;

const OUTLINE: Rgb = [28, 20, 24];

function hit(part: Part, u: number, v: number): boolean {
  if (part.kind === 'rect') return u >= part.u0 && u < part.u1 && v >= part.v0 && v < part.v1;
  return Math.hypot(u - part.u, v - part.v) <= part.r;
}

/**
 * Paints an item at an aim step into RGBA, facing right. Null when the weapon
 * has nothing to hold.
 */
export function rasterHeld(weapon: WeaponId, aimStep: number): { size: number; rgba: Uint8ClampedArray } | null {
  const item = ITEMS[weapon];
  if (!item) return null;
  const angle = item.upright ? 0 : ((aimStep / (AIM_STEPS - 1)) * 2 - 1) * (Math.PI / 2);
  const c = Math.cos(angle);
  const s = Math.sin(angle);

  const N = HELD_SIZE;
  const colour: (Rgb | null)[] = new Array(N * N).fill(null);
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const dx = x + 0.5 - ORIGIN;
      const dy = y + 0.5 - ORIGIN;
      const u = dx * c + dy * s;
      const v = -dx * s + dy * c;
      for (const part of item.parts) if (hit(part, u, v)) colour[y * N + x] = part.color;
    }
  }

  const rgba = new Uint8ClampedArray(N * N * 4);
  const put = (i: number, [r, g, b]: Rgb) => {
    rgba[i * 4] = r;
    rgba[i * 4 + 1] = g;
    rgba[i * 4 + 2] = b;
    rgba[i * 4 + 3] = 255;
  };
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const i = y * N + x;
      const col = colour[i];
      if (col) {
        // A pixel with open sky above it catches the light.
        const lit = y > 0 && colour[i - N] === null;
        put(i, lit ? [Math.min(255, col[0] + 50), Math.min(255, col[1] + 50), Math.min(255, col[2] + 50)] : col);
      } else {
        const edge =
          (x > 0 && colour[i - 1]) || (x < N - 1 && colour[i + 1]) || (y > 0 && colour[i - N]) || (y < N - 1 && colour[i + N]);
        if (edge) put(i, OUTLINE);
      }
    }
  }
  return { size: N, rgba };
}

/** Painted on demand and kept, like the worm frames. */
export class HeldSprites {
  private readonly cache = new Map<string, HTMLCanvasElement | null>();

  get(weapon: WeaponId, aim: number): HTMLCanvasElement | null {
    const step = Math.max(0, Math.min(AIM_STEPS - 1, Math.round(((aim / (Math.PI / 2) + 1) / 2) * (AIM_STEPS - 1))));
    const key = `${weapon}|${step}`;
    if (this.cache.has(key)) return this.cache.get(key)!;

    const raster = rasterHeld(weapon, step);
    let canvas: HTMLCanvasElement | null = null;
    if (raster) {
      canvas = document.createElement('canvas');
      canvas.width = canvas.height = raster.size;
      const ctx = canvas.getContext('2d')!;
      const image = ctx.createImageData(raster.size, raster.size);
      image.data.set(raster.rgba);
      ctx.putImageData(image, 0, 0);
    }
    this.cache.set(key, canvas);
    return canvas;
  }
}

/** Where the grip sits relative to the worm's centre, facing right. */
export const HAND = { x: 3, y: -1 };
export const HELD_ORIGIN = ORIGIN;
