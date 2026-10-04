/**
 * Melee hit-test math, pure and unit-tested. The game's facing convention: a yaw ψ looks along
 * forward = (−sin ψ, −cos ψ), with right = (cos ψ, −sin ψ). A strike is a horizontal sector in
 * front of the attacker (radius = reach + the target's radius, ±arc) with a height limit; a swing
 * tests it **swept** over each step's motion of both bodies, so neither a fast frame nor a fast
 * target passes through it unseen.
 */

export interface XYZ {
  x: number;
  y: number;
  z: number;
}

/** A body's feet and facing. */
export interface Pose extends XYZ {
  yaw: number;
}

/** The strike volume. */
export interface StrikeShape {
  /** metres from the attacker's centre to the target's surface */
  reach: number;
  /** the target's body radius (added to the reach) */
  radius: number;
  /** half-angle either side of the facing (radians) */
  arc: number;
  /** largest height difference between the two feet (default 1.2 m) */
  maxDy?: number;
}

export const MAX_DY = 1.2;

/** a - b wrapped to (-π, π] */
export function angleDiff(a: number, b: number) {
  const d = a - b;
  return Math.atan2(Math.sin(d), Math.cos(d));
}

/** The forward yaw looking from (x0, z0) toward (x1, z1). */
export function yawTo(x0: number, z0: number, x1: number, z1: number) {
  return Math.atan2(-(x1 - x0), -(z1 - z0));
}

/** `t` in `a`'s frame: metres to its right (r), ahead (f), and above its feet (dy). */
export function localOf(a: Pose, t: XYZ) {
  const dx = t.x - a.x, dz = t.z - a.z;
  const s = Math.sin(a.yaw), c = Math.cos(a.yaw);
  return { r: dx * c - dz * s, f: -dx * s - dz * c, dy: t.y - a.y };
}

/** Whether `t` is within `arc` (radians) of `a`'s facing (horizontally; any distance). */
export function withinArc(a: Pose, t: XYZ, arc: number) {
  const l = localOf(a, t);
  if (l.r === 0 && l.f === 0) return true;
  return Math.abs(Math.atan2(l.r, l.f)) <= arc + 1e-9;
}

/** Whether `t` stands within ±`arc` of `a`'s back (a sneak attack). */
export function behind(a: Pose, t: XYZ, arc: number) {
  const l = localOf(a, t);
  return Math.abs(Math.atan2(l.r, -l.f)) <= arc + 1e-9;
}

/** The strike test at one instant. */
export function inStrike(a: Pose, t: XYZ, s: StrikeShape) {
  const l = localOf(a, t);
  if (Math.abs(l.dy) >= (s.maxDy ?? MAX_DY)) return false;
  const R = s.reach + s.radius;
  if (l.r * l.r + l.f * l.f > R * R) return false;
  return l.r === 0 && l.f === 0 ? true : Math.abs(Math.atan2(l.r, l.f)) <= s.arc + 1e-9;
}

type Interval = [number, number];

/** Narrow `iv` to the u where `a + b·u >= 0`; false when nothing is left. */
function clipLinear(iv: Interval, a: number, b: number) {
  if (Math.abs(b) < 1e-12) return a >= -1e-12;
  const root = -a / b;
  if (b > 0) iv[0] = Math.max(iv[0], root);
  else iv[1] = Math.min(iv[1], root);
  return iv[0] <= iv[1];
}

/**
 * The first u in [0, 1] at which the point moving from (r0, f0) to (r1, f1) is inside the sector
 * of radius R and half-angle `arc` (radians) around +f; -1 when it never is. Exact for straight
 * motion: the sector is split into two convex halves, the segment clipped against each half's
 * planes and then against the disc.
 */
export function segmentInSector(r0: number, f0: number, r1: number, f1: number, R: number, arc: number, within: Interval = [0, 1]): number {
  if (R <= 0) return -1;
  const dr = r1 - r0, df = f1 - f0;
  const halves: [number, number][][] =
    arc >= Math.PI
      ? [[]]
      : [
          // right half: r >= 0 and on the forward side of the edge at +arc
          [
            [1, 0],
            [-Math.cos(arc), Math.sin(arc)],
          ],
          // left half: r <= 0 and on the forward side of the edge at -arc
          [
            [-1, 0],
            [Math.cos(arc), Math.sin(arc)],
          ],
        ];
  let best = -1;
  for (const planes of halves) {
    const iv: Interval = [within[0], within[1]];
    let ok = true;
    for (const [nr, nf] of planes) {
      // n·p(u) >= 0 with p(u) = p0 + u d
      if (!clipLinear(iv, nr * r0 + nf * f0, nr * dr + nf * df)) {
        ok = false;
        break;
      }
    }
    if (!ok) continue;
    const u = firstInDisc(r0, f0, dr, df, R, iv);
    if (u >= 0 && (best < 0 || u < best)) best = u;
  }
  return best;
}

