/**
 * Combat tuning (keep/exit design §7–§8): the player's weapons and stats, guards, enemy archetypes,
 * creatures and companions, as plain data. Clip names are the UAL humanoid clips (and the
 * creatures' logical clips); content picks archetypes by id and gives them names and models.
 * Values marked "tune" are first guesses to adjust in the arena.
 */
import type { AttackDef, GuardDef, SpecialDef, WeaponDef } from "./weapons";

// ---------------------------------------------------------------------------------------------
// Feedback and rules shared by everyone

/** Game-time freeze (s) when a blow lands on or from the player. */
export const HIT_STOP = { light: 0.05, heavy: 0.08, parry: 0.09 } as const;

/** Camera shake (amplitude, seconds) for blows involving the player. */
export const SHAKE = { taken: [0.012, 0.25], takenHeavy: [0.022, 0.35], dealtHeavy: [0.008, 0.2], guardBreak: [0.018, 0.3] } as const;

/** Raising a guard and parrying (§8 Block / Parry). */
export const GUARD = {
  /** the guard is up this long after the block was pressed (s) */
  raise: 0.12,
  /** a blow landing this soon after the press is parried (s) */
  parry: 0.18,
  /**
   * a press this soon after the previous one that did not parry can't parry (s): tapping block
   * doesn't keep the window open (tune)
   */
  parryLockout: 0.4,
  /** the parried attacker staggers */
  parryStagger: { seconds: 1.1, clip: "Hit_Head" },
  /** the parrier's next hit within `seconds` deals ×`mul` */
  riposte: { seconds: 1.1, mul: 1.5 },
  /**
   * a heavy against a raised guard: the guard breaks and this fraction of the damage goes through;
   * the target reels with the shield break, or `weaponClip` when it guarded with a weapon
   */
  heavyBreak: { seconds: 1.07, clip: "Idle_Shield_Break", weaponClip: "Hit_Chest", through: 0.5 },
  /** stamina ran out under a blow: the guard breaks and the rest of the damage applies */
  staminaBreak: { seconds: 0.8, clip: "Hit_Chest" },
} as const;

/** Blocking with the weapon or a shield (damage taken / stamina cost as fractions of the raw damage). */
export const GUARDS: Record<"weapon" | "shield", GuardDef> = {
  weapon: { damage: 0.3, stamina: 0.8, arc: 70, ranged: { damage: 0.5, stamina: 0.8 } },
  shield: { damage: 0.1, stamina: 0.5, arc: 70, ranged: { damage: 0, stamina: 0.2 }, shield: true },
};

/** Sneak attacks (§8): from within ±`arc`° of the target's back. */
export const BACKSTAB = { arc: 60, asleep: 2, suspicious: 2, clip: "Death02" } as const;

/** Hit reactions (§3.6): poise broken, killed by a heavy. */
export const STAGGER = {
  humanoid: { seconds: 0.9 },
  /** creatures: a procedural push and wobble instead of a clip */
  creature: { seconds: 0.6, push: 0.6, wobble: 0.3 },
  knockdown: { clip: "Hit_Knockback", rise: "LayToIdle", seconds: 1.6 },
  deaths: ["Death01", "Death02"],
} as const;

// ---------------------------------------------------------------------------------------------
// The player

