import { test } from "node:test";
import assert from "node:assert/strict";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { limitApproach, modelToWorld, RootMotionCurve, RootMotionLibrary, RootMotionTrack, type RootKey } from "../../../../src/engine/anim/rootMotion";
import { CapsuleMover } from "../../../../src/engine/physics/CapsuleMover";
import { newPhysics } from "../../helpers/jolt";

const near = (a: number, b: number, eps = 1e-6, msg = "") => assert.ok(Math.abs(a - b) < eps, `${msg} ${a} != ${b}`);

/** A lunge like Sword_Dash_RM: 0.83 m in one 30 fps frame, 2.8 m by 0.333 s, 3.69 m at the end of 1.567 s. */
const DASH: RootKey[] = [
  [0, 0, 0, 0, 0],
  [0.2, 0, 0, 0.6, 0],
  [0.2333, 0, 0, 1.43, 0],
  [0.3333, 0, 0, 2.8, 0],
  [0.6, 0, 0, 3.5, 0],
  [1.5667, 0, 0, 3.6922, 0],
];

test("curves interpolate linearly between keys and clamp to the clip", () => {
  const c = new RootMotionCurve(DASH);
  near(c.duration, 1.5667);
  near(c.sample(0.1).z, 0.3);
  near(c.sample(0.2 + 0.0333 / 2).z, (0.6 + 1.43) / 2, 1e-4);
  near(c.sample(-1).z, 0);
  near(c.sample(9).z, 3.6922);
  near(c.delta(0.2, 0.3333).z, 2.2);
  near(c.net.z, 3.6922);
  assert.equal(c.moves, true);
  assert.equal(new RootMotionCurve([[0, 0, 0, 0, 0], [0.5, 0, 0, 0, 0]]).moves, false);
  assert.throws(() => new RootMotionCurve([]));
  assert.throws(() => new RootMotionCurve([[0.5, 0, 0, 0, 0], [0.1, 0, 0, 0, 0]]));
});

test("the sidecar parses tolerantly: missing or damaged files give what is usable", () => {
  const lib = RootMotionLibrary.parse({
    version: 1,
    bone: "root",
    clips: {
      Sword_Dash_RM: { asset: "chars/anim_combat", duration: 1.5667, delta: [0, 0, 3.6922, 0], keys: DASH },
      Sword_Block: { asset: "chars/anim_base", duration: 1.2333, keys: [[0, 0, 0, 0, 0], [1.2333, 0, 0, 0, 0]] },
      Broken: { keys: [[0, 0, 0], "x"] },
      NoKeys: { duration: 1 },
    },
  });
  assert.deepEqual(lib.clips().sort(), ["Sword_Block", "Sword_Dash_RM"]);
  near(lib.get("Sword_Dash_RM")!.duration, 1.5667);
  assert.equal(lib.has("Broken"), false);
  assert.equal(RootMotionLibrary.parse(null).size, 0);
  assert.equal(RootMotionLibrary.parse("nonsense").size, 0);
  assert.equal(RootMotionLibrary.parse({ clips: 3 }).size, 0);
});

test("model space (+Z forward, +X the character's left) to world for a forward yaw", () => {
  // yaw 0 faces -Z: forward is -Z, the left is -X
  const f0 = modelToWorld(0, 1, 0);
  near(f0.x, 0);
  near(f0.z, -1);
  const l0 = modelToWorld(1, 0, 0);
  near(l0.x, -1);
  near(l0.z, 0);
  // yaw pi/2 faces -X (a left turn from -Z): forward -X, left +Z
  const f1 = modelToWorld(0, 1, Math.PI / 2);
  near(f1.x, -1);
  near(f1.z, 0);
  const l1 = modelToWorld(1, 0, Math.PI / 2);
  near(l1.x, 0);
  near(l1.z, 1);
});

test("limitApproach cuts only the approach, never past the stop distance", () => {
  // 2 m from the target, a 1.5 m step straight at it: only 1.1 m allowed (stop 0.9)
  const a = limitApproach(0, 0, 0, -1.5, 0, -2, 0.9);
  near(a.x, 0);
  near(a.z, -1.1);
  // sideways passes untouched, backward too
  const b = limitApproach(0, 0, 0.5, -1.5, 0, -2, 0.9);
  near(b.x, 0.5);
  near(b.z, -1.1);
  const c = limitApproach(0, 0, 0, 1, 0, -2, 0.9);
  near(c.z, 1);
  // already inside the stop distance: no approach at all
  const d = limitApproach(0, 0, 0, -0.3, 0, -0.5, 0.9);
  near(d.z, 0);
});

