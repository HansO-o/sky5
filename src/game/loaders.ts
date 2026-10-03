import "@babylonjs/loaders/glTF/2.0/glTFLoader";
import { registerBuiltInGLTFExtensions } from "@babylonjs/loaders/glTF/2.0/Extensions/dynamic";
import { LoadAssetContainerAsync } from "@babylonjs/core/Loading/sceneLoader";
import type { AssetContainer } from "@babylonjs/core/assetContainer";
import { Texture } from "@babylonjs/core/Materials/Textures/texture";
import type { Scene } from "@babylonjs/core/scene";
import type { Node } from "@babylonjs/core/node";
import { assets } from "../core/assets/AssetClient";

registerBuiltInGLTFExtensions();

/** Load a GLB asset (cache-first) into an AssetContainer; nothing is added to the scene yet. */
export async function loadGLB(id: string, scene: Scene): Promise<AssetContainer> {
  const buf = await assets.get(id);
  return LoadAssetContainerAsync(new Uint8Array(buf), scene, {
    pluginExtension: ".glb",
    name: id,
    pluginOptions: {
      gltf: {
        // our build bakes everything needed; skip work we don't use
        animationStartMode: 0, // NONE
        compileMaterials: false,
        createInstances: true,
      },
    },
  });
}

/** Load a standalone KTX2 texture asset. Transcoding happens in the KTX2 worker pool. */
export async function loadKTX2(id: string, scene: Scene, opts: { wrap?: boolean; noMipmap?: boolean } = {}): Promise<Texture> {
  const buf = await assets.get(id);
  return new Promise<Texture>((resolve, reject) => {
    const t: Texture = new Texture(id, scene, {
      buffer: new Uint8Array(buf),
      forcedExtension: ".ktx2",
      noMipmap: opts.noMipmap ?? false,
      invertY: false,
      onLoad: () => resolve(t),
      onError: (m) => reject(new Error(`texture ${id}: ${m}`)),
    });
    t.name = id;
    if (opts.wrap === false) {
      t.wrapU = Texture.CLAMP_ADDRESSMODE;
      t.wrapV = Texture.CLAMP_ADDRESSMODE;
    }
    t.anisotropicFilteringLevel = 8;
  });
}

export async function loadJSON<T>(id: string): Promise<T> {
  const buf = await assets.get(id);
  return JSON.parse(new TextDecoder().decode(buf)) as T;
}

/** Blob URL for loaders that insist on a URL (e.g. HDRCubeTexture). Caller revokes it. */
export async function blobURL(id: string, type = "application/octet-stream") {
  const buf = await assets.get(id);
  return URL.createObjectURL(new Blob([buf], { type }));
}

/**
 * Instantiate only part of a container: nodes for which `isPart` is true are kept or dropped by
 * `keep`; non-part nodes (armatures, bones, the glTF root) are always kept.
 */
export function instantiateSubset(container: AssetContainer, keep: (name: string) => boolean, isPart: (name: string) => boolean, nameFn = (n: string) => n) {
  const drop = new Set<Node>();
  const all: Node[] = [...container.transformNodes, ...container.meshes];
  for (const n of all) {
    // multi-primitive glTF meshes become "<node>_primitiveN" children; judge them by their node
    const name = n.name.replace(/_primitive\d+$/, "");
    if (isPart(name) && !keep(name)) {
      drop.add(n);
      for (const d of n.getDescendants(false)) drop.add(d);
    }
  }
  return container.instantiateModelsToScene(nameFn, false, {
    doNotInstantiate: true,
    predicate: (e: unknown) => !drop.has(e as Node),
  });
}

/** Resolve on the next rendered frame (spreads heavy setup work across frames). */
export function nextFrame() {
  return new Promise<void>((r) => requestAnimationFrame(() => r()));
}
