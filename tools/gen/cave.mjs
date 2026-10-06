// Cave and balcony outcrop (design §4.3, §4.4; port of tools/gen/prototypes/cave_v4.mjs).
//
// The rock is one signed distance field S (negative = rock), meshed once with sparse naive surface
// nets at 0.5 m so the cave, the outcrop's skin and the mouth between them share every edge:
//
//   air      v4: smooth union of D-shaped swept capsules (TUNNELS), flat-floored ellipsoid
//            CHAMBERS and the stream trench (STREAM), fbm noise 0.55 m on walls / 0.12 m on floors;
//            plus the spider CHIMNEY, the archer PERCH (a rock box) and the keep's drain (BREACH)
//   ground   below the terrain (analytic, cached), offset 0.5 m down so skins reach under the
//            2 m terrain mesh
//   outcrop  rounded box + hood + west shoulder + a cap over EXIT_HOLE, noise 0.5 m, the platform
//            cut flat at 56.05 (and filled up to it)
//   S = min(max(min(ground, outcrop), −air), platform slab)
//
// Triangles are classified by the dominating term: −air → cave (split into zones A–E), outcrop →
// the outcrop skin, ground → dropped (the terrain mesh renders it). The cave is clipped exactly at
// the keep's drain mouth. Meshes are simplified jointly (35 % render, 12 % collider) and then split,
// so zone meshes and the outcrop meet edge to edge; each render mesh also carries a one-triangle
// ring of its neighbours (hides quantisation cracks between separately quantised meshes).
//
// Explicit geometry on top: the terraced exit stair (rock slabs + one ramp collider through the
// tread middles), the perch steps (+ ramp collider), the water ribbon, the web walls A/B (3 cards
// + a removable box collider each), corner webs, cocoons, egg sacs, the den's daylight fissure, the
// platform's invisible rails and the mouth plug.
//
// Outputs (buildCave → emit), all in world coordinates (add the containers at the origin):
//   cave/mesh_a   glb  keep   zone A: entry + gallery (render, collider, water ribbon, perch steps)
//   cave/mesh     glb  exit   zones B–E behind the mouth plug (+ webs, cocoons, egg sacs, fissure, stair)
//   cave/outcrop  glb  muster EXIT_HOLE's cover, shown with the town: the outcrop's skin + platform,
//                             the mouth in front of the plug (the stub: rock, top stair slabs, ramp),
//                             the deck's enclosure (rails + walls) and the plug; binds only the moss
//                             set, which ships in muster with it
//   cave/anchors  json keep   anchors, paths, zones, volumes, webs, stair, materials, joins, stats
//                             (reproducible: no timings, so identical builds give identical bytes)
//   cave/tex/*    ktx2 keep/muster  rock_face_03, rocks_ground_08, ganges_river_pebbles (keep), mossy_rock (muster)
//   fx/water_n    ktx2 keep   tileable water normal map (tools/gen/watertex.mjs)
// buildCaveData fails the build per design §4.3 (cover, clearance, half-width across the tunnel,
// slope, winding), on a walk path that is not continuous from breach to balcony_mouth (only the
// gallery chasm and the keep's drain passage are exempt) and on the joins this module owns (terrain
// hole, the skin's border under the terrain mesh, drain mouth, walkable colliders, zones, platform).
// buildCave then checks the decoded GLBs before it emits anything: the walk (checkEncoded), and the
// town-chapter set, cave/outcrop over the runtime terrain collider with EXIT_HOLE and no cave/mesh
// (render closed around the mouth, a collider under every floor), the deck's enclosure for the
// player's capsule, rail height, the gate boxes, the perch ramp and node names (checkOutdoor).
// tools/check-cave-mutations.mjs proves the gate catches each mutation in its list;
// tools/build-assets.mjs re-checks the drain join against keep/anchors.
// Self-contained: layout data, field, meshing, validation and glTF; only emit/SRC come in.
import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { Document } from "@gltf-transform/core";
import { dedup, weld, prune, meshopt } from "@gltf-transform/functions";
import { KHRMaterialsEmissiveStrength } from "@gltf-transform/extensions";
import { MeshoptEncoder } from "meshoptimizer";
import { io, makePrimitive, ktxTexture, MeshoptSimplifier } from "../lib/gltf.mjs";
import { toKTX2 } from "../lib/ktx.mjs";
import { buildRoute, makeTerrain } from "./world.mjs";
import { EXIT_HOLE, inRect } from "./terrainHoles.mjs";
import { AIR as KEEP_AIR, ORIGIN as KEEP_ORIGIN } from "./keepinterior.mjs";
import { buildWebAtlas, WEB_UV } from "./webtex.mjs";
import { buildWaterNormal } from "./watertex.mjs";
import { SCATTER_EXCLUDE } from "./scatter.mjs";

// ------------------------------------------------------------------ small math
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const lerp = (a, b, t) => a + (b - a) * t;
const smoothstep = (a, b, x) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = (a) => Math.hypot(a[0], a[1], a[2]);
const norm = (a) => mul(a, 1 / (len(a) || 1));
const r2 = (v) => +v.toFixed(2);
const r3v = (v) => v.map((x) => +x.toFixed(3));
/** game yaw convention (design §4): facing direction (dx, dz) → atan2(−dx, −dz); −Z = 0, west = π/2 */
const yawOf = (dx, dz) => Math.atan2(-dx, -dz);
/** smooth min / max (polynomial, k = blend width) */
const smin = (a, b, k) => {
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return Math.min(a, b) - h * h * k * 0.25;
};
const smax = (a, b, k) => -smin(-a, -b, k);

/** Deterministic PRNG for dressing placement. */
function rng(seed) {
  let s = seed % 2147483647 || 1;
  return () => (s = (s * 16807) % 2147483647) / 2147483647;
}

// ------------------------------------------------------------------ 3D gradient noise (v4, seed 1337)
const PERM = new Uint8Array(512);
{
  const p = [...Array(256).keys()];
  let s = 1337;
  for (let i = 255; i > 0; i--) {
    s = (s * 16807) % 2147483647;
    const j = s % (i + 1);
    [p[i], p[j]] = [p[j], p[i]];
  }
  for (let i = 0; i < 512; i++) PERM[i] = p[i & 255];
}
const GRAD = [[1, 1, 0], [-1, 1, 0], [1, -1, 0], [-1, -1, 0], [1, 0, 1], [-1, 0, 1], [1, 0, -1], [-1, 0, -1], [0, 1, 1], [0, -1, 1], [0, 1, -1], [0, -1, -1]];
const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);
const gr = (h, dx, dy, dz) => {
  const q = GRAD[h % 12];
  return q[0] * dx + q[1] * dy + q[2] * dz;
};
function noise3(x, y, z) {
  const X = Math.floor(x), Y = Math.floor(y), Z = Math.floor(z);
  x -= X;
  y -= Y;
  z -= Z;
  const xi = X & 255, yi = Y & 255, zi = Z & 255, u = fade(x), v = fade(y), w = fade(z);
  const A = PERM[xi] + yi, AA = PERM[A] + zi, AB = PERM[A + 1] + zi, B = PERM[xi + 1] + yi, BA = PERM[B] + zi, BB = PERM[B + 1] + zi;
  return lerp(
    lerp(lerp(gr(PERM[AA], x, y, z), gr(PERM[BA], x - 1, y, z), u), lerp(gr(PERM[AB], x, y - 1, z), gr(PERM[BB], x - 1, y - 1, z), u), v),
    lerp(lerp(gr(PERM[AA + 1], x, y, z - 1), gr(PERM[BA + 1], x - 1, y, z - 1), u), lerp(gr(PERM[AB + 1], x, y - 1, z - 1), gr(PERM[BB + 1], x - 1, y - 1, z - 1), u), v),
    w,
  );
}
const fbm3 = (x, y, z) => noise3(x, y, z) * 0.6 + noise3(x * 2.1, y * 2.1, z * 2.1) * 0.28 + noise3(x * 4.3, y * 4.3, z * 4.3) * 0.12;

// ------------------------------------------------------------------ layout (world coordinates)
/** Tunnel splines, control points [x, floorY, z, halfWidth, clearHeight] (design §4.3, v4). */
export const TUNNELS = {
  entry: [[54, 33.1, -687, 1.3, 2.7], [54, 31.0, -697, 1.8, 3.0], [52, 29.6, -710, 2.0, 3.2], [49, 28.0, -720, 2.2, 3.4], [48, 28.0, -731, 2.4, 3.6]],
  toSpider: [[48, 28.0, -731, 2.2, 3.4], [47, 28.0, -741, 2.0, 3.3], [42, 28.2, -746, 2.0, 3.2], [32, 28.4, -749, 1.9, 3.2], [18, 28.5, -750, 2.2, 3.4]],
  toDen: [[18, 28.5, -750, 2.0, 3.2], [6, 29.2, -748, 2.0, 3.2], [-6, 30.6, -741, 1.9, 3.0], [-16, 32.0, -731, 2.0, 3.2], [-24, 33.5, -720, 2.2, 3.4]],
  exit: [[-24, 33.5, -720, 2.0, 3.2], [-28, 34.3, -709, 2.0, 3.2], [-33, 36.3, -699, 2.1, 3.2], [-40, 38.8, -690, 2.2, 3.3], [-46, 41.6, -681, 2.3, 3.4], [-44, 44.2, -671, 2.3, 3.4], [-36, 46.8, -674, 2.3, 3.4], [-30, 49.6, -682, 2.4, 3.5], [-25, 52.2, -684, 2.6, 3.6], [-21, 54.8, -680, 2.8, 3.8], [-17.5, 57.0, -673.5, 3.2, 4.2]],
};
/** Zone of each tunnel (the exit spline switches to E at the anchor `bend`). */
const TUNNEL_ZONE = { entry: "A", toSpider: "B", toDen: "C", exit: "D" };
/** Stream channel in the gallery: [x, bedY, z, halfWidth], flowing from x 64 to x 32 (west). */
export const STREAM = [[64, 23.4, -733, 1.6], [56, 23.3, -732.5, 2.6], [48, 23.2, -731.5, 3.7], [40, 23.1, -731, 2.6], [32, 23.0, -731, 1.6]];
/** Chambers (order matters: the smooth unions are applied in this order, as in v4). */
export const CHAMBERS = {
  gallery: { c: [48, 28.0, -731], r: [14, 10, 11], yaw: 0, zone: "A" },
  spider: { c: [18, 28.5, -750], r: [9, 8.5, 7], yaw: 0.1, zone: "B" },
  den: { c: [-24, 33.5, -720], r: [8, 6, 7], yaw: -0.4, zone: "C" },
};
const CHAMBER_LIST = Object.values(CHAMBERS);
/** Spider chimney: vertical air capsule Ø2.5 m above the chamber (design §4.3 extra SDF). */
export const CHIMNEY = { a: [18, 34.8, -750.5], b: [18, 39, -750.5], r: 1.25, k: 1.0 };
/** Archer perch: a rock box 3 × 2.2 × 2 m on the gallery's north ledge, top 30.15; steps climb its west face. */
export const PERCH = { c: [55.0, 29.05, -727.6], half: [1.5, 1.1, 1.0], top: 30.15, floor: 27.95, steps: { n: 5, tread: 0.45, z: -727.2, width: 1.2 } };
/** Terraced exit stair: from s 76 (horizontal arc length along the exit spline) up to the platform. */
export const STAIR = { s0: 76, riser: 0.35, maxRiser: 0.4 };
/** Water surface and bed (design §4.3); the ribbon is 0.6 m wider than the channel. */
export const WATER = { y: 23.7, bed: 23.1, widen: 0.3 };
/** Rock cover is not checked here: the tunnel comes up into the outcrop (design §4.3). */
const coverExempt = (x, z) => x > -27 && z > -686;

/**
 * The balcony outcrop (design §4.4). The box reaches down to y 36 (the design's 46.5 floats above
 * the terrain on the SE side, which falls to 40); the hood covers the last metres of the tunnel and
 * runs on east to the cliff, so the platform's north side is rock from the shoulder to the east face
 * (the box's top would otherwise continue the deck as a shelf onto the hillside); the west shoulder
 * walls the platform on that side; the cap covers the whole of EXIT_HOLE (the terrain inside the hole
 * rises to 68 m at its NW corner, above the hood). The cap stands `lift` m above the terrain and the
 * shoulder 5.5 m above the deck, so their landward rims are too high to step or jump onto from the
 * hillside: the platform is reachable only through the tunnel, and a player who could reach the
 * outcrop's top in a town chapter could otherwise drop onto the deck and be shut in by the rails.
 * The rails close the open S and E edges; their ends run into the shoulder and the hood.
 */
export const OUTCROP = {
  box: { c: [-16.5, 46.25, -672.75], half: [7.5, 10.25, 7.75], r: 1.5 },
  hood: { min: [-23, 53.5, -681], max: [-7.8, 62.5, -674], r: 1.5 },
  shoulder: { min: [-24.5, 50, -675.5], max: [-19, 58.6, -666.5], r: 1.2 },
  cap: { x: [EXIT_HOLE.render.x0 - 1, EXIT_HOLE.render.x1 + 1], z: [EXIT_HOLE.render.z0 - 1, EXIT_HOLE.render.z1 + 1], lift: 1.3, r: 1.0 },
  noise: 0.5,
  platform: { y: 56.05, x: [-19, -11], z: [-674, -667], centre: [-15.0, 56.05, -670.5] },
  /**
   * The deck's invisible enclosure (one collider node, outcrop_rails_col): the rails along the open S
   * and E edges (`open`, at least `h` above the deck) and the walls on the rock sides, which stop
   * anyone on the outcrop's top (the hillside runs up onto it) from dropping onto the deck or into the
   * mouth: W across the shoulder 2.8 m west of its cut face (the tunnel's rounded end notches the
   * shoulder there), N above the mouth from out of a jump's reach up (the deck + JUMP_REACH + the
   * capsule's 1.8 m < 59.2). Each wall is a box from a to b (x/z, +0.15 m past both ends) over y,
   * `t` thick (default rails.t), offset by `side` · t/2 along (−t_z, 0, t_x) of the direction a → b
   * (N: −1, into the hood).
   */
  rails: {
    h: 1.2,
    t: 0.3,
    open: { S: [[-19, -667], [-11, -667]], E: [[-11, -674], [-11, -667]] },
    walls: {
      S: { a: [-21.8, -667], b: [-11, -667], y: [55.55, 66] },
      E: { a: [-11, -675.2], b: [-11, -667], y: [55.55, 66] },
      W: { a: [-21.8, -674.2], b: [-21.8, -667], y: [55.55, 66] },
      N: { a: [-21.8, -674], b: [-11, -674], y: [59.2, 66], t: 1.2, side: -1 },
    },
  },
  footprint: { x: [-26, -9], z: [-684, -664] },
  /** respawn below this height over the outcrop's skin (volumes.respawn_outcrop), north to `z0` (the tunnel runs below 50 m further north) */
  respawn: { y: 50, z0: -676, margin: 1.0 },
  /** the field evaluates the outcrop terms only inside this box */
  bbox: { min: [-32, 30, -690], max: [-2, 72, -657] },
};

/** The keep's drain mouth (keep/interior room "drain", keep-local → world). */
const DRAIN_KEEP = (() => {
  const d = KEEP_AIR.find((a) => a.name === "drain");
  return { min: add(d.min, KEEP_ORIGIN), max: add(d.max, KEEP_ORIGIN) };
})();
/**
 * Cave side of the drain: an exact box inset 1 cm (2 cm on the floor) inside the keep's opening,
 * reaching 2 cm into the keep's passage (the cave is clipped at clipZ), so the two meet without a
 * crack or a coplanar strip. The tunnel's own air stops at tunnelZ.
 */
export const BREACH = {
  keep: DRAIN_KEEP,
  box: { min: [DRAIN_KEEP.min[0] + 0.01, DRAIN_KEEP.min[1] + 0.02, DRAIN_KEEP.min[2] - 1.4], max: [DRAIN_KEEP.max[0] - 0.01, DRAIN_KEEP.max[1] - 0.01, DRAIN_KEEP.max[2]] },
  clipZ: DRAIN_KEEP.min[2] + 0.02,
  tunnelZ: DRAIN_KEEP.min[2] - 1.0,
};
const nearBreach = (x, z) => x > 48 && x < 60 && z > -694;
/**
 * The two places the walk path may break (validator whitelist): the gallery chasm (the drawbridge gap
 * over the stream, crossed by the bridge or a jump) and the keep's drain passage at the start of the
 * entry tunnel (the cave is clipped there; its floor is the keep's).
 */
export const CHASM = { x: [30, 66], z: [-735.7, -727.3] };
const inChasm = (x, z) => x > CHASM.x[0] && x < CHASM.x[1] && z > CHASM.z[0] && z < CHASM.z[1];
const inDrainPass = (name, z) => name === "entry" && z > BREACH.clipZ - 0.3;

/** Texture sets (Poly Haven CC0, tools/sources.mjs). tile = metres per repeat (PH dimensions). */
export const CAVE_TEX = {
  rock: { src: "rock_face_03", tile: 2.7, segment: "keep" },
  ground: { src: "rocks_ground_08", tile: 3.0, segment: "keep" },
  pebbles: { src: "ganges_river_pebbles", tile: 2.16, segment: "keep" },
  moss: { src: "mossy_rock", tile: 3.0, segment: "muster" },
};
/** Render materials → texture set. */
const MATS = {
  cave_rock: { tex: "rock", note: "walls and ceilings" },
  cave_floor: { tex: "ground", note: "floors (normal.y ≥ 0.72), stair treads, perch step treads" },
  cave_bed: { tex: "pebbles", note: "stream bed in the gallery" },
  cave_moss: { tex: "moss", note: "walls of the last 25 m of the climb, stair risers, every cave triangle touching the outcrop (the mouth)" },
  outcrop_rock: { tex: "moss", note: "the outcrop skin and the platform" },
};
const FLOOR_NY = 0.72;

// ------------------------------------------------------------------ splines
function catmull(pts, n = 1) {
  const out = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)], p1 = pts[i], p2 = pts[i + 1], p3 = pts[Math.min(pts.length - 1, i + 2)];
    const l = Math.hypot(p2[0] - p1[0], p2[1] - p1[1], p2[2] - p1[2]);
    const steps = Math.max(2, Math.ceil(l / n));
    for (let k = 0; k < steps; k++) {
      const t = k / steps, t2 = t * t, t3 = t2 * t;
      out.push(p1.map((_, j) => 0.5 * (2 * p1[j] + (-p0[j] + p2[j]) * t + (2 * p0[j] - 5 * p1[j] + 4 * p2[j] - p3[j]) * t2 + (-p0[j] + 3 * p1[j] - 3 * p2[j] + p3[j]) * t3)));
    }
  }
  out.push(pts[pts.length - 1]);
  return out;
}
/** Swept segments of every tunnel (v4 order), with horizontal arc length along their tunnel. */
const SEGS = [];
for (const [name, pts] of Object.entries(TUNNELS)) {
  const s = catmull(pts, 1.0);
  let acc = 0;
  for (let i = 0; i < s.length - 1; i++) {
    const a = s[i], b = s[i + 1], hl = Math.hypot(b[0] - a[0], b[2] - a[2]);
    SEGS.push({ name, a, b, mx: (a[0] + b[0]) / 2, mz: (a[2] + b[2]) / 2, s0: acc, hl });
    acc += hl;
  }
}
const TUNNEL_LEN = Object.fromEntries(Object.keys(TUNNELS).map((n) => [n, SEGS.filter((s) => s.name === n).reduce((a, s) => a + s.hl, 0)]));
// segment hash (4 m cells): the candidates for v4's quick reject |p − mid| ≤ 12 m, in v4's order
const HC = 4;
const SEG_HASH = new Map();
const hkey = (ix, iz) => (ix + 4096) * 8192 + (iz + 4096);
SEGS.forEach((s, k) => {
  for (let ix = Math.floor((s.mx - 12) / HC); ix <= Math.floor((s.mx + 12) / HC); ix++)
    for (let iz = Math.floor((s.mz - 12) / HC); iz <= Math.floor((s.mz + 12) / HC); iz++) {
      const key = hkey(ix, iz);
      if (!SEG_HASH.has(key)) SEG_HASH.set(key, []);
      SEG_HASH.get(key).push(k);
    }
});
const NO_SEGS = [];
const segsNear = (x, z) => SEG_HASH.get(hkey(Math.floor(x / HC), Math.floor(z / HC))) ?? NO_SEGS;

/**
 * The mouth. The plug (a black card and a box) stands `plugDepth` m inside it, across the tunnel; the
 * cave in front of the plug (the stub: rock, the top of the stair and its ramp) ships in cave/outcrop,
 * so the outcrop alone closes and floors the mouth while cave/mesh is not loaded. The stub reaches
 * `behind` m behind the plug's plane, so its floor runs under the plug box and its walls behind the card.
 */
export const MOUTH = { plugDepth: 3.5, behind: 1.5, radius: 9 };
const MOUTH_PT = (() => {
  const q = tunnelAt("exit", TUNNEL_LEN.exit);
  return [q.x, q.fy, q.z];
})();
/** the plug's plane: a point on the centreline and the horizontal tangent (out of the mouth) */
const PLUG_PLANE = (() => {
  const q = tunnelAt("exit", TUNNEL_LEN.exit - MOUTH.plugDepth);
  return { p: [q.x, q.fy, q.z], t: [q.tx, 0, q.tz] };
})();
/** signed distance of p in front of the plug's plane (toward the platform) */
const plugSide = (p) => (p[0] - PLUG_PLANE.p[0]) * PLUG_PLANE.t[0] + (p[2] - PLUG_PLANE.p[2]) * PLUG_PLANE.t[2];
/** a cave point of the stub: in front of the plug's plane (or less than `behind` behind it), near the mouth */
const inStub = (p, behind = MOUTH.behind) => plugSide(p) > -behind && p[1] > 50 && Math.hypot(p[0] - MOUTH_PT[0], p[2] - MOUTH_PT[2]) < MOUTH.radius;

/**
 * The player's capsule (src/prologue/player.ts, src/engine/physics/CapsuleMover.ts defaults). The
 * enclosure checks walk it over the decoded colliders: step-up 0.45, slopes ≤ 50°, 1.8 m tall, and a
 * jump that lifts the feet v²/2g = 1.08 m (`JUMP_REACH` adds 3 cm).
 */
export const MOVER = { radius: 0.3, height: 1.8, stepUp: 0.45, maxSlopeDeg: 50, jumpSpeed: 4.6, gravity: 9.81 };
const JUMP_REACH = MOVER.jumpSpeed ** 2 / (2 * MOVER.gravity) + 0.03;

/** Point on a tunnel at horizontal arc length s: {p (floor point), w, h, t (unit horizontal tangent)}. */
function tunnelAt(name, s) {
  const list = SEGS.filter((g) => g.name === name);
  let g = list[list.length - 1], t = 1;
  for (const c of list)
    if (s <= c.s0 + c.hl) {
      g = c;
      t = clamp((s - c.s0) / (c.hl || 1), 0, 1);
      break;
    }
  const p = g.a.map((v, j) => lerp(v, g.b[j], t));
  const tx = g.b[0] - g.a[0], tz = g.b[2] - g.a[2], tl = Math.hypot(tx, tz) || 1;
  return { x: p[0], fy: p[1], z: p[2], w: p[3], h: p[4], tx: tx / tl, tz: tz / tl };
}

