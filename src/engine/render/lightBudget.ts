import type { Material } from "@babylonjs/core/Materials/material";
import type { Scene } from "@babylonjs/core/scene";
import type { Disposer } from "../core/types";

/**
 * Lights every scene has from boot: sun + sky fill + the 3 light-pool slots. Lit materials are
 * compiled for this many lights from the start, so the shader of a material never depends on how
 * many fires happen to burn (Babylon's default is 4, which would drop the last pool light).
 */
export const SCENE_LIGHTS = 5;

type Lit = Material & { maxSimultaneousLights: number; subMaterials?: (Material | null)[] };

/**
 * Raise `maxSimultaneousLights` to `n` on these materials (and a multi-material's sub-materials).
 * Call before a material's first compile: raising it later recompiles it.
 */
export function applyLightBudget(materials: Iterable<Material | null | undefined>, n = SCENE_LIGHTS) {
  for (const m of materials) {
    if (!m) continue;
    const lit = m as Lit;
    if (lit.subMaterials) applyLightBudget(lit.subMaterials, n);
    if ("maxSimultaneousLights" in m && typeof lit.maxSimultaneousLights === "number" && lit.maxSimultaneousLights < n) lit.maxSimultaneousLights = n;
  }
}

/**
 * Apply the budget to a scene's default material and its materials now, and to each material added
 * later. Babylon announces a new material a tick after creating it, so this is a safety net: code that
 * creates a material and draws it in the same frame sets the budget itself ({@link applyLightBudget}),
 * as `loadGLB` does for everything it loads.
 */
export function enforceLightBudget(scene: Scene, n = SCENE_LIGHTS): Disposer {
  applyLightBudget([scene.defaultMaterial, ...scene.materials], n);
  const ob = scene.onNewMaterialAddedObservable.add((m) => applyLightBudget([m], n));
  return () => scene.onNewMaterialAddedObservable.remove(ob);
}
