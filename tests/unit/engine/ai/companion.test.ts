import { test } from "node:test";
import assert from "node:assert/strict";
import { FOLLOW } from "../../../../src/engine/ai/breadcrumbs";
import { dist, fight } from "../../helpers/ai";

test("follows the player's trail 2.5 m behind, walking or jogging by distance; stops near an idle player", () => {
  const f = fight();
  const c = f.companion("brun", { x: 0, y: 0, z: 2 });
  assert.equal(c.brain.state, "follow");
  let maxSpeed = 0;
  // an L: 12 m north, then 10 m east, at a walk
  f.walk(0, -1, 1.9, 12 / 1.9, () => void (maxSpeed = Math.max(maxSpeed, c.agent.speed)));
  f.walk(1, 0, 1.9, 10 / 1.9, () => void (maxSpeed = Math.max(maxSpeed, c.agent.speed)));
  assert.ok(maxSpeed <= FOLLOW.jog + 0.5, `never faster than a jog (${maxSpeed.toFixed(2)})`);
  const behind = dist(c.agent.position, f.pl.p);
  assert.ok(behind > 1.5 && behind < 5, `keeps up (${behind.toFixed(2)} m behind)`);
  // it took the corner: never cut across the inside of the L by much
  f.run(4);
  assert.ok(c.agent.speed < 0.05, "stopped");
  const d = dist(c.agent.position, f.pl.p);
  assert.ok(d <= FOLLOW.idleStop + 0.1 && d >= 1.5, `stops within 4 m of the idle player (${d.toFixed(2)})`);
  // far behind: it jogs
  f.pl.p = { x: f.pl.p.x + 4, y: 0, z: f.pl.p.z };
  f.walk(1, 0, 6, 2);
  f.run(0.5);
  assert.ok(c.agent.speed > FOLLOW.walk + 0.3, `jogs to catch up (${c.agent.speed.toFixed(2)})`);
});

test("crouches and creeps at 0.9 m/s while the player sneaks, and stops when the player stops", () => {
  const f = fight();
  const c = f.companion("ivo", { x: 0, y: 0, z: 2.5 });
  f.walk(0, -1, 1.9, 4);
  f.pl.sneaking = true;
  let fastest = 0;
  f.walk(0, -1, 1.4, 4, () => void (fastest = Math.max(fastest, c.agent.speed)));
  assert.ok(c.agent.crouch, "crouched");
  f.walk(0, -1, 1.4, 2, () => void (fastest = Math.max(fastest, c.agent.speed)));
  assert.ok(fastest < FOLLOW.walk + 0.2, `creeps (${fastest.toFixed(2)})`);
  f.run(0.4);
  assert.ok(c.agent.speed < 0.05, "stops with the player");
  f.pl.sneaking = false;
  f.run(0.3);
  assert.equal(c.agent.crouch, false);
  c.brain.stealth = true;
  f.run(0.3);
  assert.ok(c.agent.crouch, "a stealth zone crouches it whatever the player does");
});

test("catch-up: more than 25 m behind and out of view, it appears on the trail 6–14 m behind the player, out of view", () => {
  for (const seen of [false, true]) {
    const f = fight();
    const c = f.companion("brun", { x: 0, y: 0, z: 2 });
    // the camera looks north from the player: anything north of the player is in view
    const visible = (p: { x: number; z: number }) => seen || p.z < f.pl.p.z - 1;
    (c.brain as unknown as { copts: { visible: (p: { x: number; z: number }) => boolean } }).copts.visible = visible;
    f.walk(0, -1, 10, 4.2);
    if (seen) {
      assert.ok(dist(c.agent.position, f.pl.p) > 25, "in view: no teleport");
      continue;
    }
    const d = dist(c.agent.position, f.pl.p);
    assert.ok(d >= 5.5 && d <= 14.5, `reappeared ${d.toFixed(1)} m behind`);
    assert.ok(!visible(c.agent.position), "out of view");
  }
});

test("stuck for 4 s: it reappears behind the player", () => {
  const f = fight();
  const c = f.companion("brun", { x: 0, y: 0, z: 2 });
  f.walk(0, -1, 3, 3);
  // a wall across its way (the player went through a door it can't use)
  const wallZ = c.agent.position.z - 0.3;
  let last = { ...c.agent.position };
  c.agent.constrain = (p) => {
    // (a teleport is not walking through it)
    if (dist(p, last) < 1 && last.z >= wallZ && p.z < wallZ) p.z = wallZ;
    last = { ...p };
  };
  let free = Infinity;
  f.walk(0, -1, 1.2, 8, (t) => {
    if (c.agent.position.z < wallZ - 1) {
      free = t;
      return true;
    }
  });
  assert.ok(free > 3.5 && free < 6.5, `out after ${free.toFixed(1)} s`);
  assert.ok(c.events.some((e) => e.type === "caughtUp"));
  const d = dist(c.agent.position, f.pl.p);
  assert.ok(d >= 5.5 && d <= 14.5, `${d.toFixed(1)} m behind the player`);
});

