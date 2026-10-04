import { Quaternion, Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import type { PlayOptions } from "../anim/AnimController";
import type { UpdateBus } from "../actors/Equipment";
import type { XYZ } from "../combat/hit";
import type { CapsuleMover } from "../physics/CapsuleMover";
import { AgentCore, HUMANOID_GAIT, gaitClip, type ActOptions, type Gait } from "./agent";
import { STEER, type Crowd } from "./steering";

/**
 * A body an agent moves and animates: a `Character` (UAL humanoid) or a `Creature` fits. The root
 * faces +Z (glTF); its yaw is set in the game's convention.
 */
export interface AgentBody {
  readonly root: TransformNode;
  play(clip: string, o?: PlayOptions): unknown;
  hasClip(clip: string): boolean;
  /** clip length in s at rate 1 */
  clipLength?(clip: string): number;
  lookAt?(p: Vector3 | null): void;
}

export interface AgentMoverOptions {
  /** the capsule it walks with (the agent disposes it on `release()` or `dispose()`) */
  mover: CapsuleMover;
  /** what it looks like (none: an invisible capsule) */
  body?: AgentBody | null;
  /** per-frame updates on game time (the world's `onUpdate`) */
  bus: UpdateBus;
  /** its locomotion clips (default: the UAL humanoid's; null: no locomotion clips) */
  gait?: Gait | null;
  /** turn rate (rad/s; default 8) */
  turnRate?: number;
  /** keeps its distance from these (and they from it) */
  crowd?: Crowd | null;
  /** separation radius (m; default 0.45) */
  separation?: number;
  /** cross-fade between locomotion clips (s; default 0.25) */
  blend?: number;
  /** starting facing */
  yaw?: number;
}

const tmpQ = new Quaternion();

/**
 * An NPC on a `CapsuleMover` (design §3.6): every fixed physics step the goal becomes the
 * capsule's velocity (with separation, the stuck slide, knockback and root motion); every frame
 * the body is placed where the capsule is drawn, turned toward its facing at 8 rad/s and given its
 * locomotion clip, unless an action (attack, hit reaction, kneel) has it. While `suspended` it
 * leaves the body to a script; when resumed the capsule moves to wherever the script left the body.
 */
export class AgentMover extends AgentCore {
  readonly body: AgentBody | null;
  private mover: CapsuleMover | null;
  private gait: Gait | null;
  private blend: number;
  private offDrive: (() => void) | null = null;
  private offFrame: () => unknown;
  private offCrowd: (() => void) | null = null;
  private lastV = { x: 0, z: 0 };
  private disposed = false;

  constructor(o: AgentMoverOptions) {
    super(o.turnRate ?? STEER.turn, o.crowd ?? null);
    this.mover = o.mover;
    this.body = o.body ?? null;
    this.gait = o.gait === undefined ? HUMANOID_GAIT : o.gait;
    this.blend = o.blend ?? 0.25;
    this.r = o.separation ?? STEER.separation;
    this.yawValue = o.yaw ?? 0;
    this.readPosition();
    this.offCrowd = o.crowd?.add(this) ?? null;
    this.drive();
    this.offFrame = o.bus.onUpdate((dt) => this.update(dt));
    if (this.body) {
      this.body.root.parent = null;
      this.place();
    }
  }

  /** The capsule (null once released). */
  get capsule() {
    return this.mover;
  }

  get speed() {
    return this.mover?.speed ?? 0;
  }

  get onGround() {
    return this.mover?.onGround ?? true;
  }

  hasClip(clip: string) {
    return !!this.body?.hasClip(clip);
  }

  protected playClip(clip: string, o: { loop: boolean; speed: number; blend: number; offset?: number }) {
    const b = this.body;
    if (!b) return 0;
    b.play(clip, { loop: o.loop, speed: o.speed, blend: o.blend, offset: o.offset });
    return b.clipLength?.(clip) ?? 1;
  }

  lookAt(p: XYZ | null) {
    this.body?.lookAt?.(p ? new Vector3(p.x, p.y, p.z) : null);
  }

  private drive() {
    const m = this.mover;
    if (!m || this.offDrive) return;
    this.offDrive = m.drive(
      (dt) => {
        if (this.suspendedFlag || this.releasedFlag) return { vx: 0, vz: 0 };
        const d = this.desired(dt, m.speed);
        this.lastV.x = d.vx;
        this.lastV.z = d.vz;
        return { vx: d.vx, vz: d.vz, snap: d.snap };
      },
      () => this.readPosition(),
    );
  }

  private readPosition() {
    const m = this.mover;
    if (!m) return;
    const p = m.position;
    this.p.x = p.x;
    this.p.y = p.y;
    this.p.z = p.z;
  }

  protected onSuspend(on: boolean) {
    if (on) {
      this.offDrive?.();
      this.offDrive = null;
      this.goal = { kind: "stop" };
      this.action = null;
      this.track = null;
      return;
    }
    // back from a script: the capsule goes to wherever the body was left, facing its way
    const b = this.body;
    if (b && this.mover) {
      const r = b.root;
      const q = r.rotationQuaternion;
      const yaw = q ? 2 * Math.atan2(q.y, q.w) - Math.PI : r.rotation.y - Math.PI;
      this.teleport({ x: r.position.x, y: r.position.y, z: r.position.z }, Math.atan2(Math.sin(yaw), Math.cos(yaw)));
    }
    this.drive();
  }

  teleport(p: XYZ, yaw?: number) {
    if (yaw !== undefined) this.yawValue = yaw;
    this.stuck.reset();
    this.shoveV.left = 0;
    this.track = null;
    if (this.mover) {
      this.mover.teleport(new Vector3(p.x, p.y, p.z));
      this.readPosition();
    } else {
      this.p.x = p.x;
      this.p.y = p.y;
      this.p.z = p.z;
    }
    this.place();
  }

  /** Dead: the capsule goes (corpses don't block the living); the body stays as it lies. */
  release() {
    if (this.releasedFlag) return;
    this.releasedFlag = true;
    this.goal = { kind: "stop" };
    this.track = null;
    this.offDrive?.();
    this.offDrive = null;
    this.offCrowd?.();
    this.offCrowd = null;
    this.mover?.dispose();
    this.mover = null;
  }

  private update(dt: number) {
    if (this.disposed || this.suspendedFlag) return;
    if (this.releasedFlag) {
      // (the action still runs out: a death clip ending gives the body to nothing)
      this.frame(dt, 0, 0);
      return;
    }
    const v = this.mover?.velocity;
    this.frame(dt, v?.x ?? 0, v?.z ?? 0);
    this.place();
    const b = this.body;
    if (!b || this.action || !this.gait) return;
    const l = this.local(v?.x ?? 0, v?.z ?? 0);
    const pick = gaitClip(this.gait, l.fwd, l.right, this.crouch, (c) => b.hasClip(c));
    if (b.hasClip(pick.clip)) b.play(pick.clip, { speed: pick.speed, blend: this.blend });
  }

  /** The body where the capsule is drawn this frame, turned to the facing (and the wobble). */
  private place() {
    const b = this.body;
    if (!b) return;
    const r = b.root;
    if (this.mover && !this.releasedFlag) r.position.copyFrom(this.mover.renderPosition);
    else if (!this.releasedFlag) r.position.set(this.p.x, this.p.y, this.p.z);
    r.rotationQuaternion ??= Quaternion.Identity();
    const roll = this.roll;
    if (roll) {
      Quaternion.RotationYawPitchRollToRef(this.yawValue + Math.PI, 0, roll, tmpQ);
      r.rotationQuaternion.copyFrom(tmpQ);
    } else {
      const y = this.yawValue + Math.PI;
      r.rotationQuaternion.set(0, Math.sin(y / 2), 0, Math.cos(y / 2));
    }
  }

  /** The velocity asked for at the last step (debug). */
  get desiredVelocity() {
    return this.lastV;
  }

  dispose() {
    if (this.disposed) return;
    this.release();
    this.disposed = true;
    this.offFrame();
  }
}

export type { ActOptions };
