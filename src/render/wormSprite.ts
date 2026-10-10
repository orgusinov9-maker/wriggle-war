/**
 * The worm as real pixel art, generated rather than drawn.
 *
 * The body is a spine: a chain of discs from the tail tip to the head. Every
 * pose is just a different set of spine points, so walking, jumping and
 * tumbling are a matter of moving points, and a rotated worm stays as crisp as
 * an upright one - it is rasterised at its angle, never rotated as an image.
 *
 * Each frame is painted at one pixel per world pixel into a small index grid
 * (outline, four shades, eye white, pupil) and then onto a canvas in a locked
 * palette. The renderer draws it with smoothing off, so zooming in shows the
 * pixels exactly as they would look scaled up on the original's low-res screen.
 */

/** Palette indices. 0 is transparent. */
const OUTLINE = 1;
const DEEP = 2;
const SHADOW = 3;
const BASE = 4;
const LIGHT = 5;
const EYE = 6;
const PUPIL = 7;

export const WORM_PALETTE: readonly (readonly [number, number, number])[] = [
  [0, 0, 0],
  [74, 22, 38], // outline
  [176, 78, 104], // deep shade
  [222, 120, 142], // shadow
  [246, 164, 178], // base pink
  [255, 214, 220], // highlight
  [255, 255, 255], // eye white
  [18, 16, 26], // pupil
];

/** Sprite canvas size and where the worm's origin (its physics centre) sits in it. */
export const SPRITE_SIZE = 34;
export const SPRITE_ORIGIN = { x: 17, y: 20 };

export type WormPose =
  | { kind: 'idle'; breath: 0 | 1 }
  | { kind: 'walk'; frame: number }
  | { kind: 'jump'; tilt: number }
  | { kind: 'tumble'; turn: number };

export const WALK_FRAMES = 8;
export const TUMBLE_FRAMES = 12;
/** Jump tilt is quantised to this many steps either side of upright. */
export const TILT_STEPS = 4;
const MAX_TILT = 0.6;

/** Aim is quantised so the pupils move in whole pixels. */
export const LOOK_STEPS = 5;

interface Joint {
  x: number;
  y: number;
  r: number;
}

/**
 * Spine points, tail tip first and head last, in sprite space facing right
 * (+x forward, +y down, origin on the physics centre). Terrain is met at
 * y = +5, which is where the lowest radii are tuned to end.
 */
function spine(pose: WormPose): Joint[] {
  switch (pose.kind) {
    case 'idle': {
      const b = pose.breath;
      return [
        { x: -8.5, y: 4.4, r: 0.9 },
        { x: -6, y: 3.6, r: 1.7 },
        { x: -3, y: 2.3, r: 3.0 },
        { x: -0.4, y: 0.8, r: 4.4 },
        { x: 0.3, y: -2.5, r: 4.4 },
        { x: 0.7, y: -6 - b * 0.5, r: 4.0 },
        { x: 1.3, y: -8.8 - b * 0.8, r: 4.5 },
      ];
    }
    case 'walk': {
      // An inchworm hump: the middle arches up while the tail is drawn in,
      // then the front reaches forward as the back flattens out.
      const s = Math.sin((pose.frame / WALK_FRAMES) * Math.PI * 2);
      const up = Math.max(0, s);
      const a = Math.abs(s);
      return [
        { x: -8.5 + 1.4 * s, y: 4.4, r: 0.9 },
        { x: -6 + 1.0 * s, y: 3.6 - 0.4 * up, r: 1.7 },
        { x: -3 + 0.4 * s, y: 2.3 - 1.6 * up, r: 3.0 },
        { x: -0.4, y: 0.8 - 1.0 * up, r: 4.4 },
        { x: 0.3 + 0.5 * s, y: -2.5 - 0.4 * a, r: 4.4 },
        { x: 0.9 + 0.9 * s, y: -6 - 0.2 * a, r: 4.0 },
        { x: 1.6 + 1.1 * s, y: -8.8 + 0.5 * a, r: 4.5 },
      ];
    }
    case 'jump': {
      // Stretched out, tail trailing below, leaning with the flight.
      const angle = (pose.tilt / TILT_STEPS) * MAX_TILT;
      return rotate(
        [
          { x: -4.2, y: 7.5, r: 0.9 },
          { x: -3, y: 5.2, r: 1.8 },
          { x: -1.6, y: 2.6, r: 3.0 },
          { x: -0.3, y: -0.2, r: 4.2 },
          { x: 0.3, y: -3.4, r: 4.3 },
          { x: 0.7, y: -6.6, r: 4.0 },
          { x: 1.2, y: -9.2, r: 4.4 },
        ],
        angle,
      );
    }
    case 'tumble': {
      // Curled into a ball and spinning, as a blasted worm does.
      const base = (pose.turn / TUMBLE_FRAMES) * Math.PI * 2;
      const joints: Joint[] = [];
      for (let i = 0; i < 7; i++) {
        const a = base + i * 0.78;
        const bend = 3.6 - i * 0.12;
        joints.push({ x: Math.cos(a) * bend, y: Math.sin(a) * bend - 1, r: [0.9, 1.7, 2.8, 3.6, 3.8, 3.7, 4.2][i] });
      }
      return joints;
    }
  }
}

