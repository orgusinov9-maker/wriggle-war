class FakeImageData {
  width: number; height: number; data: Uint8ClampedArray;
  constructor(w: number, h: number) { this.width = w; this.height = h; this.data = new Uint8ClampedArray(w * h * 4); }
}
const fakeCtx = { createImageData: (w: number, h: number) => new FakeImageData(w, h), putImageData: () => {} };
(globalThis as any).ImageData = FakeImageData;
(globalThis as any).document = { createElement: () => ({ width: 0, height: 0, getContext: () => fakeCtx }) };

import { Terrain, LAND } from '../src/world/terrain';
import { THEMES } from '../src/world/themes';
import { Rng } from '../src/core/rng';
import { PHYS, Worm } from '../src/entities/worm';
import { Rope, SwingInput } from '../src/entities/rope';
import { generateMap } from '../src/world/mapgen';
import { Match, MatchEvent, TurnCommand } from '../src/match';

/**
 * The ninja rope: the hook, the pendulum, the wrap around corners, and how it
 * sits inside a turn. Worms are hung by hand in a hand-built box so every
 * swing starts from a known angle.
 */

let failures = 0;
function check(label: string, ok: boolean, detail = ''): void {
  if (!ok) failures++;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? '  (' + detail + ')' : ''}`);
}

const rng = new Rng(11);
const PIVOT = { x: 400, y: 120 };

/** A floor at y 300 and, optionally, a ceiling slab ending at y 120 and a floating block. */
function box(opts: { ceiling?: boolean; block?: { x0: number; x1: number; y0: number; y1: number } } = {}) {
  const t = new Terrain(800, 400, THEMES[0], rng);
  for (let x = 0; x < 800; x++) for (let y = 300; y < 400; y++) t.setPixel(x, y, LAND);
  if (opts.ceiling) for (let x = 0; x < 800; x++) for (let y = 90; y < 120; y++) t.setPixel(x, y, LAND);
  const b = opts.block;
  if (b) for (let x = b.x0; x < b.x1; x++) for (let y = b.y0; y < b.y1; y++) t.setPixel(x, y, LAND);
  return t;
}

/** A worm already hanging from the ceiling at `angle` (radians from straight down, + to the right). */
function hang(t: Terrain, length: number, angle: number): { worm: Worm; rope: Rope } {
  const worm = new Worm(PIVOT.x, PIVOT.y + 20, 'Swinger', 0);
  const rope = new Rope(PIVOT.x, PIVOT.y + 4, 0, -1);
  if (rope.fly(t, worm) !== 'caught') throw new Error('test rope did not catch');
  rope.length = length;
  worm.x = rope.pivot.x + Math.sin(angle) * length;
  worm.y = rope.pivot.y + Math.cos(angle) * length;
  worm.vx = 0;
  worm.vy = 0;
  worm.state = 'roped';
  return { worm, rope };
}

const angleOf = (worm: Worm, rope: Rope) => Math.atan2(worm.x - rope.pivots[0].x, worm.y - rope.pivots[0].y);
const deg = (r: number) => ((r * 180) / Math.PI).toFixed(0);
const IDLE_SWING: SwingInput = { swing: 0, climb: 0 };

console.log('the hook');
{
  const t = box({ ceiling: true });
  const worm = new Worm(400, 295, 'Roper', 0);
  const rope = new Rope(worm.x, worm.y - 9, 0, -1);
  let outcome = 'flying';
  let ticks = 0;
  while (outcome === 'flying' && ticks++ < 100) outcome = rope.fly(t, worm);
  check('it bites into a ceiling in range', outcome === 'caught' && Math.abs(rope.pivot.y - 120) <= 1,
    `${outcome} after ${ticks} ticks at y ${rope.pivot.y.toFixed(0)}`);
  check('the rope takes the worm\'s distance as its length', Math.abs(rope.length - (worm.y - rope.pivot.y)) < 1,
    `length ${rope.length.toFixed(0)}`);

  const open = box();
  const miss = new Rope(400, 286, 0, -1);
  let out2 = 'flying';
  ticks = 0;
  while (out2 === 'flying' && ticks++ < 100) out2 = miss.fly(open, worm);
  check('in open sky it reels back after its full length', out2 === 'missed' && ticks === Math.ceil(PHYS.ropeMaxLength / PHYS.ropeShotSpeed),
    `${out2} after ${ticks} ticks`);
}

console.log('the pendulum');
{
  const t = box({ ceiling: true });
  const { worm, rope } = hang(t, 100, -Math.PI / 3);
  let peak = -Infinity;
  let slack = 0;
  for (let i = 0; i < 90; i++) {
    rope.swing(worm, t, IDLE_SWING);
    peak = Math.max(peak, angleOf(worm, rope));
    slack = Math.max(slack, Math.hypot(worm.x - rope.pivot.x, worm.y - rope.pivot.y) - rope.length);
  }
  check('let go at -60, it swings out to near +60', peak > (50 * Math.PI) / 180 && peak < (64 * Math.PI) / 180, `peak ${deg(peak)} deg`);
  check('the rope never stretches', slack < 0.5, `worst ${slack.toFixed(2)} px over length`);
}

console.log('swinging');
{
  const t = box({ ceiling: true });
  const { worm, rope } = hang(t, 100, 0);
  let peak = 0;
  for (let i = 0; i < 400; i++) {
    // Push with the swing, the way a player pumps it.
    const dir = worm.vx >= 0 ? 1 : -1;
    rope.swing(worm, t, { swing: dir, climb: 0 });
    peak = Math.max(peak, Math.abs(angleOf(worm, rope)));
  }
  check('pumping from a dead hang builds a real swing', peak > (40 * Math.PI) / 180, `reached ${deg(peak)} deg`);
}

console.log('climbing');
{
  const t = box({ ceiling: true });
  const { worm, rope } = hang(t, 120, 0);
  for (let i = 0; i < 30; i++) rope.swing(worm, t, { swing: 0, climb: -1 });
  const dist = Math.hypot(worm.x - rope.pivot.x, worm.y - rope.pivot.y);
  check('climbing shortens the rope and pulls the worm up', Math.abs(rope.length - (120 - 30 * PHYS.ropeClimb)) < 0.01 && dist <= rope.length + 0.5,
    `length ${rope.length.toFixed(0)}, worm at ${dist.toFixed(0)}`);
  for (let i = 0; i < 200; i++) rope.swing(worm, t, { swing: 0, climb: -1 });
  check('but not past its minimum', rope.length === PHYS.ropeMinLength);
  for (let i = 0; i < 400; i++) rope.swing(worm, t, { swing: 0, climb: 1 });
  check('and paying out stops at the floor, not through it', worm.y < 300 - PHYS.radius + 1, `worm y ${worm.y.toFixed(0)}`);
}

console.log('wrapping round a corner');
{
  // A block hangs to the right; a swing from the left drives the rope into its corner.
  const t = box({ ceiling: true, block: { x0: 470, x1: 500, y0: 180, y1: 200 } });
  const { worm, rope } = hang(t, 150, -Math.PI / 3);
  let wrapped = false;
  let unwrapped = false;
  for (let i = 0; i < 300; i++) {
    rope.swing(worm, t, IDLE_SWING);
    if (rope.pivots.length > 1) wrapped = true;
    if (wrapped && rope.pivots.length === 1) unwrapped = true;
  }
  check('the rope catches on the block', wrapped);
  check('and comes off again on the swing back', unwrapped);
}

console.log('losing the hook');
{
  const t = box({ ceiling: true });
  const { worm, rope } = hang(t, 100, 0);
  t.destroy(PIVOT.x, PIVOT.y - 6, 14);
  check('blowing away the ground it bit lets go', rope.swing(worm, t, IDLE_SWING) === false);
}

// --- inside a match -------------------------------------------------------

const IDLE: TurnCommand = { walk: 0, aimUp: false, aimDown: false, jump: false, backflip: false, skip: false };

function run(m: Match, ticks: number, cmd: TurnCommand = IDLE, until?: () => boolean): MatchEvent[] {
  const seen: MatchEvent[] = [];
  for (let t = 0; t < ticks && !(until && until()); t++) {
    m.tick(cmd);
    seen.push(...m.events);
  }
  return seen;
}

/** A match whose active worm has a slab of rock 60px overhead. */
function roofedMatch(): Match {
  const map = generateMap(4242, 'island');
  const m = new Match(map, ['Red', 'Blue']);
  run(m, 60000, IDLE, () => m.phase === 'play');
  const w = m.activeWorm!;
  // setPixel wants whole pixels; a fractional index writes nothing at all.
  const wx = Math.round(w.x);
  const wy = Math.round(w.y);
  for (let x = wx - 80; x < wx + 80; x++) for (let y = wy - 70; y < wy - 60; y++) map.terrain.setPixel(x, y, LAND);
  // Aim straight up.
  run(m, 120, { ...IDLE, aimUp: true });
  return m;
}

console.log('in a match');
{
  const m = roofedMatch();
  const worm = m.activeWorm!;
  m.tick({ ...IDLE, selectWeapon: 'rope' });
  const events = run(m, 1, { ...IDLE, fire: { power: 1, fuseSeconds: 3 } });
  events.push(...run(m, 20, IDLE, () => worm.state === 'roped'));
  check('the rope is fired and catches the roof', worm.state === 'roped' && events.some((e) => e.kind === 'ropeCatch'),
    `worm ${worm.state}`);
  check('roping does not use up the turn', m.phase === 'play' && m.canFire);

  const before = m.rope!.length;
  run(m, 10, { ...IDLE, aimUp: true });
  check('up climbs', m.rope !== null && m.rope.length < before, `${before.toFixed(0)} -> ${m.rope?.length.toFixed(0)}`);

  const drop = run(m, 1, { ...IDLE, jump: true });
  check('jump lets go, and the worm falls free', worm.state === 'airborne' && m.rope === null && drop.some((e) => e.kind === 'ropeRelease'));

  run(m, 400, IDLE, () => worm.state === 'idle');
  m.tick({ ...IDLE, selectWeapon: 'bazooka' });
  run(m, 1, { ...IDLE, fire: { power: 0.5, fuseSeconds: 3 } });
  check('and can still fire a weapon afterwards', m.phase === 'retreat');
}

console.log('dynamite from the rope');
{
  const m = roofedMatch();
  const worm = m.activeWorm!;
  m.tick({ ...IDLE, selectWeapon: 'rope' });
  run(m, 1, { ...IDLE, fire: { power: 1, fuseSeconds: 3 } });
  run(m, 20, IDLE, () => worm.state === 'roped');
  m.tick({ ...IDLE, selectWeapon: 'dynamite' });
  run(m, 1, { ...IDLE, fire: { power: 1, fuseSeconds: 3 } });
  check('it drops while the worm stays on the rope', m.projectiles.length === 1 && worm.state === 'roped' && m.phase === 'retreat');
  run(m, 60000, IDLE, () => m.phase !== 'retreat');
  m.tick(IDLE); // the rope is dropped on the first tick the worm is out of time
  check('when retreat runs out, the rope goes', m.rope === null && worm.state !== 'roped', `worm ${worm.state}`);
}

console.log(failures === 0 ? '\nALL ROPE CHECKS PASSED' : `\n${failures} ROPE CHECK(S) FAILED`);
