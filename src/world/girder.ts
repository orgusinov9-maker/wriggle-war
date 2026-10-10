/**
 * The girder: a steel beam the player drops into the map. It becomes part of
 * the terrain mask - worms walk on it, ropes bite into it, blasts break it -
 * but it keeps its own look instead of the theme's dirt and grass.
 */

export const GIRDER_LENGTH = 56;
export const GIRDER_THICKNESS = 8;
/** Orientations, in equal steps over a half turn: level, then tilting clockwise. */
export const GIRDER_ANGLES = 8;

export function girderAngle(step: number): number {
  const s = ((step % GIRDER_ANGLES) + GIRDER_ANGLES) % GIRDER_ANGLES;
  return (s * Math.PI) / GIRDER_ANGLES;
}

/**
 * Every whole pixel the beam covers, with its position along the beam (u,
 * from -length/2) and across it (v, from -thickness/2, top edge first).
 */
export function girderCells(
  cx: number,
  cy: number,
  step: number,
  visit: (x: number, y: number, u: number, v: number) => void,
): void {
  const a = girderAngle(step);
  const c = Math.cos(a);
  const s = Math.sin(a);
  const half = GIRDER_LENGTH / 2;
  const reach = Math.ceil(half + GIRDER_THICKNESS);
  const x0 = Math.round(cx) - reach;
  const y0 = Math.round(cy) - reach;
  for (let y = y0; y <= y0 + reach * 2; y++) {
    for (let x = x0; x <= x0 + reach * 2; x++) {
      const dx = x + 0.5 - cx;
      const dy = y + 0.5 - cy;
      const u = dx * c + dy * s;
      const v = -dx * s + dy * c;
      if (Math.abs(u) < half && Math.abs(v) < GIRDER_THICKNESS / 2) visit(x, y, u, v);
    }
  }
}

/**
 * Whether a point lies within `margin` of the beam. Used to keep a girder
 * from being dropped on top of a worm.
 */
export function girderNear(cx: number, cy: number, step: number, px: number, py: number, margin: number): boolean {
  const a = girderAngle(step);
  const dx = px - cx;
  const dy = py - cy;
  const u = dx * Math.cos(a) + dy * Math.sin(a);
  const v = -dx * Math.sin(a) + dy * Math.cos(a);
  return Math.abs(u) < GIRDER_LENGTH / 2 + margin && Math.abs(v) < GIRDER_THICKNESS / 2 + margin;
}

type Rgb = readonly [number, number, number];
const FLANGE_LIT: Rgb = [206, 212, 224];
const FLANGE: Rgb = [150, 160, 178];
const STRUT: Rgb = [128, 138, 158];
const GAP: Rgb = [62, 70, 88];
const EDGE: Rgb = [40, 44, 56];

/**
 * The beam's paint: a lit top flange, a dark bottom one, and a web of
 * diagonal struts between them, so a girder at any angle reads as a truss.
 */
export function girderColor(u: number, v: number): Rgb {
  const half = GIRDER_LENGTH / 2;
  const t = v + GIRDER_THICKNESS / 2; // 0 at the top edge
  if (Math.abs(u) > half - 1 || t < 1 || t >= GIRDER_THICKNESS - 1) return EDGE;
  if (t < 2) return FLANGE_LIT;
  if (t >= GIRDER_THICKNESS - 2) return FLANGE;
  // The web: struts zigzag corner to corner every 8 px, over dark gaps.
  const along = u + half;
  const across = (t - 2) / (GIRDER_THICKNESS - 4);
  const within = along % 8;
  const diagonal = Math.floor(along / 8) % 2 === 0 ? across * 8 : (1 - across) * 8;
  return Math.abs(within - diagonal) < 1.5 ? STRUT : GAP;
}
