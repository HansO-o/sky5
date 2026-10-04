/**
 * The body side of an AI actor as its brain drives it: movement goals (go to, circle, back off,
 * stop), facing, body clips ("actions") over the locomotion, root motion, knockback, a stagger
 * wobble, crouching, suspension for cutscenes. `AgentCore` holds all of it as pure state and turns
 * a goal into a velocity each step; `AgentMover` puts that on a `CapsuleMover` and a body, and
 * `KinematicAgent` integrates it directly (tests, simple props). Engine-framework §2.19 calls the
 * mover `AgentMover` (there over a navmesh agent; here direct steering, design §0 #12).
 */
import { RootMotionTrack, type RootMotionCurve } from "../anim/rootMotion";
import type { XYZ } from "../combat/hit";
import { circleVelocity, localVelocity, separation, seek, sidestep, STEER, StuckDetector, turnToward, yawOf, type Crowd, type CrowdMember, type XZ } from "./steering";

/** A point, or a function giving one (a moving target). */
export type Place = XZ | (() => XZ);

export type Goal =
  | { kind: "stop" }
  | { kind: "point"; at: Place; speed: number; stop: number }
  | { kind: "circle"; center: Place; radius: number; dir: 1 | -1; speed: number }
  | { kind: "dir"; x: number; z: number; speed: number };

export interface ActOptions {
  loop?: boolean;
  /** playback rate (default 1; negative plays backwards) */
  speed?: number;
  /** cross-fade (s; default 0.15) */
  blend?: number;
  /** a one-shot keeps its last pose until the next `act` instead of giving the body back (default false) */
  hold?: boolean;
  /** start at this fraction of the clip */
  offset?: number;
}

/** What a brain drives (implemented by `AgentMover`, `KinematicAgent`). */
export interface AgentControl {
  /** feet, as of the last step */
  readonly position: XYZ;
  /** facing (forward = (−sin, −cos)) */
  readonly yaw: number;
  /** horizontal speed after the last step (m/s) */
  readonly speed: number;
  readonly goal: Goal;
  moveTo(at: Place, speed: number, stop?: number): void;
  /** strafe on a ring around `center` toward its left (+1) or right (−1) as it faces the centre */
  circle(center: Place, radius: number, dir: 1 | -1, speed: number): void;
  /** move along a world direction (backing off) */
  moveDir(x: number, z: number, speed: number): void;
  stop(): void;
  /** face a place or a yaw (null: the way it moves) */
  face(target: Place | number | null): void;
  /** play a body clip over the locomotion (null: back to locomotion); returns its length in s (0: no such clip) */
  act(clip: string | null, o?: ActOptions): number;
  /** the current action's playback rate (0 freezes it) */
  setActRate(rate: number): void;
  /** the action clip playing (null: locomotion) */
  readonly acting: string | null;
  hasClip(clip: string): boolean;
  /** ride a clip's root motion (started with the clip, at its rate); false without a curve */
  rootMotion(curve: RootMotionCurve | null | undefined, o?: { speed?: number; from?: number; target?: () => XZ | null }): boolean;
  stopRootMotion(): void;
  /** pushed (m, world) over `seconds` (default 0.3) */
  shove(dx: number, dz: number, seconds?: number): void;
  /** a procedural reel (creatures' stagger): a side-to-side rock for `seconds` */
  wobble(seconds: number, amplitude?: number): void;
  crouch: boolean;
  /** a script has the body: no movement, no clips, no placement until false again */
  suspended: boolean;
  teleport(p: XYZ, yaw?: number): void;
  /** dead: the capsule goes (corpses don't block), the body stays as it is */
  release(): void;
  readonly released: boolean;
  /** seconds it has been stuck in a row (wanting to move, not moving) */
  readonly stuckFor: number;
  /** turn the head toward a point (null: free) */
  lookAt?(p: XYZ | null): void;
}

/** A locomotion clip and the speed (m/s) its feet travel at rate 1. */
export interface GaitClip {
  clip: string;
  native: number;
}

/** The locomotion clips of a kind of body. */
export interface Gait {
  idle: string;
  /** forward clips, slowest first: each is used below its `below` speed (the last above too) */
  forward: readonly (GaitClip & { below: number })[];
  left?: GaitClip;
  right?: GaitClip;
  /** backwards (`reverse`: a forward clip played at a negative rate) */
  back?: GaitClip & { reverse?: boolean };
  /** sideways and backwards faster than `above` m/s */
  fast?: { above: number; left?: GaitClip; right?: GaitClip; back?: GaitClip };
  crouchIdle?: string;
  crouchMove?: GaitClip;
  /** idle below this speed (default 0.15) */
  still?: number;
  /** lowest playback rate of a moving clip (default 0.5) */
  minRate?: number;
}