// ------------------------------------------------------------------ air (negative = air)
/** D-shaped tunnel segment (v4). */
function segSdf(px, py, pz, s) {
  const [ax, ay, az, aw, ah] = s.a, [bx, by, bz, bw, bh] = s.b;
  const dx = bx - ax, dz = bz - az, L2 = dx * dx + dz * dz || 1e-6;
  let t = ((px - ax) * dx + (pz - az) * dz) / L2;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const cx = ax + dx * t, cz = az + dz * t, fy = ay + (by - ay) * t, w = aw + (bw - aw) * t, h = ah + (bh - ah) * t;
  const hd = Math.hypot(px - cx, pz - cz);
  const ey = (py - (fy + h * 0.35)) / ((h * 0.65) / w);
  return Math.max(Math.hypot(hd, ey) - w, fy - py);
}
function chamberLocal(px, py, pz, ch) {
  const [cx, cy, cz] = ch.c, c = Math.cos(ch.yaw), s = Math.sin(ch.yaw);
  return [(px - cx) * c - (pz - cz) * s, py - (cy - ch.r[1] * 0.25), (px - cx) * s + (pz - cz) * c];
}
function chamberSdf(px, py, pz, ch) {
  const [lx, ly, lz] = chamberLocal(px, py, pz, ch), [rx, ry, rz] = ch.r;
  const k = Math.hypot(lx / rx, ly / ry, lz / rz);
  return Math.max((k - 1) * Math.min(rx, ry, rz), ch.c[1] - py);
}
const chamberK = (px, py, pz, ch) => {
  const [lx, ly, lz] = chamberLocal(px, py, pz, ch);
  return Math.hypot(lx / ch.r[0], ly / ch.r[1], lz / ch.r[2]);
};
const streamPts = catmull(STREAM, 1);
function channelInfo(px, pz) {
  let best = 1e9, fy = 0, hw = 1.5, s = 0, acc = 0, sBest = 0;
  for (let i = 0; i < streamPts.length - 1; i++) {
    const a = streamPts[i], b = streamPts[i + 1], dx = b[0] - a[0], dz = b[2] - a[2], L2 = dx * dx + dz * dz, L = Math.sqrt(L2);
    let t = ((px - a[0]) * dx + (pz - a[2]) * dz) / L2;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const d = Math.hypot(px - (a[0] + dx * t), pz - (a[2] + dz * t));
    if (d < best) {
      best = d;
      fy = a[1] + (b[1] - a[1]) * t;
      hw = a[3] + (b[3] - a[3]) * t;
      sBest = acc + t * L;
    }
    acc += L;
  }
  return { d: best, fy, hw, s: sBest, total: acc };
}
/** Stream trench (v4); far from the gallery it cannot change the smooth union, so it is skipped. */
function channelSdf(px, py, pz) {
  if (px < 18 || px > 78 || pz > -716 || pz < -748) return 1e9;
  const { d, fy, hw } = channelInfo(px, pz);
  return Math.max(d - (hw + 0.2 * noise3(px * 0.2, 0, pz * 0.2)), fy - py, py - (fy + 6));
}
/** v4's base SDF (no noise), plus the chimney. */
function airBase(x, y, z) {
  let d = 1e9;
  for (const k of segsNear(x, z)) {
    const s = SEGS[k];
    if (Math.abs(x - s.mx) > 12 || Math.abs(z - s.mz) > 12) continue;
    d = smin(d, segSdf(x, y, z, s), 1.2);
  }
  for (const ch of CHAMBER_LIST) d = smin(d, chamberSdf(x, y, z, ch), 2.0);
  d = smin(d, channelSdf(x, y, z), 0.8);
  // chimney (vertical capsule)
  if (Math.abs(x - CHIMNEY.a[0]) < 6 && Math.abs(z - CHIMNEY.a[2]) < 6) {
    const cy = clamp(y, CHIMNEY.a[1], CHIMNEY.b[1]);
    d = smin(d, Math.hypot(x - CHIMNEY.a[0], y - cy, z - CHIMNEY.a[2]) - CHIMNEY.r, CHIMNEY.k);
  }
  return d;
}
function sdBox(x, y, z, min, max) {
  let o = 0, i = -Infinity;
  for (const [p, a, b] of [[x, min[0], max[0]], [y, min[1], max[1]], [z, min[2], max[2]]]) {
    const d = Math.abs(p - (a + b) / 2) - (b - a) / 2;
    o += Math.max(d, 0) ** 2;
    i = Math.max(i, d);
  }
  return Math.sqrt(o) + Math.min(i, 0);
}
/** Rounded box from min/max (radius r, inside the box). */
const sdRoundBox = (x, y, z, min, max, r) => sdBox(x, y, z, add(min, [r, r, r]), sub(max, [r, r, r])) - r;
const PERCH_MIN = [PERCH.c[0] - PERCH.half[0], PERCH.floor - 1.0, PERCH.c[2] - PERCH.half[2]];
const PERCH_MAX = [PERCH.c[0] + PERCH.half[0], PERCH.top, PERCH.c[2] + PERCH.half[2]];
function perchSdf(x, y, z) {
  if (Math.abs(x - PERCH.c[0]) > 4 || Math.abs(z - PERCH.c[2]) > 4 || y > 33 || y < 25) return 1e9;
  const d = sdRoundBox(x, y, z, PERCH_MIN, PERCH_MAX, 0.2);
  // rough sides, flat top (the archer stands on it)
  return d + 0.07 * noise3(x * 1.3, y * 1.3, z * 1.3) * (1 - smoothstep(PERCH.top - 0.4, PERCH.top - 0.1, y));
}
// ------------------------------------------------------------------ the runtime's terrain collider
// PrologueStage builds a Jolt height field over 512 m around the square with 256 samples per side
// (spacing 512/255 m) from World.heightAt (bilinear over cart/heightfield, a 4 m grid of the
// analytic height), dropping the samples inside EXIT_HOLE.samples; Jolt then drops every triangle
// touching a dropped sample. The triangles that survive near the mouth must stay out of the tunnel,
// so the cave's air is not allowed below them (a ledge along the wall instead of an invisible bump).
// Jolt's quad diagonal is not assumed: both splits are honoured.
export const RUNTIME_FIELD = { x0: 60 - 256, z0: -592 - 256, size: 512, samples: 256, hf: { x0: -900, z0: -900, step: 4 } };
const RF_STEP = RUNTIME_FIELD.size / (RUNTIME_FIELD.samples - 1);
const T = makeTerrain(buildRoute());
const hfCache = new Map();
function heightAtRuntime(x, z) {
  const { x0, z0, step } = RUNTIME_FIELD.hf;
  const fx = (x - x0) / step, fz = (z - z0) / step, i = Math.floor(fx), j = Math.floor(fz), u = fx - i, v = fz - j;
  const h = (a, b) => {
    const k = hkey(a, b);
    let y = hfCache.get(k);
    if (y === undefined) hfCache.set(k, (y = T.height(x0 + a * step, z0 + b * step)));
    return y;
  };
  return (h(i, j) * (1 - u) + h(i + 1, j) * u) * (1 - v) + (h(i, j + 1) * (1 - u) + h(i + 1, j + 1) * u) * v;
}
const rfDropped = (i, j) => inRect(EXIT_HOLE.samples, RUNTIME_FIELD.x0 + i * RF_STEP, RUNTIME_FIELD.z0 + j * RF_STEP);
/**
 * The runtime terrain collider's triangles over a rectangle, as they survive EXIT_HOLE: [[x, y, z] × 3],
 * both diagonals of every quad, all facing up.
 */
function runtimeFieldTris({ x0, x1, z0, z1 }) {
  const out = [];
  const P = (a, b) => [RUNTIME_FIELD.x0 + a * RF_STEP, 0, RUNTIME_FIELD.z0 + b * RF_STEP];
  const i0 = Math.floor((x0 - RUNTIME_FIELD.x0) / RF_STEP), i1 = Math.ceil((x1 - RUNTIME_FIELD.x0) / RF_STEP);
  const j0 = Math.floor((z0 - RUNTIME_FIELD.z0) / RF_STEP), j1 = Math.ceil((z1 - RUNTIME_FIELD.z0) / RF_STEP);
  for (let i = i0; i < i1; i++)
    for (let j = j0; j < j1; j++) {
      const c = [[i, j], [i + 1, j], [i, j + 1], [i + 1, j + 1]];
      const pt = c.map(([a, b]) => {
        const p = P(a, b);
        p[1] = heightAtRuntime(p[0], p[2]);
        return { p, d: rfDropped(a, b) };
      });
      const [c00, c10, c01, c11] = pt;
      for (const t of [[c00, c01, c11], [c00, c11, c10], [c00, c01, c10], [c10, c01, c11]]) if (!t.some((q) => q.d)) out.push(t.map((q) => q.p));
    }
  return out;
}
/** Surviving runtime collider triangles near the mouth. */
const RF_TRIS = runtimeFieldTris({ x0: -30, x1: -8, z0: -688, z1: -664 });
/** Highest surviving runtime collider surface at (x, z) near the mouth, or −Infinity. */
function runtimeColliderTop(x, z) {
  let best = -Infinity;
  for (const [a, b, c] of RF_TRIS) {
    const d = (b[2] - c[2]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[2] - c[2]);
    const l0 = ((b[2] - c[2]) * (x - c[0]) + (c[0] - b[0]) * (z - c[2])) / d, l1 = ((c[2] - a[2]) * (x - c[0]) + (a[0] - c[0]) * (z - c[2])) / d, l2 = 1 - l0 - l1;
    if (l0 < -1e-9 || l1 < -1e-9 || l2 < -1e-9) continue;
    best = Math.max(best, l0 * a[1] + l1 * b[1] + l2 * c[1]);
  }
  return best;
}
/**
 * Where surviving runtime collider triangles cross the lower tunnel near the mouth (the west wall
 * at z −677…−674.5): there the floor follows the terrain surface. Only surfaces less than 2.5 m above
 * a point fill it, so the tunnel never closes; validate() checks no surviving triangle is in the air.
 */
const nearMouthField = (x, z) => x > -24 && x < -19.5 && z > -678.5 && z < -673.5;

/** Cave air: v4 + chimney + noise, then the perch (rock), the drain junction (exact) and the runtime terrain collider. */
function air(x, y, z) {
  let d = airBase(x, y, z);
  if (d < 2.5) {
    const n = fbm3(x * 0.35, y * 0.35, z * 0.35) * 0.9 + noise3(x * 1.7, y * 1.7, z * 1.7) * 0.12;
    let amp = airBase(x, y - 0.6, z) > 0 ? 0.12 : 0.55;
    if (nearBreach(x, z)) amp *= 0.25 + 0.75 * smoothstep(0.5, 3, sdBox(x, y, z, BREACH.box.min, BREACH.box.max));
    d += n * amp;
  }
  d = Math.max(d, -perchSdf(x, y, z));
  if (nearBreach(x, z)) {
    d = Math.max(d, z - BREACH.tunnelZ);
    d = Math.min(d, sdBox(x, y, z, BREACH.box.min, BREACH.box.max));
  }
  if (d < 3 && nearMouthField(x, z)) {
    const top = runtimeColliderTop(x, z);
    if (top > -Infinity && top - y < 2.5) d = Math.max(d, Math.min(top + 0.03 - y, 2.5 - (top - y)));
  }
  return d;
}

// ------------------------------------------------------------------ terrain, outcrop, field S
/** analytic terrain height cached on a 1 m grid (bilinear) over the cave's extent */
const HG = { x0: -64, z0: -768, n: [140, 118], step: 1 };
const HGRID = new Float32Array(HG.n[0] * HG.n[1]);
for (let j = 0; j < HG.n[1]; j++) for (let i = 0; i < HG.n[0]; i++) HGRID[j * HG.n[0] + i] = T.height(HG.x0 + i * HG.step, HG.z0 + j * HG.step);
function Hc(x, z) {
  const fx = clamp((x - HG.x0) / HG.step, 0, HG.n[0] - 1.001), fz = clamp((z - HG.z0) / HG.step, 0, HG.n[1] - 1.001);
  const i = Math.floor(fx), j = Math.floor(fz), u = fx - i, v = fz - j, n = HG.n[0];
  const a = HGRID[j * n + i], b = HGRID[j * n + i + 1], c = HGRID[(j + 1) * n + i], d = HGRID[(j + 1) * n + i + 1];
  return lerp(lerp(a, b, u), lerp(c, d, u), v);
}
const HR_CACHE = new Map();
/** The render terrain's own surface (tools/gen/terrain.mjs): 2 m grid, same triangulation. */
function Hrender(x, z) {
  const sp = 2, i = Math.floor(x / sp), j = Math.floor(z / sp);
  const fx = x / sp - i, fz = z / sp - j;
  const h = (a, b) => {
    const k = hkey(a, b);
    let y = HR_CACHE.get(k);
    if (y === undefined) HR_CACHE.set(k, (y = T.height(a * sp, b * sp)));
    return y;
  };
  // grid origins are multiples of 200 m, so the parity of i + j matches terrain.mjs
  const odd = (((i + j) % 2) + 2) % 2 === 1;
  const h00 = h(i, j), h10 = h(i + 1, j), h01 = h(i, j + 1), h11 = h(i + 1, j + 1);
  if (odd) {
    // triangles (a, d, c) and (a, c, b): split along a–c, i.e. (0,0)–(1,1)
    return fx > fz ? h00 + (h10 - h00) * fx + (h11 - h10) * fz : h00 + (h11 - h01) * fx + (h01 - h00) * fz;
  }
  // triangles (a, d, b) and (b, d, c): split along b–d, i.e. (1,0)–(0,1)
  return fx + fz < 1 ? h00 + (h10 - h00) * fx + (h01 - h00) * fz : h11 + (h01 - h11) * (1 - fx) + (h10 - h11) * (1 - fz);
}
const ground = (x, y, z) => y - (Hc(x, z) - 0.5);
/** the outcrop skin's border runs at least this far under the render terrain (no crack between them) */
const SKIN_UNDER = 0.05;
const inOBox = (x, y, z) => x > OUTCROP.bbox.min[0] && x < OUTCROP.bbox.max[0] && y > OUTCROP.bbox.min[1] && y < OUTCROP.bbox.max[1] && z > OUTCROP.bbox.min[2] && z < OUTCROP.bbox.max[2];
/** 2D distance to a rectangle (negative inside), rounded by r */
function sdRect2(x, z, xr, zr, r = 0) {
  const dx = Math.abs(x - (xr[0] + xr[1]) / 2) - ((xr[1] - xr[0]) / 2 - r), dz = Math.abs(z - (zr[0] + zr[1]) / 2) - ((zr[1] - zr[0]) / 2 - r);
  return Math.hypot(Math.max(dx, 0), Math.max(dz, 0)) + Math.min(Math.max(dx, dz), 0) - r;
}
const PLAT = OUTCROP.platform;
function outcropRaw(x, y, z) {
  const O = OUTCROP;
  // a large lateral warp and a taper toward the foot keep the box from reading as one
  const wx = 1.3 * noise3(x * 0.09 + 3.1, y * 0.07, z * 0.09), wz = 1.3 * noise3(x * 0.09 + 17.7, y * 0.07, z * 0.09 + 5.3);
  const taper = 1 + 0.012 * Math.max(0, 52 - y);
  const bx = O.box.c[0] + (x + wx - O.box.c[0]) / taper, bz = O.box.c[2] + (z + wz - O.box.c[2]) / taper;
  const b = sdRoundBox(bx, y, bz, sub(O.box.c, O.box.half), add(O.box.c, O.box.half), O.box.r);
  const h = sdRoundBox(x, y, z, O.hood.min, O.hood.max, O.hood.r);
  const s = sdRoundBox(x, y, z, O.shoulder.min, O.shoulder.max, O.shoulder.r);
  const c = Math.max(sdRect2(x, z, O.cap.x, O.cap.z, O.cap.r), y - (Hc(x, z) + O.cap.lift), Hc(x, z) - 8 - y);
  return smin(smin(smin(b, h, 1.5), s, 1.2), c, 1.5);
}
/** The outcrop solid (negative inside), platform cut flat at PLAT.y. */
function outcrop(x, y, z) {
  let d = outcropRaw(x, y, z);
  if (d < 3) {
    d += OUTCROP.noise * (fbm3(x * 0.3 + 11.3, y * 0.3, z * 0.3 + 4.1) + 0.25 * noise3(x * 1.1, y * 1.1, z * 1.1));
    // bedding: shallow ledges across the faces
    d += 0.16 * Math.sin(y * 1.7 + x * 0.12 + 2.6 * noise3(x * 0.12, y * 0.05, z * 0.12));
  }
  const cut = Math.max(sdRect2(x, z, PLAT.x, PLAT.z), PLAT.y - y);
  return smax(d, -cut, 0.3);
}
/** fills the platform up to its top inside its rectangle */
const slab = (x, y, z) => Math.max(sdRect2(x, z, PLAT.x, PLAT.z), y - PLAT.y, PLAT.y - 8 - y);
const inSlabBox = (x, y, z) => x > PLAT.x[0] - 1 && x < PLAT.x[1] + 1 && z > PLAT.z[0] - 1 && z < PLAT.z[1] + 1 && y > PLAT.y - 9 && y < PLAT.y + 1;
/** The rock field: negative = rock, positive = air or open sky. */
function S(x, y, z) {
  const a = -air(x, y, z);
  let R = ground(x, y, z);
  if (inOBox(x, y, z)) R = Math.min(R, outcrop(x, y, z));
  let s = Math.max(R, a);
  if (inSlabBox(x, y, z)) s = Math.min(s, slab(x, y, z));
  return s;
}
/** Which term makes the surface at p: cave | outcrop | terrain. */
function surfaceClass(x, y, z) {
  const a = -air(x, y, z), g = ground(x, y, z), o = inOBox(x, y, z) ? outcrop(x, y, z) : Infinity;
  const sl = inSlabBox(x, y, z) ? slab(x, y, z) : Infinity;
  const R = Math.min(g, o), S1 = Math.max(R, a);
  if (sl < S1) return "outcrop";
  if (a >= R) return "cave";
  return o <= g ? "outcrop" : "terrain";
}
function gradS(x, y, z, e = 0.05) {
  return [S(x + e, y, z) - S(x - e, y, z), S(x, y + e, z) - S(x, y - e, z), S(x, y, z + e) - S(x, y, z - e)].map((v) => v / (2 * e));
}
/** Floor below (x, y0, z): first rock surface going down; null if y0 is in rock. */
function floorAt(x, z, y0, depth = 8) {
  if (S(x, y0, z) < 0) return null;
  let y = y0;
  while (S(x, y, z) > 0 && y > y0 - depth) y -= 0.05;
  if (S(x, y, z) > 0) return null;
  let lo = y, hi = y + 0.05;
  for (let i = 0; i < 8; i++) {
    const m = (lo + hi) / 2;
    if (S(x, m, z) > 0) hi = m;
    else lo = m;
  }
  return (lo + hi) / 2;
}
/** Clear height above a floor point (to the first rock), capped at `cap`. */
function clearAt(x, z, f, cap = 14) {
  let y = f + 0.3;
  while (S(x, y, z) > 0 && y < f + cap) y += 0.05;
  return y - f;
}
/** Bisect the rock/air boundary of the column between y `a` and `b` (S changes sign once). */
function bisectY(x, z, a, b) {
  const sa = S(x, a, z) > 0;
  for (let i = 0; i < 10; i++) {
    const m = (a + b) / 2;
    if (S(x, m, z) > 0 === sa) a = m;
    else b = m;
  }
  return (a + b) / 2;
}
/**
 * The air gaps of the vertical column at (x, z) between y0 and y1 (0.05 m steps, edges bisected):
 * [{lo, hi, h, openLo, openHi}], where openLo / openHi mark a gap the window cuts (no rock there).
 */
function airGaps(x, z, y0, y1) {
  const gaps = [];
  let start = null, prevY = y0, prevAir = false;
  for (let y = y0; y <= y1 + 1e-9; y += 0.05) {
    const isAir = S(x, y, z) > 0;
    if (isAir && !prevAir) start = y === y0 ? { y, open: true } : { y: bisectY(x, z, prevY, y), open: false };
    if (!isAir && prevAir) gaps.push({ lo: start.y, hi: bisectY(x, z, prevY, y), openLo: start.open, openHi: false });
    prevAir = isAir;
    prevY = y;
  }
  if (prevAir) gaps.push({ lo: start.y, hi: prevY, openLo: start.open, openHi: true });
  for (const g of gaps) g.h = g.hi - g.lo;
  return gaps;
}
/**
 * The walkable section of a tunnel at a centreline point: the largest vertical air gap of the column
 * from 2.5 m below the design floor to 2.5 m above its clear height (so a probe that starts in rock
 * still finds a low or offset passage, and a sealed one finds none). null when the column is solid.
 */
function columnAt(x, z, fy, h) {
  const y0 = fy - 2.5, y1 = fy + h + 2.5;
  let best = null;
  for (const g of airGaps(x, z, y0, y1)) if (!best || g.h > best.h) best = g;
  return best && { floor: best.lo, ceil: best.hi, clear: best.h, openBelow: best.openLo, openAbove: best.openHi, window: [y0, y1] };
}
/** Half-width at height y across the horizontal tangent (tx, tz): the nearer of the two walls. */
function halfWidthAt(x, y, z, tx, tz, cap = 8) {
  const reach = (dx, dz) => {
    let o = 0;
    while (o < cap && S(x + dx * o, y, z + dz * o) > 0) o += 0.05;
    return o;
  };
  const l = reach(-tz, tx), r = reach(tz, -tx);
  return { min: Math.min(l, r), left: l, right: r };
}

// ------------------------------------------------------------------ zones
/** Nearest tunnel segment to p (by distance to its axis at 1.5 m above the floor). */
function nearestSeg(x, y, z, only) {
  let best = null, bd = Infinity;
  const list = only ? SEGS.filter((s) => s.name === only) : segsNear(x, z).length ? segsNear(x, z).map((k) => SEGS[k]) : SEGS;
  for (const s of list) {
    const ax = s.a[0], ay = s.a[1] + 1.5, az = s.a[2], bx = s.b[0], by = s.b[1] + 1.5, bz = s.b[2];
    const dx = bx - ax, dy = by - ay, dz = bz - az, L2 = dx * dx + dy * dy + dz * dz || 1e-9;
    const t = clamp(((x - ax) * dx + (y - ay) * dy + (z - az) * dz) / L2, 0, 1);
    const d = Math.hypot(x - ax - dx * t, y - ay - dy * t, z - az - dz * t);
    if (d < bd) {
      bd = d;
      best = { seg: s, t, d, s: s.s0 + t * s.hl };
    }
  }
  return best;
}
let S_BEND = 86; // set from the anchor `bend` below
/** Zone of a cave point: chambers first, then the stream, then the nearest tunnel. */
function zoneOf(x, y, z) {
  if (nearBreach(x, z) && z > -692) return "A";
  if (Math.hypot(x - CHIMNEY.a[0], z - CHIMNEY.a[2]) < 4 && y > 30 && y < 43) return "B";
  for (const ch of CHAMBER_LIST) if (chamberK(x, y, z, ch) < 1.25) return ch.zone;
  if (x > 26 && x < 70 && z < -720 && z > -744 && y < 26.5) return "A";
  const n = nearestSeg(x, y, z);
  if (!n) return "A";
  const zone = TUNNEL_ZONE[n.seg.name];
  return zone === "D" && n.s >= S_BEND ? "E" : zone;
}
const ZONES = ["A", "B", "C", "D", "E"];
const ZONE_NEIGHBOURS = { A: ["B"], B: ["A", "C"], C: ["B", "D"], D: ["C", "E"], E: ["D"] };

// ------------------------------------------------------------------ surface nets (sparse)
const H = 0.5, BLK = 8;
function bounds() {
  let min = [1e9, 1e9, 1e9], max = [-1e9, -1e9, -1e9];
  const grow = (p, r) => {
    for (let k = 0; k < 3; k++) {
      min[k] = Math.min(min[k], p[k] - r);
      max[k] = Math.max(max[k], p[k] + r);
    }
  };
  for (const s of SEGS) {
    grow(s.a, 7);
    grow(s.b, 7);
  }
  for (const ch of CHAMBER_LIST) grow(ch.c, Math.max(...ch.r) + 3);
  grow(CHIMNEY.b, 4);
  grow(OUTCROP.bbox.min, 0);
  grow(OUTCROP.bbox.max, 0);
  return { min: min.map((v) => Math.floor(v / H) * H), max: max.map((v) => Math.ceil(v / H) * H) };
}
function extractSurface() {
  const { min, max } = bounds();
  const N = [0, 1, 2].map((k) => Math.round((max[k] - min[k]) / H) + 1);
  const total = N[0] * N[1] * N[2];
  const field = new Float32Array(total).fill(NaN);
  const vid = new Int32Array(total).fill(-2);
  const key = (i, j, k) => (k * N[1] + j) * N[0] + i;
  let evals = 0;
  const at = (i, j, k) => {
    const kk = key(i, j, k);
    let v = field[kk];
    if (v !== v) {
      v = S(min[0] + i * H, min[1] + j * H, min[2] + k * H);
      field[kk] = v;
      evals++;
    }
    return v;
  };
  const rb = BLK * H * 0.87 + 1.2;
  const active = [];
  let blocks = 0;
  for (let bk = 0; bk < N[2]; bk += BLK)
    for (let bj = 0; bj < N[1]; bj += BLK)
      for (let bi = 0; bi < N[0]; bi += BLK) {
        blocks++;
        const c = [min[0] + (bi + BLK / 2) * H, min[1] + (bj + BLK / 2) * H, min[2] + (bk + BLK / 2) * H];
        const o = OUTCROP.bbox;
        const nearOut = c[0] > o.min[0] - rb && c[0] < o.max[0] + rb && c[1] > o.min[1] - rb && c[1] < o.max[1] + rb && c[2] > o.min[2] - rb && c[2] < o.max[2] + rb;
        if (!nearOut && Math.abs(airBase(c[0], c[1], c[2])) > rb && !(nearBreach(c[0], c[2]) && Math.abs(c[1] - 33) < 6)) continue;
        active.push([bi, bj, bk]);
      }
  const pos = [], idx = [];
  const EDGES = [[0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7]];
  const C = [[0, 0, 0], [1, 0, 0], [0, 1, 0], [1, 1, 0], [0, 0, 1], [1, 0, 1], [0, 1, 1], [1, 1, 1]];
  const cellVertex = (i, j, k) => {
    if (i < 0 || j < 0 || k < 0 || i >= N[0] - 1 || j >= N[1] - 1 || k >= N[2] - 1) return -1;
    const kk = key(i, j, k);
    if (vid[kk] !== -2) return vid[kk];
    const v = C.map(([a, b, c]) => at(i + a, j + b, k + c));
    let sx = 0, sy = 0, sz = 0, n = 0;
    for (const [e0, e1] of EDGES) {
      if (v[e0] < 0 === v[e1] < 0) continue;
      const t = v[e0] / (v[e0] - v[e1]);
      sx += C[e0][0] + (C[e1][0] - C[e0][0]) * t;
      sy += C[e0][1] + (C[e1][1] - C[e0][1]) * t;
      sz += C[e0][2] + (C[e1][2] - C[e0][2]) * t;
      n++;
    }
    if (!n) {
      vid[kk] = -1;
      return -1;
    }
    const id = pos.length / 3;
    pos.push(min[0] + (i + sx / n) * H, min[1] + (j + sy / n) * H, min[2] + (k + sz / n) * H);
    vid[kk] = id;
    return id;
  };
  const AXES = [
    [[1, 0, 0], [[0, -1, -1], [0, 0, -1], [0, 0, 0], [0, -1, 0]]],
    [[0, 1, 0], [[-1, 0, -1], [-1, 0, 0], [0, 0, 0], [0, 0, -1]]],
    [[0, 0, 1], [[-1, -1, 0], [0, -1, 0], [0, 0, 0], [-1, 0, 0]]],
  ];
  for (const [bi, bj, bk] of active)
    for (let k = bk; k < Math.min(bk + BLK, N[2] - 1); k++)
      for (let j = bj; j < Math.min(bj + BLK, N[1] - 1); j++)
        for (let i = bi; i < Math.min(bi + BLK, N[0] - 1); i++) {
          if (i < 1 || j < 1 || k < 1) continue;
          const d0 = at(i, j, k);
          for (const [ax, cells] of AXES) {
            const d1 = at(i + ax[0], j + ax[1], k + ax[2]);
            if (d0 < 0 === d1 < 0) continue;
            const q = cells.map(([a, b, c]) => cellVertex(i + a, j + b, k + c));
            if (q.some((x) => x < 0)) continue;
            // S < 0 is rock: the face looks into the empty side (S > 0)
            if (d0 > 0) idx.push(q[0], q[2], q[1], q[0], q[3], q[2]);
            else idx.push(q[0], q[1], q[2], q[0], q[2], q[3]);
          }
        }
  return { pos, idx, stats: { grid: N, blocks, activeBlocks: active.length, evals } };
}

