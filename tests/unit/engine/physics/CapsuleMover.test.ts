import { test } from "node:test";
import assert from "node:assert/strict";
import type JoltType from "jolt-physics/wasm";
import { Quaternion, Vector3 } from "@babylonjs/core/Maths/math.vector";
import { CapsuleMover } from "../../../../src/engine/physics/CapsuleMover";
import type { Physics } from "../../../../src/engine/physics/Physics";
import { newPhysics, run } from "../../helpers/jolt";

/**
 * PlayerController.step as it was before CapsuleMover was extracted (input replaced by the same
 * intent the player now computes): the reference the mover must reproduce exactly.
 */
class LegacyPlayerStep {
  private ch: JoltType.CharacterVirtual;
  private update_: JoltType.ExtendedUpdateSettings;
  private gravity: JoltType.Vec3;
  private vel = new Vector3();
  private airTime = 0;
  private jumping = false;
  jumpBuffer = 0;
  private curPos = new Vector3();
  private lastSafe = new Vector3();
  speed = 0;
  events: string[] = [];

  constructor(
    private physics: Physics,
    start: Vector3,
  ) {
    const J = physics.J;
    const RADIUS = 0.3, HEIGHT = 1.8;
    const s = new J.CharacterVirtualSettings();
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
    const plane = new J.Plane(J.Vec3.prototype.sAxisY(), -RADIUS);
    s.mSupportingVolume = plane;
    J.destroy(plane);
    const p = physics.rvec(start);
    this.ch = new J.CharacterVirtual(s, p, J.Quat.prototype.sIdentity(), physics.system);
    J.destroy(p);
    J.destroy(s);
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
    this.curPos.copyFrom(start);
    this.lastSafe.copyFrom(start);
  }

  get position() {
    const p = this.ch.GetPosition();
    return new Vector3(p.GetX(), p.GetY(), p.GetZ());
  }
  get onGround() {
    return this.ch.GetGroundState() === this.physics.J.EGroundState_OnGround;
  }

  private teleport(pos: Vector3) {
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
    this.curPos.copyFrom(pos);
    this.lastSafe.copyFrom(pos);
  }

  step(dt: number, want: { x: number; z: number }) {
    const J = this.physics.J;
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
        this.events.push("land");
      }
    } else {
      this.airTime += dt;
      v.y -= 9.81 * dt;
    }
    this.jumpBuffer = Math.max(0, this.jumpBuffer - dt);
    if (this.jumpBuffer > 0 && (grounded || (!this.jumping && this.airTime < 0.12))) {
      v.y = 4.6;
      this.jumping = true;
      this.jumpBuffer = 0;
      this.events.push("jump");
    }
    const nv = this.physics.vec(v);
    this.ch.SetLinearVelocity(nv);
    J.destroy(nv);
    this.ch.ExtendedUpdate(dt, this.gravity, this.update_, this.physics.movingBPFilter, this.physics.movingObjFilter, this.physics.bodyFilter, this.physics.shapeFilter, this.physics.tempAllocator);
    const after = this.ch.GetLinearVelocity();
    this.vel.set(after.GetX(), after.GetY(), after.GetZ());
    this.speed = Math.hypot(this.vel.x, this.vel.z);
    const p = this.ch.GetPosition();
    this.curPos.set(p.GetX(), p.GetY(), p.GetZ());
    const cp = this.curPos;
    if (this.onGround) {
      if (this.physics.inBounds(cp.x, cp.z, 1)) this.lastSafe.copyFrom(cp);
    } else if (!this.physics.inBounds(cp.x, cp.z) || cp.y < this.lastSafe.y - 40) this.teleport(this.lastSafe.clone());
  }
}

/** The new player step: jump buffer kept by the player, everything else by the mover. */
class MoverPlayerStep {
  jumpBuffer = 0;
  events: string[] = [];
  constructor(readonly mover: CapsuleMover) {}
  step(dt: number, want: { x: number; z: number }) {
    this.jumpBuffer = Math.max(0, this.jumpBuffer - dt);
    const r = this.mover.step({ vx: want.x, vz: want.z, jump: this.jumpBuffer > 0 }, dt);
    if (r.landed) this.events.push("land");
    if (r.jumped) {
      this.jumpBuffer = 0;
      this.events.push("jump");
    }
  }
}