function rotate(joints: Joint[], angle: number): Joint[] {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return joints.map((j) => ({ x: j.x * c - j.y * s, y: j.x * s + j.y * c, r: j.r }));
}

/** Signed distance from a point to the spine, with the nearest spine point and its radius. */
function nearest(joints: Joint[], px: number, py: number): { d: number; qx: number; qy: number; r: number } {
  let best = { d: Infinity, qx: 0, qy: 0, r: 1 };
  for (let i = 0; i < joints.length - 1; i++) {
    const a = joints[i];
    const b = joints[i + 1];
    const ex = b.x - a.x;
    const ey = b.y - a.y;
    const len2 = ex * ex + ey * ey || 1;
    const t = Math.max(0, Math.min(1, ((px - a.x) * ex + (py - a.y) * ey) / len2));
    const qx = a.x + ex * t;
    const qy = a.y + ey * t;
    const r = a.r + (b.r - a.r) * t;
    const d = Math.hypot(px - qx, py - qy) - r;
    if (d < best.d) best = { d, qx, qy, r };
  }
  return best;
}

export interface SpriteFrame {
  readonly width: number;
  readonly height: number;
  /** Palette index per pixel, row-major. */
  readonly pixels: Uint8Array;
}

/**
 * Paints one frame into an index grid.
 *
 * `look` is the aim step (0 = straight up .. LOOK_STEPS-1 = straight down);
 * a tumbling worm ignores it and stares dead ahead, dazed.
 */
