import { test } from "node:test";
import assert from "node:assert/strict";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import type { AnimationGroup } from "@babylonjs/core/Animations/animationGroup";
import { AnimController } from "../../../../src/engine/anim/AnimController";
import { newScene } from "../../helpers/jolt";
import { frames, slideGroup } from "../../helpers/anim";

const near = (a: number, b: number, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);

function setup() {
  const s = newScene();
  const node = new TransformNode("n", s.scene);
  const groups = new Map<string, AnimationGroup>([
    ["A", slideGroup(s.scene, "A", node, 60, 0, 1)],
    ["B", slideGroup(s.scene, "B", node, 60, 10, 11)],
    ["Shot", slideGroup(s.scene, "Shot", node, 12, 5, 6)],
  ]);
  let dt = 0;
  const anim = new AnimController(s.scene, (k) => groups.get(k), { dt: () => dt, random: () => 0.5 });
  const fade = (seconds: number) => {
    dt = seconds;
    s.scene.onBeforeAnimationsObservable.notifyObservers(s.scene);
    dt = 0;
  };
  return { ...s, node, groups, anim, fade };
}

test("cross-fade by weights; the faded-out clip stops at the end of the blend", () => {
  const { anim, groups, fade, dispose } = setup();
  const a = anim.play("A", { blend: 0.5 });
  assert.equal(a.weight, 1);
  assert.equal(anim.current, a);
  const b = anim.play("B", { blend: 0.5 });
  assert.equal(anim.current, b);
  near(b.weight, 0);
  fade(0.25);
  near(b.weight, 0.5);
  near(a.weight, 0.5);
  fade(0.25);
  near(b.weight, 1);
  assert.equal(groups.get("A")!.isStarted, false);
  assert.equal(a.weight, 1, "a stopped clip is reset to full weight for its next use");
  dispose();
});

test("loops start at a random phase, one-shots at the start; the same clip again only changes the rate", () => {
  const { anim, dispose } = setup();
  const a = anim.play("A");
  // the injected random phase (0.5) of a 60-frame clip
  near(a.animatables[0].masterFrame, 30);
  const again = anim.play("A", { speed: 2 });
  assert.equal(again, a);
  assert.equal(a.speedRatio, 2);
  const shot = anim.play("Shot", { loop: false, blend: 0 });
  near(shot.animatables[0].masterFrame, 0);
  assert.equal(a.isStarted, false, "blend 0 cuts");
  dispose();
});

test("X -> Y -> X within a blend picks X up where its weight is", () => {
  const { anim, fade, dispose } = setup();
  const a = anim.play("A", { blend: 0.4 });
  const b = anim.play("B", { blend: 0.4 });
  fade(0.1);
  near(a.weight, 0.75);
  const a2 = anim.play("A", { blend: 0.4 });
  assert.equal(a2, a);
  near(a.weight, 0.75, 1e-9);
  fade(0.2);
  // from 0.75 halfway to 1; B from 0.25 halfway to 0
  near(a.weight, 0.875);
  near(b.weight, 0.125);
  fade(0.2);
  near(a.weight, 1);
  assert.equal(b.isStarted, false);
  dispose();
});

test("ended(): true when a one-shot runs out, false when replaced; unknown clips throw or report missing", async () => {
  const { scene, anim, dispose } = setup();
  const shot = anim.play("Shot", { loop: false, blend: 0 });
  const done = anim.ended(shot);
  frames(scene, 20);
  assert.equal(await done, true);
  const again = anim.play("Shot", { loop: false, blend: 0 });
  assert.equal(again.isStarted, true, "a finished one-shot starts over");
  const cut = anim.ended(again);
  const loop = anim.play("A", { blend: 0 });
  assert.equal(await cut, false);
  // a loop never ends by itself: only replacing it settles its waiters
  const looped = anim.ended(loop);
  frames(scene, 80);
  anim.play("B", { blend: 0 });
  assert.equal(await looped, false);
  assert.throws(() => anim.play("Nope"), /missing clip Nope/);
  assert.equal(anim.has("Nope"), false);
  assert.equal(anim.length("Nope"), 0);
  near(anim.length("A"), 1);
  dispose();
});

test("stopAll stops the clip and the fade; dispose settles waiters", async () => {
  const { anim, dispose } = setup();
  anim.play("A");
  const b = anim.play("B", { loop: false, blend: 0.5 });
  const w = anim.ended(b);
  anim.stopAll();
  assert.equal(anim.current, null);
  assert.equal(b.isStarted, false);
  assert.equal(await w, false);
  anim.dispose();
  dispose();
});

test("a clip whose range starts later (a segment) starts at the asked phase", () => {
  for (const at of [0, 0.25, 0.5]) {
    const s = newScene();
    const node = new TransformNode("n", s.scene);
    const seg = slideGroup(s.scene, "idle", node, 480, 0, 8).clone("seg", (t) => t);
    seg.normalize(120, 360);
    const anim = new AnimController(s.scene, () => seg);
    anim.play("seg", { offset: at, blend: 0 });
    frames(s.scene, 1);
    // 2..6 over the segment
    near(node.position.x, 2 + 4 * at, 0.02);
    s.dispose();
  }
});
