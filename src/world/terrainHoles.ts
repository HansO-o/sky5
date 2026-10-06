import type { TerrainHole } from "../engine/physics/holes";

/**
 * Openings in the terrain where the world goes below ground (design §3.1). Mirrored in
 * tools/gen/terrainHoles.mjs: the terrain generator skips render quads whose centre lies in
 * `render`; the gameplay height field drops the samples in `samples` (see Physics.addHeightField).
 * Jolt drops every triangle touching a dropped sample, so on the ~2 m grid the collider opening
 * reaches up to one spacing past `samples`: the sample rectangles sit 2 m inside the geometry that
 * covers them.
 */
export interface TownHole extends TerrainHole {
  /** asset whose geometry covers (and floors) the opening: without it the hole stays closed */
  cover: string;
}

/** Under the keep: covered by its walls and roof, floored by the interior's slab collider (x 47.5…72.5, z −670.5…−653). */
export const KEEP_HOLE: TownHole = {
  id: "keep",
  samples: { x0: 50, x1: 70, z0: -668, z1: -656 },
  render: { x0: 47.5, x1: 72.5, z0: -670.5, z1: -653.5 },
  cover: "keep/interior",
};

/**
 * Where the cave tunnel comes up inside the balcony outcrop (footprint x −26…−9, z −684…−664). Its
 * cover is `cave/outcrop` (shown with the town from the muster on): the outcrop's skin caps the
 * hole and its mouth stub floors it, as tools/gen/terrainHoles.mjs says.
 */
export const EXIT_HOLE: TownHole = {
  id: "exit",
  samples: { x0: -22, x1: -16, z0: -680, z1: -676 },
  render: { x0: -24, x1: -14, z0: -682, z1: -674 },
  cover: "cave/outcrop",
};

export const TERRAIN_HOLES: readonly TownHole[] = [KEEP_HOLE, EXIT_HOLE];

/**
 * The holes to cut, given which assets the manifest has: an opening whose covering geometry has
 * not shipped stays closed, so nobody falls into the ground before the interior or cave exists.
 */
export function activeTerrainHoles(has: (assetId: string) => boolean): TownHole[] {
  return TERRAIN_HOLES.filter((h) => has(h.cover));
}
