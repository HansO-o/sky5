/**
 * Direct steering for NPCs (keep/exit design §0 #12, §3.6: no navmesh on the critical path; the
 * arenas are convex): seek and arrive, strafing on a ring, separation, turning at a capped rate, a
 * stuck detector that slides along whatever is in the way. Pure 2D maths on the ground plane, in
 * the game's convention: a yaw ψ looks along (−sin ψ, −cos ψ).
 */
import type { Disposer } from "../core/types";

export interface XZ {
  x: number;
  z: number;
}

/** Steering tuning (§3.6). */
export const STEER = {
  /** turn rate (rad/s) */
  turn: 8,
  /** separation radius of an agent (m): two agents keep their centres `r₁ + r₂` apart */
  separation: 0.45,
  /** separation push at full overlap (m/s) */
  push: 1.6,
  /** stuck: below this speed for `after` s while trying to move → steer sideways for `steer` s */
  stuck: { speed: 0.2, after: 0.8, steer: 0.6 },
} as const;

/** The yaw that looks along (dx, dz). */
export function yawOf(dx: number, dz: number) {
  return Math.atan2(-dx, -dz);
}

/** a − b wrapped to (−π, π]. */
export function wrapAngle(a: number) {
  return Math.atan2(Math.sin(a), Math.cos(a));
}

/** Turn `yaw` toward `want` by at most `rate`·dt. */
export function turnToward(yaw: number, want: number, rate: number, dt: number) {
  const d = wrapAngle(want - yaw);
  const step = rate * Math.max(0, dt);
  return Math.abs(d) <= step ? want : yaw + Math.sign(d) * step;
}

/** A body's velocity in its own frame: metres per second ahead and to its right. */
export function localVelocity(vx: number, vz: number, yaw: number) {
  const s = Math.sin(yaw), c = Math.cos(yaw);
  return { fwd: -vx * s - vz * c, right: vx * c - vz * s };
}

/**
 * Velocity toward `to` at `speed`, slowing over the last `slow` metres and stopping `stop` metres
 * short. `dist` is the distance left.
 */
export function seek(from: XZ, to: XZ, speed: number, stop = 0, slow = 0.6): { vx: number; vz: number; dist: number } {
  const dx = to.x - from.x, dz = to.z - from.z;
  const dist = Math.hypot(dx, dz);
  const left = dist - stop;
  if (left <= 0.02 || dist < 1e-6) return { vx: 0, vz: 0, dist };
  const v = slow > 0 ? Math.min(speed, speed * (left / slow) + 0.25) : speed;
  const k = Math.min(speed, v) / dist;
  return { vx: dx * k, vz: dz * k, dist };
}

/**
 * Strafing on a ring of `radius` around `center` (circling a foe while waiting for a turn to
 * attack): along the ring toward the agent's left (`dir` +1) or right (−1) as it faces the centre,
 * plus a pull back onto the ring.
 */
export function circleVelocity(self: XZ, center: XZ, radius: number, dir: 1 | -1, speed: number): { vx: number; vz: number } {
  let rx = self.x - center.x, rz = self.z - center.z;
  let d = Math.hypot(rx, rz);
  if (d < 1e-3) {
    rx = 1;
    rz = 0;
    d = 1;
  }
  rx /= d;
  rz /= d;
  // tangent: the radial vector turned 90°
  const tx = -rz * dir, tz = rx * dir;
  // radial correction: out when inside the ring, in when outside (at most the strafing speed)
  const err = radius - d;
  const radial = Math.max(-speed, Math.min(speed, err * 1.5));
  const vx = tx * speed + rx * radial, vz = tz * speed + rz * radial;
  const len = Math.hypot(vx, vz);
  const cap = speed * 1.25;
  return len > cap ? { vx: (vx / len) * cap, vz: (vz / len) * cap } : { vx, vz };
}

/** A member of a crowd: where it is and how much room it keeps. */
export interface CrowdMember {
  readonly x: number;
  readonly z: number;
  /** separation radius (default 0.45) */
  readonly r?: number;
}

/**
 * Separation (§3.6, r 0.45): a push away from every neighbour closer than the two radii, growing
 * with the overlap (m/s, at most `push` per neighbour).
 */
export function separation(self: XZ, r: number, others: Iterable<CrowdMember>, push: number = STEER.push): { vx: number; vz: number } {
  let vx = 0, vz = 0;
  for (const o of others) {
    const min = r + (o.r ?? STEER.separation);
    const dx = self.x - o.x, dz = self.z - o.z;
    const d = Math.hypot(dx, dz);
    if (d >= min) continue;
    // on top of each other: push along an arbitrary but stable axis
    const ux = d > 1e-4 ? dx / d : 1, uz = d > 1e-4 ? dz / d : 0;
    const k = push * (1 - d / min);
    vx += ux * k;
    vz += uz * k;
  }
  return { vx, vz };
}

/**
 * The stuck detector (§3.6): trying to move but slower than 0.2 m/s for 0.8 s → steer sideways for
 * 0.6 s (alternating sides each time). `stuckFor` counts how long it has been stuck in a row (the
 * companion's 4 s catch-up).
 */
export class StuckDetector {
  /** seconds below the speed while trying to move */
  stuckFor = 0;
  private slow = 0;
  private steering = 0;
  private sideNext: 1 | -1 = 1;
  side: 0 | 1 | -1 = 0;

  constructor(private o: { speed: number; after: number; steer: number } = STEER.stuck) {}

  /** One step: `wanted` is the speed asked for, `actual` the speed achieved. Returns the side to slide (0: none). */
  update(dt: number, wanted: number, actual: number): 0 | 1 | -1 {
    if (this.steering > 0) {
      this.steering -= dt;
      if (this.steering <= 0) this.side = 0;
    }
    if (wanted > this.o.speed * 1.5 && actual < this.o.speed) {
      this.slow += dt;
      this.stuckFor += dt;
      if (this.slow >= this.o.after && this.steering <= 0) {
        this.slow = 0;
        this.steering = this.o.steer;
        this.side = this.sideNext;
        this.sideNext = this.sideNext === 1 ? -1 : 1;
      }
    } else {
      this.slow = 0;
      if (wanted <= this.o.speed * 1.5 || actual >= this.o.speed * 2) this.stuckFor = 0;
    }
    return this.side;
  }

  reset() {
    this.slow = 0;
    this.steering = 0;
    this.stuckFor = 0;
    this.side = 0;
  }
}

/** (vx, vz) turned 90° toward `side` (+1 left of the travel direction, −1 right). */
export function sidestep(vx: number, vz: number, side: 1 | -1) {
  // with forward f, right is (−f.z, f.x) and left (f.z, −f.x)
  return side === 1 ? { vx: vz, vz: -vx } : { vx: -vz, vz: vx };
}

/**
 * Everyone who keeps their distance (NPC agents, the player): a flat list, small enough to scan.
 * `near(self, r)` gives the members within `r` of a point (excluding `self`).
 */
export class Crowd {
  private members = new Set<CrowdMember>();

  add(m: CrowdMember): Disposer {
    this.members.add(m);
    return () => {
      this.members.delete(m);
    };
  }

  *near(self: CrowdMember | null, at: XZ, r: number): Iterable<CrowdMember> {
    for (const m of this.members) {
      if (m === self) continue;
      if (Math.abs(m.x - at.x) > r || Math.abs(m.z - at.z) > r) continue;
      yield m;
    }
  }

  get size() {
    return this.members.size;
  }

  clear() {
    this.members.clear();
  }
}
