/**
 * Root motion baked out of attack clips (the pipeline's `anim_rootmotion` sidecar): per clip, the
 * root bone's path as `[t, x, y, z, yaw]` keys in character model space (+Z forward, +X the
 * character's left, +Y up, metres; yaw in radians about +Y, positive turning +Z toward +X). Clips
 * play in place; a {@link RootMotionTrack} turns the curve into the velocity a capsule mover
 * follows, so the capsule (not the mesh) travels and collides.
 */

/** One sample of a root-motion curve. */
export interface RootSample {
  x: number;
  y: number;
  z: number;
  yaw: number;
}

/** A curve key: clip time (s), position (m, model space), yaw (rad). */
export type RootKey = readonly [t: number, x: number, y: number, z: number, yaw: number];

/** Root motion of one clip, interpolated linearly between its keys. */
export class RootMotionCurve {
  readonly duration: number;

  constructor(
    readonly keys: readonly RootKey[],
    duration?: number,
  ) {
    if (!keys.length) throw new Error("root motion curve without keys");
    for (let i = 1; i < keys.length; i++) if (!(keys[i][0] >= keys[i - 1][0])) throw new Error("root motion keys out of order");
    this.duration = Math.max(duration ?? 0, keys[keys.length - 1][0]);
  }

  /** The root at clip time `t` (clamped to the clip). */
  sample(t: number, out: RootSample = { x: 0, y: 0, z: 0, yaw: 0 }): RootSample {
    const k = this.keys;
    const n = k.length;
    if (t <= k[0][0] || n === 1) return set(out, k[0]);
    if (t >= k[n - 1][0]) return set(out, k[n - 1]);
    // binary search for the span holding t
    let lo = 0, hi = n - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (k[mid][0] <= t) lo = mid;
      else hi = mid;
    }
    const a = k[lo], b = k[hi];
    const u = b[0] > a[0] ? (t - a[0]) / (b[0] - a[0]) : 0;
    out.x = a[1] + (b[1] - a[1]) * u;
    out.y = a[2] + (b[2] - a[2]) * u;
    out.z = a[3] + (b[3] - a[3]) * u;
    out.yaw = a[4] + (b[4] - a[4]) * u;
    return out;
  }

  /** Root motion between clip times `t0` and `t1` (both clamped), in model space. */
  delta(t0: number, t1: number, out: RootSample = { x: 0, y: 0, z: 0, yaw: 0 }): RootSample {
    const a = this.sample(t0, tmpA), b = this.sample(t1, tmpB);
    out.x = b.x - a.x;
    out.y = b.y - a.y;
    out.z = b.z - a.z;
    out.yaw = b.yaw - a.yaw;
    return out;
  }

  /** Net motion over the whole clip. */
  get net(): RootSample {
    return this.delta(0, this.duration);
  }

  /** Whether the clip moves the root at all (zero-motion entries only record that the root was pinned). */
  get moves() {
    return this.keys.some((k) => k[1] !== 0 || k[2] !== 0 || k[3] !== 0 || k[4] !== 0);
  }
}

const tmpA: RootSample = { x: 0, y: 0, z: 0, yaw: 0 };
const tmpB: RootSample = { x: 0, y: 0, z: 0, yaw: 0 };
function set(out: RootSample, k: RootKey) {
  out.x = k[1];
  out.y = k[2];
  out.z = k[3];
  out.yaw = k[4];
  return out;
}

/** The root-motion curves of a set of clips by clip name (empty when the sidecar is missing). */
export class RootMotionLibrary {
  private curves = new Map<string, RootMotionCurve>();

  /**
   * Curves from the sidecar JSON (`{ version: 1, clips: { name: { duration, keys } } }`). Anything
   * else (a missing or damaged file) gives an empty library; a damaged entry is skipped.
   */
  static parse(json: unknown): RootMotionLibrary {
    const lib = new RootMotionLibrary();
    lib.merge(json);
    return lib;
  }

  /** Add the curves of another sidecar (later files win for the same clip). Returns how many were added. */
  merge(json: unknown): number {
    const clips = (json as { clips?: unknown } | null)?.clips;
    if (!clips || typeof clips !== "object") return 0;
    let n = 0;
    for (const [name, raw] of Object.entries(clips as Record<string, unknown>)) {
      const e = raw as { duration?: unknown; keys?: unknown };
      if (!Array.isArray(e?.keys)) continue;
      const keys = e.keys.filter((k): k is RootKey => Array.isArray(k) && k.length >= 5 && k.slice(0, 5).every((v) => typeof v === "number" && Number.isFinite(v)));
      if (!keys.length || keys.length !== e.keys.length) continue;
      try {
        this.curves.set(name, new RootMotionCurve(keys.map((k) => [k[0], k[1], k[2], k[3], k[4]] as const), typeof e.duration === "number" ? e.duration : undefined));
        n++;
      } catch {
        // keys out of order: skip the clip (it plays in place)
      }
    }
    return n;
  }

  get(clip: string) {
    return this.curves.get(clip);
  }

  has(clip: string) {
    return this.curves.has(clip);
  }

