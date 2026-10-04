import type JoltType from "jolt-physics/wasm";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { Disposer } from "../core/types";
import { L, type BodyId, type Physics } from "./Physics";

/** Shape and feel of a {@link CapsuleMover}. Defaults are the player's. */
export interface CapsuleMoverOptions {
  /** capsule radius (m) */
  radius?: number;
  /** capsule height, feet to crown (m) */
  height?: number;
  /** steepest walkable slope (degrees) */
  maxSlopeDeg?: number;
  mass?: number;
  /** push force on dynamic bodies (N) */
  strength?: number;
  /** stairs: highest step climbed without a jump (m) */
  stepUp?: number;
  /** stays on the floor going down steps and slopes up to this drop (m) */
  stickDown?: number;
  gravity?: number;
  /** take-off speed of a jump (m/s) */
  jumpSpeed?: number;
  /** a jump still works this long (s) after walking off an edge */
  coyote?: number;
  /** how fast the horizontal velocity follows the intent (1/s) on the ground and in the air */
  accel?: { ground: number; air: number };
  /**
   * Fell this far (m) below the last footing, or off every height field: put back there. Null: no
   * recovery.
   */
  fallLimit?: number | null;
  /**
   * Object layer of the kinematic inner body that lets other characters, debris and ray casts meet
   * this one (its own movement ignores it); false for none.
   */
  innerBodyLayer?: number | false;
}

/** What a mover should do this step: horizontal velocity (m/s, world) and whether to jump. */
export interface MoveIntent {
  vx: number;
  vz: number;
  jump?: boolean;
  /**
   * take the horizontal velocity as given this step instead of easing toward it (root motion: the
   * clip's travel must not be smoothed away)
   */
  snap?: boolean;
}

export interface MoveResult {
  /** took off this step */
  jumped: boolean;
  /** came down from a jump this step */
  landed: boolean;
  /** fell out of the world and was put back on its last footing */
  recovered: boolean;
}

const DEFAULTS = {
  radius: 0.3,
  height: 1.8,
  maxSlopeDeg: 50,
  mass: 80,
  strength: 200,
  stepUp: 0.45,
  stickDown: 0.5,
  gravity: 9.81,
  jumpSpeed: 4.6,
  coyote: 0.12,
  accel: { ground: 14, air: 3 },
  fallLimit: 40 as number | null,
  innerBodyLayer: L.MOVING as number | false,
};

/**
 * A walking capsule on a Jolt CharacterVirtual (feet at its position): accelerates toward the
 * intended velocity, climbs steps, sticks to slopes, jumps, falls, and recovers from falling out
 * of the world. Used by the player, combat NPCs and the companion in combat. Step it every fixed
 * physics step: from your own `physics.onStep` (the player) or through {@link drive}.
 */
export class CapsuleMover {
  readonly radius: number;
  readonly height: number;
  private o: typeof DEFAULTS;
  private ch: JoltType.CharacterVirtual;
  private update_: JoltType.ExtendedUpdateSettings;
  private gravity: JoltType.Vec3;
  private vel = new Vector3();
  private air = 0;
  private inJump = false;
  /** capsule position before and after the last fixed step; rendering blends them by physics.alpha */
  private prevPos = new Vector3();
  private curPos = new Vector3();
  private lerpPos = new Vector3();
  /** last place it stood on a height field (recovery from falling out of the world) */
  private lastSafe = new Vector3();
  private drivers = new Set<Disposer>();
  private disposed = false;
  /** horizontal speed after the last step (m/s) */
  speed = 0;

  constructor(
    private physics: Physics,
    start: Vector3,
    o: CapsuleMoverOptions = {},
  ) {
    this.o = { ...DEFAULTS, ...o, accel: { ...DEFAULTS.accel, ...o.accel } };
    const { radius, height } = this.o;
    this.radius = radius;
    this.height = height;
    const J = physics.J;
    const s = new J.CharacterVirtualSettings();
    // capsule standing on the origin (feet at the character position)
    const capsule = new J.CapsuleShapeSettings(height / 2 - radius, radius);
    const offset = new J.Vec3(0, height / 2, 0);
    const rot = new J.Quat(0, 0, 0, 1);
    const shapeSettings = new J.RotatedTranslatedShapeSettings(offset, rot, capsule);
    const shape = shapeSettings.Create().Get();
    s.mShape = shape;
    if (this.o.innerBodyLayer !== false) {
      s.mInnerBodyShape = shape;
      s.mInnerBodyLayer = this.o.innerBodyLayer;
    }
    s.mMaxSlopeAngle = (this.o.maxSlopeDeg * Math.PI) / 180;
    s.mMass = this.o.mass;
    s.mMaxStrength = this.o.strength;
    s.mCharacterPadding = 0.02;
    s.mPenetrationRecoverySpeed = 1;
    s.mPredictiveContactDistance = 0.1;
    // value attributes copy what they are given: free the temporaries
    const plane = new J.Plane(J.Vec3.prototype.sAxisY(), -radius);
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
    const down = new J.Vec3(0, -this.o.stickDown, 0), up = new J.Vec3(0, this.o.stepUp, 0);
    this.update_.mStickToFloorStepDown = down;
    this.update_.mWalkStairsStepUp = up;
    J.destroy(down);
    J.destroy(up);
    this.gravity = new J.Vec3(0, -this.o.gravity, 0);
    this.prevPos.copyFrom(start);
    this.curPos.copyFrom(start);
    this.lastSafe.copyFrom(start);
  }

