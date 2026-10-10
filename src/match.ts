import { TICK_HZ } from './core/loop';
import { AirStrike } from './entities/airstrike';
import { Grave } from './entities/grave';
import { Rope, SwingInput } from './entities/rope';
import { FlightContext, PROJECTILE_HIT_RADIUS, Projectile } from './entities/projectile';
import { ProjectileSpec, WEAPONS, WeaponId, startingAmmo } from './entities/weapons';
import { PHYS, Worm } from './entities/worm';
import { Particles } from './render/particles';
import { TEAM_COLORS } from './render/palette';
import { GIRDER_ANGLES, girderNear } from './world/girder';
import { GeneratedMap, MAP_WIDTH } from './world/mapgen';

/**
 * Match rules. The defaults mirror a standard game of the original: a
 * three-quarter-minute turn, a short retreat after firing, and a sudden death
 * that strips everyone to a single hit point while the sea closes in.
 */
export interface MatchRules {
  turnSeconds: number;
  retreatSeconds: number;
  wormsPerTeam: number;
  startHealth: number;
  /** Round number at which sudden death begins. */
  suddenDeathRound: number;
  /** Pixels the sea climbs per turn once sudden death has started. */
  waterRisePerTurn: number;
}

export const DEFAULT_RULES: MatchRules = {
  turnSeconds: 45,
  retreatSeconds: 3,
  wormsPerTeam: 4,
  startHealth: 100,
  suddenDeathRound: 12,
  waterRisePerTurn: 7,
};

export type Phase = 'lineup' | 'play' | 'retreat' | 'settle' | 'between' | 'over';

export interface Team {
  readonly name: string;
  readonly colorIndex: number;
  /** Indices into `worms`, in the order this team cycles through them. */
  readonly members: number[];
  /** Which of its own members plays next. */
  pointer: number;
  /** Rounds left per weapon; -1 is unlimited. */
  readonly ammo: Record<WeaponId, number>;
}

/** What the player is asking for this tick. Built from raw input by the shell. */
export interface TurnCommand {
  walk: -1 | 0 | 1;
  aimUp: boolean;
  aimDown: boolean;
  jump: boolean;
  backflip: boolean;
  skip: boolean;
  /** Present on the tick a weapon is chosen from the menu. */
  selectWeapon?: WeaponId;
  /** Present on the tick the fire key is released. */
  fire?: { power: number; fuseSeconds: number; target?: { x: number; y: number }; girderStep?: number };
}

const NO_COMMAND: TurnCommand = {
  walk: 0,
  aimUp: false,
  aimDown: false,
  jump: false,
  backflip: false,
  skip: false,
};

const NO_SWING: SwingInput = { swing: 0, climb: 0 };

const WORM_NAMES = [
  'Boggy', 'Spadge', 'Clive', 'Rufus', 'Lurch', 'Gumbo',
  'Shrapnel', 'Tosser', 'Weevil', 'Bilbo', 'Mongo', 'Slugger',
];

/** A hitscan burst in progress: the uzi spits its pellets over several ticks. */
interface Burst {
  left: number;
  cooldown: number;
  readonly interval: number;
  readonly damage: number;
  readonly spreadDeg: number;
  readonly holeRadius: number;
  readonly wormIndex: number;
}

/**
 * Something audible happened. The match only reports it; the shell decides
 * what it sounds like, so the rules stay free of any audio API and a headless
 * run simply ignores the queue. Positioned events carry world coordinates.
 */
export type MatchEvent =
  | { kind: 'launch'; weapon: WeaponId; x: number; y: number }
  | { kind: 'shot'; x: number; y: number }
  | { kind: 'swing'; weapon: WeaponId; hit: boolean; x: number; y: number }
  | { kind: 'explode'; radius: number; holy: boolean; x: number; y: number }
  | { kind: 'bounce'; speed: number; x: number; y: number }
  | { kind: 'mineTrigger'; x: number; y: number }
  | { kind: 'splash'; big: boolean; x: number; y: number }
  | { kind: 'jump'; backflip: boolean; x: number; y: number }
  | { kind: 'hurtLanding'; damage: number; x: number; y: number }
  | { kind: 'death'; x: number; y: number }
  | { kind: 'ropeShot'; x: number; y: number }
  | { kind: 'ropeCatch'; x: number; y: number }
  | { kind: 'ropeRelease'; x: number; y: number }
  | { kind: 'torch'; x: number; y: number }
  | { kind: 'girder'; x: number; y: number }
  | { kind: 'select' }
  | { kind: 'turnStart' }
  | { kind: 'countdown'; seconds: number }
  | { kind: 'timeUp' }
  | { kind: 'suddenDeath' }
  | { kind: 'gameOver'; draw: boolean };

/** A blowtorch that is burning: the worm tunnels until it runs out or is stopped. */
interface Torch {
  left: number;
  /** Banked fraction of a pixel of travel. */
  travel: number;
  /** Consecutive ticks of burning nothing: a worm torching thin air stops. */
  idle: number;
  /** Each worm is only burnt once per use. */
  readonly scorched: Set<Worm>;
}

