// Keep interior (design §4.2): a room graph of axis-aligned air boxes in the keep's local frame,
// meshed with ~0.5 m subdivided faces so the vertex colours can carry the baked lighting:
//   COLOR_0 = AO (5 probes against a union-of-boxes SDF) × (0.35 + warm falloff from the light
//             anchors, occlusion-tested) × grime (darker below 0.6 m, soot above flames) × noise
//
// Outputs (buildKeepInterior → emit):
//   keep/interior  glb   keep_interior
//                          keep_gf, keep_stair, keep_bs            render meshes, one primitive per material
//                          keep_gf_col, keep_stair_col, keep_bs_col collider meshes (no material): unsubdivided
//                                                                  boxes + one 35.5° ramp per stair flight
//                          door_* (hinge, identity = closed)  -> door_*_leaf, door_*_col
//                          drain_plug                         -> drain_plug_mesh, drain_plug_col
//                          anchors -> anchor_<name>  empty nodes: lights, spawns, marks, interactables,
//                                                    props, cameras, checkpoints (local −Z = facing);
//                                                    zones/blockers carry their half extents as scale
//   keep/anchors   json  the same anchors, doors, zones, blockers and rooms in keep-local and world
//                        coordinates (see docs/design/keep-exit-chapters.md, "Pipeline outputs")
//
// Frame: keep-local, +X east, +Y up, −Z north, origin on the keep's base at its centre. World =
// ORIGIN + local (the keep's yaw is 0): parent keep_interior under the keep's holder node.
// The generator is self-contained (geometry + data + validation + glTF); only emit/SRC come in.
import fs from "node:fs/promises";
import path from "node:path";
import { Document } from "@gltf-transform/core";
import { MeshBuilder, makePrimitive, pbr, ktxTexture, finalize } from "../lib/gltf.mjs";
import { euler, apply, cylinder } from "./shapes.mjs";
import { fbm } from "./world.mjs";
import { KEEP, POSTERN } from "./townbuildings.mjs";
import { KEEP_HOLE } from "./terrainHoles.mjs";

// ------------------------------------------------------------------ frame and levels
/** keep-local → world offset: (60, heightAt(60, −662) − 0.2, −662), design §4 */
export const ORIGIN = [60, 37.73, -662];
/** ground-floor top and basement floor, keep-local (world 38.13 / 32.13) */
export const GF = KEEP.floorY;
export const BS = -5.6;
const GFW = +(ORIGIN[1] + GF).toFixed(2), BSW = +(ORIGIN[1] + BS).toFixed(2);
/** inner faces of the keep shell (±11.8, ±7.8) less 2 cm, so the linings never z-fight with the shell */
const SX = KEEP.w / 2 - KEEP.wall - 0.02, SZ = KEEP.d / 2 - KEEP.wall - 0.02;
const DOOR_W = 1.4, DOOR_H = 2.4;

// ------------------------------------------------------------------ materials
/** Poly Haven CC0 sets (tools/sources.mjs). tile = physical size in metres. */
export const MATERIALS = {
  castle: { src: "castle_wall_slates", tile: 2.5, size: 1024 },
  brick: { src: "stone_brick_wall_001", tile: 2.5, size: 1024 },
  floor: { src: "rock_tile_floor", tile: 1.96, size: 1024 },
  wood: { src: "dark_wooden_planks", tile: 2.0, size: 512 },
  iron: { src: "rusty_metal_02", tile: 1.0, size: 512, metal: 1 },
  planks: { src: "old_planks_02", tile: 2.0, size: 512 },
  dark: { color: [0.015, 0.014, 0.013, 1], rough: 1 },
};

// ------------------------------------------------------------------ vector helpers
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = (a) => Math.hypot(a[0], a[1], a[2]);
const norm = (a) => mul(a, 1 / (len(a) || 1));
const r3 = (v) => v.map((x) => +x.toFixed(3));
const toWorld = (p) => r3(add(p, ORIGIN));
const toLocal = (w) => sub(w, ORIGIN);
const smoothstep = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
/** game yaw convention (design §4): facing direction d → atan2(−dx, −dz); facing −Z = 0, west = π/2 */
const yawOf = (d) => Math.atan2(-d[0], -d[2]);
const transpose = (m) => [m[0], m[3], m[6], m[1], m[4], m[7], m[2], m[5], m[8]];
const AX = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];

// ------------------------------------------------------------------ shapes
// Air: axis-aligned boxes (rooms, door openings, passages) plus the torture-room vault. Solids:
// boxes (optionally rotated) standing in the air: pillars, beams, stairs, landings, rubble.

/**
 * @param kind room | door (a doorway with a leaf) | pass (an open passage) | hidden (cuts faces of
 *   its neighbours but renders nothing: openings the keep shell already frames) | ao (lighting only)
 */
function air(name, x, y, z, o = {}) {
  return {
    name, kind: o.kind ?? "room", node: o.node ?? "gf",
    min: [x[0], y[0], z[0]], max: [x[1], y[1], z[1]],
    wall: o.wall ?? "castle", floor: o.floor ?? "floor", ceil: o.ceil ?? "planks",
    noCeil: !!o.noCeil, cuts: o.cuts ?? {}, cell: o.cell ?? 0.5, ceilCell: o.ceilCell ?? 1.0,
    floorCol: o.floorCol ?? true, label: o.label,
  };
}
const inBox = (b, p) => p[0] > b.min[0] && p[0] < b.max[0] && p[1] > b.min[1] && p[1] < b.max[1] && p[2] > b.min[2] && p[2] < b.max[2];
function sdAABB(b, p) {
  let o = 0, i = -Infinity;
  for (let k = 0; k < 3; k++) {
    const c = (b.min[k] + b.max[k]) / 2, h = (b.max[k] - b.min[k]) / 2;
    const d = Math.abs(p[k] - c) - h;
    o += Math.max(d, 0) ** 2;
    i = Math.max(i, d);
  }
  return Math.sqrt(o) + Math.min(i, 0);
}

/** Solid box. rot = Euler XYZ (shapes.mjs convention); col: false | true (its own box) */
function solid(name, c, s, mat, o = {}) {
  const rot = o.rot ?? [0, 0, 0];
  const R = euler(rot);
  const aligned = rot.every((r) => Math.abs(r) < 1e-9);
  const h = mul(s, 0.5);
  let min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) {
    const p = add(c, apply(R, [sx * h[0], sy * h[1], sz * h[2]]));
    min = min.map((v, k) => Math.min(v, p[k]));
    max = max.map((v, k) => Math.max(v, p[k]));
  }
  return {
    name, c, s, h, R, Rt: transpose(R), rot, aligned, min, max, mat, node: o.node ?? "gf",
    col: o.col ?? true, cell: o.cell ?? 0.5, occlude: o.occlude ?? true, tile: o.tile, kind: "solid",
  };
}
const inSolid = (s, p) => {
  const q = apply(s.Rt, sub(p, s.c));
  return Math.abs(q[0]) < s.h[0] && Math.abs(q[1]) < s.h[1] && Math.abs(q[2]) < s.h[2];
};
function sdSolid(s, p) {
  const q = apply(s.Rt, sub(p, s.c));
  let o = 0, i = -Infinity;
  for (let k = 0; k < 3; k++) {
    const d = Math.abs(q[k]) - s.h[k];
    o += Math.max(d, 0) ** 2;
    i = Math.max(i, d);
  }
  return Math.sqrt(o) + Math.min(i, 0);
}

// ------------------------------------------------------------------ layout (design §4.2, keep-local)
const G = (dy) => GF + dy, B = (dy) => BS + dy;

/** B3 torture room: walls to the springing line, a segmental barrel vault (axis along X) above */
export const VAULT = { x0: -10.6, x1: -1.0, z0: -1.4, z1: 7.6, spring: B(2.6), crown: B(4.4) };
{
  const c = VAULT.z1 - VAULT.z0, h = VAULT.crown - VAULT.spring;
  VAULT.R = (c * c / 4 + h * h) / (2 * h);
  VAULT.zc = (VAULT.z0 + VAULT.z1) / 2;
  VAULT.yc = VAULT.crown - VAULT.R;
  VAULT.th = Math.asin(c / 2 / VAULT.R);
}
const inVault = (p) => p[0] > VAULT.x0 && p[0] < VAULT.x1 && p[1] > VAULT.spring - 1e-6 && (p[2] - VAULT.zc) ** 2 + (p[1] - VAULT.yc) ** 2 < VAULT.R ** 2;
const sdVault = (p) => Math.max(Math.abs(p[0] - (VAULT.x0 + VAULT.x1) / 2) - (VAULT.x1 - VAULT.x0) / 2, VAULT.spring - p[1], Math.hypot(p[2] - VAULT.zc, p[1] - VAULT.yc) - VAULT.R);

/** cell blocks of B4: 5 bands of 3.4 m from z −2.4, west x −10.5…−7.1 and east x −4.7…−1.3 */
export const CELLS = { bandTop: -2.4, band: 3.4, wall: 0.4, west: [-10.5, -7.1], east: [-4.7, -1.3], ceil: B(3.2) };
const cellZ = (k) => {
  const top = CELLS.bandTop - CELLS.band * k;
  return [top - CELLS.band + CELLS.wall / 2, top - CELLS.wall / 2];
};