/** UAL humanoids: walk/jog/sprint, the combat set's strafes and backpedal, crouching. */
export const HUMANOID_GAIT: Gait = {
  idle: "Idle_Loop",
  forward: [
    { clip: "Walk_Loop", native: 0.95, below: 2.6 },
    { clip: "Jog_Fwd_Loop", native: 3.6, below: 5 },
    { clip: "Sprint_Loop", native: 6, below: Infinity },
  ],
  left: { clip: "Walk_L_Loop", native: 0.9 },
  right: { clip: "Walk_R_Loop", native: 0.9 },
  back: { clip: "Walk_Bwd_Loop", native: 0.9 },
  fast: { above: 1.8, left: { clip: "Jog_Left_Loop", native: 3 }, right: { clip: "Jog_Right_Loop", native: 3 }, back: { clip: "Jog_Bwd_Loop", native: 3 } },
  crouchIdle: "Crouch_Idle_Loop",
  crouchMove: { clip: "Crouch_Fwd_Loop", native: 0.6 },
  still: 0.15,
  minRate: 0.5,
};

/**
 * The locomotion clip for moving `fwd` m/s ahead and `right` m/s to the right (the body's frame),
 * and its playback rate (speed over the clip's native speed). `has` filters clips the body lacks
 * (the strafes fall back to walking forward, the backpedal to the walk played backwards).
 */
export function gaitClip(g: Gait, fwd: number, right: number, crouch = false, has: (clip: string) => boolean = () => true): { clip: string; speed: number } {
  const speed = Math.hypot(fwd, right);
  const min = g.minRate ?? 0.5;
  const rate = (c: GaitClip, sign = 1) => sign * Math.max(min, speed / c.native);
  if (speed < (g.still ?? 0.15)) return { clip: crouch && g.crouchIdle && has(g.crouchIdle) ? g.crouchIdle : g.idle, speed: 1 };
  if (crouch && g.crouchMove && has(g.crouchMove.clip)) return { clip: g.crouchMove.clip, speed: rate(g.crouchMove) };
  const ahead = g.forward.find((f) => speed < f.below) ?? g.forward[g.forward.length - 1];
  const walk = g.forward[0];
  const a = Math.atan2(right, fwd);
  const fast = g.fast && speed > g.fast.above ? g.fast : null;
  const pick = (c: GaitClip | undefined) => (c && has(c.clip) ? c : null);
  if (Math.abs(a) <= (50 * Math.PI) / 180) return { clip: ahead.clip, speed: rate(ahead) };
  if (Math.abs(a) >= (130 * Math.PI) / 180) {
    const b = pick(fast?.back) ?? pick(g.back);
    if (b) return { clip: b.clip, speed: rate(b, g.back?.reverse && b === g.back ? -1 : 1) };
    return { clip: walk.clip, speed: rate(walk, -1) };
  }
  const side = right > 0 ? (pick(fast?.right) ?? pick(g.right)) : (pick(fast?.left) ?? pick(g.left));
  if (side) return { clip: side.clip, speed: rate(side) };
  return { clip: ahead.clip, speed: rate(ahead) };
}

function at(p: Place): XZ {
  return typeof p === "function" ? p() : p;
}

interface Action {
  clip: string;
  loop: boolean;
  hold: boolean;
  speed: number;
  length: number;
  t: number;
}

/**
 * The pure part of an agent: goals, facing, actions, root motion, shove, wobble, stuck detection,
 * separation. Subclasses provide the position and the body.
 */
export abstract class AgentCore implements AgentControl, CrowdMember {
  goal: Goal = { kind: "stop" };
  crouch = false;
  /** separation radius (m) */
  r: number = STEER.separation;
  protected p = { x: 0, y: 0, z: 0 };
  protected yawValue = 0;
  protected faceTarget: Place | number | null = null;
  protected action: Action | null = null;
  protected track: { t: RootMotionTrack; target: (() => XZ | null) | null } | null = null;
  protected shoveV = { x: 0, z: 0, left: 0 };
  protected wobbleS = { left: 0, total: 0, amp: 0 };
  protected stuck = new StuckDetector();
  protected suspendedFlag = false;
  protected releasedFlag = false;
  /** the speed the last goal asked for (stuck detection) */
  protected wanted = 0;