/** The blowtorch points one of three ways: level, or 45 degrees up or down. */
function torchAngle(aim: number): number {
  const eighth = Math.PI / 4;
  return aim < -eighth / 2 ? -eighth : aim > eighth / 2 ? eighth : 0;
}

/** A tracer the renderer draws for a few ticks after a gun goes off. */
export interface Tracer {
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
  life: number;
}

/**
 * Owns everything that makes this a game rather than a sandbox: whose turn it
 * is, what they are holding, how long they have, and who has won.
 */
export class Match {
  readonly worms: Worm[] = [];
  readonly teams: Team[] = [];
  readonly graves: Grave[] = [];
  readonly projectiles: Projectile[] = [];
  readonly airstrikes: AirStrike[] = [];
  readonly tracers: Tracer[] = [];
  /** What happened during the last tick. Cleared at the start of every tick. */
  readonly events: MatchEvent[] = [];
  readonly rules: MatchRules;
  readonly particles: Particles;

  phase: Phase = 'lineup';
  /** Ticks left in the current timed phase. */
  phaseTicks = 0;
  round = 1;
  wind = 0;
  waterLevel: number;
  suddenDeath = false;
  /** Short message for the on-screen banner, or null. */
  banner: string | null = null;
  bannerTicks = 0;
  winner: Team | null = null;
  isDraw = false;
  /** The active worm's ninja rope, in flight or attached, or null. */
  rope: Rope | null = null;
  /** What the active team is holding. Reset to the bazooka every turn. */
  selectedWeapon: WeaponId = 'bazooka';

  private teamPointer = 0;
  private activeIdx = -1;
  /** Trigger pulls used this turn, so a two-shot weapon can fire twice. */
  private shotsUsed = 0;
  private burst: Burst | null = null;
  /** This tick's swing and climb orders, applied when the roped worm moves. */
  private ropeInput: SwingInput = NO_SWING;
  private torch: Torch | null = null;

  constructor(private readonly map: GeneratedMap, teamNames: readonly string[], rules = DEFAULT_RULES) {
    this.rules = rules;
    this.particles = new Particles(map.theme);
    this.waterLevel = map.waterLevel;
    this.createTeams(teamNames);
    this.beginTurn(true);
  }

  get activeWorm(): Worm | null {
    return this.activeIdx >= 0 ? this.worms[this.activeIdx] ?? null : null;
  }

  get activeTeam(): Team | null {
    return this.teams[this.teamPointer] ?? null;
  }

  /** Seconds remaining, for the on-screen clock. */
  get secondsLeft(): number {
    return Math.max(0, Math.ceil(this.phaseTicks / TICK_HZ));
  }

  /** Movement and aiming are allowed while playing and while retreating. */
  get canMove(): boolean {
    return this.phase === 'play' || this.phase === 'retreat';
  }

  /** The blowtorch is burning. */
  get torching(): boolean {
    return this.torch !== null;
  }

  /** The direction a blowtorch in the active worm's hand points: level or 45 degrees. */
  get torchAim(): number {
    return torchAngle(this.activeWorm?.aim ?? 0);
  }

  get canFire(): boolean {
    // While the torch burns, the trigger puts it out.
    if (this.torch) return true;
    if (this.burst) return false;
    const spec = WEAPONS[this.selectedWeapon];
    // The rope is movement, not an attack: usable all turn, retreat included.
    if (spec.mode === 'rope') return this.canMove;
    if (this.phase !== 'play') return false;
    if (this.shotsUsed >= spec.shots) return false;
    return this.ammoOf(this.selectedWeapon) !== 0;
  }

  /** Rounds the active team has left; -1 is unlimited. */
  ammoOf(id: WeaponId): number {
    return this.activeTeam ? this.activeTeam.ammo[id] : 0;
  }

  teamHealth(team: Team): number {
    return team.members.reduce((sum, i) => sum + (this.worms[i].alive ? this.worms[i].health : 0), 0);
  }

  teamMaxHealth(team: Team): number {
    return team.members.length * this.rules.startHealth;
  }