const BS_ROOM = { node: "bs", wall: "brick", ceil: "brick", ceilCell: 0.75 };
export const AIR = [
  // ---- ground floor
  air("G1", [-6, 6], [GF, 6.4], [-1.6, SZ], { label: "hall", cell: 0.6 }),
  air("G2", [-SX, -6.6], [GF, 4.4], [-3.0, SZ], { label: "west guard room" }),
  air("G2n", [-SX, -6.6], [GF, 6.0], [-SZ, -3.0], { label: "west guard room, collapsed bay" }),
  air("G3", [-6, 6], [GF, 4.4], [-SZ, -2.2], { label: "barracks" }),
  air("G4", [6.6, SX], [GF, 4.4], [1.2, SZ], { label: "storeroom" }),
  air("G5t", [6.6, SX], [GF, 4.4], [-1.2, 0.6], { node: "stair", label: "stair top landing" }),
  air("G5", [6.6, SX], [BS, 4.4], [-SZ, -1.2], { node: "stair", label: "stairwell", wall: "split", floor: "floor", cuts: { y: [GF] } }),
  air("g2_door", [-6.6, -6.0], [GF, G(DOOR_H)], [4.3, 5.7], { kind: "door", ceil: "castle" }),
  air("g3_door", [-0.7, 0.7], [GF, G(DOOR_H)], [-2.2, -1.6], { kind: "pass", ceil: "castle" }),
  air("store_door", [6.0, 6.6], [GF, G(DOOR_H)], [3.0, 4.4], { kind: "door", ceil: "castle" }),
  air("stair_door", [9.0, 10.4], [GF, G(DOOR_H)], [0.6, 1.2], { kind: "door", node: "stair", ceil: "castle" }),
  air("gate", [-KEEP.gateW / 2, KEEP.gateW / 2], [GF, KEEP.gateH], [SZ, KEEP.d / 2], { kind: "hidden" }),
  air("postern", [-KEEP.w / 2 + 0.6, -SX], [POSTERN.y0, POSTERN.y1], [POSTERN.z0, POSTERN.z1], { kind: "hidden" }),
  // ---- basement
  air("B1", [6.6, SX], [BS, -2.0], [-1.2, SZ], { ...BS_ROOM, label: "stair foot" }),
  air("B2", [-0.4, 6.6], [BS, -2.6], [4.4, 6.8], { ...BS_ROOM, label: "corridor" }),
  air("B3", [VAULT.x0, VAULT.x1], [BS, VAULT.spring], [VAULT.z0, VAULT.z1], { ...BS_ROOM, noCeil: true, label: "torture room" }),
  air("torture_door", [-1.0, -0.4], [BS, B(DOOR_H)], [4.9, 6.3], { ...BS_ROOM, kind: "door" }),
  air("cell_gate", [-7.1, -4.7], [BS, B(2.6)], [-2.0, -1.4], { ...BS_ROOM, kind: "door" }),
  air("B4", [-7.1, -4.7], [BS, CELLS.ceil], [-20, -2.0], { ...BS_ROOM, label: "cell corridor" }),
  ...[0, 1, 2, 3, 4].flatMap((k) => [
    air(`cell_w${k + 1}`, CELLS.west, [BS, CELLS.ceil], cellZ(k), { ...BS_ROOM, label: `west cell ${k + 1}` }),
    air(`cell_e${k + 1}`, CELLS.east, [BS, CELLS.ceil], cellZ(k), { ...BS_ROOM, label: `east cell ${k + 1}` }),
  ]),
  air("B5", [-11, -1], [BS, B(3.4)], [-26, -20], { ...BS_ROOM, label: "guard room J" }),
  air("drain", [-7.1, -4.7], [BS, B(2.6)], [-26.6, -26], { ...BS_ROOM, kind: "pass", label: "drain to the cave (anchor breach)" }),
  // the cave tunnel continues past the drain (tools/gen/cave.mjs); drain_plug closes it until then
  air("drain_beyond", [-7.1, -4.7], [BS, B(2.6)], [-27.6, -26.6], { kind: "hidden" }),
  // ---- outside, for the lighting bake only (light falls in through the gate and the postern)
  air("out_s", [-40, 40], [GF - 0.6, 30], [KEEP.d / 2, 40], { kind: "ao" }),
  air("out_w", [-40, -KEEP.w / 2], [GF - 0.6, 30], [-20, 20], { kind: "ao" }),
];
const AIR_BY = Object.fromEntries(AIR.map((a) => [a.name, a]));
const roomOf = (name) => AIR_BY[name];

// stairs (G5): flight A along the east wall from the top landing down to the mid landing,
// flight B along the west wall from the mid landing down to the stair foot (B1)
export const STAIRS = {
  steps: 14, rise: 3 / 14, run: 0.3,
  A: { x: [9.9, SX], z0: -1.2, dir: -1, top: GF, bottom: B(3) },
  B: { x: [6.6, 8.5], z0: -5.4, dir: +1, top: B(3), bottom: BS },
  mid: { z: [-SZ, -5.4], y: B(3) },
  core: { x: [8.5, 9.9], z: [-5.4, -1.2], top: G(1.0) },
};

const SOLIDS = [];
const S = (...a) => SOLIDS.push(solid(...a));
{
  // hall: two pillars under a girder, joists under the plank ceiling
  for (const x of [-3, 3]) {
    S(`pillar_${x < 0 ? "w" : "e"}`, [x, G(2.75), 2], [0.9, 5.5 - 0.0, 0.9], "castle", { cell: 0.6 });
    S(`pillar_base_${x < 0 ? "w" : "e"}`, [x, G(0.12), 2], [1.15, 0.24, 1.15], "castle", { cell: 0.6 });
    S(`pillar_cap_${x < 0 ? "w" : "e"}`, [x, 5.9 - 0.1, 2], [1.1, 0.2, 1.1], "castle", { cell: 0.6, col: false });
  }
  S("girder", [0, 6.15, 2], [12, 0.5, 0.42], "wood", { cell: 2, col: false });
  for (let i = -3; i <= 3; i++) S(`joist_g1_${i + 3}`, [i * 1.6, 6.26, (-1.6 + SZ) / 2], [0.22, 0.28, SZ + 1.6], "wood", { cell: 3, col: false, occlude: false });
  // joists under the 4.4 m ceilings
  const joists = (room, axis, step, skip = () => false) => {
    const a = roomOf(room);
    const [u0, u1] = axis === "x" ? [a.min[2], a.max[2]] : [a.min[0], a.max[0]];
    const n = Math.floor((u1 - u0) / step);
    const off = (u1 - u0 - (n - 1) * step) / 2;
    for (let i = 0; i < n; i++) {
      const u = u0 + off + i * step;
      if (skip(u)) continue;
      const span = axis === "x" ? a.max[0] - a.min[0] : a.max[2] - a.min[2];
      const mid = axis === "x" ? [(a.min[0] + a.max[0]) / 2, a.max[1] - 0.13, u] : [u, a.max[1] - 0.13, (a.min[2] + a.max[2]) / 2];
      const size = axis === "x" ? [span, 0.26, 0.2] : [0.2, 0.26, span];
      S(`joist_${room}_${i}`, mid, size, "wood", { cell: 3, col: false, occlude: false, node: a.node });
    }
  };
  joists("G2", "x", 1.25);
  joists("G3", "z", 1.5);
  joists("G4", "x", 1.3);
  joists("G5t", "x", 0.9);
  joists("G5", "x", 1.3);
  // G2 collapse: broken joist stubs at the edge of the fallen bay, rubble and fallen beams (seeded)
  for (let i = 0; i < 6; i++) {
    const L = 0.35 + ((i * 37) % 5) * 0.12;
    S(`board_stub_${i}`, [-11.4 + i * 0.85, G(3.97), -3.0 - L / 2 + 0.1], [0.19, 0.04, L], "planks", { rot: [-0.15 - ((i * 13) % 4) * 0.08, 0, 0], cell: 3, col: false, occlude: false });
  }
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
  for (let i = 0; i < 16; i++) {
    const z = -SZ + 0.3 + rnd() * 3.0, x = -SX + 0.4 + rnd() * 4.3;
    const hgt = Math.max(0.1, 1.3 * (1 - (z + SZ) / 3.4)) * (0.6 + rnd() * 0.6);
    const s = [0.45 + rnd() * 0.6, 0.3 + rnd() * 0.35, 0.4 + rnd() * 0.5];
    S(`rubble_${i}`, [x, G(Math.max(s[1] / 2 - 0.08, hgt - s[1] / 2)), z], s, "castle", { rot: [(rnd() - 0.5) * 0.5, rnd() * 3, (rnd() - 0.5) * 0.5], col: false, cell: 0.5 });
  }
  S("fallen_beam_0", [-10.4, G(2.0), -4.75], [0.24, 0.3, 5.2], "wood", { rot: [-0.82, 0.1, 0], col: false, cell: 1 });
  S("fallen_beam_1", [-7.6, G(0.75), -6.2], [0.22, 0.26, 3.4], "wood", { rot: [0.25, -0.5, 0.1], col: false, cell: 1 });
  S("fallen_beam_2", [-10.9, G(0.5), -6.6], [3.0, 0.24, 0.22], "wood", { rot: [0.05, 0.3, 0.2], col: false, cell: 1 });
  // storeroom: plank shelving on the east wall (the potion shelf prop hangs further south)
  for (const [i, y] of [0.35, 0.95, 1.55, 2.15].entries()) S(`shelf_${i}`, [SX - 0.24, G(y), 2.75], [0.46, 0.04, 2.6], "planks", { cell: 3, col: false, occlude: false });
  for (const z of [1.5, 4.0]) S(`shelf_post_${z}`, [SX - 0.24, G(1.15), z], [0.44, 2.3, 0.06], "planks", { cell: 3, col: false, occlude: false });
  // ---- stairwell (G5): flights, mid landing, the core wall between the flights
  const { A, B: FB, mid, core, rise, run, steps } = STAIRS;
  for (let k = 0; k < steps; k++) {
    const za = A.z0 + A.dir * run * k, zb = A.z0 + A.dir * run * (k + 1);
    const top = A.top - rise * (k + 1);
    S(`stepA_${k}`, [(A.x[0] + A.x[1]) / 2, (top + BS) / 2, (za + zb) / 2], [A.x[1] - A.x[0], top - BS, run], "floor", { node: "stair", col: false, cell: 1 });
  }
  for (let k = 0; k < steps - 1; k++) {
    const za = FB.z0 + FB.dir * run * k, zb = FB.z0 + FB.dir * run * (k + 1);
    const top = FB.top - rise * (k + 1);
    S(`stepB_${k}`, [(FB.x[0] + FB.x[1]) / 2, (top + BS) / 2, (za + zb) / 2], [FB.x[1] - FB.x[0], top - BS, run], "floor", { node: "stair", col: false, cell: 1 });
  }
  S("mid_landing", [(6.6 + SX) / 2, (mid.y + BS) / 2, (mid.z[0] + mid.z[1]) / 2], [SX - 6.6, mid.y - BS, mid.z[1] - mid.z[0]], "floor", { node: "stair", cell: 0.5 });
  S("stair_core_low", [(core.x[0] + core.x[1]) / 2, (GF + BS) / 2, (core.z[0] + core.z[1]) / 2], [core.x[1] - core.x[0], GF - BS, core.z[1] - core.z[0]], "brick", { node: "stair", col: false, cell: 0.5 });
  S("stair_core_high", [(core.x[0] + core.x[1]) / 2, (core.top + GF) / 2, (core.z[0] + core.z[1]) / 2], [core.x[1] - core.x[0], core.top - GF, core.z[1] - core.z[0]], "castle", { node: "stair", col: false, cell: 0.5 });
  // railing along the top landing's edge over flight B
  for (const x of [6.72, 7.6, 8.4]) S(`rail_post_${x}`, [x, G(0.5), -1.2 - 0.04], [0.08, 1.0, 0.08], "wood", { node: "stair", col: false, cell: 3, occlude: false });
  S("rail_top", [(6.6 + 8.5) / 2, G(1.0), -1.24], [8.5 - 6.6, 0.07, 0.1], "wood", { node: "stair", col: false, cell: 3, occlude: false });
  S("rail_mid", [(6.6 + 8.5) / 2, G(0.5), -1.24], [8.5 - 6.6, 0.05, 0.05], "wood", { node: "stair", col: false, cell: 3, occlude: false });
  // ---- basement: transverse ribs over the cell corridor, a step of masonry at the drain
  for (let k = 1; k <= 4; k++) S(`rib_b4_${k}`, [-5.9, CELLS.ceil - 0.15, CELLS.bandTop - CELLS.band * k], [2.4, 0.3, 0.35], "brick", { node: "bs", col: false, cell: 1, occlude: false });
}
const SOLID_BY = Object.fromEntries(SOLIDS.map((s) => [s.name, s]));