/** Project vertices onto S = 0, then normals (into the empty side) and SDF ambient occlusion. */
function shadeVertices(pos) {
  const nv = pos.length / 3;
  const nrm = new Float32Array(nv * 3), ao = new Float32Array(nv);
  for (let v = 0; v < nv; v++) {
    let x = pos[v * 3], y = pos[v * 3 + 1], z = pos[v * 3 + 2];
    for (let it = 0; it < 2; it++) {
      const d = S(x, y, z), g = gradS(x, y, z), gl2 = dot(g, g) || 1;
      let st = mul(g, -d / gl2);
      const sl = len(st);
      if (sl > 0.3) st = mul(st, 0.3 / sl);
      x += st[0];
      y += st[1];
      z += st[2];
    }
    pos[v * 3] = x;
    pos[v * 3 + 1] = y;
    pos[v * 3 + 2] = z;
    const n = norm(gradS(x, y, z));
    nrm.set(n, v * 3);
    ao[v] = aoAt([x, y, z], n);
  }
  return { nrm, ao };
}
/** 5 probes along the normal, 0.35 m apart (v4) */
function aoAt(p, n) {
  let occ = 0, w = 1;
  for (let i = 1; i <= 5; i++) {
    const h = i * 0.35;
    occ += w * Math.max(0, h - S(p[0] + n[0] * h, p[1] + n[1] * h, p[2] + n[2] * h));
    w *= 0.6;
  }
  return Math.max(0.25, 1 - occ * 0.9);
}

// ------------------------------------------------------------------ mesh helpers
/** Clip triangles at the drain plane z = BREACH.clipZ (keeps z ≤ clipZ near the breach). */
function clipBreach(pos, nrm, ao, idx, cls) {
  const P = [...pos], N = [...nrm], A = [...ao];
  const out = [], outCls = [];
  const cache = new Map();
  const zc = BREACH.clipZ;
  const edgeVertex = (i, j) => {
    const k = i < j ? `${i},${j}` : `${j},${i}`;
    if (cache.has(k)) return cache.get(k);
    const zi = P[i * 3 + 2], zj = P[j * 3 + 2], t = (zc - zi) / (zj - zi);
    const id = P.length / 3;
    for (let c = 0; c < 3; c++) P.push(lerp(P[i * 3 + c], P[j * 3 + c], t));
    P[id * 3 + 2] = zc;
    const n = norm([0, 1, 2].map((c) => lerp(N[i * 3 + c], N[j * 3 + c], t)));
    N.push(...n);
    A.push(lerp(A[i], A[j], t));
    cache.set(k, id);
    return id;
  };
  for (let t = 0; t < idx.length / 3; t++) {
    const tri = [idx[t * 3], idx[t * 3 + 1], idx[t * 3 + 2]];
    const near = nearBreach(P[tri[0] * 3], P[tri[0] * 3 + 2]);
    const inside = tri.map((v) => !near || P[v * 3 + 2] <= zc);
    const nIn = inside.filter(Boolean).length;
    if (nIn === 3) {
      out.push(...tri);
      outCls.push(cls[t]);
      continue;
    }
    if (nIn === 0) continue;
    // rotate so the polygon walk starts consistently; Sutherland–Hodgman against one plane
    const poly = [];
    for (let e = 0; e < 3; e++) {
      const a = tri[e], b = tri[(e + 1) % 3];
      if (inside[e]) poly.push(a);
      if (inside[e] !== inside[(e + 1) % 3]) poly.push(edgeVertex(a, b));
    }
    for (let k = 1; k < poly.length - 1; k++) {
      out.push(poly[0], poly[k], poly[k + 1]);
      outCls.push(cls[t]);
    }
  }
  return { pos: P, nrm: N, ao: A, idx: out, cls: outCls };
}
/** Keep only the listed triangles and compact the vertex arrays. */
function compact(pos, nrm, ao, idx, keepTri) {
  const map = new Int32Array(pos.length / 3).fill(-1);
  const P = [], Nn = [], A = [], I = [];
  for (let t = 0; t < idx.length / 3; t++) {
    if (!keepTri(t)) continue;
    for (let c = 0; c < 3; c++) {
      const v = idx[t * 3 + c];
      if (map[v] < 0) {
        map[v] = P.length / 3;
        P.push(pos[v * 3], pos[v * 3 + 1], pos[v * 3 + 2]);
        Nn.push(nrm[v * 3], nrm[v * 3 + 1], nrm[v * 3 + 2]);
        A.push(ao[v]);
      }
      I.push(map[v]);
    }
  }
  return { pos: P, nrm: Nn, ao: A, idx: I, map };
}

/** Render geometry builder: one per (node, material); vertices keyed so seams split cleanly. */
class Geo {
  constructor() {
    this.p = [];
    this.n = [];
    this.uv = [];
    this.c = [];
    this.i = [];
    this.keys = new Map();
  }
  get tris() {
    return this.i.length / 3;
  }
  vertex(p, n, uv, c, key) {
    if (key !== undefined && this.keys.has(key)) return this.keys.get(key);
    const id = this.p.length / 3;
    this.p.push(p[0], p[1], p[2]);
    this.n.push(n[0], n[1], n[2]);
    this.uv.push(uv[0], uv[1]);
    this.c.push(c[0], c[1], c[2], c[3] ?? 1);
    if (key !== undefined) this.keys.set(key, id);
    return id;
  }
  tri(a, b, c) {
    this.i.push(a, b, c);
  }
  geometry() {
    return { positions: new Float32Array(this.p), normals: new Float32Array(this.n), uvs: new Float32Array(this.uv), colors: new Float32Array(this.c), indices: this.i };
  }
}
/** Collider soup: positions + indices (world). */
class Col {
  constructor() {
    this.p = [];
    this.i = [];
  }
  get tris() {
    return this.i.length / 3;
  }
  tri(a, b, c) {
    const o = this.p.length / 3;
    this.p.push(...a, ...b, ...c);
    this.i.push(o, o + 1, o + 2);
  }
  quad(a, b, c, d) {
    this.tri(a, b, c);
    this.tri(a, c, d);
  }
  /** oriented box: centre, half extents, axes (unit vectors; the third is rebuilt so the faces point out) */
  box(c, h, ax = [[1, 0, 0], [0, 1, 0], [0, 0, 1]]) {
    ax = [ax[0], ax[1], cross(ax[0], ax[1])];
    const P = (sx, sy, sz) => add(c, add(add(mul(ax[0], sx * h[0]), mul(ax[1], sy * h[1])), mul(ax[2], sz * h[2])));
    const v = [P(-1, -1, -1), P(1, -1, -1), P(1, 1, -1), P(-1, 1, -1), P(-1, -1, 1), P(1, -1, 1), P(1, 1, 1), P(-1, 1, 1)];
    for (const [a, b, cc, d] of [[0, 3, 2, 1], [4, 5, 6, 7], [0, 1, 5, 4], [3, 7, 6, 2], [0, 4, 7, 3], [1, 2, 6, 5]]) this.quad(v[a], v[b], v[cc], v[d]);
  }
  geometry() {
    return { positions: new Float32Array(this.p), indices: this.i };
  }
}
/** Uniform-grid ray caster over collider triangles (vertical rays). */
class DownCaster {
  constructor(cols) {
    this.t = [];
    for (const c of cols) for (let k = 0; k < c.i.length; k += 3) this.t.push([0, 1, 2].map((j) => c.p.slice(c.i[k + j] * 3, c.i[k + j] * 3 + 3)));
    this.g = new Map();
    this.t.forEach((tri, n) => {
      const xs = tri.map((v) => v[0]), zs = tri.map((v) => v[2]);
      for (let i = Math.floor(Math.min(...xs)); i <= Math.floor(Math.max(...xs)); i++)
        for (let j = Math.floor(Math.min(...zs)); j <= Math.floor(Math.max(...zs)); j++) {
          const k = hkey(i, j);
          if (!this.g.has(k)) this.g.set(k, []);
          this.g.get(k).push(n);
        }
    });
  }
  /** heights of every collider surface at (x, z) (vertical line), sorted descending */
  hits(x, z) {
    const out = [];
    for (const n of this.g.get(hkey(Math.floor(x), Math.floor(z))) ?? []) {
      const [a, b, c] = this.t[n];
      const d = (b[2] - c[2]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[2] - c[2]);
      if (Math.abs(d) < 1e-12) continue;
      const l0 = ((b[2] - c[2]) * (x - c[0]) + (c[0] - b[0]) * (z - c[2])) / d, l1 = ((c[2] - a[2]) * (x - c[0]) + (a[0] - c[0]) * (z - c[2])) / d, l2 = 1 - l0 - l1;
      if (l0 < -1e-7 || l1 < -1e-7 || l2 < -1e-7) continue;
      out.push(l0 * a[1] + l1 * b[1] + l2 * c[1]);
    }
    return out.sort((p, q) => q - p);
  }
  /** first collider surface at or below y0 */
  down(x, z, y0) {
    for (const h of this.hits(x, z)) if (h <= y0 + 1e-6) return h;
    return null;
  }
  /** first collider surface above y0 */
  up(x, z, y0) {
    let best = null;
    for (const h of this.hits(x, z)) if (h > y0 && (best === null || h < best)) best = h;
    return best;
  }
}

// ------------------------------------------------------------------ texture coordinates
/** Wall projection axis for a cave point: across the tunnel direction, or radial in a chamber. */
function wallAxis(x, y, z, cls) {
  if (cls === "outcrop") return Math.abs(x - OUTCROP.box.c[0]) > Math.abs(z - OUTCROP.box.c[2]) ? "x" : "z";
  for (const ch of CHAMBER_LIST)
    if (chamberK(x, y, z, ch) < 1.25) return Math.abs(x - ch.c[0]) > Math.abs(z - ch.c[2]) ? "x" : "z";
  const n = nearestSeg(x, y, z);
  if (!n) return "z";
  const tx = Math.abs(n.seg.b[0] - n.seg.a[0]), tz = Math.abs(n.seg.b[2] - n.seg.a[2]);
  return tx >= tz ? "z" : "x";
}
/** box projection: UVs in texture repeats (glTF convention, v down) */
function projUV(p, axis, tile) {
  if (axis === "y") return [p[0] / tile, p[2] / tile];
  if (axis === "x") return [p[2] / tile, -p[1] / tile];
  return [p[0] / tile, -p[1] / tile];
}