  constructor(
    readonly turnRate: number = STEER.turn,
    protected crowd: Crowd | null = null,
  ) {}

  get x() {
    return this.p.x;
  }
  get z() {
    return this.p.z;
  }
  get position(): XYZ {
    return this.p;
  }
  get yaw() {
    return this.yawValue;
  }
  abstract get speed(): number;
  get stuckFor() {
    return this.stuck.stuckFor;
  }
  get acting() {
    return this.action?.clip ?? null;
  }
  get released() {
    return this.releasedFlag;
  }
  get suspended() {
    return this.suspendedFlag;
  }
  set suspended(on: boolean) {
    if (on === this.suspendedFlag) return;
    this.suspendedFlag = on;
    this.onSuspend(on);
  }
  protected onSuspend(_on: boolean) {}

  moveTo(p: Place, speed: number, stop = 0) {
    this.goal = { kind: "point", at: p, speed, stop };
  }
  circle(center: Place, radius: number, dir: 1 | -1, speed: number) {
    this.goal = { kind: "circle", center, radius, dir, speed };
  }
  moveDir(x: number, z: number, speed: number) {
    const l = Math.hypot(x, z);
    this.goal = l > 1e-6 ? { kind: "dir", x: x / l, z: z / l, speed } : { kind: "stop" };
  }
  stop() {
    this.goal = { kind: "stop" };
  }
  face(target: Place | number | null) {
    this.faceTarget = target;
  }

  abstract hasClip(clip: string): boolean;
  /** play `clip` on the body (subclasses); returns its length (0: none) */
  protected abstract playClip(clip: string, o: Required<Pick<ActOptions, "loop" | "speed" | "blend">> & { offset?: number }): number;

  act(clip: string | null, o: ActOptions = {}): number {
    if (!clip) {
      this.action = null;
      return 0;
    }
    if (!this.hasClip(clip)) {
      this.action = null;
      return 0;
    }
    const loop = o.loop ?? false;
    const speed = o.speed ?? 1;
    const length = this.playClip(clip, { loop, speed, blend: o.blend ?? 0.15, offset: o.offset ?? (loop ? undefined : 0) });
    this.action = { clip, loop, hold: o.hold ?? false, speed, length, t: (o.offset ?? 0) * length };
    return length;
  }

  setActRate(rate: number) {
    const a = this.action;
    if (!a || a.speed === rate) return;
    a.speed = rate;
    this.playClip(a.clip, { loop: a.loop, speed: rate, blend: 0 });
  }

  rootMotion(curve: RootMotionCurve | null | undefined, o: { speed?: number; from?: number; target?: () => XZ | null } = {}) {
    if (!curve || !curve.moves) {
      this.track = null;
      return false;
    }
    this.track = { t: new RootMotionTrack(curve, o.speed ?? 1, {}, o.from ?? 0), target: o.target ?? null };
    return true;
  }
  stopRootMotion() {
    this.track = null;
  }

  shove(dx: number, dz: number, seconds = 0.3) {
    const s = Math.max(0.05, seconds);
    this.shoveV = { x: dx / s, z: dz / s, left: s };
  }

  wobble(seconds: number, amplitude = 0.14) {
    this.wobbleS = { left: seconds, total: seconds, amp: amplitude };
  }

  abstract teleport(p: XYZ, yaw?: number): void;
  abstract release(): void;

  /**
   * The velocity this step should have (world m/s): the goal's, sliding sideways when stuck, apart
   * from the crowd, plus knockback and root motion; root motion also turns the body. `actual` is
   * the speed the body achieved last step.
   */
  protected desired(dt: number, actual: number): { vx: number; vz: number; snap: boolean } {
    const self = this.p;
    let vx = 0, vz = 0;
    const g = this.goal;
    if (g.kind === "point") {
      const v = seek(self, at(g.at), g.speed, g.stop);
      vx = v.vx;
      vz = v.vz;
    } else if (g.kind === "circle") {
      const v = circleVelocity(self, at(g.center), g.radius, g.dir, g.speed);
      vx = v.vx;
      vz = v.vz;
    } else if (g.kind === "dir") {
      vx = g.x * g.speed;
      vz = g.z * g.speed;
    }
    const wanted = Math.hypot(vx, vz);
    this.wanted = wanted;
    const side = this.stuck.update(dt, this.track ? 0 : wanted, actual);
    if (side && wanted > 0) {
      // slide along whatever is in the way, still edging forward
      const s = sidestep(vx, vz, side);
      vx = s.vx * 0.85 + vx * 0.3;
      vz = s.vz * 0.85 + vz * 0.3;
    }
    if (this.crowd) {
      const sep = separation(self, this.r, this.crowd.near(this, self, 2));
      vx += sep.vx;
      vz += sep.vz;
    }
    if (this.shoveV.left > 0) {
      vx += this.shoveV.x;
      vz += this.shoveV.z;
      this.shoveV.left -= dt;
    }
    let snap = this.shoveV.left > 0;
    const tr = this.track;
    if (tr) {
      const st = tr.t.step(dt, this.yawValue, self.x, self.z, tr.target?.() ?? null);
      vx += st.vx;
      vz += st.vz;
      this.yawValue += st.dyaw;
      snap = true;
      if (st.done) this.track = null;
    }
    return { vx, vz, snap };
  }

