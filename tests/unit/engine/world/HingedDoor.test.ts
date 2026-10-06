import { test } from "node:test";
import assert from "node:assert/strict";
import { Quaternion, Vector3 } from "@babylonjs/core/Maths/math.vector";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { HingedDoor } from "../../../../src/engine/world/HingedDoor";
import { newPhysics, newScene } from "../../helpers/jolt";

/** A box's triangles (world). */
function box(cx: number, cy: number, cz: number, hx: number, hy: number, hz: number) {
  const pos: number[] = [], idx: number[] = [];
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) pos.push(cx + sx * hx, cy + sy * hy, cz + sz * hz);
  const faces = [[0, 1, 3, 2], [4, 6, 7, 5], [0, 4, 5, 1], [2, 3, 7, 6], [0, 2, 6, 4], [1, 5, 7, 3]];
  for (const [a, b, c, d] of faces) idx.push(a, b, c, a, c, d);
  return { pos, idx };
}

function bus() {
  const fns = new Set<(dt: number) => void>();
  return {
    onUpdate: (fn: (dt: number) => void) => (fns.add(fn), () => fns.delete(fn)),
    run(seconds: number, dt = 1 / 60) {
      for (let t = 0; t < seconds - 1e-9; t += dt) for (const f of [...fns]) f(dt);
    },
    get size() {
      return fns.size;
    },
  };
}

test("a hinged door swings open over game time (eased), its collider following; locked doors stay shut", async () => {
  const ph = await newPhysics();
  const { scene, dispose } = newScene();
  const b = bus();
  // a 1.4 m leaf from its hinge at x 0 to x 1.4, closing a doorway at z 0
  const hinge = new TransformNode("hinge", scene);
  const g = box(0.7, 1.2, 0, 0.7, 1.2, 0.05);
  const body = ph.addStaticMesh(g.pos, g.idx, { tag: "g2_door" });
  const door = new HingedDoor({ hinge, openYaw: Math.PI / 2, physics: ph, body, bus: b });
  const through = () => ph.rayCastStatic(new Vector3(0.7, 1, 3), new Vector3(0, 0, -1), 6);
  assert.ok(Math.abs(through() - 2.95) < 0.02, "shut: the doorway is blocked");
  const changes: number[] = [];
  door.changed.on((t) => changes.push(t));
  let done: boolean | null = null;
  void door.open(1.4).then((r) => (done = r));
  b.run(0.7);
  assert.ok(door.moving && door.t > 0.3 && door.t < 0.7, `half way at half time (t ${door.t.toFixed(2)})`);
  b.run(0.8);
  await Promise.resolve();
  assert.equal(done, true, "resolves once open");
  assert.equal(door.t, 1);
  assert.ok(changes.length > 10 && changes[changes.length - 1] === 1, "changed fires along the way");
  assert.equal(through(), Infinity, "open: the doorway is clear");
  // its leaf now lies along −z beside the hinge (+π/2 about +Y turns +X to −Z)
  const side = ph.rayCastStatic(new Vector3(-1, 1, -0.7), new Vector3(1, 0, 0), 3);
  assert.ok(side > 0.9 && side < 1.0, `the open leaf beside the hinge (${side.toFixed(2)})`);
  const q = Quaternion.RotationAxis(Vector3.Up(), Math.PI / 2);
  assert.ok(hinge.rotationQuaternion!.equalsWithEpsilon(q, 1e-6), "the hinge's pose");

  // set() poses at once and interrupts a swing
  let interrupted: boolean | null = null;
  void door.close(2).then((r) => (interrupted = r));
  b.run(0.2);
  door.set(0);
  await Promise.resolve();
  assert.equal(interrupted, false);
  assert.ok(Math.abs(through() - 2.95) < 0.02, "shut again");

  door.locked = true;
  assert.equal(await door.open(), false, "locked");
  assert.equal(door.t, 0);
  door.dispose();
  assert.equal(b.size, 0, "dispose leaves the bus");
  ph.dispose();
  dispose();
});

test("a lid on a +X hinge (a chest) opens about its axis", async () => {
  const { scene, dispose } = newScene();
  const b = bus();
  const hinge = new TransformNode("lid", scene);
  hinge.position.set(0, 0.43, 0.31);
  const door = new HingedDoor({ hinge, openYaw: 2.1358, axis: new Vector3(1, 0, 0), bus: b });
  door.set(1);
  const front = Vector3.TransformCoordinates(new Vector3(0, 0, -0.6), hinge.computeWorldMatrix(true));
  assert.ok(front.y > 0.8, `the lid's front edge is up (${front.y.toFixed(2)})`);
  door.dispose();
  dispose();
});
