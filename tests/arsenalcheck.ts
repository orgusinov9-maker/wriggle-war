class FakeImageData {
  width: number; height: number; data: Uint8ClampedArray;
  constructor(w: number, h: number) { this.width = w; this.height = h; this.data = new Uint8ClampedArray(w * h * 4); }
}
const fakeCtx = { createImageData: (w: number, h: number) => new FakeImageData(w, h), putImageData: () => {} };
(globalThis as any).ImageData = FakeImageData;
(globalThis as any).document = { createElement: () => ({ width: 0, height: 0, getContext: () => fakeCtx }) };

import { generateMap } from '../src/world/mapgen';
import { Match, TurnCommand } from '../src/match';
import { WEAPONS, WeaponId } from '../src/entities/weapons';

const IDLE: TurnCommand = { walk: 0, aimUp: false, aimDown: false, jump: false, backflip: false, skip: false };
let failures = 0;

function check(label: string, ok: boolean, detail = ''): void {
  if (!ok) failures++;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? '  (' + detail + ')' : ''}`);
}

function toPlay(m: Match, limit = 60000): void {
  let t = 0;
  while (m.phase !== 'play' && m.phase !== 'over' && t++ < limit) m.tick(IDLE);
}

function fresh(seed = 4242): Match {
  const m = new Match(generateMap(seed, 'island'), ['Red', 'Blue']);
  toPlay(m);
  return m;
}

// --- test 1: every weapon can be selected and fired without blowing up ----
console.log('every weapon fires and hands the turn on');
{
  const ids = Object.keys(WEAPONS) as WeaponId[];
  const broken: string[] = [];
  for (const id of ids) {
    const m = fresh(1000 + ids.indexOf(id));
    const worm = m.activeWorm!;
    const target = { x: worm.x + 160, y: worm.y - 30 };
    try {
      m.tick({ ...IDLE, selectWeapon: id });
      if (m.selectedWeapon !== id) { broken.push(`${id}: not selected`); continue; }
      m.tick({ ...IDLE, fire: { power: 0.8, fuseSeconds: 3, target } });

      // Run out the turn; a settled mine must not stall the handover.
      let t = 0;
      while (m.phase !== 'play' && m.phase !== 'over' && t++ < 60000) m.tick(IDLE);
      if (t >= 60000) broken.push(`${id}: turn never ended`);
    } catch (err) {
      broken.push(`${id}: ${(err as Error).message}`);
    }
  }
  check(`all ${ids.length} weapons`, broken.length === 0, broken.join(' | '));
}

// --- test 2: ammo is spent and an empty weapon cannot be fired -----------
console.log('ammo');
{
  const m = fresh(77);
  const before = m.activeTeam!.ammo.banana;
  m.tick({ ...IDLE, selectWeapon: 'banana' });
  m.tick({ ...IDLE, fire: { power: 0.7, fuseSeconds: 3 } });
  const after = m.activeTeam!.ammo.banana;
  check('banana bomb spent a round', before === 1 && after === 0, `${before} -> ${after}`);

  // Cycle turns until Red is up again, so we test Red's own empty slot.
  const red = m.teams[0];
  let guard = 0;
  const step = () => m.tick({ ...IDLE, skip: m.phase === 'play' });
  while (m.activeTeam === red && guard++ < 60000) step();
  while (m.activeTeam !== red && guard++ < 60000) step();
  toPlay(m);
  check('the spent round stays spent', red.ammo.banana === 0);
  m.tick({ ...IDLE, selectWeapon: 'banana' });
  check('an empty weapon cannot be equipped', m.selectedWeapon !== 'banana', m.selectedWeapon);
  check('the bazooka is never empty', m.activeTeam!.ammo.bazooka === -1);
}

// --- test 3: the shotgun gets two trigger pulls in one turn --------------
console.log('shotgun');
{
  const m = fresh(1234);
  m.tick({ ...IDLE, selectWeapon: 'shotgun' });
  m.tick({ ...IDLE, fire: { power: 1, fuseSeconds: 3 } });
  while (!m.canFire && m.phase === 'play') m.tick(IDLE); // let the pellet resolve
  check('still playing after the first barrel', m.phase === 'play', m.phase);
  check('can fire again', m.canFire);
  m.tick({ ...IDLE, fire: { power: 1, fuseSeconds: 3 } });
  check('the second barrel starts the retreat', m.phase === 'retreat', m.phase);
}

// --- test 4: a cluster bomb throws shards --------------------------------
console.log('cluster bomb');
{
  const m = fresh(555);
  m.tick({ ...IDLE, selectWeapon: 'cluster' });
  m.tick({ ...IDLE, fire: { power: 0.6, fuseSeconds: 1 } });
  let peak = 0;
  for (let t = 0; t < 400; t++) {
    m.tick(IDLE);
    peak = Math.max(peak, m.projectiles.length);
  }
  check('split into shards', peak >= 5, `peak ${peak} projectiles in flight`);
}

// --- test 5: a homing missile closes on its target -----------------------
console.log('homing missile');
{
  const m = fresh(909);
  const worm = m.activeWorm!;
  // Lobbed high, the way a homing missile is actually used: it needs airtime
  // before the seeker wakes up.
  worm.aim = -Math.PI / 2;
  const target = { x: worm.x + worm.facing * 260, y: worm.y - 60 };
  m.tick({ ...IDLE, selectWeapon: 'homing' });
  m.tick({ ...IDLE, fire: { power: 1, fuseSeconds: 3, target } });
  const p = m.projectiles[0];
  const start = Math.hypot(p.x - target.x, p.y - target.y);
  let closest = start;
  for (let t = 0; t < 500 && m.projectiles.length > 0; t++) {
    const live = m.projectiles[0];
    closest = Math.min(closest, Math.hypot(live.x - target.x, live.y - target.y));
    m.tick(IDLE);
  }
  check('steered toward the mark', closest < start * 0.5, `${start.toFixed(0)}px -> ${closest.toFixed(0)}px`);
}

// --- test 6: a mine lies dormant, then goes off when stepped near --------
console.log('mine');
{
  const m = fresh(2024);
  m.tick({ ...IDLE, selectWeapon: 'mine' });
  m.tick({ ...IDLE, fire: { power: 1, fuseSeconds: 3 } });
  const placedAt = m.projectiles.length;
  toPlay(m);
  check('the turn ended with the mine still on the map', m.projectiles.length === 1 && placedAt === 1,
    `${m.projectiles.length} left`);

  const mine = m.projectiles[0];
  const victim = m.worms.find((w) => w.alive && Math.hypot(w.x - mine.x, w.y - mine.y) > 60)!;
  const hpBefore = victim.health;
  victim.x = mine.x + 6;
  victim.y = mine.y;
  for (let t = 0; t < 200 && m.projectiles.length > 0; t++) m.tick(IDLE);
  check('it detonated on the intruder', m.projectiles.length === 0 && victim.health < hpBefore,
    `hp ${hpBefore} -> ${victim.health}`);
}

// --- test 7: an air strike sends a bomber that drops a salvo -------------
console.log('air strike');
{
  const m = fresh(31337);
  const worm = m.activeWorm!;
  m.tick({ ...IDLE, selectWeapon: 'airstrike' });
  m.tick({ ...IDLE, fire: { power: 1, fuseSeconds: 3, target: { x: worm.x + 200, y: worm.y } } });
  check('a bomber is in the air', m.airstrikes.length === 1);
  let peak = 0;
  for (let t = 0; t < 900; t++) {
    m.tick(IDLE);
    peak = Math.max(peak, m.projectiles.length);
  }
  check('it dropped a salvo', peak >= 3, `peak ${peak} bombs`);
  check('the bomber left', m.airstrikes.length === 0);
}

// --- test 8: Skip Go ends the turn without firing anything ---------------
console.log('skip go');
{
  const m = fresh(4);
  const who = m.activeWorm;
  m.tick({ ...IDLE, selectWeapon: 'skip' });
  m.tick({ ...IDLE, fire: { power: 1, fuseSeconds: 3 } });
  check('nothing was launched', m.projectiles.length === 0);
  toPlay(m);
  check('the turn passed on', m.activeWorm !== who);
}

// --- test 9: fire punch lifts the puncher and hurts the punched ----------
console.log('fire punch');
{
  const m = fresh(8080);
  const worm = m.activeWorm!;
  const victim = m.worms.find((w) => w !== worm && w.alive)!;
  victim.x = worm.x + worm.facing * 10;
  victim.y = worm.y - 2;
  const hp = victim.health;
  m.tick({ ...IDLE, selectWeapon: 'firepunch' });
  m.tick({ ...IDLE, fire: { power: 1, fuseSeconds: 3 } });
  check('the victim took the hit', victim.health === hp - 30, `hp ${hp} -> ${victim.health}`);
  check('the puncher went up with it', worm.vy < -3, `vy ${worm.vy.toFixed(2)}`);
}

console.log(failures === 0 ? '\nALL ARSENAL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
