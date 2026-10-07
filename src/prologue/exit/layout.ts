// The parts of `cave/anchors` the exit chapter's world reads beyond the keep's (design Appendix
// "Pipeline outputs", Cave): walk paths, web walls, the outcrop, dressing, volumes; and pure
// geometry on them (progress along a walk path, zone boxes split by it, the leash line, the
// chasm's banks, the respawn volumes). No Babylon: unit-tested in tests/unit/prologue/exitLayout.

import type { CaveAnchors, V3 } from "../keep/anchors";

type XYZ = { readonly x: number; readonly y: number; readonly z: number };
type XZ = { readonly x: number; readonly z: number };

/** An oriented box (`webs.<id>.box`, `outcrop.mouthPlug.box`): centre, half extents, and its three axes. */
export interface OrientedBox {
  centre: V3;
  half: V3;
  axes: readonly [V3, V3, V3];
}

/** A web wall (`webs.web_A` / `web_B`): its plane through `centre` facing `normal`, sized to the tunnel. */
export interface WebDef {
  centre: V3;
  /** horizontal (both walls face west, the way on: A into the chamber, B out of it; `box.axes[0]`) */
  normal: V3;
  /** width × height of the cards (m) */
  size: readonly [number, number];
  /** the tunnel floor under it */
  floor: number;
  box: OrientedBox;
}

export interface ZoneBox {
  min: V3;
  max: V3;
}

/** `cave/anchors` as the exit reads it (every extra is optional: an older build lacks some). */
export interface ExitAnchors extends CaveAnchors {
  paths?: {
    /** the tunnel centre floors every 2 m (collider heights): entry → toSpider → toDen → exit */
    walk?: Partial<Record<"entry" | "toSpider" | "toDen" | "exit", V3[]>>;
    den_path?: V3[];
    chasm?: { x: readonly [number, number]; z: readonly [number, number] };
  };
  webs?: Partial<Record<"web_A" | "web_B", WebDef>>;
  outcrop?: {
    platform?: { y: number; x: readonly [number, number]; z: readonly [number, number]; centre: V3 };
    props?: { name: string; suggest: string; pos: V3; yaw?: number; scale?: number }[];
    vista?: Record<string, { target: V3; distance: number; yaw: number }>;
  };
  dressing?: {
    cocoons?: { name: string; a: V3; b: V3; r?: number }[];
    eggs?: { c: V3; r: number }[];
    fissure?: { centre: V3; size: readonly [number, number]; yaw: number };
  };
}

// ------------------------------------------------------------------------------------------------
// walk paths

/** Length of a polyline (m, 3D). */
export function pathLength(path: readonly V3[]) {
  let s = 0;
  for (let i = 1; i < path.length; i++) s += Math.hypot(path[i][0] - path[i - 1][0], path[i][1] - path[i - 1][1], path[i][2] - path[i - 1][2]);
  return s;
}

/**
 * Where `p` is along a polyline: the arc length `s` (m from its start) of the nearest point on it
 * (3D: the climb's switchbacks lie over each other), and the distance `d` to that point. A path of
 * fewer than 2 points gives s 0 and the distance to its point (Infinity: none).
 */
export function pathProgress(path: readonly V3[], p: XYZ): { s: number; d: number } {
  if (!path.length) return { s: 0, d: Infinity };
  if (path.length === 1) return { s: 0, d: Math.hypot(p.x - path[0][0], p.y - path[0][1], p.z - path[0][2]) };
  let best = { s: 0, d: Infinity };
  let s0 = 0;
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1], b = path[i];
    const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2];
    const len2 = dx * dx + dy * dy + dz * dz;
    const len = Math.sqrt(len2);
    const u = len2 > 1e-12 ? Math.max(0, Math.min(1, ((p.x - a[0]) * dx + (p.y - a[1]) * dy + (p.z - a[2]) * dz) / len2)) : 0;
    const d = Math.hypot(a[0] + dx * u - p.x, a[1] + dy * u - p.y, a[2] + dz * u - p.z);
    if (d < best.d) best = { s: s0 + u * len, d };
    s0 += len;
  }
  return best;
}

