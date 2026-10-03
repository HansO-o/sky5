import { Quaternion, Vector3 } from "@babylonjs/core/Maths/math.vector";
import { input } from "../core/input";
import type { Physics } from "../engine/physics/Physics";
import { CapsuleMover } from "../engine/physics/CapsuleMover";
import { locomotionClip, type LocomotionClips } from "../engine/character/locomotion";
import type { Character } from "../world/characters";
import type { CameraRig, CameraTarget } from "./camera";

const SPEED = { sneak: 1.4, walk: 1.9, run: 3.9, sprint: 6.2 };
/** a jump press counts this long (s): it is read at render rate, the jump happens in the next fixed step */
const JUMP_BUFFER = 0.15;
/**
 * The player's capsule (r 0.3, h 1.8, step-up 0.45, stick-down 0.5, jump 4.6 m/s, coyote 0.12 s,
 * back to the last footing after a 40 m fall), with an inner body on the MOVING layer so NPC
 * movers and debris meet the player.
 */
const MOVER = { radius: 0.3, height: 1.8, jumpSpeed: 4.6, coyote: 0.12, fallLimit: 40 };
/**
 * The body's locomotion clips. Rates are the clips' native foot speeds (walk 0.95 m/s, crouch
 * 0.6 m/s), so the feet stay planted instead of sliding.
 */
const CLIPS: LocomotionClips = {
  idle: "Idle_Loop",
  walk: "Walk_Loop",
  jog: "Jog_Fwd_Loop",
  sprint: "Sprint_Loop",
  crouchIdle: "Crouch_Idle_Loop",
  crouchMove: "Crouch_Fwd_Loop",
  jumpStart: "Jump_Start",
  jumpLoop: "Jump_Loop",
  jumpLand: "Jump_Land",
  below: { idle: 0.15, walk: 2.6, jog: 5, crouch: 0.2 },
  rate: { crouch: 0.6, walk: 0.95, jog: 3.6, sprint: 6 },
  minRate: { crouch: 0.6 },
};

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
  /** the capsule (also what NPC movers and debris collide with) */
  readonly mover: CapsuleMover;
  private jumpBuffer = 0;
  private offStep: () => void;
  private eyeHeight = 1.62;

  constructor(
    private physics: Physics,
    private rig: CameraRig,
    public body: Character,
    start: Vector3,
    yaw: number,
  ) {
    this.mover = new CapsuleMover(physics, start, MOVER);
    this.bodyYaw = yaw;
    rig.yaw = yaw;
    rig.pitch = -0.05;
    this.offStep = physics.onStep((dt) => this.step(dt));
    // the body goes where the capsule is drawn this frame: after the frame's physics steps (which
    // run after update()), so it doesn't trail the camera by however many steps the frame took
    body.scene.onBeforeRenderObservable.add(this.placeBody, undefined, true);
  }

  get position() {
    return this.mover.position;
  }

  /** Where the capsule is drawn: between the last two fixed steps (smooth above 60 Hz). */
  private get renderPosition() {
    return this.mover.renderPosition;
  }

  /** horizontal speed after the last fixed step (m/s) */
  get speed() {
    return this.mover.speed;
  }

  teleport(pos: Vector3, yaw?: number) {
    this.mover.teleport(pos);
    if (yaw !== undefined) {
      this.bodyYaw = yaw;
      this.rig.yaw = yaw;
    }
    this.turnBody();
    this.placeBody();
  }

  get onGround() {
    return this.mover.onGround;
  }

  private step(dt: number) {
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
    // the press was latched by update() (a frame may run no step); the mover also takes it just
    // after walking off an edge
    this.jumpBuffer = Math.max(0, this.jumpBuffer - dt);
    const r = this.mover.step({ vx: (fx * my + rx * mx) * max, vz: (fz * my + rz * mx) * max, jump: this.jumpBuffer > 0 && this.enabled && this.canJump && this.canMove }, dt);
    if (r.landed) this.body.play(CLIPS.jumpLand, { loop: false, blend: 0.1, offset: 0 });
    if (r.jumped) {
      this.jumpBuffer = 0;
      this.body.play(CLIPS.jumpStart, { loop: false, blend: 0.08, offset: 0 });
    }
    // fell out of the world: the mover put the capsule back on its last footing; the body follows
    if (r.recovered) {
      this.turnBody();
      this.placeBody();
    }
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
    if (!this.onGround && this.mover.airTime > 0.25) this.body.play(CLIPS.jumpLoop, { blend: 0.2 });
    else if (!this.mover.jumping || this.onGround) {
      const pick = locomotionClip(sp, this.sneaking, CLIPS);
      this.body.play(pick.clip, { blend: 0.25, speed: pick.speed });
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
      const v = this.mover.velocity;
      const target = Math.atan2(-v.x, -v.z);
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
  // camera rays meet static geometry only (not the player's own inner body, NPCs or loose debris)
  clip(from: Vector3, dir: Vector3, maxDist: number) {
    const hit = this.physics.rayCastStatic(from, dir, maxDist + 0.3);
    // keep 0.3 m off the surface; closer than that allows, come in to 0.1 m off it (never past it)
    return Math.max(0, Math.min(maxDist, Math.max(hit - 0.3, Math.min(0.4, hit - 0.1))));
  }

  rayDist(from: Vector3, dir: Vector3, maxDist: number) {
    return this.physics.rayCastStatic(from, dir, maxDist);
  }

  setEyeHeight(h: number) {
    this.eyeHeight = h;
  }

  dispose() {
    this.offStep();
    this.body.scene.onBeforeRenderObservable.removeCallback(this.placeBody);
    this.mover.dispose();
  }
}
