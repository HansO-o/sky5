import { Quaternion, Vector3 } from "@babylonjs/core/Maths/math.vector";
import { input } from "../core/input";
import type { Physics } from "../engine/physics/Physics";
import { CapsuleMover } from "../engine/physics/CapsuleMover";
import { locomotionClip, type LocomotionClips } from "../engine/character/locomotion";
import { RootMotionTrack, type RootMotionCurve, type RootMotionLimits } from "../engine/anim/rootMotion";
import type { Equipment } from "../engine/actors/Equipment";
import type { Disposer } from "../engine/core/types";
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

/** seconds the camera takes between the eye and the shoulder when a body clip or a weapon takes it to third person */
const POV_BLEND = 0.25;

export interface ScriptedOptions {
  /** loop the clip (default false: a one-shot) */
  loop?: boolean;
  speed?: number;
  /** cross-fade in (s; default 0.25) */
  blend?: number;
  /** take the camera to third person while the clip plays (default true) */
  camera?: boolean;
  /** a one-shot holds its last pose until `clearScripted()` instead of returning to locomotion (default false) */
  hold?: boolean;
  /** movement allowed meanwhile, as a fraction of normal speed (default 0: locked) */
  move?: number;
}

interface Scripted {
  clip: string;
  loop: boolean;
  speed: number;
  hold: boolean;
  move: number;
  /** clip time left (s at rate 1); Infinity for loops */
  left: number;
  ended: boolean;
  pov: Disposer | null;
  resolve: (r: { completed: boolean }) => void;
}

/**
 * Player movement on a Jolt CharacterVirtual capsule. Moves relative to the camera yaw, drives the
 * body's locomotion clips from the actual speed, and serves as the camera's follow target.
 */
export class PlayerController implements CameraTarget {
  /** set false during cutscenes */
  enabled = true;
  /** when false, look is allowed but not movement (e.g. while bound) */
  canMove = true;
  canJump = true;
  sprinting = false;
  sneaking = false;
  bodyYaw = 0;
  /**
   * Hold the body at this yaw instead of turning it toward the movement or the camera (combat sets
   * it for a swing or a knockback, so strafing doesn't skew the strike or the root motion); null:
   * free. A root-motion turn moves the lock with it.
   */
  faceLock: number | null = null;
  /** movement speed multiplier (combat: slowed while attacking or blocking) */
  moveScale = 1;
  /** the capsule (also what NPC movers and debris collide with) */
  readonly mover: CapsuleMover;
  /** what the player carries (weapon, shield), set up by the gear (null: nothing) */
  equipment: Equipment | null = null;
  /** read by the camera rig when the point of view changes: seconds to blend (0 cuts) */
  povBlend = 0;
  private preferFirst = true;
  private povHolds = new Set<object>();
  private scripted_: Scripted | null = null;
  private bound_ = false;
  private boundFns = new Set<(on: boolean) => void>();
  private motion: { track: RootMotionTrack; target: (() => { x: number; z: number } | null) | null } | null = null;
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

  // ------------------------------------------------------------------ point of view

  /**
   * First person, unless something holds the camera in third person (a body clip, a drawn weapon:
   * {@link holdThirdPerson}). Setting it sets the player's own choice, which comes back when the
   * holds end; the switch is a cut.
   */
  get firstPerson() {
    return this.preferFirst && this.povHolds.size === 0;
  }
  set firstPerson(on: boolean) {
    this.povBlend = 0;
    this.preferFirst = on;
  }

  /**
   * Third person until the disposer is called (several holds may overlap); the camera blends
   * between the eye and the shoulder over `blend` seconds both ways.
   */
  holdThirdPerson(blend = POV_BLEND): Disposer {
    const key = {};
    this.povBlend = blend;
    this.povHolds.add(key);
    return () => {
      if (!this.povHolds.delete(key)) return;
      this.povBlend = blend;
    };
  }

  // ------------------------------------------------------------------ scripted body clips

  /** The body clip a script is playing (bonds, chest, lever, potion), or null. */
  get scripted() {
    return this.scripted_?.clip ?? null;
  }

