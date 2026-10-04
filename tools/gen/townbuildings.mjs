// Story buildings of 雾门镇, generated procedurally (all textures Poly Haven CC0).
// Local frames: origin on the ground at the building centre; +Y up.
//
//   tower        square stone watchtower, door on -X, two straight stair flights, top floor at 6.4 m
//   tower_breach the wall section the dragon smashes (east face, top floor) - separate node
//   inn          two-storey timber inn east of the tower: burnt hole in the west roof slope and in the
//                upper floor; door on +Z
//   keep         stone keep with a gate opening on +Z (its two leaves are a separate prop placed at
//                runtime) and a west postern, whose leaf is the child node keep_postern (a hinge)
//                -> keep_postern_leaf. The interior is a separate asset (tools/gen/keepinterior.mjs).
//   platform     execution platform with the block
import { MeshBuilder } from "../lib/gltf.mjs";
import { box, quad, tri } from "./shapes.mjs";

export const TOWER = { w: 7, h: 13.5, wall: 0.6, floor1: 3.2, floor2: 6.4, top: 9.6, doorW: 1.5, doorH: 2.5, breachW: 2.4, breachH: 2.3 };
export const INN = { w: 10, d: 8, floor: 3.4, eave: 5.7, ridge: 8.8, wall: 0.35 };
/** floorY: the interior's ground-floor top (also the top front step); threshold: the gate passage's stone sill */
export const KEEP = { w: 26, d: 18, h: 12, wall: 1.2, gateW: 4, gateH: 5, floorY: 0.4, threshold: 0.42 };
/**
 * West postern (design §4.1), keep-local: an opening through the west wall (x −13…−11.8) at z 2.3…3.7,
 * y 0.4…2.8. Its leaf hangs inside the wall at the inner face, hinged at the north jamb (z 2.3), and
 * swings inward (+X) for a positive rotation about +Y.
 */
export const POSTERN = { z0: 2.3, z1: 3.7, y0: 0.4, y1: 2.8, hinge: [-11.86, 0.4, 2.3], leafT: 0.09, openYaw: Math.PI / 2 };
/**
 * Corner turrets: size × h boxes centred on the keep's corners, y 0…h. They reach size/2 − wall
 * (0.4 m) past the inner wall faces, to x ±11.4, z ±7.4; keepinterior.mjs wraps those stubs in
 * pilasters and checks that no shell geometry shows inside a room.
 */
export const TURRET = { size: 3.2, h: KEEP.h + 3 };

/** A wall slab along X (thickness along Z) with optional rectangular openings. */
function wallX(mb, x0, x1, y0, y1, z, t, openings = [], tile = 2) {
  // split into vertical strips around openings
  const xs = [x0, x1, ...openings.flatMap((o) => [o.x0, o.x1])].sort((a, b) => a - b);
  for (let i = 0; i < xs.length - 1; i++) {
    const a = xs[i], b = xs[i + 1];
    if (b - a < 1e-3) continue;
    const mid = (a + b) / 2;
    const cuts = openings.filter((o) => mid > o.x0 && mid < o.x1).sort((p, q) => p.y0 - q.y0);
    let y = y0;
    for (const o of cuts) {
      if (o.y0 > y) box(mb, [mid, (y + o.y0) / 2, z], [b - a, o.y0 - y, t], [0, 0, 0], { tile });
      y = o.y1;
    }
    if (y1 > y) box(mb, [mid, (y + y1) / 2, z], [b - a, y1 - y, t], [0, 0, 0], { tile });
  }
}
/** Same along Z (thickness along X). */
function wallZ(mb, z0, z1, y0, y1, x, t, openings = [], tile = 2) {
  const zs = [z0, z1, ...openings.flatMap((o) => [o.z0, o.z1])].sort((a, b) => a - b);
  for (let i = 0; i < zs.length - 1; i++) {
    const a = zs[i], b = zs[i + 1];
    if (b - a < 1e-3) continue;
    const mid = (a + b) / 2;
    const cuts = openings.filter((o) => mid > o.z0 && mid < o.z1).sort((p, q) => p.y0 - q.y0);
    let y = y0;
    for (const o of cuts) {
      if (o.y0 > y) box(mb, [x, (y + o.y0) / 2, mid], [t, o.y0 - y, b - a], [0, 0, 0], { tile });
      y = o.y1;
    }
    if (y1 > y) box(mb, [x, (y + y1) / 2, mid], [t, y1 - y, b - a], [0, 0, 0], { tile });
  }
}

