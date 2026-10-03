/**
 * Path helpers for flying creatures (circuits, strafing runs) and timers for their ambient
 * behaviour. Pure math on plain {x, y, z} points: the caller turns them into its vector type.
 */
export interface P3 {
  x: number;
  y: number;
  z: number;
}

export type Rng = () => number;

/** Heading of `p` around `center` in the x-z plane (radians; 0 = +X, π/2 = +Z). */
export function angleAround(center: { x: number; z: number }, p: { x: number; z: number }) {
  return Math.atan2(p.z - center.z, p.x - center.x);
}

/**
 * `count` waypoints on a circle around `center` (radius `r`), starting one `step` after angle `from`
 * (positive steps turn from +X toward +Z). Heights are drawn from [yMin, yMax] and lifted to at
 * least `ground(x, z) + clearance` when a ground function is given.
 */
export function orbitPoints(
  center: { x: number; z: number },
  r: number,
  from: number,
  count: number,
  step: number,
  o: { yMin: number; yMax: number; rng?: Rng; ground?: (x: number, z: number) => number; clearance?: number },
): P3[] {
  const rng = o.rng ?? Math.random;
  const out: P3[] = [];
  for (let k = 1; k <= count; k++) {
    const a = from + k * step;
    const x = center.x + Math.cos(a) * r, z = center.z + Math.sin(a) * r;
    let y = o.yMin + rng() * (o.yMax - o.yMin);
    if (o.ground) y = Math.max(y, o.ground(x, z) + (o.clearance ?? 0));
    out.push({ x, y, z });
  }
  return out;
}

/**
 * A strafing run across `target`, flown at right angles to the line from `center` to the target:
 * `start` well to one side and high, `mid` low over the target (a little before it, where a breath
 * or a drop is released), `end` beyond it and climbing.
 */
export function strafeRun(
  target: P3,
  center: { x: number; z: number },
  o: { approach?: number; lead?: number; exit?: number; startHeight?: number; lowHeight?: number; exitHeight?: number } = {},
): { start: P3; mid: P3; end: P3; side: { x: number; z: number } } {
  let dx = target.x - center.x, dz = target.z - center.z;
  const len = Math.hypot(dx, dz);
  if (len < 1e-6) {
    dx = 1;
    dz = 0;
  } else {
    dx /= len;
    dz /= len;
  }
  // perpendicular to the radial direction
  const side = { x: -dz, z: dx };
  const along = (d: number, h: number): P3 => ({ x: target.x + side.x * d, y: target.y + h, z: target.z + side.z * d });
  return {
    start: along(-(o.approach ?? 55), o.startHeight ?? 26),
    mid: along(-(o.lead ?? 8), o.lowHeight ?? 13),
    end: along(o.exit ?? 50, o.exitHeight ?? 30),
    side,
  };
}

/** A delay drawn from `every`: a fixed number of seconds or a [min, max] range. */
export function interval(every: number | readonly [number, number], rng: Rng = Math.random) {
  return typeof every === "number" ? every : every[0] + rng() * (every[1] - every[0]);
}

export const dist3 = (a: P3, b: P3) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
