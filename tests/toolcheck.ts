class FakeImageData {
  width: number; height: number; data: Uint8ClampedArray;
  constructor(w: number, h: number) { this.width = w; this.height = h; this.data = new Uint8ClampedArray(w * h * 4); }
}
const fakeCtx = { createImageData: (w: number, h: number) => new FakeImageData(w, h), putImageData: () => {} };
(globalThis as any).ImageData = FakeImageData;
(globalThis as any).document = { createElement: () => ({ width: 0, height: 0, getContext: () => fakeCtx }) };

import { AIR, GIRDER, LAND } from '../src/world/terrain';
import { GeneratedMap, generateMap } from '../src/world/mapgen';
import { GIRDER_THICKNESS } from '../src/world/girder';
import { Match, MatchEvent, TurnCommand } from '../src/match';
import { WEAPONS } from '../src/entities/weapons';
import { Worm } from '../src/entities/worm';

/**
 * The blowtorch and the girder: the two tools that reshape the map on
 * purpose. Each test builds its own scenery around the active worm, so the
 * outcome does not depend on where the map generator happened to put it.
 */

let failures = 0;
function check(label: string, ok: boolean, detail = ''): void {
  if (!ok) failures++;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? '  (' + detail + ')' : ''}`);
}

const IDLE: TurnCommand = { walk: 0, aimUp: false, aimDown: false, jump: false, backflip: false, skip: false };
const FIRE: TurnCommand = { ...IDLE, fire: { power: 1, fuseSeconds: 3 } };

function run(m: Match, ticks: number, cmd: TurnCommand = IDLE, until?: () => boolean): MatchEvent[] {
  const seen: MatchEvent[] = [];
  for (let t = 0; t < ticks && !(until && until()); t++) {
    m.tick(cmd);
    seen.push(...m.events);
  }
  return seen;
}

function fill(map: GeneratedMap, x0: number, x1: number, y0: number, y1: number, value: number): void {
  for (let x = Math.round(x0); x < Math.round(x1); x++) {
    for (let y = Math.round(y0); y < Math.round(y1); y++) map.terrain.setPixel(x, y, value);
  }
}

/**
 * A match in play, its active worm standing on a flat shelf facing right,
 * with open sky above and around it. Everything else is pushed off the stage.
 */
function stage(): { m: Match; map: GeneratedMap; worm: Worm; x: number; y: number } {
  const map = generateMap(4242, 'island');
  const m = new Match(map, ['Red', 'Blue']);
  run(m, 60000, IDLE, () => m.phase === 'play');
  const worm = m.activeWorm!;
  const x = 600;
  const y = 300;
  fill(map, x - 200, x + 260, y - 160, y + 5, AIR);
  fill(map, x - 200, x + 260, y + 5, y + 60, LAND);
  worm.x = x;
  worm.y = y;
  worm.facing = 1;
  worm.aim = 0;
  worm.state = 'idle';
  // Bystanders stand well out of the way on their own.
  m.worms.forEach((w, i) => {
    if (w === worm) return;
    w.x = 100 + i * 30;
  });
  return { m, map, worm, x, y };
}

function light(m: Match): MatchEvent[] {
  m.tick({ ...IDLE, selectWeapon: 'blowtorch' });
  return run(m, 1, FIRE);
}

console.log('blowtorch');
{
  // A hill in the way: the torch should bore a level tunnel straight through it.
  const { m, map, worm, x, y } = stage();
  fill(map, x + 8, x + 250, y - 40, y + 5, LAND);
  const events = light(m);
  check('it lights and holds the turn open', m.torching && m.phase === 'play');
  check('the round is spent', m.ammoOf('blowtorch') === 0);
  run(m, 1000, IDLE, () => !m.torching);
  const travelled = worm.x - x;
  const expected = WEAPONS.blowtorch.torch!.ticks * WEAPONS.blowtorch.torch!.speed;
  check('it burns for its full time and carries the worm forward', Math.abs(travelled - expected) < 6,
    `moved ${travelled.toFixed(0)} px, expected ~${expected.toFixed(0)}`);
  check('a level tunnel stays level', Math.abs(worm.y - y) <= 1, `dy ${(worm.y - y).toFixed(1)}`);
  check('the tunnel behind is open', map.terrain.at(x + 40, y) === AIR && map.terrain.at(x + 40, y - 6) === AIR);
  check('its floor is untouched', map.terrain.at(x + 40, y + 5) === LAND);
  check('when it goes out the retreat starts', m.phase === 'retreat' && worm.state === 'idle', `${m.phase} / ${worm.state}`);
  check('it roars while it burns', events.some((e) => e.kind === 'torch'));
}

console.log('putting it out');
{
  const { m, map, worm, x } = stage();
  fill(map, x + 8, x + 200, map.waterLevel - 400, 305, LAND);
  light(m);
  run(m, 20);
  run(m, 1, FIRE);
  check('the trigger puts it out early', !m.torching && m.phase === 'retreat' && worm.x - x < 25, `moved ${(worm.x - x).toFixed(0)}`);
}

console.log('digging down');
{
  const { m, map, worm, x, y } = stage();
  fill(map, x - 200, x + 260, y + 5, y + 200, LAND);
  worm.aim = 0.6; // snaps to 45 degrees down
  light(m);
  run(m, 1000, IDLE, () => !m.torching);
  run(m, 100, IDLE, () => worm.state === 'idle');
  const across = worm.x - x;
  const down = worm.y - y;
  check('aimed low it tunnels down at 45 degrees', across > 60 && Math.abs(down - across) < across * 0.2,
    `${across.toFixed(0)} across, ${down.toFixed(0)} down`);
}

console.log('burning a worm');
{
  const { m, map, worm, x, y } = stage();
  fill(map, x + 8, x + 200, y - 40, y + 5, LAND);
  const victim = m.worms.find((w) => w.teamIndex !== worm.teamIndex)!;
  // A pocket in the hill, with the victim sitting in it.
  fill(map, x + 50, x + 64, y - 6, y + 5, AIR);
  victim.x = x + 57;
  victim.y = y;
  victim.state = 'idle';
  const before = victim.health;
  light(m);
  run(m, 1000, IDLE, () => !m.torching);
  run(m, 400, IDLE, () => m.phase !== 'retreat' && m.phase !== 'play');
  check('a worm in the path is burnt once, for 15', before - victim.health === WEAPONS.blowtorch.torch!.damage,
    `lost ${before - victim.health}`);
}

console.log('thin air');
{
  const { m, worm, x } = stage();
  light(m);
  run(m, 60, IDLE, () => !m.torching);
  check('torching nothing gives up after a moment', !m.torching && worm.x - x < 20, `moved ${(worm.x - x).toFixed(0)}`);
}

console.log('girder');
{
  const { m, map, worm, x, y } = stage();
  m.tick({ ...IDLE, selectWeapon: 'girder' });
  const at = { x: x + 60, y: y - 50 };
  check('it may not be dropped on a worm', !m.canPlaceGirder(worm.x, worm.y, 0));
  check('nor under the sea', !m.canPlaceGirder(x, m.waterLevel + 10, 0));
  check('but open sky is fine', m.canPlaceGirder(at.x, at.y, 0));

  run(m, 1, { ...IDLE, fire: { power: 1, fuseSeconds: 3, target: { x: worm.x, y: worm.y }, girderStep: 0 } });
  check('a refused drop costs nothing', m.phase === 'play' && m.ammoOf('girder') === WEAPONS.girder.ammo);

  const events = run(m, 1, { ...IDLE, fire: { power: 1, fuseSeconds: 3, target: at, girderStep: 0 } });
  check('a level girder goes in where clicked', map.terrain.at(at.x, at.y) === GIRDER && map.terrain.at(at.x + 25, at.y) === GIRDER,
    `centre ${map.terrain.at(at.x, at.y)}`);
  check('and is only a few pixels thick', map.terrain.at(at.x, at.y - 5) === AIR && map.terrain.at(at.x, at.y + 5) === AIR);
  check('it clangs, spends a round and ends the attack',
    events.some((e) => e.kind === 'girder') && m.ammoOf('girder') === WEAPONS.girder.ammo - 1 && m.phase === 'retreat');

  // Drop a worm onto it.
  const lander = m.worms.find((w) => w !== worm)!;
  lander.x = at.x;
  lander.y = at.y - 30;
  lander.vx = 0;
  lander.vy = 0;
  lander.state = 'airborne';
  run(m, 200, IDLE, () => lander.state === 'idle');
  const landed: string = lander.state;
  check('a worm lands on it and stays', landed === 'idle' && Math.abs(lander.y - (at.y - GIRDER_THICKNESS / 2 - 5)) <= 1,
    `worm at y ${lander.y.toFixed(1)}, girder top ${at.y - GIRDER_THICKNESS / 2}`);

  m.explode(at.x - 20, at.y, 12, 0, 0);
  check('a blast breaks it', map.terrain.at(at.x - 20, at.y) === AIR && map.terrain.at(at.x + 25, at.y) === GIRDER);
}

console.log('girder angles');
{
  const { m, map, x, y } = stage();
  m.tick({ ...IDLE, selectWeapon: 'girder' });
  const at = { x: x + 100, y: y - 80 };
  run(m, 1, { ...IDLE, fire: { power: 1, fuseSeconds: 3, target: at, girderStep: 4 } });
  check('step 4 stands it upright', map.terrain.at(at.x, at.y + 20) === GIRDER && map.terrain.at(at.x + 20, at.y) === AIR);
}

console.log(failures === 0 ? '\nALL TOOL CHECKS PASSED' : `\n${failures} TOOL CHECK(S) FAILED`);
