import { Color3 } from "@babylonjs/core/Maths/math.color";
import { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial";
import type { Material } from "@babylonjs/core/Materials/material";
import type { Texture } from "@babylonjs/core/Materials/Textures/texture";
import type { Scene } from "@babylonjs/core/scene";
import { assets } from "../../core/assets/AssetClient";
import { loadKTX2 } from "../../game/loaders";
import type { CaveMaterialDef } from "./anchors";

/** The cave's shared textures (`cave/tex/*`, `fx/water_n`), loaded once per scene. */
const cache = new WeakMap<Scene, Map<string, Promise<Texture | null>>>();

/** A texture asset, once per scene (null when the build lacks it or it fails to load). */
export function caveTexture(scene: Scene, id: string): Promise<Texture | null> {
  let m = cache.get(scene);
  if (!m) cache.set(scene, (m = new Map()));
  let p = m.get(id);
  if (!p) {
    p = assets.has(id)
      ? loadKTX2(id, scene).catch((e) => {
          console.warn(`cave texture ${id}`, e);
          return null;
        })
      : Promise.resolve(null);
    m.set(id, p);
  }
  return p;
}

/** A material's texture binding: its glTF extras (`{textures, tile}`), else the anchors' table entry. */
function defOf(mat: Material, table: Record<string, CaveMaterialDef> | null): CaveMaterialDef | null {
  const extras = (mat.metadata as { gltf?: { extras?: CaveMaterialDef } } | null)?.gltf?.extras;
  if (extras?.textures) return extras;
  return table?.[mat.name] ?? null;
}

/**
 * Bind the cave and outcrop materials' textures (design Appendix "Materials and textures"): the
 * GLB materials are untextured, their extras name the `cave/tex/*` ids (UVs are already in texture
 * repeats). Albedo, OpenGL normal map (Y flipped in this right-handed scene) and ORM (R AO, G
 * roughness, B metal). `cave_water` gets its scrolling normal map and alpha (`water` returns the
 * per-frame scroller). Resolves once every texture is bound (missing ones are skipped).
 */
export async function bindCaveMaterials(scene: Scene, materials: readonly Material[], table: Record<string, CaveMaterialDef> | null = null) {
  const jobs: Promise<unknown>[] = [];
  const water: PBRMaterial[] = [];
  for (const mat of materials) {
    if (!(mat instanceof PBRMaterial)) continue;
    const def = defOf(mat, table);
    if (mat.name === "cave_water") {
      water.push(mat);
      setupWater(mat);
    }
    const t = def?.textures;
    if (!t) continue;
    if (t.albedo)
      jobs.push(
        caveTexture(scene, t.albedo).then((tex) => {
          if (!tex) return;
          mat.albedoTexture = tex;
          mat.albedoColor = Color3.White();
        }),
      );
    if (t.normal)
      jobs.push(
        caveTexture(scene, t.normal).then((tex) => {
          if (!tex) return;
          mat.bumpTexture = tex;
          mat.invertNormalMapX = false;
          mat.invertNormalMapY = true;
          if (mat.name === "cave_water") tex.level = 0.55;
        }),
      );
    if (t.orm)
      jobs.push(
        caveTexture(scene, t.orm).then((tex) => {
          if (!tex) return;
          mat.metallicTexture = tex;
          mat.useAmbientOcclusionFromMetallicTextureRed = true;
          mat.useRoughnessFromMetallicTextureGreen = true;
          mat.useMetallnessFromMetallicTextureBlue = true;
          mat.metallic = 1;
          mat.roughness = 1;
        }),
      );
  }
  await Promise.all(jobs);
  return {
    /** scroll the water's normal map (call every frame with game time) */
    update(dt: number) {
      for (const w of water) {
        const tex = w.bumpTexture as Texture | null;
        if (tex) tex.uOffset = (tex.uOffset + dt * 0.3) % 1000;
      }
    },
  };
}

/** The stream: dark, glossy, 0.75 alpha (its normal map scrolls along the flow). */
function setupWater(mat: PBRMaterial) {
  mat.albedoColor = new Color3(0.03, 0.06, 0.065);
  mat.metallic = 0;
  mat.roughness = 0.12;
  mat.alpha = 0.75;
  mat.transparencyMode = PBRMaterial.PBRMATERIAL_ALPHABLEND;
  mat.backFaceCulling = true;
}
