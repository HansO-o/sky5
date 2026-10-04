// Animation groups and a frame clock for headless animation tests.
import "@babylonjs/core/Animations/animatable";
import { Animation } from "@babylonjs/core/Animations/animation";
import { AnimationGroup } from "@babylonjs/core/Animations/animationGroup";
import { Quaternion } from "@babylonjs/core/Maths/math.vector";
import type { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import type { Scene } from "@babylonjs/core/scene";

/** A group sliding `node.position.x` from `a` to `b` over `frames` frames at 60 fps. */
export function slideGroup(scene: Scene, name: string, node: TransformNode, frames: number, a = 0, b = 1) {
  const anim = new Animation(`${name}_x`, "position.x", 60, Animation.ANIMATIONTYPE_FLOAT, Animation.ANIMATIONLOOPMODE_CYCLE);
  anim.setKeys([
    { frame: 0, value: a },
    { frame: frames, value: b },
  ]);
  const g = new AnimationGroup(name, scene);
  g.addTargetedAnimation(anim, node);
  g.normalize(0, frames);
  return g;
}

/** A group turning `node.rotationQuaternion` from `q0` to `q1` over `frames` frames at 60 fps. */
export function turnGroup(scene: Scene, name: string, nodes: [TransformNode, Quaternion, Quaternion][], frames: number) {
  const g = new AnimationGroup(name, scene);
  for (const [node, q0, q1] of nodes) {
    node.rotationQuaternion ??= Quaternion.Identity();
    const anim = new Animation(`${name}_${node.name}_q`, "rotationQuaternion", 60, Animation.ANIMATIONTYPE_QUATERNION, Animation.ANIMATIONLOOPMODE_CYCLE);
    anim.setKeys([
      { frame: 0, value: q0.clone() },
      { frame: frames, value: q1.clone() },
    ]);
    g.addTargetedAnimation(anim, node);
  }
  g.normalize(0, frames);
  return g;
}

/**
 * Run `n` animation frames of 16 ms (scene.useConstantAnimationDeltaTime), with the before-
 * animation observers (cross-fades) and the before-render observers (procedural layers, sockets).
 */
export function frames(scene: Scene, n: number) {
  scene.useConstantAnimationDeltaTime = true;
  for (let i = 0; i < n; i++) {
    scene.onBeforeAnimationsObservable.notifyObservers(scene);
    scene.animate();
    scene.onBeforeRenderObservable.notifyObservers(scene);
  }
}
