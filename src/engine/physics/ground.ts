import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { Physics } from "./Physics";

const DOWN = new Vector3(0, -1, 0);
const from = new Vector3();

/**
 * Height of the static floor under (x, z) near `yHint`: a ray straight down from `yHint + above`,
 * `above + depth` long, against STATIC colliders only. Null when it meets nothing. For placing
 * actors where the terrain height means nothing (inside buildings, underground).
 */
export function floorAt(ph: Physics, x: number, z: number, yHint: number, o: { above?: number; depth?: number } = {}): number | null {
  const above = o.above ?? 1.5, depth = o.depth ?? 4;
  const top = yHint + above;
  const d = ph.rayCastStatic(from.set(x, top, z), DOWN, above + depth);
  return Number.isFinite(d) ? top - d : null;
}
