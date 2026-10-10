class FakeImageData {
  width: number; height: number; data: Uint8ClampedArray;
  constructor(w: number, h: number) { this.width = w; this.height = h; this.data = new Uint8ClampedArray(w * h * 4); }
}
const fakeCtx = { createImageData: (w: number, h: number) => new FakeImageData(w, h), putImageData: () => {} };
(globalThis as any).ImageData = FakeImageData;
(globalThis as any).document = { createElement: () => ({ width: 0, height: 0, getContext: () => fakeCtx }) };

import { generateMap } from '../src/world/mapgen';
import { Match, MatchEvent, TurnCommand } from '../src/match';

/**
 * The match reports what happened so the shell can make it audible. Sound
 * itself cannot run headless, so this checks the part that can go quietly
 * wrong: that each event is raised when it should be, and only then.
 */

const IDLE: TurnCommand = { walk: 0, aimUp: false, aimDown: false, jump: false, backflip: false, skip: false };
let failures = 0;

function check(label: string, ok: boolean, detail = ''): void {
  if (!ok) failures++;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? '  (' + detail + ')' : ''}`);
}

/** Runs ticks and collects every event raised along the way. */
function run(m: Match, ticks: number, cmd: TurnCommand = IDLE, until?: () => boolean): MatchEvent[] {
  const seen: MatchEvent[] = [];
  for (let t = 0; t < ticks && !(until && until()); t++) {
    m.tick(t === 0 ? cmd : IDLE);
    seen.push(...m.events);
  }
  return seen;
}

const count = (events: MatchEvent[], kind: MatchEvent['kind']) => events.filter((e) => e.kind === kind).length;

function fresh(seed = 4242): { m: Match; start: MatchEvent[] } {
  const m = new Match(generateMap(seed, 'island'), ['Red', 'Blue']);
  const start = run(m, 60000, IDLE, () => m.phase === 'play');
  return { m, start };
}

console.log('turn clock');
{
  const { m } = fresh();
  const events = run(m, 60000, IDLE, () => m.phase === 'between');
  const ticks = events.filter((e): e is Extract<MatchEvent, { kind: 'countdown' }> => e.kind === 'countdown');
  check('the last five seconds tick', ticks.map((e) => e.seconds).join(',') === '5,4,3,2,1',
    ticks.map((e) => e.seconds).join(','));
  check('time up is announced once', count(events, 'timeUp') === 1);
  const next = run(m, 200, IDLE, () => m.phase === 'play');
  check('the next turn announces itself', count(next, 'turnStart') === 1);
}

console.log('queue');
{
  const { m } = fresh();
  m.tick({ ...IDLE, jump: true });
  const jumped = m.events.length;
  m.tick(IDLE);
  check('events are cleared each tick', jumped > 0 && !m.events.some((e) => e.kind === 'jump'),
    `${jumped} then ${m.events.length}`);
}

console.log('bazooka');
{
  const { m } = fresh();
  const events = run(m, 600, { ...IDLE, fire: { power: 1, fuseSeconds: 3 } }, () => m.projectiles.length === 0 && m.phase !== 'play');
  const launch = events.find((e) => e.kind === 'launch');
  check('the launch is heard', launch?.kind === 'launch' && launch.weapon === 'bazooka');
  const boom = events.find((e) => e.kind === 'explode');
  check('the impact is heard, with its size', boom?.kind === 'explode' && boom.radius > 0 && !boom.holy);
}

console.log('grenade');
{
  const { m } = fresh(77);
  m.tick({ ...IDLE, selectWeapon: 'grenade' });
  check('the weapon change clicks', count(m.events, 'select') === 1);
  const events = run(m, 400, { ...IDLE, aimUp: true, fire: { power: 0.5, fuseSeconds: 3 } });
  check('it bounces audibly before going off', count(events, 'bounce') > 0 && count(events, 'explode') > 0,
    `${count(events, 'bounce')} bounces`);
}

console.log('holy hand grenade');
{
  const { m } = fresh(91);
  m.tick({ ...IDLE, selectWeapon: 'holy' });
  const events = run(m, 600, { ...IDLE, fire: { power: 0.6, fuseSeconds: 3 } });
  check('its blast is marked holy', events.some((e) => e.kind === 'explode' && e.holy));
}

console.log('uzi');
{
  const { m } = fresh();
  m.tick({ ...IDLE, selectWeapon: 'uzi' });
  const events = run(m, 120, { ...IDLE, fire: { power: 1, fuseSeconds: 3 } });
  check('each bullet is heard', count(events, 'shot') >= 10, `${count(events, 'shot')} shots`);
  check('a gun raises no launch', count(events, 'launch') === 0);
}

console.log('mine');
{
  const { m } = fresh(2024);
  m.tick({ ...IDLE, selectWeapon: 'mine' });
  m.tick({ ...IDLE, fire: { power: 1, fuseSeconds: 3 } });
  run(m, 60000, IDLE, () => m.phase === 'play');
  const mine = m.projectiles[0];
  const victim = m.worms.find((w) => w.alive && Math.hypot(w.x - mine.x, w.y - mine.y) > 60)!;
  victim.x = mine.x + 6;
  victim.y = mine.y;
  const events = run(m, 200, IDLE, () => m.projectiles.length === 0);
  check('it beeps once when tripped, then blows', count(events, 'mineTrigger') === 1 && count(events, 'explode') >= 1,
    `${count(events, 'mineTrigger')} triggers`);
}

console.log('drowning');
{
  const { m } = fresh();
  const victim = m.worms.find((w) => w !== m.activeWorm)!;
  victim.y = m.waterLevel + 4;
  const events = run(m, 5);
  check('a big splash, then a death', events.some((e) => e.kind === 'splash' && e.big) && count(events, 'death') === 1);
}

console.log('game over');
{
  const { m } = fresh();
  const blue = m.teams[1];
  for (const i of blue.members) m.worms[i].applyDamage(999);
  const events = run(m, 60000, { ...IDLE, skip: true }, () => m.phase === 'over');
  events.push(...m.events);
  check('the win is announced', events.some((e) => e.kind === 'gameOver' && !e.draw));
}

console.log(failures === 0 ? '\nALL EVENT CHECKS PASSED' : `\n${failures} EVENT CHECK(S) FAILED`);
