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
/** a jump press counts this long (s): it is read at render rate, the jump happens in the next fixed step */
const JUMP_BUFFER = 0.15;
/** jumping still works this long (s) after walking off an edge */
const COYOTE = 0.12;
/** falling this far (m) below where the player last stood means they fell through the world */
const FALL_LIMIT = 40;

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
  private jumpBuffer = 0;
  /** capsule position before and after the last fixed step; rendering blends them by physics.alpha */
  private prevPos = new Vector3();
  private curPos = new Vector3();
  private lerpPos = new Vector3();
  /** last place the player stood on the terrain (recovery from falling out of the world) */
  private lastSafe = new Vector3();
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
    // value attributes copy what they are given: free the temporaries
    const plane = new J.Plane(J.Vec3.prototype.sAxisY(), -RADIUS);
    s.mSupportingVolume = plane;
    J.destroy(plane);
    const p = physics.rvec(start);
    this.ch = new J.CharacterVirtual(s, p, J.Quat.prototype.sIdentity(), physics.system);
    J.destroy(p);
    J.destroy(s);
    // the settings cache a reference to the created shape (the character holds its own) and own the capsule settings
    J.destroy(shapeSettings);
    J.destroy(offset);
    J.destroy(rot);
    this.update_ = new J.ExtendedUpdateSettings();
    const down = new J.Vec3(0, -0.5, 0), up = new J.Vec3(0, 0.45, 0);
    this.update_.mStickToFloorStepDown = down;
    this.update_.mWalkStairsStepUp = up;
    J.destroy(down);
    J.destroy(up);
    this.gravity = new J.Vec3(0, -9.81, 0);
    this.prevPos.copyFrom(start);
    this.curPos.copyFrom(start);
    this.lastSafe.copyFrom(start);
    this.bodyYaw = yaw;
    rig.yaw = yaw;
    rig.pitch = -0.05;
    this.offStep = physics.onStep((dt) => this.step(dt));
    // the body goes where the capsule is drawn this frame: after the frame's physics steps (which
    // run after update()), so it doesn't trail the camera by however many steps the frame took
    body.scene.onBeforeRenderObservable.add(this.placeBody, undefined, true);
  }

  get position() {
    const p = this.ch.GetPosition();
    return new Vector3(p.GetX(), p.GetY(), p.GetZ());
  }

  /** Where the capsule is drawn: between the last two fixed steps (smooth above 60 Hz). */
  private get renderPosition() {
    return Vector3.LerpToRef(this.prevPos, this.curPos, this.physics.alpha, this.lerpPos);
  }

  teleport(pos: Vector3, yaw?: number) {
    const ph = this.physics;
    const p = ph.rvec(pos);
    this.ch.SetPosition(p);
    ph.J.destroy(p);
    const zero = ph.vec(Vector3.ZeroReadOnly);
    this.ch.SetLinearVelocity(zero);
    ph.J.destroy(zero);
    this.ch.RefreshContacts(ph.movingBPFilter, ph.movingObjFilter, ph.bodyFilter, ph.shapeFilter, ph.tempAllocator);
    this.vel.setAll(0);
    this.airTime = 0;
    this.prevPos.copyFrom(pos);
    this.curPos.copyFrom(pos);
    this.lastSafe.copyFrom(pos);
    if (yaw !== undefined) {
      this.bodyYaw = yaw;
      this.rig.yaw = yaw;
    }
    this.turnBody();
    this.placeBody();
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
    } else {
      this.airTime += dt;
      v.y -= 9.81 * dt;
    }
    // the press was latched by update() (a frame may run no step); also just after walking off an edge
    this.jumpBuffer = Math.max(0, this.jumpBuffer - dt);
    if (this.jumpBuffer > 0 && (grounded || (!this.jumping && this.airTime < COYOTE)) && this.enabled && this.canJump && this.canMove) {
      v.y = JUMP;
      this.jumping = true;
      this.jumpBuffer = 0;
      this.body.play("Jump_Start", { loop: false, blend: 0.08, offset: 0 });
    }
    const nv = this.physics.vec(v);
    this.ch.SetLinearVelocity(nv);
    J.destroy(nv);
    this.prevPos.copyFrom(this.curPos);
    this.ch.ExtendedUpdate(dt, this.gravity, this.update_, this.physics.movingBPFilter, this.physics.movingObjFilter, this.physics.bodyFilter, this.physics.shapeFilter, this.physics.tempAllocator);
    const after = this.ch.GetLinearVelocity();
    this.vel.set(after.GetX(), after.GetY(), after.GetZ());
    this.speed = Math.hypot(this.vel.x, this.vel.z);
    const p = this.ch.GetPosition();
    this.curPos.set(p.GetX(), p.GetY(), p.GetZ());
    // The terrain collider ends a while past the town (the road goes on) and anything can have a
    // gap: off the height field, or far below the last footing, put the player back there.
    const cp = this.curPos;
    if (this.onGround) {
      if (this.physics.inBounds(cp.x, cp.z, 1)) this.lastSafe.copyFrom(cp);
    } else if (!this.physics.inBounds(cp.x, cp.z) || cp.y < this.lastSafe.y - FALL_LIMIT) this.teleport(this.lastSafe.clone());
  }

  /** Per-frame (render rate): animation choice, body orientation, toggles. */
  update(dt: number) {
    if (this.enabled && input.pressed("togglePov")) this.firstPerson = !this.firstPerson;
    if (this.enabled && input.pressed("jump")) this.jumpBuffer = JUMP_BUFFER;
    if (!this.firstPerson && this.rig.distance <= 1.25) {
      this.firstPerson = true;
      this.rig.distance = 2.2;
    }
    this.turnBody(dt);
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
  }

  /** Body position and visibility: render time (scene.onBeforeRenderObservable), see the constructor. */
  private placeBody = () => {
    this.body.root.position.copyFrom(this.renderPosition);
    // hide the body in first person (the camera sits inside the head), and in third person when
    // walls have pushed the camera into it; decided here, after this frame's rig.update placed it
    const show = !this.firstPerson && !this.rig.closeUp;
    for (const m of this.body.meshes) m.isVisible = show;
  };

  /** Body heading: per frame in update(), before chapter scripts that may override it (the creator's turntable). */
  private turnBody(dt = 0) {
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
    const p = this.renderPosition;
    const crouch = this.sneaking ? -0.45 : 0;
    const fx = -Math.sin(this.rig.yaw) * 0.12, fz = -Math.cos(this.rig.yaw) * 0.12;
    return out.set(p.x + fx, p.y + this.eyeHeight + crouch, p.z + fz);
  }
  pivot(out: Vector3) {
    const p = this.renderPosition;
    return out.set(p.x, p.y + (this.sneaking ? 1.1 : 1.5), p.z);
  }
  clip(from: Vector3, dir: Vector3, maxDist: number) {
    const hit = this.physics.rayCast(from, dir, maxDist + 0.3);
    // keep 0.3 m off the surface; closer than that allows, come in to 0.1 m off it (never past it)
    return Math.max(0, Math.min(maxDist, Math.max(hit - 0.3, Math.min(0.4, hit - 0.1))));
  }

  rayDist(from: Vector3, dir: Vector3, maxDist: number) {
    return this.physics.rayCast(from, dir, maxDist);
  }

  setEyeHeight(h: number) {
    this.eyeHeight = h;
  }

  dispose() {
    this.offStep();
    this.body.scene.onBeforeRenderObservable.removeCallback(this.placeBody);
    const J = this.physics.J;
    J.destroy(this.ch);
    J.destroy(this.update_);
    J.destroy(this.gravity);
  }
}