  /** Per frame: turn toward the facing target (or the movement), and age the action. */
  protected frame(dt: number, vx: number, vz: number) {
    let want: number | null = null;
    const f = this.faceTarget;
    if (typeof f === "number") want = f;
    else if (f) {
      const t = at(f);
      const dx = t.x - this.p.x, dz = t.z - this.p.z;
      if (dx * dx + dz * dz > 1e-4) want = yawOf(dx, dz);
    } else if (Math.hypot(vx, vz) > 0.3) want = yawOf(vx, vz);
    if (want !== null && !this.track) this.yawValue = turnToward(this.yawValue, want, this.turnRate, dt);
    if (this.wobbleS.left > 0) this.wobbleS.left = Math.max(0, this.wobbleS.left - dt);
    const a = this.action;
    if (a && !a.loop) {
      a.t += dt * Math.abs(a.speed);
      if (a.t >= a.length && !a.hold) this.action = null;
    }
  }

  /** The wobble's roll now (rad). */
  protected get roll() {
    const w = this.wobbleS;
    if (w.left <= 0) return 0;
    const k = w.left / w.total;
    return w.amp * k * Math.sin((w.total - w.left) * 38);
  }

  /** The body's velocity in its own frame (for the gait). */
  protected local(vx: number, vz: number) {
    return localVelocity(vx, vz, this.yawValue);
  }
}

/**
 * An agent with no physics: each `step(dt)` moves it at the goal's velocity on a flat floor
 * (height kept). For tests and for actors that only need to walk around in the open.
 */
export class KinematicAgent extends AgentCore {
  /** clips it "has" (tests: every clip when null) and those it played, latest last */
  played: { clip: string; speed: number; loop: boolean }[] = [];
  private v = { x: 0, z: 0 };
  private disposeCrowd: (() => void) | null = null;
  private clips: Record<string, number> | null;

  constructor(
    start: XYZ,
    yaw = 0,
    o: { crowd?: Crowd | null; clips?: Record<string, number> | null; turnRate?: number } = {},
  ) {
    super(o.turnRate ?? STEER.turn, o.crowd ?? null);
    this.p = { x: start.x, y: start.y, z: start.z };
    this.yawValue = yaw;
    this.clips = o.clips ?? null;
    if (o.crowd) this.disposeCrowd = o.crowd.add(this);
  }

  get speed() {
    return Math.hypot(this.v.x, this.v.z);
  }

  hasClip(clip: string) {
    return !this.clips || clip in this.clips;
  }

  protected playClip(clip: string, o: { loop: boolean; speed: number }) {
    this.played.push({ clip, speed: o.speed, loop: o.loop });
    return this.clips?.[clip] ?? 1;
  }

  /** One step of `dt` seconds: move, then turn and age the action. */
  step(dt: number) {
    if (this.releasedFlag || this.suspendedFlag) {
      this.v = { x: 0, z: 0 };
      return;
    }
    const d = this.desired(dt, this.speed);
    this.v = { x: d.vx, z: d.vz };
    this.p.x += d.vx * dt;
    this.p.z += d.vz * dt;
    this.frame(dt, d.vx, d.vz);
  }

  teleport(p: XYZ, yaw?: number) {
    this.p = { x: p.x, y: p.y, z: p.z };
    if (yaw !== undefined) this.yawValue = yaw;
    this.stuck.reset();
  }

  release() {
    this.releasedFlag = true;
    this.disposeCrowd?.();
    this.disposeCrowd = null;
  }
}
