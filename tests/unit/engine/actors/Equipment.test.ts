import { test } from "node:test";
import assert from "node:assert/strict";
import { Quaternion, Vector3 } from "@babylonjs/core/Maths/math.vector";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { Equipment, bodyHost, type EquipmentHost, type ItemPlacement } from "../../../../src/engine/actors/Equipment";
import { poseFromGroup, JointPose } from "../../../../src/engine/actors/fingers";
import { ProceduralLayer } from "../../../../src/engine/anim/ProceduralLayer";
import { fingerBones, UAL_DRAW, UAL_SHEATHE } from "../../../../src/engine/actors/presets/ueMannequin";
import { newScene } from "../../helpers/jolt";
import { frames, turnGroup } from "../../helpers/anim";

const near = (a: number, b: number, eps = 1e-5, msg = "") => assert.ok(Math.abs(a - b) < eps, `${msg} ${a} != ${b}`);
const nearV = (a: Vector3, b: Vector3, eps = 1e-5, msg = "") => assert.ok(a.subtract(b).length() < eps, `${msg} ${a} != ${b}`);
const nearQ = (a: Quaternion, b: Quaternion, eps = 1e-5, msg = "") => assert.ok(1 - Math.abs(Quaternion.Dot(a, b)) < eps, `${msg} ${a} != ${b}`);

/** A body with a spine, two hands and the right hand's fingers; a manual update bus. */
function body(name = "body") {
  const s = newScene();
  const root = new TransformNode(name, s.scene);
  const bones = new Map<string, TransformNode>();
  const add = (n: string, parent: TransformNode, p: [number, number, number]) => {
    const b = new TransformNode(n, s.scene);
    b.parent = parent;
    b.position.set(...p);
    b.rotationQuaternion = Quaternion.Identity();
    bones.set(n, b);
    return b;
  };
  const spine = add("spine_03", root, [0, 1.3, 0]);
  const hr = add("hand_r", spine, [-0.6, 0.1, 0]);
  add("hand_l", spine, [0.6, 0.1, 0]);
  for (const f of fingerBones("r")) add(f, hr, [0, 0.05, 0]);
  const fns = new Set<(dt: number) => void>();
  const bus = {
    onUpdate(fn: (dt: number) => void) {
      fns.add(fn);
      return () => fns.delete(fn);
    },
  };
  const tick = (dt: number, n = 1) => {
    for (let i = 0; i < n; i++) {
      for (const fn of fns) fn(dt);
      s.scene.onBeforeRenderObservable.notifyObservers(s.scene);
    }
  };
  return { ...s, root, bones, bus, tick, fns };
}

const SWORD: ItemPlacement = {
  hand: { bone: "hand_r", position: [-0.03, 0.095, 0], rotation: [0.5, 0.5, 0.5, 0.5] },
  stow: { bone: "spine_03", position: [-0.1, 0.3, -0.2], rotation: [0, 0, 0, 1] },
};
const SHIELD: ItemPlacement = { hand: { bone: "hand_l", position: [-0.06, 0.095, 0.04] }, stow: { bone: "spine_03", position: [0, 0, -0.27] } };

function host(b: ReturnType<typeof body>, play = true) {
  const calls: string[] = [];
  const h: EquipmentHost = {
    bone: (n) => b.bones.get(n),
    playOnce: (clip) => {
      calls.push(`play ${clip}`);
      return play;
    },
    releaseOnce: (clip) => void calls.push(`release ${clip}`),
    clipLength: () => 0,
  };
  return { h, calls };
}

const parentBone = (eq: Equipment, n: TransformNode) => (eq.socket("hand_r").node === n.parent ? "hand_r" : eq.socket("spine_03").node === n.parent ? "spine_03" : eq.socket("hand_l").node === n.parent ? "hand_l" : "?");