/** Straight stair flight rising along +X or -X from (x, y, z). */
function stairs(mb, x, y, z, dir, rise, width, steps = 16) {
  const h = rise / steps, run = 0.3;
  for (let i = 0; i < steps; i++) {
    const cx = x + dir * (i * run + run / 2);
    box(mb, [cx, y + (i + 1) * h - h / 2 - 0.0, z], [run, (i + 1) * h, width], [0, 0, 0], { tile: 1 });
  }
  return steps * run;
}

export function buildTower() {
  const T = TOWER;
  const stone = new MeshBuilder(), wood = new MeshBuilder(), breach = new MeshBuilder();
  const hw = T.w / 2, t = T.wall, iw = hw - t;
  // west wall with the door; north/south walls with arrow slits
  wallZ(stone, -hw, hw, -0.5, T.h, -hw + t / 2, t, [
    { z0: -T.doorW / 2, z1: T.doorW / 2, y0: -0.5, y1: T.doorH },
    { z0: -0.2, z1: 0.2, y0: 7.0, y1: 8.4 },
  ]);
  wallX(stone, -hw, hw, -0.5, T.h, -hw + t / 2, t, [{ x0: -0.2, x1: 0.2, y0: 4.2, y1: 5.4 }]);
  wallX(stone, -hw, hw, -0.5, T.h, hw - t / 2, t, [{ x0: -0.2, x1: 0.2, y0: 4.2, y1: 5.4 }]);
  // east wall with the breach opening (filled by the separate tower_breach node until the dragon hits)
  const breachO = { z0: -T.breachW / 2, z1: T.breachW / 2, y0: T.floor2, y1: T.floor2 + T.breachH };
  wallZ(stone, -hw, hw, -0.5, T.h, hw - t / 2, t, [breachO]);
  box(breach, [hw - t / 2, T.floor2 + T.breachH / 2, 0], [t, T.breachH, T.breachW], [0, 0, 0], { tile: 2 });
  // crenellations
  for (let i = 0; i < 8; i++) {
    const s = -hw + 0.45 + i * ((T.w - 0.9) / 7);
    for (const [x, z] of [[s, -hw + t / 2], [s, hw - t / 2], [-hw + t / 2, s], [hw - t / 2, s]]) box(stone, [x, T.h + 0.45, z], [0.6, 0.9, 0.6]);
  }
  // floors (wood) with stair holes; flight 1 along the north wall rising +X, flight 2 along the south wall rising -X
  const sw = 1.1; // stair width
  const run = 16 * 0.3;
  const nZ = -iw + sw / 2, sZ = iw - sw / 2;
  const x0 = -iw + 0.2; // flight 1 start
  stairs(wood, x0, 0, nZ, +1, T.floor1, sw);
  stairs(wood, x0 + run, T.floor1, sZ, -1, T.floor2 - T.floor1, sw);
  const floor = (y, hole) => {
    // floor slab over the interior minus a hole (x0..x1 at z band)
    const parts = [
      // full-width strips away from the hole band
      { x: [-iw, iw], z: [hole.z1, iw] },
      { x: [-iw, iw], z: [-iw, hole.z0] },
      { x: [-iw, hole.x0], z: [hole.z0, hole.z1] },
      { x: [hole.x1, iw], z: [hole.z0, hole.z1] },
    ];
    for (const p of parts) {
      const w = p.x[1] - p.x[0], d = p.z[1] - p.z[0];
      if (w > 0.01 && d > 0.01) box(wood, [(p.x[0] + p.x[1]) / 2, y - 0.12, (p.z[0] + p.z[1]) / 2], [w, 0.24, d], [0, 0, 0], { tile: 1.5 });
    }
  };
  floor(T.floor1, { x0: x0 - 0.1, x1: x0 + run + 0.1, z0: -iw, z1: -iw + sw + 0.05 });
  floor(T.floor2, { x0: x0 - 0.1, x1: x0 + run + 0.1, z0: iw - sw - 0.05, z1: iw });
  // closed ceiling under the roof
  box(wood, [0, T.top, 0], [T.w - 0.2, 0.3, T.w - 0.2], [0, 0, 0], { tile: 1.5 });
  box(stone, [0, T.h - 0.2, 0], [T.w, 0.4, T.w]);
  // ground floor (stone)
  box(stone, [0, -0.05, 0], [T.w - 0.1, 0.1, T.w - 0.1], [0, 0, 0], { tile: 1.5 });
  // railing beside the upper stair holes
  box(wood, [x0 + run / 2, T.floor1 + 0.5, -iw + sw + 0.1], [run, 0.08, 0.08]);
  box(wood, [x0 + run / 2, T.floor2 + 0.5, iw - sw - 0.1], [run, 0.08, 0.08]);
  return { stone, wood, breach };
}