  get size() {
    return this.curves.size;
  }

  clips() {
    return [...this.curves.keys()];
  }
}

/**
 * A model-space displacement (x = the character's left, z = forward) in world space for an actor
 * whose forward yaw is `yaw` (forward = (-sin yaw, -cos yaw), the game's convention).
 */
export function modelToWorld(x: number, z: number, yaw: number): { x: number; z: number } {
  const s = Math.sin(yaw), c = Math.cos(yaw);
  return { x: -s * z - c * x, z: -c * z + s * x };
}

/**
 * Limit a horizontal step (sx, sz) from (px, pz) so it never brings the actor closer than `stop` to
 * the target (tx, tz): only the part of the step toward the target is cut; sideways and backward
 * motion pass. Already inside `stop`, no approach is allowed at all.
 */
export function limitApproach(px: number, pz: number, sx: number, sz: number, tx: number, tz: number, stop: number): { x: number; z: number } {
  const dx = tx - px, dz = tz - pz;
  const d = Math.hypot(dx, dz);
  if (d < 1e-6) return { x: sx, z: sz };
  const ux = dx / d, uz = dz / d;
  const along = sx * ux + sz * uz;
  if (along <= 0) return { x: sx, z: sz };
  const allowed = Math.max(0, d - stop);
  if (along <= allowed) return { x: sx, z: sz };
  const cut = along - allowed;
  return { x: sx - ux * cut, z: sz - uz * cut };
}

export interface RootMotionLimits {
  /** top speed the curve is followed at (m/s; default 3) */
  maxSpeed?: number;
  /** never root-move closer than this to the target (m; default 0.9) */
  stopDistance?: number;
  /**
   * carry what the speed limit held back over to later steps, so a fast lunge still covers its
   * distance, just later (default true); false drops it (a hard clamp shortens the travel)
   */
  carry?: boolean;
  /** carried motion still owed this long after the clip's end is dropped (s; default 0.5) */
  carryAfter?: number;
}

/** What a root-motion step asks of the mover. */
export interface RootStep {
  /** world velocity (m/s) for this step */
  vx: number;
  vz: number;
  /** turn this step (rad, forward-yaw convention: positive turns left) */
  dyaw: number;
  /** the clip (and any carried motion) is over */
  done: boolean;
}

/**
 * One clip's root motion on one actor, advanced by fixed steps: each step's curve delta becomes a
 * world velocity for the actor's capsule (rotated by its current yaw), limited to `maxSpeed` and
 * kept `stopDistance` off the target.
 */
export class RootMotionTrack {
  /** clip time (s) */
  t = 0;
  private owe = { x: 0, z: 0 };
  private after = 0;
  private lim: Required<RootMotionLimits>;
  private d: RootSample = { x: 0, y: 0, z: 0, yaw: 0 };

  constructor(
    readonly curve: RootMotionCurve,
    /** clip playback rate */
    readonly speed = 1,
    limits: RootMotionLimits = {},
    /** start at this clip time (s) */
    from = 0,
  ) {
    this.lim = { maxSpeed: 3, stopDistance: 0.9, carry: true, carryAfter: 0.5, ...limits };
    this.t = from;
  }

  get done() {
    return this.t >= this.curve.duration && (this.after >= this.lim.carryAfter || (this.owe.x === 0 && this.owe.z === 0));
  }

  /**
   * Advance `dt` seconds of game time for an actor at (px, pz) facing `yaw`; `target` is what it
   * is attacking (null: no stop distance).
   */
  step(dt: number, yaw: number, px: number, pz: number, target: { x: number; z: number } | null = null): RootStep {
    if (dt <= 0) return { vx: 0, vz: 0, dyaw: 0, done: this.done };
    const t0 = this.t;
    const t1 = Math.min(this.curve.duration, t0 + dt * this.speed);
    this.t = t1;
    const d = this.curve.delta(t0, t1, this.d);
    if (t0 >= this.curve.duration) this.after += dt;
    const w = modelToWorld(d.x, d.z, yaw);
    // what the curve wants this step plus what earlier steps could not do (dropped once the
    // clip has been over for `carryAfter`)
    let sx = w.x, sz = w.z;
    if (this.after < this.lim.carryAfter) {
      sx += this.owe.x;
      sz += this.owe.z;
    }
    const max = this.lim.maxSpeed * dt;
    const len = Math.hypot(sx, sz);
    let kx = sx, kz = sz;
    if (len > max) {
      kx = (sx / len) * max;
      kz = (sz / len) * max;
    }
    let ox = sx - kx, oz = sz - kz;
    if (target) {
      const l = limitApproach(px, pz, kx, kz, target.x, target.z, this.lim.stopDistance);
      // stopped short of the target: what is still owed is dropped too
      if (l.x !== kx || l.z !== kz) ox = oz = 0;
      kx = l.x;
      kz = l.z;
    }
    if (!this.lim.carry || Math.hypot(ox, oz) < 1e-6) ox = oz = 0;
    this.owe.x = ox;
    this.owe.z = oz;
    return { vx: kx / dt, vz: kz / dt, dyaw: d.yaw, done: this.done };
  }
}
