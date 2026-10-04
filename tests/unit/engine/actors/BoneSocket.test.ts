import { test } from "node:test";
import assert from "node:assert/strict";
import { Matrix, Quaternion, Vector3 } from "@babylonjs/core/Maths/math.vector";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { BoneSocket, refreshWorldMatrix, rigidPose } from "../../../../src/engine/actors/BoneSocket";
import { newScene } from "../../helpers/jolt";

const near = (a: number, b: number, eps = 1e-5, msg = "") => assert.ok(Math.abs(a - b) < eps, `${msg} ${a} != ${b}`);
const nearV = (a: Vector3, b: Vector3, eps = 1e-5, msg = "") => assert.ok(a.subtract(b).length() < eps, `${msg} ${a} != ${b}`);
/** same rotation (q and -q are the same) */
const nearQ = (a: Quaternion, b: Quaternion, eps = 1e-5, msg = "") => assert.ok(1 - Math.abs(Quaternion.Dot(a, b)) < eps, `${msg} ${a} != ${b}`);

test("rigidPose: an unscaled or uniformly scaled matrix gives its own rotation and translation", () => {
  const q = Quaternion.FromEulerAngles(0.3, -1.1, 0.7);
  const p = new Vector3(1, 2, -3);
  for (const s of [1, 1.3]) {
    const m = Matrix.Compose(new Vector3(s, s, s), q, p);
    const outP = new Vector3(), outQ = new Quaternion();
    rigidPose(m, outP, outQ);
    nearV(outP, p);
    nearQ(outQ, q);
  }
});

test("rigidPose: shear and non-uniform scale are dropped, the primary axis keeps its direction", () => {
  // a child rotated under a parent scaled along X only (the spine's build scale): a sheared frame
  const parent = Matrix.Compose(new Vector3(1.25, 1, 1), Quaternion.Identity(), Vector3.Zero());
  const child = Matrix.Compose(Vector3.One(), Quaternion.FromEulerAngles(0.4, 0.2, 0.9), new Vector3(0.1, 0.5, 0));
  const world = child.multiply(parent);
  const outP = new Vector3(), outQ = new Quaternion();
  rigidPose(world, outP, outQ);
  const r = new Matrix();
  outQ.toRotationMatrix(r);
  const x = Vector3.TransformNormal(Vector3.Right(), r), y = Vector3.TransformNormal(Vector3.Up(), r), z = Vector3.TransformNormal(new Vector3(0, 0, 1), r);
  // orthonormal and right-handed
  near(x.length(), 1);
  near(y.length(), 1);
  near(z.length(), 1);
  near(Vector3.Dot(x, y), 0);
  near(Vector3.Dot(y, z), 0);
  nearV(Vector3.Cross(x, y), z);
  // Y points where the sheared Y axis points
  const ySheared = Vector3.TransformNormal(Vector3.Up(), world).normalize();
  nearV(y, ySheared);
  nearV(outP, world.getTranslation());
  // other primary axes are honoured too
  rigidPose(world, outP, outQ, 2);
  outQ.toRotationMatrix(r);
  nearV(Vector3.TransformNormal(new Vector3(0, 0, 1), r), Vector3.TransformNormal(new Vector3(0, 0, 1), world).normalize());
});

function rig() {
  const s = newScene();
  const root = new TransformNode("npc_root", s.scene);
  root.rotationQuaternion = Quaternion.RotationAxis(Vector3.Up(), 0.8);
  root.position.set(4, 0, -2);
  root.scaling.setAll(1.05);
  const spine = new TransformNode("spine_03", s.scene);
  spine.parent = root;
  spine.position.set(0, 1.3, 0);
  spine.rotationQuaternion = Quaternion.Identity();
  // the appearance's build scale: widens the torso along the spine's X
  spine.scaling.set(1.2, 1, 1);
  const hand = new TransformNode("hand_r", s.scene);
  hand.parent = spine;
  hand.position.set(-0.4, 0.1, 0.1);
  hand.rotationQuaternion = Quaternion.FromEulerAngles(0.3, 0.5, -1.2);
  return { ...s, root, spine, hand };
}

test("a socket copies the joint's world position and rotation, without its scale or shear", () => {
  const { scene, hand, dispose } = rig();
  const sock = new BoneSocket(scene, hand);
  const item = new TransformNode("item", scene);
  item.parent = sock.node;
  item.position.set(0, 0.1, 0);
  // move the arm: the socket follows on the next frame
  hand.rotationQuaternion = Quaternion.FromEulerAngles(-0.2, 1.0, 0.4);
  scene.onBeforeRenderObservable.notifyObservers(scene);
  const hw = refreshWorldMatrix(hand);
  const sw = sock.node.getWorldMatrix();
  nearV(sw.getTranslation(), hw.getTranslation());
  const s = new Vector3(), q = new Quaternion();
  sw.decompose(s, q);
  nearV(s, Vector3.One(), 1e-5, "unit scale");
  // the socket's Y axis is the joint's (sheared) Y direction
  nearV(Vector3.TransformNormal(Vector3.Up(), sw).normalize(), Vector3.TransformNormal(Vector3.Up(), hw).normalize());
  // the item keeps its own size: 0.1 m along the socket's Y is 0.1 m in the world
  item.computeWorldMatrix(true);
  near(Vector3.Distance(item.getAbsolutePosition(), sw.getTranslation()), 0.1);
  dispose();
});

test("a socket shows and hides with the body, and goes with the joint unless told otherwise", () => {
  const { scene, root, hand, dispose } = rig();
  const sock = new BoneSocket(scene, hand);
  const keep = new BoneSocket(scene, hand, { disposeWithBone: false });
  const item = new TransformNode("item", scene);
  item.parent = sock.node;
  root.setEnabled(false);
  scene.onBeforeRenderObservable.notifyObservers(scene);
  assert.equal(sock.node.isEnabled(), false);
  root.setEnabled(true);
  scene.onBeforeRenderObservable.notifyObservers(scene);
  assert.equal(sock.node.isEnabled(), true);
  root.dispose();
  assert.equal(sock.node.isDisposed(), true);
  assert.equal(item.isDisposed(), true, "what hangs on it goes too, as a child of the joint would");
  assert.equal(keep.node.isDisposed(), false);
  scene.onBeforeRenderObservable.notifyObservers(scene);
  assert.equal(keep.bone, null);
  assert.equal(keep.node.isEnabled(), false, "detached: hidden until rebound");
  // a rebuilt body: follow its joint
  const hand2 = new TransformNode("hand_r", scene);
  hand2.position.set(7, 1, 7);
  keep.rebind(hand2);
  assert.equal(keep.node.isEnabled(), true);
  nearV(keep.node.position, new Vector3(7, 1, 7));
  keep.dispose();
  keep.dispose();
  dispose();
});