/** The first u in `iv` with |p0 + u d| <= R, or -1. */
function firstInDisc(r0: number, f0: number, dr: number, df: number, R: number, iv: Interval) {
  const a = dr * dr + df * df;
  const b = 2 * (r0 * dr + f0 * df);
  const c = r0 * r0 + f0 * f0 - R * R;
  if (a < 1e-12) return c <= 1e-9 ? iv[0] : -1;
  const disc = b * b - 4 * a * c;
  if (disc < 0) return -1;
  const sq = Math.sqrt(disc);
  const u0 = (-b - sq) / (2 * a), u1 = (-b + sq) / (2 * a);
  const lo = Math.max(iv[0], u0), hi = Math.min(iv[1], u1);
  return lo <= hi + 1e-12 ? lo : -1;
}

/** `out` = a + (b − a)·u for poses (yaw by the short way round). */
export function lerpPose(a: Pose, b: Pose, u: number, out: Pose = { x: 0, y: 0, z: 0, yaw: 0 }): Pose {
  out.x = a.x + (b.x - a.x) * u;
  out.y = a.y + (b.y - a.y) * u;
  out.z = a.z + (b.z - a.z) * u;
  out.yaw = a.yaw + angleDiff(b.yaw, a.yaw) * u;
  return out;
}

export function lerpXYZ(a: XYZ, b: XYZ, u: number, out: XYZ = { x: 0, y: 0, z: 0 }): XYZ {
  out.x = a.x + (b.x - a.x) * u;
  out.y = a.y + (b.y - a.y) * u;
  out.z = a.z + (b.z - a.z) * u;
  return out;
}

export interface SweepOptions {
  /** sub-step so the attacker turns at most this much per piece (rad; default 0.15) */
  maxTurn?: number;
  /** and either body moves at most this far per piece (m; default 0.25) */
  maxMove?: number;
}

const tmpA0: Pose = { x: 0, y: 0, z: 0, yaw: 0 };
const tmpA1: Pose = { x: 0, y: 0, z: 0, yaw: 0 };
const tmpT0: XYZ = { x: 0, y: 0, z: 0 };
const tmpT1: XYZ = { x: 0, y: 0, z: 0 };

/**
 * Swept strike: the attacker goes from pose `a0` to `a1` and the target from `t0` to `t1` over one
 * span of time; returns the first fraction u ∈ [0, 1] of the span at which the target is in the
 * strike, or -1. The relative motion is cut into pieces (turns ≤ `maxTurn`, moves ≤ `maxMove`),
 * each tested exactly as a straight segment against the sector and the height band.
 */
export function sweptStrike(a0: Pose, a1: Pose, t0: XYZ, t1: XYZ, s: StrikeShape, o: SweepOptions = {}): number {
  const turn = Math.abs(angleDiff(a1.yaw, a0.yaw));
  const move = Math.max(Math.hypot(a1.x - a0.x, a1.z - a0.z), Math.hypot(t1.x - t0.x, t1.z - t0.z));
  const n = Math.max(1, Math.ceil(turn / (o.maxTurn ?? 0.15)), Math.ceil(move / (o.maxMove ?? 0.25)));
  const R = s.reach + s.radius;
  const maxDy = s.maxDy ?? MAX_DY;
  for (let i = 0; i < n; i++) {
    const ua = i / n, ub = (i + 1) / n;
    const pa0 = lerpPose(a0, a1, ua, tmpA0), pa1 = lerpPose(a0, a1, ub, tmpA1);
    const pt0 = lerpXYZ(t0, t1, ua, tmpT0), pt1 = lerpXYZ(t0, t1, ub, tmpT1);
    const l0 = localOf(pa0, pt0), l1 = localOf(pa1, pt1);
    // the height band, |dy(u)| < maxDy, as an interval of u
    const iv: Interval = [0, 1];
    const ddy = l1.dy - l0.dy;
    if (!clipLinear(iv, maxDy - l0.dy, -ddy) || !clipLinear(iv, maxDy + l0.dy, ddy)) continue;
    const u = segmentInSector(l0.r, l0.f, l1.r, l1.f, R, s.arc, iv);
    if (u >= 0) return ua + u * (ub - ua);
  }
  return -1;
}

// ---------------------------------------------------------------------------------------------
// Clip timing: a wind-up at one rate, the strike and the rest at another

