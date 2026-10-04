import { Matrix, Quaternion, Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import type { Disposer } from "../core/types";

export type Vec3T = readonly [number, number, number];
export type QuatT = readonly [number, number, number, number];

/**
 * How an item hangs on a skeleton joint: its origin and rotation in the joint's frame (unscaled:
 * see `BoneSocket`) and its own scale.
 */
export interface AttachRecipe {
  /** the joint the item follows */
  bone: string;
  /** item origin in the joint's frame (m) */
  position?: Vec3T;
  /** item rotation in the joint's frame: a quaternion [x, y, z, w], or Euler angles [x, y, z] (rad) */
  rotation?: QuatT | Vec3T;
  /** uniform or per-axis scale (default 1) */
  scale?: number | Vec3T;
}

/** A rigid pose as tuples (what recipes are written in). */
export interface PoseT {
  position: Vec3T;
  rotation: QuatT;
}

/** A recipe's rotation as a quaternion (normalised). */
export function recipeRotation(r: Pick<AttachRecipe, "rotation">, out = new Quaternion()): Quaternion {
  const q = r.rotation;
  if (!q) return out.copyFromFloats(0, 0, 0, 1);
  if (q.length === 4) out.copyFromFloats(q[0], q[1], q[2], q[3]);
  else Quaternion.FromEulerAnglesToRef(q[0], q[1], q[2], out);
  return out.normalize();
}

export function recipePosition(r: Pick<AttachRecipe, "position">, out = new Vector3()): Vector3 {
  const p = r.position;
  return p ? out.set(p[0], p[1], p[2]) : out.setAll(0);
}

/** Put `node` at the recipe's pose in its parent's frame (position, rotation and scale). */
export function applyRecipe(node: TransformNode, r: AttachRecipe) {
  recipePosition(r, node.position);
  node.rotationQuaternion ??= new Quaternion();
  recipeRotation(r, node.rotationQuaternion);
  const s = r.scale ?? 1;
  if (typeof s === "number") node.scaling.setAll(s);
  else node.scaling.set(s[0], s[1], s[2]);
}

/**
 * Hang `item` on `socket` (a `BoneSocket` node, or any node) with the recipe's pose. The disposer
 * takes it off again (keeping its world transform), unless it was moved elsewhere meanwhile.
 */
export function attachToSocket(item: TransformNode, socket: TransformNode, r: AttachRecipe): Disposer {
  item.parent = socket;
  applyRecipe(item, r);
  return () => {
    if (item.isDisposed() || item.parent !== socket) return;
    item.setParent(null);
  };
}

const mA = new Matrix(), mB = new Matrix(), mC = new Matrix();
const one = Vector3.One();

/**
 * The pose of `child` (given in `parent`'s frame) in the frame `parent` itself is given in: a
 * chain of two attachments as one. E.g. a weapon in the hand, with the hand placed relative to the
 * spine, gives the weapon relative to the spine.
 */
export function composePose(parent: PoseT, child: PoseT): PoseT {
  Matrix.ComposeToRef(one, new Quaternion(...parent.rotation), new Vector3(...parent.position), mA);
  Matrix.ComposeToRef(one, new Quaternion(...child.rotation), new Vector3(...child.position), mB);
  // row vectors: child local, then parent
  mB.multiplyToRef(mA, mC);
  const s = new Vector3(), q = new Quaternion(), p = new Vector3();
  mC.decompose(s, q, p);
  q.normalize();
  return { position: [p.x, p.y, p.z], rotation: [q.x, q.y, q.z, q.w] };
}

/**
 * The origin of a frame rotated by `rotation` whose local point `local` sits at `point`: e.g. the
 * hand's origin relative to the spine from where its grip centre was measured.
 */
export function frameOrigin(rotation: QuatT, point: Vec3T, local: Vec3T): Vec3T {
  const r = new Vector3();
  new Vector3(...local).rotateByQuaternionToRef(new Quaternion(...rotation), r);
  return [point[0] - r.x, point[1] - r.y, point[2] - r.z];
}

/**
 * A recipe for an item on another joint than the one it is held by, from where the holding joint
 * is relative to that one: `held` is the item's recipe in the hand; the hand stands at `hand` in
 * `bone`'s frame.
 */
export function relativeRecipe(bone: string, hand: PoseT, held: AttachRecipe): AttachRecipe {
  const q = recipeRotation(held);
  const p = recipePosition(held);
  const pose = composePose(hand, { position: [p.x, p.y, p.z], rotation: [q.x, q.y, q.z, q.w] });
  return { bone, position: pose.position, rotation: pose.rotation, scale: held.scale };
}
