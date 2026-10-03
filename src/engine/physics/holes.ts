/** An axis-aligned rectangle on the ground plane (world x/z, inclusive bounds). */
export interface Rect2 {
  x0: number;
  x1: number;
  z0: number;
  z1: number;
}

/**
 * A hole cut into a terrain height field. `samples` are the height samples dropped from the
 * collider; Jolt then drops every triangle that touches one of them, so the effective hole extends
 * up to one sample spacing beyond the rectangle. `render` is the part of the render mesh skipped
 * by the asset pipeline (kept here so the pair stays in one table).
 */
export interface TerrainHole {
  id: string;
  samples: Rect2;
  render: Rect2;
}

export const inRect = (r: Rect2, x: number, z: number) => x >= r.x0 && x <= r.x1 && z >= r.z0 && z <= r.z1;

/** Whether a height sample at (x, z) is dropped by any of `holes`. */
export function inHoles(holes: readonly { samples: Rect2 }[], x: number, z: number) {
  for (const h of holes) if (inRect(h.samples, x, z)) return true;
  return false;
}

/**
 * The area the collider actually loses for a sample rectangle on a grid of `step` spacing starting
 * at (x0, z0): every grid cell with a dropped corner. Null when the rectangle holds no sample.
 */
export function effectiveHole(r: Rect2, x0: number, z0: number, step: number): Rect2 | null {
  const i0 = Math.ceil((r.x0 - x0) / step - 1e-9), i1 = Math.floor((r.x1 - x0) / step + 1e-9);
  const j0 = Math.ceil((r.z0 - z0) / step - 1e-9), j1 = Math.floor((r.z1 - z0) / step + 1e-9);
  if (i1 < i0 || j1 < j0) return null;
  return { x0: x0 + (i0 - 1) * step, x1: x0 + (i1 + 1) * step, z0: z0 + (j0 - 1) * step, z1: z0 + (j1 + 1) * step };
}