  private createTeams(teamNames: readonly string[]): void {
    // Spawn points are pre-shuffled, and worms are dealt out alternately so
    // neither team gets the whole left or right half of the map.
    const MIN_GAP = 96;
    const needed = teamNames.length * this.rules.wormsPerTeam;
    const spots: { x: number; y: number }[] = [];
    for (const spot of this.map.spawnPoints) {
      if (spots.length >= needed) break;
      if (spots.every((c) => Math.hypot(c.x - spot.x, c.y - spot.y) >= MIN_GAP)) spots.push(spot);
    }
    // If the map is cramped, fall back to reusing points rather than dropping worms.
    while (spots.length < needed && this.map.spawnPoints.length > 0) {
      spots.push(this.map.spawnPoints[spots.length % this.map.spawnPoints.length]);
    }

    teamNames.forEach((name, t) => {
      this.teams.push({ name, colorIndex: t, members: [], pointer: 0, ammo: startingAmmo() });
    });

    for (let i = 0; i < needed; i++) {
      const teamIndex = i % teamNames.length;
      const spot = spots[i];
      const nameIndex = teamIndex * this.rules.wormsPerTeam + Math.floor(i / teamNames.length);
      const worm = new Worm(
        spot.x,
        spot.y,
        WORM_NAMES[nameIndex % WORM_NAMES.length],
        teamIndex,
        this.rules.startHealth,
      );
      this.teams[teamIndex].members.push(this.worms.length);
      this.worms.push(worm);
    }
  }

  /** Advances to the next team with a living worm and starts its turn. */
  private beginTurn(first = false): void {
    if (this.checkGameOver()) return;

    if (!first) {
      const before = this.teamPointer;
      for (let i = 1; i <= this.teams.length; i++) {
        const next = (before + i) % this.teams.length;
        if (this.teamHealth(this.teams[next]) > 0) {
          this.teamPointer = next;
          // Wrapping back to the first team means a full round has passed.
          if (next <= before) this.startRound();
          break;
        }
      }
    }

    const team = this.teams[this.teamPointer];
    this.activeIdx = this.nextMemberOf(team);
    this.shotsUsed = 0;
    this.burst = null;
    this.rope = null;
    this.torch = null;
    this.selectedWeapon = 'bazooka';
    this.wind = Math.round((Math.random() * 2 - 1) * 100) / 100;
    this.phase = 'lineup';
    this.phaseTicks = Math.round(TICK_HZ * 0.9);
    this.events.push({ kind: 'turnStart' });
  }

  private startRound(): void {
    this.round++;
    if (this.round >= this.rules.suddenDeathRound && !this.suddenDeath) {
      this.suddenDeath = true;
      for (const worm of this.worms) {
        if (worm.alive) worm.health = Math.min(worm.health, 1);
      }
      this.showBanner('SUDDEN DEATH', 2.4);
      this.events.push({ kind: 'suddenDeath' });
    }
  }

  private nextMemberOf(team: Team): number {
    for (let i = 0; i < team.members.length; i++) {
      const candidate = team.members[(team.pointer + i) % team.members.length];
      if (this.worms[candidate].alive) {
        team.pointer = (team.pointer + i + 1) % team.members.length;
        return candidate;
      }
    }
    return -1;
  }

  private showBanner(text: string, seconds: number): void {
    this.banner = text;
    this.bannerTicks = Math.round(TICK_HZ * seconds);
  }

  /** One simulation tick. `cmd` is ignored outside the playable phases. */
  tick(cmd: TurnCommand = NO_COMMAND): void {
    this.events.length = 0;
    this.ropeInput = NO_SWING;
    if (this.bannerTicks > 0 && --this.bannerTicks === 0) this.banner = null;

    if (this.phase !== 'over') {
      this.applyCommand(this.canMove ? cmd : NO_COMMAND);
      this.updateBurst();
      this.updateRope();
      this.updateTorch();
      this.updateAirstrikes();
      this.updateProjectiles();
      this.updateWorms();
      this.updateGraves();
      this.advancePhase(cmd);
    }

    for (let i = this.tracers.length - 1; i >= 0; i--) {
      if (--this.tracers[i].life <= 0) this.tracers.splice(i, 1);
    }
    this.particles.tick(this.map.terrain);
    for (const worm of this.worms) {
      if (!worm.alive) continue;
      worm.animTick++;
      if (worm.blinkTicks > 0) worm.blinkTicks--;
      else if (Math.random() < 0.004) worm.blinkTicks = 7;
    }
  }

