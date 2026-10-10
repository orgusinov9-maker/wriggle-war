import { TICK_HZ } from '../core/loop';

/**
 * The arsenal, split into two layers.
 *
 * `ProjectileSpec` describes a *thing in flight* - how it falls, bounces,
 * homes, splits and detonates. `WeaponSpec` describes a *menu entry* - what it
 * is called, how much of it you own, and how firing it behaves. They are
 * separate because cluster shards fly but can never be selected, and because
 * the shotgun is a menu entry with nothing in flight at all.
 */

export type WeaponId =
  | 'bazooka'
  | 'homing'
  | 'mortar'
  | 'grenade'
  | 'cluster'
  | 'banana'
  | 'holy'
  | 'shotgun'
  | 'uzi'
  | 'firepunch'
  | 'dragonball'
  | 'bat'
  | 'dynamite'
  | 'mine'
  | 'airstrike'
  | 'blowtorch'
  | 'girder'
  | 'rope'
  | 'skip';

/** How pulling the trigger is resolved. */
export type FireMode =
  | 'ballistic'
  | 'hitscan'
  | 'melee'
  | 'placed'
  | 'airstrike'
  | 'torch'
  | 'girder'
  | 'rope'
  | 'utility';

/** Menu grouping, mirroring the classic weapon panel rows. */
export type WeaponGroup = 'rockets' | 'thrown' | 'guns' | 'melee' | 'placed' | 'special';

export type Sprite =
  | 'rocket'
  | 'grenade'
  | 'cluster'
  | 'shard'
  | 'banana'
  | 'holy'
  | 'dynamite'
  | 'mine'
  | 'fire'
  | 'bomb';

export interface ProjectileSpec {
  readonly sprite: Sprite;
  /** Muzzle speed at full charge, px/tick. */
  readonly maxSpeed: number;
  /** 0 = wind does nothing, 1 = full drift. */
  readonly windFactor: number;
  /** Multiplier on gravity; 0 makes a shot fly dead straight. */
  readonly gravityScale: number;
  readonly bouncy: boolean;
  /** Bounce energy retained, only read when `bouncy`. */
  readonly restitution: number;
  /** Ticks to detonation, or -1 for impact fusing. */
  readonly fuseTicks: number;
  /** Steers toward the chosen target once `homingDelay` ticks have passed. */
  readonly homing: boolean;
  readonly homingDelay: number;
  readonly blastRadius: number;
  readonly maxDamage: number;
  readonly blastPower: number;
  /** Comes to rest on the ground instead of rolling forever. */
  readonly settles: boolean;
  /** Detonates when a worm comes this close; 0 disables proximity fusing. */
  readonly proximity: number;
  /** Ticks before proximity fusing goes live, so the placer can walk away. */
  readonly armDelay: number;
  /** Ticks between the trigger and the bang, once triggered. */
  readonly triggerDelay: number;
  /** Shards thrown on detonation; 0 for a plain warhead. */
  readonly splitCount: number;
  readonly splitSpeed: number;
  /** Deferred so a munition can, in principle, refer to itself. */
  readonly split?: () => ProjectileSpec;
}

const BASE: ProjectileSpec = {
  sprite: 'rocket',
  maxSpeed: 9,
  windFactor: 1,
  gravityScale: 1,
  bouncy: false,
  restitution: 0.42,
  fuseTicks: -1,
  homing: false,
  homingDelay: 0,
  blastRadius: 31,
  maxDamage: 50,
  blastPower: 2.1,
  settles: false,
  proximity: 0,
  armDelay: 0,
  triggerDelay: 0,
  splitCount: 0,
  splitSpeed: 2.6,
};

function proj(over: Partial<ProjectileSpec>): ProjectileSpec {
  return { ...BASE, ...over };
}

/** Shards of a cluster bomb: small, bouncy, impact fused. */
const CLUSTER_SHARD = proj({
  sprite: 'shard',
  windFactor: 0.35,
  bouncy: false,
  blastRadius: 19,
  maxDamage: 26,
  blastPower: 1.3,
});

/** Banana children are near-full grenades in their own right. */
const BANANA_SHARD = proj({
  sprite: 'banana',
  windFactor: 0.3,
  bouncy: true,
  restitution: 0.46,
  fuseTicks: Math.round(TICK_HZ * 1.6),
  blastRadius: 33,
  maxDamage: 46,
  blastPower: 2.2,
});

const MORTAR_SHARD = proj({
  sprite: 'shard',
  windFactor: 0.3,
  blastRadius: 17,
  maxDamage: 22,
  blastPower: 1.2,
});