// ------------------------------------------------------------------ the build
let BUILT = null;
/** Geometry, anchors and the validation report (pure: no files). Cached. */
export function buildCaveData({ log = () => {} } = {}) {
  if (BUILT) return BUILT;
  const t0 = performance.now();
  const errors = [], warnings = [];
  const ms = {};
  const lap = (k) => {
    ms[k] = Math.round(performance.now() - t0 - Object.values(ms).reduce((a, b) => a + b, 0));
  };

  // ---- anchors: the bend splits zones D and E
  {
    const n = nearestSeg(-21, 55, -680, "exit");
    S_BEND = n.s;
  }

  // ---- 1. surface
  const surf = extractSurface();
  lap("mesh");
  const { nrm, ao } = shadeVertices(surf.pos);
  lap("shade");
  const ntri0 = surf.idx.length / 3;
  const cls0 = new Array(ntri0);
  for (let t = 0; t < ntri0; t++) {
    const c = [0, 1, 2].map((k) => (surf.pos[surf.idx[t * 3] * 3 + k] + surf.pos[surf.idx[t * 3 + 1] * 3 + k] + surf.pos[surf.idx[t * 3 + 2] * 3 + k]) / 3);
    cls0[t] = surfaceClass(c[0], c[1], c[2]);
  }
  // no cave triangle may border a dropped terrain triangle: that would be a hole to the sky
  {
    const vc = new Map();
    for (let t = 0; t < ntri0; t++) for (let k = 0; k < 3; k++) {
      const v = surf.idx[t * 3 + k];
      vc.set(v, (vc.get(v) ?? 0) | (cls0[t] === "terrain" ? 1 : cls0[t] === "cave" ? 2 : 4));
    }
    let open = 0, at = null;
    for (const [v, m] of vc)
      if ((m & 3) === 3) {
        open++;
        at ??= [surf.pos[v * 3], surf.pos[v * 3 + 1], surf.pos[v * 3 + 2]].map(r2);
      }
    if (open) errors.push(`cave opens to the terrain surface at ${open} vertices (first at ${at}): the tunnel pierces the ground outside the outcrop`);
  }
  // the cave may meet the outcrop's outer skin only at the mouth
  const mouthPt = (() => {
    const q = tunnelAt("exit", TUNNEL_LEN.exit);
    return [q.x, PLAT.y + 1.5, q.z];
  })();
  {
    const vc = new Map();
    for (let t = 0; t < ntri0; t++) for (let k = 0; k < 3; k++) {
      const v = surf.idx[t * 3 + k];
      vc.set(v, (vc.get(v) ?? 0) | (cls0[t] === "outcrop" ? 1 : cls0[t] === "cave" ? 2 : 0));
    }
    let far = 0, at = null, maxD = 0;
    for (const [v, m] of vc) {
      if (m !== 3) continue;
      const p = [surf.pos[v * 3], surf.pos[v * 3 + 1], surf.pos[v * 3 + 2]];
      const dd = len(sub(p, mouthPt));
      maxD = Math.max(maxD, dd);
      if (dd > 7.5) {
        far++;
        at ??= p.map(r2);
      }
    }
    if (far) errors.push(`the cave opens through the outcrop away from the mouth at ${far} vertices (first at ${at})`);
  }
  // The ground term's surface lies 0.5 m under the render terrain, except at its crease with the
  // outcrop on a steep slope: surface nets put the crease vertex up to a cell off the true crease,
  // there up to 0.6 m above the render terrain, and the skin's border would hover over the terrain mesh
  // (a sliver crack into the rock at grazing angles). Ground triangles reaching above the render
  // terrain stay with the outcrop's skin, so its border runs under the terrain mesh everywhere
  // (checked below: no border vertex of the skin above the render terrain).
  let groundKept = 0;
  for (let t = 0; t < ntri0; t++) {
    if (cls0[t] !== "terrain") continue;
    const vs = [0, 1, 2].map((k) => surf.idx[t * 3 + k]);
    const c = [0, 1, 2].map((k) => (surf.pos[vs[0] * 3 + k] + surf.pos[vs[1] * 3 + k] + surf.pos[vs[2] * 3 + k]) / 3);
    if (!inOBox(c[0], c[1], c[2])) continue;
    if (vs.some((v) => surf.pos[v * 3 + 1] > Hrender(surf.pos[v * 3], surf.pos[v * 3 + 2]) - SKIN_UNDER)) {
      cls0[t] = "outcrop";
      groundKept++;
    }
  }
  const clipped = clipBreach(surf.pos, [...nrm], [...ao], surf.idx, cls0);
  const kept = compact(clipped.pos, clipped.nrm, clipped.ao, clipped.idx, (t) => clipped.cls[t] !== "terrain");
  const keptCls = clipped.cls.filter((c) => c !== "terrain");
  lap("classify");

  // ---- 2. checks on the full-resolution cave (design §4.3 validator)
  const raw = { vertices: kept.pos.length / 3, triangles: kept.idx.length / 3 };
  let minCover = Infinity, coverFails = 0, coverAt = null;
  {
    const caveV = new Uint8Array(kept.pos.length / 3);
    keptCls.forEach((c, t) => {
      if (c === "cave") for (let k = 0; k < 3; k++) caveV[kept.idx[t * 3 + k]] = 1;
    });
    for (let v = 0; v < caveV.length; v++) {
      if (!caveV[v]) continue;
      const x = kept.pos[v * 3], y = kept.pos[v * 3 + 1], z = kept.pos[v * 3 + 2];
      if (coverExempt(x, z)) continue;
      const cover = T.height(x, z) - y;
      if (cover < minCover) minCover = cover;
      if (cover < 1.5) {
        coverFails++;
        coverAt ??= [x, y, z].map(r2);
      }
    }
    if (coverFails) errors.push(`rock cover < 1.5 m at ${coverFails} vertices (first at ${coverAt}), min ${minCover.toFixed(2)}`);
  }
  let wrong = 0;
  for (let t = 0; t < kept.idx.length / 3; t++) {
    const [a, b, c] = [0, 1, 2].map((k) => kept.idx[t * 3 + k]);
    const P = (v) => [kept.pos[v * 3], kept.pos[v * 3 + 1], kept.pos[v * 3 + 2]];
    const fn = cross(sub(P(b), P(a)), sub(P(c), P(a)));
    const vn = [0, 1, 2].map((k) => kept.nrm[a * 3 + k] + kept.nrm[b * 3 + k] + kept.nrm[c * 3 + k]);
    if (dot(fn, vn) < 0) wrong++;
  }
  const wrongPct = (wrong / (kept.idx.length / 3)) * 100;
  if (wrongPct > 1) errors.push(`wrong-winding faces ${wrongPct.toFixed(2)} % (> 1 %)`);

  // ---- 3. simplification (joint), then split
  const P32 = new Float32Array(kept.pos), I32 = new Uint32Array(kept.idx);
  const tgt = (r) => Math.floor((I32.length * r) / 3) * 3;
  const [rIdx, rErr] = MeshoptSimplifier.simplify(I32, P32, 3, tgt(0.35), 0.01, ["LockBorder"]);
  const [cIdx, cErr] = MeshoptSimplifier.simplify(I32, P32, 3, tgt(0.12), 0.03, ["LockBorder"]);
  lap("simplify");

  const V = (v) => [kept.pos[v * 3], kept.pos[v * 3 + 1], kept.pos[v * 3 + 2]];
  const Nv = (v) => [kept.nrm[v * 3], kept.nrm[v * 3 + 1], kept.nrm[v * 3 + 2]];
  const centroid = (I, t) => mul(add(add(V(I[t * 3]), V(I[t * 3 + 1])), V(I[t * 3 + 2])), 1 / 3);
  // Only cave and outcrop triangles were kept; after simplification a skin triangle along the terrain
  // line can have its centroid on the ground's side, and it is still the outcrop's (not a cave zone's:
  // the cave meets the terrain nowhere, see above). The stub (the cave in front of the mouth plug)
  // ships with the outcrop too: group O, material cave_moss.
  const groupOf = (I, t) => {
    const c = centroid(I, t);
    if (surfaceClass(c[0], c[1], c[2]) !== "cave") return "O";
    return inStub(c) ? "O" : zoneOf(c[0], c[1], c[2]);
  };
  const isStub = (I, t) => {
    const c = centroid(I, t);
    return surfaceClass(c[0], c[1], c[2]) === "cave" && inStub(c);
  };
  // moss: the last 25 m of the climb (s along the exit spline), jittered so the change is ragged
  const exitLen = TUNNEL_LEN.exit;
  const mossy = (p) => {
    const n = nearestSeg(p[0], p[1], p[2], "exit");
    return n && n.d < 8 && n.s + 3 * noise3(p[0] * 0.4, p[1] * 0.4, p[2] * 0.4) > exitLen - 25;
  };
  const matOf = (I, t, group) => {
    if (group === "O") return isStub(I, t) ? "cave_moss" : "outcrop_rock";
    const c = centroid(I, t);
    const n = norm(add(add(Nv(I[t * 3]), Nv(I[t * 3 + 1])), Nv(I[t * 3 + 2])));
    if (group === "A" && c[1] < 24.8 && n[1] > 0.4 && channelInfo(c[0], c[2]).d < 4.5) return "cave_bed";
    if (n[1] >= FLOOR_NY) return "cave_floor";
    if ((group === "D" || group === "E") && mossy(c)) return "cave_moss";
    return "cave_rock";
  };
  const axisOf = (I, t, mat) => {
    const c = centroid(I, t);
    const n = norm(add(add(Nv(I[t * 3]), Nv(I[t * 3 + 1])), Nv(I[t * 3 + 2])));
    if (mat === "cave_floor" || mat === "cave_bed" || n[1] < -0.6 || n[1] > FLOOR_NY) return "y";
    // the region's axis keeps the mapping coherent along a tunnel; where it would run along the
    // face (stretching it), the face's own dominant axis takes over
    const ax = wallAxis(c[0], c[1], c[2], mat === "outcrop_rock" ? "outcrop" : "cave");
    if (ax === "z" && Math.abs(n[2]) < 0.4 && Math.abs(n[0]) > Math.abs(n[2])) return "x";
    if (ax === "x" && Math.abs(n[0]) < 0.4 && Math.abs(n[2]) > Math.abs(n[0])) return "z";
    return ax;
  };
  const nR = rIdx.length / 3;
  const rGroup = new Array(nR), rMat = new Array(nR), rAxis = new Array(nR);
  for (let t = 0; t < nR; t++) rGroup[t] = groupOf(rIdx, t);
  // one-triangle ring of the neighbours in every render mesh
  const vGroups = new Map();
  for (let t = 0; t < nR; t++) for (let k = 0; k < 3; k++) {
    const v = rIdx[t * 3 + k];
    if (!vGroups.has(v)) vGroups.set(v, new Set());
    vGroups.get(v).add(rGroup[t]);
  }
  // The outcrop ships with the town (segment muster) and binds only the moss set, which ships there
  // too: the stub (the cave in front of the mouth plug, now group O) is cave_moss, floor and wall; the
  // zone triangles that touch the outcrop (its ring) are moss too (cave_moss), and their copies in the
  // outcrop's ring bind outcrop_rock (same textures, tile and UVs).
  const MOSS_MATS = new Set(["cave_moss", "outcrop_rock"]);
  for (let t = 0; t < nR; t++) {
    rMat[t] = matOf(rIdx, t, rGroup[t]);
    if (rGroup[t] !== "O" && [0, 1, 2].some((k) => vGroups.get(rIdx[t * 3 + k]).has("O"))) rMat[t] = "cave_moss";
    rAxis[t] = axisOf(rIdx, t, rMat[t]);
  }
  const GROUPS = [...ZONES, "O"];
  const render = Object.fromEntries(GROUPS.map((g) => [g, {}]));
  const geoOf = (g, mat) => (render[g][mat] ??= new Geo());
  const variation = (p) => 0.93 + 0.07 * noise3(p[0] * 0.21 + 7, p[1] * 0.6, p[2] * 0.21);
  const wet = (p) => (p[1] < 26 && channelInfo(p[0], p[2]).d < 6 ? 0.82 : 1);
  const caveColor = (v) => {
    const p = V(v), a = kept.ao[v] * variation(p) * wet(p);
    return [a, a, a, 1];
  };
  const tileOf = (mat) => CAVE_TEX[MATS[mat].tex].tile;
  const emitTri = (g, t) => {
    const mat = g === "O" && rGroup[t] !== "O" ? "outcrop_rock" : rMat[t], axis = rAxis[t], geo = geoOf(g, mat), tile = tileOf(rMat[t]);
    if (g === "O" && !MOSS_MATS.has(rMat[t])) throw new Error(`cave: outcrop ring triangle ${t} has material ${rMat[t]} (the outcrop binds only the moss set)`);
    const ids = [0, 1, 2].map((k) => {
      const v = rIdx[t * 3 + k];
      return geo.vertex(V(v), Nv(v), projUV(V(v), axis, tile), caveColor(v), `${v}|${axis}`);
    });
    geo.tri(ids[0], ids[1], ids[2]);
  };
  const ringCount = Object.fromEntries(GROUPS.map((g) => [g, 0]));
  for (let t = 0; t < nR; t++) {
    const own = rGroup[t];
    emitTri(own, t);
    const also = new Set();
    for (let k = 0; k < 3; k++) for (const g of vGroups.get(rIdx[t * 3 + k])) if (g !== own) also.add(g);
    for (const g of also) {
      emitTri(g, t);
      ringCount[g]++;
    }
  }
  // colliders per group, with the same one-triangle ring: each mesh is quantised on its own, and a
  // millimetre crack at a zone seam would let a down-ray (place3) through exactly there
  const colliders = Object.fromEntries(GROUPS.map((g) => [g, new Col()]));
  {
    const nC = cIdx.length / 3, cGroup = new Array(nC), cv = new Map();
    for (let t = 0; t < nC; t++) {
      cGroup[t] = groupOf(cIdx, t);
      for (let k = 0; k < 3; k++) {
        const v = cIdx[t * 3 + k];
        if (!cv.has(v)) cv.set(v, new Set());
        cv.get(v).add(cGroup[t]);
      }
    }
    for (let t = 0; t < nC; t++) {
      const gs = new Set([cGroup[t]]);
      for (let k = 0; k < 3; k++) for (const g of cv.get(cIdx[t * 3 + k])) gs.add(g);
      for (const g of gs) colliders[g].tri(V(cIdx[t * 3]), V(cIdx[t * 3 + 1]), V(cIdx[t * 3 + 2]));
    }
  }
  lap("split");

  // ---- 4. explicit geometry
  const extra = {}; // node name → { geo: {mat: Geo}, col?: Col, group, note }
  const aoP = (p, n) => aoAt(p, n);
  /** a flat quad grid (a: corner, eu/ev: edge vectors) into a Geo with box-projected UVs */
  const gridQuad = (geo, a, eu, ev, nu, nv, { tile, axis, jitter, n: nIn, color } = {}) => {
    const n = nIn ?? norm(cross(eu, ev));
    const ids = [];
    for (let j = 0; j <= nv; j++)
      for (let i = 0; i <= nu; i++) {
        let p = add(a, add(mul(eu, i / nu), mul(ev, j / nv)));
        if (jitter) p = jitter(p, i, j, n);
        const shade = color ? color(p) : (() => {
          const q = aoP(p, n);
          return [q, q, q, 1];
        })();
        ids.push(geo.vertex(p, n, projUV(p, axis ?? (Math.abs(n[1]) > 0.7 ? "y" : Math.abs(n[0]) > Math.abs(n[2]) ? "x" : "z"), tile), shade));
      }
    for (let j = 0; j < nv; j++)
      for (let i = 0; i < nu; i++) {
        const a0 = ids[j * (nu + 1) + i], a1 = a0 + 1, b0 = a0 + nu + 1, b1 = b0 + 1;
        geo.tri(a0, a1, b1);
        geo.tri(a0, b1, b0);
      }
  };
  const addGeo = (group, mat) => geoOf(group, mat);

  // 4a. terraced exit stair: rock slabs on the SDF floor, one ramp collider through the tread middles
  const stair = (() => {
    const s0 = STAIR.s0, ds = 0.1;
    const prof = [];
    for (let s = s0 - 1; s <= exitLen + 0.01; s += ds) {
      const q = tunnelAt("exit", s);
      const rx = -q.tz, rz = q.tx; // right-hand normal (horizontal)
      const yc = floorAt(q.x, q.z, q.fy + 1.2);
      if (yc === null) continue;
      // floor half-widths at 0.4 m above the centre floor
      const reach = (sg) => {
        let o = 0;
        while (o < 6 && S(q.x + rx * sg * o, yc + 0.4, q.z + rz * sg * o) > 0) o += 0.05;
        return o;
      };
      const wl = reach(-1), wr = reach(1);
      let fmax = yc, fmin = yc;
      for (let o = -0.7 * wl; o <= 0.7 * wr; o += 0.25) {
        const f = floorAt(q.x + rx * o, q.z + rz * o, yc + 1.0, 3);
        if (f !== null) {
          fmax = Math.max(fmax, f);
          fmin = Math.min(fmin, f);
        }
      }
      prof.push({ s, x: q.x, z: q.z, tx: q.tx, tz: q.tz, rx, rz, yc, fmax, fmin, wl, wr });
    }
    // monotone floor envelope from s0
    let run = -Infinity;
    for (const p of prof) {
      if (p.s >= s0) run = Math.max(run, p.fmax);
      p.env = p.s >= s0 ? run : p.fmax;
    }
    const start = prof.find((p) => p.s >= s0);
    const y0 = start.env, yTop = PLAT.y;
    const K = Math.max(1, Math.round((yTop - y0) / STAIR.riser));
    const r = (yTop - y0) / K;
    const sigma = [start.s];
    for (let j = 1; j <= K; j++) {
      const target = y0 + j * r - 1e-4;
      const p = prof.find((q) => q.s >= s0 && q.env >= target);
      sigma.push(p ? p.s : prof[prof.length - 1].s);
    }
    const sEnd = sigma[K];
    const at = (s) => prof.reduce((b, p) => (Math.abs(p.s - s) < Math.abs(b.s - s) ? p : b), prof[0]);
    const slabs = [];
    for (let k = 1; k <= K; k++) {
      const sa = sigma[k - 1], sb = Math.max(sigma[k], sa + 0.2);
      const ext = k < K ? 0.3 : 0;
      const mid = at((sa + sb) / 2), pa = at(sa);
      const t = [mid.tx, 0, mid.tz], rr = [mid.rx, 0, mid.rz];
      // front edge centre at sa (on the spline), the slab runs along t to sb + ext
      const front = [pa.x, y0 + k * r, pa.z], L = sb - sa + ext;
      // its sides stand 0.6 m inside the rock along its whole (straight) length, curve or not
      let wl = 0, wr = 0;
      for (const p of prof.filter((q) => q.s >= sa - 0.05 && q.s <= sb + ext + 0.05)) {
        const lat = (o) => (p.x + p.rx * o - front[0]) * rr[0] + (p.z + p.rz * o - front[2]) * rr[2];
        wl = Math.max(wl, -lat(-p.wl), -lat(p.wr));
        wr = Math.max(wr, lat(p.wr), lat(-p.wl));
      }
      wl += 0.6;
      wr += 0.6;
      const top = y0 + k * r, bottom = Math.min(...prof.filter((p) => p.s >= sa - 0.2 && p.s <= sb + ext).map((p) => p.fmin), top - r) - 0.35;
      slabs.push({ k, sa, sb, top, bottom, front, t, r: rr, wl, wr, L, centre: add(front, mul(t, L / 2)) });
    }
    return { prof, y0, yTop, K, r, sigma, sEnd, slabs };
  })();
  if (stair.r > STAIR.maxRiser) errors.push(`stair riser ${stair.r.toFixed(3)} m > ${STAIR.maxRiser}`);
  for (const sl of stair.slabs) {
    // the slabs in front of the mouth plug ship with the outcrop (moss only there)
    const stub = inStub([sl.centre[0], sl.top, sl.centre[2]]);
    sl.group = stub ? "O" : zoneOf(sl.centre[0], sl.top + 1, sl.centre[2]);
    const group = sl.group;
    const tread = addGeo(group, stub ? "cave_moss" : "cave_floor"), riser = addGeo(group, stub || mossy(sl.centre) ? "cave_moss" : "cave_rock");
    const fl = add(sl.front, mul(sl.r, -sl.wl)), W = sl.wl + sl.wr;
    const nu = Math.max(2, Math.ceil(W / 0.4)), nv = Math.max(1, Math.ceil(sl.L / 0.4));
    gridQuad(tread, fl, mul(sl.r, W), mul(sl.t, sl.L), nu, nv, { tile: tileOf(stub ? "cave_moss" : "cave_floor"), axis: "y", n: [0, 1, 0] });
    // riser (faces −t), rough
    const h = sl.top - sl.bottom;
    const jitterR = (p, i, j) => (j === 0 || j === 2 ? p : add(p, mul(sl.t, 0.035 * noise3(p[0] * 2.3, p[1] * 2.3, p[2] * 2.3))));
    const rTile = tileOf(stub || mossy(sl.centre) ? "cave_moss" : "cave_rock");
    gridQuad(riser, add(fl, [0, -h, 0]), mul(sl.r, W), [0, h, 0], nu, 2, { tile: rTile, n: mul(sl.t, -1), jitter: jitterR });
    // sides (inside the walls)
    gridQuad(riser, add(fl, [0, -h, 0]), [0, h, 0], mul(sl.t, sl.L), 1, nv, { tile: rTile, n: mul(sl.r, -1) });
    gridQuad(riser, add(add(fl, mul(sl.r, W)), [0, -h, 0]), mul(sl.t, sl.L), [0, h, 0], nv, 1, { tile: rTile, n: sl.r });
    // back end (faces +t): inside the next slab, but the top slab's would be open toward the platform
    gridQuad(riser, add(add(add(fl, mul(sl.t, sl.L)), mul(sl.r, W)), [0, -h, 0]), mul(sl.r, -W), [0, h, 0], nu, 1, { tile: rTile, n: sl.t });
  }
  {
    let out = 0, at = null;
    for (const sl of stair.slabs) {
      const fl = add(sl.front, mul(sl.r, -sl.wl)), W = sl.wl + sl.wr;
      for (const u of [0, 0.25, 0.5, 0.75, 1])
        for (const v of [0, 0.5, 1]) {
          const p = add(add(fl, mul(sl.r, u * W)), mul(sl.t, v * sl.L));
          if (S(p[0], p[1] - 0.02, p[2]) > 0.02 && air(p[0], p[1] - 0.02, p[2]) > 0.02) {
            out++;
            at ??= p.map(r2);
          }
        }
    }
    if (out) errors.push(`stair slabs stick out of the rock at ${out} points (first at ${at})`);
  }
  // ramp collider: a height field on a 0.5 m grid (swept quads fold on the inside of the bend). Its
  // height at a point is the polyline through the tread middles at the point's arc length, so it
  // passes through every tread (±r/2) and stays above the rock floor; it reaches 0.5 m into the walls.
  {
    // it starts 1 m before the first riser just under the centre floor, so it rises out of the floor
    const first = stair.prof[0];
    const mids = [[first.s, first.yc - 0.05]];
    for (const sl of stair.slabs) mids.push([(sl.sa + sl.sb) / 2, sl.top]);
    mids.push([stair.sEnd + 0.8, stair.yTop]);
    const rampAt = (sv) => {
      if (sv <= mids[0][0]) return mids[0][1];
      for (let i = 0; i < mids.length - 1; i++) if (sv <= mids[i + 1][0]) return lerp(mids[i][1], mids[i + 1][1], (sv - mids[i][0]) / (mids[i + 1][0] - mids[i][0]));
      return mids[mids.length - 1][1];
    };
    const halfAt = (sv) => {
      const p = stair.prof.reduce((b, q) => (Math.abs(q.s - sv) < Math.abs(b.s - sv) ? q : b), stair.prof[0]);
      return Math.max(p.wl, p.wr) + 0.5;
    };
    // the exit spline's horizontal projection: arc length and distance of the nearest point
    const exitSegs = SEGS.filter((g) => g.name === "exit");
    const project = (x, z) => {
      let best = null;
      for (const g of exitSegs) {
        const dx = g.b[0] - g.a[0], dz = g.b[2] - g.a[2], L2 = dx * dx + dz * dz || 1e-9;
        const t = clamp(((x - g.a[0]) * dx + (z - g.a[2]) * dz) / L2, 0, 1);
        const d = Math.hypot(x - g.a[0] - dx * t, z - g.a[2] - dz * t);
        if (!best || d < best.d) best = { d, s: g.s0 + t * g.hl };
      }
      return best;
    };
    const s0 = first.s, s1 = stair.sEnd + 0.8;
    const inRamp = (x, z) => {
      const q = project(x, z);
      return q.s >= s0 && q.s <= s1 && q.d <= halfAt(q.s) ? q : null;
    };
    const xs = stair.prof.filter((p) => p.s >= s0 && p.s <= s1).flatMap((p) => [p.x - 5, p.x + 5]);
    const zs = stair.prof.filter((p) => p.s >= s0 && p.s <= s1).flatMap((p) => [p.z - 5, p.z + 5]);
    // a quarter cell off the round coordinates, so anchors on whole and half metres never sit on a grid vertex
    const g = 0.5, X0 = Math.floor(Math.min(...xs) / g) * g + 0.125, Z0 = Math.floor(Math.min(...zs) / g) * g + 0.125;
    const nx = Math.ceil((Math.max(...xs) - X0) / g), nz = Math.ceil((Math.max(...zs) - Z0) / g);
    const hgt = new Map();
    const H_ = (i, j) => {
      const k = i * 10000 + j;
      if (!hgt.has(k)) {
        const q = inRamp(X0 + i * g, Z0 + j * g);
        hgt.set(k, q ? rampAt(q.s) : null);
      }
      return hgt.get(k);
    };
    let cells = 0;
    for (let i = 0; i < nx; i++)
      for (let j = 0; j < nz; j++) {
        const h = [H_(i, j), H_(i + 1, j), H_(i, j + 1), H_(i + 1, j + 1)];
        if (h.some((v) => v === null)) continue;
        const P = (a, b, y) => [X0 + a * g, y, Z0 + b * g];
        const p00 = P(i, j, h[0]), p10 = P(i + 1, j, h[1]), p01 = P(i, j + 1, h[2]), p11 = P(i + 1, j + 1, h[3]);
        // every zone a corner touches gets the cell (no crack at the D/E seam), and the outcrop gets
        // the cells of the stub (in front of the mouth plug)
        const groups = new Set([p00, p10, p01, p11].map((p) => zoneOf(p[0], p[1] + 1, p[2])));
        if ([p00, p10, p01, p11].some((p) => inStub(p))) groups.add("O");
        for (const group of groups) {
          // counter-clockwise seen from above (+Y up, +Z toward the viewer): faces up
          colliders[group].tri(p00, p01, p11);
          colliders[group].tri(p00, p11, p10);
        }
        cells++;
      }
    stair.ramp = mids.map(([sv, y]) => ({ s: r2(sv), y: +y.toFixed(3) }));
    stair.rampCells = cells;
  }
  lap("stair");

  // 4b. perch steps (render) + one ramp collider through the tread middles. The ledge falls away
  // to the west (27.95 at the box, ~27.3 at the foot), so the flight is sized from the measured floor.
  const perchSteps = (() => {
    const st = PERCH.steps, x1 = PERCH.c[0] - PERCH.half[0];
    const z0 = st.z - st.width / 2, z1 = st.z + st.width / 2;
    const floorLine = (x) => {
      let f = -Infinity;
      for (const z of [z0 + 0.1, st.z, z1 - 0.1]) {
        const v = floorAt(x, z, 30);
        if (v !== null) f = Math.max(f, v);
      }
      return f;
    };
    let N = 5, r = 1, xFoot = 0, fFoot = 0;
    for (N = 5; N <= 10; N++) {
      xFoot = x1 - (N - 1) * st.tread;
      fFoot = floorLine(xFoot - 0.05);
      r = (PERCH.top - fFoot) / N;
      if (r <= 0.4) break;
    }
    const out = [];
    for (let k = 1; k < N; k++) {
      const xa = x1 - (N - k) * st.tread;
      let fl = Infinity;
      for (let x = xa; x <= x1; x += 0.1) fl = Math.min(fl, floorLine(x));
      out.push({ k, xa, xb: x1 + 0.2, top: fFoot + k * r, bottom: Math.min(fl, fFoot) - 0.4 });
    }
    return { rise: r, risers: N, z0, z1, steps: out, foot: [xFoot, fFoot, st.z], x1 };
  })();
  if (perchSteps.rise > 0.4) errors.push(`perch steps: riser ${perchSteps.rise.toFixed(3)} m > 0.4`);
  {
    const rock = addGeo("A", "cave_rock"), tread = addGeo("A", "cave_floor");
    const { z0, z1 } = perchSteps, T_ = PERCH.steps.tread;
    for (const s of perchSteps.steps) {
      const W = s.xb - s.xa, h = s.top - s.bottom;
      const jit = (p) => add(p, [0.03 * noise3(p[0] * 3, p[1] * 3, p[2] * 3), 0, 0]);
      gridQuad(tread, [s.xa, s.top, z1], [W, 0, 0], [0, 0, z0 - z1], 2, 2, { tile: tileOf("cave_floor"), axis: "y", n: [0, 1, 0] });
      gridQuad(rock, [s.xa, s.bottom, z1], [0, 0, z0 - z1], [0, h, 0], 2, 2, { tile: tileOf("cave_rock"), n: [-1, 0, 0], jitter: jit });
      gridQuad(rock, [s.xa, s.bottom, z0], [W, 0, 0], [0, h, 0], 2, 2, { tile: tileOf("cave_rock"), n: [0, 0, -1] });
      gridQuad(rock, [s.xb, s.bottom, z1], [-W, 0, 0], [0, h, 0], 2, 2, { tile: tileOf("cave_rock"), n: [0, 0, 1] });
    }
    const first = perchSteps.steps[0], last = perchSteps.steps[perchSteps.steps.length - 1];
    const m0 = [first.xa + T_ / 2, first.top], m1 = [last.xa + T_ / 2, last.top];
    const slope = (m1[1] - m0[1]) / (m1[0] - m0[0]);
    const fFoot = perchSteps.foot[1];
    const xFoot = m0[0] - (m0[1] - fFoot) / slope, xTop = m1[0] + (PERCH.top - m1[1]) / slope;
    perchSteps.ramp = { from: [+xFoot.toFixed(3), +fFoot.toFixed(3)], to: [+xTop.toFixed(3), PERCH.top], deg: (Math.atan(slope) * 180) / Math.PI };
    colliders.A.quad([xFoot, fFoot, z1 + 0.05], [xTop, PERCH.top, z1 + 0.05], [xTop, PERCH.top, z0 - 0.05], [xFoot, fFoot, z0 - 0.05]);
    if (perchSteps.ramp.deg > 45) errors.push(`perch ramp ${perchSteps.ramp.deg.toFixed(1)}° is steeper than 45°`);
  }

  // 4c. water ribbon (zone A, its own node)
  const water = new Geo();
  {
    const pts = catmull(STREAM, 0.5);
    // extend 2 m past both ends into the rock
    const e0 = norm(sub(pts[0], pts[1])), e1 = norm(sub(pts[pts.length - 1], pts[pts.length - 2]));
    const P = [[...add(pts[0].slice(0, 3), mul(e0, 2)), pts[0][3]], ...pts, [...add(pts[pts.length - 1].slice(0, 3), mul(e1, 2)), pts[pts.length - 1][3]]];
    let acc = 0;
    const total = P.slice(1).reduce((a, p, i) => a + Math.hypot(p[0] - P[i][0], p[2] - P[i][2]), 0);
    const across = 4;
    const rows = [];
    for (let i = 0; i < P.length; i++) {
      if (i) acc += Math.hypot(P[i][0] - P[i - 1][0], P[i][2] - P[i - 1][2]);
      const a = P[Math.max(0, i - 1)], b = P[Math.min(P.length - 1, i + 1)];
      const t = norm([b[0] - a[0], 0, b[2] - a[2]]), r = [-t[2], 0, t[0]];
      const hw = P[i][3] + WATER.widen + 0.2;
      const row = [];
      for (let j = 0; j <= across; j++) {
        const o = -hw + (2 * hw * j) / across;
        const p = [P[i][0] + r[0] * o, WATER.y, P[i][2] + r[2] * o];
        row.push(water.vertex(p, [0, 1, 0], [acc / 2, o / 2], [1, 1, 1, 1]));
        water.uv2 ??= [];
        water.uv2.push(acc / total, j / across);
      }
      rows.push(row);
    }
    for (let i = 0; i < rows.length - 1; i++)
      for (let j = 0; j < across; j++) {
        const a = rows[i][j], b = rows[i][j + 1], c = rows[i + 1][j + 1], d = rows[i + 1][j];
        // counter-clockwise seen from above (+Y): a → d → c and a → c → b depend on r's handedness
        water.tri(a, c, b);
        water.tri(a, d, c);
      }
    // make sure it faces up
    const [ia, ib, ic] = water.i;
    const pa = water.p.slice(ia * 3, ia * 3 + 3), pb = water.p.slice(ib * 3, ib * 3 + 3), pc = water.p.slice(ic * 3, ic * 3 + 3);
    if (cross(sub(pb, pa), sub(pc, pa))[1] < 0) for (let k = 0; k < water.i.length; k += 3) [water.i[k + 1], water.i[k + 2]] = [water.i[k + 2], water.i[k + 1]];
    water.flowLength = total;
  }
  extra.cave_water = { group: "A", geo: { cave_water: water }, note: "stream ribbon at y 23.7; TEXCOORD_0 = (arc length / 2, across / 2) m, TEXCOORD_1 = (0..1 along the flow, 0..1 across: foam at 0 and 1); no collider" };

  // 4d. web walls A and B: 3 stacked cards + one removable box collider each
  const section = (c, t, yFloor) => {
    const r = [-t[2], 0, t[0]];
    const reach = (dir, y) => {
      let o = 0;
      while (o < 8 && S(c[0] + dir[0] * o, y, c[2] + dir[2] * o) > 0) o += 0.05;
      return o;
    };
    let wl = 0, wr = 0;
    for (const dy of [0.3, 1.2, 2.2, 3.2]) {
      wl = Math.max(wl, reach(mul(r, -1), yFloor + dy));
      wr = Math.max(wr, reach(r, yFloor + dy));
    }
    const clear = clearAt(c[0], c[2], yFloor);
    return { r, wl, wr, clear };
  };
  const webs = {};
  const webGeo = new Geo();
  const atlasUV = (q, u, v) => {
    const [u0, v0, u1, v1] = WEB_UV[q];
    return [lerp(u0, u1, u), lerp(v0, v1, v)];
  };
  for (const [name, x, z, tunnel] of [["web_A", 27.0, -749.5, "toSpider"], ["web_B", 10.5, -749.2, "toDen"]]) {
    const n = nearestSeg(x, 29, z, tunnel);
    const t = norm([n.seg.b[0] - n.seg.a[0], 0, n.seg.b[2] - n.seg.a[2]]);
    const yF = floorAt(x, z, 30);
    const sec = section([x, yF, z], t, yF);
    const W = Math.max(4.4, sec.wl + sec.wr + 0.6), Hh = Math.max(3.6, sec.clear + 0.4);
    const mid = (sec.wr - sec.wl) / 2;
    const cards = new Geo();
    const R = rng(name === "web_A" ? 3 : 5);
    [-0.15, 0, 0.15].forEach((off, ci) => {
      const q = ci === 1 ? "orb" : "sheet";
      const base = add(add([x, yF - 0.15, z], mul(t, off)), mul(sec.r, mid - W / 2));
      const nu = 6, nv = 5, flip = ci === 2;
      const ids = [];
      for (let j = 0; j <= nv; j++)
        for (let i = 0; i <= nu; i++) {
          const u = i / nu, v = j / nv;
          const bulge = Math.sin(Math.PI * u) * Math.sin(Math.PI * v) * (0.08 + R() * 0.05) * (ci === 1 ? 1 : -1);
          const p = add(add(add(base, mul(sec.r, u * W)), [0, v * Hh, 0]), mul(t, bulge));
          ids.push(cards.vertex(p, t, atlasUV(q, flip ? 1 - u : u, 1 - v), [1, 1, 1, 1]));
        }
      for (let j = 0; j < nv; j++)
        for (let i = 0; i < nu; i++) {
          const a = ids[j * (nu + 1) + i], b = a + 1, c = a + nu + 2, d = a + nu + 1;
          cards.tri(a, b, c);
          cards.tri(a, c, d);
        }
    });
    const col = new Col();
    const centre = add(add([x, yF + Hh / 2 - 0.15, z], mul(sec.r, mid)), [0, 0, 0]);
    col.box(centre, [0.3, Hh / 2, W / 2 - 0.2], [t, [0, 1, 0], sec.r]);
    webs[name] = { centre: r3v(centre), normal: r3v(t), size: [r2(W), r2(Hh)], floor: r2(yF), section: { left: r2(sec.wl), right: r2(sec.wr), clear: r2(sec.clear) }, box: { centre: r3v(centre), half: [0.3, r2(Hh / 2), r2(W / 2 - 0.2)], axes: [r3v(t), [0, 1, 0], r3v(sec.r)] } };
    extra[name] = { group: "B", geo: { cave_web: cards }, col, colName: `${name}_col`, meshName: `${name}_cards`, note: `web wall: 3 cards ${W.toFixed(1)} × ${Hh.toFixed(1)} m, 0.15 m apart; ${name}_col is its removable box collider (tag ${name})` };
  }

  // 4e. corner webs in pockets of the spider chamber and its two doors
  const cornerWebs = [];
  {
    const R = rng(17);
    const cand = [];
    for (let v = 0; v < kept.pos.length / 3; v += 1) {
      const p = V(v);
      if (kept.ao[v] > 0.6) continue;
      const inSp = chamberK(p[0], p[1], p[2], CHAMBERS.spider) < 1.1;
      const nearDoor = Math.hypot(p[0] - 27, p[2] + 749.5) < 6 || Math.hypot(p[0] - 10.5, p[2] + 749.2) < 6;
      if (!inSp && !nearDoor) continue;
      const f = floorAt(p[0], p[2], p[1] - 0.3, 12);
      const hAbove = f === null ? 3 : p[1] - f;
      if (hAbove < 1.8 || hAbove > 6.5) continue;
      if (Math.hypot(p[0] - CHIMNEY.a[0], p[2] - CHIMNEY.a[2]) < 2.2) continue;
      cand.push(v);
    }
    for (let i = cand.length - 1; i > 0; i--) {
      const j = Math.floor(R() * (i + 1));
      [cand[i], cand[j]] = [cand[j], cand[i]];
    }
    for (const v of cand) {
      if (cornerWebs.length >= 16) break;
      const p = V(v), n = Nv(v);
      const c = add(p, mul(n, 0.45));
      if (cornerWebs.some((w) => len(sub(w.c, c)) < 2.6)) continue;
      const up = Math.abs(n[1]) > 0.9 ? [1, 0, 0] : [0, 1, 0];
      const e1 = norm(cross(up, n)), e2 = cross(n, e1);
      const hitsD = [];
      for (let k = 0; k < 8; k++) {
        const a = (k / 8) * Math.PI * 2, dir = add(mul(e1, Math.cos(a)), mul(e2, Math.sin(a)));
        let o = 0.1;
        while (o < 3 && S(c[0] + dir[0] * o, c[1] + dir[1] * o, c[2] + dir[2] * o) > 0) o += 0.05;
        if (o < 3) hitsD.push(o);
      }
      if (hitsD.length < 6) continue;
      hitsD.sort((a, b) => a - b);
      const half = clamp(hitsD[Math.floor(hitsD.length / 2)] * 1.15, 0.7, 2.0);
      const q = R() < 0.6 ? "orb" : "corner";
      const rot = R() * Math.PI * 2;
      const a1 = add(mul(e1, Math.cos(rot)), mul(e2, Math.sin(rot))), a2 = cross(n, a1);
      const ids = [];
      for (const [u, w] of [[0, 0], [1, 0], [1, 1], [0, 1]]) {
        const pp = add(c, add(mul(a1, (u * 2 - 1) * half), mul(a2, (w * 2 - 1) * half)));
        ids.push(webGeo.vertex(pp, n, atlasUV(q, u, w), [1, 1, 1, 1]));
      }
      webGeo.tri(ids[0], ids[1], ids[2]);
      webGeo.tri(ids[0], ids[2], ids[3]);
      cornerWebs.push({ c, half, q });
    }
    if (cornerWebs.length < 12) warnings.push(`only ${cornerWebs.length} corner webs found pockets (design 12–20)`);
  }
  extra.cave_webs = { group: "B", geo: { cave_web: webGeo }, note: `${cornerWebs.length} corner webs (alpha cards)` };

  // 4f. cocoons (capsules r 0.35, 1.2–1.8 m): the courier lies at `cocoon`; four hang from the ceiling
  const cocoonGeo = (geo, a, b, r, R) => {
    const axis = sub(b, a), L = len(axis), w = norm(axis);
    const u0 = Math.abs(w[1]) > 0.9 ? [1, 0, 0] : [0, 1, 0];
    const e1 = norm(cross(u0, w)), e2 = cross(w, e1);
    const seg = 12, rings = 12, ids = [];
    for (let j = 0; j <= rings; j++) {
      const v = j / rings, prof = Math.pow(Math.sin(Math.PI * clamp(v * 0.94 + 0.03, 0, 1)), 0.7);
      for (let i = 0; i <= seg; i++) {
        const ang = (i / seg) * Math.PI * 2;
        const d = add(mul(e1, Math.cos(ang)), mul(e2, Math.sin(ang)));
        const bump = 1 + 0.08 * noise3(ang * 1.5 + R * 10, v * 6, R * 3);
        const p = add(add(a, mul(axis, v)), mul(d, r * prof * bump));
        const n = norm(add(d, mul(w, Math.cos(Math.PI * v) * 0.6)));
        const q = aoP(p, n);
        ids.push(geo.vertex(p, n, atlasUV("cocoon", i / seg, v), [0.55 + 0.45 * q, 0.55 + 0.45 * q, 0.55 + 0.45 * q, 1]));
      }
    }
    for (let j = 0; j < rings; j++)
      for (let i = 0; i < seg; i++) {
        const p0 = ids[j * (seg + 1) + i], p1 = p0 + 1, q0 = p0 + seg + 1, q1 = q0 + 1;
        geo.tri(p0, q0, q1);
        geo.tri(p0, q1, p1);
      }
    return L;
  };
  const cocoons = [];
  const courier = new Geo(), hanging = new Geo();
  {
    // courier: lying along the wall next to the anchor
    const cx = 22, cz = -754, f = floorAt(cx, cz, 29.8);
    const toC = norm([CHAMBERS.spider.c[0] - cx, 0, CHAMBERS.spider.c[2] - cz]), along = [-toC[2], 0, toC[0]];
    const r = 0.38, half = 0.9;
    const a = add([cx, f + r, cz], mul(along, -half)), b = add(add([cx, f + r + 0.18, cz], mul(along, half)), [0, 0, 0]);
    cocoonGeo(courier, a, b, r, 1);
    cocoons.push({ name: "cocoon_courier", a: r3v(a), b: r3v(b), r });
    const col = new Col();
    col.box(mul(add(a, b), 0.5), [half + 0.1, r, r], [along, [0, 1, 0], toC]);
    extra.cocoon_courier = { group: "B", geo: { cave_cocoon: courier }, col, colName: "cocoon_courier_col", meshName: "cocoon_courier_mesh", note: "the courier's cocoon at anchor `cocoon` (hold E): hide or replace when cut open; _col is a box" };
    // hanging cocoons: ceiling points of the chamber, away from the chimney and the courier
    const R = rng(23);
    const cands = [];
    for (let i = 0; i < 400 && cands.length < 4; i++) {
      const ang = R() * Math.PI * 2, rr = 3 + R() * 4;
      const x = CHAMBERS.spider.c[0] + Math.cos(ang) * rr, z = CHAMBERS.spider.c[2] + Math.sin(ang) * rr * 0.75;
      if (Math.hypot(x - CHIMNEY.a[0], z - CHIMNEY.a[2]) < 3 || Math.hypot(x - cx, z - cz) < 3) continue;
      if (cands.some((c) => Math.hypot(c[0] - x, c[2] - z) < 2.5)) continue;
      const f0 = floorAt(x, z, 30.5);
      if (f0 === null) continue;
      const cl = clearAt(x, z, f0);
      if (cl < 4.5 || cl > 9) continue;
      cands.push([x, f0 + cl, z, f0]);
    }
    cands.forEach(([x, top, z, f0], i) => {
      const L = 1.2 + R() * 0.5;
      const a = [x, top + 0.25, z], b = [x + (R() - 0.5) * 0.3, top + 0.25 - L, z + (R() - 0.5) * 0.3];
      cocoonGeo(hanging, a, b, 0.3 + R() * 0.08, 2 + i);
      cocoons.push({ name: `hanging_${i + 1}`, a: r3v(a), b: r3v(b), floor: r2(f0) });
    });
  }
  extra.cave_cocoons = { group: "B", geo: { cave_cocoon: hanging }, note: `${cocoons.length - 1} hanging cocoons` };

  // 4g. egg sacs (teal, emissive) along the wall by burrow_s
  const eggs = new Geo();
  const eggList = [];
  {
    const bx = 21, bz = -755, f = floorAt(bx, bz, 29.8);
    // the nearest wall direction from the burrow
    let best = null;
    for (let k = 0; k < 16; k++) {
      const a = (k / 16) * Math.PI * 2, d = [Math.cos(a), 0, Math.sin(a)];
      let o = 0;
      while (o < 5 && S(bx + d[0] * o, f + 0.4, bz + d[2] * o) > 0) o += 0.05;
      if (!best || o < best.o) best = { d, o };
    }
    const along = [-best.d[2], 0, best.d[0]];
    const R = rng(31);
    for (let i = 0; i < 7; i++) {
      const s = (i - 3) * 0.55 + (R() - 0.5) * 0.2;
      if (Math.abs(s) < 0.5) continue; // keep the burrow mouth clear
      const r = 0.2 + R() * 0.15;
      const base = add([bx, f, bz], add(mul(best.d, Math.max(0.4, best.o - r * 0.6)), mul(along, s)));
      const fy = floorAt(base[0], base[2], f + 1.2) ?? f;
      const c = [base[0], fy + r * 0.8, base[2]];
      const ids = [];
      const seg = 10, rings = 7;
      for (let j = 0; j <= rings; j++)
        for (let k = 0; k <= seg; k++) {
          const th = (j / rings) * Math.PI, ph = (k / seg) * Math.PI * 2;
          const n = [Math.sin(th) * Math.cos(ph), Math.cos(th), Math.sin(th) * Math.sin(ph)];
          const p = add(c, [n[0] * r, n[1] * r * 1.15, n[2] * r]);
          ids.push(eggs.vertex(p, n, [k / seg, j / rings], [1, 1, 1, 1]));
        }
      for (let j = 0; j < rings; j++)
        for (let k = 0; k < seg; k++) {
          const a = ids[j * (seg + 1) + k], b = a + 1, cc = a + seg + 2, d = a + seg + 1;
          eggs.tri(a, b, cc);
          eggs.tri(a, cc, d);
        }
      eggList.push({ c: r3v(c), r: r2(r) });
    }
  }
  extra.cave_eggs = { group: "B", geo: { cave_eggsac: eggs }, note: `${eggList.length} glowing egg sacs by burrow_s (emissive teal)` };

  // 4h. the den's daylight fissure: an emissive slot on the ceiling (cosmetic)
  const fissure = new Geo();
  let fissureInfo;
  {
    const c = CHAMBERS.den.c, yaw = CHAMBERS.den.yaw;
    const ax = [Math.cos(yaw), 0, -Math.sin(yaw)], bx = [-ax[2], 0, ax[0]];
    let low = Infinity;
    for (let i = -3; i <= 3; i += 0.5)
      for (let j = -0.6; j <= 0.6; j += 0.3) {
        const p = add(add([c[0], 0, c[2]], mul(ax, i)), mul(bx, j));
        const f = floorAt(p[0], p[2], 35);
        if (f !== null) low = Math.min(low, f + clearAt(p[0], p[2], f));
      }
    const y = low - 0.04;
    const corners = [[-3, -0.6], [3, -0.6], [3, 0.6], [-3, 0.6]].map(([i, j]) => add(add([c[0], y, c[2]], mul(ax, i)), mul(bx, j)));
    const ids = corners.map((p, k) => fissure.vertex(p, [0, -1, 0], [k === 1 || k === 2 ? 1 : 0, k >= 2 ? 1 : 0], [1, 1, 1, 1]));
    fissure.tri(ids[0], ids[2], ids[1]);
    fissure.tri(ids[0], ids[3], ids[2]);
    fissureInfo = { centre: r3v([c[0], y, c[2]]), size: [6, 1.2], yaw: r2(yawOf(ax[0], ax[2])) };
  }
  extra.den_fissure = { group: "C", geo: { cave_fissure: fissure }, note: "daylight fissure: emissive card on the den ceiling (pair it with the spot light anchor light_den_fissure)" };

  // 4i. outcrop: rails and the mouth plug
  const rails = new Col();
  for (const w of Object.values(OUTCROP.rails.walls)) {
    const d = sub([w.b[0], 0, w.b[1]], [w.a[0], 0, w.a[1]]), L = len(d), t = norm(d), side = [-t[2], 0, t[0]];
    const th = w.t ?? OUTCROP.rails.t, off = ((w.side ?? 0) * th) / 2;
    const c = add([(w.a[0] + w.b[0]) / 2, (w.y[0] + w.y[1]) / 2, (w.a[1] + w.b[1]) / 2], mul(side, off));
    rails.box(c, [L / 2 + 0.15, (w.y[1] - w.y[0]) / 2, th / 2], [t, [0, 1, 0], side]);
  }
  extra.outcrop_rails_col = { group: "O", col: rails, colOnly: true, note: "the deck's invisible enclosure: rails along the S and E edges and walls on the shoulder's face and above the mouth, up to y 66 (outcrop.rails)" };
  const plug = new Geo();
  let plugInfo;
  {
    const q = tunnelAt("exit", exitLen - MOUTH.plugDepth), t = [q.tx, 0, q.tz];
    const f = floorAt(q.x, q.z, q.fy + 1.5);
    const sec = section([q.x, f, q.z], t, f);
    const W = sec.wl + sec.wr + 1.2, Hh = sec.clear + 0.8, mid = (sec.wr - sec.wl) / 2;
    const base = add(add([q.x, f - 0.4, q.z], mul(sec.r, mid - W / 2)), [0, 0, 0]);
    const ids = [[0, 0], [1, 0], [1, 1], [0, 1]].map(([u, v]) => plug.vertex(add(add(base, mul(sec.r, u * W)), [0, v * Hh, 0]), t, [u, v], [0, 0, 0, 1]));
    // faces +t (out of the mouth, toward the platform)
    const fn = cross(sub(plug.p.slice(3, 6), plug.p.slice(0, 3)), sub(plug.p.slice(9, 12), plug.p.slice(0, 3)));
    if (dot(fn, t) > 0) {
      plug.tri(ids[0], ids[1], ids[2]);
      plug.tri(ids[0], ids[2], ids[3]);
    } else {
      plug.tri(ids[0], ids[2], ids[1]);
      plug.tri(ids[0], ids[3], ids[2]);
    }
    const col = new Col();
    const cc = add(base, add(mul(sec.r, W / 2), [0, Hh / 2, 0]));
    col.box(cc, [0.2, Hh / 2, W / 2], [t, [0, 1, 0], sec.r]);
    plugInfo = { centre: r3v(cc), normal: r3v(t), size: [r2(W), r2(Hh)], box: { centre: r3v(cc), half: [0.2, r2(Hh / 2), r2(W / 2)], axes: [r3v(t), [0, 1, 0], r3v(sec.r)] } };
    extra.outcrop_mouth_plug = { group: "O", geo: { outcrop_plug: plug }, col, colName: "outcrop_mouth_plug_col", meshName: "outcrop_mouth_plug_mesh", note: `black card + box ${MOUTH.plugDepth} m inside the mouth (the stub in front of it is in outcrop_rock / outcrop_col); hide both once cave/mesh is shown` };
  }
  lap("dressing");

  // ---- 5. anchors (floors probed from the field, then dropped onto the colliders)
  const allCols = [...Object.values(colliders)];
  const caster = new DownCaster(allCols);
  const anchors = {};
  const onStair = (x, z) => {
    const n = nearestSeg(x, 50, z, "exit");
    return n && n.d < 6 && n.s >= STAIR.s0 - 0.7 && n.s <= stair.sEnd + 0.9;
  };
  const moved = {};
  const A = (name, x, z, o = {}) => {
    const yHint = o.yHint ?? 60;
    let f = o.y ?? null;
    let sdf = null, clear = null;
    if (o.y === undefined) {
      sdf = floorAt(x, z, yHint, 12);
      // a design point inside the rock: walk it toward `nudge` until it stands in the open
      if ((sdf === null || clearAt(x, z, sdf) < 2) && o.nudge) {
        const from = [x, z];
        for (let k = 1; k <= 12 && (sdf === null || clearAt(x, z, sdf) < 2); k++) {
          const d = norm([o.nudge[0] - from[0], 0, o.nudge[1] - from[1]]);
          x = +(from[0] + d[0] * 0.25 * k).toFixed(2);
          z = +(from[1] + d[2] * 0.25 * k).toFixed(2);
          sdf = floorAt(x, z, yHint, 12);
        }
        moved[name] = { from, to: [x, z] };
      }
      if (sdf === null) {
        errors.push(`anchor ${name} (${x}, ${z}): no floor below y ${yHint} (in rock)`);
        return;
      }
      clear = clearAt(x, z, sdf);
      const col = caster.down(x, z, sdf + 1.0);
      // on the terraced stair the collider is the ramp through the tread middles, above the rock floor
      const ok = col !== null && (onStair(x, z) ? col - sdf > -0.2 && col - sdf < 0.8 : Math.abs(col - sdf) < 0.45);
      f = ok ? col : sdf;
      if (!ok && !o.noCollider) errors.push(`anchor ${name}: no collider within 0.45 m of the floor ${sdf.toFixed(2)} (got ${col?.toFixed(2)})`);
    }
    const a = { kind: o.kind ?? "mark", pos: [x, +f.toFixed(3), z], zone: o.zone ?? zoneOf(x, f + 1, z) };
    if (sdf !== null) a.sdfFloor = +sdf.toFixed(3);
    if (clear !== null) a.clear = r2(clear);
    if (o.yaw !== undefined) a.yaw = +o.yaw.toFixed(4);
    if (o.faces) {
      a.yaw = +yawOf(o.faces[0] - x, o.faces[1] - z).toFixed(4);
      a.faces = o.faceName;
    }
    if (o.use) a.use = o.use;
    if (o.companion) a.companion = o.companion;
    if (o.minClear && clear !== null && clear < o.minClear) errors.push(`anchor ${name}: clear ${clear.toFixed(2)} m < ${o.minClear}`);
    anchors[name] = a;
    return a;
  };
  const FIRE = [53.5, -724.0], DEN_CP = [-16.5, -729];
  A("breach", 54, -688.5, { yHint: 34, kind: "cp", use: "drain/J junction (keep CP6); in the keep's drain passage, so its floor is the keep's", noCollider: true });
  A("ramp_foot", 54, -697, { yHint: 32 });
  A("cp_gallery", 51.0, -714, { yHint: 30.5, kind: "cp", yaw: -0.25, use: "keep CP7", minClear: 3 });
  A("comp_gallery", 52.2, -713.0, { yHint: 30.5, use: "companion at CP7" });
  A("gal_entry_mouth", 49.5, -721.5, { yHint: 29.2, use: "where the K12 pursuers enter" });
  A("camp_fire", ...FIRE, { yHint: 29.2, kind: "prop", use: "ph/stone_fire_pit + FireFx 0.5" });
  A("sitA", 52.0, -722.8, { yHint: 29.2, faces: FIRE, faceName: "camp_fire", use: "E4 enemy A sits (GroundSit_Idle_Loop)" });
  A("standB", 54.0, -725.5, { yHint: 29.2, faces: FIRE, faceName: "camp_fire", use: "E4 enemy B stands (Idle_Tired_Loop)" });
  A("interrog_body", 51.0, -724.8, { yHint: 29.2, use: "imperial bluff outcome: the interrogator's body" });
  A("perch", 55.0, -727.6, { yHint: 31.4, faces: [49.5, -721.5], faceName: "gal_entry_mouth", use: "E4 archer on the shelf top" });
  A("perch_foot", +(perchSteps.foot[0] - 0.5).toFixed(2), PERCH.steps.z, { yHint: 29.2, yaw: -Math.PI / 2, use: "foot of the perch steps (climb east)" });
  A("lever", 44, -725, { yHint: 29.2, kind: "prop", use: "procprops lever; handle 0.32 m in front of the puller at 1.6 m" });
  A("lever_stance", 44, -724, { yHint: 29.2, kind: "cp", yaw: 0, use: "keep CP8; the puller stands here facing −Z" });
  A("comp_lever", 45.5, -723.5, { yHint: 29.2, use: "companion at CP8" });
  A("winch", 44.8, -725.8, { yHint: 29.2, kind: "prop", use: "procprops winch; chain to the deck tip" });
  A("bridge_n", 48, -726.5, { yHint: 29.2, use: "north end of the drawbridge gap (z −727.5…−735.5)" });
  A("bridge_s", 48, -736.5, { yHint: 29.2, use: "south end of the gap" });
  A("bridge_hinge", 48, -735.6, { y: 27.0, kind: "prop", use: "drawbridge hinge (deck 8.8 × 1.8 × 0.25)" });
  A("slab_drop", 48, -731.5, { y: 34.8, kind: "prop", use: "slab release point above mid-span" });
  A("gal_s_cp", 47.5, -738.5, { yHint: 29.0, kind: "cp", yaw: 0.2, use: "keep end / exit CP0" });
  A("comp_s", 49.2, -739.0, { yHint: 29.0, use: "companion at exit CP0" });
  A("web_A", 27.0, -749.5, { yHint: 29.6, use: "web wall A (east door of the spider chamber)" });
  A("cp_spider", 31.5, -749.0, { yHint: 29.6, kind: "cp", yaw: 1.57, use: "exit CP1" });
  A("comp_spider", 33.0, -748.5, { yHint: 29.6, use: "companion at exit CP1" });
  A("spider_c", 18, -750, { yHint: 29.7, use: "spider chamber centre; the chimney is above" });
  A("burrow_n", 15, -745.5, { yHint: 29.8, kind: "spawn", use: "small spider spawn" });
  A("burrow_s", 21, -755, { yHint: 29.8, kind: "spawn", use: "small spider spawn" });
  A("cocoon", 22, -754, { yHint: 29.8, kind: "use", use: "courier cocoon + letter (hold E)" });
  A("web_B", 10.5, -749.2, { yHint: 29.8, use: "web wall B (west door)" });
  A("cp_spider_done", 12, -749.5, { yHint: 29.8, kind: "cp", yaw: 1.57, use: "exit CP2" });
  A("comp_spider_done", 13.5, -749.0, { yHint: 29.8, use: "companion at exit CP2" });
  A("cp_den", ...DEN_CP, { yHint: 33.2, kind: "cp", yaw: 2.45, use: "exit CP3" });
  A("comp_den", -15.5, -730.2, { yHint: 33.2, use: "companion at exit CP3" });
  A("wolf_bed", -22, -718, { yHint: 34.5, faces: DEN_CP, faceName: "cp_den", use: "wolf asleep, facing cp_den" });
  A("satchel", -20.5, -716.5, { yHint: 34.7, kind: "use", use: "optional satchel, 2.1 m from the wolf" });
  A("den_centre", -24, -720, { yHint: 34.7 });
  [[-24.5, -721.0], [-26.8, -715.5], [-23.5, -712.8]].forEach(([x, z], i) => A(`bones_${i + 1}`, x, z, { yHint: 34.7, kind: "prop", nudge: [-24, -720], use: "procprops bones; stepping on them is a noise (+0.35)" }));
  A("cp_climb", -28, -709, { yHint: 35.0, kind: "cp", yaw: 2.7, use: "exit CP4" });
  A("comp_climb", -27.0, -711.0, { yHint: 35.0, use: "companion at exit CP4" });
  A("climb_s23", -33, -699, { yHint: 37.5, use: "wolf leash limit on the climb" });
  A("climb_mid", -46, -681, { yHint: 42.0, use: "wind bed starts (amb_cave_wind)" });
  A("cp_light", -25, -684, { yHint: 52.0, use: "stair start; setOutdoorVisible(true)" });
  A("bend", -21, -680, { yHint: 54.8, use: "the tight final bend; exposure bloom; zones D/E" });
  A("stub84", -21.9, -681.3, { yHint: 54.2, use: "fallback white-out point (cut #6)" });
  A("balcony_mouth", -17.5, -673.5, { yHint: 57.2, use: "the mouth onto the platform" });
  A("platform", PLAT.centre[0], PLAT.centre[2], { yHint: 57.5, kind: "cp", yaw: -1.68, use: "exit CP5; vista eye at +1.65 m (−15.0, 57.7, −670.5)" });
  A("comp_platform", -17.6, -672.0, { yHint: 57.5, use: "companion on the platform" });
  A("vista_eye", -15.0, -670.5, { y: 57.7, kind: "camera", use: "vista eye (design §4.4)" });
  A("chimney_mouth", CHIMNEY.a[0], CHIMNEY.a[2], { y: CHIMNEY.a[1], kind: "mark", zone: "B", use: "where the chimney opens into the chamber ceiling (the giant spider drops from here on silk)" });
  A("chimney_top", CHIMNEY.b[0], CHIMNEY.b[2], { y: CHIMNEY.b[1], kind: "mark", zone: "B", use: "top of the chimney shaft (dead end, dark)" });
  for (let y = CHIMNEY.a[1]; y <= CHIMNEY.b[1]; y += 0.25) if (S(CHIMNEY.a[0], y, CHIMNEY.a[2]) < 0.3) errors.push(`chimney blocked at y ${y.toFixed(2)}`);
  const den_path = [[-19, -726], [-25.5, -723.5], [-27.5, -718], [-27, -712.5]].map(([x, z], i) => A(`den_path_${i + 1}`, x, z, { yHint: 34.7, use: "den sneak path" })?.pos);
  // closest approach of the den path to the wolf
  let denMin = Infinity;
  for (let i = 0; i < den_path.length - 1; i++)
    for (let t = 0; t <= 1; t += 0.02) {
      const p = add(den_path[i], mul(sub(den_path[i + 1], den_path[i]), t));
      denMin = Math.min(denMin, Math.hypot(p[0] - anchors.wolf_bed.pos[0], p[2] - anchors.wolf_bed.pos[2]));
    }
  if (denMin < 5.0) errors.push(`den path passes ${denMin.toFixed(2)} m from the wolf (design 5.5)`);
  lap("anchors");

  // ---- 6. walkability along the tunnels (design §4.3 validator), sampled every 0.5 m
  // Every centreline sample must stand in a walkable section: its column has an air gap (the largest
  // in a window around the design floor; none = sealed) with a floor (open below = a hole), clearance
  // ≥ 2.6 m, half-width ≥ 0.9 m across the tangent (the nearer wall, at 1.2 m above the floor), a
  // collider on the floor and head room ≥ 2.2 m over it. Only the gallery chasm and the keep's drain
  // passage are exempt (inChasm, inDrainPass). Lines 1 m to either side are checked for colliders and
  // steps where they stand in the open (they may run into the wall). The walk path (every 2 m) is
  // what paths.walk ships; the connectivity check below chains the samples from breach to the mouth.
  const walk = {};
  const walkStats = { samples: 0, maxUp: 0, maxDown: 0, maxDev: 0, minHead: Infinity };
  const probes = { minClear: Infinity, minHalfW: Infinity, at: null, halfAt: null, maxSlope: {} };
  /** centreline samples per tunnel: {s, x, z, status: ok | chasm | drain | sealed | hole | low | narrow | nocollider, floor?, col?} */
  const centre = {};
  for (const name of Object.keys(TUNNELS))
    for (const off of [0, -1, 1]) {
      if (!off) {
        walk[name] = [];
        centre[name] = [];
      }
      let prev = null;
      for (let k = 0; k * 0.5 <= TUNNEL_LEN[name] + 1e-6; k++) {
        const s = k * 0.5;
        const q0 = tunnelAt(name, s);
        const q = { ...q0, x: q0.x - q0.tz * off, z: q0.z + q0.tx * off };
        const rec = { s, x: r2(q.x), z: r2(q.z), status: "ok" };
        if (!off) centre[name].push(rec);
        if (inChasm(q.x, q.z) || inDrainPass(name, q.z)) {
          rec.status = inChasm(q.x, q.z) ? "chasm" : "drain";
          prev = null;
          continue;
        }
        const c = columnAt(q.x, q.z, q.fy, q.h);
        if (off) {
          if (!c || c.openBelow || c.clear < 2.0) {
            prev = null;
            continue;
          }
        } else {
          if (!c || c.openBelow) {
            rec.status = c ? "hole" : "sealed";
            prev = null;
            continue;
          }
          rec.floor = +c.floor.toFixed(3);
          rec.clear = r2(c.clear);
          // design §4.3 limits on the field (the keep's 2.6 m drain box is exempt from clearance)
          const inDrain = q.x > BREACH.box.min[0] - 0.3 && q.x < BREACH.box.max[0] + 0.3 && q.z > BREACH.box.min[2] - 0.6;
          if (!inDrain) {
            if (c.clear < probes.minClear) {
              probes.minClear = c.clear;
              probes.at = [name, s, r2(q.x), r2(c.floor), r2(q.z)];
            }
            if (c.clear < 2.6) rec.status = "low";
          }
          const hw = halfWidthAt(q.x, c.floor + 1.2, q.z, q.tx, q.tz, 4);
          rec.halfWidth = r2(hw.min);
          if (hw.min < probes.minHalfW) {
            probes.minHalfW = hw.min;
            probes.halfAt = [name, s, r2(q.x), r2(q.z), r2(hw.left), r2(hw.right)];
          }
          if (hw.min < 0.9 && rec.status === "ok") rec.status = "narrow";
        }
        const sdf = c.floor;
        const col = caster.down(q.x, q.z, sdf + 1.0);
        walkStats.samples++;
        const where = `walk ${name}${off ? (off < 0 ? " left" : " right") : ""} s ${s.toFixed(1)} (${q.x.toFixed(1)}, ${q.z.toFixed(1)})`;
        if (col === null) {
          errors.push(`${where}: no collider under the floor ${sdf.toFixed(2)}`);
          if (!off) rec.status = "nocollider";
          prev = null;
          continue;
        }
        if (!off) rec.col = +col.toFixed(3);
        const dev = Math.abs(col - sdf);
        const inStair = name === "exit" && s >= STAIR.s0 - 1.1 && s <= stair.sEnd + 0.9;
        if (!inStair) walkStats.maxDev = Math.max(walkStats.maxDev, dev);
        if (!inStair && dev > 0.3) errors.push(`${where}: collider ${col.toFixed(2)} is ${dev.toFixed(2)} m off the floor ${sdf.toFixed(2)}`);
        if (inStair && (col < sdf - 0.05 || col > sdf + 0.75)) errors.push(`${where}: stair ramp ${col.toFixed(2)} vs rock floor ${sdf.toFixed(2)}`);
        const head = caster.up(q.x, q.z, col + 0.05);
        // rock overhead everywhere but the last 1.5 m before the mouth (an opening to the sky otherwise)
        if (head === null && !(name === "exit" && s > TUNNEL_LEN.exit - 1.5)) errors.push(`${where}: no ceiling above the floor`);
        if (head !== null) walkStats.minHead = Math.min(walkStats.minHead, head - col);
        if (head !== null && head - col < 2.2) errors.push(`${where}: head room ${(head - col).toFixed(2)} m`);
        if (prev !== null) {
          const dy = col - prev;
          walkStats.maxUp = Math.max(walkStats.maxUp, dy);
          walkStats.maxDown = Math.max(walkStats.maxDown, -dy);
          if (dy > 0.45 || -dy > 0.5) errors.push(`${where}: step ${dy.toFixed(2)} m between samples 0.5 m apart`);
        }
        prev = col;
        if (!off && k % 4 === 0) walk[name].push([r2(q.x), +col.toFixed(3), r2(q.z)]);
      }
    }
  if (probes.minClear < 2.6) errors.push(`clearance ${probes.minClear.toFixed(2)} m < 2.6 (first minimum at ${probes.at})`);
  if (probes.minHalfW < 0.9) errors.push(`half-width ${probes.minHalfW.toFixed(2)} m < 0.9 across the tunnel at ${probes.halfAt} (tunnel, s, x, z, left, right)`);
  // connectivity: breach → entry → (chasm) → toSpider → toDen → exit → balcony_mouth. The chain of
  // centreline samples may break only for the drain passage at its very start and for one chasm run
  // between the gallery banks; every other run of failed samples is an error (a sealed or low section,
  // a hole, a pinch, a missing collider). Tunnels must meet end to start, and the chain ends at the mouth.
  const connectivity = { samples: 0, breaks: [], chasm: null };
  {
    const ORDER = ["entry", "toSpider", "toDen", "exit"];
    const chain = ORDER.flatMap((n) => centre[n].map((c) => ({ ...c, name: n })));
    connectivity.samples = chain.length;
    let i = 0, chasmRuns = 0;
    while (i < chain.length) {
      if (chain[i].status === "ok") {
        i++;
        continue;
      }
      let j = i;
      while (j < chain.length && chain[j].status !== "ok") j++;
      const run = chain.slice(i, j), kinds = new Set(run.map((c) => c.status));
      const span = `${run[0].name} s ${run[0].s}…${run[run.length - 1].name === run[0].name ? "" : run[run.length - 1].name + " s "}${run[run.length - 1].s}`;
      const before = chain[i - 1], after = chain[j];
      if (i === 0 && kinds.size === 1 && kinds.has("drain")) {
        // the drain passage: the breach anchor stands in it, the first cave sample right after it
        const b = anchors.breach?.pos;
        if (!after || !b || Math.hypot(after.x - b[0], after.z - b[2]) > 1.0) connectivity.breaks.push(`the walk does not start at the breach (first cave sample ${after ? [after.x, after.z] : "none"})`);
      } else if (kinds.size === 1 && kinds.has("chasm") && before && after) {
        chasmRuns++;
        // the gap may only span the chasm: from bank to bank, every point between them over the water
        const d = Math.hypot(after.x - before.x, after.z - before.z);
        let dry = 0;
        for (let t = 0.05; t < 0.95; t += 0.05) if (!inChasm(lerp(before.x, after.x, t), lerp(before.z, after.z, t))) dry++;
        connectivity.chasm = { from: [before.name, before.s, before.x, before.z], to: [after.name, after.s, after.x, after.z], span: r2(d) };
        if (d > 12 || dry > 2) connectivity.breaks.push(`the chasm gap ${span} is ${d.toFixed(1)} m and leaves the water at ${dry} points`);
      } else {
        const count = [...kinds].map((k) => `${k} ×${run.filter((c) => c.status === k).length}`).join(", ");
        connectivity.breaks.push(`${span} (${count}; first at ${run[0].x}, ${run[0].z})`);
      }
      i = j;
    }
    if (chasmRuns !== 1) connectivity.breaks.push(`expected one chasm crossing between the gallery banks, found ${chasmRuns}`);
    // tunnels meet end to start (on the centreline, within a sample spacing, with a walkable step)
    for (let n = 0; n < ORDER.length - 1; n++) {
      const a = centre[ORDER[n]].at(-1), b = centre[ORDER[n + 1]][0];
      if (a.status === "chasm" && b.status === "chasm") continue;
      if (a.status !== "ok" || b.status !== "ok" || Math.hypot(a.x - b.x, a.z - b.z) > 0.75 || Math.abs(a.col - b.col) > 0.45)
        connectivity.breaks.push(`${ORDER[n]} does not join ${ORDER[n + 1]} (${a.status} ${[a.x, a.col, a.z]} → ${b.status} ${[b.x, b.col, b.z]})`);
    }
    const last = centre.exit.at(-1), mouth = anchors.balcony_mouth?.pos;
    if (last.status !== "ok" || TUNNEL_LEN.exit - last.s > 0.5 || !mouth || Math.hypot(last.x - mouth[0], last.z - mouth[2]) > 1.0)
      connectivity.breaks.push(`the walk does not reach balcony_mouth (last sample ${last.status} at ${[last.x, last.z]}, s ${last.s} of ${TUNNEL_LEN.exit.toFixed(1)})`);
    for (const b of connectivity.breaks) errors.push(`walk path breach → balcony_mouth broken: ${b}`);
  }
  lap("walk");

  // ---- 7. design §4.3 slope probe (1 m along each tunnel, on the field floors of the walk samples)
  for (const name of Object.keys(TUNNELS)) {
    let prev = null, maxSlope = 0, slopeAt = null;
    for (const c of centre[name]) {
      if (c.s % 1 !== 0) continue;
      if (c.floor === undefined) {
        prev = null;
        continue;
      }
      const treated = name === "exit" && c.s >= STAIR.s0 - 0.5;
      if (prev && !treated) {
        const sl = (Math.atan2(Math.abs(c.floor - prev.floor), Math.hypot(c.x - prev.x, c.z - prev.z)) * 180) / Math.PI;
        if (sl > maxSlope) {
          maxSlope = sl;
          slopeAt = [c.x, c.z];
        }
      }
      prev = c;
    }
    probes.maxSlope[name] = { deg: +maxSlope.toFixed(1), at: slopeAt };
    if (maxSlope > 35) errors.push(`untreated floor slope ${maxSlope.toFixed(1)}° > 35° on ${name} at ${slopeAt}`);
  }
  lap("probes");

  // ---- 8. joins: the terrain hole, the drain mouth, the platform
  const hole = { piercePts: 0, outsideRender: 0, runtimeColliderIntrusions: 0, uncovered: 0, bbox: null };
  {
    const R = EXIT_HOLE.render;
    let bb = null;
    for (let x = -32; x <= -4; x += 0.25)
      for (let z = -692; z <= -658; z += 0.25) {
        const hr = Hrender(x, z);
        const inside = inRect(R, x, z);
        // the tunnel must not cut through the render terrain outside the hole
        if (air(x, hr, z) < 0.05 || air(x, Hc(x, z), z) < 0.05) {
          hole.piercePts++;
          bb = bb ? [Math.min(bb[0], x), Math.max(bb[1], x), Math.min(bb[2], z), Math.max(bb[3], z)] : [x, x, z, z];
          if (!inside) hole.outsideRender++;
        }
        // inside the hole the terrain mesh is gone: the outcrop must cover it
        if (inside && outcrop(x, hr + 0.2, z) > -0.02) hole.uncovered++;
      }
    // the runtime's height-field triangles that survive the hole stay out of the tunnel's air
    for (const t of RF_TRIS)
      for (let a = 0; a <= 1; a += 0.125)
        for (let b = 0; a + b <= 1 + 1e-9; b += 0.125) {
          const p = [0, 1, 2].map((k) => t[0][k] * (1 - a - b) + t[1][k] * a + t[2][k] * b);
          if (air(p[0], p[1], p[2]) < -0.01) hole.runtimeColliderIntrusions++;
        }
    hole.bbox = bb && bb.map(r2);
    if (hole.outsideRender) errors.push(`the tunnel cuts the terrain outside EXIT_HOLE.render at ${hole.outsideRender} points (pierce bbox x ${hole.bbox?.[0]}…${hole.bbox?.[1]}, z ${hole.bbox?.[2]}…${hole.bbox?.[3]})`);
    if (hole.runtimeColliderIntrusions) errors.push(`the runtime terrain collider reaches into the tunnel at ${hole.runtimeColliderIntrusions} points`);
    if (hole.uncovered) errors.push(`EXIT_HOLE is not covered by the outcrop at ${hole.uncovered} points`);
  }
  // the outcrop skin's own border (where the dropped ground triangles were) runs under the render
  // terrain: the skin and the terrain mesh close the outcrop without a crack. Border edges of the
  // simplified group-O triangles; vertices shared with a cave zone (the mouth) are seams, not borders.
  const skinBorder = { vertices: 0, above: 0, maxAboveTerrain: -Infinity, groundKept };
  {
    const ec = new Map();
    for (let t = 0; t < nR; t++) {
      if (rGroup[t] !== "O") continue;
      for (let e = 0; e < 3; e++) {
        const a = rIdx[t * 3 + e], b = rIdx[t * 3 + ((e + 1) % 3)], k = a < b ? a * 1e7 + b : b * 1e7 + a;
        ec.set(k, (ec.get(k) ?? 0) + 1);
      }
    }
    const seen = new Set();
    let at = null;
    for (const [k, n] of ec) {
      if (n !== 1) continue;
      for (const v of [Math.floor(k / 1e7), k % 1e7]) {
        if (seen.has(v) || vGroups.get(v).size > 1) continue;
        seen.add(v);
        const p = V(v), d = p[1] - Hrender(p[0], p[2]);
        skinBorder.maxAboveTerrain = Math.max(skinBorder.maxAboveTerrain, d);
        if (d > -SKIN_UNDER + 0.01) {
          skinBorder.above++;
          at ??= p.map(r2);
        }
      }
    }
    skinBorder.vertices = seen.size;
    skinBorder.maxAboveTerrain = r2(skinBorder.maxAboveTerrain);
    if (skinBorder.above) errors.push(`the outcrop skin's border is not under the render terrain at ${skinBorder.above} of ${seen.size} vertices (first at ${at}, worst ${skinBorder.maxAboveTerrain} m above): a crack between the skin and the terrain mesh`);
  }
  // the drawbridge (procprops): deck 8.8 × 1.8 m hinged at (48, 27.0, −735.6) swings from lowered
  // (0°, tip at z −726.8) to raised (60°, tip ≈ y 34.6); broken, its south 5.2 m hangs at −35°; the
  // slab (2.4 × 1.0 × 1.8) drops from (48, 34.8, −731.5). All of that must be in the air.
  const bridge = { minGap: Infinity, crown: null };
  {
    const hinge = [48, 27.0, -735.6], Ld = 8.8;
    const free = (p) => S(p[0], p[1], p[2]);
    for (let a = 0; a <= 60.01; a += 5) {
      const r = (a * Math.PI) / 180;
      for (const f of [0.35, 0.6, 0.8, 1]) for (const dx of [-0.9, 0, 0.9]) {
        if (a === 0 && f === 1) continue; // lowered: the tip rests on the north ledge
        const p = [hinge[0] + dx, hinge[1] + 0.15 + Ld * f * Math.sin(r), hinge[2] + Ld * f * Math.cos(r)];
        bridge.minGap = Math.min(bridge.minGap, free(p));
      }
    }
    for (const f of [0.4, 0.7, 1]) for (const dx of [-0.9, 0, 0.9]) {
      const r = (-35 * Math.PI) / 180;
      bridge.minGap = Math.min(bridge.minGap, free([hinge[0] + dx, hinge[1] + 5.2 * f * Math.sin(r), hinge[2] + 5.2 * f * Math.cos(r)]));
    }
    // the slab breaks out of the dome: its top may touch the rock, its centre and below may not
    for (const dy of [0, -2, -5]) for (const dx of [-1.2, 1.2]) for (const dz of [-0.9, 0.9]) bridge.minGap = Math.min(bridge.minGap, free([48 + dx, 34.8 + dy, -731.5 + dz]));
    const f0 = floorAt(48, -731.2, 30);
    bridge.crown = f0 === null ? null : r2(f0 + clearAt(48, -731.2, f0, 20));
    if (bridge.minGap < 0.1) errors.push(`drawbridge / slab envelope touches the rock (clearance ${bridge.minGap.toFixed(2)} m)`);
    if (bridge.crown !== null && bridge.crown < 35.2) errors.push(`gallery crown over the raised deck is ${bridge.crown} (< 35.2)`);
  }
  // the vista (design §4.4) from the platform eye stays clear of the outcrop: hood, shoulder and lip
  const vista = {};
  {
    const eye = [PLAT.centre[0], PLAT.y + 1.65, PLAT.centre[2]];
    const targets = { keep_top: [60, 52.7, -662], square: [60, 39.5, -592], tower: [90, 52, -584], inn: [101, 46, -584] };
    for (const [k, tp] of Object.entries(targets)) {
      const d = sub(tp, eye), L = len(d), u = mul(d, 1 / L);
      let minS = Infinity;
      for (let t = 0.5; t < 18; t += 0.1) {
        const p = add(eye, mul(u, t));
        minS = Math.min(minS, S(p[0], p[1], p[2]), p[1] - Hrender(p[0], p[2]));
      }
      // where the line leaves the deck (the boulder lip must stay out of the way there)
      let edge = null;
      for (let t = 0; t < 20 && !edge; t += 0.05) {
        const p = add(eye, mul(u, t));
        if (sdRect2(p[0], p[2], PLAT.x, PLAT.z) > 0) edge = { at: [r2(p[0]), r2(p[1]), r2(p[2])], aboveDeck: r2(p[1] - PLAT.y) };
      }
      vista[k] = { target: tp, distance: +L.toFixed(1), yaw: +yawOf(d[0], d[2]).toFixed(2), clearance: r2(minS), leavesDeck: edge };
      if (minS < 0.15) errors.push(`vista to ${k} is blocked within 18 m of the eye (clearance ${minS.toFixed(2)})`);
    }
  }
  // boulder-lip suggestions on the S and E edges, standing on the rock, away from the view corridor
  const lip = [];
  {
    const corridor = Object.values(vista).map((v) => v.leavesDeck?.at).filter(Boolean);
    for (const [x, z] of [[-18.4, -666.5], [-16.2, -666.3], [-14.0, -666.4], [-10.4, -672.4], [-10.6, -674.3]]) {
      const near = Math.min(...corridor.map((c) => Math.hypot(c[0] - x, c[2] - z)));
      if (near < 1.5) {
        warnings.push(`lip prop (${x}, ${z}) is ${near.toFixed(2)} m from the view corridor; skipped`);
        continue;
      }
      const f = floorAt(x, z, PLAT.y + 2.5, 6);
      lip.push({ pos: [x, f === null ? PLAT.y - 0.3 : +(f - 0.15).toFixed(2), z], corridor: r2(near) });
    }
  }
  // no scatter may stand in the outcrop: its whole skin lies inside a scatter exclusion (1 m margin)
  {
    let outside = 0, far = 0;
    const geo = render.O.outcrop_rock;
    for (let k = 0; geo && k < geo.p.length; k += 3) {
      const x = geo.p[k], z = geo.p[k + 2];
      const dd = Math.min(...SCATTER_EXCLUDE.map((e) => Math.hypot(x - e.x, z - e.z) - e.r));
      far = Math.max(far, dd);
      if (dd > -1) outside++;
    }
    if (outside) errors.push(`${outside} outcrop vertices lie within 1 m of the scatter exclusion's edge or outside it (worst ${far.toFixed(2)} m): widen SCATTER_EXCLUDE in tools/gen/scatter.mjs`);
  }
  // drain mouth: the cave's open border at clipZ lies inside the keep's opening
  const breach = { border: 0, outside: 0, bbox: null };
  {
    let bb = null;
    for (let v = 0; v < kept.pos.length / 3; v++) {
      const p = V(v);
      if (!nearBreach(p[0], p[2]) || Math.abs(p[2] - BREACH.clipZ) > 1e-4) continue;
      breach.border++;
      bb = bb ? [Math.min(bb[0], p[0]), Math.max(bb[1], p[0]), Math.min(bb[2], p[1]), Math.max(bb[3], p[1])] : [p[0], p[0], p[1], p[1]];
      const k = BREACH.keep;
      if (p[0] < k.min[0] - 0.005 || p[0] > k.max[0] + 0.005 || p[1] < k.min[1] - 0.005 || p[1] > k.max[1] + 0.005) breach.outside++;
    }
    breach.bbox = bb && bb.map((v) => +v.toFixed(3));
    if (!breach.border) errors.push("the cave has no opening at the drain mouth");
    if (breach.outside) errors.push(`${breach.outside} cave vertices at the drain plane lie outside the keep's opening`);
    const k = BREACH.keep;
    if (bb && (bb[0] > k.min[0] + 0.08 || bb[1] < k.max[0] - 0.08 || bb[2] > k.min[1] + 0.08 || bb[3] < k.max[1] - 0.08)) errors.push(`the cave's drain opening ${breach.bbox} does not fill the keep's ${[k.min[0], k.max[0], k.min[1], k.max[1]].map(r2)}`);
  }
  // platform: flat collider at PLAT.y
  const platform = { samples: 0, maxDev: 0 };
  for (let x = PLAT.x[0] + 0.4; x <= PLAT.x[1] - 0.4; x += 0.5)
    for (let z = PLAT.z[0] + 0.4; z <= PLAT.z[1] - 0.4; z += 0.5) {
      const h = caster.down(x, z, PLAT.y + 1.0);
      platform.samples++;
      const d = h === null ? Infinity : Math.abs(h - PLAT.y);
      platform.maxDev = Math.max(platform.maxDev, d);
    }
  platform.maxDev = +platform.maxDev.toFixed(4);
  if (platform.maxDev > 0.08) errors.push(`platform collider deviates ${platform.maxDev.toFixed(3)} m from ${PLAT.y}`);
  lap("joins");

  // ---- 9. zones: AABBs from the zone's vertices, binned along the tunnels
  const zoneBoxes = Object.fromEntries(ZONES.map((z) => [z, new Map()]));
  {
    for (let t = 0; t < nR; t++) {
      const g = rGroup[t];
      if (g === "O") continue;
      for (let k = 0; k < 3; k++) {
        const p = V(rIdx[t * 3 + k]);
        let bin = null;
        for (const [cn, ch] of Object.entries(CHAMBERS)) if (ch.zone === g && chamberK(p[0], p[1], p[2], ch) < 1.3) bin = cn;
        if (!bin) {
          const n = nearestSeg(p[0], p[1], p[2]);
          bin = n ? `${n.seg.name}_${Math.floor(n.s / 6)}` : "misc";
        }
        const m = zoneBoxes[g];
        const b = m.get(bin) ?? { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
        for (let c = 0; c < 3; c++) {
          b.min[c] = Math.min(b.min[c], p[c]);
          b.max[c] = Math.max(b.max[c], p[c]);
        }
        m.set(bin, b);
      }
    }
    // the platform and the outcrop's top belong to E
    zoneBoxes.E.set("outcrop", { min: [OUTCROP.footprint.x[0], 50, OUTCROP.footprint.z[0]], max: [OUTCROP.footprint.x[1], 64, OUTCROP.footprint.z[1]] });
  }
  const zones = {};
  for (const z of ZONES)
    zones[z] = {
      boxes: [...zoneBoxes[z].values()].map((b) => ({ min: b.min.map((v) => r2(v - 0.3)), max: b.max.map((v) => r2(v + 0.3)) })),
      neighbours: ZONE_NEIGHBOURS[z],
      show: [`cave_${z}`],
    };
  const zoneAt = (p) => {
    for (const z of ZONES) if (zones[z].boxes.some((b) => p[0] >= b.min[0] && p[0] <= b.max[0] && p[1] >= b.min[1] && p[1] <= b.max[1] && p[2] >= b.min[2] && p[2] <= b.max[2])) return z;
    return null;
  };
  {
    let bad = 0, first = null;
    for (const [name, pts] of Object.entries(walk))
      for (const p of pts) {
        const probe = [p[0], p[1] + 0.1, p[2]];
        const want = zoneOf(p[0], p[1] + 1, p[2]), got = zoneAt(probe);
        if (got === want) continue;
        // within 4 m of a zone boundary along the path either side is fine
        const near = pts.some((q) => Math.hypot(q[0] - p[0], q[2] - p[2]) < 4 && zoneOf(q[0], q[1] + 1, q[2]) !== want);
        if (near && got !== null) continue;
        bad++;
        first ??= `${name} (${p}) expected ${want}, got ${got}`;
      }
    if (bad) errors.push(`zone boxes misclassify ${bad} walk samples, e.g. ${first}`);
  }
  lap("zones");

  // ---- 10. the outcrop's respawn volume: below OUTCROP.respawn.y over the skin (+ margin), north to
  // OUTCROP.respawn.z0. No walk point and no anchor may stand in it (the climb runs below 50 m further north).
  const respawn = (() => {
    const geo = render.O.outcrop_rock, R = OUTCROP.respawn;
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (let k = 0; k < geo.p.length; k += 3) {
      x0 = Math.min(x0, geo.p[k]);
      x1 = Math.max(x1, geo.p[k]);
      z0 = Math.min(z0, geo.p[k + 2]);
      z1 = Math.max(z1, geo.p[k + 2]);
    }
    return { min: [r2(x0 - R.margin), 0, Math.max(R.z0, r2(z0 - R.margin))], max: [r2(x1 + R.margin), R.y, r2(z1 + R.margin)] };
  })();
  {
    const inside = (p) => p[0] >= respawn.min[0] && p[0] <= respawn.max[0] && p[2] >= respawn.min[2] && p[2] <= respawn.max[2] && p[1] < respawn.max[1] + 0.5;
    const hits = [...Object.values(walk).flat(), ...Object.values(anchors).map((a) => a.pos)].filter(inside);
    if (hits.length) errors.push(`${hits.length} walk points / anchors stand in volumes.respawn_outcrop (first at ${hits[0]})`);
  }

  // ---- 11. budgets
  const tris = {};
  for (const g of GROUPS) tris[g] = Object.values(render[g]).reduce((a, b) => a + b.tris, 0);
  const renderTotal = Object.values(tris).reduce((a, b) => a + b, 0);
  if (renderTotal < 15000 || renderTotal > 40000) warnings.push(`render triangles ${renderTotal} outside 15–40k`);
  const colTris = Object.fromEntries(GROUPS.map((g) => [g, colliders[g].tris]));

  const report = {
    errors, warnings,
    stats: {
      grid: surf.stats, raw, renderTris: tris, renderTotal, ringTris: ringCount, colliderTris: colTris,
      simplifyError: { render: +rErr.toFixed(5), collider: +cErr.toFixed(5) },
      minRockCover: r2(minCover), wrongWindingPct: +wrongPct.toFixed(3),
      probes: { minClearance: r2(probes.minClear), clearanceAt: probes.at, minHalfWidth: r2(probes.minHalfW), halfWidthAt: probes.halfAt, maxSlope: probes.maxSlope },
      walk: { samples: walkStats.samples, maxStepUp: +walkStats.maxUp.toFixed(3), maxStepDown: +walkStats.maxDown.toFixed(3), maxColliderDev: +walkStats.maxDev.toFixed(3), minHeadRoom: r2(walkStats.minHead) },
      connectivity: { centreSamples: connectivity.samples, chasm: connectivity.chasm, breaks: connectivity.breaks.length },
      hole, skinBorder, breach, platform, vista, bridge: { minGap: r2(bridge.minGap), crown: bridge.crown }, denPathMinToWolf: r2(denMin), movedAnchors: moved,
      stair: { s0: STAIR.s0, sEnd: r2(stair.sEnd), risers: stair.K, riser: +stair.r.toFixed(3), y0: +stair.y0.toFixed(3), yTop: stair.yTop },
      perchRampDeg: +perchSteps.ramp.deg.toFixed(1), cornerWebs: cornerWebs.length, cocoons: cocoons.length, eggs: eggList.length,
    },
    // build timings: logged only (cave/anchors is content-addressed and must not change between identical builds)
    ms,
  };
  BUILT = { render, colliders, extra, anchors, walk, zones, webs, stair, perchSteps, cocoons, eggList, fissureInfo, plugInfo, report, den_path, moved, lip, respawn };
  log(`  cave: ${raw.triangles} raw → render ${renderTotal} (${ZONES.map((z) => `${z} ${tris[z]}`).join(", ")}, outcrop ${tris.O}), colliders ${Object.values(colTris).reduce((a, b) => a + b, 0)}; ${Math.round(performance.now() - t0)} ms (${Object.entries(ms).map(([k, v]) => `${k} ${v}`).join(", ")})`);
  return BUILT;
}

// ------------------------------------------------------------------ glTF
/** Mean colour of a texture (the untextured look until the runtime binds the set). */
async function meanColor(file) {
  const { channels } = await sharp(file).stats();
  const lin = (c) => ((c / 255) ** 2.2);
  return [lin(channels[0].mean), lin(channels[1].mean), lin(channels[2].mean), 1];
}
/** Like lib/gltf.mjs finalize, but keeps every attribute (UVs are used by textures bound at runtime) and material names. */
async function finalizeCave(doc) {
  await doc.transform(dedup({ keepUniqueNames: true }), weld(), prune({ keepAttributes: true, keepLeaves: true }), meshopt({ encoder: MeshoptEncoder, level: "medium" }));
  return Buffer.from(await io.writeBinary(doc));
}
const texId = (k, m) => `cave/tex/${k}_${m}`;

/**
 * The decoded GLBs' permanent colliders (quantised, in world space, as the runtime builds them; the
 * removable web, cocoon and plug bodies left out) must carry every anchor within 3 cm and the whole
 * walk: breach → entry → (chasm) → toSpider → toDen → exit → balcony_mouth, sampled every 0.25 m,
 * with a collider everywhere, steps ≤ 0.45 up / 0.5 down and head room ≥ 2.2 m. The chasm (CHASM)
 * is the only gap allowed: any other gap between consecutive walk points fails. Returns the failures.
 */
async function checkEncoded(data, glbs) {
  const cols = [];
  for (const glb of glbs) {
    const doc = await io.readBinary(new Uint8Array(glb));
    for (const n of doc.getRoot().listNodes()) {
      const mesh = n.getMesh();
      if (!mesh || !/_col$/.test(n.getName()) || /^(web_[AB]_col|cocoon_courier_col|outcrop_mouth_plug_col)$/.test(n.getName())) continue;
      const m = n.getWorldMatrix(), c = new Col();
      const W = (p) => [m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12], m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13], m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14]];
      for (const prim of mesh.listPrimitives()) {
        const pos = prim.getAttribute("POSITION"), idx = prim.getIndices(), el = [];
        for (let k = 0; k < idx.getCount(); k += 3) c.tri(...[0, 1, 2].map((j) => W(pos.getElement(idx.getScalar(k + j), el))));
      }
      cols.push(c);
    }
  }
  const dc = new DownCaster(cols), bad = [];
  for (const [k, a] of Object.entries(data.anchors)) {
    if (a.sdfFloor === undefined || k === "breach") continue;
    const h = dc.down(a.pos[0], a.pos[2], a.pos[1] + 0.5);
    if (h === null || Math.abs(h - a.pos[1]) > 0.03) bad.push(`anchor ${k}: decoded collider ${h?.toFixed(3)} vs ${a.pos[1]}`);
  }
  const chain = ["entry", "toSpider", "toDen", "exit"].flatMap((name) => data.walk[name].map((p) => ({ p, name })));
  const breach = data.anchors.breach?.pos, mouth = data.anchors.balcony_mouth?.pos;
  if (!mouth) bad.push("walk: no balcony_mouth anchor");
  else chain.push({ p: mouth, name: "balcony_mouth" });
  if (!breach || !chain.length || Math.hypot(chain[0].p[0] - breach[0], chain[0].p[2] - breach[2]) > 1.0) bad.push(`walk: the path does not start at the breach (first point ${chain[0]?.p})`);
  let prev = null, crossings = 0;
  for (let i = 0; i < chain.length - 1; i++) {
    const a = chain[i].p, b = chain[i + 1].p, d = Math.hypot(b[0] - a[0], b[2] - a[2]);
    const n = Math.max(1, Math.ceil(d / 0.25));
    let pattern = "";
    for (let k = i === 0 ? 0 : 1; k <= n; k++) {
      const t = k / n, x = lerp(a[0], b[0], t), z = lerp(a[2], b[2], t), at = `${x.toFixed(2)}, ${z.toFixed(2)}`;
      if (inChasm(x, z)) {
        pattern += "W";
        prev = null;
        continue;
      }
      pattern += "D";
      const h = dc.down(x, z, lerp(a[1], b[1], t) + 0.6);
      if (h === null) {
        bad.push(`walk ${chain[i].name} (${at}): no decoded collider`);
        prev = null;
        continue;
      }
      if (prev !== null && (h - prev > 0.45 || prev - h > 0.5)) bad.push(`walk ${chain[i].name} (${at}): step ${(h - prev).toFixed(2)}`);
      const up = dc.up(x, z, h + 0.05);
      if (up === null ? Math.hypot(x - mouth[0], z - mouth[2]) > 1.5 : up - h < 2.2) bad.push(`walk ${chain[i].name} (${at}): head room ${up === null ? "open sky" : (up - h).toFixed(2)}`);
      prev = h;
    }
    if (pattern.includes("W")) {
      // the one gap allowed: from bank to bank over the chasm, each bank's dry part ≤ 2.1 m
      crossings++;
      const m = /^(D*)W+(D*)$/.exec(pattern);
      if (!m || d > 13 || (m[1].length + 1) * (d / n) > 2.1 || m[2].length * (d / n) > 2.1) bad.push(`walk: the chasm crossing ${chain[i].name} (${a}) → ${chain[i + 1].name} (${b}) is not bank to bank (${d.toFixed(1)} m, ${pattern})`);
    } else if (d > 2.05) bad.push(`walk: gap of ${d.toFixed(2)} m outside the chasm between ${chain[i].name} (${a}) and ${chain[i + 1].name} (${b})`);
  }
  if (crossings !== 1) bad.push(`walk: expected one chasm crossing, found ${crossings}`);
  return bad;
}

