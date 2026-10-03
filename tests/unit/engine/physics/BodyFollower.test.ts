import { test } from "node:test";
import assert from "node:assert/strict";
import { Matrix, Quaternion, Vector3 } from "@babylonjs/core/Maths/math.vector";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { BodyFollower, rigidDelta } from "../../../../src/engine/physics/BodyFollower";
import { newPhysics, newScene } from "../../helpers/jolt";

const near = (a: number, b: number, eps = 1e-4) => Math.abs(a - b) < eps;

test("rigidDelta maps rest-pose world points onto the current pose", () => {
  const hinge = new Vector3(58, 38, -653.65);
  const rest = Matrix.Compose(Vector3.One(), Quaternion.Identity(), hinge);
  const q = Quaternion.RotationAxis(Vector3.Up(), 1.2);
  const now = Matrix.Compose(Vector3.One(), q, hinge);
  const { position, rotation } = rigidDelta(rest, now);
  const local = new Vector3(1.5, 2, 0.1);
  const wRest = Vector3.TransformCoordinates(local, rest), wNow = Vector3.TransformCoordinates(local, now);
  const moved = wRest.applyRotationQuaternion(rotation).add(position);
  assert.ok(Vector3.Distance(moved, wNow) < 1e-4, `${moved} vs ${wNow}`);
  // the hinge itself stays put
  assert.ok(Vector3.Distance(hinge.applyRotationQuaternion(rotation).add(position), hinge) < 1e-4);
});

test("a door leaf's collider swings with its hinge", async () => {
  const ph = await newPhysics();
  const { scene, dispose } = newScene();
  // a leaf 2 m wide from its hinge at x 58 to x 60, 5 m tall, closing the opening at z -653.65
  const hinge = new TransformNode("hinge", scene);
  hinge.position.set(58, 38, -653.65);
  hinge.rotationQuaternion = Quaternion.Identity();
  const box = (cx: number, cy: number, cz: number, hx: number, hy: number, hz: number) => {
    const pos: number[] = [], idx: number[] = [];
    for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) pos.push(cx + sx * hx, cy + sy * hy, cz + sz * hz);
    const faces = [[0, 1, 3, 2], [4, 6, 7, 5], [0, 4, 5, 1], [2, 3, 7, 6], [0, 2, 6, 4], [1, 5, 7, 3]];
    for (const [a, b, c, d] of faces) idx.push(a, b, c, a, c, d);
    return { pos, idx };
  };
  const g = box(59, 40.5, -653.65, 1, 2.5, 0.1);
  const body = ph.addStaticMesh(g.pos, g.idx, { tag: "keep_door_l" });
  const f = new BodyFollower(ph, body, hinge);
  const through = () => ph.rayCastStatic(new Vector3(59.5, 39, -650), new Vector3(0, 0, -1), 10);
  assert.ok(near(through(), 3.55, 0.01), "closed");
  // swing inward (toward -z) by 85°
  Quaternion.RotationAxisToRef(Vector3.Up(), (85 * Math.PI) / 180, hinge.rotationQuaternion);
  f.sync();
  assert.equal(through(), Infinity, "open: the doorway is clear");
  // the leaf now runs from the hinge toward -z: a ray along x just inside meets it
  const side = ph.rayCastStatic(new Vector3(56, 39, -655), new Vector3(1, 0, 0), 5);
  assert.ok(side > 1.8 && side < 2.1, `leaf beside the hinge, met at ${side}`);
  hinge.rotationQuaternion.copyFrom(Quaternion.Identity());
  f.sync();
  assert.ok(near(through(), 3.55, 0.01), "closed again");
  ph.dispose();
  dispose();
});