export const PLAYER = {
  hp: 100,
  /** the forest-deer charm */
  charmHp: 15,
  /** out-of-combat regeneration: HP/s after `regenDelay` s without damage */
  regen: 4,
  regenDelay: 6,
  stamina: 100,
  staminaRegen: 24,
  staminaDelay: 0.8,
  blockRegen: 12,
  poise: 50,
  poiseDelay: 2,
  /** poise broken */
  stagger: { clip: "Hit_Stomach", seconds: 0.5 },
  /** damage multipliers of the two leather armours (rebel offence kit, imperial defence kit) */
  armour: { rebel: 0.85, imperial: 0.8 },
  radius: 0.35,
  /** at most this many enemies attack the player at once */
  tokens: 2,
  /** the next light is buffered from this fraction of the clip; movement while attacking */
  chain: { buffer: 0.4, move: 0.3 },
  /** hold the attack this long for a heavy (s) */
  heavyHold: 0.3,
  block: { clip: "Sword_Block", freezeAt: 0.4, shieldClip: "Idle_Shield_Loop", speed: 1.6 },
  potion: { heal: 50, seconds: 1.5, clip: "Consume", length: 1.333, move: 0.5, cooldown: 3 },
  /**
   * getting up after a knockdown (`STAGGER.knockdown.rise`), at this rate; `seconds` stands in for
   * the clip's length when the body can't tell it (tune)
   */
  rise: { speed: 1.2, seconds: 1.6 },
  /** soft lock: swings turn toward the nearest enemy this close and this far off the aim (m, degrees) */
  aim: { range: 3.5, arc: 50 },
  deaths: ["Death01", "Death02"],
  /** stamina below this: the stamina tip */
  lowStamina: 25,
} as const;

/** The armed third-person camera: shoulder offset (the rig's) and boom length while a weapon is drawn. */
export const ARMED_CAMERA = { shoulder: 0.45, distance: 2.6 } as const;

const swing = (o: Omit<AttackDef, "arc" | "reach"> & Partial<Pick<AttackDef, "arc" | "reach">>): AttackDef => ({ reach: 1.8, arc: 55, ...o });

/** The sword set (UAL2 Sword_*), scaled for a weapon. */
function chain(id: string, w: { reach: number; arc: number; speed: number; light: [number, number]; heavy: number; poise: [number, number]; stamina: [number, number] }): WeaponDef {
  const [l, c] = w.light;
  const common = { reach: w.reach, arc: w.arc, speed: w.speed };
  return {
    id,
    light: [
      swing({ id: `${id}_light_a`, clip: "Sword_Light_A", length: 0.3667, active: [0.13, 0.3], damage: l, poiseDamage: w.poise[0], stamina: w.stamina[0], ...common, recover: { clip: "Sword_Light_A_Rec", length: 0.5, cancel: 0.15 } }),
      swing({ id: `${id}_light_b`, clip: "Sword_Light_B", length: 0.4333, active: [0.2, 0.27], damage: l, poiseDamage: w.poise[0], stamina: w.stamina[0], ...common, recover: { clip: "Sword_Light_B_Rec", length: 0.5667, cancel: 0.15 } }),
      // the C → C_Rec join pops in the source pose: cross-fade it over 0.25 s (Appendix, chain joins)
      swing({ id: `${id}_light_c`, clip: "Sword_Light_C", length: 0.8667, active: [0.42, 0.5], damage: c, poiseDamage: w.poise[0], stamina: w.stamina[0], ...common, recover: { clip: "SwordLight_C_Rec", length: 0.7, cancel: 0.15, blend: 0.25 } }),
    ],
    // window ≈ 0.51–0.62 s of wall time at 0.85×
    heavy: swing({ id: `${id}_heavy`, clip: "Sword_Heavy_A", length: 0.7333, active: [0.43, 0.53], damage: w.heavy, poiseDamage: w.poise[1], stamina: w.stamina[1], ...common, speed: w.speed * 0.85, heavy: true, guardBreak: true, hitStop: HIT_STOP.heavy, recover: { clip: "Sword_Heavy_A_Rec", length: 1, cancel: 0.4 } }),
    guard: GUARDS.weapon,
  };
}

export type PlayerWeaponId = "sword" | "axe" | "fists";

