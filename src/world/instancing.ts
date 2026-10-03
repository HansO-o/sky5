import { Matrix, Quaternion, Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import type { ShadowGenerator } from "@babylonjs/core/Lights/Shadows/shadowGenerator";
import "@babylonjs/core/Meshes/thinInstanceMesh";
import { precompile } from "../engine/render/precompile";

export interface LodLevel {
  /** All primitive meshes that make up this LOD (they share the instance matrices). */
  meshes: Mesh[];
  /** Instances closer than this use this level. */
  maxDistance: number;
  /** Extra scale applied to the instance matrix (e.g. impostor height). */
  scale?: number;
}

/**
 * Thin-instanced scatter with distance LODs. Instance matrices are precomputed once; when the
 * camera has moved far enough, instances are re-bucketed into LOD buffers (cheap memcpy + one
 * upload per LOD). Instances that arrive while close to the camera stay hidden until the camera has
 * moved away, so late-streamed scenery never pops in right in front of the player.
 */
export class InstancedSet {
  private mats: Float32Array;
  private px: Float32Array;
  private pz: Float32Array;
  private revealed: Uint8Array;
  private buffers: Float32Array[];
  private lastCam = new Vector3(1e9, 0, 1e9);
  readonly count: number;
  revealDistance = 0;
  rebuildDistance = 6;
  private enabled = true;
  /** a precompile holds the instance counts: no re-bucketing meanwhile */
  private compiling = 0;

  constructor(
    data: Float32Array, // [x, y, z, yaw, scale] * n
    readonly lods: LodLevel[],
    opts: { yOffset?: number; baseScale?: number; revealDistance?: number; tilt?: number } = {},
  ) {
    this.count = data.length / 5;
    this.mats = new Float32Array(this.count * 16);
    this.px = new Float32Array(this.count);
    this.pz = new Float32Array(this.count);
    this.revealDistance = opts.revealDistance ?? 0;
    this.revealed = new Uint8Array(this.count).fill(this.revealDistance > 0 ? 0 : 1);
    const m = new Matrix();
    const q = new Quaternion();
    const s = new Vector3();
    const t = new Vector3();
    const base = opts.baseScale ?? 1;
    let seed = 1;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;
    for (let i = 0; i < this.count; i++) {
      const [x, y, z, yaw, sc] = data.subarray(i * 5, i * 5 + 5);
      const tilt = opts.tilt ?? 0;
      Quaternion.RotationYawPitchRollToRef(yaw, rnd() * tilt, rnd() * tilt, q);
      s.setAll(sc * base);
      t.set(x, y + (opts.yOffset ?? 0), z);
      Matrix.ComposeToRef(s, q, t, m);
      m.copyToArray(this.mats, i * 16);
      this.px[i] = x;
      this.pz[i] = z;
    }
    this.buffers = lods.map(() => new Float32Array(Math.max(1, this.count) * 16));
    lods.forEach((l, k) => {
      for (const mesh of l.meshes) {
        // one GPU buffer per mesh, sized for every instance; updates only re-upload contents
        mesh.thinInstanceSetBuffer("matrix", this.buffers[k], 16, false);
        mesh.thinInstanceCount = 0;
        mesh.alwaysSelectAsActiveMesh = true; // bounding box of thin instances spans the map
        mesh.doNotSyncBoundingInfo = true;
      }
    });
  }

  /** Show or hide every LOD (e.g. with the outdoor world); hidden sets skip their updates. */
  setEnabled(on: boolean) {
    if (on === this.enabled) return;
    this.enabled = on;
    for (const l of this.lods) for (const m of l.meshes) m.setEnabled(on);
    // re-bucket at the next update: the camera has moved meanwhile
    if (on) this.lastCam.set(1e9, 0, 1e9);
  }

  get isEnabled() {
    return this.enabled;
  }

  /**
   * Compile every LOD's shaders for thin-instanced drawing (and its shadow pass), including LODs that
   * have no instances yet: a mesh compiled without instances compiles again the first time it gets
   * one. Call before the set is first shown.
   */
  async precompile(shadows?: ShadowGenerator | null) {
    const meshes = this.lods.flatMap((l) => l.meshes);
    const bumped: Mesh[] = [];
    this.compiling++;
    // a LOD without instances gets one while compiling: a zeroed matrix (degenerate, nothing shows)
    this.lods.forEach((l, k) => {
      const empty = l.meshes.filter((m) => !m.isDisposed() && m.thinInstanceCount === 0);
      if (!empty.length) return;
      this.buffers[k].fill(0, 0, 16);
      for (const m of empty) {
        m.thinInstanceCount = 1;
        m.thinInstanceBufferUpdated("matrix");
        bumped.push(m);
      }
    });
    try {
      await precompile(meshes, { shadows });
    } finally {
      this.compiling--;
      for (const m of bumped) if (!m.isDisposed()) m.thinInstanceCount = 0;
      this.lastCam.set(1e9, 0, 1e9);
    }
  }

  /** Re-bucket instances if the camera moved; returns true when buffers were rebuilt. */
  update(cam: Vector3, force = false) {
    if (!this.enabled || this.compiling) return false;
    if (!force && Vector3.DistanceSquared(cam, this.lastCam) < this.rebuildDistance ** 2) return false;
    this.lastCam.copyFrom(cam);
    const counts = this.lods.map(() => 0);
    const maxD = this.lods.map((l) => l.maxDistance * l.maxDistance);
    const reveal2 = this.revealDistance * this.revealDistance;
    const tmp = new Matrix();
    for (let i = 0; i < this.count; i++) {
      const dx = this.px[i] - cam.x, dz = this.pz[i] - cam.z;
      const d2 = dx * dx + dz * dz;
      if (!this.revealed[i]) {
        if (d2 > reveal2) this.revealed[i] = 1;
        else continue;
      }
      for (let l = 0; l < this.lods.length; l++) {
        if (d2 <= maxD[l]) {
          const buf = this.buffers[l];
          const sc = this.lods[l].scale;
          if (sc) {
            Matrix.FromArrayToRef(this.mats, i * 16, tmp);
            Matrix.ScalingToRef(sc, sc, sc, SCALE);
            SCALE.multiplyToRef(tmp, tmp);
            tmp.copyToArray(buf, counts[l] * 16);
          } else {
            buf.set(this.mats.subarray(i * 16, i * 16 + 16), counts[l] * 16);
          }
          counts[l]++;
          break;
        }
      }
    }
    this.lods.forEach((l, k) => {
      for (const mesh of l.meshes) {
        mesh.thinInstanceCount = counts[k];
        mesh.thinInstanceBufferUpdated("matrix");
        mesh.isVisible = counts[k] > 0;
      }
    });
    return true;
  }

  dispose() {
    for (const l of this.lods) for (const m of l.meshes) m.thinInstanceSetBuffer("matrix", null);
  }
}
const SCALE = new Matrix();

/**
 * Prepare a loaded glTF primitive mesh for thin instancing: detach from its glTF parents and bake
 * the full world transform (incl. quantisation scale/offset) into the vertices. `origin` (world XZ)
 * becomes the instance origin; kit pieces sit side by side in their source file.
 */
export function prepareForInstancing(mesh: AbstractMesh, origin?: Vector3) {
  const m = mesh as Mesh;
  m.computeWorldMatrix(true);
  const world = m.getWorldMatrix().clone();
  if (origin) world.addTranslationFromFloats(-origin.x, 0, -origin.z);
  m.setParent(null);
  m.rotationQuaternion = null;
  m.position.setAll(0);
  m.rotation.setAll(0);
  m.scaling.setAll(1);
  m.bakeTransformIntoVertices(world);
  m.computeWorldMatrix(true);
  m.freezeWorldMatrix();
  return m;
}
