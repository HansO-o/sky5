import { test } from "node:test";
import assert from "node:assert/strict";
import {
  advanceClip,
  behind,
  blockedBlow,
  clipSeconds,
  defenceFor,
  hitReaction,
  inStrike,
  localOf,
  segmentInSector,
  sweptStrike,
  windowOverlap,
  withinArc,
  yawTo,
  type Pose,
} from "../../../../src/engine/combat/hit";

const DEG = Math.PI / 180;
const near = (a: number, b: number, eps = 1e-6) => Math.abs(a - b) < eps;
const sword = { reach: 1.8, radius: 0.35, arc: 55 * DEG };
/** an attacker at the origin facing -Z (yaw 0) */
const A: Pose = { x: 0, y: 0, z: 0, yaw: 0 };

test("facing convention: yaw 0 looks along -Z, right is +X", () => {
  const l = localOf(A, { x: 1, y: 0.5, z: -2 });
  assert.ok(near(l.r, 1) && near(l.f, 2) && near(l.dy, 0.5));
  const turned = localOf({ ...A, yaw: Math.PI / 2 }, { x: -2, y: 0, z: 0 });
  assert.ok(near(turned.f, 2) && near(turned.r, 0), "yaw π/2 looks along -X");
  assert.ok(near(yawTo(0, 0, -1, 0), Math.PI / 2));
  assert.ok(near(yawTo(0, 0, 0, -1), 0));
});

test("instant strike: reach + radius, ±arc, height band", () => {
  assert.ok(inStrike(A, { x: 0, y: 0, z: -2.1 }, sword), "2.1 m ahead (reach 1.8 + radius 0.35)");
  assert.ok(!inStrike(A, { x: 0, y: 0, z: -2.2 }, sword), "out of reach");
  assert.ok(!inStrike(A, { x: 0, y: 0, z: 1 }, sword), "behind");
  const at = (deg: number) => ({ x: Math.sin(deg * DEG) * 1.5, y: 0, z: -Math.cos(deg * DEG) * 1.5 });
  assert.ok(inStrike(A, at(54), sword) && inStrike(A, at(-54), sword), "inside ±55°");
  assert.ok(!inStrike(A, at(56), sword) && !inStrike(A, at(-56), sword), "outside ±55°");
  assert.ok(inStrike(A, { x: 0, y: 1.1, z: -1.5 }, sword), "on a step 1.1 m up");
  assert.ok(!inStrike(A, { x: 0, y: 1.25, z: -1.5 }, sword), "|Δy| ≥ 1.2");
  assert.ok(!inStrike(A, { x: 0, y: -1.3, z: -1.5 }, sword), "below too");
});

test("segment vs sector: a crossing between two outside points still hits (no tunnelling)", () => {
  // left of the arc to right of the arc, 1 m ahead: both ends outside ±55°, the middle inside
  const u = segmentInSector(-2, 1, 2, 1, 2.15, 55 * DEG);
  assert.ok(u > 0 && u < 0.5, `enters on the way (${u})`);
  // passing behind the attacker never enters
  assert.equal(segmentInSector(-2, -1, 2, -1, 2.15, 55 * DEG), -1);
  // passing ahead but out of reach
  assert.equal(segmentInSector(-3, 2.5, 3, 2.5, 2.15, 55 * DEG), -1);
  // starting inside: u = 0
  assert.equal(segmentInSector(0, 1, 0, 1.2, 2.15, 55 * DEG), 0);
  // a wide arc (> 90°) still works
  assert.ok(segmentInSector(-1, -0.2, -1, -0.1, 2, 120 * DEG) >= 0);
  assert.equal(segmentInSector(-1, -1, -1, -0.9, 2, 120 * DEG), -1);
});

test("swept strike: a fast target passing in front within one step is hit", () => {
  // 6 m sideways in one 1/60 s step (360 m/s): neither endpoint is in the strike
  const t0 = { x: -3, y: 0, z: -1 }, t1 = { x: 3, y: 0, z: -1 };
  assert.ok(!inStrike(A, t0, sword) && !inStrike(A, t1, sword));
  const u = sweptStrike(A, A, t0, t1, sword);
  // it enters at the arc's edge: x = −tan 55° (1 m ahead)
  assert.ok(near(-3 + 6 * u, -Math.tan(55 * DEG), 1e-3), `hit on the way in (${u})`);
});

test("swept strike: a fast turn sweeps through a target the endpoints miss", () => {
  const target = { x: 0, y: 0, z: -1.5 };
  const a0 = { ...A, yaw: -1.2 }, a1 = { ...A, yaw: 1.2 };
  assert.ok(!inStrike(a0, target, sword) && !inStrike(a1, target, sword));
  assert.ok(sweptStrike(a0, a1, target, target, sword) >= 0);
  // the turn sweeps the other way round the back: no hit
  const b0 = { ...A, yaw: 2.0 }, b1 = { ...A, yaw: -2.0 + 2 * Math.PI };
  assert.equal(sweptStrike(b0, b1, target, target, sword), -1);
});

test("swept strike: the height band is part of the sweep", () => {
  // a target dropping from a 2 m ledge into reach: hit once it is low enough
  const u = sweptStrike(A, A, { x: 0, y: 2, z: -1.5 }, { x: 0, y: 0, z: -1.5 }, sword);
  assert.ok(near(u, 0.4, 1e-3), `enters the band at |Δy| = 1.2 (${u})`);
  assert.equal(sweptStrike(A, A, { x: 0, y: 2, z: -1.5 }, { x: 0, y: 1.5, z: -1.5 }, sword), -1);
});