/** Run a track at 60 Hz for `seconds` (static actor yaw), summing the travel. */
function travel(track: RootMotionTrack, seconds: number, yaw = 0, target: { x: number; z: number } | null = null) {
  const dt = 1 / 60;
  let x = 0, z = 0, peak = 0;
  for (let t = 0; t < seconds; t += dt) {
    const s = track.step(dt, yaw, x, z, target);
    x += s.vx * dt;
    z += s.vz * dt;
    peak = Math.max(peak, Math.hypot(s.vx, s.vz));
  }
  return { x, z, peak };
}

test("a fast lunge is held to 3 m/s and still covers its distance (the rest is carried over)", () => {
  const curve = new RootMotionCurve(DASH);
  const carried = travel(new RootMotionTrack(curve), 2.2);
  assert.ok(carried.peak <= 3 + 1e-9, `peak ${carried.peak}`);
  near(carried.z, -3.6922, 1e-3, "full travel, toward -Z (yaw 0 faces -Z)");
  // a hard clamp loses most of the burst (what §3.4's appendix warns about)
  const clamped = travel(new RootMotionTrack(curve, 1, { carry: false }), 2.2);
  assert.ok(-clamped.z < 3, `hard clamp travelled ${-clamped.z}`);
  assert.ok(-clamped.z > 1, `hard clamp travelled ${-clamped.z}`);
  // twice the rate: the curve runs in half the time (the 3 m/s limit then decides)
  const fast = new RootMotionTrack(curve, 2);
  travel(fast, 0.8);
  near(fast.t, curve.duration);
});

test("root motion stops 0.9 m short of the target and drops what is still owed", () => {
  const track = new RootMotionTrack(new RootMotionCurve(DASH));
  const r = travel(track, 2.2, 0, { x: 0, z: -2 });
  near(r.z, -1.1, 1e-6);
  assert.equal(track.done, true);
});

test("the travel is rotated by the actor's yaw; done after the clip (and any carried motion)", () => {
  const track = new RootMotionTrack(new RootMotionCurve([[0, 0, 0, 0, 0], [0.5, 0, 0, 1, 0]]));
  const r = travel(track, 0.6, Math.PI / 2);
  near(r.x, -1, 1e-6);
  near(r.z, 0, 1e-6);
  assert.equal(track.done, true);
  const s = track.step(1 / 60, 0, 0, 0);
  near(s.vx, 0);
  near(s.vz, 0);
});

test("a capsule mover follows the root motion exactly (snap) and stops short of its target", async () => {
  const ph = await newPhysics();
  ph.addBox(new Vector3(0, -0.5, -10), new Vector3(10, 0.5, 15));
  const m = new CapsuleMover(ph, new Vector3(0, 0.02, 0));
  // settle onto the floor
  for (let i = 0; i < 10; i++) m.step({ vx: 0, vz: 0 }, ph.step);
  const track = new RootMotionTrack(new RootMotionCurve(DASH));
  const start = m.position;
  for (let i = 0; i < 140; i++) {
    const p = m.position;
    const s = track.step(ph.step, 0, p.x, p.z, null);
    m.step({ vx: s.vx, vz: s.vz, snap: true }, ph.step);
  }
  const moved = start.z - m.position.z;
  near(moved, 3.6922, 0.02, "the capsule covers the clip's travel");
  // eased like stick input instead, the burst is smeared out and comes up short
  const eased = new CapsuleMover(ph, new Vector3(3, 0.02, 0));
  for (let i = 0; i < 10; i++) eased.step({ vx: 0, vz: 0 }, ph.step);
  const t2 = new RootMotionTrack(new RootMotionCurve(DASH), 1, { carry: false });
  const s0 = eased.position;
  for (let i = 0; i < 40; i++) {
    const p = eased.position;
    const s = t2.step(ph.step, 0, p.x, p.z, null);
    eased.step({ vx: s.vx, vz: s.vz }, ph.step);
  }
  assert.ok(s0.z - eased.position.z < moved, "eased travel is shorter");
  // with a target 2.5 m ahead the capsule stops 0.9 m from it
  const c = new CapsuleMover(ph, new Vector3(-3, 0.02, 0));
  for (let i = 0; i < 10; i++) c.step({ vx: 0, vz: 0 }, ph.step);
  const target = { x: -3, z: c.position.z - 2.5 };
  const t3 = new RootMotionTrack(new RootMotionCurve(DASH));
  for (let i = 0; i < 140; i++) {
    const p = c.position;
    const s = t3.step(ph.step, 0, p.x, p.z, target);
    c.step({ vx: s.vx, vz: s.vz, snap: true }, ph.step);
  }
  near(c.position.z - target.z, 0.9, 0.03, "stops at the stop distance");
  m.dispose();
  eased.dispose();
  c.dispose();
  ph.dispose();
});