// ------------------------------------------------------------------ doors (design §3.1 tags)
// hinge: keep-local point on the hinge axis at the floor; along: closed leaf direction from the hinge;
// open: the side it swings to. The node is identity when closed; rotating it about its local +Y by
// t·openYaw (t 0…1) opens it.
export const DOORS = [
  { name: "door_g2", tag: "g2_door", passage: "g2_door", hinge: [-6.0 - 0.05, GF, 4.3 + 0.02], along: [0, 0, 1], open: [1, 0, 0], kind: "planks", initial: "closed", note: "hall ↔ G2; leaf on the hall side" },
  { name: "door_store", tag: "store_door", passage: "store_door", hinge: [6.6 - 0.06, GF, 4.4 - 0.02], along: [0, 0, -1], open: [1, 0, 0], kind: "planks", initial: "locked", note: "hall ↔ storeroom (locked; opened with the key ring)" },
  { name: "door_stair", tag: "stair_door", passage: "stair_door", hinge: [10.4 - 0.02, GF, 1.2 - 0.06], along: [-1, 0, 0], open: [0, 0, 1], kind: "planks", initial: "closed", note: "storeroom ↔ stair landing; swings into the storeroom" },
  { name: "door_torture", tag: "torture_door", passage: "torture_door", hinge: [-1.0 + 0.06, BS, 4.9 + 0.02], along: [0, 0, 1], open: [-1, 0, 0], kind: "planks", initial: "closed", note: "corridor B2 ↔ torture room B3; swings into B3 (door kick)" },
  { name: "door_cells", tag: "cell_gate", passage: "cell_gate", hinge: [-7.1 + 0.03, BS, -2.0 + 0.05], along: [1, 0, 0], open: [0, 0, -1], kind: "bars", width: 2.4 - 0.06, height: 2.6 - 0.02, maxOpen: (100 * Math.PI) / 180, initial: "open", note: "barred gate B3 → cell corridor; stands open" },
];
for (const d of DOORS) {
  d.width ??= DOOR_W - 0.04;
  d.height ??= DOOR_H - 0.03;
  d.thick = d.kind === "bars" ? 0.05 : 0.08;
  const s = Math.sign(cross(d.along, d.open)[1]);
  d.openYaw = s * (d.maxOpen ?? Math.PI / 2);
  d.baseYaw = Math.atan2(d.along[0], d.along[2]); // Ry(baseYaw)·(0,0,1) = along
}

// ------------------------------------------------------------------ anchors
// Marks the design gives in world coordinates (y null = the floor of the level named by `lvl`).
// kind: light | prop | use (interactable) | spawn | mark | cp (checkpoint) | camera | ext (outdoor)
const A = [];
const yawTo = (from, to) => yawOf(sub(to, from));
const FACE = { "-X": Math.PI / 2, "+X": -Math.PI / 2, "-Z": 0, "+Z": Math.PI };
function mark(name, kind, w, yaw = null, extra = {}) {
  A.push({ name, kind, world: w, yaw, ...extra });
}
// sconce on a wall: wall point (local), the wall's normal into the room; flame 0.22 m out, y given
function sconce(name, p, n, extra = {}) {
  const pos = add(p, mul(n, 0.22));
  A.push({ name, kind: "light", local: pos, yaw: yawOf(n), light: "sconce", wall: r3(p), normal: n, ...extra });
}
{
  const g = GFW, b = BSW;
  // ---- hall (G1)
  mark("prop_brazier_w", "prop", [55.2, g, -655.4], null, { prop: "kit/Cauldron", r: 0.45 });
  mark("light_brazier_w", "light", [55.2, g + 0.85, -655.4], null, { light: "brazier", fx: "FireFx 0.4" });
  mark("prop_brazier_e", "prop", [64.8, g, -655.4], null, { prop: "kit/Cauldron", r: 0.45 });
  mark("light_brazier_e", "light", [64.8, g + 0.85, -655.4], null, { light: "brazier", fx: "FireFx 0.4" });
  mark("prop_hall_table_1", "prop", [59.05, g, -661.5], 0, { prop: "ph/wooden_table_02", r: 0.75, note: "cover table ×2 at (60, −661.5)" });
  mark("prop_hall_table_2", "prop", [60.95, g, -661.5], 0, { prop: "ph/wooden_table_02", r: 0.75 });
  mark("use_weaponstand_imp", "use", [65.55, g, -656.75], FACE["-X"], { prop: "kit/WeaponStand", items: ["sword", "ph/kite_shield"], route: "imperial", r: 0.55, moved: "design (64.6, −655.0) overlapped the east brazier and stood 1.4 m off the wall" });
  mark("use_locker_imp", "use", [65.2, g, -661.0], FACE["-X"], { prop: "kit/Chest_Wood", route: "imperial", r: 0.5 });
  mark("mark_bond_player_imp", "mark", [60, g, -656.5], 0, { route: "imperial" });
  mark("mark_bond_ivo", "mark", [60, g, -658.3], Math.PI, { route: "imperial" });
  mark("cam_bonds_imp", "camera", [61.6, 39.7, -655.2], null, { lookAt: [60, 39.2, -657.6], route: "imperial" });
  mark("mark_e1i_retry_player", "mark", [60.5, g, -657.5], null, { route: "imperial" });
  mark("mark_e1i_retry_ivo", "mark", [61.5, g, -658.5], null, { route: "imperial" });
  mark("mark_e1r_retry_player", "mark", [54.6, g, -657.0], null, { route: "rebel" });
  mark("mark_e1r_retry_brun", "mark", [55.4, g, -656.6], null, { route: "rebel", moved: "design (53.6, −656.0) is inside the G1/G2 partition" });
  mark("blocker_gate", "blocker", null, null, { local: [0, G(2.5), 8.1], half: [2.0, 2.5, 0.15], tag: "blocker_gate", note: "added once both are inside (4 × 5 × 0.3 at z −653.9)" });
  sconce("light_hall_w", [-6.0, G(2.0), 1.0], [1, 0, 0]);
  sconce("light_hall_e", [6.0, G(2.0), -0.3], [-1, 0, 0]);
  sconce("light_hall_n1", [-3.6, G(2.0), -1.6], [0, 0, 1]);
  sconce("light_hall_n2", [3.6, G(2.0), -1.6], [0, 0, 1]);
  // ---- west guard room (G2) and the postern
  mark("use_chest_reb", "use", [49.0, g, -655.5], FACE["+X"], { prop: "kit/Chest_Wood", route: "rebel", r: 0.5, note: "confiscation chest" });
  mark("use_weaponstand_reb", "use", [49.0, g, -662.2], FACE["+X"], { prop: "kit/WeaponStand", items: ["ph/wooden_axe_03 (Brun's father's axe)", "sword", "axe"], route: "rebel", r: 0.55 });
  mark("mark_bond_player_reb", "mark", [52.0, g, -658.8], Math.PI / 2, { route: "rebel" });
  mark("mark_bond_brun", "mark", [50.6, g, -658.8], -Math.PI / 2, { route: "rebel" });
  mark("cam_bonds_reb", "camera", [52.9, 39.7, -657.2], null, { lookAt: [50.9, 39.2, -659.6], route: "rebel" });
  mark("mark_crushed_guard", "mark", [51.0, g, -666.5], null, { note: "under the rubble's south edge" });
  mark("light_g2_fire", "light", [50.4, g + 0.7, -667.6], null, { light: "fire", note: "fire glow in the collapse (pool light, no roof hole)" });
  sconce("light_g2_s", [-9.2, G(2.0), SZ], [0, 0, -1]);
  sconce("light_g2_e", [-6.6, G(2.0), 0.6], [-1, 0, 0]);
  mark("mark_postern_inside", "mark", [49.2, g, -659.0], FACE["+X"], { note: "just inside the postern (where the beam goes up behind it)" });
  mark("blocker_postern", "blocker", null, null, { local: [-12.4, G(1.2), 3.0], half: [0.6, 1.2, 0.7], tag: "blocker_postern", note: "the beam that seals the postern (K1 R)" });
  // ---- barracks (G3)
  for (const [i, x] of [-4.8, -2.6, 1.4, 4.2].entries()) mark(`prop_bed_${i + 1}`, "prop", [60 + x, g, -668.8], Math.PI, { prop: "kit/Bed_Twin1", r: 0.55, note: "head against the north wall" });
  mark("use_footlocker", "use", [64.2, g, -666.9], Math.PI, { prop: "kit/Chest_Wood", item: "letter", r: 0.4 });
  mark("spawn_e1r_shield", "spawn", [62.5, g, -667.5], Math.PI, { route: "rebel", who: "帝国盾兵" });
  mark("spawn_e1r_captain", "spawn", [60.0, g, -667.0], Math.PI, { route: "rebel", who: "帝国守卫长" });
  mark("spawn_e1i_axe", "spawn", [45.6, 38.1, -659.7], FACE["+X"], { route: "imperial", who: "霜誓军斧手", note: "outside the postern" });
  mark("spawn_e1i_leader", "spawn", [45.6, 38.1, -658.4], FACE["+X"], { route: "imperial", who: "霜誓军头目", note: "outside the postern" });
  sconce("light_g3_1", [-3.5, G(2.0), -2.2], [0, 0, -1]);
  sconce("light_g3_2", [3.5, G(2.0), -2.2], [0, 0, -1]);
  // ---- storeroom (G4)
  mark("use_store_potions", "use", [71.2, 39.0, -656.5], FACE["-X"], { prop: "kit/Shelf_Small_Bottles", items: ["kit/Potion_2", "kit/Potion_2"], r: 0.35, air: true });
  mark("prop_store_barrels", "prop", [67.4, g, -655.1], null, { prop: "ph/wooden_barrels_01", r: 0.7 });
  mark("prop_store_crate_1", "prop", [70.9, g, -654.95], 0.2, { prop: "ph/wooden_crate_01", r: 0.45 });
  mark("prop_store_crate_2", "prop", [67.3, g, -660.15], -0.15, { prop: "ph/wooden_crate_01", r: 0.45 });
  sconce("light_g4", [6.6, G(2.0), 6.4], [1, 0, 0]);
  // ---- stairwell (G5)
  mark("mark_tremor", "mark", [69.2, 35.13, -668.5], null, { note: "tremor point on the mid landing" });
  sconce("light_g5_top", [SX, G(2.0), -0.3], [-1, 0, 0]);
  sconce("light_g5_mid", [9.2, B(5.0), -SZ], [0, 0, 1]);
  // ---- checkpoints (design §11)
  mark("cp_k1_reb", "cp", [52.0, g, -658.8], 1.57, { route: "rebel", companion: [50.6, g, -658.8] });
  mark("cp_k1_imp", "cp", [60, g, -656.5], 0, { route: "imperial", companion: [60, g, -658.3] });
  mark("cp_k2_reb", "cp", [54.6, g, -657.0], -1.57, { route: "rebel", companion: [55.4, g, -656.6] });
  mark("cp_k2_imp", "cp", [60.5, g, -657.5], 1.57, { route: "imperial", companion: [61.5, g, -658.5] });
  mark("cp_k3", "cp", [62.0, g, -657.5], -1.39, { companion: [61, g, -659] });
  mark("cp_k4", "cp", [67.65, b, -662.8], 3.14, { companion: [68.5, b, -660.0] });
  mark("cp_k5", "cp", [55.5, b, -660.5], 0.45, { companion: [56.8, b, -660.8] });
  mark("cp_k6", "cp", [54.1, b, -684.0], 0, { companion: [55.2, b, -683.0] });
  // ---- stair foot (B1) and corridor (B2)
  sconce("light_b1", [SX, B(2.0), 3.0], [-1, 0, 0]);
  sconce("light_b2_1", [1.4, B(2.0), 4.4], [0, 0, 1]);
  sconce("light_b2_2", [5.0, B(2.0), 4.4], [0, 0, 1]);
  // ---- torture room (B3)
  mark("prop_cage", "prop", [51.4, b, -656.6], FACE["+X"], { prop: "procprops/cage", size: [2.0, 2.2, 2.0], r: 1.0, note: "door on +X" });
  mark("prop_strap_chair", "prop", [54.2, b, -659.4], null, { prop: "procprops/strap_chair", r: 0.45 });
  mark("prop_brazier_b3", "prop", [56.6, b, -657.4], null, { prop: "kit/Cauldron", note: "brazier with irons", r: 0.45 });
  mark("light_brazier_b3", "light", [56.6, b + 0.85, -657.4], null, { light: "brazier", fx: "FireFx 0.3" });
  mark("use_records", "use", [51.2, b, -661.5], null, { prop: "kit/Table_Large", items: ["kit/Scroll_1", "kit/Book"], r: 0.8 });
  mark("prop_shackles_corpse", "prop", [49.7, b, -662.8], FACE["+X"], { prop: "procprops/shackles", r: 0.4 });
  mark("mark_interrog", "mark", [53.0, b, -657.8]);
  mark("mark_assistant", "mark", [54.0, b, -655.6]);
  mark("mark_b3_companion", "mark", [55.6, b, -659.0]);
  mark("mark_e2_retry_player", "mark", [57.5, b, -656.4]);
  mark("mark_key_land", "mark", [52.4, 32.2, -656.0], null, { note: "the thrown key lands here", air: true });
  sconce("light_b3_s", [-5.0, B(2.0), VAULT.z1], [0, 0, -1]);
  sconce("light_b3_w", [VAULT.x0, B(2.0), 2.6], [1, 0, 0]);
  // ---- cells (B4)
  mark("mark_oldman", "mark", [57.0, b, -669.5], FACE["-X"], { note: "east cell 2, behind the bars" });
  mark("use_cell_potion", "use", [51.2, b, -672.9], null, { note: "west cell 3 (its door stands open)", r: 0.2 });
  mark("mark_whisper", "mark", [54.1, b, -679.5], 0, { note: "companion whisper stop" });
  sconce("light_b4_1", [-7.1, B(2.0), -5.8], [1, 0, 0]);
  sconce("light_b4_2", [-4.7, B(2.0), -12.6], [-1, 0, 0]);
  // ---- guard room J (B5)
  mark("prop_j_table", "prop", [54.1, b, -685.6], 0, { prop: "kit/Table_Large", items: ["dice"], r: 0.6 });
  mark("prop_j_stool", "prop", [54.1, b, -684.6], 0, { prop: "kit/Stool", r: 0.25 });
  mark("mark_jailer", "mark", [54.1, b, -684.6], 0, { route: "rebel", note: "seated on the stool (Sitting_Idle_Loop)" });
  mark("use_j_chest", "use", [50.4, b, -687.2], Math.PI, { prop: "kit/Chest_Wood", r: 0.5 });
  mark("mark_fugitive", "mark", [50.6, b, -686.4], 0, { route: "imperial", note: "kneeling (Fixing_Kneeling)" });
  mark("mark_dead_jailer", "mark", [52.5, b, -685.5], null, { route: "imperial" });
  mark("light_j_candle", "light", [54.4, b + 0.95, -685.8], null, { light: "candle" });
  mark("mark_drain", "mark", [54.1, b, -687.6], 0, { note: "drain mouth in the north wall; the cave's anchor breach is at (54, 32.00, −688.5)" });
  mark("blocker_drain", "blocker", null, null, { local: [-5.9, B(1.3), -26.65], half: [1.2, 1.3, 0.05], tag: "blocker_drain", note: "same box as drain_plug_col" });
  sconce("light_b5_s", [-9.5, B(2.0), -20], [0, 0, -1]);
  sconce("light_b5_e", [-1.0, B(2.0), -23.0], [-1, 0, 0]);
  // ---- outdoor marks around the keep (K0, design §4.1), for completeness
  mark("ext_k0_player", "ext", [60, 38.2, -648], 0);
  mark("ext_scribe_gate", "ext", [61.0, g, -652.6], 0, { note: "the scribe at the gate, facing the door (Interact loop)" });
  mark("ext_brun_postern", "ext", [43.6, 38.08, -657.5], yawTo([43.6, 0, -657.5], [60, 0, -648]), { note: "Brun's postern wait point (Idle_Rail_Call)" });
  mark("ext_postern_outside", "ext", [46.4, 38.05, -659.0], FACE["+X"], { note: "outside the postern, facing it" });
  mark("ext_crenellation_debris", "ext", [64.5, 38.3, -650.5]);
  for (const a of A) {
    a.local ??= toLocal(a.world);
    a.world ??= toWorld(a.local);
  }
}
/** light kinds: bake falloff (R, k) and suggested runtime light (PointLight intensity/range/colour) */
export const LIGHT_KINDS = {
  sconce: { R: 6.5, k: 1.0, soot: 1, runtime: { intensity: 6, range: 16, color: [1, 0.58, 0.28] } },
  brazier: { R: 9, k: 1.15, soot: 1.3, runtime: { intensity: 10, range: 20, color: [1, 0.55, 0.25] } },
  fire: { R: 8, k: 1.15, soot: 0, runtime: { intensity: 8, range: 16, color: [1, 0.5, 0.2] } },
  candle: { R: 3, k: 0.6, soot: 0, runtime: { intensity: 1.5, range: 5, color: [1, 0.7, 0.4] } },
};