// ------------------------------------------------------------------ the outdoor set, the enclosure, the gates
/** Every node of a GLB with its triangles in world space: {names, tris: {node: [[a, b, c], …]}}. */
async function decodeGLB(glb) {
  const doc = await io.readBinary(new Uint8Array(glb));
  const names = [], tris = {};
  for (const n of doc.getRoot().listNodes()) {
    names.push(n.getName());
    const mesh = n.getMesh();
    if (!mesh) continue;
    const m = n.getWorldMatrix();
    const W = (p) => [m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12], m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13], m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14]];
    const list = (tris[n.getName()] ??= []);
    for (const prim of mesh.listPrimitives()) {
      const pos = prim.getAttribute("POSITION"), idx = prim.getIndices(), el = [];
      for (let k = 0; k < idx.getCount(); k += 3) list.push([0, 1, 2].map((j) => W(pos.getElement(idx.getScalar(k + j), el))));
    }
  }
  return { names, tris };
}

/** Triangles bucketed on a 1 m x/z grid, for vertical lines, segments and rays (two-sided hits). */
class TriGrid {
  constructor() {
    this.t = [];
    this.g = new Map();
  }
  add([a, b, c], tag) {
    const n = cross(sub(b, a), sub(c, a)), l = len(n);
    if (l < 1e-12) return;
    const id = this.t.length;
    this.t.push({ a, b, c, n: mul(n, 1 / l), tag });
    const xs = [a[0], b[0], c[0]], zs = [a[2], b[2], c[2]];
    for (let i = Math.floor(Math.min(...xs)); i <= Math.floor(Math.max(...xs)); i++)
      for (let j = Math.floor(Math.min(...zs)); j <= Math.floor(Math.max(...zs)); j++) {
        const k = hkey(i, j);
        if (!this.g.has(k)) this.g.set(k, []);
        this.g.get(k).push(id);
      }
  }
  /** surfaces crossing the vertical line at (x, z): [{y, ny, tag}], highest first */
  column(x, z) {
    const out = [];
    for (const id of this.g.get(hkey(Math.floor(x), Math.floor(z))) ?? NO_SEGS) {
      const { a, b, c, n, tag } = this.t[id];
      const d = (b[2] - c[2]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[2] - c[2]);
      if (Math.abs(d) < 1e-12) continue;
      const l0 = ((b[2] - c[2]) * (x - c[0]) + (c[0] - b[0]) * (z - c[2])) / d, l1 = ((c[2] - a[2]) * (x - c[0]) + (a[0] - c[0]) * (z - c[2])) / d, l2 = 1 - l0 - l1;
      if (l0 < -1e-7 || l1 < -1e-7 || l2 < -1e-7) continue;
      out.push({ y: l0 * a[1] + l1 * b[1] + l2 * c[1], ny: n[1], tag });
    }
    return out.sort((p, q) => q.y - p.y);
  }
  /** ray parameter of the hit of triangle `id` by o + d·t (Möller–Trumbore, both sides), or null */
  hit(id, o, d) {
    const { a, b, c } = this.t[id];
    const e1 = sub(b, a), e2 = sub(c, a), p = cross(d, e2), det = dot(e1, p);
    if (Math.abs(det) < 1e-12) return null;
    const s = sub(o, a), u = dot(s, p) / det;
    if (u < -1e-9 || u > 1 + 1e-9) return null;
    const q = cross(s, e1), v = dot(d, q) / det;
    if (v < -1e-9 || u + v > 1 + 1e-9) return null;
    return dot(e2, q) / det;
  }
  /** whether a triangle (not tagged `skip`) crosses the segment p → q */
  segment(p, q, skip) {
    const d = sub(q, p), seen = new Set();
    for (let i = Math.floor(Math.min(p[0], q[0])); i <= Math.floor(Math.max(p[0], q[0])); i++)
      for (let j = Math.floor(Math.min(p[2], q[2])); j <= Math.floor(Math.max(p[2], q[2])); j++)
        for (const id of this.g.get(hkey(i, j)) ?? NO_SEGS) {
          if (seen.has(id) || this.t[id].tag === skip) continue;
          seen.add(id);
          const t = this.hit(id, p, d);
          if (t !== null && t >= 0 && t <= 1) return true;
        }
    return false;
  }
  /** first hit of the ray o + u·t (u unit) for t ≤ tmax: {t, tri}, walking the x/z cells in order */
  ray(o, u, tmax) {
    let ix = Math.floor(o[0]), iz = Math.floor(o[2]), best = null;
    const sx = u[0] > 0 ? 1 : -1, sz = u[2] > 0 ? 1 : -1;
    const dx = u[0] ? Math.abs(1 / u[0]) : Infinity, dz = u[2] ? Math.abs(1 / u[2]) : Infinity;
    let mx = u[0] ? (u[0] > 0 ? ix + 1 - o[0] : o[0] - ix) * dx : Infinity, mz = u[2] ? (u[2] > 0 ? iz + 1 - o[2] : o[2] - iz) * dz : Infinity;
    const seen = new Set();
    for (let t0 = 0; t0 <= tmax; ) {
      for (const id of this.g.get(hkey(ix, iz)) ?? NO_SEGS) {
        if (seen.has(id)) continue;
        seen.add(id);
        const t = this.hit(id, o, u);
        if (t !== null && t > 1e-6 && t <= tmax && (!best || t < best.t)) best = { t, tri: this.t[id] };
      }
      const next = Math.min(mx, mz);
      if (best && best.t <= next) break;
      if (mx < mz) {
        ix += sx;
        t0 = mx;
        mx += dx;
      } else {
        iz += sz;
        t0 = mz;
        mz += dz;
      }
    }
    return best;
  }
}