  private applyCommand(cmd: TurnCommand): void {
    const worm = this.activeWorm;
    if (!worm || !worm.alive) return;
    const terrain = this.map.terrain;

    if (this.torch) {
      // Torching: up and down swing the flame between its three angles, and
      // the trigger puts it out. Nothing else - not even a weapon swap.
      if (cmd.aimUp) worm.aimUp();
      if (cmd.aimDown) worm.aimDown();
      if (cmd.fire) this.endTorch();
      return;
    }

    // Swapping weapons is free and always allowed while you hold the turn.
    if (cmd.selectWeapon && this.ammoOf(cmd.selectWeapon) !== 0) {
      this.selectedWeapon = cmd.selectWeapon;
      this.events.push({ kind: 'select' });
    }

    if (worm.state === 'roped') {
      // On the rope the arrows swing and climb; fire or jump lets go. A
      // placed weapon can still be dropped from it - rope and dynamite.
      const spec = WEAPONS[this.selectedWeapon];
      if (cmd.jump || (cmd.fire && spec.mode === 'rope')) {
        this.releaseRope();
      } else if (cmd.fire && spec.mode === 'placed' && this.canFire) {
        this.fire(worm, cmd.fire);
      }
      this.ropeInput = { swing: cmd.walk, climb: cmd.aimUp ? -1 : cmd.aimDown ? 1 : 0 };
      return;
    }

    if (worm.grounded(terrain) && (worm.state === 'airborne' || worm.state === 'flying')) {
      worm.state = 'idle';
    }
    const onFoot = worm.state === 'idle' || worm.state === 'walking';

    if (onFoot) {
      if (cmd.walk !== 0) worm.walk(terrain, cmd.walk);
      else if (worm.state === 'walking') worm.state = 'idle';
      if (cmd.jump || cmd.backflip) {
        worm.jump(cmd.backflip);
        this.events.push({ kind: 'jump', backflip: cmd.backflip, x: worm.x, y: worm.y });
      }
    }
    if (cmd.aimUp) worm.aimUp();
    if (cmd.aimDown) worm.aimDown();

    // The rope can also be thrown mid-air, which is how worms chain swings.
    const ready = WEAPONS[this.selectedWeapon].mode === 'rope'
      ? !this.rope && (onFoot || worm.state === 'airborne')
      : onFoot;
    if (cmd.fire && this.canFire && ready) this.fire(worm, cmd.fire);
  }

  // --- firing -------------------------------------------------------------

  private fire(worm: Worm, order: NonNullable<TurnCommand['fire']>): void {
    const spec = WEAPONS[this.selectedWeapon];
    if (spec.needsTarget && !order.target) return;
    if (spec.mode === 'girder') {
      const step = order.girderStep ?? 0;
      if (!order.target || !this.canPlaceGirder(order.target.x, order.target.y, step)) return;
    }
    // Guns and bats announce themselves pellet by pellet and swing by swing.
    if (spec.mode === 'rope') {
      this.shootRope(worm);
      return; // no ammo, no shot counted, no retreat
    }
    if (spec.mode === 'ballistic' || spec.mode === 'placed' || spec.mode === 'airstrike') {
      this.events.push({ kind: 'launch', weapon: spec.id, x: worm.x, y: worm.y });
    }

    switch (spec.mode) {
      case 'ballistic':
        this.launchBallistic(worm, spec.projectile!, order);
        break;
      case 'hitscan':
        this.beginBurst(spec.hitscan!);
        break;
      case 'melee':
        this.swing(worm, spec.melee!);
        break;
      case 'placed':
        this.place(worm, spec.projectile!, order.fuseSeconds);
        break;
      case 'airstrike':
        this.airstrikes.push(new AirStrike(order.target!.x, MAP_WIDTH));
        break;
      case 'torch':
        this.lightTorch(worm);
        break;
      case 'girder':
        this.map.terrain.placeGirder(order.target!.x, order.target!.y, order.girderStep ?? 0);
        this.events.push({ kind: 'girder', x: order.target!.x, y: order.target!.y });
        break;
      case 'utility':
        break; // Skip Go: the turn ends below and nothing else happens.
    }

    this.spendAmmo(spec.id);
    this.shotsUsed++;
    // A weapon with shots left keeps the turn open; anything else starts the
    // retreat clock. Skip Go ends the turn outright.
    if (spec.mode === 'utility') {
      this.phase = 'settle';
    } else if (spec.mode === 'torch') {
      // The turn stays live while it burns; retreat starts when it goes out.
    } else if (this.shotsUsed >= spec.shots) {
      this.phase = 'retreat';
      this.phaseTicks = Math.round(this.rules.retreatSeconds * TICK_HZ);
    }
  }

  private shootRope(worm: Worm): void {
    const v = worm.aimVector();
    this.rope = new Rope(worm.x + v.x * 6, worm.y - 3 + v.y * 6, v.x, v.y);
    this.events.push({ kind: 'ropeShot', x: worm.x, y: worm.y });
  }

  /** Lets go of the rope; the worm keeps whatever speed it had. */
  private releaseRope(): void {
    const worm = this.activeWorm;
    if (worm && worm.state === 'roped') {
      worm.state = 'airborne';
      this.events.push({ kind: 'ropeRelease', x: worm.x, y: worm.y });
    }
    this.rope = null;
  }

  /** Flies the hook, and drops the rope when the turn or the worm is done with it. */
  private updateRope(): void {
    const rope = this.rope;
    if (!rope) return;
    const worm = this.activeWorm;
    // Out of time, dead, or knocked off by a blast: the rope goes.
    if (!worm || !worm.alive || !this.canMove || (rope.phase === 'attached' && worm.state !== 'roped')) {
      this.releaseRope();
      return;
    }
    if (rope.phase !== 'flying') return;
    const outcome = rope.fly(this.map.terrain, worm);
    if (outcome === 'caught') {
      worm.state = 'roped';
      this.events.push({ kind: 'ropeCatch', x: rope.pivot.x, y: rope.pivot.y });
    } else if (outcome === 'missed') {
      this.rope = null;
    }
  }