/**
 * A test course along +x: flat ground, a flight of 14 stairs (0.214 m risers, 0.30 m treads) up
 * to a walkway at 3 m, a ledge at 6 m reached by a ramp, and a 4 m gap down to a roof at 3.4 m
 * (the tower breach to the inn, roughly).
 */
function course(ph: Physics) {
  ph.addBox(new Vector3(0, -0.5, 0), new Vector3(60, 0.5, 20));
  for (let i = 0; i < 14; i++) ph.addBox(new Vector3(4 + i * 0.3 + 0.15, (i + 1) * 0.107, 0), new Vector3(0.15, (i + 1) * 0.107, 2));
  ph.addBox(new Vector3(10.2, 1.5, 0), new Vector3(2, 1.5, 2));
  // a 30° ramp from the walkway (3 m) up to the ledge (6 m)
  const ramp = Quaternion.RotationAxis(new Vector3(0, 0, 1), Math.PI / 6);
  ph.addBox(new Vector3(14.8, 4.5, 0), new Vector3(3.47, 0.1, 2), ramp);
  ph.addBox(new Vector3(20, 3, 0), new Vector3(2, 3, 2));
  // gap x 22..26, then the roof at 3.4
  ph.addBox(new Vector3(31, 1.7, 0), new Vector3(5, 1.7, 3));
}

async function compareRuns(script: (t: number, p: Vector3) => { want: { x: number; z: number }; jump?: boolean }, seconds: number) {
  const phA = await newPhysics(), phB = await newPhysics();
  course(phA);
  course(phB);
  const start = new Vector3(0, 0.05, 0);
  const legacy = new LegacyPlayerStep(phA, start);
  const mover = new CapsuleMover(phB, start, { radius: 0.3, height: 1.8, jumpSpeed: 4.6, coyote: 0.12, fallLimit: 40 });
  const player = new MoverPlayerStep(mover);
  assert.ok(mover.innerBody, "the player mover has an inner body");
  phA.onStep((dt) => {
    const s = script(phA.step * stepsA++, legacy.position);
    if (s.jump) legacy.jumpBuffer = 0.15;
    legacy.step(dt, s.want);
  });
  phB.onStep((dt) => {
    const s = script(phB.step * stepsB++, mover.position);
    if (s.jump) player.jumpBuffer = 0.15;
    player.step(dt, s.want);
  });
  let stepsA = 0, stepsB = 0, maxDev = 0;
  const track: Vector3[] = [];
  // uneven frame times, as in the browser
  const frames = [1 / 60, 1 / 144, 1 / 30, 1 / 75, 1 / 60];
  for (let t = 0, k = 0; t < seconds; k++) {
    const dt = frames[k % frames.length];
    t += dt;
    phA.update(dt);
    phB.update(dt);
    const a = legacy.position, b = mover.position;
    maxDev = Math.max(maxDev, Vector3.Distance(a, b));
    track.push(b);
  }
  const out = { maxDev, legacy, player, mover, track, end: mover.position, legacyEnd: legacy.position };
  return {
    ...out,
    dispose() {
      mover.dispose();
      phA.dispose();
      phB.dispose();
    },
  };
}

test("CapsuleMover reproduces the player's old step exactly: stairs, ramp, sprint and the jump down a gap", async () => {
  // walk up the stairs, sprint up the ramp onto the ledge, jump the gap at its edge
  const r = await compareRuns((t, p) => {
    // walk the stairs, sprint up the ramp and over the gap, stop on the roof
    const speed = p.x < 10 ? 3.9 : p.x < 28 ? 6.2 : 0;
    return { want: { x: speed, z: 0 }, jump: p.x > 21.6 && p.x < 22 };
  }, 9);
  try {
    assert.equal(r.maxDev, 0, `trajectories diverge by up to ${r.maxDev} m`);
    assert.deepEqual(r.player.events, r.legacy.events);
    assert.ok(r.player.events.includes("jump") && r.player.events.includes("land"), `events ${r.player.events}`);
    // climbed the stairs (3 m) on the way
    assert.ok(r.track.some((p) => p.x > 8.5 && p.x < 12 && Math.abs(p.y - 3) < 0.05), "walked up onto the walkway");
    // made it across onto the roof
    assert.ok(r.end.x > 26 && Math.abs(r.end.y - 3.4) < 0.05, `landed at ${r.end}`);
  } finally {
    r.dispose();
  }
});

