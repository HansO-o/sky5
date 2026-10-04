import { Quaternion } from "@babylonjs/core/Maths/math.vector";
import type { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import type { Observer } from "@babylonjs/core/Misc/observable";
import type { Scene } from "@babylonjs/core/scene";
import type { Disposer } from "../core/types";

/** Writes a bone's rotation for this frame from its animated rotation `base` into `out`. */
export type BoneProcedure = (base: Readonly<Quaternion>, out: Quaternion) => void;

interface Entry {
  bone: TransformNode;
  fn: BoneProcedure;
  /** the rotation before this frame's procedure (put back before the next animation pass) */
  base: Quaternion;
  applied: boolean;
}

/**
 * Procedural bone rotations layered on top of the animation (a held weapon's finger grip, a
 * sleeping wolf's breathing, a stagger wobble). After the animations are evaluated, each bone's
 * procedure turns its animated rotation into the final one; before the next animation pass the
 * animated rotation is put back, so a bone no clip drives never accumulates the offsets.
 */
export class ProceduralLayer {
  private entries = new Set<Entry>();
  private obsBefore: Observer<Scene>;
  private obsAfter: Observer<Scene>;
  private disposed = false;

  constructor(readonly scene: Scene) {
    this.obsBefore = scene.onBeforeAnimationsObservable.add(() => this.restore());
    this.obsAfter = scene.onBeforeRenderObservable.add(() => this.apply());
  }

  /** Drive `bone` with `fn` from the next frame on; the disposer gives the bone back to the animation. */
  set(bone: TransformNode, fn: BoneProcedure): Disposer {
    const e: Entry = { bone, fn, base: new Quaternion(), applied: false };
    this.entries.add(e);
    return () => {
      if (!this.entries.delete(e)) return;
      if (e.applied && !bone.isDisposed()) bone.rotationQuaternion?.copyFrom(e.base);
    };
  }

  /** Bones with a procedure now. */
  get size() {
    return this.entries.size;
  }

  /** Put the animated rotations back (runs before the animations; public for tests). */
  restore() {
    for (const e of this.entries) {
      if (!e.applied) continue;
      e.applied = false;
      if (!e.bone.isDisposed()) e.bone.rotationQuaternion?.copyFrom(e.base);
    }
  }

  /** Run every procedure on this frame's animated pose (runs after the animations; public for tests). */
  apply() {
    for (const e of this.entries) {
      const b = e.bone;
      if (b.isDisposed()) {
        this.entries.delete(e);
        continue;
      }
      const q = (b.rotationQuaternion ??= Quaternion.FromEulerVector(b.rotation));
      e.base.copyFrom(q);
      e.fn(e.base, q);
      e.applied = true;
    }
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.restore();
    this.entries.clear();
    this.scene.onBeforeAnimationsObservable.remove(this.obsBefore);
    this.scene.onBeforeRenderObservable.remove(this.obsAfter);
  }
}