export const PLAYER_WEAPONS: Record<PlayerWeaponId, WeaponDef> = {
  /** iron sword (FPM Sword_Bronze, retinted) */
  sword: chain("sword", { reach: 1.8, arc: 55, speed: 1, light: [14, 21], heavy: 30, poise: [15, 50], stamina: [8, 24] }),
  /** war axe: the sword clips at 0.9× */
  axe: chain("axe", { reach: 1.6, arc: 45, speed: 0.9, light: [16, 24], heavy: 36, poise: [20, 65], stamina: [9, 26] }),
  /** bare fists (fallback only): jab → cross, kick for a heavy. Windows: tune */
  fists: {
    id: "fists",
    light: [
      swing({ id: "fists_jab", clip: "Punch_Jab", length: 0.8667, active: [0.22, 0.32], damage: 4, poiseDamage: 5, stamina: 5, reach: 1.1, arc: 40 }),
      swing({ id: "fists_cross", clip: "Punch_Cross", length: 1, active: [0.28, 0.38], damage: 6, poiseDamage: 5, stamina: 5, reach: 1.1, arc: 40 }),
    ],
    heavy: swing({ id: "fists_kick", clip: "Kick", length: 1.1, active: [0.42, 0.55], damage: 8, poiseDamage: 15, stamina: 15, reach: 1.2, arc: 40, heavy: true, guardBreak: true, hitStop: HIT_STOP.heavy }),
    guard: GUARDS.weapon,
  },
};

// ---------------------------------------------------------------------------------------------
// Enemies

/** Human wind-ups play at this rate up to the strike, with a glint and a grunt (§8). */
export const HUMAN_WINDUP = 0.6;
/** Recovery clips of humans play at 1.2× (§3.6). */
const REC = 1.2;

type Weapon = "sword" | "axe";
const REACH: Record<Weapon, number> = { sword: 1.8, axe: 1.6 };

const regularA = (w: Weapon, damage: number, poiseDamage = 15): AttackDef =>
  swing({ id: `${w}_regular_a`, clip: "Sword_Regular_A", length: 0.4333, active: [0.24, 0.31], windupRate: HUMAN_WINDUP, damage, poiseDamage, stamina: 0, reach: REACH[w], arc: 50, recover: { clip: "Sword_Regular_A_Rec", length: 0.9667, cancel: 0.3, speed: REC } });
const regularB = (w: Weapon, damage: number, poiseDamage = 15): AttackDef =>
  swing({ id: `${w}_regular_b`, clip: "Sword_Regular_B", length: 0.5333, active: [0.27, 0.34], windupRate: HUMAN_WINDUP, damage, poiseDamage, stamina: 0, reach: REACH[w], arc: 50, recover: { clip: "Sword_Regular_B_Rec", length: 1.0333, cancel: 0.3, speed: REC } });
const heavyA = (w: Weapon, damage: number, poiseDamage = 40): AttackDef =>
  swing({ id: `${w}_heavy`, clip: "Sword_Heavy_A", length: 0.7333, active: [0.45, 0.53], windupRate: HUMAN_WINDUP, damage, poiseDamage, stamina: 0, reach: REACH[w], arc: 55, heavy: true, hitStop: HIT_STOP.heavy, recover: { clip: "Sword_Heavy_A_Rec", length: 1, cancel: 0.4, speed: REC } });
/** `Sword_Dash_RM` from 4–6 m (root motion carries ~2.8 m by the strike); parryable */
const lunge = (damage: number): SpecialDef => ({
  ...swing({ id: "axe_lunge", clip: "Sword_Dash_RM", length: 1.5667, active: [0.2, 0.42], windupRate: HUMAN_WINDUP, damage, poiseDamage: 25, stamina: 0, reach: 1.6, arc: 50, travel: 3.7 }),
  range: [4, 6],
  cooldown: 6,
});
const jab = (damage: number): AttackDef => swing({ id: "jab", clip: "Punch_Jab", length: 0.8667, active: [0.22, 0.32], windupRate: HUMAN_WINDUP, damage, poiseDamage: 8, stamina: 0, reach: 1.2, arc: 45 });
const cross = (damage: number): AttackDef => swing({ id: "cross", clip: "Punch_Cross", length: 1, active: [0.28, 0.38], windupRate: HUMAN_WINDUP, damage, poiseDamage: 8, stamina: 0, reach: 1.2, arc: 45 });

