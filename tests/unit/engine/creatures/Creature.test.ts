import { test } from "node:test";
import assert from "node:assert/strict";
import { AssetContainer } from "@babylonjs/core/assetContainer";
import { Quaternion, Vector3 } from "@babylonjs/core/Maths/math.vector";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import type { AnimationGroup } from "@babylonjs/core/Animations/animationGroup";
import { Creature } from "../../../../src/engine/creatures/Creature";
import { newScene } from "../../helpers/jolt";
import { frames, slideGroup } from "../../helpers/anim";

const near = (a: number, b: number, eps = 1e-5, msg = "") => assert.ok(Math.abs(a - b) < eps, `${msg} ${a} != ${b}`);

/** A wolf-like rig: root -> spine -> head; `idle_01` slides the spine 0..1 over 8 s, `run` 1 s. */
function wolfRig(scene: import("@babylonjs/core/scene").Scene) {
  const top = new TransformNode("__root__", scene);
  const spine = new TransformNode("Bip01_Spine", scene);
  spine.parent = top;
  spine.rotationQuaternion = Quaternion.Identity();
  const head = new TransformNode("Bip01_Head", scene);
  head.parent = spine;
  const groups: AnimationGroup[] = [slideGroup(scene, "idle_01", spine, 480, 0, 8), slideGroup(scene, "run", spine, 60, 20, 21)];
  return { top, spine, head, groups };
}

const PROFILE = {
  name: "wolf",
  scale: 1.5,
  clips: { lie: { clip: "idle_01", from: 2, to: 6 }, standUp: { clip: "idle_01", from: 7, to: 8, loop: false }, run: "run" },
  bones: { spine: "Bip01_Spine", head: "Bip01_Head" },
};

test("logical clips, segments of one clip, bones by alias", () => {
  const { scene, dispose } = newScene();
  const rig = wolfRig(scene);
  const w = new Creature(scene, { rootNodes: [rig.top], animationGroups: rig.groups }, PROFILE);
  assert.deepEqual(w.clipNames.sort(), ["idle_01", "run"]);
  assert.equal(w.has("lie"), true);
  assert.equal(w.has("idle_01"), true);
  assert.equal(w.has("bite"), false);
  assert.equal(w.play("bite"), null, "a missing clip does nothing");
  assert.equal(w.bone("spine"), rig.spine);
  assert.equal(w.bone("Bip01_Head"), rig.head);
  near(w.clipLength("lie"), 4);
  near(w.clipLength("standUp"), 1);
  near(w.clipLength("run"), 1);
  // the lying loop plays only its segment (2..6 s of the clip: the spine slides from 2 to 6)
  const lie = w.play("lie", { offset: 0, blend: 0 })!;
  assert.equal(lie.from, 120);
  assert.equal(lie.to, 360);
  frames(scene, 2);
  assert.ok(rig.spine.position.x >= 2 && rig.spine.position.x < 2.1, `${rig.spine.position.x}`);
  // the stand-up segment is its own group (of the same clip): the two cross-fade
  const up = w.play("standUp", { blend: 0.3 })!;
  assert.notEqual(up, lie);
  assert.equal(up.loopAnimation, false);
  assert.equal(w.anim.current, up);
  // an ad-hoc segment works too, and asking again reuses its group
  const seg = w.play("idle_01", { from: 1, to: 2, blend: 0 })!;
  assert.equal(w.play("idle_01", { from: 1, to: 2 }), seg);
  // the root scales and the model hangs below it
  assert.equal(rig.top.parent!.parent!.parent, w.root);
  near((rig.top.parent!.parent as TransformNode).scaling.x, 1.5);
  w.dispose();
  assert.equal(rig.spine.isDisposed(), true);
  assert.equal(lie.targetedAnimations.length, 0, "segment groups are disposed");
  dispose();
});

test("facing uses the game's forward yaw; a one-shot segment reports its end", async () => {
  const { scene, dispose } = newScene();
  const rig = wolfRig(scene);
  const w = new Creature(scene, { rootNodes: [rig.top], animationGroups: rig.groups }, PROFILE);
  w.setYaw(Math.PI / 2);
  w.root.computeWorldMatrix(true);
  // the model faces +Z locally; yaw pi/2 faces -X
  const fwd = Vector3.TransformNormal(new Vector3(0, 0, 1), w.root.getWorldMatrix());
  near(fwd.x, -1);
  near(fwd.z, 0);
  w.root.position.set(0, 0, 0);
  w.faceTo({ x: 0, z: 5 });
  // facing +Z: yaw pi (or -pi)
  near(Math.cos(w.yaw), -1);
  const up = w.play("standUp", { blend: 0 });
  const end = w.ended(up);
  frames(scene, 70);
  assert.equal(await end, true);
  assert.equal(await w.ended(null), false);
  w.dispose();
  w.dispose();
  dispose();
});

test("fromContainer makes independent instances of an asset", () => {
  const { scene, dispose } = newScene();
  const rig = wolfRig(scene);
  const c = new AssetContainer(scene);
  for (const n of [rig.top, rig.spine, rig.head]) {
    scene.removeTransformNode(n);
    c.transformNodes.push(n);
  }
  for (const g of rig.groups) {
    scene.removeAnimationGroup(g);
    c.animationGroups.push(g);
  }
  const a = Creature.fromContainer(scene, c, { ...PROFILE, name: "wolf_a" });
  const b = Creature.fromContainer(scene, c, { ...PROFILE, name: "wolf_b", forward: "-z" });
  assert.notEqual(a.bone("spine"), b.bone("spine"));
  assert.notEqual(a.bone("spine"), rig.spine);
  a.play("run", { blend: 0, offset: 0 });
  b.play("lie", { blend: 0, offset: 0 });
  frames(scene, 2);
  assert.ok(a.bone("spine")!.position.x >= 20, "each instance animates its own joints");
  assert.ok(b.bone("spine")!.position.x < 3);
  assert.equal(rig.spine.position.x, 0, "the container's nodes are untouched");
  a.dispose();
  assert.equal(b.bone("spine")!.isDisposed(), false);
  b.dispose();
  c.dispose();
  dispose();
});