// ------------------------------------------------------------------ queries
const AIRS = AIR; // every air shape (including ao/hidden) counts as air
const inAnyAir = (p, except) => {
  for (const a of AIRS) if (a !== except && inBox(a, p)) return true;
  return inVault(p) && except !== "vault";
};
const inAnySolid = (p, except) => {
  for (const s of SOLIDS) if (s !== except && p[0] > s.min[0] && p[0] < s.max[0] && p[1] > s.min[1] && p[1] < s.max[1] && p[2] > s.min[2] && p[2] < s.max[2] && inSolid(s, p)) return true;
  return false;
};
/** signed distance to rock/solid (negative inside it) */
function sdSolidAll(p) {
  let dAir = sdVault(p);
  for (const a of AIRS) dAir = Math.min(dAir, sdAABB(a, p));
  let d = -dAir;
  for (const s of SOLIDS) if (s.occlude) d = Math.min(d, sdSolid(s, p));
  return d;
}
const isFree = (p) => inAnyAir(p) && !SOLIDS.some((s) => s.occlude && inSolid(s, p));

// ------------------------------------------------------------------ baked vertex colour
const LIGHTS = A.filter((a) => a.kind === "light").map((a) => {
  const l = { ...a, ...LIGHT_KINDS[a.light] };
  const near = (min, max) => sdAABB({ min, max }, l.local) < l.R + 0.5;
  l.airs = AIR.filter((r) => near(r.min, r.max));
  l.vault = sdVault(l.local) < l.R + 0.5;
  l.solids = SOLIDS.filter((s) => s.occlude && near(s.min, s.max));
  return l;
});
const freeFor = (l, p) => {
  let inAir = l.vault && inVault(p);
  if (!inAir) for (const r of l.airs) if (inBox(r, p)) { inAir = true; break; }
  if (!inAir) return false;
  for (const s of l.solids) if (inBox(s, p) && inSolid(s, p)) return false;
  return true;
};
const PROBES = [0.15, 0.35, 0.6, 0.9, 1.3], PROBE_W = [1, 0.8, 0.6, 0.45, 0.3];
function visible(p, l) {
  const d = sub(l.local, p);
  const dist = len(d);
  const n = Math.max(2, Math.ceil(dist / 0.25));
  for (let i = 1; i < n; i++) {
    const t = i / n;
    if (t * dist < 0.12 || (1 - t) * dist < 0.15) continue;
    if (!freeFor(l, add(p, mul(d, t)))) return false;
  }
  return true;
}
/**
 * @param surf {floorY, kind: "wall"|"floor"|"ceil"|"solid"}
 */
function bake(p, n, surf) {
  // AO
  let occ = 0;
  for (let i = 0; i < PROBES.length; i++) {
    const h = PROBES[i];
    const d = sdSolidAll(add(p, mul(n, h)));
    occ += PROBE_W[i] * Math.max(0, h - d) / h;
  }
  const ao = Math.min(1, Math.max(0.3, 1 - 0.45 * occ));
  // warm falloff from the light anchors (lights behind a wall don't count)
  const q = add(p, mul(n, 0.04));
  let f = 0;
  for (const l of LIGHTS) {
    const dv = sub(l.local, q);
    const dist = len(dv);
    if (dist >= l.R) continue;
    const facing = dot(dv, n) / (dist || 1);
    if (facing < -0.05) continue;
    if (!visible(q, l)) continue;
    f += l.k * (1 - dist / l.R) ** 1.6 * (0.55 + 0.45 * Math.max(0, facing));
  }
  f = Math.min(1.2, f);
  // grime: dark skirt on walls, dirt on floors, soot above flames
  let g = 1;
  if (surf.kind === "wall") g *= 0.6 + 0.4 * smoothstep(0, 0.6, p[1] - surf.floorY);
  else if (surf.kind === "floor") g *= 0.86;
  else if (surf.kind === "ceil") g *= 0.82;
  if (surf.kind !== "floor")
    for (const l of LIGHTS) {
      if (!l.soot) continue;
      const dy = p[1] - l.local[1];
      if (dy < -0.05 || dy > 3) continue;
      const dh = Math.hypot(p[0] - l.local[0], p[2] - l.local[2]);
      const r = 0.25 + 0.35 * Math.max(0, dy);
      g *= 1 - Math.min(0.75, 0.6 * l.soot * Math.exp(-((dh / r) ** 2)) * (1 - dy / 3));
    }
  const noise = 0.88 + 0.12 * (fbm(p[0] * 0.55 + p[1] * 0.31, p[2] * 0.55 - p[1] * 0.47, 3, 11) * 0.5 + 0.5);
  const k = ao * g * noise;
  // 0.35 cool ambient + up to ~1 warm (clamped to 1 per channel)
  const c = [0.35 * 0.9 + 0.95 * f * 1.0, 0.35 * 0.95 + 0.95 * f * 0.74, 0.35 * 1.0 + 0.95 * f * 0.5];
  return [Math.min(1, c[0] * k), Math.min(1, c[1] * k), Math.min(1, c[2] * k), 1];
}

// ------------------------------------------------------------------ face meshing
/** render builders: node → material → MeshBuilder */
const RENDER = { gf: {}, stair: {}, bs: {} };
const mb = (node, mat) => (RENDER[node][mat] ??= new MeshBuilder());
const UVK = { castle: 1, brick: 1, floor: 1, wood: 1, iron: 1, planks: 1, dark: 1 };

