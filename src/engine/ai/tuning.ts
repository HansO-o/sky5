/**
 * AI behaviour tuning (keep/exit design §3.6, §6.3, §7): movement speeds and distances of the
 * fighting states, alerts, tokens, creatures and the wolf's leash. Speeds in m/s, distances in m,
 * times in s. Values marked "tune" are first guesses to adjust in the arena (`?debug&arena`).
 */
export const AI = {
  /** brains think this often (Hz), at most this many per frame */
  hz: 10,
  maxPerFrame: 12,
  /** humanoid approach: jog to 3.5 m, then walk in to 1.6 m to strike */
  approach: { jog: 3.0, jogUntil: 3.5, walk: 1.4, close: 1.6 },
  /** waiting for a turn (a token): strafe on a 3–4.5 m ring, changing sides every 1.8–3.5 s (tune) */
  circle: { speed: 0.9, ring: [3, 4.5] as readonly [number, number], flip: [1.8, 3.5] as readonly [number, number] },
  /** the alert: a shout alerts allies of the faction within 15 m; a beat to react (tune) */
  alert: { radius: 15, react: [0.4, 0.7] as readonly [number, number] },
  /** tokens are re-evaluated twice a second */
  tokens: { every: 0.5 },
  /** suspicious: walk to the noise, look around (tune) */
  investigate: { speed: 1.2, stop: 1.2, look: 3, giveUp: 12 },
  /** back to the post (tune) */
  post: { speed: 1.4, tolerance: 0.6 },
  /** recovery clips of humans */
  recoverRate: 1.2,
  /** the target choice: a held target is kept unless another is this much nearer (tune) */
  target: { sticky: 1.5, fullTokens: 3, lastHit: 2.5, lastHitFor: 5, every: 0.5 },
  /** archers aim at the chest; the arrow lands if the target is still within this of where it was aimed (tune) */
  ranged: { tolerance: 0.9 },
  /** death: ragdolls at once at most (the rest play a death clip) */
  ragdolls: 2,
  /** creatures (§6.3): circle 3–5 m for 1.5–3 s, back off 1.5 m after a strike */
  creature: {
    circle: [3, 5] as readonly [number, number],
    circleFor: [1.5, 3] as readonly [number, number],
    backoff: 1.5,
    /** backing off: the walk clip at speedRatio −1 (native 2.6 m/s) */
    backoffSpeed: 2.6,
    /** small spiders back off this long from within this of the companion's torch */
    fear: { r: 2, seconds: 1 },
    /** a strike lands from this far: the attack's reach + the target's radius − `inset` */
    inset: 0.3,
    /** a leashed creature without senses turns on a foe this close (inside its leash) again (tune) */
    aggro: 6,
  },
  /** the wolf (§6.3): back asleep 20 s after being leashed home; 30 % of its attacks go to the companion */
  beast: { sleepAfter: 20, switchToCompanion: 0.3, homeStop: 0.8, stand: 1.0 },
} as const;

/** A random number in [a, b) from `random` (0..1). */
export function between(r: readonly [number, number], random: () => number = Math.random) {
  return r[0] + (r[1] - r[0]) * random();
}
