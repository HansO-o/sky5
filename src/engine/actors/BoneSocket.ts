import { Matrix, Quaternion, Vector3 } from "@babylonjs/core/Maths/math.vector";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import type { Observer } from "@babylonjs/core/Misc/observable";
import type { Node } from "@babylonjs/core/node";
import type { Scene } from "@babylonjs/core/scene";

const rot = new Matrix();
const ax = new Vector3(), ay = new Vector3(), az = new Vector3();
const scratchS = new Vector3();

/**
 * The rigid part of a world matrix: its translation, and the rotation closest to its (possibly
 * scaled and sheared) axes. Axis `primary` (0 X, 1 Y, 2 Z; default Y, the bone axis of a glTF
 * skeleton) keeps its direction exactly, the next one is made perpendicular to it, the third
 * completes a right-handed frame. Scale and shear are dropped.
 */
export function rigidPose(m: Matrix, outPos: Vector3, outRot: Quaternion, primary: 0 | 1 | 2 = 1) {
  const a = m.m;
  outPos.set(a[12], a[13], a[14]);
  const axes = [ax.set(a[0], a[1], a[2]), ay.set(a[4], a[5], a[6]), az.set(a[8], a[9], a[10])];
  const i = primary, j = (primary + 1) % 3, k = (primary + 2) % 3;
  const p = axes[i], q = axes[j];
  const lp = p.length();
  if (lp < 1e-9) {
    m.decompose(scratchS, outRot);
    return { position: outPos, rotation: outRot };
  }
  p.scaleInPlace(1 / lp);
  q.subtractInPlace(p.scale(Vector3.Dot(q, p)));
  const lq = q.length();
  if (lq < 1e-9) {
    m.decompose(scratchS, outRot);
    return { position: outPos, rotation: outRot };
  }
  q.scaleInPlace(1 / lq);
  // right-handed: X = Y x Z, Y = Z x X, Z = X x Y; the third axis follows the first two
  Vector3.CrossToRef(p, q, axes[k]);
  const [x, y, z] = axes;
  Matrix.FromValuesToRef(x.x, x.y, x.z, 0, y.x, y.y, y.z, 0, z.x, z.y, z.z, 0, 0, 0, 0, 1, rot);
  Quaternion.FromRotationMatrixToRef(rot, outRot);
  outRot.normalize();
  return { position: outPos, rotation: outRot };
}

/** Bring `n`'s world matrix (and every ancestor's) up to date with their current local transforms. */
export function refreshWorldMatrix(n: Node) {
  const chain: Node[] = [];
  for (let c: Node | null = n; c; c = c.parent) chain.push(c);
  for (let i = chain.length - 1; i >= 0; i--) chain[i].computeWorldMatrix(true);
  return n.getWorldMatrix();
}

export interface BoneSocketOptions {
  name?: string;
  /** dispose the socket (and what hangs on it) with the bone, like a child of the bone would be (default true) */
  disposeWithBone?: boolean;
}

/**
 * A free node that follows a skeleton joint: every frame (after animation and after the body was
 * placed, before drawing) it copies only the joint's world position and rotation. Things attached
 * to it keep their own size and shape, which a child of the joint would not: the body's spine
 * scaling (appearance build) shears everything below it. It shows and hides with the joint.
 */
export class BoneSocket {
  readonly node: TransformNode;
  private target: TransformNode | null = null;
  private obsDispose: Observer<Node> | null = null;
  private obsFrame: Observer<Scene>;
  private disposeWithBone: boolean;
  private disposed = false;

  constructor(
    readonly scene: Scene,
    bone: TransformNode | null,
    o: BoneSocketOptions = {},
  ) {
    this.disposeWithBone = o.disposeWithBone ?? true;
    this.node = new TransformNode(o.name ?? `${bone?.name ?? "bone"}_socket`, scene);
    this.node.rotationQuaternion = Quaternion.Identity();
    this.rebind(bone);
    this.obsFrame = scene.onBeforeRenderObservable.add(() => this.update());
  }

  /** The joint followed (null when none, or it was disposed). */
  get bone() {
    return this.target && !this.target.isDisposed() ? this.target : null;
  }

  /** Follow another joint (a rebuilt body); null detaches and hides the socket. */
  rebind(bone: TransformNode | null) {
    if (this.disposed) return;
    if (this.obsDispose && this.target) this.target.onDisposeObservable.remove(this.obsDispose);
    this.obsDispose = null;
    this.target = bone;
    if (bone && this.disposeWithBone) this.obsDispose = bone.onDisposeObservable.add(() => this.dispose());
    this.update();
  }

  /** Copy the joint's pose now (also runs every frame before drawing). */
  update() {
    if (this.disposed) return;
    const b = this.bone;
    const on = !!b && b.isEnabled();
    if (this.node.isEnabled(false) !== on) this.node.setEnabled(on);
    if (!b || !on) return;
    rigidPose(refreshWorldMatrix(b), this.node.position, this.node.rotationQuaternion!);
    this.node.computeWorldMatrix(true);
  }

  /** Dispose the socket and everything attached to it. Idempotent. */
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.scene.onBeforeRenderObservable.remove(this.obsFrame);
    if (this.obsDispose && this.target) this.target.onDisposeObservable.remove(this.obsDispose);
    this.obsDispose = null;
    this.target = null;
    this.node.dispose(false, false);
  }
}