  /**
   * Whether a girder may go here. Like the original, it may cut into dirt but
   * never land on a worm, and it has to be inside the map above the water.
   */
  canPlaceGirder(x: number, y: number, step: number): boolean {
    const terrain = this.map.terrain;
    if (x < 0 || x >= terrain.width || y < 0 || y >= this.waterLevel) return false;
    return !this.worms.some((w) => w.alive && girderNear(x, y, step % GIRDER_ANGLES, w.x, w.y, PHYS.radius + 1));
  }

  // --- blowtorch ----------------------------------------------------------

  private lightTorch(worm: Worm): void {
    // Tunnelling works on whole pixels, so the bore lines up with the feet.
    const rx = Math.round(worm.x);
    const ry = Math.round(worm.y);
    if (worm.fits(this.map.terrain, rx, ry)) {
      worm.x = rx;
      worm.y = ry;
    }
    worm.aim = torchAngle(worm.aim);
    worm.state = 'walking';
    this.torch = { left: WEAPONS.blowtorch.torch!.ticks, travel: 0, idle: 0, scorched: new Set() };
  }

  /** The flame goes out: the worm stands where it is and the retreat clock starts. */
  private endTorch(): void {
    this.torch = null;
    const worm = this.activeWorm;
    if (worm && worm.state === 'walking') worm.state = 'idle';
    if (this.phase === 'play') {
      this.phase = 'retreat';
      this.phaseTicks = Math.round(this.rules.retreatSeconds * TICK_HZ);
    }
  }

  /**
   * One tick of torching: burn a bore just ahead of the worm, scorch anyone in
   * it, then move the worm along. The bore sits so its floor is exactly the
   * ground under the worm's feet, so a level tunnel stays level.
   */
  private updateTorch(): void {
    const torch = this.torch;
    if (!torch) return;
    const worm = this.activeWorm;
    if (!worm || !worm.alive || !this.canMove || worm.state !== 'walking' || torch.left-- <= 0) {
      this.endTorch();
      return;
    }
    const spec = WEAPONS.blowtorch.torch!;
    const terrain = this.map.terrain;
    const a = torchAngle(worm.aim);
    const dx = Math.cos(a) * worm.facing;
    const dy = Math.sin(a);
    const level = dy === 0;

    const bx = worm.x + dx * 6;
    const by = worm.y + PHYS.radius + 0.5 - spec.bore + dy * 6;
    const burnt = terrain.destroy(bx, by, spec.bore);
    torch.idle = burnt > 0 ? 0 : torch.idle + 1;
    this.particles.flame(bx + dx * 5, by + dy * 5, dx, dy);
    this.events.push({ kind: 'torch', x: bx, y: by });

    for (const other of this.worms) {
      if (other === worm || !other.alive || torch.scorched.has(other)) continue;
      if (Math.hypot(other.x - bx, other.y - (by + 3)) > spec.bore + 3) continue;
      torch.scorched.add(other);
      other.applyDamage(spec.damage);
      this.particles.damage(other.x, other.y - 18, spec.damage, TEAM_COLORS[other.teamIndex % TEAM_COLORS.length]);
      other.launch(dx * spec.push, -spec.push * 0.8);
      this.events.push({ kind: 'swing', weapon: 'blowtorch', hit: true, x: other.x, y: other.y });
    }

    // Diagonals cover their distance in whole-pixel steps of (1, 1).
    torch.travel += level ? spec.speed : spec.speed / Math.SQRT2;
    while (torch.travel >= 1) {
      torch.travel -= 1;
      const nx = worm.x + Math.sign(dx);
      const ny = worm.y + Math.sign(dy);
      const lifts = level ? [0, -1, -2] : [0];
      const lift = lifts.find((l) => worm.fits(terrain, nx, ny + l));
      if (lift === undefined) {
        this.endTorch(); // indestructible rock
        return;
      }
      worm.x = nx;
      worm.y = ny + lift;
      worm.walkPhase += 0.34;
      if (level) {
        // Follow a gentle downslope, but a level torch run off a ledge falls.
        for (let i = 0; i < 3 && !worm.grounded(terrain) && worm.fits(terrain, worm.x, worm.y + 1); i++) worm.y++;
        if (!worm.grounded(terrain)) {
          this.endTorch();
          worm.state = 'airborne';
          return;
        }
      }
    }
    // A worm that has burnt its way out into open sky puts the torch away.
    if (torch.idle > 8) this.endTorch();
  }

  private spendAmmo(id: WeaponId): void {
    const team = this.activeTeam;
    if (!team) return;
    if (team.ammo[id] > 0) team.ammo[id]--;
    if (team.ammo[id] === 0 && this.selectedWeapon === id) this.selectedWeapon = 'bazooka';
  }