export const PROJECTILES = {
  bazooka: proj({ sprite: 'rocket' }),
  homing: proj({
    sprite: 'rocket',
    maxSpeed: 8,
    windFactor: 0.25,
    homing: true,
    homingDelay: Math.round(TICK_HZ * 0.9),
    blastRadius: 30,
    maxDamage: 45,
  }),
  mortar: proj({
    sprite: 'rocket',
    maxSpeed: 8.2,
    windFactor: 0.6,
    blastRadius: 18,
    maxDamage: 25,
    blastPower: 1.3,
    splitCount: 3,
    splitSpeed: 2.2,
    split: () => MORTAR_SHARD,
  }),
  grenade: proj({
    sprite: 'grenade',
    maxSpeed: 7.4,
    windFactor: 0,
    bouncy: true,
    restitution: 0.42,
    fuseTicks: Math.round(TICK_HZ * 3),
    blastRadius: 34,
    maxDamage: 50,
    blastPower: 2.3,
  }),
  cluster: proj({
    sprite: 'cluster',
    maxSpeed: 7.4,
    windFactor: 0,
    bouncy: true,
    restitution: 0.4,
    fuseTicks: Math.round(TICK_HZ * 3),
    blastRadius: 22,
    maxDamage: 25,
    blastPower: 1.5,
    splitCount: 5,
    splitSpeed: 2.8,
    split: () => CLUSTER_SHARD,
  }),
  banana: proj({
    sprite: 'banana',
    maxSpeed: 7.4,
    windFactor: 0,
    bouncy: true,
    restitution: 0.45,
    fuseTicks: Math.round(TICK_HZ * 3),
    blastRadius: 30,
    maxDamage: 40,
    blastPower: 2,
    splitCount: 5,
    splitSpeed: 3.2,
    split: () => BANANA_SHARD,
  }),
  holy: proj({
    sprite: 'holy',
    maxSpeed: 7.4,
    windFactor: 0,
    bouncy: true,
    restitution: 0.32,
    fuseTicks: Math.round(TICK_HZ * 5),
    blastRadius: 75,
    maxDamage: 125,
    blastPower: 4.2,
  }),
  dragonball: proj({
    sprite: 'fire',
    maxSpeed: 6.5,
    windFactor: 0,
    gravityScale: 0,
    blastRadius: 26,
    maxDamage: 40,
    blastPower: 3.4,
  }),
  dynamite: proj({
    sprite: 'dynamite',
    maxSpeed: 0,
    windFactor: 0,
    bouncy: true,
    restitution: 0.1,
    settles: true,
    fuseTicks: Math.round(TICK_HZ * 5),
    blastRadius: 52,
    maxDamage: 75,
    blastPower: 3.1,
  }),
  /** One of the five bombs an air strike drops. */
  airBomb: proj({
    sprite: 'bomb',
    windFactor: 0.4,
    blastRadius: 26,
    maxDamage: 36,
    blastPower: 1.7,
  }),
  mine: proj({
    sprite: 'mine',
    maxSpeed: 0,
    windFactor: 0,
    bouncy: true,
    restitution: 0.15,
    settles: true,
    proximity: 24,
    armDelay: Math.round(TICK_HZ * 1.2),
    triggerDelay: Math.round(TICK_HZ * 0.9),
    blastRadius: 34,
    maxDamage: 50,
    blastPower: 2.6,
  }),
} as const;

export interface WeaponSpec {
  readonly id: WeaponId;
  readonly name: string;
  readonly group: WeaponGroup;
  readonly mode: FireMode;
  /** Starting rounds per team; -1 means unlimited. */
  readonly ammo: number;
  /** Trigger pulls allowed in one turn - the shotgun gets two. */
  readonly shots: number;
  /** Whether the shot is held at a player-chosen fuse length. */
  readonly adjustableFuse: boolean;
  /** Player must pick a spot on the map before firing. */
  readonly needsTarget: boolean;
  /** Charged by holding fire; false for weapons that go off at once. */
  readonly charged: boolean;
  readonly projectile?: ProjectileSpec;
  /** Hitscan: pellets per trigger pull, damage each, spread in degrees. */
  readonly hitscan?: { pellets: number; damage: number; spreadDeg: number; holeRadius: number; intervalTicks: number };
  /** Melee: reach in px, damage, and the shove it delivers. */
  readonly melee?: { reach: number; damage: number; pushX: number; pushY: number; selfLift: number };
  /**
   * Blowtorch: how long it burns, how fast the worm tunnels (px/tick), the
   * bore of the tunnel, and what it does to a worm in its path.
   */
  readonly torch?: { ticks: number; speed: number; bore: number; damage: number; push: number };
  /** Single letter drawn on the menu tile - placeholder until real icons land. */
  readonly glyph: string;
}

function w(spec: Partial<WeaponSpec> & Pick<WeaponSpec, 'id' | 'name' | 'group' | 'mode' | 'glyph'>): WeaponSpec {
  return {
    ammo: -1,
    shots: 1,
    adjustableFuse: false,
    needsTarget: false,
    charged: true,
    ...spec,
  };
}

/**
 * The order here is the order of the weapon menu, and the order the number
 * keys cycle through within a group.
 */