/** Clip time after `dt` seconds from clip time `t`: `windupRate` until `strike`, `speed` after. */
export function advanceClip(t: number, dt: number, strike: number, windupRate: number, speed: number) {
  if (dt <= 0) return t;
  if (t < strike && windupRate > 0) {
    const toStrike = (strike - t) / windupRate;
    if (dt <= toStrike) return t + dt * windupRate;
    return strike + (dt - toStrike) * speed;
  }
  return t + dt * speed;
}

/** Seconds from clip time `t0` to clip time `c` (c ≥ t0), with the same two rates. */
export function clipSeconds(t0: number, c: number, strike: number, windupRate: number, speed: number) {
  if (c <= t0) return 0;
  let s = 0;
  if (t0 < strike) {
    const end = Math.min(c, strike);
    s += windupRate > 0 ? (end - t0) / windupRate : 0;
    t0 = end;
  }
  if (c > t0) s += speed > 0 ? (c - t0) / speed : 0;
  return s;
}

/** The part of clip span [t0, t1] inside the window [w0, w1] (null when they don't meet). */
export function windowOverlap(t0: number, t1: number, w0: number, w1: number): [number, number] | null {
  const lo = Math.max(t0, w0), hi = Math.min(t1, w1);
  return lo <= hi && t1 > t0 ? [lo, hi] : null;
}

// ---------------------------------------------------------------------------------------------
// Defence

export type Defence = "hit" | "parry" | "block" | "guardBreak";

export interface DefenceInput {
  /** the block button is held */
  blocking: boolean;
  /** seconds since the guard went up (the raise counts from here) */
  blockAge: number;
  /**
   * seconds since the button press that may parry (default `blockAge`). A guard raised from a
   * press made earlier (held through a stagger, a recovery) parries only what is left of the window
   * after that press; Infinity: this guard can't parry (a press during the lockout).
   */
  parryAge?: number;
  /** the attacker is within the guard's arc */
  inFront: boolean;
  /** the defender is staggered (no guard) */
  staggered: boolean;
  unparryable?: boolean;
  /** the defender can parry at all (default true; in the combat system only the player can) */
  canParry?: boolean;
  /** the blow breaks a raised guard (a heavy) */
  guardBreak?: boolean;
  /** seconds after the press a blow is parried (default 0.18) */
  parryWindow?: number;
  /** seconds after the guard went up it blocks (default 0.12) */
  raise?: number;
}

/**
 * What a guard does with a blow: parried when it lands within the parry window of the press (and
 * both the blow and the defender allow parries), blocked once the guard is up, broken by a heavy;
 * otherwise it hits. A defender that cannot parry (an AI raising its guard on a wind-up) blocks
 * from the raise on, never parries.
 */
export function defenceFor(d: DefenceInput): Defence {
  if (!d.blocking || !d.inFront || d.staggered) return "hit";
  if (d.canParry !== false && !d.unparryable && (d.parryAge ?? d.blockAge) <= (d.parryWindow ?? 0.18)) return "parry";
  if (d.blockAge < (d.raise ?? 0.12)) return "hit";
  return d.guardBreak ? "guardBreak" : "block";
}

/**
 * A blow on a raised guard: the guard takes `guard.damage` of it for `guard.stamina` of it in
 * stamina. When the stamina runs short, the part it covered is blocked, the rest gets through in
 * full, and the guard breaks.
 */
export function blockedBlow(raw: number, guard: { damage: number; stamina: number }, stamina: number) {
  const cost = raw * guard.stamina;
  if (cost <= 0) return { damage: raw * guard.damage, cost: 0, broken: false };
  const covered = Math.min(1, Math.max(0, stamina) / cost);
  const broken = covered < 1 || stamina - cost <= 0;
  return { damage: raw * covered * guard.damage + raw * (1 - covered), cost: Math.min(cost, Math.max(0, stamina)), broken };
}

/** The hit-reaction clip for a blow on `t` coming from `from` (directional; heavies knock back). */
export function hitReaction(t: Pose, from: XYZ, o: { heavy?: boolean; killed?: boolean } = {}) {
  if (o.heavy && o.killed) return "Hit_Knockback";
  const l = localOf(t, from);
  const ang = Math.atan2(l.r, l.f);
  if (Math.abs(ang) > (3 * Math.PI) / 4) return "Hit_Stomach";
  if (ang > Math.PI / 4) return "Hit_Shoulder_R";
  if (ang < -Math.PI / 4) return "Hit_Shoulder_L";
  return o.heavy ? "Hit_Chest" : Math.abs(ang) < Math.PI / 12 ? "Hit_Head" : "Hit_Chest";
}