/** Split [a, b] at the given cut values, then each piece into ≤ cell long parts. */
function lines(a, b, cuts, cell) {
  const xs = [a, b, ...cuts.filter((c) => c > a + 1e-4 && c < b - 1e-4)].sort((p, q) => p - q);
  const out = [xs[0]];
  for (let i = 1; i < xs.length; i++) {
    if (xs[i] - out[out.length - 1] < 1e-4) continue;
    const n = Math.max(1, Math.ceil((xs[i] - xs[i - 1]) / cell - 1e-6));
    for (let k = 1; k <= n; k++) out.push(xs[i - 1] + ((xs[i] - xs[i - 1]) * k) / n);
  }
  return out;
}
/** Coarse lines only (cuts): for the collider rectangles. */
const coarse = (a, b, cuts) => lines(a, b, cuts, 1e9);

/**
 * Emit one axis-aligned face. axis: normal axis; at: plane; sign: normal direction; uAx/vAx: the
 * in-plane axes; ru/rv: ranges. keep(q) decides per cell; mat(q) picks the material.
 */
function axisFace({ node, axis, at, sign, ru, rv, cutsU, cutsV, cell, cellV = cell, keep, mat, surf, uvMode }) {
  const [uAx, vAx] = axis === 0 ? [2, 1] : axis === 1 ? [0, 2] : [0, 1];
  const us = lines(ru[0], ru[1], cutsU, cell), vs = lines(rv[0], rv[1], cutsV, cellV);
  const N = [0, 0, 0];
  N[axis] = sign;
  const P = (u, v) => {
    const p = [0, 0, 0];
    p[axis] = at;
    p[uAx] = u;
    p[vAx] = v;
    return p;
  };
  const verts = new Map();
  let tris = 0;
  for (let j = 0; j < vs.length - 1; j++)
    for (let i = 0; i < us.length - 1; i++) {
      const q = P((us[i] + us[i + 1]) / 2, (vs[j] + vs[j + 1]) / 2);
      if (!keep(q, N)) continue;
      const m = mat(q);
      const b = mb(node, m);
      const tile = MATERIALS[m].tile ?? 1;
      const vid = (ii, jj) => {
        const key = `${m}:${ii}:${jj}`;
        let id = verts.get(key);
        if (id === undefined) {
          const p = P(us[ii], vs[jj]);
          let uv;
          if (uvMode === "floor") uv = [p[0] / tile, p[2] / tile];
          else if (axis === 1) uv = [p[0] / tile, p[2] / tile];
          else uv = [(axis === 0 ? -sign * p[2] : sign * p[0]) / tile, -p[1] / tile];
          id = b.vertex(p, N, uv, bake(p, N, surf));
          verts.set(key, id);
        }
        return id;
      };
      const a = vid(i, j), c = vid(i + 1, j + 1);
      const bb = vid(i + 1, j), d = vid(i, j + 1);
      pushQuad(b, a, bb, c, d, N);
      tris += 2;
    }
  return tris;
}
/** Two triangles a-b-c-d (a grid cell), wound so they face N. */
function pushQuad(b, a, bb, c, d, N) {
  const P = b.p;
  const pa = [P[a * 3], P[a * 3 + 1], P[a * 3 + 2]], pb = [P[bb * 3], P[bb * 3 + 1], P[bb * 3 + 2]], pc = [P[c * 3], P[c * 3 + 1], P[c * 3 + 2]];
  const n = cross(sub(pb, pa), sub(pc, pa));
  if (dot(n, N) >= 0) b.i.push(a, bb, c, a, c, d);
  else b.i.push(a, c, bb, a, d, c);
}

/** Cut values on the plane from every shape touching it (so openings and flush solids align). */
function planeCuts(axis, at, uAx, vAx, self) {
  const cu = [], cv = [];
  const touch = (min, max) => min[axis] - 0.011 <= at && max[axis] + 0.011 >= at;
  for (const a of AIR) if (a !== self && touch(a.min, a.max)) cu.push(a.min[uAx], a.max[uAx]), cv.push(a.min[vAx], a.max[vAx]);
  for (const s of SOLIDS) if (s !== self && s.aligned && touch(s.min, s.max)) cu.push(s.min[uAx], s.max[uAx]), cv.push(s.min[vAx], s.max[vAx]);
  return [cu, cv];
}

const EPS = 0.01;
const COLLIDERS = { gf: [], stair: [], bs: [] }; // boxes {c, s, rot?}
const STATS = { render: { gf: 0, stair: 0, bs: 0 }, faces: 0 };

function roomFaces(r) {
  if (r.kind === "ao" || r.kind === "hidden") return;
  for (let axis = 0; axis < 3; axis++)
    for (const side of [0, 1]) {
      const at = side ? r.max[axis] : r.min[axis];
      const sign = side ? -1 : 1; // into the room
      if (axis === 1 && side === 1 && r.noCeil) continue;
      const [uAx, vAx] = axis === 0 ? [2, 1] : axis === 1 ? [0, 2] : [0, 1];
      const [cu, cv] = planeCuts(axis, at, uAx, vAx, r);
      if (axis !== 1 && r.cuts.y) cv.push(...r.cuts.y);
      const kind = axis === 1 ? (side ? "ceil" : "floor") : "wall";
      const outside = (q) => {
        const o = [...q];
        o[axis] -= sign * EPS;
        return o;
      };
      const inside = (q) => {
        const o = [...q];
        o[axis] += sign * EPS;
        return o;
      };
      const open = (q) => {
        const o = outside(q);
        for (const a of AIR) if (a !== r && a.kind !== "ao" && inBox(a, o)) return true;
        return r.name !== "B3" && inVault(o);
      };
      const covered = (q) => {
        const o = inside(q);
        return SOLIDS.some((s) => s.aligned && inBox(s, o));
      };
      const matOf = kind === "wall" ? (r.wall === "split" ? (q) => (q[1] < GF - 1e-3 ? "brick" : "castle") : () => r.wall) : () => (kind === "ceil" ? r.ceil : r.floor);
      const surf = { kind, floorY: r.min[1] };
      const ru = [r.min[uAx], r.max[uAx]], rv = [r.min[vAx], r.max[vAx]];
      const cell = kind === "ceil" ? r.ceilCell : r.cell;
      // walls: 0.5 m columns; rows fine through the grime band (0.3 / 0.6 / 1.2 m), ≤ 1 m above
      const rowCuts = kind === "wall" ? [0.3, 0.6, 1.2].map((h) => r.min[1] + h) : [];
      STATS.render[r.node] += axisFace({ node: r.node, axis, at, sign, ru, rv, cutsU: cu, cutsV: [...cv, ...rowCuts], cell, cellV: kind === "wall" ? 1.0 : cell, keep: (q) => !open(q) && !covered(q), mat: matOf, surf });
      // collider: coarse closed rectangles extruded 0.2 m into the rock (GF floors: the floor slab)
      if (kind === "floor" && Math.abs(at - GF) < 1e-3) continue;
      if (kind === "floor" && !r.floorCol) continue;
      const us = coarse(ru[0], ru[1], cu), vs = coarse(rv[0], rv[1], axis !== 1 && r.cuts.y ? [...cv] : cv);
      const closed = [];
      for (let j = 0; j < vs.length - 1; j++) {
        const row = [];
        for (let i = 0; i < us.length - 1; i++) {
          const q = [0, 0, 0];
          q[axis] = at;
          q[uAx] = (us[i] + us[i + 1]) / 2;
          q[vAx] = (vs[j] + vs[j + 1]) / 2;
          row.push(!open(q));
        }
        closed.push(row);
      }
      for (const rect of mergeRects(closed, us, vs)) {
        const T = 0.2;
        const c = [0, 0, 0], s = [0, 0, 0];
        c[axis] = at - sign * T / 2;
        s[axis] = T;
        c[uAx] = (rect.u0 + rect.u1) / 2;
        s[uAx] = rect.u1 - rect.u0;
        c[vAx] = (rect.v0 + rect.v1) / 2;
        s[vAx] = rect.v1 - rect.v0;
        COLLIDERS[r.node].push({ c, s, from: r.name });
      }
    }
}
/** Greedy merge of a closed-cell grid into rectangles. */
function mergeRects(grid, us, vs) {
  const out = [];
  let prev = new Map();
  for (let j = 0; j < grid.length; j++) {
    const runs = [];
    let i = 0;
    while (i < grid[j].length) {
      if (!grid[j][i]) {
        i++;
        continue;
      }
      let k = i;
      while (k + 1 < grid[j].length && grid[j][k + 1]) k++;
      runs.push([i, k]);
      i = k + 1;
    }
    const next = new Map();
    for (const [i0, i1] of runs) {
      const key = `${i0}:${i1}`;
      const r = prev.get(key);
      if (r) {
        r.v1 = vs[j + 1];
        next.set(key, r);
        prev.delete(key);
      } else next.set(key, { u0: us[i0], u1: us[i1 + 1], v0: vs[j], v1: vs[j + 1] });
    }
    for (const r of prev.values()) out.push(r);
    prev = next;
  }
  for (const r of prev.values()) out.push(r);
  return out;
}

function solidFaces(s) {
  const tile = s.tile ?? MATERIALS[s.mat].tile ?? 1;
  for (let axis = 0; axis < 3; axis++)
    for (const sign of [-1, 1]) {
      const n = apply(s.R, AX[axis].map((v) => v * sign));
      const [ua, va] = axis === 0 ? [2, 1] : axis === 1 ? [0, 2] : [0, 1];
      const U = apply(s.R, AX[ua]), V = apply(s.R, AX[va]);
      const hu = s.h[ua], hv = s.h[va];
      const C = add(s.c, mul(n, s.h[axis]));
      let cu = [], cv = [];
      if (s.aligned) {
        const [pu, pv] = planeCuts(axis, C[axis], ua, va, s);
        cu = pu.map((x) => x - s.c[ua]);
        cv = pv.map((x) => x - s.c[va]);
      }
      const us = lines(-hu, hu, cu, s.cell), vs = lines(-hv, hv, cv, s.cell);
      const long = hu >= hv; // grain/courses run along the longer side
      const b = mb(s.node, s.mat);
      const verts = new Map();
      const P = (u, v) => add(C, add(mul(U, u), mul(V, v)));
      for (let j = 0; j < vs.length - 1; j++)
        for (let i = 0; i < us.length - 1; i++) {
          const uc = (us[i] + us[i + 1]) / 2, vc = (vs[j] + vs[j + 1]) / 2;
          const hidden = (u, v) => {
            const o = add(P(u + (uc - u) * 0.01, v + (vc - v) * 0.01), mul(n, EPS));
            return inAnySolid(o, s) || !inAnyAir(o);
          };
          if (hidden(uc, vc) && hidden(us[i], vs[j]) && hidden(us[i + 1], vs[j]) && hidden(us[i + 1], vs[j + 1]) && hidden(us[i], vs[j + 1])) continue;
          const vid = (ii, jj) => {
            const key = `${ii}:${jj}`;
            let id = verts.get(key);
            if (id === undefined) {
              const p = P(us[ii], vs[jj]);
              const uv = long ? [(us[ii] + hu) / tile, (vs[jj] + hv) / tile] : [(vs[jj] + hv) / tile, (us[ii] + hu) / tile];
              const kind = Math.abs(n[1]) > 0.7 ? (n[1] > 0 ? "floor" : "ceil") : "solid";
              id = b.vertex(p, n, uv, bake(p, n, { kind, floorY: GF }));
              verts.set(key, id);
            }
            return id;
          };
          pushQuad(b, vid(i, j), vid(i + 1, j), vid(i + 1, j + 1), vid(i, j + 1), n);
          STATS.render[s.node] += 2;
        }
    }
  if (s.col) COLLIDERS[s.node].push({ c: s.c, s: s.s, rot: s.rot, from: s.name });
}

