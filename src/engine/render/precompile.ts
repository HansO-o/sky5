import { InstancedMesh } from "@babylonjs/core/Meshes/instancedMesh";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import type { Material } from "@babylonjs/core/Materials/material";
import type { SubMesh } from "@babylonjs/core/Meshes/subMesh";
import type { ShadowGenerator } from "@babylonjs/core/Lights/Shadows/shadowGenerator";

export interface PrecompileOptions {
  /** also compile the shadow-depth pass of the meshes that cast into this generator */
  shadows?: ShadowGenerator | null;
  /** give up waiting after this many seconds (default 8): compiling is best effort, never a hang */
  timeout?: number;
  /** meshes set going per task before yielding to the frame loop (default 12): no long stall */
  chunk?: number;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Whether a mesh draws instanced (glTF instances or thin instances), as Babylon decides it. */
export function drawsInstanced(m: AbstractMesh) {
  const src = m instanceof InstancedMesh ? m.sourceMesh : m;
  return !!m.getEngine().getCaps().instancedArrays && (src.hasThinInstances || (src instanceof Mesh && src.instances.length > 0));
}

function materialsOf(m: AbstractMesh): Material[] {
  const out = new Set<Material>();
  for (const sm of m.subMeshes ?? []) {
    const mat = sm.getMaterial();
    if (mat) out.add(mat);
  }
  if (!out.size && m.material) out.add(m.material);
  return [...out];
}

async function until(ready: () => boolean, deadline: number) {
  while (!ready()) {
    if (performance.now() > deadline) return;
    await sleep(16);
  }
}

/**
 * Compile the shaders these meshes will draw with before they are first shown, so nothing compiles
 * in the middle of play: for the instancing each one actually renders with (a mesh compiled only
 * non-instanced compiles again when it is first drawn instanced, and the other way round), plus the
 * shadow-depth pass of those in `shadows`' render list. Disabled meshes are fine (compile, then
 * enable). Effects are shared, so meshes like ones already compiled cost nothing. Never rejects.
 */
export async function precompile(meshes: Iterable<AbstractMesh>, o: PrecompileOptions = {}): Promise<void> {
  const ms = (o.timeout ?? 8) * 1000;
  const deadline = performance.now() + ms;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const giveUp = new Promise<void>((r) => (timer = setTimeout(r, ms)));
  const seen = new Set<AbstractMesh>();
  const casters = new Set(o.shadows?.getShadowMap()?.renderList ?? []);
  const jobs: Promise<unknown>[] = [];
  // one compile at a time per material (Babylon's forceCompilation saves and restores the
  // material's hot-swapping flag: overlapping calls would leave it off)
  const chains = new Map<Material, Promise<void>>();
  const compile = (mat: Material, m: AbstractMesh, useInstances: boolean) => {
    const next = (chains.get(mat) ?? Promise.resolve()).then(() => Promise.race([mat.forceCompilationAsync(m, { useInstances }).catch(() => {}), giveUp]));
    chains.set(mat, next);
  };
  const chunk = Math.max(1, o.chunk ?? 12);
  let started = 0;
  for (const m0 of meshes) {
    const m = m0 instanceof InstancedMesh ? m0.sourceMesh : m0;
    if (seen.has(m) || m.isDisposed() || !m.subMeshes?.length) continue;
    seen.add(m);
    // thin instances always draw instanced; a mesh with glTF instances draws instanced while any of
    // them is in view and on its own when only it is: both variants
    const instanced = drawsInstanced(m);
    const variants = instanced && !m.hasThinInstances ? [true, false] : [instanced];
    for (const useInstances of variants) for (const mat of materialsOf(m)) compile(mat, m, useInstances);
    const sg = o.shadows;
    if (sg && (casters.has(m) || casters.has(m0))) {
      const subs: SubMesh[] = m.subMeshes;
      jobs.push(
        until(
          () =>
            m.isDisposed() ||
            variants.every((useInstances) =>
              subs.every((sm) => {
                const mat = sm.getMaterial();
                return !mat || sg.isReady(sm, useInstances, mat.needAlphaBlendingForMesh(m));
              }),
            ),
          deadline,
        ),
      );
    }
    if (++started % chunk === 0) await sleep(0);
  }
  await Promise.all([...jobs, ...chains.values()]);
  clearTimeout(timer);
}
