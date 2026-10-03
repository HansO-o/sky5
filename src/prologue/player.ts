import type JoltType from "jolt-physics/wasm";
import { Quaternion, Vector3 } from "@babylonjs/core/Maths/math.vector";
import { input } from "../core/input";
import type { Physics } from "../physics/Physics";
import type { Character } from "../world/characters";
import type { CameraRig, CameraTarget } from "./camera";

const RADIUS = 0.3;
const HEIGHT = 1.8;
const SPEED = { sneak: 1.4, walk: 1.9, run: 3.9, sprint: 6.2 };
const JUMP = 4.6;

/**
 * Player movement on a Jolt CharacterVirtual capsule. Moves relative to the camera yaw, drives the
 * body's locomotion clips from the actual speed, and serves as the camera's follow target.
 */
export class PlayerController implements CameraTarget {
  firstPerson = true;
  /** set false during cutscenes */
  enabled = true;
  /** when false, look is allowed but not movement (e.g. while bound) */
  canMove = true;
  canJump = true;
  sprinting = false;
  sneaking = false;
  bodyYaw = 0;
  private ch: JoltType.CharacterVirtual;
  private update_: JoltType.ExtendedUpdateSettings;
  private gravity: JoltType.Vec3;
  private vel = new Vector3();
  private airTime = 0;
  private jumping = false;
  private offStep: () => void;
  private eyeHeight = 1.62;
  speed = 0;

  constructor(
    private physics: Physics,
    private rig: CameraRig,
    public body: Character,
    start: Vector3,
    yaw: number,
  ) {
    const J = physics.J;
    const s = new J.CharacterVirtualSettings();
    // capsule standing on the origin (feet at the character position)
    const capsule = new J.CapsuleShapeSettings(HEIGHT / 2 - RADIUS, RADIUS);
    const offset = new J.Vec3(0, HEIGHT / 2, 0);
    const rot = new J.Quat(0, 0, 0, 1);
    const shapeSettings = new J.RotatedTranslatedShapeSettings(offset, rot, capsule);
    s.mShape = shapeSettings.Create().Get();
    s.mMaxSlopeAngle = (50 * Math.PI) / 180;
    s.mMass = 80;
    s.mMaxStrength = 200;
    s.mCharacterPadding = 0.02;
    s.mPenetrationRecoverySpeed = 1;
    s.mPredictiveContactDistance = 0.1;
    s.mSupportingVolume = new J.Plane(J.Vec3.prototype.sAxisY(), -RADIUS);
    const p = physics.rvec(start);
    this.ch = new J.CharacterVirtual(s, p, J.Quat.prototype.sIdentity(), physics.system);
    J.destroy(p);
    J.destroy(s);
    J.destroy(offset);
    J.destroy(rot);
    this.update_ = new J.ExtendedUpdateSettings();
    this.update_.mStickToFloorStepDown = new J.Vec3(0, -0.5, 0);
    this.update_.mWalkStairsStepUp = new J.Vec3(0, 0.45, 0);
    this.gravity = new J.Vec3(0, -9.81, 0);
    this.bodyYaw = yaw;
    rig.yaw = yaw;
    rig.pitch = -0.05;
    this.offStep = physics.onStep((dt) => this.step(dt));
  }

  get position() {
    const p = this.ch.GetPosition();
    return new Vector3(p.GetX(), p.GetY(), p.GetZ());
  }

  teleport(pos: Vector3, yaw?: number) {
    const p = this.physics.rvec(pos);
    this.ch.SetPosition(p);
    this.physics.J.destroy(p);
    this.vel.setAll(0);
    if (yaw !== undefined) {
      this.bodyYaw = yaw;
      this.rig.yaw = yaw;
    }
    this.syncBody();
  }

  get onGround() {
    return this.ch.GetGroundState() === this.physics.J.EGroundState_OnGround;
  }