/** B3 barrel vault: the curved ceiling and the two lunettes on the end walls. */
function vaultFaces() {
  const V = VAULT, node = "bs";
  const nTh = Math.ceil((V.R * 2 * V.th) / 0.5), xs = lines(V.x0, V.x1, [], 0.6);
  const ths = Array.from({ length: nTh + 1 }, (_, i) => -V.th + (2 * V.th * i) / nTh);
  const at = (th) => [V.zc + V.R * Math.sin(th), V.yc + V.R * Math.cos(th)];
  const b = mb(node, "brick");
  const tile = MATERIALS.brick.tile;
  const idx = [];
  for (let i = 0; i < xs.length; i++) {
    idx.push([]);
    for (let j = 0; j <= nTh; j++) {
      const [z, y] = at(ths[j]);
      const p = [xs[i], y, z];
      const n = [0, -Math.cos(ths[j]), -Math.sin(ths[j])];
      idx[i].push(b.vertex(p, n, [xs[i] / tile, (V.R * ths[j]) / tile], bake(p, n, { kind: "ceil", floorY: BS })));
    }
  }
  for (let i = 0; i < xs.length - 1; i++)
    for (let j = 0; j < nTh; j++) {
      const n = [0, -Math.cos((ths[j] + ths[j + 1]) / 2), -Math.sin((ths[j] + ths[j + 1]) / 2)];
      pushQuad(b, idx[i][j], idx[i + 1][j], idx[i + 1][j + 1], idx[i][j + 1], n);
      STATS.render[node] += 2;
    }
  // lunettes: columns between the arc's z stations, rows up to the arc
  for (const [x, sx] of [[V.x0, 1], [V.x1, -1]]) {
    const n = [sx, 0, 0];
    for (let j = 0; j < nTh; j++) {
      const [z0, y0] = at(ths[j]), [z1, y1] = at(ths[j + 1]);
      const rows = Math.max(1, Math.ceil((Math.max(y0, y1) - V.spring) / 0.5));
      const col = [];
      for (let r = 0; r <= rows; r++) {
        const t = r / rows;
        const pa = [x, V.spring + (y0 - V.spring) * t, z0], pb = [x, V.spring + (y1 - V.spring) * t, z1];
        col.push([pa, pb].map((p) => b.vertex(p, n, [(-sx * p[2]) / tile, -p[1] / tile], bake(p, n, { kind: "wall", floorY: BS }))));
      }
      for (let r = 0; r < rows; r++) {
        pushQuad(b, col[r][0], col[r][1], col[r + 1][1], col[r + 1][0], n);
        STATS.render[node] += 2;
      }
    }
    // collider: the end wall above the springing line, up to the crown
    COLLIDERS.bs.push({ c: [x - sx * 0.1, (V.spring + V.crown) / 2 + 0.1, (V.z0 + V.z1) / 2], s: [0.2, V.crown - V.spring + 0.2, V.z1 - V.z0], from: "B3 lunette" });
  }
  // collider: 8 slabs along the arc
  const segs = 8;
  for (let j = 0; j < segs; j++) {
    const ta = -V.th + (2 * V.th * j) / segs, tb = -V.th + (2 * V.th * (j + 1)) / segs, tm = (ta + tb) / 2;
    const [za, ya] = at(ta), [zb, yb] = at(tb);
    const chord = Math.hypot(zb - za, yb - ya);
    const T = 0.25;
    const c = [(V.x0 + V.x1) / 2, (ya + yb) / 2 + Math.cos(tm) * T / 2, (za + zb) / 2 + Math.sin(tm) * T / 2];
    COLLIDERS.bs.push({ c, s: [V.x1 - V.x0, T, chord + 0.05], rot: [-tm, 0, 0], from: "B3 vault" });
  }
}

// ------------------------------------------------------------------ cell bars and door leaves
const BAR_R = 0.015, BAR_GAP = 0.12;
/** Bars of one cell front in the plane x = px, z0…z1; door (0.9 × 2.1) in the middle. */
function cellFront(name, px, z0, z1, openSign = 0) {
  const b = mb("bs", "iron");
  const y0 = BS, y1 = CELLS.ceil;
  const zm = (z0 + z1) / 2, d0 = zm - 0.45, d1 = zm + 0.45, dh = 2.1;
  const col = (p) => bake(p, [Math.sign(-px - 5.9) || 1, 0, 0], { kind: "solid", floorY: BS });
  const bar = (p0, p1) => {
    const c = mul(add(p0, p1), 0.5), d = sub(p1, p0);
    const L = len(d);
    // cylinder() runs along local Y; rotate Y onto d (d is vertical or horizontal here)
    const rot = Math.abs(d[1]) > 0.5 ? [0, 0, 0] : Math.abs(d[0]) > 0.5 ? [0, 0, Math.PI / 2] : [Math.PI / 2, 0, 0];
    const before = b.i.length;
    cylinder(b, c, BAR_R, L, rot, { sides: 4, caps: false, color: col(c), tile: 1 });
    STATS.render.bs += (b.i.length - before) / 3;
  };
  const flat = (c, s) => {
    const before = b.i.length;
    boxInto(b, c, s, [0, 0, 0], col(c));
    STATS.render.bs += (b.i.length - before) / 3;
  };
  const n = Math.round((z1 - z0) / BAR_GAP);
  const zs = Array.from({ length: n - 1 }, (_, i) => z0 + ((z1 - z0) * (i + 1)) / n);
  // the door section's bars swing with it when the cell stands open
  const swing = (p) => {
    if (!openSign) return p;
    const a = openSign * (70 * Math.PI) / 180;
    const rel = sub(p, [px, 0, d0]);
    const r = apply(euler([0, a, 0]), rel);
    return add([px, 0, d0], r);
  };
  for (const z of zs) {
    const inDoor = z > d0 && z < d1;
    if (inDoor) {
      bar(swing([px, y0 + 0.02, z]), swing([px, y0 + dh, z]));
      bar([px, y0 + dh + 0.05, z], [px, y1, z]);
    } else bar([px, y0, z], [px, y1, z]);
  }
  for (const y of [y0 + 0.12, y0 + dh + 0.03, y1 - 0.12]) {
    if (y < y0 + dh) {
      flat([px, y, (z0 + d0) / 2], [0.025, 0.05, d0 - z0]);
      flat([px, y, (d1 + z1) / 2], [0.025, 0.05, z1 - d1]);
    } else flat([px, y, (z0 + z1) / 2], [0.025, 0.05, z1 - z0]);
  }
  // door frame: two flats along the door edges, a middle rail on the door
  for (const z of [d0, d1]) flat(swing([px, y0 + dh / 2, z]), [0.03, dh, 0.05]);
  if (!openSign) flat([px, y0 + 1.05, zm], [0.025, 0.05, 0.9]);
  // collider: one box per front (the open cell: both sides of its doorway)
  const T = 0.1;
  if (!openSign) COLLIDERS.bs.push({ c: [px, (y0 + y1) / 2, zm], s: [T, y1 - y0, z1 - z0], from: name });
  else {
    COLLIDERS.bs.push({ c: [px, (y0 + y1) / 2, (z0 + d0) / 2], s: [T, y1 - y0, d0 - z0], from: name });
    COLLIDERS.bs.push({ c: [px, (y0 + y1) / 2, (d1 + z1) / 2], s: [T, y1 - y0, z1 - d1], from: name });
    COLLIDERS.bs.push({ c: [px, (y0 + dh + 0.05 + y1) / 2, zm], s: [T, y1 - y0 - dh - 0.05, d1 - d0], from: name });
    const a = openSign * (70 * Math.PI) / 180;
    COLLIDERS.bs.push({ c: swing([px, y0 + dh / 2, zm]), s: [T, dh, d1 - d0], rot: [0, a, 0], from: `${name} door` });
  }
}
/** Box into a builder with one colour for all its vertices (small parts). */
function boxInto(b, c, s, rot, color, tile = 1) {
  const R = euler(rot);
  const h = mul(s, 0.5);
  for (let axis = 0; axis < 3; axis++)
    for (const sign of [-1, 1]) {
      const n = apply(R, AX[axis].map((v) => v * sign));
      const [ua, va] = axis === 0 ? [2, 1] : axis === 1 ? [0, 2] : [0, 1];
      const U = apply(R, AX[ua]), V = apply(R, AX[va]);
      const C = add(c, mul(n, h[axis]));
      const ids = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([a, bb]) => {
        const p = add(C, add(mul(U, a * h[ua]), mul(V, bb * h[va])));
        const long = h[ua] >= h[va];
        const uv = long ? [((a + 1) * h[ua]) / tile, ((bb + 1) * h[va]) / tile] : [((bb + 1) * h[va]) / tile, ((a + 1) * h[ua]) / tile];
        return b.vertex(p, n, uv, color);
      });
      pushQuad(b, ids[0], ids[1], ids[2], ids[3], n);
    }
}

/**
 * Door leaf in its hinge frame (hinge on the origin, the floor at y 0): built along +Z with the
 * opening side toward +X·side, then turned so +Z runs along `along`. Returns builders + collider.
 */
function buildLeaf(d) {
  const wood = new MeshBuilder(), iron = new MeshBuilder();
  const Ry = euler([0, d.baseYaw, 0]);
  const side = Math.sign(d.openYaw); // canonical opening side: +X for a positive swing
  const hingeWorld = d.hinge;
  const tr = (p) => apply(Ry, p);
  const colour = (p, n) => bake(add(hingeWorld, tr(p)), tr(n), { kind: "solid", floorY: hingeWorld[1] });
  const put = (b, c, s, tile = 1) => {
    const before = b.vertexCount;
    boxInto(b, c, s, [0, 0, 0], colour(c, [side, 0, 0]), tile);
    for (let v = before; v < b.vertexCount; v++) {
      const p = tr([b.p[v * 3], b.p[v * 3 + 1], b.p[v * 3 + 2]]), n = tr([b.n[v * 3], b.n[v * 3 + 1], b.n[v * 3 + 2]]);
      b.p.splice(v * 3, 3, ...p);
      b.n.splice(v * 3, 3, ...n);
    }
  };
  const w = d.width, h = d.height, t = d.thick;
  if (d.kind === "planks") {
    const boards = 6, bw = w / boards;
    for (let i = 0; i < boards; i++) put(wood, [i % 2 ? 0.004 * side : 0, 0.015 + h / 2, 0.02 + bw * (i + 0.5)], [t - 0.01, h, bw - 0.008], 2);
    for (const y of [0.4, h - 0.4]) {
      put(wood, [side * (t / 2 + 0.02), y, 0.02 + w / 2], [0.04, 0.16, w - 0.12], 2);
      put(iron, [-side * (t / 2 + 0.006), y, 0.02 + w * 0.46], [0.012, 0.07, w * 0.9]);
      put(iron, [0, y, 0.015], [t + 0.02, 0.08, 0.03]);
    }
    put(iron, [side * (t / 2 + 0.03), h * 0.45, 0.02 + w - 0.16], [0.03, 0.12, 0.05]);
    put(iron, [-side * (t / 2 + 0.03), h * 0.45, 0.02 + w - 0.16], [0.03, 0.12, 0.05]);
  } else {
    // barred gate: frame of flats, verticals at 0.12 m
    const n = Math.round(w / BAR_GAP);
    for (let i = 1; i < n; i++) {
      const z = (w * i) / n;
      const before = iron.vertexCount;
      cylinder(iron, [0, h / 2 + 0.02, z], BAR_R, h - 0.04, [0, 0, 0], { sides: 4, caps: false, color: colour([0, h / 2, z], [side, 0, 0]) });
      for (let v = before; v < iron.vertexCount; v++) {
        const p = tr([iron.p[v * 3], iron.p[v * 3 + 1], iron.p[v * 3 + 2]]), nn = tr([iron.n[v * 3], iron.n[v * 3 + 1], iron.n[v * 3 + 2]]);
        iron.p.splice(v * 3, 3, ...p);
        iron.n.splice(v * 3, 3, ...nn);
      }
    }
    for (const y of [0.1, 1.2, h - 0.04]) put(iron, [0, y, w / 2], [0.03, 0.06, w]);
    for (const z of [0.02, w - 0.02]) put(iron, [0, h / 2, z], [0.04, h, 0.04]);
  }
  const col = { c: tr([0, 0.015 + h / 2, 0.02 + w / 2]), s: [t + (d.kind === "bars" ? 0.03 : 0), h, w], rot: [0, d.baseYaw, 0] };
  return { wood, iron, col, tris: (wood.i.length + iron.i.length) / 3 };
}