  /** Where the capsule's feet are now (a new vector). */
  get position() {
    const p = this.ch.GetPosition();
    return new Vector3(p.GetX(), p.GetY(), p.GetZ());
  }

  /** Where the capsule is drawn: between the last two fixed steps (smooth above 60 Hz). Shared vector. */
  get renderPosition() {
    return Vector3.LerpToRef(this.prevPos, this.curPos, this.physics.alpha, this.lerpPos);
  }

  /** Velocity after the last step (shared vector: read, don't keep). */
  get velocity(): Readonly<Vector3> {
    return this.vel;
  }

  get onGround() {
    return this.ch.GetGroundState() === this.physics.J.EGroundState_OnGround;
  }

  /** In the air after a jump (until the landing step). */
  get jumping() {
    return this.inJump;
  }

  /** Seconds since it last stood on the ground (0 on the ground). */
  get airTime() {
    return this.air;
  }

  /** The kinematic inner body other characters and rays meet (null without one). */
  get innerBody(): BodyId | null {
    const id = this.ch.GetInnerBodyID();
    const v = id.GetIndexAndSequenceNumber();
    // Jolt's invalid id (0xffffffff, read back signed or not)
    return v === 0xffffffff || v === -1 ? null : id;
  }

  /** Put the capsule at `pos` at rest (also becomes its last footing). */
  teleport(pos: Vector3) {
    const ph = this.physics;
    const p = ph.rvec(pos);
    this.ch.SetPosition(p);
    ph.J.destroy(p);
    const zero = ph.vec(Vector3.ZeroReadOnly);
    this.ch.SetLinearVelocity(zero);
    ph.J.destroy(zero);
    this.ch.RefreshContacts(ph.movingBPFilter, ph.movingObjFilter, ph.bodyFilter, ph.shapeFilter, ph.tempAllocator);
    this.vel.setAll(0);
    this.speed = 0;
    this.air = 0;
    this.prevPos.copyFrom(pos);
    this.curPos.copyFrom(pos);
    this.lastSafe.copyFrom(pos);
  }

  /** One fixed step toward `intent`. */
  step(intent: MoveIntent, dt: number): MoveResult {
    const J = this.physics.J;
    const o = this.o;
    this.ch.UpdateGroundVelocity();
    const grounded = this.onGround;
    const cur = this.ch.GetLinearVelocity();
    const v = new Vector3(cur.GetX(), cur.GetY(), cur.GetZ());
    const accel = grounded ? o.accel.ground : o.accel.air;
    const k = intent.snap ? 1 : Math.min(1, accel * dt);
    v.x += (intent.vx - v.x) * k;
    v.z += (intent.vz - v.z) * k;
    let landed = false, jumped = false, recovered = false;
    if (grounded) {
      const gv = this.ch.GetGroundVelocity();
      v.y = gv.GetY();
      this.air = 0;
      if (this.inJump && v.y <= 0.01) {
        this.inJump = false;
        landed = true;
      }
    } else {
      this.air += dt;
      v.y -= o.gravity * dt;
    }
    // on the ground, or just after walking off an edge
    if (intent.jump && (grounded || (!this.inJump && this.air < o.coyote))) {
      v.y = o.jumpSpeed;
      this.inJump = true;
      jumped = true;
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
    // The terrain collider ends a while past the town and anything can have a gap: off the height
    // field, or far below the last footing, go back there.
    if (o.fallLimit !== null) {
      const cp = this.curPos;
      if (this.onGround) {
        if (this.physics.inBounds(cp.x, cp.z, 1)) this.lastSafe.copyFrom(cp);
      } else if (!this.physics.inBounds(cp.x, cp.z) || cp.y < this.lastSafe.y - o.fallLimit) {
        this.teleport(this.lastSafe.clone());
        recovered = true;
      }
    }
    return { jumped, landed, recovered };
  }

  /**
   * Step every fixed physics step toward the intent `source` returns (NPCs: the brain sets a
   * desired velocity, the mover follows). Undone by the returned disposer or by dispose().
   */
  drive(source: (dt: number) => MoveIntent, onResult?: (r: MoveResult) => void): Disposer {
    const off = this.physics.onStep((dt) => {
      const r = this.step(source(dt), dt);
      onResult?.(r);
    });
    const d = () => {
      off();
      this.drivers.delete(d);
    };
    this.drivers.add(d);
    return d;
  }

  /** Frees the character (and its inner body). Idempotent. */
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    for (const d of [...this.drivers]) d();
    const J = this.physics.J;
    J.destroy(this.update_);
    J.destroy(this.gravity);
    // a physics world disposed first has freed the system (and the inner body in it): the
    // character's destructor would remove that body from freed memory
    if (!this.physics.isDisposed) J.destroy(this.ch);
  }
}
