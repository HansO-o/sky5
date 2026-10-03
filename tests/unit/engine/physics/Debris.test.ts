import { test } from "node:test";
import assert from "node:assert/strict";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { CreateBox } from "@babylonjs/core/Meshes/Builders/boxBuilder";
import { Debris } from "../../../../src/engine/physics/Debris";
import { L } from "../../../../src/engine/physics/Physics";
import { newPhysics, newScene, run } from "../../helpers/jolt";

test("pieces fall, settle and freeze into scenery after 8 s of game time", async () => {
  const ph = await newPhysics();
  const { scene, dispose } = newScene();
  ph.addBox(new Vector3(0, -0.5, 0), new Vector3(10, 0.5, 10));
  let shadowed = 0;
  const debris = new Debris({ physics: ph, scene, shadows: (m) => (shadowed += m.length) });
  const set = debris.spawn([
    { center: new Vector3(0, 3, 0), half: new Vector3(0.4, 0.3, 0.3) },
    { center: new Vector3(2, 5, 0), half: new Vector3(0.3, 0.3, 0.3), velocity: new Vector3(1, 0, 0) },
  ]);
  assert.equal(set.meshes.length, 2);
  assert.equal(shadowed, 2);
  run(ph, 4);
  assert.equal(set.settled, false);
  // the meshes follow their bodies down to the floor
  assert.ok(set.meshes[0].position.y < 0.5, `fell to ${set.meshes[0].position.y}`);
  run(ph, 4.2);
  assert.equal(set.settled, true);
  await set.done;
  const y = set.meshes[0].position.y;
  run(ph, 1);
  assert.equal(set.meshes[0].position.y, y, "frozen");
  // ragdoll layer and no colliders left: a ray meets only the floor
  assert.ok(Math.abs(ph.rayCastStatic(new Vector3(0, 3, 0), new Vector3(0, -1, 0), 5) - 3) < 1e-3);
  set.dispose();
  assert.equal(set.meshes.length, 0);
  assert.equal(debris.active.length, 0);
  ph.dispose();
  dispose();
});

test("solid debris leaves static colliders where it came to rest", async () => {
  const ph = await newPhysics();
  const { scene, dispose } = newScene();
  ph.addBox(new Vector3(0, -0.5, 0), new Vector3(10, 0.5, 10));
  const debris = new Debris({ physics: ph, scene });
  const block = CreateBox("crenellation", { width: 1.2, height: 0.8, depth: 0.8 }, scene);
  block.position.set(4, 3, 4);
  const set = debris.spawn([{ node: block, center: block.position.clone(), half: new Vector3(0.6, 0.4, 0.4) }], { layer: L.DEBRIS, solid: true, tag: "crenellation", settle: 3 });
  assert.equal(set.meshes.length, 0, "a passed node is not owned");
  run(ph, 3.1);
  assert.equal(set.settled, true);
  assert.equal(ph.tagged("crenellation").length, 1);
  const top = ph.rayCastStatic(new Vector3(block.position.x, 5, block.position.z), new Vector3(0, -1, 0), 6);
  assert.ok(Math.abs(5 - top - 0.8) < 0.1, `rests on the floor, top at ${5 - top}`);
  set.dispose();
  assert.equal(ph.tagged("crenellation").length, 0);
  assert.equal(block.isDisposed(), false);
  ph.dispose();
  dispose();
});

test("burst throws count pieces along push; freeze() ends early; dispose() cleans up", async () => {
  const ph = await newPhysics();
  const { scene, dispose } = newScene();
  ph.addBox(new Vector3(0, -0.5, 0), new Vector3(30, 0.5, 30));
  const debris = new Debris({ physics: ph, scene });
  let seed = 1;
  const rng = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
  const set = debris.burst({ min: new Vector3(-1, 4, -1), max: new Vector3(1, 6, 1) }, { count: 16, push: new Vector3(-1, 0.15, 0), rng });
  assert.equal(set.meshes.length, 16);
  run(ph, 1.5);
  const meanX = set.meshes.reduce((s, m) => s + m.position.x, 0) / 16;
  assert.ok(meanX < -2, `thrown along -x (mean x ${meanX.toFixed(2)})`);
  set.freeze();
  assert.equal(set.settled, true);
  debris.dispose();
  assert.equal(set.meshes.length, 0);
  ph.dispose();
  dispose();
});