export function rasterWorm(pose: WormPose, look: number, blink: boolean): SpriteFrame {
  const W = SPRITE_SIZE;
  const H = SPRITE_SIZE;
  const px = new Uint8Array(W * H);
  const joints = spine(pose);

  // Light from the upper left, the way the original lit everything.
  const lx = -0.55;
  const ly = -0.83;

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const wx = x + 0.5 - SPRITE_ORIGIN.x;
      const wy = y + 0.5 - SPRITE_ORIGIN.y;
      const n = nearest(joints, wx, wy);
      if (n.d > 0) continue;
      const nx = (wx - n.qx) / n.r;
      const ny = (wy - n.qy) / n.r;
      // A one-step checker dither softens the band edges without adding colours.
      const v = nx * lx + ny * ly + (((x + y) & 1) === 0 ? 0.05 : -0.05);
      px[y * W + x] = v > 0.42 ? LIGHT : v > -0.12 ? BASE : v > -0.58 ? SHADOW : DEEP;
    }
  }

  // Eyes sit on the front of the head, in the head's own frame so they follow
  // it when the worm leans or tumbles.
  const head = joints[joints.length - 1];
  const neck = joints[joints.length - 2];
  const ul = Math.hypot(head.x - neck.x, head.y - neck.y) || 1;
  const ux = (head.x - neck.x) / ul; // toward the crown
  const uy = (head.y - neck.y) / ul;
  const fx = -uy; // forward, a quarter turn from up
  const fy = ux;
  const eyes = [
    { x: head.x + fx * 0.2 + ux * 2.6, y: head.y + fy * 0.2 + uy * 2.6 },
    { x: head.x + fx * 4.4 + ux * 2.2, y: head.y + fy * 4.4 + uy * 2.2 },
  ];

  const aim = ((look / (LOOK_STEPS - 1)) * 2 - 1) * (Math.PI / 2);
  const dazed = pose.kind === 'tumble';
  const lookX = dazed ? 0 : Math.cos(aim) * 1.0;
  const lookY = dazed ? 0 : Math.sin(aim) * 1.3;

  // Big, bulging eyes that rise above the crown - the worm's whole expression.
  const RX = 2.7;
  const RY = 3.4;
  const inEye = (e: { x: number; y: number }, wx: number, wy: number) => {
    // The ellipse is laid along the head's axes, not the screen's.
    const dx = wx - e.x;
    const dy = wy - e.y;
    const a = dx * fx + dy * fy;
    const b = dx * ux + dy * uy;
    return (a * a) / (RX * RX) + (b * b) / (RY * RY) <= 1;
  };

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const wx = x + 0.5 - SPRITE_ORIGIN.x;
      const wy = y + 0.5 - SPRITE_ORIGIN.y;
      // The eyes overlap, and the front one is painted over the back one -
      // except the pupils, which always show whole.
      let pupil = false;
      for (const e of eyes) {
        if (!inEye(e, wx, wy)) continue;
        // Snapped to a pixel corner, so the pupil is always a clean 2x2 block.
        const cx = Math.round(e.x + lookX);
        const cy = Math.round(e.y + lookY);
        if (!blink && Math.abs(wx - cx) < 1 && Math.abs(wy - cy) < 1) pupil = true;
        // The rim of each eye is outlined, so the two read as separate balls.
        const rim =
          !inEye(e, wx + 1, wy) || !inEye(e, wx - 1, wy) || !inEye(e, wx, wy + 1) || !inEye(e, wx, wy - 1);
        if (rim) px[y * W + x] = OUTLINE;
        else if (blink) px[y * W + x] = (y & 1) === 0 ? SHADOW : BASE; // a shut lid
        else px[y * W + x] = EYE;
      }
      // Pressed against the rim is how the worm looks sideways.
      if (pupil) px[y * W + x] = PUPIL;
    }
  }

  // One-pixel outline around the whole silhouette, four-connected, which is
  // what gives hand-made sprites their clean edge.
  const out = px.slice();
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (px[y * W + x] !== 0) continue;
      const filled =
        (x > 0 && px[y * W + x - 1] !== 0) ||
        (x < W - 1 && px[y * W + x + 1] !== 0) ||
        (y > 0 && px[(y - 1) * W + x] !== 0) ||
        (y < H - 1 && px[(y + 1) * W + x] !== 0);
      if (filled) out[y * W + x] = OUTLINE;
    }
  }

  return { width: W, height: H, pixels: out };
}

/** Frames are painted once and kept; there are only a few hundred possible. */
export class WormSprites {
  private readonly cache = new Map<string, HTMLCanvasElement>();

  get(pose: WormPose, look: number, blink: boolean): HTMLCanvasElement {
    const key = `${JSON.stringify(pose)}|${look}|${blink ? 1 : 0}`;
    let canvas = this.cache.get(key);
    if (!canvas) {
      canvas = paint(rasterWorm(pose, look, blink));
      this.cache.set(key, canvas);
    }
    return canvas;
  }
}

function paint(frame: SpriteFrame): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = frame.width;
  canvas.height = frame.height;
  const ctx = canvas.getContext('2d')!;
  const image = ctx.createImageData(frame.width, frame.height);
  for (let i = 0; i < frame.pixels.length; i++) {
    const index = frame.pixels[i];
    if (index === 0) continue;
    const [r, g, b] = WORM_PALETTE[index];
    image.data[i * 4] = r;
    image.data[i * 4 + 1] = g;
    image.data[i * 4 + 2] = b;
    image.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(image, 0, 0);
  return canvas;
}
