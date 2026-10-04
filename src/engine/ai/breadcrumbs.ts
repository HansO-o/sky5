/**
 * The companion's breadcrumb trail (keep/exit design §3.6): the leader drops a crumb every 0.5 m
 * while grounded (with its foot height; 120 kept), and the follower walks the trail, so it takes
 * the leader's way around corners and through doors without a navmesh. Pure: no Babylon.
 */
import type { XYZ } from "../combat/hit";
import type { XZ } from "./steering";

/** Following tuning (§3.6, §7). Speeds in m/s, distances in m. */
export const FOLLOW = {
  /** a crumb every `spacing` m; `keep` of them */
  spacing: 0.5,
  keep: 120,
  /** a leader that moved further than this between two drops was teleported: the trail restarts */
  jump: 5,
  /** the follower keeps this far behind the leader, along the trail */
  behind: 2.5,
  /** speeds by distance to the leader: under `near` walk slowly, up to `far` walk, beyond jog */
  slow: 1.4,
  walk: 2.2,
  jog: 3.6,
  near: 3,
  far: 8,
  /** with the leader standing still, stop within this distance */
  idleStop: 4,
  /** sneaking (the player sneaks, or a stealth zone): crouch-walk, stop when the leader stops */
  stealth: 0.9,
  /** the follower aims this far ahead along the trail (m) */
  lookahead: 1.2,
  /** further than this from every crumb: off the trail (it heads for the nearest crumb) */
  offTrail: 3,
  /** catch up: further than `far` and out of view, or stuck for `stuck` s → appear `behind` m back */
  catchUp: { far: 25, stuck: 4, behind: 6, maxBehind: 14 },
} as const;

export interface FollowTarget {
  /** where to walk now */
  point: XYZ;
  /** distance to the leader along the trail (straight when off it) */
  along: number;
  /** close enough to the trail to walk it */
  onTrail: boolean;
  /** at (or past) the place it should keep to: stop */
  arrived: boolean;
}

export class Breadcrumbs {
  private crumbs: XYZ[] = [];

  constructor(private o: { spacing?: number; keep?: number; jump?: number } = {}) {}

  get length() {
    return this.crumbs.length;
  }

  /** Oldest first. */
  get list(): readonly XYZ[] {
    return this.crumbs;
  }

  get last(): XYZ | null {
    return this.crumbs[this.crumbs.length - 1] ?? null;
  }

  /** The leader is at `p`: a new crumb when it is grounded and `spacing` m from the last. True when one was dropped. */
  drop(p: XYZ, grounded: boolean): boolean {
    if (!grounded) return false;
    const last = this.last;
    if (last) {
      const d = Math.hypot(p.x - last.x, p.z - last.z);
      if (d > (this.o.jump ?? FOLLOW.jump)) {
        this.reset(p);
        return true;
      }
      if (d < (this.o.spacing ?? FOLLOW.spacing)) return false;
    }
    this.crumbs.push({ x: p.x, y: p.y, z: p.z });
    const keep = this.o.keep ?? FOLLOW.keep;
    if (this.crumbs.length > keep) this.crumbs.splice(0, this.crumbs.length - keep);
    return true;
  }

  /** Start over from `p` (a teleport, a checkpoint). */
  reset(p?: XYZ | null) {
    this.crumbs = p ? [{ x: p.x, y: p.y, z: p.z }] : [];
  }

  /** Trail distance from each crumb to the leader (`s[i]`), newest last. */
  private distances(leader: XZ) {
    const c = this.crumbs;
    const n = c.length;
    const s = new Array<number>(n);
    if (!n) return s;
    s[n - 1] = Math.hypot(leader.x - c[n - 1].x, leader.z - c[n - 1].z);
    for (let i = n - 2; i >= 0; i--) s[i] = s[i + 1] + Math.hypot(c[i + 1].x - c[i].x, c[i + 1].z - c[i].z);
    return s;
  }