/** An arrow (any archer): 35 m/s, drawn for 1.2 s with a glint at 0.6 s; a shield stops it. */
export const ARROW = { ...swing({ id: "arrow", clip: "Bow_Shoot", length: 0.6, active: [0, 0], damage: 10, poiseDamage: 10, stamina: 0, reach: 35, arc: 5, ranged: true, unparryable: true }), speed: 35, draw: 1.2, glint: 0.6 } as const;

export interface Archetype {
  id: string;
  kind: "humanoid" | "creature";
  hp: number;
  poise: number;
  /** the light combo, in order */
  light: readonly AttackDef[];
  heavy?: AttackDef;
  /** chance a turn is a heavy */
  heavyChance?: number;
  /** or every Nth attack is a heavy */
  heavyEvery?: number;
  /** a move from a distance or at close range (lunge, kick, pounce) */
  special?: SpecialDef;
  /** ranged attack (archers) and the melee fallback within `melee` m */
  ranged?: typeof ARROW;
  melee?: number;
  /** reactive block chance */
  block: number;
  /** seconds between attacks */
  interval: readonly [number, number];
  /**
   * A passive shield (with `block: 0`: it never raises a guard). It takes this fraction of the
   * player's lights outright (0 damage, the player's chain interrupted), and a heavy from the front
   * always breaks it: half the damage goes through (`GUARD.heavyBreak.through`) and it reels with
   * `Idle_Shield_Break`, whether or not a guard was raised (§8 "heavies break it"). Only the
   * player's blows (`CombatSystem.focus`) meet it; companions' swings land as usual.
   */
  absorbLights?: number;
  /** carries a shield (guard multipliers, the shield break) */
  shield?: boolean;
  weapon?: Weapon | "dagger" | "club" | "bow";
  /** gives up at this fraction of HP */
  surrenderAt?: number;
  /** keeps this far from its target (m) */
  kite?: readonly [number, number];
  /** only heavies and parries stagger it */
  staggerBy?: "any" | "heavy";
  /** body radius for hit tests (m) */
  radius: number;
  /** movement (m/s): approach, and a charge where it has one */
  speed?: { move: number; run?: number };
  /** model scale (creatures) */
  scale?: number;
}

const human = (o: Omit<Archetype, "kind" | "radius"> & { radius?: number }): Archetype => ({ kind: "humanoid", radius: 0.35, ...o });

export type ArchetypeId =
  | "shieldSoldier"
  | "guardCaptain"
  | "soldier"
  | "axeman"
  | "axeLeader"
  | "interrogator"
  | "assistant"
  | "jailer"
  | "archer"
  | "smallSpider"
  | "giantSpider"
  | "wolf";