export function buildInn() {
  const I = INN;
  const timber = new MeshBuilder(), stone = new MeshBuilder(), wood = new MeshBuilder(), thatch = new MeshBuilder(), dark = new MeshBuilder();
  const hw = I.w / 2, hd = I.d / 2, t = I.wall;
  const foot = 0.6;
  box(stone, [0, (foot - 0.5) / 2, 0], [I.w + 0.2, foot + 0.5, I.d + 0.2], [0, 0, 0], { tile: 2 });
  // walls: door on +Z (south), windows; west wall is lower (the player jumps over it from the tower)
  wallX(timber, -hw, hw, foot, I.eave, hd - t / 2, t, [
    { x0: 1.2, x1: 2.6, y0: foot, y1: foot + 2.3 },
    { x0: -3.2, x1: -2.2, y0: foot + 1.1, y1: foot + 2.0 },
    { x0: -2.8, x1: -1.6, y0: I.floor + 1.0, y1: I.floor + 1.8 },
  ]);
  wallX(timber, -hw, hw, foot, I.eave, -hd + t / 2, t, [{ x0: -1, x1: 0.2, y0: foot + 1.1, y1: foot + 2 }]);
  wallZ(timber, -hd, hd, foot, I.eave, hw - t / 2, t, [{ z0: -1, z1: 0.2, y0: I.floor + 1, y1: I.floor + 1.8 }]);
  wallZ(timber, -hd, hd, foot, I.eave - 0.4, -hw + t / 2, t, [{ z0: -0.6, z1: 0.6, y0: foot + 1.1, y1: foot + 2 }]);
  // corner posts
  for (const x of [-hw, hw]) for (const z of [-hd, hd]) box(dark, [x, (foot + I.eave) / 2, z], [0.3, I.eave - foot, 0.3]);
  // ground floor planks + upper floor with a burnt hole at the east end
  box(wood, [0, foot + 0.02, 0], [I.w - 2 * t, 0.06, I.d - 2 * t], [0, 0, 0], { tile: 1.5 });
  const iw = hw - t, id = hd - t;
  const hole = { x0: 1.6, x1: 3.6, z0: -1.2, z1: 1.0 };
  for (const p of [
    { x: [-iw, iw], z: [hole.z1, id] },
    { x: [-iw, iw], z: [-id, hole.z0] },
    { x: [-iw, hole.x0], z: [hole.z0, hole.z1] },
    { x: [hole.x1, iw], z: [hole.z0, hole.z1] },
  ])
    box(wood, [(p.x[0] + p.x[1]) / 2, I.floor - 0.1, (p.z[0] + p.z[1]) / 2], [p.x[1] - p.x[0], 0.2, p.z[1] - p.z[0]], [0, 0, 0], { tile: 1.5 });
  // beams under the upper floor
  for (const x of [-3, 0, 3]) box(dark, [x, I.floor - 0.32, 0], [0.22, 0.25, I.d - 2 * t]);
  // ridge along Z; roof slopes east (intact) and west (with a burnt hole near the tower)
  const over = 0.5, ex = hw + over, ez = hd + over;
  const yE = I.eave - over * ((I.ridge - I.eave) / hw);
  const west = [-ex, yE, 0], ridgeY = I.ridge;
  // east slope (full)
  quad(thatch, [ex, yE, ez], [ex, yE, -ez], [0, ridgeY, -ez], [0, ridgeY, ez], { tile: 2 });
  quad(dark, [ex, yE - 0.2, -ez], [ex, yE - 0.2, ez], [0, ridgeY - 0.2, ez], [0, ridgeY - 0.2, -ez], { tile: 1.5 });
  // west slope: two strips (north and south of the hole) and the upper part near the ridge
  const holeZ = [-2.2, 2.0], holeUp = 0.55; // hole spans from the eave to 55% of the slope
  const lerpW = (k) => [west[0] * (1 - k), yE + (ridgeY - yE) * k];
  const [hx, hy] = lerpW(holeUp);
  const strip = (z0, z1, k0, k1) => {
    const [x0, y0] = lerpW(k0), [x1, y1] = lerpW(k1);
    quad(thatch, [x0, y0, z0], [x0, y0, z1], [x1, y1, z1], [x1, y1, z0], { tile: 2 });
    quad(dark, [x0, y0 - 0.2, z1], [x0, y0 - 0.2, z0], [x1, y1 - 0.2, z0], [x1, y1 - 0.2, z1], { tile: 1.5 });
  };
  strip(-ez, holeZ[0], 0, 1);
  strip(holeZ[1], ez, 0, 1);
  strip(holeZ[0], holeZ[1], holeUp, 1);
  // charred rafters across the hole
  for (const z of [-1, 0.6]) {
    const len = Math.hypot(hx - west[0], hy - yE);
    box(dark, [(west[0] + hx) / 2, (yE + hy) / 2, z], [len, 0.14, 0.14], [0, 0, Math.atan2(hy - yE, hx - west[0])]);
  }
  // gables
  for (const sz of [1, -1]) {
    const a = [-hw, I.eave - (sz < 0 ? 0 : 0), sz * hd], b = [hw, I.eave, sz * hd], c = [0, ridgeY - 0.1, sz * hd];
    if (sz > 0) tri(timber, a, b, c, { tile: 2 });
    else tri(timber, b, a, c, { tile: 2 });
  }
  box(dark, [0, ridgeY + 0.05, 0], [0.22, 0.22, I.d + over * 2]);
  // furniture: tables and a counter
  box(wood, [-2.5, foot + 0.4, -1.5], [1.8, 0.08, 0.9]);
  box(wood, [-2.5, foot + 0.2, -1.5], [0.12, 0.4, 0.6]);
  box(wood, [3.2, foot + 0.55, 2.8], [2.6, 1.1, 0.5]);
  return { timber, stone, wood, thatch, dark, hole };
}