/**
 * Where the player's capsule (MOVER) can get on collider triangles: a flood fill over columns of
 * `cell` m inside `box`. A node is a column and a surface in it: an up-facing triangle no steeper than
 * MOVER.maxSlopeDeg with MOVER.height clear above (surfaces closer than 0.12 m are one: duplicated
 * ring triangles, the runtime field's two diagonals). A move to one of the 8 neighbouring columns lands
 * on the first surface there at most `reach` above the current one (a step, or a jump up to JUMP_REACH)
 * or any distance below (a fall). It is blocked when that surface has no head room, when something in
 * the new column lies within MOVER.height above the higher of the two levels, when a jump hits
 * something above the current column, or when a triangle (other than the terrain's) crosses the
 * segments between the two columns at 0.3, 0.9 and 1.5 m above the higher level. Landing on a slope
 * steeper than the limit slides: from there, only moves that do not climb. `visit(node, p)` returns
 * "stop" to keep a node from spreading. Returns {nodes, voids, edges, path(node)}: `voids` are moves
 * that fall through every collider, `edges` nodes that reach the border of `box`.
 */
function walkFill(grid, { box, cell = 0.25, starts, reach = JUMP_REACH, visit = () => {} }) {
  const cosMax = Math.cos((MOVER.maxSlopeDeg * Math.PI) / 180), HB = MOVER.height;
  const nx = Math.round((box.x1 - box.x0) / cell), nz = Math.round((box.z1 - box.z0) / cell);
  const cx = (i) => box.x0 + (i + 0.5) * cell, cz = (j) => box.z0 + (j + 0.5) * cell;
  const cols = new Map();
  const column = (i, j) => {
    const key = i * 65536 + j;
    let c = cols.get(key);
    if (c) return c;
    c = [];
    for (const h of grid.column(cx(i), cz(j))) {
      const last = c[c.length - 1];
      if (last && last.y - h.y < 0.12) {
        if (h.ny >= cosMax) last.up = true;
        if (h.tag !== "terrain") last.tag = h.tag;
        continue;
      }
      c.push({ y: h.y, up: h.ny >= cosMax, tag: h.tag });
    }
    for (let n = 0; n < c.length; n++) c[n].room = n === 0 || c[n - 1].y - c[n].y >= HB;
    cols.set(key, c);
    return c;
  };
  const nodes = new Map(), queue = [], voids = [], edges = [];
  const keyOf = (i, j, k) => (i * 65536 + j) * 64 + k;
  const add = (i, j, k, from, slide) => {
    const key = keyOf(i, j, k);
    if (nodes.has(key)) return;
    const c = column(i, j)[k];
    const nd = { i, j, k, y: c.y, tag: c.tag, slide, from };
    nodes.set(key, nd);
    queue.push(nd);
  };
  for (const s of starts) {
    const i = Math.floor((s[0] - box.x0) / cell), j = Math.floor((s[2] - box.z0) / cell);
    const c = column(i, j);
    const k = c.findIndex((h) => h.up && h.room && Math.abs(h.y - s[1]) < 0.6);
    if (k >= 0) add(i, j, k, null, false);
  }
  const at = (nd) => [cx(nd.i), nd.y, cz(nd.j)];
  const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
  for (let q = 0; q < queue.length; q++) {
    const nd = queue[q], p = at(nd);
    if (visit(nd, p) === "stop") continue;
    const src = column(nd.i, nd.j);
    for (const [di, dj] of DIRS) {
      const i2 = nd.i + di, j2 = nd.j + dj;
      if (i2 < 0 || j2 < 0 || i2 >= nx || j2 >= nz) {
        edges.push(nd);
        continue;
      }
      const c2 = column(i2, j2), y = nd.y, hi = y + (nd.slide ? 0.05 : reach);
      const k = c2.findIndex((h) => h.y <= hi + 1e-6);
      if (k < 0) {
        // nothing at all under the body: a fall out of the world (else only a wall above the reach)
        if (!c2.length) voids.push({ from: nd, at: [cx(i2), y, cz(j2)] });
        continue;
      }
      const h = c2[k];
      if (!h.room) continue; // something in the new column within the body's height above the surface
      if (!h.up && h.y > y + 0.05) continue; // a steep face at body height
      const base = Math.max(y, h.y);
      // nothing above the first surface may reach into the body (the next hit up is above hi)
      if (k > 0 && c2[k - 1].y < base + HB) continue;
      // a jump: room above the current column too
      if (h.y > y + MOVER.stepUp && src.some((s) => s.y > y + 0.05 && s.y < h.y + HB)) continue;
      const q2 = [cx(i2), 0, cz(j2)];
      let blocked = false;
      for (const dy of [0.3, 0.9, 1.5]) {
        p[1] = q2[1] = base + dy;
        if (grid.segment(p, q2, "terrain")) {
          blocked = true;
          break;
        }
      }
      p[1] = nd.y;
      if (!blocked) add(i2, j2, k, nd, !h.up);
    }
  }
  const path = (nd) => {
    const out = [];
    for (let n = nd; n; n = n.from) out.push(at(n).map(r2));
    return out.reverse();
  };
  return { nodes, voids, edges, path, at };
}

