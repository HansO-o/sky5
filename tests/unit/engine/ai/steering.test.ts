import { test } from "node:test";
import assert from "node:assert/strict";
import { Crowd, StuckDetector, circleVelocity, localVelocity, seek, separation, sidestep, turnToward, yawOf } from "../../../../src/engine/ai/steering";
import { HUMANOID_GAIT, KinematicAgent, gaitClip } from "../../../../src/engine/ai/agent";

const near = (a: number, b: number, eps = 1e-6) => Math.abs(a - b) <= eps;

test("yaw convention and turning at 8 rad/s", () => {
  // forward = (−sin, −cos): looking along −Z is 0, along −X is π/2
  assert.ok(near(yawOf(0, -1), 0));
  assert.ok(near(yawOf(-1, 0), Math.PI / 2));
  assert.ok(near(Math.abs(yawOf(0, 1)), Math.PI));
  // a half turn takes π/8 s
  let y = 0;
  let t = 0;
  while (Math.abs(y - Math.PI) > 1e-9 && t < 1) {
    y = turnToward(y, Math.PI, 8, 1 / 60);
    t += 1 / 60;
  }
  assert.ok(t > 0.38 && t < 0.42, `${t}`);
  // the short way round
  assert.ok(turnToward(3, -3, 8, 0.01) > 3);
  const l = localVelocity(0, -2, 0);
  assert.ok(near(l.fwd, 2) && near(l.right, 0));
  const r = localVelocity(1, 0, 0);
  assert.ok(near(r.right, 1) && near(r.fwd, 0));
});

test("seek slows into the stop distance; circling holds the ring; separation and sidesteps", () => {
  const v = seek({ x: 0, z: 0 }, { x: 10, z: 0 }, 3, 1);
  assert.ok(near(v.vx, 3) && near(v.vz, 0) && near(v.dist, 10));
  const s = seek({ x: 0, z: 0 }, { x: 1.2, z: 0 }, 3, 1);
  assert.ok(s.vx > 0 && s.vx < 3);
  assert.deepEqual(seek({ x: 0, z: 0 }, { x: 1, z: 0 }, 3, 1), { vx: 0, vz: 0, dist: 1 });
  // integrate a strafe around the origin starting off the ring
  let p = { x: 5, z: 0 };
  let ang = 0;
  for (let i = 0; i < 600; i++) {
    const c = circleVelocity(p, { x: 0, z: 0 }, 3.5, 1, 0.9);
    const a0 = Math.atan2(p.z, p.x);
    p = { x: p.x + c.vx / 60, z: p.z + c.vz / 60 };
    ang += Math.atan2(Math.sin(Math.atan2(p.z, p.x) - a0), Math.cos(Math.atan2(p.z, p.x) - a0));
  }
  assert.ok(Math.abs(Math.hypot(p.x, p.z) - 3.5) < 0.05);
  // 10 s at 0.9 m/s ≈ 9 m of ring travelled
  assert.ok(Math.abs(ang) * 3.5 > 7);
  // facing the centre from +X (yaw π/2), +1 goes to its left: −Z
  const left = circleVelocity({ x: 3.5, z: 0 }, { x: 0, z: 0 }, 3.5, 1, 1);
  const l = localVelocity(left.vx, left.vz, yawOf(-1, 0));
  assert.ok(l.right < -0.9, `${l.right}`);
  const sep = separation({ x: 0, z: 0 }, 0.45, [{ x: 0.5, z: 0 }, { x: 5, z: 0 }]);
  assert.ok(sep.vx < 0 && near(sep.vz, 0));
  assert.deepEqual(separation({ x: 0, z: 0 }, 0.45, [{ x: 1, z: 0 }]), { vx: 0, vz: 0 });
  // left of travel along −Z is −X
  assert.deepEqual(sidestep(0, -1, 1), { vx: -1, vz: -0 });
  assert.deepEqual(sidestep(0, -1, -1), { vx: 1, vz: 0 });
  const crowd = new Crowd();
  const a = { x: 0, z: 0 }, b = { x: 1, z: 1 }, c = { x: 9, z: 9 };
  crowd.add(a);
  crowd.add(b);
  const off = crowd.add(c);
  assert.deepEqual([...crowd.near(a, a, 2)], [b]);
  off();
  assert.equal(crowd.size, 2);
});