  /**
   * Play a body clip for a script (opening a chest, pulling a lever, drinking): locomotion stops
   * choosing clips, movement is locked (or slowed, `move`) and the camera goes to third person
   * with a short blend. A one-shot returns to locomotion at its end (unless `hold`); a loop plays
   * until {@link clearScripted}. Resolves when the one-shot ends ({completed: true}), or when it is
   * cleared or replaced first ({completed: false}). A clip the body lacks (combat clips not loaded)
   * resolves {completed: false} at once and changes nothing.
   */
  playScripted(clip: string, o: ScriptedOptions = {}): Promise<{ completed: boolean }> {
    if (!this.body.hasClip(clip)) {
      console.warn(`player: no clip ${clip}`);
      return Promise.resolve({ completed: false });
    }
    const { loop = false, speed = 1, blend = 0.25, camera = true, hold = false, move = 0 } = o;
    const prev = this.scripted_;
    // a camera hold carries over to the next clip (no blend out and back in)
    const pov = camera ? (prev?.pov ?? this.holdThirdPerson()) : null;
    if (prev) {
      if (!camera) prev.pov?.();
      prev.pov = null;
      this.scripted_ = null;
      prev.resolve({ completed: false });
    }
    this.body.play(clip, { loop, speed, blend, offset: 0 });
    return new Promise((resolve) => {
      this.scripted_ = {
        clip,
        loop,
        speed: Math.max(0.01, speed),
        hold,
        move: Math.max(0, move),
        left: loop ? Infinity : this.body.clipLength(clip),
        ended: false,
        pov,
        resolve,
      };
    });
  }

  /** Back to locomotion (and the player's own point of view); a running clip resolves {completed: false}. */
  clearScripted() {
    const sc = this.scripted_;
    if (!sc) return;
    this.scripted_ = null;
    sc.pov?.();
    sc.resolve({ completed: sc.ended });
  }

  /** Advance the scripted clip's clock (game time). */
  private stepScripted(dt: number) {
    const sc = this.scripted_;
    if (!sc || sc.ended) return;
    sc.left -= dt * sc.speed;
    if (sc.left > 0) return;
    sc.ended = true;
    if (sc.hold) sc.resolve({ completed: true });
    else this.clearScripted();
  }

  // ------------------------------------------------------------------ bonds and arms

  /** Hands tied (the gear shows the cuffs; nothing can be drawn). */
  get bound() {
    return this.bound_;
  }
  set bound(on: boolean) {
    if (this.bound_ === on) return;
    this.bound_ = on;
    for (const fn of [...this.boundFns]) fn(on);
  }

  /** Called whenever {@link bound} changes. */
  onBound(fn: (on: boolean) => void): Disposer {
    this.boundFns.add(fn);
    return () => {
      this.boundFns.delete(fn);
    };
  }

  /** A weapon is in hand. */
  get armed() {
    return this.equipment?.armed ?? false;
  }

  // ------------------------------------------------------------------ root motion

  /**
   * Move the capsule along an attack clip's root-motion curve (from `world.rootMotion`), started
   * with the clip at the same rate: each fixed step the curve's travel becomes the capsule's
   * velocity (limited to 3 m/s with the rest carried over, and kept 0.9 m off `target`). Input
   * movement still adds, scaled by `moveScale`. False (nothing happens) without a curve.
   */
  startRootMotion(curve: RootMotionCurve | null | undefined, o: { speed?: number; target?: () => { x: number; z: number } | null; limits?: RootMotionLimits } = {}) {
    if (!curve || !curve.moves) {
      this.motion = null;
      return false;
    }
    this.motion = { track: new RootMotionTrack(curve, o.speed ?? 1, o.limits), target: o.target ?? null };
    return true;
  }

  stopRootMotion() {
    this.motion = null;
  }

  /** Root motion is moving the capsule. */
  get rootMotion() {
    return !!this.motion;
  }

  // ------------------------------------------------------------------ body

