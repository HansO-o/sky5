import { test } from "node:test";
import assert from "node:assert/strict";
import { locomotionClip, type LocomotionClips } from "../../../src/engine/character/locomotion";

const C: LocomotionClips = {
  idle: "Idle",
  walk: "Walk",
  jog: "Jog",
  sprint: "Sprint",
  crouchIdle: "CrouchIdle",
  crouchMove: "CrouchFwd",
  jumpStart: "JumpStart",
  jumpLoop: "JumpLoop",
  jumpLand: "JumpLand",
  below: { idle: 0.15, walk: 2.6, jog: 5, crouch: 0.2 },
  rate: { crouch: 0.6, walk: 0.95, jog: 3.6, sprint: 6 },
  minRate: { crouch: 0.6 },
};
const near = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-9, `${a} != ${b}`);

test("clip by speed band", () => {
  assert.equal(locomotionClip(0, false, C).clip, "Idle");
  assert.equal(locomotionClip(0.1, false, C).clip, "Idle");
  assert.equal(locomotionClip(1.0, false, C).clip, "Walk");
  assert.equal(locomotionClip(3.9, false, C).clip, "Jog");
  assert.equal(locomotionClip(6.2, false, C).clip, "Sprint");
  assert.equal(locomotionClip(0.1, true, C).clip, "CrouchIdle");
  assert.equal(locomotionClip(1.4, true, C).clip, "CrouchFwd");
});

test("playback rate is speed over the clip's native speed (no foot sliding)", () => {
  // walking at the clip's native 0.95 m/s plays it at 1x; the old 1.6 m/s normalisation is gone
  near(locomotionClip(0.95, false, C).speed, 1);
  near(locomotionClip(1.9, false, C).speed, 2);
  near(locomotionClip(0.6, true, C).speed, 1);
  near(locomotionClip(1.4, true, C).speed, 1.4 / 0.6);
  near(locomotionClip(3.6, false, C).speed, 1);
  near(locomotionClip(6, false, C).speed, 1);
  near(locomotionClip(0, false, C).speed, 1);
});

test("minimum rates: a barely moving crouch never freezes; the crouching idle plays at the crouch minimum", () => {
  near(locomotionClip(0.25, true, C).speed, 0.6);
  near(locomotionClip(0, true, C).speed, 0.6);
  near(locomotionClip(0, true, { ...C, minRate: undefined }).speed, 1);
  // negative speeds (numerical noise) count as standing still
  assert.equal(locomotionClip(-1, false, C).clip, "Idle");
});