export const WEAPONS: Record<WeaponId, WeaponSpec> = {
  bazooka: w({ id: 'bazooka', name: 'Bazooka', group: 'rockets', mode: 'ballistic', glyph: 'B', projectile: PROJECTILES.bazooka }),
  homing: w({ id: 'homing', name: 'Homing Missile', group: 'rockets', mode: 'ballistic', glyph: 'H', ammo: 2, needsTarget: true, projectile: PROJECTILES.homing }),
  mortar: w({ id: 'mortar', name: 'Mortar', group: 'rockets', mode: 'ballistic', glyph: 'M', ammo: 2, projectile: PROJECTILES.mortar }),

  grenade: w({ id: 'grenade', name: 'Grenade', group: 'thrown', mode: 'ballistic', glyph: 'G', adjustableFuse: true, projectile: PROJECTILES.grenade }),
  cluster: w({ id: 'cluster', name: 'Cluster Bomb', group: 'thrown', mode: 'ballistic', glyph: 'C', ammo: 3, adjustableFuse: true, projectile: PROJECTILES.cluster }),
  banana: w({ id: 'banana', name: 'Fruit Bomb', group: 'thrown', mode: 'ballistic', glyph: 'N', ammo: 1, adjustableFuse: true, projectile: PROJECTILES.banana }),
  holy: w({ id: 'holy', name: 'Blessed Grenade', group: 'thrown', mode: 'ballistic', glyph: 'X', ammo: 1, projectile: PROJECTILES.holy }),

  shotgun: w({
    id: 'shotgun', name: 'Shotgun', group: 'guns', mode: 'hitscan', glyph: 'S',
    shots: 2, charged: false,
    hitscan: { pellets: 1, damage: 25, spreadDeg: 0, holeRadius: 12, intervalTicks: 0 },
  }),
  uzi: w({
    id: 'uzi', name: 'Uzi', group: 'guns', mode: 'hitscan', glyph: 'U', ammo: 2, charged: false,
    hitscan: { pellets: 12, damage: 5, spreadDeg: 7, holeRadius: 4, intervalTicks: 3 },
  }),

  firepunch: w({
    id: 'firepunch', name: 'Flame Fist', group: 'melee', mode: 'melee', glyph: 'F', ammo: 2, charged: false,
    melee: { reach: 22, damage: 30, pushX: 1.6, pushY: -5.6, selfLift: -5.2 },
  }),
  bat: w({
    id: 'bat', name: 'Baseball Bat', group: 'melee', mode: 'melee', glyph: 'T', ammo: 2, charged: false,
    melee: { reach: 26, damage: 30, pushX: 7.2, pushY: -4.2, selfLift: 0 },
  }),
  dragonball: w({
    id: 'dragonball', name: 'Dragon Strike', group: 'melee', mode: 'ballistic', glyph: 'D', ammo: 1,
    projectile: PROJECTILES.dragonball,
  }),

  dynamite: w({ id: 'dynamite', name: 'Dynamite', group: 'placed', mode: 'placed', glyph: 'Y', ammo: 1, charged: false, projectile: PROJECTILES.dynamite }),
  mine: w({ id: 'mine', name: 'Mine', group: 'placed', mode: 'placed', glyph: 'O', ammo: 2, charged: false, projectile: PROJECTILES.mine }),

  airstrike: w({ id: 'airstrike', name: 'Air Strike', group: 'special', mode: 'airstrike', glyph: 'A', ammo: 1, charged: false, needsTarget: true, projectile: PROJECTILES.airBomb }),
  blowtorch: w({
    id: 'blowtorch', name: 'Blowtorch', group: 'special', mode: 'torch', glyph: 'W', ammo: 1, charged: false,
    torch: { ticks: Math.round(TICK_HZ * 5), speed: 0.9, bore: 9, damage: 15, push: 2.4 },
  }),
  girder: w({ id: 'girder', name: 'Girder', group: 'special', mode: 'girder', glyph: '=', ammo: 2, charged: false }),
  // Unlimited and turn-free, as in a standard scheme: roping is movement, not an attack.
  rope: w({ id: 'rope', name: 'Ninja Rope', group: 'special', mode: 'rope', glyph: 'R', charged: false }),
  skip: w({ id: 'skip', name: 'Pass Turn', group: 'special', mode: 'utility', glyph: '>', charged: false }),
};

/** Menu rows, in panel order. */
export const WEAPON_GROUPS: readonly { group: WeaponGroup; label: string; ids: WeaponId[] }[] = [
  { group: 'rockets', label: 'Rockets', ids: [] },
  { group: 'thrown', label: 'Thrown', ids: [] },
  { group: 'guns', label: 'Guns', ids: [] },
  { group: 'melee', label: 'Close', ids: [] },
  { group: 'placed', label: 'Placed', ids: [] },
  { group: 'special', label: 'Special', ids: [] },
].map((row) => ({
  ...row,
  ids: (Object.keys(WEAPONS) as WeaponId[]).filter((id) => WEAPONS[id].group === row.group),
})) as readonly { group: WeaponGroup; label: string; ids: WeaponId[] }[];

/** A fresh ammo ledger for one team. */
export function startingAmmo(): Record<WeaponId, number> {
  const out = {} as Record<WeaponId, number>;
  for (const id of Object.keys(WEAPONS) as WeaponId[]) out[id] = WEAPONS[id].ammo;
  return out;
}
