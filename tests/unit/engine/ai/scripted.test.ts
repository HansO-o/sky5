// The scripted hand-off (design §3.6 `ai.suspend` / `ai.resume`) and the token rule, as the keep's
// scenes use them: a scripted walk drags the agent (pose, capsule) along, a stale scope never
// resumes a newer scene, a staggering first blow ends an `untilHit` scene into the reel, senses
// rest through a scene, and a far-off holder never keeps a turn.
import { test } from "node:test";
import assert from "node:assert/strict";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { Quaternion } from "@babylonjs/core/Maths/math.vector";
import { PLAYER_WEAPONS } from "../../../../src/engine/combat/attacks";
import { AgentMover } from "../../../../src/engine/ai/AgentMover";
import { CapsuleMover } from "../../../../src/engine/physics/CapsuleMover";
import { newPhysics, newScene } from "../../helpers/jolt";
import { dist, fight } from "../../helpers/ai";

test("suspended AgentMover follows its body: pose, facing and capsule go where the script puts the body", async () => {
  const ph = await newPhysics();
  const sc = newScene();
  ph.addBox(new Vector3(0, -0.5, 0), new Vector3(20, 0.5, 20));
  const updaters = new Set<(dt: number) => void>();
  const bus = { onUpdate: (fn: (dt: number) => void) => (updaters.add(fn), () => updaters.delete(fn)) };
  const frame = (seconds: number) => {
    const n = Math.round(seconds * 60);
    for (let i = 0; i < n; i++) {
      ph.update(1 / 60);
      for (const fn of updaters) fn(1 / 60);
    }
  };
  const root = new TransformNode("body", sc.scene);
  const body = { root, play: () => undefined, hasClip: () => false };
  const agent = new AgentMover({ mover: new CapsuleMover(ph, new Vector3(0, 0.02, 0)), body, bus, gait: null, yaw: 0 });
  frame(0.5);
  assert.ok(dist(agent.position, { x: 0, z: 0 }) < 0.05, "standing at its start");
  agent.suspended = true;
  // the script walks the body 3 m east and turns it to face east (game yaw −π/2; the root faces +Z)
  root.position.set(3, 0, 0);
  const y = -Math.PI / 2 + Math.PI;
  root.rotationQuaternion = new Quaternion(0, Math.sin(y / 2), 0, Math.cos(y / 2));
  frame(0.1);
  assert.ok(dist(agent.position, { x: 3, z: 0 }) < 0.05, `the agent follows (${agent.position.x.toFixed(2)}, ${agent.position.z.toFixed(2)})`);
  assert.ok(Math.abs(Math.atan2(Math.sin(agent.yaw + Math.PI / 2), Math.cos(agent.yaw + Math.PI / 2))) < 1e-6, `and turns with it (${agent.yaw.toFixed(3)})`);
  assert.ok(dist(agent.capsule!.position, { x: 3, z: 0 }) < 0.05, "the capsule too");
  // nothing is left at the old spot: a ray there meets only the floor, one at the new spot the capsule
  const down = new Vector3(0, -1, 0);
  assert.ok(Math.abs(ph.rayCast(new Vector3(0, 1.2, 0), down, 3) - 1.2) < 0.02, "the old spot is empty (the floor at 1.2 m)");
  assert.ok(ph.rayCast(new Vector3(3, 1.2, 0), down, 3) < 1.1, "the capsule's inner body is at the new spot");
  // a second capsule walks straight through the old spot
  const other = new CapsuleMover(ph, new Vector3(-3, 0.02, 0));
  const off = other.drive(() => ({ vx: 2, vz: 0 }));
  frame(2.2);
  off();
  assert.ok(other.position.x > 1 && Math.abs(other.position.z) < 0.15, `walked through (${other.position.x.toFixed(2)}, ${other.position.z.toFixed(2)})`);
  // back from the script: it walks on from where it was left (no snap back)
  agent.suspended = false;
  frame(0.2);
  assert.ok(dist(agent.position, { x: 3, z: 0 }) < 0.1, "resumes where the script left it");
  assert.ok(dist(root.position, { x: 3, z: 0 }) < 0.1, "and the body stays there");
  other.dispose();
  agent.dispose();
  ph.dispose();
  sc.dispose();
});

