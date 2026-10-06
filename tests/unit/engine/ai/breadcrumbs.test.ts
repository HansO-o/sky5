import { test } from "node:test";
import assert from "node:assert/strict";
import { Breadcrumbs, FOLLOW, followSpeed, shouldCatchUp } from "../../../../src/engine/ai/breadcrumbs";
import { KinematicAgent } from "../../../../src/engine/ai/agent";

const P = (x: number, z: number, y = 0) => ({ x, y, z });

test("crumbs: every 0.5 m while grounded (in between too), with the foot height; 120 kept; a teleport starts over", () => {
  const t = new Breadcrumbs();
  assert.ok(t.drop(P(0, 0), true));
  assert.ok(!t.drop(P(0.3, 0), true));
  assert.ok(!t.drop(P(2, 0), false));
  assert.equal(t.length, 1);
  // a sampled leader 1.6 m further: crumbs at 0.5, 1.0 and the leader's place
  assert.ok(t.drop(P(1.6, 0, 0.8), true));
  assert.deepEqual(
    t.list.map((c) => c.x),
    [0, 0.5, 1, 1.6],
  );
  assert.ok(Math.abs(t.list[2].y - 0.5) < 1e-9);
  for (let x = 2; x < 200; x += 0.5) t.drop(P(x, 0), true);
  assert.equal(t.length, FOLLOW.keep);
  t.drop(P(150, 30), true);
  assert.equal(t.length, 1);
});

test("the place to keep, crumbs behind the leader, and where to walk", () => {
  const t = new Breadcrumbs();
  // an L: east 10 m, then north 10 m (−Z)
  for (let x = 0; x <= 10; x += 0.5) t.drop(P(x, 0), true);
  for (let z = -0.5; z >= -10; z -= 0.5) t.drop(P(10, z), true);
  const leader = P(10, -10);
  const keep = t.pointBehind(leader, 2.5)!;
  assert.ok(Math.abs(keep.x - 10) < 1e-9 && Math.abs(keep.z + 7.5) < 1e-9);
  // 12 m back along the trail is round the corner
  const back = t.pointBehind(leader, 12)!;
  assert.ok(Math.abs(back.x - 8) < 1e-9 && Math.abs(back.z) < 1e-9);
  assert.equal(t.pointBehind(leader, 50), null);
  const spots = t.behindLeader(leader, 6, 14);
  assert.ok(spots.length > 10);
  assert.ok(Math.abs(spots[0].z + 4) < 1e-9);
  // a follower at the start walks the trail eastward (not across the corner)
  const n = t.next({ x: 0, z: 0 }, leader)!;
  assert.ok(n.onTrail && !n.arrived);
  assert.ok(n.point.x > 0.5 && n.point.x <= 1.5 && n.point.z === 0, JSON.stringify(n.point));
  assert.ok(Math.abs(n.along - 20) < 1e-9);
  // 2.5 m behind the leader: arrived
  const a = t.next({ x: 10, z: -7.5 }, leader)!;
  assert.ok(a.arrived);
  // off the trail: to the nearest crumb, or straight to the place to keep when that is nearer
  const off = t.next({ x: 0, z: -6 }, leader)!;
  assert.ok(!off.onTrail && off.point.x === 0 && off.point.z === 0);
  const off2 = t.next({ x: 6, z: -7.5 }, leader)!;
  assert.ok(!off2.onTrail && Math.abs(off2.point.x - 10) < 1e-9 && Math.abs(off2.point.z + 7.5) < 1e-9);
});

test("following speeds (§3.6) and the catch-up rule", () => {
  assert.equal(followSpeed(2, { leaderMoving: true }), 0);
  assert.equal(followSpeed(2.8, { leaderMoving: true }), 1.4);
  assert.equal(followSpeed(5, { leaderMoving: true }), 2.2);
  assert.equal(followSpeed(8, { leaderMoving: true }), 2.2);
  assert.equal(followSpeed(9, { leaderMoving: true }), 3.6);
  // the player standing still: stop within 4 m, else come closer
  assert.equal(followSpeed(3.9, { leaderMoving: false }), 0);
  assert.equal(followSpeed(5, { leaderMoving: false }), 2.2);
  // sneaking: crouch-walk, stop when the player stops
  assert.equal(followSpeed(5, { leaderMoving: true, stealth: true }), 0.9);
  assert.equal(followSpeed(5, { leaderMoving: false, stealth: true }), 0);
  assert.ok(shouldCatchUp(26, false, 0));
  assert.ok(!shouldCatchUp(26, true, 0));
  assert.ok(!shouldCatchUp(10, false, 3.9));
  assert.ok(shouldCatchUp(10, true, 4));
});

test("a follower walks the leader's L-shaped way around a corner and settles 2.5 m behind", () => {
  const t = new Breadcrumbs();
  const f = new KinematicAgent(P(-2, 0), Math.PI / 2);
  const leader = { ...P(0, 0) };
  t.reset(leader);
  const dt = 1 / 60;
  let worstCut = 0;
  let time = 0;
  let thinkAcc = 0;
  // the leader walks east 12 m then north 12 m at 1.9 m/s, then stands
  const path = (s: number) => (s <= 12 ? P(s, 0) : P(12, -Math.min(12, s - 12)));
  while (time < 22) {
    time += dt;
    const s = Math.min(24, time * 1.9);
    Object.assign(leader, path(s));
    thinkAcc += dt;
    if (thinkAcc >= 0.1) {
      thinkAcc = 0;
      t.drop(leader, true);
      const me = f.position;
      const n = t.next(me, leader);
      const moving = s < 24;
      const speed = followSpeed(n?.along ?? Math.hypot(leader.x - me.x, leader.z - me.z), { leaderMoving: moving });
      if (!n || n.arrived || speed <= 0) f.stop();
      else f.moveTo(n.point, speed, 0, n.along - FOLLOW.behind < 1.5 ? 0.6 : 0);
    }
    f.step(dt);
    // the inside of the corner is the region x < 11.5, z < −0.5 (a wall there): how far into it
    const p = f.position;
    if (p.x < 11.5 && p.z < -0.5) worstCut = Math.max(worstCut, Math.min(11.5 - p.x, -0.5 - p.z));
  }
  const p = f.position;
  const d = Math.hypot(p.x - 12, p.z + 12);
  // stopped within 4 m of a leader standing still, on the leader's line
  assert.ok(d <= FOLLOW.idleStop + 0.05 && d >= FOLLOW.behind - 0.3, `distance ${d}`);
  assert.ok(Math.abs(p.x - 12) < 0.5, `x ${p.x}`);
  assert.ok(worstCut < 0.8, `cut the corner by ${worstCut}`);
});
