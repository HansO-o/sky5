/**
 * Moves that close the distance as they strike (keep/exit design §8: the axeman's `Sword_Dash_RM`
 * lunge from 4–6 m, the spiders' `Spider_Jump` from 3–5 m): how far a root-motion curve carries the
 * body by a clip time, the synthetic curves used where no baked one exists (a dash of the attack's
 * `travel`, or a creature's leap sized to the distance), and from how far such a move still lands
 * inside its strike window. Pure: no Babylon, unit-tested.
 */
import { RootMotionCurve, type RootKey } from "../anim/rootMotion";
import type { AttackDef } from "../combat/weapons";

/** Lunge tuning (tune in `?debug&arena`). */
export const LUNGE = {
  /** a special rides its curve up to this speed (m/s): the dash peaks at 25 m/s, 3 m/s would gut it */
  maxSpeed: 30,
  /** a lunge is started only this far inside the distance its strike window can cover (m) */
  margin: 0.3,
  /** root motion never carries an attacker closer than this to its target's centre (m), nor into it */
  stop: 0.9,
  /** a dash without a baked curve has covered this share of its travel when the strike window ends */
  dashShare: 0.88,
  /** ... and the rest this long after (s, clip time) */
  dashTail: 0.3,
  /** a creature's leap leaves the ground at this share of its wind-up */
  liftOff: 0.55,
} as const;

const s0 = { x: 0, y: 0, z: 0, yaw: 0 };
const s1 = { x: 0, y: 0, z: 0, yaw: 0 };

/** How far forward (m, the model's +Z) `curve` has carried the body from its start by clip time `t`. */
export function carriedBy(curve: RootMotionCurve, t: number): number {
  const a = curve.sample(0, s0), b = curve.sample(t, s1);
  return b.z - a.z;
}

/**
 * A dash for an attack without a baked curve (the lunge when the sidecar is missing): still through
 * the wind-up, `travel` × 0.88 by the end of the strike window, the rest just after, the way
 * `Sword_Dash_RM` moves.
 */
export function dashCurve(def: Pick<AttackDef, "active" | "length">, travel: number): RootMotionCurve {
  const [a0, a1] = def.active;
  const end = Math.max(a1 + 1e-3, Math.min(def.length, a1 + LUNGE.dashTail));
  const keys: RootKey[] = [
    [0, 0, 0, 0, 0],
    [a0, 0, 0, 0, 0],
    [a1, 0, 0, travel * LUNGE.dashShare, 0],
    [end, 0, 0, travel, 0],
  ];
  return new RootMotionCurve(keys, def.length);
}

/**
 * A creature's leap of `travel` m: it leaves the ground partway through the wind-up and lands in
 * the middle of the strike window.
 */
export function leapCurve(def: Pick<AttackDef, "active" | "length">, travel: number): RootMotionCurve {
  const [a0, a1] = def.active;
  const lift = a0 * LUNGE.liftOff;
  const land = Math.max(lift + 1e-3, (a0 + a1) / 2);
  const keys: RootKey[] = [
    [0, 0, 0, 0, 0],
    [lift, 0, 0, 0, 0],
    [land, 0, 0, Math.max(0, travel), 0],
    [Math.max(land, def.length), 0, 0, Math.max(0, travel), 0],
  ];
  return new RootMotionCurve(keys, def.length);
}

/**
 * Where a leap should set a creature down (centre to centre): well inside its strike's reach
 * (`reachable` = the attack's reach + the target's radius), never closer than `stop`.
 */
export function landingDistance(reachable: number, stop: number) {
  return Math.max(stop, reachable - 0.6);
}

/**
 * The farthest a move may start from and still land: the strike reaches `reachable` m, and the
 * body has been carried `carried` m by the end of its strike window (less `margin` for a target
 * that steps back during the tell). A move that does not travel reaches only `reachable`.
 */
export function lungeReach(reachable: number, carried: number, margin: number = LUNGE.margin) {
  return carried > 1e-3 ? reachable + carried - margin : reachable;
}

/** The root-motion stop distance between an attacker of radius `self` and a target of radius `target`. */
export function stopDistance(self: number, target: number) {
  return Math.max(LUNGE.stop, self + target + 0.15);
}