// ------------------------------------------------------------------ colliders: floor slab, ramps
function staticColliders() {
  // ground-floor slab under the whole terrain hole (design §3.1: x 47.5…72.5, z −670.5…−653),
  // open over the stairwell
  const x0 = KEEP_HOLE.render.x0 - ORIGIN[0], x1 = KEEP_HOLE.render.x1 - ORIGIN[0], z0 = KEEP_HOLE.render.z0 - ORIGIN[2], z1 = KEEP.d / 2;
  const sw = roomOf("G5");
  const slab = (xa, xb, za, zb) => COLLIDERS.gf.push({ c: [(xa + xb) / 2, GF - 0.2, (za + zb) / 2], s: [xb - xa, 0.4, zb - za], from: "floor slab" });
  slab(x0, sw.min[0], z0, z1);
  slab(sw.min[0], x1, sw.max[2], z1);
  slab(sw.max[0], x1, z0, sw.max[2]);
  slab(sw.min[0], sw.max[0], z0, sw.min[2]);
  // the stairwell's solid parts; one ramp per flight through the middle of the treads (35.5°)
  const { A: FA, B: FB, core, mid, rise, run, steps } = STAIRS;
  COLLIDERS.stair.push({ c: [(core.x[0] + core.x[1]) / 2, (core.top + BS) / 2, (core.z[0] + core.z[1]) / 2], s: [core.x[1] - core.x[0], core.top - BS, core.z[1] - core.z[0]], from: "stair core" });
  COLLIDERS.stair.push({ c: [(6.6 + 8.5) / 2, G(0.5), -1.2 - 0.04], s: [1.9, 1.0, 0.1], from: "railing" });
  const ramp = (f, name) => {
    const L = run * steps, H = rise * steps;
    const ang = Math.atan2(H, L); // 35.5°
    const off = -rise / 2; // through the middle of the treads
    const zA = f.z0, zB = f.z0 + f.dir * L;
    const yA = f.top + off, yB = f.bottom + off;
    const T = 0.4;
    // the box's local +Z runs along the flight, +Y is the slope normal
    const rx = f.dir < 0 ? -ang : ang;
    const nrm = apply(euler([rx, 0, 0]), [0, 1, 0]);
    const c = add([(f.x[0] + f.x[1]) / 2, (yA + yB) / 2, (zA + zB) / 2], mul(nrm, -T / 2));
    COLLIDERS.stair.push({ c, s: [f.x[1] - f.x[0], T, Math.hypot(L, H)], rot: [rx, 0, 0], from: name, ramp: { angleDeg: +((ang * 180) / Math.PI).toFixed(2) } });
  };
  ramp(FA, "ramp A");
  ramp(FB, "ramp B");
  COLLIDERS.gf.push({ c: [SX - 0.24, G(1.15), 2.75], s: [0.48, 2.3, 2.6], from: "shelving" });
  // G2 collapse: two boxes for the rubble mound, one per fallen beam
  COLLIDERS.gf.push({ c: [(-SX - 6.6) / 2, G(0.55), (-SZ - 6.3) / 2], s: [SX - 6.6, 1.1, SZ - 6.3], from: "rubble" });
  COLLIDERS.gf.push({ c: [(-SX - 7.0) / 2, G(0.3), -5.6], s: [SX - 7.0, 0.6, 1.4], from: "rubble" });
  for (const n of ["fallen_beam_0", "fallen_beam_1", "fallen_beam_2"]) {
    const s = SOLID_BY[n];
    COLLIDERS.gf.push({ c: s.c, s: s.s, rot: s.rot, from: n });
  }
}

// ------------------------------------------------------------------ build
let BUILT = null;
export const _debug = { RENDER, COLLIDERS, STATS, AIR, SOLIDS, A, LIGHTS: null };
/** Geometry + data, no IO (memoised). */
export function buildKeepInteriorData() {
  if (BUILT) return BUILT;
  for (const r of AIR) roomFaces(r);
  vaultFaces();
  for (const s of SOLIDS) solidFaces(s);
  // cell fronts; west cell 3 stands open (its potion is loot)
  for (let k = 0; k < 5; k++) {
    const [z0, z1] = cellZ(k);
    cellFront(`bars_w${k + 1}`, CELLS.west[1] - 0.04, z0, z1, k === 2 ? -1 : 0);
    cellFront(`bars_e${k + 1}`, CELLS.east[0] + 0.04, z0, z1, 0);
  }
  staticColliders();
  const doors = DOORS.map((d) => ({ ...d, leaf: buildLeaf(d) }));
  // drain plug: a black card (and collider) closing the drain until the cave mesh joins it
  const plug = new MeshBuilder();
  const dr = roomOf("drain");
  boxInto(plug, [(dr.min[0] + dr.max[0]) / 2, (dr.min[1] + dr.max[1]) / 2, dr.min[2] - 0.05], [dr.max[0] - dr.min[0], dr.max[1] - dr.min[1], 0.1], [0, 0, 0], [0, 0, 0, 1]);
  const plugCol = { c: [(dr.min[0] + dr.max[0]) / 2, (dr.min[1] + dr.max[1]) / 2, dr.min[2] - 0.05], s: [dr.max[0] - dr.min[0], dr.max[1] - dr.min[1], 0.1] };
  const report = validate(doors);
  BUILT = { doors, plug, plugCol, report };
  return BUILT;
}

// ------------------------------------------------------------------ validation (fails the build)
function validate(doors) {
  const errors = [], warnings = [];
  const names = new Set();
  for (const a of A) {
    if (names.has(a.name)) errors.push(`duplicate anchor ${a.name}`);
    names.add(a.name);
  }
  // marks stand in free air on a floor
  const placed = A.filter((a) => ["mark", "spawn", "cp", "use", "prop"].includes(a.kind));
  for (const a of placed) {
    const p = a.local;
    const room = AIR.find((r) => r.kind !== "ao" && r.kind !== "hidden" && inBox(r, add(p, [0, 0.05, 0])));
    const outdoors = !room && a.local[1] > GF - 0.5 && (Math.abs(p[0]) > KEEP.w / 2 || Math.abs(p[2]) > KEEP.d / 2);
    if (!room && !outdoors) {
      errors.push(`${a.name} at local ${r3(p)} is not inside any room`);
      continue;
    }
    a.room = room?.name ?? "outside";
    if (room && !a.air) {
      let floor = null;
      for (let y = p[1] + 0.3; y > p[1] - 0.6; y -= 0.005)
        if (!isFree([p[0], y, p[2]])) {
          floor = y + 0.0025;
          break;
        }
      if (floor === null || Math.abs(floor - p[1]) > 0.06) errors.push(`${a.name}: y ${p[1].toFixed(2)} is not on a floor (found ${floor?.toFixed(2)}) in ${room.name}`);
    }
    // a 0.25 m body around the point must be clear of solids and walls
    if (room && ["mark", "spawn", "cp"].includes(a.kind))
      for (const o of [[0.25, 0], [-0.25, 0], [0, 0.25], [0, -0.25]]) {
        const q = [p[0] + o[0], p[1] + 0.9, p[2] + o[1]];
        if (!isFree(q)) errors.push(`${a.name}: body at ${r3(q)} is inside a wall or solid`);
      }
  }
  // prop footprints must not overlap (same route or neutral)
  const foot = A.filter((a) => a.r && a.room !== "outside");
  for (let i = 0; i < foot.length; i++)
    for (let j = i + 1; j < foot.length; j++) {
      const a = foot[i], b = foot[j];
      if (a.route && b.route && a.route !== b.route) continue;
      if (Math.abs(a.local[1] - b.local[1]) > 1.5) continue;
      const d = Math.hypot(a.local[0] - b.local[0], a.local[2] - b.local[2]);
      if (d < (a.r + b.r) * 0.9 && !(a.name === "prop_j_stool" || b.name === "prop_j_stool")) errors.push(`${a.name} and ${b.name} overlap (${d.toFixed(2)} m)`);
    }
  for (const d of doors) {
    const p = roomOf(d.passage);
    const h = d.hinge;
    if (h[0] < p.min[0] - 0.08 || h[0] > p.max[0] + 0.08 || h[2] < p.min[2] - 0.08 || h[2] > p.max[2] + 0.08) errors.push(`${d.name}: hinge ${r3(h)} is outside its opening ${d.passage}`);
  }
  // the terrain's collider hole must be floored everywhere: a collider top within reach below
  // (x 48…72, z −670…−654 effective on the 2 m grid, design §3.1)
  const hole = { x0: KEEP_HOLE.samples.x0 - 2 - ORIGIN[0], x1: KEEP_HOLE.samples.x1 + 2 - ORIGIN[0], z0: KEEP_HOLE.samples.z0 - 2 - ORIGIN[2], z1: KEEP_HOLE.samples.z1 + 2 - ORIGIN[2] };
  const all = Object.values(COLLIDERS).flat();
  let bare = 0;
  for (let x = hole.x0; x <= hole.x1 + 1e-6; x += 0.25)
    for (let z = hole.z0; z <= hole.z1 + 1e-6; z += 0.25) {
      let top = -Infinity;
      for (const c of all) {
        const r = Math.hypot(...c.s) / 2;
        if (Math.abs(x - c.c[0]) > r || Math.abs(z - c.c[2]) > r) continue;
        const R = euler(c.rot ?? [0, 0, 0]), Rt = transpose(R);
        // highest point of the box's top face at (x, z): sample the vertical line
        for (let y = Math.min(1.2, c.c[1] + r); y > Math.max(BS - 0.5, c.c[1] - r); y -= 0.05) {
          const q = apply(Rt, sub([x, y, z], c.c));
          if (Math.abs(q[0]) <= c.s[0] / 2 && Math.abs(q[1]) <= c.s[1] / 2 && Math.abs(q[2]) <= c.s[2] / 2) {
            top = Math.max(top, y);
            break;
          }
        }
        if (top >= GF - 0.01) break;
      }
      if (top < BS - 0.3) bare++;
    }
  if (bare) errors.push(`keep hole: ${bare} sample points without a collider below`);
  const tris = STATS.render.gf + STATS.render.stair + STATS.render.bs + doors.reduce((s, d) => s + d.leaf.tris, 0);
  if (tris < 25000 || tris > 45000) errors.push(`triangle budget: ${tris} (target 30–40k)`);
  else if (tris < 30000 || tris > 40000) warnings.push(`triangles ${tris} outside 30–40k`);
  return { errors, warnings, tris };
}