test("CapsuleMover: a jump pressed just after walking off an edge (coyote time)", async () => {
  // up the stairs onto the walkway, then off its side (z = 2, a 3 m drop) with the jump pressed
  // once the capsule has left the edge
  const r = await compareRuns((t, p) => (t < 2.9 ? { want: { x: p.x < 10.2 ? 3.9 : 0, z: 0 } } : { want: { x: 0, z: 3.9 }, jump: p.z > 2.3 && p.z < 2.6 }), 5);
  try {
    assert.equal(r.maxDev, 0, `trajectories diverge by up to ${r.maxDev} m`);
    assert.deepEqual(r.player.events, r.legacy.events);
    assert.ok(r.player.events.includes("jump"), `events ${r.player.events}`);
  } finally {
    r.dispose();
  }
});

test("two movers block each other (inner bodies on the MOVING layer)", async () => {
  const ph = await newPhysics();
  ph.addBox(new Vector3(0, -0.5, 0), new Vector3(20, 0.5, 20));
  const a = new CapsuleMover(ph, new Vector3(-2, 0.02, 0));
  const b = new CapsuleMover(ph, new Vector3(2, 0.02, 0));
  a.drive(() => ({ vx: 2, vz: 0 }));
  b.drive(() => ({ vx: -2, vz: 0 }));
  run(ph, 3);
  const d = Vector3.Distance(a.position, b.position);
  assert.ok(d > 0.5, `capsules passed into each other: ${d.toFixed(3)} m apart`);
  assert.ok(a.position.x < b.position.x, "they did not pass through");
  a.dispose();
  b.dispose();
  ph.dispose();
});

test("a mover without an inner body is not met by others; drive() stops on dispose", async () => {
  const ph = await newPhysics();
  ph.addBox(new Vector3(0, -0.5, 0), new Vector3(20, 0.5, 20));
  const ghost = new CapsuleMover(ph, new Vector3(0, 0.02, 0), { innerBodyLayer: false });
  assert.equal(ghost.innerBody, null);
  const walker = new CapsuleMover(ph, new Vector3(-2, 0.02, 0));
  walker.drive(() => ({ vx: 2, vz: 0 }));
  run(ph, 2.5);
  assert.ok(walker.position.x > 1.5, `the walker was stopped at ${walker.position.x.toFixed(2)}`);
  walker.dispose();
  ghost.dispose();
  ph.dispose();
});

test("falling out of the world puts the mover back on its last footing", async () => {
  const ph = await newPhysics();
  ph.addBox(new Vector3(0, -0.5, 0), new Vector3(3, 0.5, 3));
  const m = new CapsuleMover(ph, new Vector3(0, 0.02, 0), { fallLimit: 10 });
  let recovered = 0, t = 0;
  m.drive(
    (dt) => ((t += dt), { vx: t < 1.5 ? 3 : 0, vz: 0 }),
    (r) => (recovered += +r.recovered),
  );
  // walks off the edge, falls past the 10 m limit and comes back to the ledge
  run(ph, 4);
  assert.ok(recovered >= 1, "recovered");
  assert.ok(m.position.y > -0.5 && m.position.y < 0.5, `back on the box at y ${m.position.y.toFixed(2)}`);
  m.dispose();
  ph.dispose();
});

test("the inner body follows a teleport; render position blends the last two steps", async () => {
  const ph = await newPhysics();
  ph.addBox(new Vector3(0, -0.5, 0), new Vector3(20, 0.5, 20));
  const m = new CapsuleMover(ph, new Vector3(0, 0.02, 0));
  m.teleport(new Vector3(8, 0.02, 3));
  run(ph, 0.1);
  const hit = ph.rayCast(new Vector3(8, 1, 6), new Vector3(0, 0, -1), 5);
  assert.ok(Math.abs(hit - 2.7) < 0.05, `inner body met at ${hit}`);
  assert.ok(Vector3.Distance(m.renderPosition, m.position) < 0.01);
  m.dispose();
  // its inner body went with it
  assert.equal(ph.rayCast(new Vector3(8, 1, 6), new Vector3(0, 0, -1), 5), Infinity);
  ph.dispose();
});

test("disposing the physics world first leaves the mover safe to dispose", async () => {
  const ph = await newPhysics();
  ph.addBox(new Vector3(0, -0.5, 0), new Vector3(3, 0.5, 3));
  const m = new CapsuleMover(ph, new Vector3(0, 0.02, 0));
  ph.dispose();
  m.dispose();
  m.dispose();
});