test("stuck detector: slower than 0.2 m/s for 0.8 s while trying → sideways for 0.6 s, alternating sides", () => {
  const d = new StuckDetector();
  let side = d.update(0.4, 2, 0.05);
  assert.equal(side, 0);
  side = d.update(0.41, 2, 0.05);
  assert.equal(side, 1);
  assert.ok(near(d.stuckFor, 0.81));
  side = d.update(0.5, 2, 1.5);
  assert.equal(side, 1);
  side = d.update(0.2, 2, 1.5);
  assert.equal(side, 0);
  assert.equal(d.stuckFor, 0);
  for (let i = 0; i < 9; i++) side = d.update(0.1, 2, 0);
  assert.equal(side, -1);
  // standing still on purpose is not being stuck
  d.reset();
  for (let i = 0; i < 30; i++) d.update(0.1, 0, 0);
  assert.equal(d.stuckFor, 0);
});

test("gait: forward bands by speed, strafes and backpedal, fallbacks, crouching", () => {
  const g = HUMANOID_GAIT;
  assert.deepEqual(gaitClip(g, 0, 0), { clip: "Idle_Loop", speed: 1 });
  const w = gaitClip(g, 1.4, 0);
  assert.equal(w.clip, "Walk_Loop");
  assert.ok(near(w.speed, 1.4 / 0.95));
  assert.equal(gaitClip(g, 3, 0).clip, "Jog_Fwd_Loop");
  assert.equal(gaitClip(g, 6.2, 0).clip, "Sprint_Loop");
  assert.equal(gaitClip(g, 0, 0.9).clip, "Walk_R_Loop");
  assert.equal(gaitClip(g, 0, -0.9).clip, "Walk_L_Loop");
  assert.equal(gaitClip(g, -0.9, 0).clip, "Walk_Bwd_Loop");
  assert.equal(gaitClip(g, 0, 2.5).clip, "Jog_Right_Loop");
  // without the combat set: strafes walk forward, the backpedal walks backwards
  const base = (c: string) => !/_L_|_R_|Bwd|Left|Right/.test(c);
  assert.equal(gaitClip(g, 0, 0.9, false, base).clip, "Walk_Loop");
  const back = gaitClip(g, -0.9, 0, false, base);
  assert.equal(back.clip, "Walk_Loop");
  assert.ok(back.speed < 0);
  assert.equal(gaitClip(g, 0, 0, true).clip, "Crouch_Idle_Loop");
  assert.equal(gaitClip(g, 0.9, 0, true).clip, "Crouch_Fwd_Loop");
  // a creature walking backwards at speedRatio −1
  const spider = { idle: "Spider_Idle", forward: [{ clip: "Spider_Walk", native: 2.6, below: Infinity }], back: { clip: "Spider_Walk", native: 2.6, reverse: true } };
  assert.deepEqual(gaitClip(spider, -2.6, 0), { clip: "Spider_Walk", speed: -1 });
  assert.deepEqual(gaitClip(spider, 2.6, 0), { clip: "Spider_Walk", speed: 1 });
});

test("kinematic agent: goals, facing, actions, shove, root-motion free stepping", () => {
  const a = new KinematicAgent({ x: 0, y: 0, z: 0 }, 0, { clips: { Sword_Attack: 1.5, Idle_Loop: 2 } });
  a.moveTo({ x: 0, z: -10 }, 2, 1);
  for (let i = 0; i < 360; i++) a.step(1 / 60);
  assert.ok(Math.abs(a.position.z + 9) < 0.1, `${a.position.z}`);
  assert.ok(near(a.yaw, 0, 1e-3));
  a.face({ x: 5, z: a.position.z });
  for (let i = 0; i < 60; i++) a.step(1 / 60);
  assert.ok(near(a.yaw, -Math.PI / 2, 1e-3), `${a.yaw}`);
  assert.equal(a.act("Missing"), 0);
  assert.equal(a.act("Sword_Attack", { speed: 0.6 }), 1.5);
  assert.equal(a.acting, "Sword_Attack");
  a.setActRate(1);
  assert.deepEqual(a.played.at(-1), { clip: "Sword_Attack", speed: 1, loop: false });
  for (let i = 0; i < 120; i++) a.step(1 / 60);
  assert.equal(a.acting, null);
  a.act("Sword_Attack", { hold: true });
  for (let i = 0; i < 200; i++) a.step(1 / 60);
  assert.equal(a.acting, "Sword_Attack");
  a.stop();
  const z = a.position.z;
  a.shove(0, 1.5);
  for (let i = 0; i < 60; i++) a.step(1 / 60);
  assert.ok(Math.abs(a.position.z - z - 1.5) < 0.05);
  a.suspended = true;
  a.moveTo({ x: 50, z: 0 }, 3);
  a.step(1);
  assert.ok(a.position.x < 1);
});