test("a scope that ends after a resume never resumes a newer scene", () => {
  const f = fight();
  const e = f.enemy("interrog", "interrogator", { x: 0, y: 0, z: -6, yaw: Math.PI }, { aware: false });
  const first: (() => void)[] = [];
  f.ai.suspend(e.c, { scope: { add: (fn: () => void) => void first.push(fn) } });
  f.ai.resume(e.c);
  assert.equal(e.brain.state, "post");
  // a newer scene takes it (held by hand)
  f.ai.suspend(e.c);
  assert.equal(e.brain.state, "scripted");
  for (const fn of first) fn();
  assert.equal(e.brain.state, "scripted", "the first scene's scope ending is stale");
  // its own scope still works
  const second: (() => void)[] = [];
  f.ai.resume(e.c);
  f.ai.suspend(e.c, { scope: { add: (fn: () => void) => void second.push(fn) } });
  for (const fn of second) fn();
  assert.equal(e.brain.state, "post");
});

test("untilHit: a first blow that staggers ends the scene into the reel (the hit reaction plays)", () => {
  const f = fight();
  const e = f.enemy("interrog", "interrogator", { x: 0, y: 0, z: -1.5, yaw: Math.PI }, { aware: false });
  f.ai.suspend("interrog", { untilHit: true });
  f.run(0.5);
  assert.equal(e.brain.state, "scripted");
  f.combat.strike(f.player, e.c, { ...PLAYER_WEAPONS.sword.heavy, damage: 5, poiseDamage: 100 });
  assert.equal(e.brain.state, "stagger", `into the reel (${e.states.join(" ")})`);
  assert.ok(e.brain.fighting);
  assert.equal(e.agent.suspended, false, "the body is the brain's again");
  assert.ok(e.agent.acting, "a hit reaction plays");
  f.until(() => e.brain.state !== "stagger", 3);
  assert.ok(e.brain.fighting, `then fights (${e.brain.state})`);
  // and a later scope hook from that scene does nothing
});

test("a scripted humanoid's senses rest through the scene: no meter, no HUD eye; back as they were after", () => {
  const f = fight();
  f.pl.p = { x: 0, y: 0, z: 0 };
  // the guard faces the player (+Z), 6 m off, in plain sight
  const e = f.enemy("g", "soldier", { x: 0, y: 0, z: -6, yaw: Math.PI }, { perceive: true });
  const sensor = (e.brain as unknown as { sensor: { meter: number; enabled: boolean } }).sensor;
  f.ai.suspend("g");
  f.pl.moving = true;
  f.run(3);
  assert.equal(sensor.meter, 0, "nothing climbs while the scene has it");
  assert.equal(f.ai.perception.awareness(), 0, "the HUD eye stays shut");
  assert.equal(e.brain.state, "scripted");
  f.ai.resume("g");
  assert.ok(sensor.enabled, "the senses are back");
  const t = f.until(() => e.brain.fighting, 4);
  assert.ok(t < 4, "and it sees the player now");
});

test("tokens: an attacker far from its target (stuck behind geometry) does not keep a turn from the near ones", () => {
  const f = fight();
  // one soldier stuck 30 m off (it cannot move), two more close by
  const far = f.enemy("far", "soldier", { x: 0, y: 0, z: -30 });
  far.agent.constrain = (p) => {
    p.x = 0;
    p.z = -30;
  };
  const near = [-2, 2].map((x, i) => f.enemy(`n${i}`, "soldier", { x, y: 0, z: -5 }));
  let farHeld = 0;
  let both = false;
  f.run(15, () => {
    if (f.combat.tokenOf(far.c)) farHeld += 1 / 60;
    if (near.every((n) => f.combat.tokenOf(n.c))) both = true;
  });
  assert.ok(farHeld < 0.6, `the far one held a turn ${farHeld.toFixed(2)} s`);
  assert.ok(both, "both near ones had a turn at once");
});