/** A path for a message: start, a few points, end. */
const pathText = (pts) => (pts.length <= 6 ? pts : [...pts.slice(0, 2), "…", ...pts.slice(-3)]).map((p) => (typeof p === "string" ? p : `(${p.join(", ")})`)).join(" → ");

/** The render terrain's triangles (tools/gen/terrain.mjs on its 2 m grid) over a rectangle, EXIT_HOLE cut. */
function renderTerrainTris({ x0, x1, z0, z1 }) {
  const out = [], sp = 2, H_ = (i, j) => [i * sp, T.height(i * sp, j * sp), j * sp];
  for (let i = Math.floor(x0 / sp); i < Math.ceil(x1 / sp); i++)
    for (let j = Math.floor(z0 / sp); j < Math.ceil(z1 / sp); j++) {
      if (inRect(EXIT_HOLE.render, (i + 0.5) * sp, (j + 0.5) * sp)) continue;
      const a = H_(i, j), b = H_(i + 1, j), c = H_(i + 1, j + 1), d = H_(i, j + 1);
      if ((((i + j) % 2) + 2) % 2) out.push([a, d, c], [a, c, b]);
      else out.push([a, d, b], [b, d, c]);
    }
  return out;
}

/** The decoded box of a removable collider: centre and half extents along `axes` (from its vertices). */
function boxOf(tris, axes) {
  const vs = tris.flat();
  const c = mul(vs.reduce((s, v) => add(s, v), [0, 0, 0]), 1 / vs.length);
  const half = axes.map((a) => Math.max(...vs.map((v) => Math.abs(dot(sub(v, c), a)))));
  return { c, half };
}

/**
 * Checks of the shipped GLBs beyond the walk (checkEncoded), with the field as the reference:
 *  1. muster set (cave/outcrop alone, over the runtime terrain with EXIT_HOLE cut, no cave/mesh):
 *     rays from the platform, the town and the hillside toward where zone E would be must meet a
 *     front face first (no back face, nothing, or terrain hidden in the rock), and every standable
 *     floor of the field outside the plug has a collider within 0.45 m;
 *  2. enclosure: the capsule filled from `platform` stays on the deck and the stub (or drops into
 *     volumes.respawn_outcrop), never reaches the terrain or the box's edge or falls through; filled
 *     from the hillside it never reaches the deck or the stub (no one drops in and is shut in);
 *  3. the rails stand ≥ rails.h above the deck along every open edge;
 *  4. each removable gate box (web_A, web_B, the plug) covers the tunnel section in its plane;
 *  5. the perch ramp climbs from perch_foot to the perch top with steps ≤ 0.45;
 *  6. no two node names differ only by case.
 * Returns {bad, stats}.
 */
async function checkOutdoor(data, { A, BE, O }) {
  const bad = [], stats = {};
  const PL = OUTCROP.platform, RS = data.respawn;
  const region = { x0: -40, x1: 4, z0: -700, z1: -650 };
  const inDeck = (p) => p[0] >= PL.x[0] && p[0] <= PL.x[1] && p[2] >= PL.z[0] && p[2] <= PL.z[1] && Math.abs(p[1] - PL.y) < 0.6;
  /** the stub's floor: inside the tunnel's air, in front of the plug */
  const inStubAir = (p) => plugSide(p) > -0.3 && inStub(p, 0.3) && air(p[0], p[1] + 1.0, p[2]) < 0;
  const inRespawn = (p) => p[0] >= RS.min[0] && p[0] <= RS.max[0] && p[2] >= RS.min[2] && p[2] <= RS.max[2];
  /** the outcrop's own box: the respawn volume's x/z, reaching north over the whole footprint */
  const inOutcrop = (p) => p[0] >= RS.min[0] && p[0] <= RS.max[0] && p[2] >= OUTCROP.footprint.z[0] - 1 && p[2] <= RS.max[2];

  // ---- 1a. render closure (muster set)
  {
    const g = new TriGrid();
    for (const [name, list] of Object.entries(O.tris)) if (!/_col$/.test(name)) for (const t of list) g.add(t, name);
    for (const t of renderTerrainTris({ x0: region.x0 - 20, x1: region.x1 + 20, z0: region.z0 - 20, z1: region.z1 + 20 })) g.add(t, "terrain");
    // targets: zone E's surface near the mouth (what cave/mesh would show), and air behind the plug
    const targets = [];
    for (const [mat, geo] of Object.entries(data.render.E)) {
      if (mat === "outcrop_rock") continue; // E's ring of outcrop triangles: those ship in cave/outcrop
      for (let k = 0; k < geo.i.length; k += 3) {
        const c = mul([0, 1, 2].map((j) => geo.p.slice(geo.i[k + j] * 3, geo.i[k + j] * 3 + 3)).reduce((s, v) => add(s, v), [0, 0, 0]), 1 / 3);
        if (len(sub(c, MOUTH_PT)) < 14) targets.push(c);
      }
    }
    const step = Math.max(1, Math.floor(targets.length / 450));
    const T_ = targets.filter((_, n) => n % step === 0);
    for (let s = TUNNEL_LEN.exit - MOUTH.plugDepth - 2.5; s <= TUNNEL_LEN.exit - MOUTH.plugDepth - 0.5; s += 0.5) {
      const q = tunnelAt("exit", s);
      for (const o of [-1.5, 0, 1.5]) for (const dy of [0.8, 2.0, 3.2]) T_.push([q.x - q.tz * o, q.fy + dy - 1, q.z + q.tx * o]);
    }
    const eyes = [];
    for (let x = PL.x[0] + 0.5; x <= PL.x[1] - 0.4; x += 1.5) for (let z = PL.z[0] + 0.5; z <= PL.z[1] - 0.4; z += 1.5) eyes.push({ k: "platform", p: [x, PL.y + 1.65, z] });
    const ground = (x, z) => Hrender(x, z) + 1.65;
    for (const [k, x, z, y] of [["square", 60, -592], ["forecourt", 60, -645], ["keep_top", 60, -662, 52.7], ["street", 62, -610], ["tower", 90, -584, 52], ["inn", 101, -584, 46]]) eyes.push({ k, p: [x, y ?? ground(x, z), z] });
    for (let a = 0; a < 360; a += 30)
      for (const r of [16, 28]) {
        const x = -16 + r * Math.cos((a * Math.PI) / 180), z = -674 + r * Math.sin((a * Math.PI) / 180), p = [x, ground(x, z), z];
        if (S(p[0], p[1], p[2]) > 0.3) eyes.push({ k: `hill ${a}°/${r}`, p });
      }
    // A renderer culls back faces and shows the first front face. The void is rock deeper than 0.25 m
    // or cave air outside the stub (cave/mesh is not loaded). A ray passes when its first front face
    // comes before it enters the void: a sliver of back face at a grazing lip is not a hole. Only rays
    // whose first hit is not a front face of the outcrop are marched through the field.
    const VOID = 0.25;
    const inVoid = (p) => S(p[0], p[1], p[2]) < -VOID || (air(p[0], p[1], p[2]) < -VOID && !(plugSide(p) > -0.3 && inStub(p, 0.3)));
    let rays = 0, fails = 0, marched = 0;
    const byEye = {}, firsts = [];
    for (const e of eyes)
      for (const tp of T_) {
        const d = sub(tp, e.p), L = len(d), u = mul(d, 1 / L);
        const h = g.ray(e.p, u, L + 3);
        rays++;
        if (h && dot(h.tri.n, u) < 0 && h.tri.tag !== "terrain") continue;
        // the first front face (if any), then where the ray enters the void before it
        marched++;
        let tf = Infinity, front = null;
        for (let t0 = 0, o = e.p; ; ) {
          const hh = g.ray(o, u, L + 3 - t0);
          if (!hh) break;
          if (dot(hh.tri.n, u) < 0) {
            tf = t0 + hh.t;
            front = hh.tri.tag;
            break;
          }
          t0 += hh.t + 1e-4;
          o = add(e.p, mul(u, t0));
        }
        let tv = Infinity;
        for (let t = Math.max(0, L - 30); t < Math.min(tf, L + 3); t += 0.1)
          if (inVoid(add(e.p, mul(u, t)))) {
            tv = t;
            break;
          }
        const why = tv < Infinity ? `reaches the void ${(Math.min(tf, L + 3) - tv).toFixed(2)} m before ${front ? `the first front face (${front})` : "any front face"}` : tf === Infinity ? "meets nothing" : null;
        if (why) {
          fails++;
          byEye[e.k] = (byEye[e.k] ?? 0) + 1;
          if (firsts.length < 3) firsts.push(`${e.k} (${e.p.map(r2)}) → (${tp.map(r2)}): ${why}`);
          if (_debug.last) (_debug.last.rays ??= []).push({ eye: e.p, target: tp, why });
        }
      }
    stats.closure = { eyes: eyes.length, targets: T_.length, rays, marched, fails };
    if (fails) bad.push(`muster set (cave/outcrop without cave/mesh): ${fails} of ${rays} rays toward zone E reach the void (${Object.entries(byEye).map(([k, n]) => `${k} ${n}`).join(", ")}), e.g. ${firsts.join("; ")}`);
  }

  // colliders of the muster set: the outcrop's (deck, rails, plug) and the runtime terrain with EXIT_HOLE
  const cg = new TriGrid();
  for (const [name, list] of Object.entries(O.tris)) if (/_col$/.test(name)) for (const t of list) cg.add(t, name);
  for (const t of runtimeFieldTris(region)) cg.add(t, "terrain");

  // ---- 1b. every standable floor of the field outside the plug has a collider within 0.45 m of it, or
  // within 0.2 m of the floor the player sees there (the up-facing render surface nearest the field's,
  // within 0.6 m: both meshes are simplified, and on a few ledges the render sits 0.4 m under the
  // field). A field floor the render does not show within 0.6 m (a sliver of the rim the simplifier
  // removed, from the render and the collider alike) is counted, not failed: a floor missing from the
  // render is the closure check's (1a), a shown floor without a collider is this one's. In the tunnel's
  // air (the stub) every floor counts.
  {
    const cosMax = Math.cos((MOVER.maxSlopeDeg * Math.PI) / 180);
    const rg = new TriGrid();
    for (const [name, list] of Object.entries(O.tris)) if (!/_col$/.test(name)) for (const t of list) rg.add(t, name);
    let pts = 0, miss = 0, first = null, byRender = 0, unshown = 0;
    // every 0.5 m, and every 0.25 m around the mouth (the stub's floor)
    for (let x = OUTCROP.footprint.x[0] - 1; x <= OUTCROP.footprint.x[1] + 2; x += 0.25)
      for (let z = OUTCROP.footprint.z[0] - 1; z <= OUTCROP.footprint.z[1] + 1; z += 0.25) {
        if ((x % 0.5 !== 0 || z % 0.5 !== 0) && Math.hypot(x - MOUTH_PT[0], z - MOUTH_PT[2]) > MOUTH.radius + 1) continue;
        // floors: rock below, air above, scanning down from 68 m to 44 m
        let prev = S(x, 68, z) > 0;
        for (let y = 67.8; y >= 44; y -= 0.2) {
          const isAir = S(x, y, z) > 0;
          if (prev && !isAir) {
            const f = bisectY(x, z, y, y + 0.2);
            const p = [x, f, z];
            const cls = surfaceClass(x, f - 0.03, z);
            const behind = plugSide(p) < -0.2 && air(x, f + 1.0, z) < 0;
            const room = S(x, f + 0.3, z) > 0 && S(x, f + 1.0, z) > 0 && S(x, f + 1.75, z) > 0;
            if (cls !== "terrain" && !behind && room && norm(gradS(x, f, z))[1] >= cosMax) {
              pts++;
              const cs = cg.column(x, z);
              if (!cs.some((h) => h.y >= f - 0.45 && h.y <= f + 0.45)) {
                const seen = rg.column(x, z).filter((h) => h.ny > 0 && Math.abs(h.y - f) < 0.6).sort((a, b) => Math.abs(a.y - f) - Math.abs(b.y - f))[0];
                if (seen && cs.some((h) => Math.abs(h.y - seen.y) <= 0.2)) byRender++;
                else if (!seen && !cs.some((h) => Math.abs(h.y - f) < 0.6) && air(x, f + 1.0, z) > 0) unshown++;
                else {
                  miss++;
                  first ??= p.map(r2);
                }
              }
            }
          }
          prev = isAir;
        }
      }
    stats.mouthFloors = { points: pts, missing: miss, byRenderFloor: byRender, unshown };
    if (miss) bad.push(`muster set: ${miss} of ${pts} standable floors outside the mouth plug have no collider within 0.45 m (first at ${first})`);
  }

  // ---- 2. enclosure
  {
    const first = {};
    let respawned = 0;
    const out = walkFill(cg, {
      box: region,
      starts: [data.anchors.platform.pos],
      visit: (nd, p) => {
        if (p[1] < RS.max[1] && inRespawn(p)) {
          respawned++;
          return "stop";
        }
        // inside the stub the runtime terrain collider is part of the floor (the tunnel follows it there)
        const k = !inOutcrop(p) ? "outside" : inDeck(p) || inStubAir(p) ? null : nd.tag === "terrain" ? "terrain" : "envelope";
        if (k) first[k] ??= nd;
      },
    });
    const how = { outside: "leaves the outcrop", terrain: "reaches the terrain", envelope: "leaves the rails' envelope (the deck and the stub)" };
    const msgs = Object.entries(first).map(([k, nd]) => `${how[k]} at (${out.at(nd).map(r2)}) via ${pathText(out.path(nd))}`);
    if (!out.nodes.size) msgs.push("finds no standable surface at the platform anchor");
    if (out.voids.length) msgs.push(`falls through every collider at (${out.voids[0].at.map(r2)}) via ${pathText(out.path(out.voids[0].from))}`);
    if (out.edges.length) msgs.push(`reaches the edge of the checked area at (${out.at(out.edges[0]).map(r2)})`);
    for (const m of msgs) bad.push(`enclosure: the capsule (step ${MOVER.stepUp}, slopes ≤ ${MOVER.maxSlopeDeg}°, jump ${JUMP_REACH.toFixed(2)} m) from the platform ${m}`);
    stats.enclosure = { fromPlatform: out.nodes.size, respawned };
  }
  {
    // from the hillside: every terrain surface on the border of the area, i.e. the whole open slope
    const starts = [], cell = 0.25;
    const nx = Math.round((region.x1 - region.x0) / cell), nz = Math.round((region.z1 - region.z0) / cell);
    for (let i = 0; i < nx; i++)
      for (const j of [0, nz - 1]) starts.push([region.x0 + (i + 0.5) * cell, heightAtRuntime(region.x0 + (i + 0.5) * cell, region.z0 + (j + 0.5) * cell), region.z0 + (j + 0.5) * cell]);
    for (let j = 0; j < nz; j++)
      for (const i of [0, nx - 1]) starts.push([region.x0 + (i + 0.5) * cell, heightAtRuntime(region.x0 + (i + 0.5) * cell, region.z0 + (j + 0.5) * cell), region.z0 + (j + 0.5) * cell]);
    let reached = null, onTop = 0;
    const out = walkFill(cg, {
      box: region,
      cell,
      starts,
      visit: (nd, p) => {
        if (nd.tag !== "terrain") onTop++;
        if (!reached && (inDeck(p) || inStubAir(p))) reached = nd;
      },
    });
    stats.enclosure.fromHillside = out.nodes.size;
    stats.enclosure.hillsideOnOutcrop = onTop;
    if (reached) bad.push(`enclosure: the capsule from the hillside reaches the ${inDeck(out.at(reached)) ? "platform" : "mouth"} at (${out.at(reached).map(r2)}) via ${pathText(out.path(reached))}: a town-chapter player would be shut in by the rails`);
    if (out.voids.length) bad.push(`muster set: the capsule from the hillside falls through every collider at (${out.voids[0].at.map(r2)}) via ${pathText(out.path(out.voids[0].from))}`);
  }

  // ---- 3. rails
  {
    const rails = new TriGrid(), deck = new TriGrid();
    for (const t of O.tris.outcrop_rails_col ?? []) rails.add(t, "rails");
    for (const t of O.tris.outcrop_col ?? []) deck.add(t, "deck");
    let min = Infinity, at = null, gapAt = null;
    for (const [a, b] of Object.values(OUTCROP.rails.open)) {
      const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
      for (let s = 0; s <= L + 1e-6; s += 0.25) {
        const x = lerp(a[0], b[0], s / L), z = lerp(a[1], b[1], s / L);
        const hs = rails.column(x, z);
        const top = hs.length ? hs[0].y : -Infinity, bottom = hs.length ? hs[hs.length - 1].y : Infinity;
        // the deck just inside the edge
        const ix = x + (x <= PL.x[0] + 0.01 ? 0.5 : x >= PL.x[1] - 0.01 ? -0.5 : 0), iz = z + (z <= PL.z[0] + 0.01 ? 0.5 : z >= PL.z[1] - 0.01 ? -0.5 : 0);
        const d = deck.column(ix, iz).find((h) => h.y < PL.y + 0.5)?.y ?? PL.y;
        if (top - d < min) {
          min = top - d;
          at = [r2(x), r2(z)];
        }
        if (bottom > d + 0.02) gapAt ??= [r2(x), r2(z)];
      }
    }
    stats.rails = { minAboveDeck: r2(min) };
    if (min < OUTCROP.rails.h - 0.01) bad.push(`rails: only ${min.toFixed(2)} m above the deck at (${at}) (want ${OUTCROP.rails.h}; a jump lifts the feet ${JUMP_REACH.toFixed(2)} m)`);
    if (gapAt) bad.push(`rails: a gap under the rails at (${gapAt})`);
  }

  // ---- 4. gate boxes cover their tunnel sections
  {
    const gates = [
      ["web_A", BE.tris.web_A_col, data.webs.web_A?.box],
      ["web_B", BE.tris.web_B_col, data.webs.web_B?.box],
      ["outcrop_mouth_plug", O.tris.outcrop_mouth_plug_col, data.plugInfo?.box],
    ];
    stats.gates = {};
    for (const [name, tris, info] of gates) {
      if (!tris || !info) {
        bad.push(`gate ${name}: no collider or no box record`);
        continue;
      }
      const [t, up, r] = info.axes.map((a) => norm(a));
      const box = boxOf(tris, [t, up, r]);
      // flood the open section in the box's mid-plane from its centre (0.1 m cells, ±7 m)
      const step = 0.1, N = 70, seen = new Uint8Array((2 * N + 1) ** 2);
      const P = (iu, iv) => add(box.c, add(mul(r, iu * step), mul(up, iv * step)));
      const id = (iu, iv) => (iv + N) * (2 * N + 1) + (iu + N);
      const stack = [[0, 0]];
      let cells = 0, outside = 0, first = null, open = false;
      while (stack.length) {
        const [iu, iv] = stack.pop();
        if (Math.abs(iu) > N || Math.abs(iv) > N || seen[id(iu, iv)]) continue;
        seen[id(iu, iv)] = 1;
        const p = P(iu, iv), s = S(p[0], p[1], p[2]);
        if (s <= 0.02) continue;
        cells++;
        if (Math.abs(iu) === N || Math.abs(iv) === N) open = true;
        // a capsule's centre needs its radius of air; such a point outside the box gets past it
        if (s > MOVER.radius && (Math.abs(iu * step) > box.half[2] + 1e-3 || Math.abs(iv * step) > box.half[1] + 1e-3)) {
          outside++;
          first ??= p.map(r2);
        }
        stack.push([iu + 1, iv], [iu - 1, iv], [iu, iv + 1], [iu, iv - 1]);
      }
      stats.gates[name] = { sectionCells: cells, half: box.half.map(r2), outside };
      if (open) bad.push(`gate ${name}: the section in its plane is not closed within ${N * step} m of the box`);
      if (outside) bad.push(`gate ${name}: its box (${box.half.map(r2)} half extents) does not cover the tunnel section in its plane: ${outside} open points with room for the capsule lie outside it (first at ${first})`);
    }
  }

  // ---- 5. the perch ramp
  {
    const g = new TriGrid();
    for (const t of A.tris.cave_A_col ?? []) g.add(t, "A");
    const foot = data.anchors.perch_foot?.pos, top = data.anchors.perch?.pos;
    let maxStep = 0, prev = foot?.[1], ok = !!(foot && top), at = null;
    const pts = [];
    if (ok) {
      for (let x = foot[0]; x <= PERCH.c[0]; x += 0.1) pts.push([x, PERCH.steps.z]);
      const L = Math.hypot(top[0] - PERCH.c[0], top[2] - PERCH.steps.z);
      for (let s = 0.1; s <= L; s += 0.1) pts.push([lerp(PERCH.c[0], top[0], s / L), lerp(PERCH.steps.z, top[2], s / L)]);
      for (const [x, z] of pts) {
        const h = g.column(x, z).find((q) => q.y <= prev + MOVER.stepUp + 0.005 && q.ny > 0.3);
        if (!h) {
          ok = false;
          at = [r2(x), r2(z)];
          break;
        }
        maxStep = Math.max(maxStep, h.y - prev);
        prev = h.y;
      }
    }
    stats.perchRamp = { maxStep: +maxStep.toFixed(3), top: prev === undefined ? null : +prev.toFixed(3) };
    if (!ok || Math.abs(prev - PERCH.top) > 0.1) bad.push(`perch: the decoded ramp does not climb from perch_foot to the perch top with steps ≤ ${MOVER.stepUp} (${at ? `stuck at (${at})` : `ends at ${prev?.toFixed(2)}, top ${PERCH.top}`})`);
  }

  // ---- 6. node names
  {
    const seen = new Map();
    for (const [asset, d] of [["cave/mesh_a", A], ["cave/mesh", BE], ["cave/outcrop", O]])
      for (const n of d.names) {
        const k = n.toLowerCase(), was = seen.get(k);
        if (was && was.name !== n) bad.push(`node names ${was.name} (${was.asset}) and ${n} (${asset}) differ only by case`);
        if (!was) seen.set(k, { name: n, asset });
      }
  }
  return { bad, stats };
}