  private launchBallistic(
    worm: Worm,
    spec: ProjectileSpec,
    order: NonNullable<TurnCommand['fire']>,
  ): void {
    const v = worm.aimVector();
    const speed = spec.maxSpeed * order.power;
    const muzzle = 9;
    const fuse = WEAPONS[this.selectedWeapon].adjustableFuse
      ? Math.round(order.fuseSeconds * TICK_HZ)
      : spec.fuseTicks;
    const p = new Projectile(
      worm.x + v.x * muzzle,
      worm.y - 3 + v.y * muzzle,
      v.x * speed,
      v.y * speed,
      spec,
      fuse,
      this.activeIdx,
    );
    if (spec.homing && order.target) p.target = { ...order.target };
    this.projectiles.push(p);
  }

  /** Dynamite and mines go down at the worm's feet, not through the air. */
  private place(worm: Worm, spec: ProjectileSpec, fuseSeconds: number): void {
    const fuse = WEAPONS[this.selectedWeapon].adjustableFuse
      ? Math.round(fuseSeconds * TICK_HZ)
      : spec.fuseTicks;
    this.projectiles.push(
      new Projectile(worm.x + worm.facing * 3, worm.y - 1, 0, 0.1, spec, fuse, this.activeIdx),
    );
  }

  private beginBurst(h: NonNullable<import('./entities/weapons').WeaponSpec['hitscan']>): void {
    this.burst = {
      left: h.pellets,
      cooldown: 0,
      interval: h.intervalTicks,
      damage: h.damage,
      spreadDeg: h.spreadDeg,
      holeRadius: h.holeRadius,
      wormIndex: this.activeIdx,
    };
  }

  /** Feeds the pellets of a hitscan burst out over successive ticks. */
  private updateBurst(): void {
    const burst = this.burst;
    if (!burst) return;
    if (burst.cooldown > 0) {
      burst.cooldown--;
      return;
    }

    const worm = this.worms[burst.wormIndex];
    if (worm && worm.alive) {
      const v = worm.aimVector();
      const spread = ((Math.random() * 2 - 1) * burst.spreadDeg * Math.PI) / 180;
      const a = Math.atan2(v.y, v.x) + spread;
      this.shootRay(worm.x, worm.y - 3, Math.cos(a), Math.sin(a), burst);
    }

    burst.left--;
    burst.cooldown = burst.interval;
    if (burst.left <= 0) this.burst = null;
  }

  /** Walks a ray until it meets a worm or the ground, whichever comes first. */
  private shootRay(x0: number, y0: number, dx: number, dy: number, burst: Burst): void {
    const RANGE = 1200;
    const terrain = this.map.terrain;
    let hx = x0 + dx * RANGE;
    let hy = y0 + dy * RANGE;

    for (let t = 6; t < RANGE; t++) {
      const x = x0 + dx * t;
      const y = y0 + dy * t;
      if (x < -40 || x > terrain.width + 40 || y > terrain.height + 40) break;

      const victim = this.worms.find(
        (w, i) => w.alive && i !== burst.wormIndex && Math.hypot(w.x - x, w.y - y) <= PROJECTILE_HIT_RADIUS,
      );
      if (victim) {
        hx = x;
        hy = y;
        victim.applyDamage(burst.damage);
        this.particles.damage(victim.x, victim.y - 18, burst.damage, TEAM_COLORS[victim.teamIndex % TEAM_COLORS.length]);
        // A bullet shoves far less than a blast, but it is not nothing.
        victim.launch(dx * 0.9, -0.6);
        break;
      }
      if (terrain.solid(x, y)) {
        hx = x;
        hy = y;
        terrain.destroy(x, y, burst.holeRadius);
        this.particles.explosion(x, y, burst.holeRadius * 0.7);
        break;
      }
    }

    this.tracers.push({ x0, y0, x1: hx, y1: hy, life: 5 });
    this.events.push({ kind: 'shot', x: x0, y: y0 });
  }

  /** Fire punch and baseball bat: everything in a short arc in front. */
  private swing(worm: Worm, m: NonNullable<import('./entities/weapons').WeaponSpec['melee']>): void {
    const cx = worm.x + worm.facing * m.reach * 0.55;
    const cy = worm.y - 4;
    let connected = false;

    for (const other of this.worms) {
      if (other === worm || !other.alive) continue;
      if (Math.hypot(other.x - cx, other.y - cy) > m.reach) continue;
      connected = true;
      other.applyDamage(m.damage);
      this.particles.damage(other.x, other.y - 18, m.damage, TEAM_COLORS[other.teamIndex % TEAM_COLORS.length]);
      other.launch(worm.facing * m.pushX, m.pushY);
    }

    this.particles.explosion(cx, cy, connected ? 14 : 8);
    this.events.push({ kind: 'swing', weapon: this.selectedWeapon, hit: connected, x: cx, y: cy });
    if (m.selfLift !== 0) {
      // The punch carries the worm up with it, exactly as in the original.
      worm.vy = m.selfLift;
      worm.vx = worm.facing * 0.5;
      worm.state = 'airborne';
    }
  }

  // --- world update -------------------------------------------------------

