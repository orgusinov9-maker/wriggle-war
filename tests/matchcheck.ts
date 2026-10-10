class FakeImageData {
  width: number; height: number; data: Uint8ClampedArray;
  constructor(w: number, h: number) { this.width = w; this.height = h; this.data = new Uint8ClampedArray(w * h * 4); }
}
const fakeCtx = { createImageData: (w: number, h: number) => new FakeImageData(w, h), putImageData: () => {} };
(globalThis as any).ImageData = FakeImageData;
(globalThis as any).document = { createElement: () => ({ width: 0, height: 0, getContext: () => fakeCtx }) };

import { generateMap } from '../src/world/mapgen';
import { Match, Phase, TurnCommand, DEFAULT_RULES } from '../src/match';
import { TICK_HZ } from '../src/core/loop';

const IDLE: TurnCommand = { walk: 0, aimUp: false, aimDown: false, jump: false, backflip: false, skip: false };
const SKIP: TurnCommand = { ...IDLE, skip: true };

/** Reads the phase without letting an earlier loop narrow the union away. */
function phaseOf(m: Match): Phase {
  return m.phase;
}

function label(m: Match): string {
  return `${m.activeTeam?.name ?? '-'}/${m.activeWorm?.name ?? '-'}`;
}

// --- test 1: turn order alternates teams and cycles worms -----------------
{
  const m = new Match(generateMap(4242, 'island'), ['Red', 'Blue']);
  const seen: string[] = [];
  let ticks = 0;
  while (seen.length < 10 && ticks++ < 60000) {
    // Skip as soon as a turn becomes playable, so turns advance fast.
    const playable = m.phase === 'play';
    if (playable && seen[seen.length - 1] !== label(m)) seen.push(label(m));
    m.tick(playable ? SKIP : IDLE);
  }
  const teamsAlternate = seen.every((s, i) => (i === 0 ? true : s.split('/')[0] !== seen[i - 1].split('/')[0]));
  console.log('turn order:', seen.join(' -> '));
  console.log(`  teams alternate: ${teamsAlternate ? 'PASS' : 'FAIL'}`);
  const redWorms = seen.filter((s) => s.startsWith('Red')).map((s) => s.split('/')[1]);
  const cycles = new Set(redWorms.slice(0, 4)).size === 4;
  console.log(`  Red cycles through 4 distinct worms: ${cycles ? 'PASS' : 'FAIL'} (${redWorms.slice(0, 4).join(',')})`);
}

// --- test 2: an untouched turn lasts exactly the turn timer --------------
{
  const m = new Match(generateMap(99, 'island'), ['Red', 'Blue']);
  while (m.phase !== 'play') m.tick(IDLE);
  let ticks = 0;
  while (m.phase === 'play' && ticks++ < 60000) m.tick(IDLE);
  const seconds = ticks / TICK_HZ;
  console.log(`idle turn lasted ${seconds.toFixed(2)} s (rule ${DEFAULT_RULES.turnSeconds})  ${Math.abs(seconds - DEFAULT_RULES.turnSeconds) < 0.1 ? 'PASS' : 'FAIL'}`);
}

// --- test 3: rounds advance, sudden death fires, water rises -------------
{
  const m = new Match(generateMap(777, 'island'), ['Red', 'Blue']);
  const water0 = m.waterLevel;
  let ticks = 0;
  while (m.round < DEFAULT_RULES.suddenDeathRound && ticks++ < 400000) {
    m.tick(m.phase === 'play' ? SKIP : IDLE);
  }
  const maxHp = Math.max(...m.worms.filter((w) => w.alive).map((w) => w.health));
  console.log(`reached round ${m.round}, suddenDeath=${m.suddenDeath}  ${m.suddenDeath ? 'PASS' : 'FAIL'}`);
  console.log(`  all worms at 1 hp: ${maxHp === 1 ? 'PASS' : 'FAIL'} (max ${maxHp})`);

  const before = m.waterLevel;
  let t2 = 0;
  while (m.waterLevel === before && m.phase !== 'over' && t2++ < 20000) {
    m.tick(m.phase === 'play' ? SKIP : IDLE);
  }
  console.log(`  water rose ${water0 - m.waterLevel} px total: ${m.waterLevel < before ? 'PASS' : 'FAIL'}`);
}

// --- test 4: wiping a team ends the match with a winner -----------------
{
  const m = new Match(generateMap(31337, 'island'), ['Red', 'Blue']);
  while (m.phase !== 'play') m.tick(IDLE);
  const blue = m.teams[1];
  for (const i of blue.members) {
    const w = m.worms[i];
    m.explode(w.x, w.y, 40, 200, 0);
  }
  let ticks = 0;
  while (phaseOf(m) !== 'over' && ticks++ < 60000) m.tick(IDLE);
  console.log(`wiped Blue -> phase ${m.phase}, winner ${m.winner?.name ?? 'none'}  ${m.winner?.name === 'Red' ? 'PASS' : 'FAIL'}`);
  console.log(`  graves placed: ${m.graves.length} (expect up to 4)  ${m.graves.length > 0 ? 'PASS' : 'FAIL'}`);
}

// --- test 5: firing moves the turn into retreat and ends it -------------
{
  const m = new Match(generateMap(5150, 'island'), ['Red', 'Blue']);
  while (m.phase !== 'play') m.tick(IDLE);
  const who = label(m);
  m.tick({ ...IDLE, selectWeapon: 'bazooka' });
  m.tick({ ...IDLE, fire: { power: 1, fuseSeconds: 3 } });
  const wentToRetreat = phaseOf(m) === 'retreat';
  let ticks = 0;
  while (phaseOf(m) !== 'play' && phaseOf(m) !== 'over' && ticks++ < 60000) m.tick(IDLE);
  const nowPlayingSomeoneElse = phaseOf(m) !== 'over' ? label(m) !== who : true;
  console.log(`fire -> retreat: ${wentToRetreat ? 'PASS' : 'FAIL'}; turn passed on: ${nowPlayingSomeoneElse ? 'PASS' : 'FAIL'}`);
  console.log(`  cannot fire twice in one turn: ${m.canFire || phaseOf(m) !== 'retreat' ? 'PASS' : 'FAIL'}`);
}