export const ARCHETYPES: Record<ArchetypeId, Archetype> = {
  /**
   * imperial shield soldier (sword + kite): its passive shield takes 45 % of the player's lights;
   * a heavy from the front always breaks it for 50 % of the damage (see `absorbLights`)
   */
  shieldSoldier: human({ id: "shieldSoldier", hp: 70, poise: 40, light: [regularA("sword", 10), regularB("sword", 10)], heavy: heavyA("sword", 18), heavyChance: 0.25, block: 0, absorbLights: 0.45, shield: true, weapon: "sword", interval: [1.8, 2.6] }),
  /** imperial guard captain (sword + kite): a heavy every third attack */
  guardCaptain: human({ id: "guardCaptain", hp: 90, poise: 55, light: [regularA("sword", 12), regularB("sword", 12)], heavy: heavyA("sword", 22), heavyEvery: 3, block: 0.5, shield: true, weapon: "sword", interval: [1.8, 2.4] }),
  /** imperial soldier (sword) */
  soldier: human({ id: "soldier", hp: 60, poise: 35, light: [regularA("sword", 10), regularB("sword", 10)], heavy: heavyA("sword", 18), heavyChance: 0.2, block: 0.2, weapon: "sword", interval: [1.6, 2.4] }),
  /** rebel axeman (axe): 12 + 12 combo and the lunge (teaches parry and punish) */
  axeman: human({ id: "axeman", hp: 65, poise: 35, light: [regularA("axe", 12), regularB("axe", 12)], special: lunge(16), block: 0.1, weapon: "axe", interval: [1.4, 2.0] }),
  /** rebel leader (axe) */
  axeLeader: human({ id: "axeLeader", hp: 85, poise: 50, light: [regularA("axe", 13), regularB("axe", 13)], heavy: heavyA("axe", 24), heavyChance: 0.25, special: lunge(16), block: 0.15, weapon: "axe", interval: [1.5, 2.1] }),
  /** interrogator (dagger): fast jab-cross, an unparryable kick with 1.5 m knockback; kites at 2–3 m */
  interrogator: human({
    id: "interrogator",
    hp: 75,
    poise: 30,
    light: [jab(7), cross(7)],
    special: { ...swing({ id: "kick", clip: "Kick", length: 1.1, active: [0.42, 0.55], windupRate: HUMAN_WINDUP, damage: 12, poiseDamage: 20, stamina: 0, reach: 1.4, arc: 45, unparryable: true, knockback: 1.5 }), range: [0, 1.6], cooldown: 5 },
    block: 0,
    weapon: "dagger",
    kite: [2, 3],
    interval: [1.3, 1.9],
  }),
  /** interrogator's assistant (club): surrenders at 30 % HP */
  assistant: human({ id: "assistant", hp: 40, poise: 15, light: [swing({ id: "club", clip: "Sword_Attack", length: 1.5333, active: [0.4, 0.5], windupRate: HUMAN_WINDUP, damage: 8, poiseDamage: 10, stamina: 0, reach: 1.6, arc: 50 })], block: 0, weapon: "club", surrenderAt: 0.3, interval: [2.4, 2.4] }),
  /** jailer / rebel fugitive */
  jailer: human({ id: "jailer", hp: 55, poise: 30, light: [regularA("sword", 9), regularB("sword", 9)], heavy: heavyA("sword", 16), heavyChance: 0.2, block: 0.1, weapon: "sword", interval: [2.0, 2.0] }),
  /** archer (either faction): arrows, a knife within 4 m */
  archer: human({ id: "archer", hp: 45, poise: 15, light: [{ ...jab(6), id: "knife" }], ranged: ARROW, melee: 4, block: 0, weapon: "bow", interval: [3.0, 4.0] }),
  /** small cave spider ×2 (scale 0.55) */
  smallSpider: {
    id: "smallSpider",
    kind: "creature",
    hp: 30,
    poise: 20,
    light: [swing({ id: "spider_bite", clip: "Spider_Attack", length: 0.75, active: [0.4, 0.5], speed: 0.7, damage: 8, poiseDamage: 10, stamina: 0, reach: 1.4, arc: 50 })],
    special: { ...swing({ id: "spider_lunge", clip: "Spider_Jump", length: 0.71, active: [0.52, 0.62], damage: 10, poiseDamage: 15, stamina: 0, reach: 1.4, arc: 45 }), range: [3, 5], cooldown: 5 },
    block: 0,
    interval: [1.6, 2.2],
    speed: { move: 3.2 },
    scale: 0.55,
    radius: 0.45,
  },
  /** giant cave spider (about 2.6 m span): only heavies and parries stagger it */
  giantSpider: {
    id: "giantSpider",
    kind: "creature",
    hp: 150,
    poise: 100,
    light: [swing({ id: "giant_bite", clip: "Spider_Attack", length: 0.75, active: [0.4, 0.5], speed: 0.7, damage: 16, poiseDamage: 25, stamina: 0, reach: 2.2, arc: 55, dot: { perSecond: 2, seconds: 4 } })],
    special: { ...swing({ id: "giant_lunge", clip: "Spider_Jump", length: 0.71, active: [0.52, 0.62], damage: 20, poiseDamage: 30, stamina: 0, reach: 2.2, arc: 45 }), range: [3, 4.5], cooldown: 6 },
    block: 0,
    interval: [2.0, 2.6],
    staggerBy: "heavy",
    speed: { move: 2.6 },
    scale: 1,
    radius: 1.0,
  },
  /** great wolf (0 A.D. ×1.5): bite, and a pounce after a run (knockdown unless a shield takes it). Clip lengths: tune */
  wolf: {
    id: "wolf",
    kind: "creature",
    hp: 140,
    poise: 80,
    light: [swing({ id: "wolf_bite", clip: "Attack1", length: 1.2, active: [0.76, 0.86], speed: 1.25, damage: 18, poiseDamage: 30, stamina: 0, reach: 2.4, arc: 50 })],
    special: { ...swing({ id: "wolf_pounce", clip: "Attack2", length: 1.4, active: [0.8, 0.92], damage: 24, poiseDamage: 40, stamina: 0, reach: 2.4, arc: 50, unparryable: true, knockdown: true, heavy: true }), range: [4, 8], cooldown: 6 },
    block: 0,
    interval: [2.2, 2.8],
    speed: { move: 3.5, run: 7 },
    radius: 0.6,
  },
};