test("items hang stowed until drawn; the draw clip moves them to the hands at its swap time", async () => {
  const b = body();
  const { h, calls } = host(b);
  const eq = new Equipment(h, { scene: b.scene, bus: b.bus, draw: UAL_DRAW, sheathe: UAL_SHEATHE, settle: 0.15 });
  const sword = new TransformNode("sword", b.scene);
  const shield = new TransformNode("shield", b.scene);
  eq.set("main", sword, SWORD);
  eq.set("off", shield, SHIELD);
  assert.equal(eq.where("main"), "stow");
  assert.equal(parentBone(eq, sword), "spine_03");
  nearV(sword.position, new Vector3(-0.1, 0.3, -0.2));
  assert.equal(eq.armed, false);
  let done: boolean | null = null;
  void eq.draw().then((ok) => (done = ok));
  assert.deepEqual(calls, ["play Sword_Enter"]);
  assert.equal(eq.busy, "draw");
  b.tick(0.1, 7); // 0.7 s: not yet
  assert.equal(eq.where("main"), "stow");
  b.tick(0.1); // 0.8 s: past 0.72
  assert.equal(eq.armed, true);
  assert.equal(eq.where("main"), "hand");
  assert.equal(parentBone(eq, sword), "hand_r");
  assert.equal(parentBone(eq, shield), "hand_l");
  // it glides onto the recipe over the settle time
  b.tick(0.1, 2);
  nearV(sword.position, new Vector3(-0.03, 0.095, 0));
  nearQ(sword.rotationQuaternion!, new Quaternion(0.5, 0.5, 0.5, 0.5));
  b.tick(0.1, 3); // past the release (1.05)
  await Promise.resolve();
  assert.equal(done, true);
  assert.equal(eq.busy, null);
  assert.deepEqual(calls, ["play Sword_Enter", "release Sword_Enter"]);
  // drawing again: already armed
  assert.equal(await eq.draw(), true);
  eq.dispose();
  assert.equal(sword.isDisposed(), true);
  assert.equal(b.fns.size, 0, "off the bus");
  b.dispose();
});

test("without the clip (missing, or the host declines) the items change hands at once", async () => {
  const b = body();
  const { h } = host(b, false);
  const eq = new Equipment(h, { scene: b.scene, bus: b.bus, draw: UAL_DRAW, sheathe: UAL_SHEATHE });
  assert.equal(await eq.draw(), false, "nothing to draw");
  const sword = new TransformNode("sword", b.scene);
  eq.set("main", sword, SWORD);
  assert.equal(await eq.draw(), true);
  assert.equal(eq.where("main"), "hand");
  assert.equal(await eq.sheathe({ animate: false }), true);
  assert.equal(eq.where("main"), "stow");
  eq.dispose();
  b.dispose();
});

test("a sheathe interrupts a draw that has not reached its swap; setArmed is instant", async () => {
  const b = body();
  const { h } = host(b);
  const eq = new Equipment(h, { scene: b.scene, bus: b.bus, draw: UAL_DRAW, sheathe: UAL_SHEATHE });
  const sword = new TransformNode("sword", b.scene);
  eq.set("main", sword, SWORD);
  const drawing = eq.draw();
  b.tick(0.1, 3);
  const sheathing = eq.sheathe();
  assert.equal(await drawing, false);
  assert.equal(await sheathing, true, "never left the back");
  eq.setArmed(true);
  assert.equal(eq.where("main"), "hand");
  nearV(sword.position, new Vector3(-0.03, 0.095, 0));
  // an item put in while armed goes straight to the hand
  const other = new TransformNode("axe", b.scene);
  const prev = eq.set("main", other, SWORD);
  assert.equal(prev, sword);
  assert.equal(sword.parent, null);
  assert.equal(eq.where("main"), "hand");
  // a stow-less item hides when put away
  eq.set("off", new TransformNode("torch_like", b.scene), { hand: { bone: "hand_l" }, stow: null });
  eq.setArmed(false);
  assert.equal(eq.where("off"), "none");
  assert.equal(eq.item("off")!.isEnabled(false), false);
  eq.dispose(false);
  assert.equal(other.isDisposed(), false, "dispose(false) leaves the items to the caller");
  b.dispose();
});

test("worn things, visibility and a rebuilt body", () => {
  const b = body();
  const { h } = host(b);
  const eq = new Equipment(h, { scene: b.scene, bus: b.bus });
  const box = MeshBuilder.CreateBox("cuff", { size: 0.05 }, b.scene);
  const cuff = new TransformNode("cuffs", b.scene);
  box.parent = cuff;
  eq.wear("cuffs_r", cuff, { bone: "hand_r", position: [0, 0.015, 0] });
  assert.equal(eq.worn("cuffs_r"), cuff);
  assert.equal(parentBone(eq, cuff), "hand_r");
  eq.setVisible(false);
  assert.equal(box.isVisible, false);
  eq.setVisible(true);
  assert.equal(box.isVisible, true);
  // the body is rebuilt: same joint names on new nodes
  const hand2 = new TransformNode("hand_r", b.scene);
  hand2.position.set(3, 1, 0);
  b.bones.set("hand_r", hand2);
  b.bones.get("spine_03")!.parent!.dispose();
  b.tick(0.016);
  assert.equal(eq.socket("hand_r").node.isEnabled(false), false, "the old joints are gone: hidden");
  eq.rebind();
  b.tick(0.016);
  nearV(eq.socket("hand_r").node.position, new Vector3(3, 1, 0));
  assert.equal(eq.wear("cuffs_r", null), cuff);
  assert.equal(cuff.isEnabled(false), false);
  eq.dispose();
  b.dispose();
});