export function buildKeep() {
  const K = KEEP, P = POSTERN;
  const stone = new MeshBuilder(), dark = new MeshBuilder();
  const hw = K.w / 2, hd = K.d / 2, t = K.wall;
  // gate: the wall below the opening is a stone threshold 2 cm above the hall floor (the terrain in
  // the passage, which the keep's terrain hole stops short of, reaches 0.40 and must stay under it)
  wallX(stone, -hw, hw, -0.5, K.h, hd - t / 2, t, [{ x0: -K.gateW / 2, x1: K.gateW / 2, y0: K.threshold, y1: K.gateH }], 2.5);
  wallX(stone, -hw, hw, -0.5, K.h, -hd + t / 2, t, [], 2.5);
  // west wall with the postern; the wall below it ends at floor level, plus a 0.1 m sill outside
  wallZ(stone, -hd, hd, -0.5, K.h, -hw + t / 2, t, [{ z0: P.z0, z1: P.z1, y0: P.y0, y1: P.y1 }], 2.5);
  box(stone, [-hw - 0.075, P.y0 - 0.05, (P.z0 + P.z1) / 2], [0.15, 0.1, P.z1 - P.z0 + 0.2], [0, 0, 0], { tile: 1 });
  wallZ(stone, -hd, hd, -0.5, K.h, hw - t / 2, t, [], 2.5);
  box(stone, [0, K.h, 0], [K.w, 0.6, K.d], [0, 0, 0], { tile: 2.5 });
  // crenellations
  for (let i = 0; i < 13; i++) {
    const x = -hw + 0.6 + i * ((K.w - 1.2) / 12);
    box(stone, [x, K.h + 0.8, hd - 0.4], [0.9, 1.0, 0.8]);
    box(stone, [x, K.h + 0.8, -hd + 0.4], [0.9, 1.0, 0.8]);
  }
  for (let i = 0; i < 9; i++) {
    const z = -hd + 0.6 + i * ((K.d - 1.2) / 8);
    box(stone, [hw - 0.4, K.h + 0.8, z], [0.8, 1.0, 0.9]);
    box(stone, [-hw + 0.4, K.h + 0.8, z], [0.8, 1.0, 0.9]);
  }
  // corner turrets
  for (const x of [-hw, hw]) for (const z of [-hd, hd]) box(stone, [x, TURRET.h / 2, z], [TURRET.size, TURRET.h, TURRET.size], [0, 0, 0], { tile: 2.5 });
  // (the dark box that used to fill the gate passage is gone: the interior asset is behind the gate)
  // stone steps in front of the gate
  for (let i = 0; i < 3; i++) box(stone, [0, 0.1 + i * 0.15 - 0.15, hd + 1.4 - i * 0.4], [K.gateW + 2, 0.3, 0.8]);
  return { stone, dark, postern: buildPosternLeaf() };
}

