import type { AssetContainer } from "@babylonjs/core/assetContainer";
import { assets } from "../core/assets/AssetClient";
import { loadGLB } from "../game/loaders";
import { Creature, type CreatureProfile } from "../engine/creatures/Creature";
import { precompile } from "../engine/render/precompile";
import type { World } from "./World";

const loaded = new WeakMap<World, Map<string, Promise<AssetContainer>>>();

/** One loaded container per world and asset (every creature of a kind instantiates from it). A failed load is retried. */
function creatureAsset(world: World, id: string) {
  let m = loaded.get(world);
  if (!m) {
    const made = (m = new Map<string, Promise<AssetContainer>>());
    loaded.set(world, made);
    world.scene.onDisposeObservable.addOnce(() => {
      for (const p of made.values()) void p.then((c) => c.dispose()).catch(() => {});
      made.clear();
    });
  }
  let p = m.get(id);
  if (!p) {
    p = loadGLB(id, world.scene);
    m.set(id, p);
    p.catch(() => m.delete(id));
  }
  return p;
}

/**
 * A new creature (spider, wolf) from a manifest asset, casting shadows; its shaders are compiled
 * while it is hidden, so it shows without a hitch. Null (with a warning) when the build lacks the
 * asset or it fails to load: the chapter goes on without it. `cloneMaterials`: own materials (a
 * tinted spider).
 */
export async function loadCreature(world: World, id: string, profile: CreatureProfile, o: { cloneMaterials?: boolean; compile?: boolean } = {}): Promise<Creature | null> {
  if (!assets.has(id)) {
    console.warn(`creature: ${id} is not in this build`);
    return null;
  }
  let c: AssetContainer;
  try {
    c = await creatureAsset(world, id);
  } catch (e) {
    console.warn(`creature: ${id} failed to load`, e);
    return null;
  }
  if (world.disposed) return null;
  const cr = Creature.fromContainer(world.scene, c, profile, { cloneMaterials: o.cloneMaterials });
  world.addShadowCasters(cr.meshes);
  if (o.compile !== false) {
    cr.setEnabled(false);
    await precompile(cr.meshes, { shadows: world.env.shadows });
    if (world.disposed) {
      cr.dispose();
      return null;
    }
    cr.setEnabled(true);
  }
  return cr;
}