  private step(dt: number) {
    const J = this.physics.J;
    let [mx, my] = this.enabled && this.canMove ? input.move() : [0, 0];
    const len = Math.hypot(mx, my);
    if (len > 1) {
      mx /= len;
      my /= len;
    }
    this.sneaking = this.enabled && input.down("sneak");
    this.sprinting = this.enabled && input.down("sprint") && my > 0.2 && !this.sneaking;
    const max = this.sneaking ? SPEED.sneak : this.sprinting ? SPEED.sprint : input.usingPad && len < 0.6 ? SPEED.walk : SPEED.run;
    // camera-relative direction (yaw: forward = (-sin, 0, -cos))
    const yaw = this.rig.yaw;
    const fx = -Math.sin(yaw), fz = -Math.cos(yaw);
    const rx = Math.cos(yaw), rz = -Math.sin(yaw);
    const want = new Vector3((fx * my + rx * mx) * max, 0, (fz * my + rz * mx) * max);

    this.ch.UpdateGroundVelocity();
    const grounded = this.onGround;
    const cur = this.ch.GetLinearVelocity();
    const v = new Vector3(cur.GetX(), cur.GetY(), cur.GetZ());
    const accel = grounded ? 14 : 3;
    v.x += (want.x - v.x) * Math.min(1, accel * dt);
    v.z += (want.z - v.z) * Math.min(1, accel * dt);
    if (grounded) {
      const gv = this.ch.GetGroundVelocity();
      v.y = gv.GetY();
      this.airTime = 0;
      if (this.jumping && v.y <= 0.01) {
        this.jumping = false;
        this.body.play("Jump_Land", { loop: false, blend: 0.1, offset: 0 });
      }
      if (this.enabled && this.canJump && this.canMove && input.pressed("jump")) {
        v.y = JUMP;
        this.jumping = true;
        this.body.play("Jump_Start", { loop: false, blend: 0.08, offset: 0 });
      }
    } else {
      this.airTime += dt;
      v.y -= 9.81 * dt;
    }
    const nv = this.physics.vec(v);
    this.ch.SetLinearVelocity(nv);
    J.destroy(nv);
    this.ch.ExtendedUpdate(dt, this.gravity, this.update_, this.physics.movingBPFilter, this.physics.movingObjFilter, this.physics.bodyFilter, this.physics.shapeFilter, this.physics.tempAllocator);
    const after = this.ch.GetLinearVelocity();
    this.vel.set(after.GetX(), after.GetY(), after.GetZ());
    this.speed = Math.hypot(this.vel.x, this.vel.z);
  }

  /** Per-frame (render rate): animation choice, body orientation, toggles. */
  update(dt: number) {
    if (this.enabled && input.pressed("togglePov")) this.firstPerson = !this.firstPerson;
    if (!this.firstPerson && this.rig.distance <= 1.25) {
      this.firstPerson = true;
      this.rig.distance = 2.2;
    }
    this.syncBody(dt);
    // locomotion clip from actual speed
    const sp = this.speed;
    if (!this.onGround && this.airTime > 0.25) this.body.play("Jump_Loop", { blend: 0.2 });
    else if (!this.jumping || this.onGround) {
      if (this.sneaking) this.body.play(sp > 0.2 ? "Crouch_Fwd_Loop" : "Crouch_Idle_Loop", { blend: 0.25, speed: Math.max(0.6, sp / 1.3) });
      else if (sp < 0.15) this.body.play("Idle_Loop", { blend: 0.25 });
      else if (sp < 2.6) this.body.play("Walk_Loop", { blend: 0.25, speed: sp / 1.6 });
      else if (sp < 5) this.body.play("Jog_Fwd_Loop", { blend: 0.25, speed: sp / 3.6 });
      else this.body.play("Sprint_Loop", { blend: 0.25, speed: sp / 6 });
    }
    // hide the body in first person (the camera sits inside the head)
    const show = !this.firstPerson;
    for (const m of this.body.meshes) m.isVisible = show;
  }

  private syncBody(dt = 0) {
    const pos = this.position;
    this.body.root.position.copyFrom(pos);
    if (this.firstPerson) this.bodyYaw = this.rig.yaw;
    else if (this.speed > 0.3) {
      // turn the body toward the movement direction (characters face +Z, our forward is -Z)
      const target = Math.atan2(-this.vel.x, -this.vel.z);
      let d = target - this.bodyYaw;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      this.bodyYaw += d * Math.min(1, dt * 10);
    }
    const y = this.bodyYaw + Math.PI;
    this.body.root.rotationQuaternion ??= Quaternion.Identity();
    this.body.root.rotationQuaternion.set(0, Math.sin(y / 2), 0, Math.cos(y / 2));
  }

  // ------------------------------------------------------------------ CameraTarget
  eye(out: Vector3) {
    const p = this.position;
    const crouch = this.sneaking ? -0.45 : 0;
    const fx = -Math.sin(this.rig.yaw) * 0.12, fz = -Math.cos(this.rig.yaw) * 0.12;
    return out.set(p.x + fx, p.y + this.eyeHeight + crouch, p.z + fz);
  }
  pivot(out: Vector3) {
    const p = this.position;
    return out.set(p.x, p.y + (this.sneaking ? 1.1 : 1.5), p.z);
  }
  clip(from: Vector3, dir: Vector3, maxDist: number) {
    const hit = this.physics.rayCast(from, dir, maxDist + 0.3);
    return Math.max(0.4, Math.min(maxDist, hit - 0.3));
  }

  setEyeHeight(h: number) {
    this.eyeHeight = h;
  }

  dispose() {
    this.offStep();
    const J = this.physics.J;
    J.destroy(this.ch);
    J.destroy(this.update_);
    J.destroy(this.gravity);
  }
}
