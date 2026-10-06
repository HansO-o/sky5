import { Quaternion, Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { Emitter } from "../core/emitter";
import { BodyFollower } from "../physics/BodyFollower";
import type { BodyId, Physics } from "../physics/Physics";

export interface HingedDoorOptions {
  /** the node the leaf hangs from: it turns about its local +Y (its pose now is "closed") */
  hinge: TransformNode;
  /** radians about the axis at t = 1 (signed: which way it opens) */
  openYaw: number;
  /** the hinge's local turning axis (default +Y: a door; +X: a chest lid) */
  axis?: Vector3;
  /** the leaf's static collider, built from its world geometry with the leaf closed (moves with it) */
  physics?: Physics | null;
  body?: BodyId | null;
  /** per-frame updates on game time (the world's `onUpdate`) */
  bus: { onUpdate(fn: (dt: number) => void): () => unknown };
  /** starting pose, 0 closed … 1 open (default 0) */
  t?: number;
  /** starts locked: `open()` does nothing until `locked = false` (default false) */
  locked?: boolean;
}

/** A swing under way. */
interface Swing {
  from: number;
  to: number;
  seconds: number;
  time: number;
  done: (completed: boolean) => void;
}

/**
 * A door leaf on a hinge (keep doors, the postern, a cage door, a chest lid): `set(t)` poses it at
 * once, `open()` / `close()` swing it over game time (eased), and its collider follows the leaf.
 * `changed` fires whenever the pose changes (visibility through an open door, for one).
 */
export class HingedDoor {
  readonly hinge: TransformNode;
  readonly openYaw: number;
  readonly axis: Vector3;
  readonly body: BodyId | null;
  /** fires with t after every pose change */
  readonly changed = new Emitter<number>();
  locked: boolean;
  private base: Quaternion;
  private tValue = 0;
  private swing: Swing | null = null;
  private follower: BodyFollower | null = null;
  private off: () => unknown;
  private disposed = false;

  constructor(o: HingedDoorOptions) {
    this.hinge = o.hinge;
    this.openYaw = o.openYaw;
    this.axis = (o.axis ?? Vector3.Up()).clone().normalize();
    this.body = o.body ?? null;
    this.locked = o.locked ?? false;
    const h = o.hinge;
    this.base = (h.rotationQuaternion ?? Quaternion.FromEulerVector(h.rotation)).clone();
    h.rotationQuaternion = this.base.clone();
    // the leaf follows its hinge again (a frozen world matrix would leave it drawn closed)
    for (const m of h.getChildMeshes(false)) m.unfreezeWorldMatrix();
    h.unfreezeWorldMatrix();
    // (the body was built with the leaf in its closed pose: the hinge's pose now)
    if (o.physics && this.body) this.follower = new BodyFollower(o.physics, this.body, h);
    this.off = o.bus.onUpdate((dt) => this.update(dt));
    this.set(o.t ?? 0);
  }

  /** 0 closed … 1 open. */
  get t() {
    return this.tValue;
  }

  get isOpen() {
    return this.tValue > 0.01;
  }

  /** Swinging now. */
  get moving() {
    return !!this.swing;
  }

  /** Pose the leaf at `t` at once (a swing under way ends, unfinished). */
  set(t: number) {
    this.endSwing(false);
    this.pose(t);
  }

  /**
   * Swing open over `seconds` of game time; resolves with true once open, false when interrupted
   * (another swing, `set`, dispose) or locked.
   */
  open(seconds = 1.4): Promise<boolean> {
    if (this.locked) return Promise.resolve(false);
    return this.swingTo(1, seconds);
  }

  close(seconds = 1.4): Promise<boolean> {
    return this.swingTo(0, seconds);
  }

  /** Swing to `t` over `seconds` (eased in and out). */
  swingTo(t: number, seconds: number): Promise<boolean> {
    this.endSwing(false);
    const to = Math.max(0, Math.min(1, t));
    if (this.disposed) return Promise.resolve(false);
    if (seconds <= 0 || Math.abs(to - this.tValue) < 1e-4) {
      this.pose(to);
      return Promise.resolve(true);
    }
    return new Promise<boolean>((done) => {
      this.swing = { from: this.tValue, to, seconds: seconds * Math.abs(to - this.tValue), time: 0, done };
    });
  }

  /** The collider on or off (an open leaf that should not block, a cut web). */
  setSolid(physics: Physics, on: boolean) {
    if (this.body) physics.setBodyEnabled(this.body, on);
  }

  private update(dt: number) {
    const s = this.swing;
    if (!s || this.disposed) return;
    s.time += dt;
    const k = Math.min(1, s.time / s.seconds);
    const e = k * k * (3 - 2 * k);
    this.pose(s.from + (s.to - s.from) * e);
    if (k >= 1) this.endSwing(true);
  }

  private endSwing(completed: boolean) {
    const s = this.swing;
    if (!s) return;
    this.swing = null;
    s.done(completed);
  }

  private pose(t: number) {
    if (this.disposed || this.hinge.isDisposed()) return;
    this.tValue = Math.max(0, Math.min(1, t));
    const q = Quaternion.RotationAxis(this.axis, this.tValue * this.openYaw);
    this.base.multiplyToRef(q, this.hinge.rotationQuaternion!);
    this.follower?.sync();
    this.changed.emit(this.tValue);
  }

  dispose() {
    if (this.disposed) return;
    this.endSwing(false);
    this.disposed = true;
    this.off();
    this.changed.clear();
  }
}
