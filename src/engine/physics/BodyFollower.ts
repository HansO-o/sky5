import { Matrix, Quaternion, Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import type { BodyId, Physics } from "./Physics";

/**
 * The rigid motion that takes a node from its rest world matrix to its current one (Babylon's
 * row-vector convention: worldNow = worldRest · delta). A body built from the node's world-space
 * geometry at rest, posed with this rotation and translation, sits where the node now is.
 */
export function rigidDelta(rest: Matrix, now: Matrix, outPos = new Vector3(), outRot = new Quaternion()) {
  const d = rest.clone().invert().multiply(now);
  d.decompose(undefined, outRot, outPos);
  return { position: outPos, rotation: outRot };
}

/**
 * Keeps a static collider built from a node's world-space geometry (a door leaf, a drawbridge
 * deck) on that node while scripts move it: swing the hinge, then `sync()`.
 */
export class BodyFollower {
  private rest: Matrix;
  private pos = new Vector3();
  private rot = new Quaternion();

  /** `node`'s current world matrix is the pose the body's geometry was built in. */
  constructor(
    private ph: Physics,
    readonly body: BodyId,
    readonly node: TransformNode,
  ) {
    this.rest = node.computeWorldMatrix(true).clone();
  }

  /** Move the body to where the node is now. */
  sync() {
    if (!this.ph.has(this.body)) return;
    rigidDelta(this.rest, this.node.computeWorldMatrix(true), this.pos, this.rot);
    this.ph.setBodyTransform(this.body, this.pos, this.rot);
  }

  /** Back to the rest pose (the node too is expected back there). */
  reset() {
    if (this.ph.has(this.body)) this.ph.setBodyTransform(this.body, Vector3.ZeroReadOnly, Quaternion.Identity());
  }
}