test("fights alert enemies near the player, preferring one that is not on the player; then follows again", () => {
  const f = fight();
  const c = f.companion("brun", { x: 2, y: 0, z: 1 });
  const onPlayer = f.enemy("a", "soldier", { x: -1, y: 0, z: -5 });
  const free = f.enemy("b", "soldier", { x: 3, y: 0, z: -5 });
  onPlayer.brain.engage(f.player);
  free.brain.forceTarget(c.c, 0.1);
  f.combat.requestToken(onPlayer.c, f.player);
  f.run(0.3);
  assert.ok(c.brain.fighting, c.brain.state);
  assert.equal(c.brain.target, free.c, "the enemy that is not on the player");
  f.combat.debugKillAll(f.player);
  f.until(() => c.brain.state === "follow", 3);
  assert.equal(c.brain.state, "follow");
});

test("Brun's roar: an enemy on the player for 8 s is pulled onto him for 6 s (cooldown 15 s)", () => {
  const f = fight();
  const c = f.companion("brun", { x: 6, y: 0, z: 2 });
  const e = f.enemy("a", "soldier", { x: 0, y: 0, z: -4 });
  // a second enemy keeps Brun busy, so the first stays on the player
  const other = f.enemy("b", "soldier", { x: 9, y: 0, z: 0 });
  other.brain.forceTarget(c.c, 60);
  e.brain.forceTarget(f.player, 60);
  f.player.vitals.health.regen = 1000;
  const t = f.until(() => c.events.some((ev) => ev.type === "bark" && ev.kind === "special"), 14);
  assert.ok(t >= 7.5 && t < 10, `roars after ${t.toFixed(1)} s`);
  assert.equal(e.brain.target, c.c, "the enemy turns on Brun");
  assert.equal(c.brain.target, e.c);
});

test("Ivo's shield wall: the player under 30 % HP → he steps in front and blocks for 4 s", () => {
  const f = fight();
  const c = f.companion("ivo", { x: 3, y: 0, z: 1 });
  const e = f.enemy("a", "axeman", { x: 0, y: 0, z: -3 });
  e.brain.forceTarget(f.player, 60);
  f.run(0.5);
  f.player.vitals.hp = 25;
  f.until(() => c.brain.state === "guard", 2);
  assert.equal(c.brain.state, "guard");
  assert.ok(c.events.some((ev) => ev.type === "bark" && ev.kind === "special"));
  f.run(1.5);
  assert.ok(c.c.blocking, "blocking");
  const between = dist(c.agent.position, f.pl.p) < dist(e.agent.position, f.pl.p);
  assert.ok(between, "between the player and the attacker");
  assert.equal(e.brain.target, c.c, "the attacker is on him");
  f.until(() => c.brain.state !== "guard", 4);
  assert.notEqual(c.brain.state, "guard");
  assert.equal(c.c.blocking, false);
});

test("essential: at 0 HP it kneels for 6 s, then gets up at 50 %", () => {
  const f = fight();
  const c = f.companion("brun", { x: 2, y: 0, z: 1 });
  f.run(0.2);
  c.c.vitals.hp = 0;
  f.run(0.1);
  assert.equal(c.brain.state, "down");
  assert.equal(c.agent.acting, "Fixing_Kneeling");
  assert.equal(c.c.dead, false);
  f.run(5.7);
  assert.equal(c.brain.state, "down");
  f.run(0.4);
  assert.notEqual(c.brain.state, "down");
  assert.equal(c.c.vitals.hp, 100);
  assert.equal(c.agent.acting, null);
});

test("hold and place: it waits at a mark facing the player, and is put back on the trail after a teleport", () => {
  const f = fight();
  const c = f.companion("brun", { x: 2, y: 0, z: 1 });
  c.brain.hold({ x: 5, y: 0, z: 5 });
  f.run(6);
  assert.equal(c.brain.state, "wait");
  assert.ok(dist(c.agent.position, { x: 5, z: 5 }) < 0.5);
  c.brain.hold(null);
  assert.equal(c.brain.state, "follow");
  f.pl.p = { x: 50, y: 0, z: 50 };
  c.brain.place({ x: 48, y: 0, z: 50 });
  assert.equal(c.brain.trail.length, 1, "the trail starts over at the player");
  f.run(1);
  assert.ok(dist(c.agent.position, f.pl.p) < 3);
});
