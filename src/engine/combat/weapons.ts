/**
 * Attack and guard definitions: plain data the combat system, the player's controller and the AI
 * read (the tuned tables are in `attacks.ts`). Times are **clip seconds** (at rate 1); a clip may
 * play its wind-up slower than its strike (`windupRate`).
 */

/** The clip played after a swing that was not chained into another one. */
export interface RecoverDef {
  clip: string;
  /** clip length (s at rate 1) */
  length: number;
  /** block (or a new attack) may cancel it after this many seconds */
  cancel: number;
  /** cross-fade into it (s; default 0.1) */
  blend?: number;
  /** playback rate (default: the attack's `speed`) */
  speed?: number;
}

export interface AttackDef {
  id: string;
  /** body clip (a humanoid's clip name, a creature's logical clip) */
  clip: string;
  /** clip length (s at rate 1) */
  length: number;
  /** the strike: hits land while the clip time is in [from, to] */
  active: readonly [number, number];
  /** clip rate from the strike on (default 1) */
  speed?: number;
  /** clip rate before the strike (enemy wind-ups play at 0.6×; default `speed`) */
  windupRate?: number;
  damage: number;
  /** poise damage */
  poiseDamage: number;
  /** stamina it costs the attacker */
  stamina: number;
  /** metres from the attacker's centre to the target's surface */
  reach: number;
  /** half-angle of the strike either side of the attacker's facing (degrees) */
  arc: number;
  /** a heavy: breaks a raised guard (half the damage goes through) */
  guardBreak?: boolean;
  /** a heavy for hit-stop, absorb and stagger rules */
  heavy?: boolean;
  /** cannot be parried (arrows, kicks, the wolf's pounce) */
  unparryable?: boolean;
  /** a projectile (blocked with the guard's `ranged` multipliers) */
  ranged?: boolean;
  /** push the target back this far (m) */
  knockback?: number;
  /** knocks the target down unless a shield takes it */
  knockdown?: boolean;
  /** damage over time on a hit that is not blocked (venom) */
  dot?: { perSecond: number; seconds: number };
  /** game-time freeze when it lands on or from the player (s; default 0.05, heavies 0.08) */
  hitStop?: number;
  /** follow-up clip when the swing is not chained */
  recover?: RecoverDef;
  /** cross-fade into the clip (s; default 0.1) */
  blend?: number;
  /** targets one swing may hit (default 1) */
  maxTargets?: number;
  /** how many metres the root motion may carry (informational; the curve is in the sidecar) */
  travel?: number;
}

/** A special move an AI uses from a distance (lunge, pounce, kick). */
export interface SpecialDef extends AttackDef {
  /** used when the target is this far away (m) */
  range: readonly [number, number];
  /** seconds before it can be used again */
  cooldown: number;
}

/** How a raised guard takes a blow. */
export interface GuardDef {
  /** fraction of the damage that gets through */
  damage: number;
  /** stamina cost as a fraction of the raw damage */
  stamina: number;
  /** half-angle in front that it covers (degrees) */
  arc: number;
  /** projectiles: damage and stamina fractions (a shield stops arrows) */
  ranged: { damage: number; stamina: number };
  /** a shield also stops knockdowns */
  shield?: boolean;
}

/** A player weapon: the light chain, the held heavy, and what blocking with it does. */
export interface WeaponDef {
  id: string;
  /** light attacks in chain order (A → B → C) */
  light: readonly AttackDef[];
  heavy: AttackDef;
  guard: GuardDef;
}
