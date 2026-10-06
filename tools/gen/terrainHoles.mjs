// Openings in the terrain where the world goes below ground (design §3.1). Mirrors
// src/world/terrainHoles.ts: keep the two tables identical. (Pending in src: EXIT_HOLE.cover is
// cave/outcrop here and still cave/mesh there. tools/build-assets.mjs reads the runtime's covers, warns
// while they differ and fails if the runtime would open a hole the render terrain keeps closed.)
//
//   samples  height samples the gameplay collider drops (Physics.addHeightField). Jolt drops every
//            triangle touching a dropped sample, so on the ~2 m grid the collider opening reaches
//            up to one spacing past this rectangle.
//   render   the render mesh (tools/gen/terrain.mjs) skips every quad whose centre lies inside.
//   cover    the asset whose geometry covers (and floors) the opening. Without it the hole stays
//            closed, at runtime (activeTerrainHoles) and in the build (activeHoles below).
//
// All rectangles are world x/z with inclusive bounds.

/** Under the keep: covered by its walls and roof, floored by the interior's slab collider (x 47.5…72.5, z −670.5…−653). */
export const KEEP_HOLE = {
  id: "keep",
  samples: { x0: 50, x1: 70, z0: -668, z1: -656 },
  render: { x0: 47.5, x1: 72.5, z0: -670.5, z1: -653.5 },
  cover: "keep/interior",
};

/**
 * Where the cave tunnel comes up inside the balcony outcrop (footprint x −26…−9, z −684…−664). Covered
 * and floored by cave/outcrop (segment muster, shown with the town): its skin caps the hole and it
 * ships the mouth in front of the plug, render and collider (tools/gen/cave.mjs).
 */
export const EXIT_HOLE = {
  id: "exit",
  samples: { x0: -22, x1: -16, z0: -680, z1: -676 },
  render: { x0: -24, x1: -14, z0: -682, z1: -674 },
  cover: "cave/outcrop",
};

export const TERRAIN_HOLES = [KEEP_HOLE, EXIT_HOLE];

export const inRect = (r, x, z) => x >= r.x0 && x <= r.x1 && z >= r.z0 && z <= r.z1;

/** The holes to cut, given which asset ids will ship (same rule as activeTerrainHoles at runtime). */
export function activeHoles(ships) {
  return TERRAIN_HOLES.filter((h) => ships(h.cover));
}

/** Whether a render quad centred at (x, z) is skipped by any of `holes`. */
export function inRenderHole(holes, x, z) {
  for (const h of holes) if (inRect(h.render, x, z)) return true;
  return false;
}