// ------------------------------------------------------------------ glTF + JSON
function colliderGeometry(boxes) {
  const P = [], I = [];
  for (const b of boxes) {
    const R = euler(b.rot ?? [0, 0, 0]);
    const h = mul(b.s, 0.5);
    const base = P.length / 3;
    for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) P.push(...add(b.c, apply(R, [sx * h[0], sy * h[1], sz * h[2]])));
    // corners: index = (sx>0)*4 + (sy>0)*2 + (sz>0); faces wound outward
    for (const f of [[0, 1, 3, 2], [4, 6, 7, 5], [0, 4, 5, 1], [2, 3, 7, 6], [0, 2, 6, 4], [1, 5, 7, 3]]) I.push(base + f[0], base + f[1], base + f[2], base + f[0], base + f[2], base + f[3]);
  }
  return { positions: new Float32Array(P), indices: I };
}
const quatY = (yaw) => [0, Math.sin(yaw / 2), 0, Math.cos(yaw / 2)];

async function material(doc, key, SRC, cache) {
  if (cache[key]) return cache[key];
  const m = MATERIALS[key];
  if (!m.src) return (cache[key] = pbr(doc, `ki_${key}`, { baseColorFactor: m.color, rough: m.rough ?? 1 }));
  const d = path.join(SRC, "textures", m.src);
  const color = await ktxTexture(doc, `ki_${key}_d`, await fs.readFile(path.join(d, "Diffuse.jpg")), "color", m.size);
  const normal = await ktxTexture(doc, `ki_${key}_n`, await fs.readFile(path.join(d, "nor_gl.jpg")), "normal", m.size);
  const orm = await ktxTexture(doc, `ki_${key}_arm`, await fs.readFile(path.join(d, "arm.jpg")), "linear", m.size / 2);
  return (cache[key] = pbr(doc, `ki_${key}`, { color, normal, orm, metal: m.metal ?? 0 }));
}

function anchorJSON(a) {
  const o = { kind: a.kind, local: r3(a.local), world: toWorld(a.local) };
  if (a.yaw !== null && a.yaw !== undefined) o.yaw = +a.yaw.toFixed(4);
  for (const k of ["light", "fx", "prop", "items", "item", "route", "who", "note", "moved", "room", "size", "half", "tag", "normal", "companion", "lookAt"]) if (a[k] !== undefined) o[k] = a[k];
  if (a.wall) o.wall = { local: a.wall, world: toWorld(a.wall) };
  if (a.light) o.lightHint = LIGHT_KINDS[a.light].runtime;
  if (a.half) o.half = a.half;
  return o;
}

/** Build both assets and register them. */
export async function buildKeepInterior({ emit, SRC }) {
  const t0 = performance.now();
  const { doors, plug, plugCol, report } = buildKeepInteriorData();
  for (const w of report.warnings) console.warn("  warning:", w);
  if (report.errors.length) throw new Error("keep interior validation failed:\n  " + report.errors.join("\n  "));
  const doc = new Document();
  doc.createBuffer();
  const scene = doc.createScene("keep_interior");
  const root = doc.createNode("keep_interior");
  scene.addChild(root);
  const mats = {};
  const counts = {};
  for (const node of ["gf", "stair", "bs"]) {
    const mesh = doc.createMesh(`keep_${node}`);
    counts[node] = {};
    for (const [key, b] of Object.entries(RENDER[node])) {
      if (!b.i.length) continue;
      mesh.addPrimitive(makePrimitive(doc, b.toGeometry(), await material(doc, key, SRC, mats)));
      counts[node][key] = b.i.length / 3;
    }
    root.addChild(doc.createNode(`keep_${node}`).setMesh(mesh));
    const col = doc.createMesh(`keep_${node}_col`).addPrimitive(makePrimitive(doc, colliderGeometry(COLLIDERS[node])));
    root.addChild(doc.createNode(`keep_${node}_col`).setMesh(col));
  }
  for (const d of doors) {
    const hinge = doc.createNode(d.name).setTranslation(d.hinge);
    root.addChild(hinge);
    const leaf = doc.createMesh(`${d.name}_leaf`);
    if (d.leaf.wood.i.length) leaf.addPrimitive(makePrimitive(doc, d.leaf.wood.toGeometry(), await material(doc, "wood", SRC, mats)));
    if (d.leaf.iron.i.length) leaf.addPrimitive(makePrimitive(doc, d.leaf.iron.toGeometry(), await material(doc, "iron", SRC, mats)));
    hinge.addChild(doc.createNode(`${d.name}_leaf`).setMesh(leaf));
    hinge.addChild(doc.createNode(`${d.name}_col`).setMesh(doc.createMesh(`${d.name}_col`).addPrimitive(makePrimitive(doc, colliderGeometry([d.leaf.col])))));
  }
  const plugNode = doc.createNode("drain_plug");
  root.addChild(plugNode);
  plugNode.addChild(doc.createNode("drain_plug_mesh").setMesh(doc.createMesh("drain_plug_mesh").addPrimitive(makePrimitive(doc, plug.toGeometry(), await material(doc, "dark", SRC, mats)))));
  plugNode.addChild(doc.createNode("drain_plug_col").setMesh(doc.createMesh("drain_plug_col").addPrimitive(makePrimitive(doc, colliderGeometry([plugCol])))));
  // anchors: empty nodes (local −Z = facing); zones and blockers scale a unit cube [−1, 1]³
  const anchors = doc.createNode("anchors");
  root.addChild(anchors);
  for (const a of A) {
    const n = doc.createNode(`anchor_${a.name}`).setTranslation(a.local);
    if (a.yaw !== null && a.yaw !== undefined) n.setRotation(quatY(a.yaw));
    if (a.half) n.setScale(a.half);
    anchors.addChild(n);
  }
  const zones = ZONES();
  for (const [name, boxes] of Object.entries(zones))
    boxes.forEach((z, i) => anchors.addChild(doc.createNode(`anchor_zone_${name}_${i}`).setTranslation(mul(add(z.min, z.max), 0.5)).setScale(mul(sub(z.max, z.min), 0.5))));
  const glb = await finalize(doc, { keepLeaves: true });

  const json = {
    version: 1,
    asset: "keep/interior",
    frame: {
      origin: ORIGIN, yaw: 0,
      note: "world = origin + local. Parent keep/interior's root (keep_interior) under the keep's holder; its y is heightAt(60, −662) − 0.2 at runtime (design 37.73).",
      yawConvention: "game convention: atan2(−dx, −dz) of the facing direction; facing −Z = 0, west = π/2, east = −π/2. Anchor nodes are rotated by it about +Y (their local −Z is the facing).",
    },
    levels: { gf: { local: GF, world: GFW }, bs: { local: BS, world: BSW } },
    nodes: {
      render: { keep_gf: "ground floor (zone K_GF)", keep_stair: "stairwell G5 + its landing (both zones)", keep_bs: "basement B1–B5 and the cells (zone K_BS)" },
      colliders: ["keep_gf_col", "keep_stair_col", "keep_bs_col", ...doors.map((d) => `${d.name}_col`), "drain_plug_col"],
      materials: Object.fromEntries(Object.entries(MATERIALS).map(([k, m]) => [`ki_${k}`, m.src ?? "untextured"])),
    },
    anchors: Object.fromEntries(A.map((a) => [a.name, anchorJSON(a)])),
    doors: Object.fromEntries(
      doors.map((d) => [
        d.tag,
        {
          node: d.name, leaf: `${d.name}_leaf`, collider: `${d.name}_col`,
          hinge: { local: r3(d.hinge), world: toWorld(d.hinge) },
          closedDir: d.along, openDir: d.open, openYaw: +d.openYaw.toFixed(4),
          width: +d.width.toFixed(3), height: +d.height.toFixed(3), initial: d.initial, note: d.note,
          opening: { min: r3(roomOf(d.passage).min), max: r3(roomOf(d.passage).max) },
        },
      ]),
    ),
    zones: Object.fromEntries(Object.entries(zones).map(([k, boxes]) => [k, boxes.map((b) => ({ min: r3(b.min), max: r3(b.max), worldMin: toWorld(b.min), worldMax: toWorld(b.max) }))])),
    rooms: Object.fromEntries(AIR.filter((r) => r.kind !== "ao").map((r) => [r.name, { kind: r.kind, label: r.label, min: r3(r.min), max: r3(r.max), worldMin: toWorld(r.min), worldMax: toWorld(r.max) }])),
    vault: { ...Object.fromEntries(Object.entries(VAULT).map(([k, v]) => [k, +v.toFixed(4)])) },
    stairs: { rise: +STAIRS.rise.toFixed(4), run: STAIRS.run, steps: STAIRS.steps, rampDeg: +((Math.atan2(3, 4.2) * 180) / Math.PI).toFixed(2) },
    stats: { triangles: report.tris, perNode: counts, colliderBoxes: Object.fromEntries(Object.entries(COLLIDERS).map(([k, v]) => [k, v.length])) },
  };
  await emit("keep/interior", { segment: "keep", priority: 95, type: "glb", ext: "glb", data: glb, pos: [60, -662] });
  await emit("keep/anchors", { segment: "keep", priority: 95, type: "json", ext: "json", data: Buffer.from(JSON.stringify(json)), pos: [60, -662] });
  console.log(`  triangles ${report.tris} (gf ${STATS.render.gf}, stair ${STATS.render.stair}, bs ${STATS.render.bs}, doors ${report.tris - STATS.render.gf - STATS.render.stair - STATS.render.bs}); collider boxes ${Object.values(COLLIDERS).flat().length}; ${A.length} anchors; ${((performance.now() - t0) / 1000).toFixed(1)} s`);
}

/** Zone AABBs (keep-local). K_GF / K_BS switch the lighting profile; E1–E3 are encounter arenas. */
function ZONES() {
  const box = (min, max) => ({ min, max });
  const r = (n) => box(roomOf(n).min, [roomOf(n).max[0], roomOf(n).name === "B3" ? VAULT.crown : roomOf(n).max[1], roomOf(n).max[2]]);
  return {
    K_GF: [box([-KEEP.w / 2, -1.0, -KEEP.d / 2 + KEEP.wall], [KEEP.w / 2 - KEEP.wall, 7.0, KEEP.d / 2])],
    K_BS: [box([-11.8, BS - 0.5, -26.6], [11.8, -1.0, 7.8])],
    E1: [box(toLocal([48.2, GFW, -663.6]), add(toLocal([66, GFW, -654.2]), [0, 4.0, 0]))],
    E2: [r("B3")],
    E3: [r("B5")],
  };
}
