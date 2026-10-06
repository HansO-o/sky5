import type { Rect2, TerrainHole } from "../engine/physics/holes";

/**
 * Openings in the terrain where the world goes below ground (design §3.1). Mirrored in
 * tools/gen/terrainHoles.mjs: the terrain generator skips render quads whose centre lies in
 * `render`; the gameplay height field drops the samples in `samples` (see Physics.addHeightField).
 * Jolt drops every triangle touching a dropped sample, so the collider opening reaches up to one
 * grid step past `samples` (see `effectiveHole` on {@link TERRAIN_GRID}).
 */
export interface TownHole extends TerrainHole {
  /** asset whose geometry covers (and floors) the opening: without it the hole stays closed */
  cover: string;
  /**
   * Where the collider opening runs past the covering geometry: closed again with static slabs at
   * terrain height ({@link patchSlabs}). The height field's grid does not line up with the walls,
   * so an opening wide enough to clear everything inside them overshoots outside.
   */
  patches?: Rect2[];
}

/**
 * The gameplay terrain collider (PrologueStage.ensurePhysics): a 512 m square centred on the town
 * square (60, −592) with 256 samples a side, so one step is 512/255 ≈ 2.008 m and the samples sit
 * at x −196 + i·step, z −848 + j·step (…, 69.04, 71.04, 73.05, … and …, −671.31, −669.30, −667.29, …).
 */
export const TERRAIN_GRID = { x0: 60 - 256, z0: -592 - 256, size: 512, samples: 256 } as const;
export const TERRAIN_STEP = TERRAIN_GRID.size / (TERRAIN_GRID.samples - 1);

/**
 * Under the keep: covered by its walls and roof, floored by the interior's slab collider (x 47.5…72.5,
 * z −670.5…−653). On {@link TERRAIN_GRID} the samples kept are x 50.96…71.04, z −669.30…−657.25, so the
 * collider opening is x 48.96…73.05, z −671.31…−655.25: it clears the whole G5 stairwell (inner faces
 * x 71.78, z −669.78; nothing of the height field may stand in it, the stairs go 6 m down through the
 * terrain's level) and overshoots the shell (x 72.5, z −670.5) by 0.55 m east and 0.81 m north, where
 * `patches` floor the wall feet again. West and south the opening stays under the ground-floor slab.
 */
export const KEEP_HOLE: TownHole = {
  id: "keep",
  samples: { x0: 50, x1: 71.5, z0: -669.5, z1: -656 },
  render: { x0: 47.5, x1: 72.5, z0: -670.5, z1: -653.5 },
  cover: "keep/interior",
  patches: [
    // east wall foot (from inside the 0.7 m wall, past the opening onto the height field)
    { x0: 72.3, x1: 73.6, z0: -671.9, z1: -654.6 },
    // north wall foot
    { x0: 48.3, x1: 73.6, z0: -671.9, z1: -670.3 },
  ],
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

/** A static box: centre and half extents (world). */
export interface PatchSlab {
  center: [number, number, number];
  half: [number, number, number];
}

/**
 * Static slabs closing `holes`' patches: the rectangle cut into pieces of at most `seg` metres, each
 * 0.6 m thick with its top at the highest terrain sample over the piece (the town's ground around
 * the keep varies by a few centimetres, which the character controller steps over).
 */
export function patchSlabs(holes: readonly TownHole[], heightAt: (x: number, z: number) => number, seg = 2): PatchSlab[] {
  const out: PatchSlab[] = [];
  const T = 0.3;
  for (const h of holes)
    for (const r of h.patches ?? []) {
      const nx = Math.max(1, Math.ceil((r.x1 - r.x0) / seg - 1e-9)), nz = Math.max(1, Math.ceil((r.z1 - r.z0) / seg - 1e-9));
      const dx = (r.x1 - r.x0) / nx, dz = (r.z1 - r.z0) / nz;
      for (let i = 0; i < nx; i++)
        for (let j = 0; j < nz; j++) {
          const xa = r.x0 + i * dx, za = r.z0 + j * dz;
          let top = -Infinity;
          for (const fx of [0, 0.5, 1]) for (const fz of [0, 0.5, 1]) top = Math.max(top, heightAt(xa + fx * dx, za + fz * dz));
          out.push({ center: [xa + dx / 2, top - T, za + dz / 2], half: [dx / 2, T, dz / 2] });
        }
    }
  return out;
}