/**
 * The postern leaf in its hinge frame: origin on the hinge axis at the sill, the closed leaf runs
 * along +Z (north jamb → south jamb), its inner face toward +X. Vertical boards with two iron straps
 * and a ring pull on the inner face.
 */
export function buildPosternLeaf() {
  const P = POSTERN;
  const wood = new MeshBuilder(), iron = new MeshBuilder();
  const w = P.z1 - P.z0 - 0.04, h = P.y1 - P.y0 - 0.03, t = P.leafT;
  const z0 = 0.02, y0 = 0.015;
  const boards = 6, bw = w / boards;
  for (let i = 0; i < boards; i++) {
    const inset = i % 2 ? 0.004 : 0; // alternate boards sit a few mm proud so the joints read
    box(wood, [inset, y0 + h / 2, z0 + bw * (i + 0.5)], [t - 0.01, h, bw - 0.008], [0, 0, 0], { tile: 2 });
  }
  // ledges (inner face) and iron straps (outer face)
  for (const y of [0.35, h - 0.35]) {
    box(wood, [t / 2 + 0.02, y0 + y, z0 + w / 2], [0.04, 0.16, w - 0.12], [0, 0, 0], { tile: 2 });
    box(iron, [-t / 2 - 0.006, y0 + y, z0 + w * 0.46], [0.012, 0.07, w * 0.9], [0, 0, 0], { tile: 1 });
    // strap hinge knuckle on the hinge side
    box(iron, [0, y0 + y, z0 - 0.005], [t + 0.02, 0.08, 0.03], [0, 0, 0], { tile: 1 });
  }
  box(iron, [t / 2 + 0.03, y0 + h * 0.45, z0 + w - 0.18], [0.03, 0.12, 0.05], [0, 0, 0], { tile: 1 });
  return { wood, iron, hinge: P.hinge, size: [t, h, w] };
}

export function buildPlatform() {
  const wood = new MeshBuilder(), dark = new MeshBuilder();
  // 7 x 5 m deck, 0.8 m high, steps on +Z
  box(wood, [0, 0.75, 0], [7, 0.1, 5], [0, 0, 0], { tile: 1.5 });
  for (const x of [-3.3, 0, 3.3]) for (const z of [-2.3, 2.3]) box(dark, [x, 0.35, z], [0.25, 0.8, 0.25]);
  box(dark, [0, 0.35, -2.45], [7, 0.7, 0.08]);
  for (let i = 0; i < 3; i++) box(wood, [0, 0.12 + i * 0.22, 3.2 - i * 0.3], [2, 0.08, 0.32]);
  // the block: a squat log with a groove
  const block = new MeshBuilder();
  box(block, [0, 1.05, -0.6], [0.9, 0.5, 0.55], [0, 0, 0], { tile: 0.8 });
  box(block, [0, 1.32, -0.6], [0.9, 0.06, 0.18], [0, 0, 0], { tile: 0.8 });
  return { wood, dark, block };
}
