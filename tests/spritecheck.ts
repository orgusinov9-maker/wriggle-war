import {
  LOOK_STEPS,
  SPRITE_ORIGIN,
  TILT_STEPS,
  TUMBLE_FRAMES,
  WALK_FRAMES,
  WormPose,
  rasterWorm,
} from '../src/render/wormSprite';
import { AIM_STEPS, rasterHeld } from '../src/render/heldSprite';
import { WEAPONS, WeaponId } from '../src/entities/weapons';

/**
 * The worm sprite is generated, so its failures are silent: a pose that
 * pokes out of the canvas is quietly cropped, and a worm drawn a pixel too
 * high floats. These pin down the geometry the renderer relies on.
 */

let failures = 0;
function check(label: string, ok: boolean, detail = ''): void {
  if (!ok) failures++;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? '  (' + detail + ')' : ''}`);
}

const OUTLINE = 1;
const PUPIL = 7;

const poses: WormPose[] = [
  { kind: 'idle', breath: 0 },
  { kind: 'idle', breath: 1 },
  ...Array.from({ length: WALK_FRAMES }, (_, frame): WormPose => ({ kind: 'walk', frame })),
  ...Array.from({ length: TILT_STEPS * 2 + 1 }, (_, i): WormPose => ({ kind: 'jump', tilt: i - TILT_STEPS })),
  ...Array.from({ length: TUMBLE_FRAMES }, (_, turn): WormPose => ({ kind: 'tumble', turn })),
];

function bounds(pixels: Uint8Array, w: number, h: number) {
  let minX = w, maxX = -1, minY = h, maxY = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (pixels[y * w + x] === 0) continue;
      minX = Math.min(minX, x); maxX = Math.max(maxX, x);
      minY = Math.min(minY, y); maxY = Math.max(maxY, y);
    }
  }
  return { minX, maxX, minY, maxY };
}

console.log('every frame fits its canvas');
{
  const clipped: string[] = [];
  for (const pose of poses) {
    for (let look = 0; look < LOOK_STEPS; look++) {
      const f = rasterWorm(pose, look, false);
      const b = bounds(f.pixels, f.width, f.height);
      if (b.minX <= 0 || b.minY <= 0 || b.maxX >= f.width - 1 || b.maxY >= f.height - 1) {
        clipped.push(JSON.stringify(pose));
      }
    }
  }
  check(`${poses.length} poses x ${LOOK_STEPS} aims, none touching the edge`, clipped.length === 0, clipped.slice(0, 3).join(' '));
}

console.log('standing worms stand on the ground');
{
  // Terrain is met at y = +5, so the outline's last row is the one just above.
  const groundRow = SPRITE_ORIGIN.y + 5;
  const off: string[] = [];
  for (const pose of poses.filter((p) => p.kind === 'idle' || p.kind === 'walk')) {
    const f = rasterWorm(pose, 2, false);
    const b = bounds(f.pixels, f.width, f.height);
    if (b.maxY !== groundRow) off.push(`${JSON.stringify(pose)} ends on row ${b.maxY}`);
  }
  check('idle and walk frames end on the ground row', off.length === 0, off.slice(0, 2).join('; '));
}

console.log('the eyes');
{
  const pupilsAt = (look: number) => {
    const f = rasterWorm({ kind: 'idle', breath: 0 }, look, false);
    const cells: number[] = [];
    f.pixels.forEach((v, i) => { if (v === PUPIL) cells.push(i); });
    const meanY = cells.reduce((s, i) => s + Math.floor(i / f.width), 0) / (cells.length || 1);
    return { count: cells.length, meanY };
  };
  const up = pupilsAt(0);
  const mid = pupilsAt(2);
  const down = pupilsAt(LOOK_STEPS - 1);
  check('two 2x2 pupils', mid.count === 8, `${mid.count} pupil pixels`);
  check('pupils follow the aim', up.meanY < mid.meanY && mid.meanY < down.meanY,
    `rows ${up.meanY.toFixed(1)} / ${mid.meanY.toFixed(1)} / ${down.meanY.toFixed(1)}`);
  const shut = rasterWorm({ kind: 'idle', breath: 0 }, 2, true);
  check('a blink hides them', !shut.pixels.includes(PUPIL));
}

console.log('the outline');
{
  const f = rasterWorm({ kind: 'idle', breath: 0 }, 2, false);
  // Every filled pixel on the silhouette's edge must be outline colour.
  let bare = 0;
  for (let y = 1; y < f.height - 1; y++) {
    for (let x = 1; x < f.width - 1; x++) {
      const v = f.pixels[y * f.width + x];
      if (v === 0 || v === OUTLINE) continue;
      const n = [f.pixels[y * f.width + x - 1], f.pixels[y * f.width + x + 1], f.pixels[(y - 1) * f.width + x], f.pixels[(y + 1) * f.width + x]];
      if (n.includes(0)) bare++;
    }
  }
  check('the silhouette is closed by a one-pixel outline', bare === 0, `${bare} bare edge pixels`);
}

console.log('held weapons');
{
  const clipped: string[] = [];
  let drawn = 0;
  for (const id of Object.keys(WEAPONS) as WeaponId[]) {
    for (let step = 0; step < AIM_STEPS; step++) {
      const h = rasterHeld(id, step);
      if (!h) continue;
      drawn++;
      for (let y = 0; y < h.size; y++) {
        for (let x = 0; x < h.size; x++) {
          const edge = x === 0 || y === 0 || x === h.size - 1 || y === h.size - 1;
          if (edge && h.rgba[(y * h.size + x) * 4 + 3] !== 0) clipped.push(`${id}@${step}`);
        }
      }
    }
  }
  check('no held item is cropped at any aim', drawn > 0 && clipped.length === 0, clipped.slice(0, 3).join(' '));
  const up = rasterHeld('bazooka', 0)!.rgba.join();
  const level = rasterHeld('bazooka', Math.floor(AIM_STEPS / 2))!.rgba.join();
  check('the bazooka turns with the aim', up !== level);
  check('dynamite is held upright whatever the aim',
    rasterHeld('dynamite', 0)!.rgba.join() === rasterHeld('dynamite', AIM_STEPS - 1)!.rgba.join());
}

console.log(failures === 0 ? '\nALL SPRITE CHECKS PASSED' : `\n${failures} SPRITE CHECK(S) FAILED`);