  /**
   * Swap in a rebuilt body (another outfit, another sex): it is placed and turned at once, the
   * equipment moves over to its joints and a scripted clip carries on on it. `heightScale` sets
   * the eye height to match.
   */
  setBody(body: Character, heightScale?: number) {
    if (heightScale !== undefined) this.setEyeHeight(1.62 * heightScale);
    if (body === this.body) return;
    this.body = body;
    this.turnBody();
    this.placeBody();
    this.equipment?.rebind();
    const sc = this.scripted_;
    if (sc && !sc.ended && body.hasClip(sc.clip)) body.play(sc.clip, { loop: sc.loop, speed: sc.speed, blend: 0, offset: sc.loop ? 0 : Math.max(0, 1 - sc.left / Math.max(1e-6, body.clipLength(sc.clip))) });
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
      if (this.faceLock !== null) this.faceLock = yaw;
    }
    this.turnBody();
    this.placeBody();
  }

  get onGround() {
    return this.mover.onGround;
  }

  private step(dt: number) {
    const sc = this.scripted_;
    const moveFrac = sc ? sc.move : 1;
    let [mx, my] = this.enabled && this.canMove && moveFrac > 0 ? input.move() : [0, 0];
    const len = Math.hypot(mx, my);
    if (len > 1) {
      mx /= len;
      my /= len;
    }
    this.sneaking = this.enabled && input.down("sneak");
    this.sprinting = this.enabled && input.down("sprint") && my > 0.2 && !this.sneaking && !sc;
    const max = (this.sneaking ? SPEED.sneak : this.sprinting ? SPEED.sprint : input.usingPad && len < 0.6 ? SPEED.walk : SPEED.run) * this.moveScale * moveFrac;
    // camera-relative direction (yaw: forward = (-sin, 0, -cos))
    const yaw = this.rig.yaw;
    const fx = -Math.sin(yaw), fz = -Math.cos(yaw);
    const rx = Math.cos(yaw), rz = -Math.sin(yaw);
    // the press was latched by update() (a frame may run no step); the mover also takes it just
    // after walking off an edge
    this.jumpBuffer = Math.max(0, this.jumpBuffer - dt);
    let vx = (fx * my + rx * mx) * max, vz = (fz * my + rz * mx) * max;
    // an attack's root motion carries the capsule (exactly: not eased like stick input)
    const rm = this.motion;
    let snap = false;
    if (rm) {
      const p = this.mover.position;
      const st = rm.track.step(dt, this.bodyYaw, p.x, p.z, rm.target?.() ?? null);
      vx += st.vx;
      vz += st.vz;
      this.bodyYaw += st.dyaw;
      if (this.faceLock !== null) this.faceLock += st.dyaw;
      snap = true;
      if (st.done) this.motion = null;
    }
    const r = this.mover.step({ vx, vz, snap, jump: this.jumpBuffer > 0 && this.enabled && this.canJump && this.canMove && !sc && !rm }, dt);
    if (r.landed && !sc) this.body.play(CLIPS.jumpLand, { loop: false, blend: 0.1, offset: 0 });
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
    // the player's own choice (a hold keeps third person meanwhile)
    if (this.enabled && input.pressed("togglePov")) this.firstPerson = !this.preferFirst;
    if (this.enabled && input.pressed("jump")) this.jumpBuffer = JUMP_BUFFER;
    // zoomed all the way in on the player's own third person: first person
    if (!this.preferFirst && this.rig.distance <= 1.25) {
      this.firstPerson = true;
      this.rig.distance = 2.2;
    }
    this.stepScripted(dt);
    this.turnBody(dt);
    // a script's clip (or an action like a draw) has the body
    if (this.scripted_) return;
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
    // walls have pushed the camera into it; decided here, after this frame's rig.update placed it.
    // While the camera blends between the eye and the shoulder, it shows once the camera is clear of the head.
    const following = this.rig.mode === "player";
    const show = (following ? this.rig.povMix > 0.35 : !this.firstPerson) && !this.rig.closeUp;
    for (const m of this.body.meshes) m.isVisible = show;
    this.equipment?.setVisible(show);
  };

  /** Body heading: per frame in update(), before chapter scripts that may override it (the creator's turntable). */
  private turnBody(dt = 0) {
    if (this.faceLock !== null) this.bodyYaw = this.faceLock;
    else if (this.firstPerson) this.bodyYaw = this.rig.yaw;
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
    const sc = this.scripted_;
    this.scripted_ = null;
    sc?.resolve({ completed: false });
    this.boundFns.clear();
    this.mover.dispose();
  }
}