  /**
   * Where a follower at `self` should walk to keep `behind` m behind `leader` along the trail:
   * the crumb up to `lookahead` m ahead of its place on the trail, never closer to the leader than
   * `behind`. Off the trail (further than `offTrail` from every crumb) it heads for the nearest
   * crumb, or straight for the place to keep when that is nearer. Null without a trail.
   */
  next(self: XZ, leader: XYZ, behind: number = FOLLOW.behind, lookahead: number = FOLLOW.lookahead, offTrail: number = FOLLOW.offTrail): FollowTarget | null {
    const c = this.crumbs;
    const n = c.length;
    if (!n) return null;
    const s = this.distances(leader);
    let k = 0;
    let best = Infinity;
    for (let i = 0; i < n; i++) {
      const d = Math.hypot(c[i].x - self.x, c[i].z - self.z);
      // (ties go to the newer crumb: further along)
      if (d <= best) {
        best = d;
        k = i;
      }
    }
    const straight = Math.hypot(leader.x - self.x, leader.z - self.z);
    if (best > offTrail) {
      const keep = this.pointBehind(leader, behind) ?? leader;
      const toKeep = Math.hypot(keep.x - self.x, keep.z - self.z);
      if (toKeep <= best) return { point: keep, along: straight, onTrail: false, arrived: straight <= behind };
      return { point: c[k], along: best + s[k], onTrail: false, arrived: false };
    }
    const along = s[k] + best;
    if (along <= behind + 0.05) return { point: { x: self.x, y: c[k].y, z: self.z }, along, onTrail: true, arrived: true };
    let j = k;
    while (j + 1 < n && s[j + 1] >= behind && s[k] - s[j + 1] <= lookahead) j++;
    // the next crumb is already too close to the leader: walk to the exact place to keep
    if (j === k && (k + 1 >= n || s[k + 1] < behind)) {
      const keep = this.pointBehind(leader, behind);
      if (keep) return { point: keep, along, onTrail: true, arrived: false };
    }
    return { point: c[j], along, onTrail: true, arrived: false };
  }

  /** The point `back` m behind `leader` along the trail (null: the trail is shorter). */
  pointBehind(leader: XYZ, back: number): XYZ | null {
    const c = this.crumbs;
    const n = c.length;
    if (!n) return null;
    let prev: XYZ = leader;
    let left = back;
    for (let i = n - 1; i >= 0; i--) {
      const seg = Math.hypot(prev.x - c[i].x, prev.z - c[i].z);
      if (seg >= left && seg > 1e-6) {
        const k = left / seg;
        return { x: prev.x + (c[i].x - prev.x) * k, y: prev.y + (c[i].y - prev.y) * k, z: prev.z + (c[i].z - prev.z) * k };
      }
      left -= seg;
      prev = c[i];
    }
    return null;
  }

  /**
   * Crumbs between `min` and `max` m behind the leader along the trail, nearest to `min` first
   * (where a follower that fell far behind may reappear).
   */
  behindLeader(leader: XZ, min: number, max: number): XYZ[] {
    const s = this.distances(leader);
    const out: { p: XYZ; d: number }[] = [];
    for (let i = this.crumbs.length - 1; i >= 0; i--) if (s[i] >= min && s[i] <= max) out.push({ p: this.crumbs[i], d: s[i] });
    return out.sort((a, b) => a.d - b.d).map((e) => e.p);
  }
}

/**
 * How fast the follower goes (§3.6, §7): with the leader standing still it stops within 4 m (and
 * sneaking it stops at once); sneaking it crouch-walks at 0.9; otherwise 1.4 under 3 m, 2.2 to
 * 8 m, 3.6 beyond. `dist` is the distance to the leader (along the trail where there is one).
 */
export function followSpeed(dist: number, o: { leaderMoving: boolean; stealth?: boolean; behind?: number } ): number {
  const behind = o.behind ?? FOLLOW.behind;
  if (o.stealth) {
    if (!o.leaderMoving || dist <= behind) return 0;
    return dist > FOLLOW.far ? FOLLOW.walk : FOLLOW.stealth;
  }
  if (!o.leaderMoving && dist <= FOLLOW.idleStop) return 0;
  if (dist <= behind) return 0;
  if (dist < FOLLOW.near) return FOLLOW.slow;
  if (dist <= FOLLOW.far) return FOLLOW.walk;
  return FOLLOW.jog;
}

/**
 * Whether a follower should catch up by teleport (§3.6): more than 25 m behind and out of view, or
 * stuck for 4 s.
 */
export function shouldCatchUp(dist: number, visible: boolean, stuckFor: number) {
  return (dist > FOLLOW.catchUp.far && !visible) || stuckFor >= FOLLOW.catchUp.stuck;
}
