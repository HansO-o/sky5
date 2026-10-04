import type { AnimationGroup } from "@babylonjs/core/Animations/animationGroup";
import { Quaternion } from "@babylonjs/core/Maths/math.vector";
import type { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import type { Disposer } from "../core/types";
import type { ProceduralLayer } from "../anim/ProceduralLayer";

/**
 * The local rotations a clip gives `names` at `frame` (default its first frame): e.g. a sword
 * grip's closed fingers from an armed idle. Joints the clip does not rotate are left out.
 */
export function poseFromGroup(group: AnimationGroup, names: readonly string[], frame?: number): Map<string, Quaternion> {
  const want = new Set(names);
  const out = new Map<string, Quaternion>();
  const f = frame ?? group.from;
  for (const ta of group.targetedAnimations) {
    const name = (ta.target as { name?: string } | null)?.name;
    if (!name || !want.has(name) || ta.animation.targetProperty !== "rotationQuaternion") continue;
    const v = ta.animation.evaluate(f) as Quaternion | undefined;
    if (v && typeof v.w === "number") out.set(name, new Quaternion(v.x, v.y, v.z, v.w).normalize());
  }
  return out;
}

/**
 * Holds a set of joints in a fixed local pose on top of the animation, with a weight that fades in
 * and out (a hand closing on a weapon handle while the body plays clips made for an empty hand).
 */
export class JointPose {
  /** current blend toward the pose (0 = animation only) */
  weight = 0;
  /** where `weight` is heading */
  target = 0;
  private offs: Disposer[] = [];

  constructor(
    private layer: ProceduralLayer,
    private pose: ReadonlyMap<string, Quaternion>,
    /** finds a joint on the current body (called again by {@link bind}) */
    private find: (name: string) => TransformNode | undefined,
    /** seconds for a full fade in or out */
    private fade = 0.1,
  ) {
    this.bind();
  }

  /** Find the joints again (the body was rebuilt). */
  bind() {
    this.unbind();
    for (const [name, q] of this.pose) {
      const bone = this.find(name);
      if (!bone) continue;
      this.offs.push(
        this.layer.set(bone, (base, out) => {
          if (this.weight <= 0) return;
          if (this.weight >= 1) out.copyFrom(q);
          else Quaternion.SlerpToRef(base, q, this.weight, out);
        }),
      );
    }
  }

  /** Joints found on the body. */
  get bound() {
    return this.offs.length;
  }

  set active(on: boolean) {
    this.target = on ? 1 : 0;
  }

  get active() {
    return this.target > 0;
  }

  /** Jump to the target weight (no fade). */
  snap() {
    this.weight = this.target;
  }

  /** Advance the fade by `dt` seconds. */
  update(dt: number) {
    if (this.weight === this.target) return;
    const step = this.fade > 0 ? dt / this.fade : 1;
    this.weight = this.weight < this.target ? Math.min(this.target, this.weight + step) : Math.max(this.target, this.weight - step);
  }

  private unbind() {
    for (const off of this.offs) off();
    this.offs = [];
  }

  dispose() {
    this.unbind();
  }
}
