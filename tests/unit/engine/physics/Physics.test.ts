import { test } from "node:test";
import assert from "node:assert/strict";
import { Quaternion, Vector3 } from "@babylonjs/core/Maths/math.vector";
import { L } from "../../../../src/engine/physics/Physics";
import { CapsuleMover } from "../../../../src/engine/physics/CapsuleMover";
import { floorAt } from "../../../../src/engine/physics/ground";
import { newPhysics } from "../../helpers/jolt";

const DOWN = new Vector3(0, -1, 0);
const near = (a: number, b: number, eps = 1e-3) => Math.abs(a - b) < eps;

test("height field holes: no collision over dropped samples, ground everywhere else", async () => {
  const ph = await newPhysics();
  // 64 m square, 2 m spacing, flat at y 10; a hole over samples x 20..24, z 30..34
  ph.addHeightField(0, 0, 64, 33, () => 10, [{ samples: { x0: 20, x1: 24, z0: 30, z1: 34 } }]);
  assert.equal(ph.rayCastStatic(new Vector3(22, 20, 32), DOWN, 30), Infinity, "open at the hole's centre");
  // Jolt drops the triangles touching a dropped sample: open up to one spacing beyond the rectangle
  assert.equal(ph.rayCastStatic(new Vector3(19, 20, 32), DOWN, 30), Infinity, "open within one spacing");
  assert.ok(near(ph.rayCastStatic(new Vector3(17, 20, 32), DOWN, 30), 10), "closed two spacings away");
  assert.ok(near(ph.rayCastStatic(new Vector3(40, 20, 10), DOWN, 30), 10), "terrain elsewhere");
  ph.dispose();
});

test("height field without holes is solid", async () => {
  const ph = await newPhysics();
  ph.addHeightField(0, 0, 64, 33, (x, z) => x * 0.1 + z * 0.05);
  assert.ok(near(ph.rayCastStatic(new Vector3(22, 20, 32), DOWN, 30), 20 - (2.2 + 1.6)));
  ph.dispose();
});

test("registry: tags, enabling and removing bodies", async () => {
  const ph = await newPhysics();
  const a = ph.addBox(new Vector3(0, 1, 0), new Vector3(1, 1, 0.1), undefined, { tag: "keep_door_l" });
  const b = ph.addBox(new Vector3(3, 1, 0), new Vector3(1, 1, 0.1), undefined, { tag: "keep_door_r" });
  const c = ph.addBox(new Vector3(6, 1, 0), new Vector3(1, 1, 0.1), undefined, { tag: "blocker_gate" });
  const d = ph.addBox(new Vector3(9, 1, 0), new Vector3(1, 1, 0.1), undefined, { tag: "blocker_gate" });
  const ray = (x: number) => ph.rayCastStatic(new Vector3(x, 1, 5), new Vector3(0, 0, -1), 10);
  assert.deepEqual(ph.tagged("keep_door_l"), [a]);
  assert.equal(ph.tagged("blocker_gate").length, 2);
  assert.equal(ph.tagOf(b), "keep_door_r");
  assert.deepEqual(ph.tagged("nothing"), []);
  assert.ok(near(ray(0), 4.9));

  ph.setBodyEnabled(a, false);
  ph.setBodyEnabled(a, false); // idempotent
  assert.equal(ray(0), Infinity, "a disabled body is not met");
  assert.equal(ph.bodyEnabled(a), false);
  ph.setBodyEnabled(a, true);
  assert.ok(near(ray(0), 4.9), "back on");

  ph.setTagEnabled("blocker_gate", false);
  assert.equal(ray(6), Infinity);
  assert.equal(ray(9), Infinity);
  // removing a disabled body is fine, and its tag goes with it
  ph.removeBody(c);
  assert.deepEqual(ph.tagged("blocker_gate"), [d]);
  assert.equal(ph.has(c), false);
  ph.setTagEnabled("blocker_gate", true);
  assert.ok(near(ray(9), 4.9));

  ph.setTag(b, "postern");
  assert.deepEqual(ph.tagged("keep_door_r"), []);
  assert.deepEqual(ph.tagged("postern"), [b]);
  ph.dispose();
});

test("rayCastStatic passes through characters and loose debris; rayCast does not", async () => {
  const ph = await newPhysics();
  const wall = ph.addBox(new Vector3(0, 1, -5), new Vector3(3, 2, 0.1), undefined, { tag: "wall" });
  ph.addBox(new Vector3(0, -0.5, 0), new Vector3(10, 0.5, 10));
  const npc = new CapsuleMover(ph, new Vector3(0, 0.02, -2));
  const debris = ph.addBox(new Vector3(0, 1, -3.5), new Vector3(0.3, 0.3, 0.3), undefined, { dynamic: true, layer: L.DEBRIS });
  const from = new Vector3(0, 1, 0), dir = new Vector3(0, 0, -1);
  assert.ok(near(ph.rayCast(from, dir, 10), 1.7, 0.05), "the moving-layer ray stops at the character's inner body");
  assert.ok(near(ph.rayCastStatic(from, dir, 10), 4.9), "the static ray reaches the wall");
  const hit = ph.rayHitStatic(from, dir, 10);
  assert.equal(hit?.body, wall);
  assert.ok(npc.innerBody);
  // from inside the character (the camera pivot of the player)
  assert.ok(near(ph.rayCastStatic(new Vector3(0, 1, -2), dir, 10), 2.9));
  void debris;
  npc.dispose();
  ph.dispose();
});

test("setBodyTransform moves a static body", async () => {
  const ph = await newPhysics();
  const id = ph.addBox(new Vector3(0, 1, 0), new Vector3(1, 1, 0.1));
  ph.setBodyTransform(id, new Vector3(5, 1, 0), Quaternion.Identity());
  const ray = (x: number) => ph.rayCastStatic(new Vector3(x, 1, 5), new Vector3(0, 0, -1), 10);
  assert.equal(ray(0), Infinity);
  assert.ok(near(ray(5), 4.9));
  assert.ok(near(ph.bodyTransform(id).position.x, 5));
  ph.dispose();
});

test("floorAt finds the floor below a hint, not the terrain above it", async () => {
  const ph = await newPhysics();
  // "terrain" at 38 with a basement floor at 32.13 under it
  ph.addBox(new Vector3(0, 37.5, 0), new Vector3(20, 0.5, 20));
  ph.addBox(new Vector3(0, 31.63, 0), new Vector3(20, 0.5, 20));
  assert.ok(near(floorAt(ph, 2, 3, 32.13)!, 32.13));
  assert.ok(near(floorAt(ph, 2, 3, 32.5)!, 32.13), "a hint a little high");
  assert.ok(near(floorAt(ph, 2, 3, 38.13)!, 38.0), "the ground floor above");
  assert.equal(floorAt(ph, 50, 3, 32.13), null, "nothing under it");
  ph.dispose();
});