test("the weapon hand closes on the handle while armed (the idle grip's first frame), fading in and out", () => {
  const b = body();
  const names = fingerBones("r");
  const closed = Quaternion.RotationAxis(Vector3.Right(), 1.2);
  // the grip clip: every finger from closed (frame 0) to open
  const grip = turnGroup(b.scene, "Sword_Idle", names.map((n) => [b.bones.get(n)!, closed, Quaternion.Identity()] as [TransformNode, Quaternion, Quaternion]), 60);
  const pose = poseFromGroup(grip, names);
  assert.equal(pose.size, 15);
  nearQ(pose.get("index_02_r")!, closed);
  // halfway through the clip reads the half-turned pose
  nearQ(poseFromGroup(grip, ["thumb_01_r"], 30).get("thumb_01_r")!, Quaternion.Slerp(closed, Quaternion.Identity(), 0.5));
  const { h } = host(b, false);
  const eq = new Equipment(h, { scene: b.scene, bus: b.bus, grip: { pose, fade: 0.1 } });
  eq.set("main", new TransformNode("sword", b.scene), SWORD);
  const f = b.bones.get("middle_01_r")!;
  b.tick(0.016);
  nearQ(f.rotationQuaternion!, Quaternion.Identity(), 1e-6, "unarmed: the animation's pose");
  eq.setArmed(true);
  b.tick(0.016);
  nearQ(f.rotationQuaternion!, closed, 1e-6, "armed: closed");
  // before the next animation pass the animated pose is back (nothing accumulates)
  b.scene.onBeforeAnimationsObservable.notifyObservers(b.scene);
  nearQ(f.rotationQuaternion!, Quaternion.Identity(), 1e-6);
  // a glide-free sheathe still fades the grip out over 0.1 s
  void eq.sheathe({ animate: false });
  b.tick(0.05);
  const half = f.rotationQuaternion!.clone();
  near(Quaternion.Dot(half, Quaternion.Slerp(Quaternion.Identity(), closed, 0.5)), 1, 1e-3);
  b.scene.onBeforeAnimationsObservable.notifyObservers(b.scene);
  b.tick(0.06);
  nearQ(f.rotationQuaternion!, Quaternion.Identity(), 1e-6);
  eq.dispose();
  b.dispose();
});

test("bodyHost plays the clip on the body unless it lacks it", () => {
  const played: string[] = [];
  const h = bodyHost({ bone: () => undefined, play: (c) => void played.push(c), hasClip: (c) => c === "Sword_Enter", clipLength: () => 1.3 });
  assert.equal(h.playOnce!("Sword_Enter", { speed: 1, blend: 0.1 }), true);
  assert.equal(h.playOnce!("Sword_Exit", { speed: 1, blend: 0.1 }), false);
  assert.deepEqual(played, ["Sword_Enter"]);
  assert.equal(h.clipLength!("x"), 1.3);
});

test("the procedural layer works on the animated pose each frame and never accumulates", () => {
  const b = body();
  const bone = b.bones.get("spine_03")!;
  const q0 = Quaternion.RotationAxis(Vector3.Up(), 0.3);
  const anim = turnGroup(b.scene, "Breathe", [[bone, q0, q0]], 60);
  anim.start(true);
  const layer = new ProceduralLayer(b.scene);
  const tilt = Quaternion.RotationAxis(Vector3.Right(), 0.1);
  const off = layer.set(bone, (base, out) => base.multiplyToRef(tilt, out));
  frames(b.scene, 3);
  nearQ(bone.rotationQuaternion!, q0.multiply(tilt));
  // the clip stops: the bone keeps its pose, the layer does not stack its offset on it
  anim.stop();
  frames(b.scene, 5);
  nearQ(bone.rotationQuaternion!, q0.multiply(tilt));
  off();
  nearQ(bone.rotationQuaternion!, q0, 1e-6, "the disposer gives the animated rotation back");
  assert.equal(layer.size, 0);
  // a joint pose bound to a body that lacks the joints does nothing
  const jp = new JointPose(layer, new Map([["nope", tilt]]), () => undefined);
  assert.equal(jp.bound, 0);
  jp.dispose();
  layer.dispose();
  b.dispose();
});