test("clip timing: wind-up rate up to the strike, strike rate after", () => {
  // strike at 0.24 s of clip, wind-up at 0.6×: 0.4 s of wall time to reach it
  assert.ok(near(advanceClip(0, 0.4, 0.24, 0.6, 1), 0.24));
  assert.ok(near(advanceClip(0, 0.5, 0.24, 0.6, 1), 0.34));
  assert.ok(near(advanceClip(0.3, 0.1, 0.24, 0.6, 1), 0.4));
  assert.ok(near(clipSeconds(0, 0.34, 0.24, 0.6, 1), 0.5));
  // a single long step spanning the whole active window still overlaps it
  assert.deepEqual(windowOverlap(0.1, 0.9, 0.2, 0.27), [0.2, 0.27]);
  assert.equal(windowOverlap(0.3, 0.4, 0.2, 0.27), null);
  assert.equal(windowOverlap(0.1, 0.15, 0.2, 0.27), null);
});

test("guard: parry within 0.18 s of the press, block once raised (0.12 s), heavies break it", () => {
  const base = { blocking: true, inFront: true, staggered: false };
  assert.equal(defenceFor({ ...base, blockAge: 0 }), "parry");
  assert.equal(defenceFor({ ...base, blockAge: 0.1 }), "parry");
  assert.equal(defenceFor({ ...base, blockAge: 0.18 }), "parry");
  assert.equal(defenceFor({ ...base, blockAge: 0.19 }), "block");
  assert.equal(defenceFor({ ...base, blockAge: 2 }), "block");
  // a parried heavy is still a parry; a heavy on a raised guard breaks it
  assert.equal(defenceFor({ ...base, blockAge: 0.1, guardBreak: true }), "parry");
  assert.equal(defenceFor({ ...base, blockAge: 0.5, guardBreak: true }), "guardBreak");
  // unparryable (arrows, kicks, the pounce): hits until the guard is up, then blocked
  assert.equal(defenceFor({ ...base, blockAge: 0.05, unparryable: true }), "hit");
  assert.equal(defenceFor({ ...base, blockAge: 0.15, unparryable: true }), "block");
  // from behind, staggered, or not blocking: a hit
  assert.equal(defenceFor({ ...base, blockAge: 0.1, inFront: false }), "hit");
  assert.equal(defenceFor({ ...base, blockAge: 0.5, staggered: true }), "hit");
  assert.equal(defenceFor({ ...base, blocking: false, blockAge: 0.1 }), "hit");
  // a defender that cannot parry (an AI): the early part of the guard is a hit, then a block
  assert.equal(defenceFor({ ...base, blockAge: 0.05, canParry: false }), "hit");
  assert.equal(defenceFor({ ...base, blockAge: 0.13, canParry: false }), "block");
  assert.equal(defenceFor({ ...base, blockAge: 0.13, canParry: false, guardBreak: true }), "guardBreak");
  // the parry window counts from the press: a guard raised 0.1 s after it parries for 0.08 s more
  assert.equal(defenceFor({ ...base, blockAge: 0.05, parryAge: 0.15 }), "parry");
  assert.equal(defenceFor({ ...base, blockAge: 0.1, parryAge: 0.2 }), "hit", "past the window, not up yet");
  assert.equal(defenceFor({ ...base, blockAge: 0.13, parryAge: 0.23 }), "block");
  // a press held through a stagger (or one in the lockout) can't parry at all
  assert.equal(defenceFor({ ...base, blockAge: 0.15, parryAge: Infinity }), "block");
  assert.equal(defenceFor({ ...base, blockAge: 0.05, parryAge: Infinity }), "hit");
});

test("blocked blows: the guard's share, the stamina cost, and the break when stamina runs out", () => {
  const weapon = { damage: 0.3, stamina: 0.8 };
  const b = blockedBlow(10, weapon, 100);
  assert.ok(near(b.damage, 3) && near(b.cost, 8) && !b.broken);
  // 4 stamina covers half of the 8 needed: half blocked, half through, guard broken
  const h = blockedBlow(10, weapon, 4);
  assert.ok(near(h.damage, 5 * 0.3 + 5) && near(h.cost, 4) && h.broken);
  assert.ok(blockedBlow(10, weapon, 8).broken, "down to 0 breaks it");
});

test("arcs, backs and hit reactions", () => {
  const d: Pose = { x: 0, y: 0, z: 0, yaw: 0 };
  assert.ok(withinArc(d, { x: 0.5, y: 0, z: -1 }, 70 * DEG));
  assert.ok(!withinArc(d, { x: 0, y: 0, z: 1 }, 70 * DEG));
  assert.ok(behind(d, { x: 0.3, y: 0, z: 1 }, 60 * DEG));
  assert.ok(!behind(d, { x: 2, y: 0, z: 0.5 }, 60 * DEG));
  assert.equal(hitReaction(d, { x: 2, y: 0, z: 0 }), "Hit_Shoulder_R");
  assert.equal(hitReaction(d, { x: -2, y: 0, z: 0 }), "Hit_Shoulder_L");
  assert.equal(hitReaction(d, { x: 0, y: 0, z: -2 }), "Hit_Head");
  assert.equal(hitReaction(d, { x: 0, y: 0, z: -2 }, { heavy: true, killed: true }), "Hit_Knockback");
});