  private updateAirstrikes(): void {
    for (let i = this.airstrikes.length - 1; i >= 0; i--) {
      const plane = this.airstrikes[i];
      for (const drop of plane.tick()) {
        this.projectiles.push(
          new Projectile(drop.x, drop.y, plane.vx * 0.35, 1.2, WEAPONS.airstrike.projectile!, -1, -1),
        );
      }
      if (plane.offscreen(MAP_WIDTH)) this.airstrikes.splice(i, 1);
    }
  }

  private updateProjectiles(): void {
    const ctx: FlightContext = {
      terrain: this.map.terrain,
      wind: this.wind,
      hitsWorm: () => false,
      wormNear: () => false,
    };

    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const p = this.projectiles[i];

      if (p.y > this.waterLevel) {
        this.particles.splash(p.x, this.waterLevel);
        this.events.push({ kind: 'splash', big: false, x: p.x, y: this.waterLevel });
        this.projectiles.splice(i, 1);
        continue;
      }

      const live: FlightContext = {
        ...ctx,
        hitsWorm: (x, y) =>
          this.worms.some(
            (w, idx) =>
              w.alive && idx !== p.ownerIndex && Math.hypot(w.x - x, w.y - y) <= PROJECTILE_HIT_RADIUS,
          ),
        // A mine does not care who laid it once it is armed.
        wormNear: (x, y, range) =>
          this.worms.some((w) => w.alive && Math.hypot(w.x - x, w.y - y) <= range),
      };

      const wasFused = p.fuse > 0;
      const outcome = p.step(live);
      if (p.bounced) this.events.push({ kind: 'bounce', speed: Math.hypot(p.vx, p.vy), x: p.x, y: p.y });
      if (!wasFused && p.fuse > 0 && p.spec.proximity > 0) {
        this.events.push({ kind: 'mineTrigger', x: p.x, y: p.y });
      }
      if (outcome === 'explode') {
        this.detonate(p);
        this.projectiles.splice(i, 1);
      } else if (outcome === 'gone') {
        this.projectiles.splice(i, 1);
      }
    }
  }

  /** Blows a projectile up and, for a cluster weapon, throws its shards. */
  private detonate(p: Projectile): void {
    const spec = p.spec;
    this.explode(p.x, p.y, spec.blastRadius, spec.maxDamage, spec.blastPower, spec.sprite === 'holy');

    if (spec.splitCount > 0 && spec.split) {
      const child = spec.split();
      for (let i = 0; i < spec.splitCount; i++) {
        // Fan the shards upward and outward from the burst.
        const a = -Math.PI / 2 + ((i - (spec.splitCount - 1) / 2) / spec.splitCount) * Math.PI * 1.1;
        const speed = spec.splitSpeed * (0.75 + Math.random() * 0.5);
        this.projectiles.push(
          new Projectile(
            p.x + Math.cos(a) * 4,
            p.y + Math.sin(a) * 4 - 2,
            Math.cos(a) * speed + p.vx * 0.25,
            Math.sin(a) * speed - 1,
            child,
            child.fuseTicks,
            -1,
          ),
        );
      }
    }
  }

  /** Carves the crater, then damages and throws everything in range. */
  explode(x: number, y: number, radius: number, maxDamage: number, power: number, holy = false): void {
    this.map.terrain.destroy(x, y, radius);
    this.particles.explosion(x, y, radius);
    this.events.push({ kind: 'explode', radius, holy, x, y });

    const reach = radius * 1.8;
    for (const worm of this.worms) {
      if (!worm.alive) continue;
      const dx = worm.x - x;
      const dy = worm.y - y;
      const dist = Math.hypot(dx, dy);
      if (dist > reach) continue;

      const falloff = 1 - dist / reach;
      const damage = Math.round(maxDamage * falloff);
      if (damage > 0) {
        worm.applyDamage(damage);
        this.particles.damage(worm.x, worm.y - 18, damage, TEAM_COLORS[worm.teamIndex % TEAM_COLORS.length]);
      }
      const len = dist < 0.01 ? 1 : dist;
      worm.launch((dx / len) * power * falloff * 3, (dy / len) * power * falloff * 3 - power * falloff);
    }

    // Graves in the blast get tossed as well.
    for (const grave of this.graves) {
      if (Math.hypot(grave.x - x, grave.y - y) <= reach) {
        grave.settled = false;
        grave.vy = -1.5;
      }
    }
  }

  private updateWorms(): void {
    const terrain = this.map.terrain;
    for (const worm of this.worms) {
      if (!worm.alive) {
        this.bury(worm);
        continue;
      }

      if (worm.state === 'idle' && !worm.grounded(terrain)) worm.state = 'airborne';
      if (worm.state === 'roped' && this.rope && !this.rope.swing(worm, terrain, this.ropeInput)) {
        this.releaseRope(); // the ground under the hook was blown away
      }
      const damage = worm.stepPhysics(terrain);
      if (damage > 0) {
        worm.applyDamage(damage);
        this.particles.damage(worm.x, worm.y - 18, damage, TEAM_COLORS[worm.teamIndex % TEAM_COLORS.length]);
        this.events.push({ kind: 'hurtLanding', damage, x: worm.x, y: worm.y });
      }

      if (worm.y > this.waterLevel) {
        this.particles.splash(worm.x, this.waterLevel);
        this.events.push({ kind: 'splash', big: true, x: worm.x, y: this.waterLevel });
        worm.applyDamage(worm.health);
        worm.state = 'dead';
      } else if (worm.x < -20 || worm.x > MAP_WIDTH + 20) {
        worm.applyDamage(worm.health);
        worm.state = 'dead';
      }

      this.bury(worm);
    }
  }

  /** Places a headstone the first time a worm is found dead. */
  private bury(worm: Worm): void {
    if (worm.alive || worm.buried) return;
    worm.buried = true;
    this.events.push({ kind: 'death', x: worm.x, y: worm.y });
    // A worm lost to the sea leaves no stone behind.
    if (worm.y <= this.waterLevel) {
      this.graves.push(new Grave(worm.x, worm.y, worm.teamIndex, (worm.animTick + worm.teamIndex) % 3));
    }
  }

  private updateGraves(): void {
    for (let i = this.graves.length - 1; i >= 0; i--) {
      const grave = this.graves[i];
      grave.tick(this.map.terrain, this.waterLevel);
      if (grave.y > this.waterLevel) {
        this.particles.splash(grave.x, this.waterLevel);
        this.events.push({ kind: 'splash', big: false, x: grave.x, y: this.waterLevel });
        this.graves.splice(i, 1);
      }
    }
  }

  /**
   * Ordnance that still has something to do. A mine lying dormant on the far
   * side of the map does not count, or no turn would ever end again.
   */
  private liveOrdnance(): number {
    return this.projectiles.reduce(
      (n, p) => n + (p.resting && p.fuse < 0 ? 0 : 1),
      0,
    ) + this.airstrikes.length + (this.burst ? 1 : 0) + (this.rope ? 1 : 0) + (this.torch ? 1 : 0);
  }

  /** Nothing is moving: safe to hand the turn over. */
  private worldIsQuiet(): boolean {
    if (this.liveOrdnance() > 0) return false;
    if (this.graves.some((g) => !g.settled)) return false;
    return this.worms.every(
      (w) => !w.alive || w.state === 'idle' || w.state === 'walking',
    );
  }

  private advancePhase(cmd: TurnCommand): void {
    const worm = this.activeWorm;

    switch (this.phase) {
      case 'lineup':
        if (--this.phaseTicks <= 0) {
          this.phase = 'play';
          this.phaseTicks = Math.round(this.rules.turnSeconds * TICK_HZ);
        }
        break;

      case 'play':
        if (cmd.skip || !worm || !worm.alive) {
          this.phase = 'settle';
        } else if (--this.phaseTicks <= 0) {
          this.showBanner('TIME UP', 1.2);
          this.events.push({ kind: 'timeUp' });
          this.phase = 'settle';
        } else if (this.phaseTicks % TICK_HZ === 0 && this.phaseTicks <= 5 * TICK_HZ) {
          // The last five seconds tick down audibly, as in the original.
          this.events.push({ kind: 'countdown', seconds: this.phaseTicks / TICK_HZ });
        }
        break;

      case 'retreat':
        // Retreat ends on its clock, or early once the shot has resolved and
        // everything has come to rest.
        // The retreat clock always runs in full, as in the original; what is
        // still in the air is then waited out by `settle`.
        if (--this.phaseTicks <= 0) this.phase = 'settle';
        break;

      case 'settle':
        if (this.worldIsQuiet()) {
          this.phase = 'between';
          this.phaseTicks = Math.round(TICK_HZ * 0.7);
        }
        break;

      case 'between':
        if (--this.phaseTicks <= 0) {
          if (this.suddenDeath) this.raiseWater();
          this.beginTurn();
        }
        break;

      case 'over':
        break;
    }
  }

  /** The sea climbs, drowning anything it reaches. */
  private raiseWater(): void {
    this.waterLevel = Math.max(80, this.waterLevel - this.rules.waterRisePerTurn);
  }

  private checkGameOver(): boolean {
    const alive = this.teams.filter((t) => this.teamHealth(t) > 0);
    if (alive.length > 1) return false;

    this.phase = 'over';
    this.events.push({ kind: 'gameOver', draw: alive.length === 0 });
    this.projectiles.length = 0;
    this.airstrikes.length = 0;
    this.rope = null;
    this.torch = null;
    if (alive.length === 1) {
      this.winner = alive[0];
      this.showBanner(`${alive[0].name.toUpperCase()} WINS`, 999);
    } else {
      this.isDraw = true;
      this.showBanner('DRAW', 999);
    }
    return true;
  }
}
