import { test } from "node:test";
import assert from "node:assert/strict";
import { Quaternion, Vector3 } from "@babylonjs/core/Maths/math.vector";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { applyRecipe, attachToSocket, composePose, frameOrigin, recipeRotation, relativeRecipe, type QuatT } from "../../../../src/engine/actors/attach";
import { fingerBones, gripCentre } from "../../../../src/engine/actors/presets/ueMannequin";
import { newScene } from "../../helpers/jolt";

const nearV = (a: Vector3, b: Vector3, eps = 1e-5, msg = "") => assert.ok(a.subtract(b).length() < eps, `${msg} ${a} != ${b}`);
const nearQ = (a: Quaternion, b: Quaternion, eps = 1e-5, msg = "") => assert.ok(1 - Math.abs(Quaternion.Dot(a, b)) < eps, `${msg} ${a} != ${b}`);

test("recipes take quaternions or Euler angles; applyRecipe sets the local pose and scale", () => {
  const { scene, dispose } = newScene();
  const n = new TransformNode("n", scene);
  applyRecipe(n, { bone: "hand_r", rotation: [0, 0.7071, 0.7071, 0], position: [-0.03, 0.095, 0.15], scale: 1.25 });
  nearV(n.position, new Vector3(-0.03, 0.095, 0.15));
  nearQ(n.rotationQuaternion!, new Quaternion(0, Math.SQRT1_2, Math.SQRT1_2, 0));
  nearV(n.scaling, new Vector3(1.25, 1.25, 1.25));
  // the axe recipe turns the model's handle (+Y) onto the hand's grip axis (+Z)
  const handle = Vector3.Up().rotateByQuaternionToRef(n.rotationQuaternion!, new Vector3());
  nearV(handle, new Vector3(0, 0, 1));
  nearQ(recipeRotation({ rotation: [0, 0, Math.PI / 2] }), Quaternion.FromEulerAngles(0, 0, Math.PI / 2));
  nearQ(recipeRotation({}), Quaternion.Identity());
  dispose();
});

test("composePose matches a real parent/child chain of nodes", () => {
  const { scene, dispose } = newScene();
  const pq: QuatT = [0.26, 0.659, -0.486, 0.512];
  const pn = new Quaternion(...pq).normalize();
  const parent = { position: [0.1, 0.2, -0.3] as const, rotation: [pn.x, pn.y, pn.z, pn.w] as QuatT };
  const child = { position: [-0.03, 0.095, 0] as const, rotation: [0.5, 0.5, 0.5, 0.5] as QuatT };
  const a = new TransformNode("a", scene), b = new TransformNode("b", scene);
  b.parent = a;
  applyRecipe(a, { bone: "x", ...parent });
  applyRecipe(b, { bone: "x", ...child });
  b.computeWorldMatrix(true);
  const s = new Vector3(), q = new Quaternion(), p = new Vector3();
  a.computeWorldMatrix(true);
  b.computeWorldMatrix(true).decompose(s, q, p);
  const c = composePose(parent, child);
  nearV(new Vector3(...c.position), p);
  nearQ(new Quaternion(...c.rotation), q);
  dispose();
});

test("frameOrigin puts a frame's local point where it was measured; relativeRecipe re-expresses a held item", () => {
  const rot: QuatT = [0.26, 0.659, -0.486, 0.512];
  const grip = gripCentre("r");
  const origin = frameOrigin(rot, [-0.138, 0.347, -0.216], grip);
  // the grip centre, carried through the frame, lands on the measured point
  const q = new Quaternion(...rot);
  const back = new Vector3(...grip).rotateByQuaternionToRef(q, new Vector3()).add(new Vector3(...origin));
  nearV(back, new Vector3(-0.138, 0.347, -0.216));
  // a sword held at the grip centre ends up with its grip at the measured point on the spine
  const held = { bone: "hand_r", rotation: [0.5, 0.5, 0.5, 0.5] as QuatT, position: grip, scale: 1 };
  const stow = relativeRecipe("spine_03", { rotation: rot, position: origin }, held);
  assert.equal(stow.bone, "spine_03");
  nearV(new Vector3(...(stow.position as [number, number, number])), new Vector3(-0.138, 0.347, -0.216));
  assert.equal(stow.scale, 1);
});

test("attachToSocket hangs an item and its disposer takes it off (keeping it where it is)", () => {
  const { scene, dispose } = newScene();
  const socket = new TransformNode("socket", scene);
  socket.position.set(1, 2, 3);
  const item = new TransformNode("item", scene);
  const off = attachToSocket(item, socket, { bone: "hand_r", position: [0, 1, 0] });
  assert.equal(item.parent, socket);
  item.computeWorldMatrix(true);
  nearV(item.getAbsolutePosition(), new Vector3(1, 3, 3));
  off();
  assert.equal(item.parent, null);
  item.computeWorldMatrix(true);
  nearV(item.getAbsolutePosition(), new Vector3(1, 3, 3));
  dispose();
});

test("the mannequin's weapon hand has 15 finger joints", () => {
  const r = fingerBones("r");
  assert.equal(r.length, 15);
  assert.equal(new Set(r).size, 15);
  assert.ok(r.includes("thumb_01_r") && r.includes("pinky_03_r"));
  assert.ok(fingerBones("l").every((n) => n.endsWith("_l")));
});