/** The horizontal unit direction of a polyline at arc length `s` (its segment's; null if it has none). */
export function pathTangent(path: readonly V3[], s: number): { x: number; z: number } | null {
  let s0 = 0;
  let last: { x: number; z: number } | null = null;
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1], b = path[i];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    const h = Math.hypot(b[0] - a[0], b[2] - a[2]);
    if (h > 1e-9) last = { x: (b[0] - a[0]) / h, z: (b[2] - a[2]) / h };
    if (s <= s0 + len && last) return last;
    s0 += len;
  }
  return last;
}

/**
 * Split zone boxes into consecutive stretches of a walk path: each box goes to the stretch its
 * centre projects into, where `cuts` (ascending arc lengths) are the stretches' starts after the
 * first. Returns `cuts.length + 1` lists, in path order, boxes keeping their order.
 */
export function splitBoxes<B extends ZoneBox>(boxes: readonly B[], path: readonly V3[], cuts: readonly number[]): B[][] {
  const out: B[][] = Array.from({ length: cuts.length + 1 }, () => []);
  for (const b of boxes) {
    const c = { x: (b.min[0] + b.max[0]) / 2, y: (b.min[1] + b.max[1]) / 2, z: (b.min[2] + b.max[2]) / 2 };
    const s = pathProgress(path, c).s;
    let k = 0;
    while (k < cuts.length && s >= cuts[k]) k++;
    out[k].push(b);
  }
  return out;
}

/** Whether `p` lies beyond the vertical plane through `at` facing `dir` (horizontal): past a line across a tunnel. */
export function beyond(p: XZ, at: XZ, dir: XZ) {
  return (p.x - at.x) * dir.x + (p.z - at.z) * dir.z > 0;
}

// ------------------------------------------------------------------------------------------------
// volumes

export function inZoneBox(b: ZoneBox, p: XYZ, pad = 0) {
  return p.x >= b.min[0] - pad && p.x <= b.max[0] + pad && p.y >= b.min[1] - pad && p.y <= b.max[1] + pad && p.z >= b.min[2] - pad && p.z <= b.max[2] + pad;
}

/** The gallery bank `p` stands on: north of the chasm (the lever's side), south (the exit's), or neither. */
export function bankOf(p: XZ, chasm: { x: readonly [number, number]; z: readonly [number, number] }): "north" | "south" | null {
  if (p.x < chasm.x[0] || p.x > chasm.x[1]) return null;
  if (p.z > chasm.z[1]) return "north";
  if (p.z < chasm.z[0]) return "south";
  return null;
}

/** A respawn volume (`volumes.respawn_*`): fall into it and come back at one of `to` (anchor names). */
export interface RespawnVolume {
  id: string;
  min: V3;
  max: V3;
  to: readonly string[];
}

/** The respawn volumes of the anchors (those with a box and somewhere to go). */
export function respawnVolumes(volumes: CaveAnchors["volumes"] | undefined): RespawnVolume[] {
  const out: RespawnVolume[] = [];
  for (const [id, v] of Object.entries(volumes ?? {})) {
    if (!id.startsWith("respawn") || !v.min || !v.max || !v.to?.length) continue;
    out.push({ id, min: v.min, max: v.max, to: v.to });
  }
  return out;
}

/**
 * Where a player at `p` is put back (§4.3 gallery, §4.4 outcrop): null outside every respawn
 * volume; else the anchor of the bank last stood on for the gallery's (`to[0]` north = the lever's
 * stance, `to[1]` south = gal_s_cp; unknown: the exit's side), the volume's only anchor otherwise.
 */
export function respawnTarget(p: XYZ, volumes: readonly RespawnVolume[], lastBank: "north" | "south" | null): { volume: string; to: string } | null {
  for (const v of volumes) {
    if (!inZoneBox(v, p)) continue;
    if (v.to.length >= 2) return { volume: v.id, to: lastBank === "north" ? v.to[0] : v.to[1] };
    return { volume: v.id, to: v.to[0] };
  }
  return null;
}