export async function buildCave({ emit, SRC }) {
  const t0 = performance.now();
  const data = buildCaveData({ log: console.log });
  const { report } = data;
  for (const w of report.warnings) console.warn("  warning:", w);
  if (report.errors.length) throw new Error("cave validation failed:\n  " + report.errors.join("\n  "));

  // texture mean colours (the untextured look); the KTX2 sets are encoded and emitted after every check
  const means = {};
  for (const [k, t] of Object.entries(CAVE_TEX)) means[k] = await meanColor(await fs.readFile(path.join(SRC, "textures", t.src, "Diffuse.jpg")));

  const webAtlas = await buildWebAtlas();
  const materialsJSON = {};
  /** materials for one document */
  const makeMats = (doc) => {
    const cache = {};
    let webTex = null;
    return async (name) => {
      if (cache[name]) return cache[name];
      let m;
      if (MATS[name]) {
        const t = MATS[name].tex, tex = CAVE_TEX[t];
        m = doc.createMaterial(name).setBaseColorFactor(means[t]).setRoughnessFactor(1).setMetallicFactor(0);
        const textures = { albedo: texId(t, "d"), normal: texId(t, "n"), orm: texId(t, "arm") };
        m.setExtras({ textures, tile: tex.tile, source: tex.src, uv: "TEXCOORD_0 is box-projected world position / tile (texture repeats)" });
        materialsJSON[name] = { textures, tile: tex.tile, source: tex.src, note: MATS[name].note };
      } else if (name === "cave_water") {
        m = doc.createMaterial(name).setBaseColorFactor([0.02, 0.035, 0.04, 0.75]).setAlphaMode("BLEND").setRoughnessFactor(0.08).setMetallicFactor(0);
        m.setExtras({ textures: { normal: "fx/water_n" }, flow: "u along the stream at ~0.6 m/s (scroll uOffset by 0.3/s), two samples at different scales" });
        materialsJSON[name] = { textures: { normal: "fx/water_n" }, note: "alpha blend 0.75; scroll the normal map along u" };
      } else if (name === "cave_web" || name === "cave_cocoon") {
        webTex ??= await ktxTexture(doc, "cave_webs", webAtlas, "colorHQ", 1024);
        m = doc.createMaterial(name).setBaseColorTexture(webTex).setMetallicFactor(0);
        if (name === "cave_web") m.setAlphaMode("BLEND").setDoubleSided(true).setRoughnessFactor(0.35).setEmissiveFactor([0.05, 0.05, 0.05]);
        else m.setRoughnessFactor(0.7);
        materialsJSON[name] = { embedded: "web atlas (orb, corner, sheet, cocoon)", note: name === "cave_web" ? "alpha blend, double-sided; disable depth write at runtime" : "opaque silk" };
      } else if (name === "cave_eggsac") {
        m = doc.createMaterial(name).setBaseColorFactor([0.08, 0.3, 0.26, 1]).setEmissiveFactor([0.25, 0.85, 0.75]).setRoughnessFactor(0.4).setMetallicFactor(0);
        m.setExtension("KHR_materials_emissive_strength", doc.createExtension(KHRMaterialsEmissiveStrength).createEmissiveStrength().setEmissiveStrength(1.8));
        materialsJSON[name] = { note: "emissive teal (bloom on high quality)" };
      } else if (name === "cave_fissure") {
        m = doc.createMaterial(name).setBaseColorFactor([0, 0, 0, 1]).setEmissiveFactor([0.62, 0.7, 0.8]).setRoughnessFactor(1).setMetallicFactor(0);
        m.setExtension("KHR_materials_emissive_strength", doc.createExtension(KHRMaterialsEmissiveStrength).createEmissiveStrength().setEmissiveStrength(3));
        materialsJSON[name] = { note: "emissive daylight slot" };
      } else if (name === "outcrop_plug") {
        m = doc.createMaterial(name).setBaseColorFactor([0.004, 0.004, 0.004, 1]).setRoughnessFactor(1).setMetallicFactor(0);
        materialsJSON[name] = { note: "black void card" };
      } else throw new Error(`cave: unknown material ${name}`);
      cache[name] = m;
      return m;
    };
  };
  const nodesJSON = {};
  async function buildDoc(rootName, groups) {
    const doc = new Document();
    doc.createBuffer();
    const scene = doc.createScene(rootName);
    const root = doc.createNode(rootName);
    scene.addChild(root);
    const mat = makeMats(doc);
    for (const g of groups) {
      const renderName = g === "O" ? "outcrop_rock" : `cave_${g}`, colName = g === "O" ? "outcrop_col" : `cave_${g}_col`;
      const mesh = doc.createMesh(renderName);
      for (const [mname, geo] of Object.entries(data.render[g])) if (geo.tris) mesh.addPrimitive(makePrimitive(doc, geo.geometry(), await mat(mname)));
      root.addChild(doc.createNode(renderName).setMesh(mesh));
      root.addChild(doc.createNode(colName).setMesh(doc.createMesh(colName).addPrimitive(makePrimitive(doc, data.colliders[g].geometry()))));
      nodesJSON[renderName] = { asset: null, kind: "render", group: g, materials: Object.keys(data.render[g]).filter((k) => data.render[g][k].tris) };
      nodesJSON[colName] = { asset: null, kind: "collider", group: g };
    }
    for (const [name, e] of Object.entries(data.extra)) {
      if (!groups.includes(e.group)) continue;
      if (e.colOnly) {
        root.addChild(doc.createNode(name).setMesh(doc.createMesh(name).addPrimitive(makePrimitive(doc, e.col.geometry()))));
        nodesJSON[name] = { asset: null, kind: "collider", group: e.group, note: e.note };
        continue;
      }
      const holder = e.col ? doc.createNode(name) : null;
      const meshName = e.meshName ?? name;
      const mesh = doc.createMesh(meshName);
      for (const [mname, geo] of Object.entries(e.geo)) {
        if (!geo.tris) continue;
        const g = geo.geometry();
        const prim = makePrimitive(doc, mname === "cave_water" ? { ...g, colors: undefined } : g, await mat(mname));
        if (geo.uv2) prim.setAttribute("TEXCOORD_1", doc.createAccessor().setType("VEC2").setArray(new Float32Array(geo.uv2)).setBuffer(doc.getRoot().listBuffers()[0]));
        mesh.addPrimitive(prim);
      }
      const meshNode = doc.createNode(meshName).setMesh(mesh);
      if (holder) {
        root.addChild(holder);
        holder.addChild(meshNode);
        holder.addChild(doc.createNode(e.colName).setMesh(doc.createMesh(e.colName).addPrimitive(makePrimitive(doc, e.col.geometry()))));
        nodesJSON[name] = { asset: null, kind: "group", group: e.group, children: [meshName, e.colName], note: e.note };
      } else {
        root.addChild(meshNode);
        nodesJSON[name] = { asset: null, kind: "render", group: e.group, note: e.note };
      }
    }
    return finalizeCave(doc);
  }
  const assetOf = { A: "cave/mesh_a", B: "cave/mesh", C: "cave/mesh", D: "cave/mesh", E: "cave/mesh", O: "cave/outcrop" };
  // container roots: no node name may differ from another only by case (cave_a vs cave_A)
  const glbA = await buildDoc("cave_a_root", ["A"]);
  const glbBE = await buildDoc("cave_root", ["B", "C", "D", "E"]);
  const glbO = await buildDoc("outcrop_root", ["O"]);
  for (const v of Object.values(nodesJSON)) v.asset = assetOf[v.group];
  // the outdoor set, the enclosure, rails, gates, perch ramp and node names, on the decoded GLBs
  const decoded = { A: await decodeGLB(glbA), BE: await decodeGLB(glbBE), O: await decodeGLB(glbO) };
  _debug.last = { data, decoded };
  const outdoor = await checkOutdoor(data, decoded);
  Object.assign(report.stats, outdoor.stats);

  const json = {
    version: 1,
    assets: { "cave/mesh_a": "zone A (keep segment)", "cave/mesh": "zones B–E behind the mouth plug (exit segment)", "cave/outcrop": "outcrop skin, platform, the mouth stub in front of the plug, rails, mouth plug (muster segment, with the town; covers EXIT_HOLE; binds only cave/tex/moss_*, also muster)" },
    frame: "world coordinates: add each container at the origin (no parenting, no recentring); node transforms come from mesh quantisation",
    yawConvention: "atan2(−dx, −dz) of the facing direction; facing −Z = 0, west = π/2, east = −π/2",
    nodes: nodesJSON,
    materials: materialsJSON,
    anchors: data.anchors,
    paths: { den_path: data.den_path, walk: data.walk, chasm: CHASM, note: "walk = tunnel centre floors every 2 m (collider heights), continuous from breach to balcony_mouth except across the gallery chasm (x, z ranges in `chasm`)" },
    zones: Object.fromEntries(Object.entries(data.zones).map(([k, v]) => [k, { ...v, profile: k === "E" ? "climb-out" : "cave" }])),
    zoneOrder: "define A, B, C, D, E in this order with equal priority: overlapping boxes resolve to the earlier zone",
    volumes: {
      respawn_gallery: { min: [32, 0, -735.5], max: [64, 25.5, -727.5], to: ["lever_stance", "gal_s_cp"], note: "fade 0.6 s, teleport to the bank last stood on, no damage" },
      respawn_outcrop: { min: data.respawn.min, max: data.respawn.max, to: ["platform"], note: `y < ${OUTCROP.respawn.y} over the outcrop's skin + ${OUTCROP.respawn.margin} m, north to z ${OUTCROP.respawn.z0} (the climb runs below 50 m further north); a safety net: the deck is closed` },
      water: { min: [30, WATER.bed - 0.3, -737], max: [66, WATER.y, -725], surface: WATER.y, bed: WATER.bed, note: "slow the player to 0.65× and splash inside; the ribbon has no collider" },
      spider_arena: { min: [9, 26, -757], max: [27, 36, -743] },
      chasm: { x: 48, z: [-727.5, -735.5], note: "drawbridge gap; jump ≤ 5.8 m" },
    },
    webs: data.webs,
    stair: { ...report.stats.stair, slabs: data.stair.slabs.map((s) => ({ k: s.k, top: +s.top.toFixed(3), s: [r2(s.sa), r2(s.sb)], node: s.group === "O" ? "outcrop_rock" : `cave_${s.group}` })), ramp: data.stair.ramp, note: "rock slabs on the climb; the collider is one ramp through the tread middles (in cave_D_col / cave_E_col; the cells in front of the mouth plug also in outcrop_col). The slabs in front of the plug are in outcrop_rock (moss)" },
    perch: { top: PERCH.top, box: { min: PERCH_MIN, max: PERCH_MAX }, steps: data.perchSteps.steps.map((s) => ({ top: +s.top.toFixed(3), x: [r2(s.xa), r2(s.xb)] })), z: [r2(data.perchSteps.z0), r2(data.perchSteps.z1)], ramp: { ...data.perchSteps.ramp, deg: +data.perchSteps.ramp.deg.toFixed(1) } },
    outcrop: {
      platform: { y: PLAT.y, x: PLAT.x, z: PLAT.z, centre: PLAT.centre },
      vista: report.stats.vista,
      viewCorridor: { points: Object.values(report.stats.vista).map((v) => v.leavesDeck.at), note: "the vista lines leave the deck here 0.8–1.4 m above it: keep anything taller than 0.7 m at least 1.5 m away" },
      rails: { minHeight: OUTCROP.rails.h, open: OUTCROP.rails.open, walls: OUTCROP.rails.walls, thickness: OUTCROP.rails.t, note: "outcrop_rails_col: one box per wall from a to b (x/z, +0.15 m past both ends) over y; N is 1.2 m thick toward −z (into the hood), the others 0.3 m centred. S and E are the rails over the open edges; W and N keep anyone on the outcrop's top from dropping onto the deck" },
      mouthStub: { plane: { point: r3v(PLUG_PLANE.p), normal: r3v(PLUG_PLANE.t) }, behind: MOUTH.behind, note: "the cave in front of the plug's plane (and up to `behind` m behind it) ships in cave/outcrop: outcrop_rock (material cave_moss) and outcrop_col, the top stair slabs and their ramp included" },
      enclosure: outdoor.stats.enclosure,
      mouthPlug: data.plugInfo,
      hole: { id: EXIT_HOLE.id, render: EXIT_HOLE.render, samples: EXIT_HOLE.samples, cover: EXIT_HOLE.cover },
      scatterExclusion: SCATTER_EXCLUDE.map((e) => ({ centre: [e.x, e.z], radius: e.r, note: "tools/gen/scatter.mjs SCATTER_EXCLUDE" })),
      props: [
        { name: "brow", suggest: "ph/rock_face_02", pos: [-19.0, 60.5, -674.6], yaw: 0, note: "over the mouth (design §4.4)" },
        ...data.lip.map((l, i) => ({ name: `lip_${i + 1}`, suggest: i % 2 ? "ph/rock_moss_set_01" : "ph/boulder_01", pos: l.pos, scale: 0.9, note: "boulder lip 0.8–1.2 m along the S and E edges, clear of the view corridor" })),
      ],
    },
    dressing: { cocoons: data.cocoons, eggs: data.eggList, fissure: data.fissureInfo },
    lights: {
      light_camp_fire: { pos: add(data.anchors.camp_fire.pos, [0, 0.5, 0]), kind: "fire", hint: { intensity: 10, range: 18, color: [1, 0.55, 0.25] } },
      light_eggs: { pos: add(data.eggList[0]?.c ?? [21, 28.5, -755], [0, 0.4, 0]), kind: "point", hint: { intensity: 0.6, range: 5, color: [0.25, 0.85, 0.75] } },
      light_den_fissure: { pos: data.fissureInfo.centre, kind: "spot", dir: [0, -1, 0], hint: { intensity: 30, range: 25, angle: 0.6, color: [0.7, 0.78, 0.9] }, note: "cosmetic daylight (design §4.3 den)" },
    },
    // the joins with other steps' assets, checked again by tools/build-assets.mjs before the manifest is written
    joins: {
      drain: { keep: { min: BREACH.keep.min.map((v) => +v.toFixed(4)), max: BREACH.keep.max.map((v) => +v.toFixed(4)) }, clipZ: +BREACH.clipZ.toFixed(4), source: "tools/gen/keepinterior.mjs AIR room drain + ORIGIN (world); must equal keep/anchors rooms.drain worldMin/worldMax" },
    },
    stats: report.stats,
  };
  // the shipped files, decoded: their colliders (quantised, in world space) must still carry every
  // anchor and the walk path, as the runtime will build them (removable colliders left out)
  const bad = await checkEncoded(data, [glbA, glbBE, glbO]);
  bad.push(...outdoor.bad);
  if (bad.length) throw new Error(`cave: the encoded colliders fail (${bad.length}):\n  ` + bad.slice(0, 20).join("\n  "));

  // ---- emit (nothing is written before every check has passed)
  for (const [k, t] of Object.entries(CAVE_TEX)) {
    const dir = path.join(SRC, "textures", t.src);
    const pos = t.segment === "keep" ? [50, -725] : [-17, -673];
    await emit(texId(k, "d"), { segment: t.segment, priority: 92, type: "ktx2", ext: "ktx2", data: await toKTX2(await fs.readFile(path.join(dir, "Diffuse.jpg")), { preset: "color", maxSize: 1024 }), pos });
    await emit(texId(k, "n"), { segment: t.segment, priority: 90, type: "ktx2", ext: "ktx2", data: await toKTX2(await fs.readFile(path.join(dir, "nor_gl.jpg")), { preset: "normal", maxSize: 512 }), pos });
    await emit(texId(k, "arm"), { segment: t.segment, priority: 88, type: "ktx2", ext: "ktx2", data: await toKTX2(await fs.readFile(path.join(dir, "arm.jpg")), { preset: "linear", maxSize: 512 }), pos });
  }
  await emit("fx/water_n", { segment: "keep", priority: 90, type: "ktx2", ext: "ktx2", data: await toKTX2(await buildWaterNormal(), { preset: "normal", maxSize: 512 }), pos: [48, -731] });
  await emit("cave/mesh_a", { segment: "keep", priority: 93, type: "glb", ext: "glb", data: glbA, pos: [50, -715] });
  await emit("cave/mesh", { segment: "exit", priority: 95, type: "glb", ext: "glb", data: glbBE, pos: [-10, -730] });
  await emit("cave/outcrop", { segment: "muster", priority: 90, type: "glb", ext: "glb", data: glbO, pos: [-17, -673] });
  await emit("cave/anchors", { segment: "keep", priority: 95, type: "json", ext: "json", data: Buffer.from(JSON.stringify(json)), pos: [50, -715] });
  console.log(`  cave stats: cover ${report.stats.minRockCover} m, clearance ${report.stats.probes.minClearance}, half-width ${report.stats.probes.minHalfWidth}, winding ${report.stats.wrongWindingPct} %, ${Object.keys(data.anchors).length} anchors; ${((performance.now() - t0) / 1000).toFixed(1)} s`);
}

export const _debug = { S, air, outcrop, ground, Hc, Hrender, surfaceClass, zoneOf, floorAt, clearAt, tunnelAt, nearestSeg, SEGS, TUNNEL_LEN, T, TriGrid, walkFill, runtimeFieldTris, renderTerrainTris, checkOutdoor, decodeGLB, plugSide, inStub, PLUG_PLANE, MOUTH_PT, JUMP_REACH, heightAtRuntime, last: null };
