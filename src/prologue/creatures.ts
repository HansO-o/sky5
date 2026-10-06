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

// ------------------------------------------------------------------------------------------------
// Rigs (design §10.3): asset ids and clip names as the creature pipeline writes them

/**
 * The cave spider (Quaternius Easy Enemy Pack, design §10.3): clips Spider_Idle (4.17 s),
 * Spider_Walk (0.83), Spider_Attack (0.75, hit 0.40), Spider_Death (1.04), Spider_Jump (0.71, hit
 * 0.52). One asset for both sizes: small spiders are brown at scale 0.55, the giant black at 1.
 */
export const SPIDER = {
  asset: "creatures/spider",
  clips: { idle: "Spider_Idle", walk: "Spider_Walk", death: "Spider_Death" },
  /** the walk clip's ground speed at rate 1 (§6.3: speedRatio = v / 2.6) */
  walkSpeed: 2.6,
  /** the capsule it walks with, by scale 1 (m) */
  capsule: { radius: 0.8, height: 1.7 },
} as const;

/** A spider's profile at `scale` (its clips keep their asset names). */
export function spiderProfile(name: string, scale: number): CreatureProfile {
  return { name, scale };
}