// ---------------------------------------------------------------------------------------------
// Companions (essential: down at 0 HP, kneel 6 s, rise at 50 %)

export interface CompanionTuning {
  id: string;
  hp: number;
  poise: number;
  attack: readonly AttackDef[];
  /** fraction of swings that connect */
  hitChance: number;
  interval: readonly [number, number];
  block: number;
  shield?: boolean;
  /** the companion's special (§7) */
  special: { name: string; seconds: number; cooldown: number; hpBelow: number; engagedFor?: number };
}

export const COMPANION = {
  /** at most this many enemies attack the companion at once */
  tokens: 1,
  down: { seconds: 6, rise: 0.5, clip: "Fixing_Kneeling" },
  radius: 0.35,
} as const;

export const COMPANIONS: Record<"brun" | "ivo", CompanionTuning> = {
  /** Brun: 11 per axe hit; his roar takes an enemy off the player for 6 s */
  brun: { id: "brun", hp: 200, poise: 60, attack: [regularA("axe", 11), regularB("axe", 11)], hitChance: 0.7, interval: [1.8, 2.4], block: 0.25, special: { name: "roar", seconds: 6, cooldown: 15, hpBelow: 0.35, engagedFor: 8 } },
  /** Ivo: 8 per sword hit; his shield wall steps in front of the player and blocks everything for 4 s */
  ivo: { id: "ivo", hp: 200, poise: 60, attack: [regularA("sword", 8), regularB("sword", 8)], hitChance: 0.6, interval: [2.2, 3.0], block: 0.55, shield: true, special: { name: "shieldWall", seconds: 4, cooldown: 20, hpBelow: 0.3 } },
};

// ---------------------------------------------------------------------------------------------
// Difficulty

/** E1's tutorial opening (§5.4, §7): one enemy on the player, slow wind-ups, softened blows. */
export const TUTORIAL = { seconds: 30, tokens: 1, windupRate: 0.5, damageMul: 0.8, companionMul: 0.5 } as const;

/** Adaptive difficulty after repeated deaths in one encounter (§3.5). */
export const ADAPTIVE = [
  { deaths: 2, enemyDamage: 0.75, windupRate: 0.5 },
  { deaths: 3, enemyHp: 0.85, companionDamage: 1.5 },
] as const;
