// Procedural props for the keep and exit chapters (design §10.1 "Procedural props", §4.2–§4.3, §5.2):
// procprops/keep (segment keep) and procprops/exit (segment exit).
//
// Self-contained: geometry, materials, placement data, validation and glTF. Exports
// buildProcProps({emit, SRC, anchors}) for build-assets (anchors = the shipped cave/keep anchor JSON)
// and buildProcPropsDocs(...) (the documents before texture compression, for previews).
//
// Conventions (same as kit/fpm):
// - One top-level node per prop, at the origin with an identity transform; geometry sits on
//   `<node>_mesh` leaf children (mesh quantisation moves only those), colliders on `<x>_col` nodes
//   (POSITION only, no material), anchors are empty nodes. Moving parts are pivot nodes whose
//   identity is the rest pose (door closed, lever at rest, deck lowered).
// - Props face −Z (an anchor's yaw turns local −Z to the facing); wall props have the wall at +Z.
// - The gallery set piece `gallery_bridge` is in world axes with its origin on the cave anchor
//   `bridge_hinge`; the lever, winch, chains and slab inside it are placed from the cave anchors, the
//   pulleys from the cave's rock field (the dome above the raised deck tip), and everything is checked
//   against that field (tools/gen/cave.mjs `_debug`; the build fails when it does not load). The field
//   must be the one the shipped cave was built from: checkCaveField compares it with the shipped
//   cave/mesh_a colliders and cave/anchors floors, and props/meta pins those files (joins.inputs).
// - glTF extras on each top-level node (Babylon: node.metadata.gltf.extras) describe pivots, tags,
//   anchors and attach recipes; the same data goes to props/meta.
import path from "node:path";
import fs from "node:fs/promises";
import sharp from "sharp";
import { Document } from "@gltf-transform/core";
import { MeshBuilder, io, compressTextures, finalize, dropUnusedTexcoords, missingTexcoords } from "../lib/gltf.mjs";
import { box, cylinder, torus, tube } from "./shapes.mjs";
import { heldRecipe, clipPoses, heldInPose, angleDeg, qrot } from "../lib/handheld.mjs";

export const PROCPROPS = {
  keep: { id: "procprops/keep", segment: "keep", priority: 91, pos: [52, -700] },
  exit: { id: "procprops/exit", segment: "exit", priority: 90, pos: [-22, -718] },
};

// ------------------------------------------------------------------------------------------------
// small math

const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = (a) => Math.hypot(a[0], a[1], a[2]);
const nrm = (a) => mul(a, 1 / (len(a) || 1));
const lerp3 = (a, b, t) => add(a, mul(sub(b, a), t));
const r3 = (v) => v.map((x) => Math.round(x * 1000) / 1000 + 0);
/** quaternion [x, y, z, w] for `ang` radians about unit `axis` */
const qAxis = (axis, ang) => [...mul(nrm(axis), Math.sin(ang / 2)), Math.cos(ang / 2)];
/** rotate about X by a: (y, z) → (y cos a − z sin a, y sin a + z cos a) */
const rotX = (p, a) => [p[0], p[1] * Math.cos(a) - p[2] * Math.sin(a), p[1] * Math.sin(a) + p[2] * Math.cos(a)];
const rotY = (p, a) => [p[0] * Math.cos(a) + p[2] * Math.sin(a), p[1], -p[0] * Math.sin(a) + p[2] * Math.cos(a)];

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ------------------------------------------------------------------------------------------------
// materials

const TEX = (id, d, n, arm) => ({ tex: id, d, n, arm });
/** Kit materials. `vcol`: geometry carries COLOR_0 (VEC3). Textured ones read assets-src/textures/<tex>. */
const MATS = {
  iron: { ...TEX("rusty_metal_02", 512, 512, 256), metal: 1, tile: 0.6 },
  wood: { ...TEX("dark_wooden_planks", 512, 512, 256), tile: 1.0 },
  planks: { ...TEX("weathered_planks", 1024, 512, 256), tile: 2.0 },
  rock: {
    color: [0.43, 0.41, 0.39, 1],
    vcol: true,
    extras: { textures: { albedo: "cave/tex/rock_d", normal: "cave/tex/rock_n", orm: "cave/tex/rock_arm" }, tile: 2.0, source: "rock_face_03", uv: "TEXCOORD_0 is box-projected position / tile (texture repeats), as cave_rock" },
  },
  leather: { color: [0.2, 0.12, 0.075, 1], rough: 0.62 },
  rope: { color: [0.55, 0.45, 0.31, 1], rough: 1 },
  straw: { gen: "straw", size: 256, rough: 1, doubleSided: true, vcol: true },
  paper: { gen: "paper", size: 512, rough: 0.85 },
  vcol: { color: [1, 1, 1, 1], rough: 0.85, vcol: true },
};

/** Procedural textures (SVG rasterised by sharp). */
async function genTexture(kind, size) {
  const R = rng(kind === "straw" ? 11 : 23);
  let svg;
  if (kind === "straw") {
    let s = `<rect width="${size}" height="${size}" fill="rgb(150,118,62)"/>`;
    for (let i = 0; i < 900; i++) {
      const x = R() * size, y = R() * size, a = (R() - 0.5) * 0.5, l = 30 + R() * 110;
      const c = 120 + R() * 110, w = 0.8 + R() * 2.2;
      const col = `rgb(${Math.round(c)},${Math.round(c * 0.8)},${Math.round(c * 0.42)})`;
      // wrap around so the texture tiles
      for (const dx of [-size, 0, size])
        s += `<line x1="${(x + dx).toFixed(1)}" y1="${y.toFixed(1)}" x2="${(x + dx + Math.cos(a) * l).toFixed(1)}" y2="${(y + Math.sin(a) * l).toFixed(1)}" stroke="${col}" stroke-width="${w.toFixed(1)}" stroke-linecap="round" opacity="${(0.55 + R() * 0.45).toFixed(2)}"/>`;
    }
    svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">${s}</svg>`;
  } else {
    // parchment: left half the written front, right half the blank back (u 0.5..1)
    const W = size, H = size / 2, half = W / 2;
    let s = `<defs><radialGradient id="g" cx="50%" cy="50%" r="70%"><stop offset="55%" stop-color="rgb(226,206,160)"/><stop offset="100%" stop-color="rgb(176,146,96)"/></radialGradient>
      <filter id="n"><feTurbulence type="fractalNoise" baseFrequency="0.035" numOctaves="4" seed="3"/><feColorMatrix values="0 0 0 0 0.35  0 0 0 0 0.25  0 0 0 0 0.12  0 0 0 0.35 0"/></filter></defs>
      <rect width="${W}" height="${H}" fill="url(#g)"/><rect width="${W}" height="${H}" filter="url(#n)"/>`;
    // ink: a heading, lines of "words", an empty name line, a signature and the seal's place
    const ink = "rgb(52,36,24)";
    s += `<rect x="${half * 0.3}" y="${H * 0.07}" width="${half * 0.4}" height="${H * 0.045}" fill="${ink}" opacity="0.8"/>`;
    for (let li = 0; li < 13; li++) {
      const y = H * (0.18 + li * 0.05);
      if (li === 5) {
        s += `<line x1="${half * 0.12}" y1="${y}" x2="${half * 0.3}" y2="${y}" stroke="${ink}" stroke-width="1.6"/><line x1="${half * 0.34}" y1="${y + 2}" x2="${half * 0.82}" y2="${y + 2}" stroke="${ink}" stroke-width="0.8" stroke-dasharray="3 2" opacity="0.7"/>`;
        continue;
      }
      let x = half * 0.12;
      const end = half * (li === 12 ? 0.5 : 0.86 + R() * 0.02);
      while (x < end) {
        const w = 6 + R() * 22;
        s += `<line x1="${x.toFixed(1)}" y1="${(y + (R() - 0.5)).toFixed(1)}" x2="${Math.min(end, x + w).toFixed(1)}" y2="${(y + (R() - 0.5)).toFixed(1)}" stroke="${ink}" stroke-width="${(1.2 + R() * 0.6).toFixed(1)}" stroke-linecap="round" opacity="0.85"/>`;
        x += w + 4 + R() * 4;
      }
    }
    s += `<path d="M${half * 0.55} ${H * 0.88} c 10 -14 18 8 28 -4 s 12 6 22 -6 s 8 10 18 2" stroke="${ink}" stroke-width="1.5" fill="none"/>`;
    svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">${s}</svg>`;
  }
  return sharp(Buffer.from(svg)).png().toBuffer();
}

class MaterialSet {
  constructor(doc, SRC) {
    this.doc = doc;
    this.SRC = SRC;
    this.mats = new Map();
  }
  async get(key) {
    if (this.mats.has(key)) return this.mats.get(key);
    const m = MATS[key];
    const doc = this.doc;
    const mat = doc.createMaterial(`pp_${key}`).setRoughnessFactor(m.rough ?? 1).setMetallicFactor(m.metal ?? 0);
    if (m.color) mat.setBaseColorFactor(m.color);
    if (m.doubleSided) mat.setDoubleSided(true);
    const img = async (name, buf, size, mime = "image/png") => {
      const out = await sharp(buf).resize(size, size, { fit: "fill" }).png().toBuffer();
      return doc.createTexture(name).setImage(new Uint8Array(out)).setMimeType(mime).setURI(`${name}.png`);
    };
    if (m.tex) {
      const dir = path.join(this.SRC, "textures", m.tex);
      mat.setBaseColorTexture(await img(`pp_${key}_d`, await fs.readFile(path.join(dir, "Diffuse.jpg")), m.d));
      mat.setNormalTexture(await img(`pp_${key}_n`, await fs.readFile(path.join(dir, "nor_gl.jpg")), m.n));
      // ARM: R occlusion, G roughness, B metalness (0 on the wood sets), so both factors are 1
      const arm = await img(`pp_${key}_arm`, await fs.readFile(path.join(dir, "arm.jpg")), m.arm);
      mat.setMetallicRoughnessTexture(arm).setOcclusionTexture(arm).setRoughnessFactor(1).setMetallicFactor(1);
    }
    if (m.gen) {
      const buf = await genTexture(m.gen, m.size);
      mat.setBaseColorTexture(doc.createTexture(`pp_${key}_d`).setImage(new Uint8Array(buf)).setMimeType("image/png").setURI(`pp_${key}_d.png`));
    }
    if (m.extras) mat.setExtras(m.extras);
    this.mats.set(key, mat);
    return mat;
  }
}

// ------------------------------------------------------------------------------------------------
// geometry containers and node specs

/** Mesh builders per material. */
class Parts {
  constructor() {
    this.m = {};
  }
  get(k) {
    if (!MATS[k]) throw new Error(`procprops: unknown material ${k}`);
    return (this.m[k] ??= new MeshBuilder());
  }
  get empty() {
    return !Object.values(this.m).some((mb) => mb.i.length);
  }
  get tris() {
    return Object.values(this.m).reduce((s, mb) => s + mb.i.length / 3, 0);
  }
}

/**
 * A copy of `parts` with every vertex moved by `fp` (position) and `fn` (normal); `mirror` flips the
 * winding (for a reflection). Props never share a mesh: the runtime instantiates nodes one by one, and a
 * glTF mesh used twice becomes a Babylon InstancedMesh tied to the other node.
 */
function copyParts(parts, fp, fn = fp, mirror = false) {
  const out = new Parts();
  for (const [k, mb] of Object.entries(parts.m)) {
    const c = out.get(k);
    for (let v = 0; v < mb.vertexCount; v++) {
      const col = mb.c.length ? mb.c.slice(v * 4, v * 4 + 4) : undefined;
      c.vertex(fp(mb.p.slice(v * 3, v * 3 + 3)), nrm(fn(mb.n.slice(v * 3, v * 3 + 3))), mb.uv.slice(v * 2, v * 2 + 2), col);
    }
    for (let t = 0; t < mb.i.length; t += 3) mirror ? c.tri(mb.i[t], mb.i[t + 2], mb.i[t + 1]) : c.tri(mb.i[t], mb.i[t + 1], mb.i[t + 2]);
  }
  return out;
}

/**
 * A node spec: `parts` (render geometry → child `<name>_mesh`),
 * `col` (a collider MeshBuilder: the node itself is the collider mesh), `t`/`r`/`s`, `children`, `extras`.
 */
const N = (name, o = {}) => ({ name, children: [], ...o });

/** Box collider geometry (positions only are used). */
const colBox = (mb, center, size, rot = [0, 0, 0]) => box(mb, center, size, rot);


/** Oval ring (chain link): centre C, long axis d (unit), width axis u (unit), half-length L, half-width W, wire r. */
function ovalRing(mb, C, d, u, L, W, r, { segments = 8, sides = 4, color } = {}) {
  const w = cross(d, u);
  const base = mb.vertexCount;
  for (let i = 0; i <= segments; i++) {
    const a = (i / segments) * Math.PI * 2;
    const c = add(C, add(mul(d, L * Math.cos(a)), mul(u, W * Math.sin(a))));
    const n0 = nrm(add(mul(d, W * Math.cos(a)), mul(u, L * Math.sin(a))));
    for (let j = 0; j <= sides; j++) {
      const b = (j / sides) * Math.PI * 2;
      const n = add(mul(n0, Math.cos(b)), mul(w, Math.sin(b)));
      mb.vertex(add(c, mul(n, r)), n, [i / segments, j / sides], color);
    }
  }
  for (let i = 0; i < segments; i++)
    for (let j = 0; j < sides; j++) {
      const a = base + i * (sides + 1) + j, b = base + (i + 1) * (sides + 1) + j;
      mb.quad(a, b, b + 1, a + 1);
    }
}

export const CHAIN = { pitch: 0.125, L: 0.075, W: 0.045, r: 0.012 };
/** A straight chain from a to b: links interlock, alternating 90°; returns the link count. */
function chain(mb, a, b, { pitch = CHAIN.pitch, scale = 1, color } = {}) {
  const v = sub(b, a), l = len(v);
  const n = Math.max(1, Math.round(l / (pitch * scale)));
  const d = nrm(v);
  const u0 = nrm(Math.abs(d[1]) < 0.95 ? cross(d, [0, 1, 0]) : cross(d, [1, 0, 0]));
  const u1 = cross(d, u0);
  for (let k = 0; k < n; k++) {
    const C = lerp3(a, b, (k + 0.5) / n);
    ovalRing(mb, C, d, k % 2 ? u1 : u0, CHAIN.L * scale * ((l / n) / (pitch * scale)) ** 0.5, CHAIN.W * scale, CHAIN.r * scale, { color });
  }
  return n;
}
/** A chain along a polyline (each segment straight). */
function chainPath(mb, pts, o) {
  let n = 0;
  for (let i = 0; i < pts.length - 1; i++) n += chain(mb, pts[i], pts[i + 1], o);
  return n;
}
/** Points of a sagging chain between a and b (parabola, `sag` m at mid-span). */
function sagPoints(a, b, sag, n = 8) {
  const out = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const p = lerp3(a, b, t);
    p[1] -= sag * 4 * t * (1 - t);
    out.push(p);
  }
  return out;
}

/** A noisy, subdivided box (rock chunks, mounds): `size`, `amp` noise, `round` corner rounding. */
function lumpBox(mb, center, size, { amp = 0.06, round = 0.25, seed = 1, div = [6, 3, 5], tile = 2, color, rot = 0, flatBottom = false } = {}) {
  const R = rng(seed);
  const ph = [R() * 10, R() * 10, R() * 10, R() * 10, R() * 10, R() * 10];
  const noise = (p) =>
    Math.sin(p[0] * 3.1 + ph[0]) * Math.sin(p[1] * 2.7 + ph[1]) * Math.sin(p[2] * 3.3 + ph[2]) * 0.6 +
    Math.sin(p[0] * 7.3 + ph[3]) * Math.sin(p[1] * 6.1 + ph[4]) * Math.sin(p[2] * 6.9 + ph[5]) * 0.4;
  const h = mul(size, 0.5);
  const faces = [
    { n: [1, 0, 0], u: [0, 0, -1], v: [0, 1, 0], du: div[2], dv: div[1] },
    { n: [-1, 0, 0], u: [0, 0, 1], v: [0, 1, 0], du: div[2], dv: div[1] },
    { n: [0, 1, 0], u: [1, 0, 0], v: [0, 0, -1], du: div[0], dv: div[2] },
    { n: [0, -1, 0], u: [1, 0, 0], v: [0, 0, 1], du: div[0], dv: div[2] },
    { n: [0, 0, 1], u: [1, 0, 0], v: [0, 1, 0], du: div[0], dv: div[1] },
    { n: [0, 0, -1], u: [-1, 0, 0], v: [0, 1, 0], du: div[0], dv: div[1] },
  ];
  const start = mb.vertexCount, istart = mb.i.length;
  for (const f of faces) {
    const base = mb.vertexCount;
    for (let j = 0; j <= f.dv; j++)
      for (let i = 0; i <= f.du; i++) {
        const s = (i / f.du) * 2 - 1, t = (j / f.dv) * 2 - 1;
        // a point on the cube surface [-1,1]^3, pulled onto a superellipsoid (rounded edges and corners)
        const c = add(f.n, add(mul(f.u, s), mul(f.v, t)));
        const e = 4 + (1 - round) * 8;
        const k0 = (Math.abs(c[0]) ** e + Math.abs(c[1]) ** e + Math.abs(c[2]) ** e) ** (1 / e);
        const q = mul(c, 1 / k0);
        let p = [q[0] * h[0], q[1] * h[1], q[2] * h[2]];
        const nd = nrm([c[0] / h[0], c[1] / h[1], c[2] / h[2]]);
        const k = noise(add(p, center)) * amp;
        p = add(p, mul(nd, k));
        if (flatBottom && p[1] < -h[1]) p[1] = -h[1];
        p = rotY(p, rot);
        const w = add(center, p);
        mb.vertex(w, rotY(nd, rot), [0, 0], color);
      }
    for (let j = 0; j < f.dv; j++)
      for (let i = 0; i < f.du; i++) {
        const a = base + j * (f.du + 1) + i;
        mb.quad(a, a + 1, a + f.du + 2, a + f.du + 1);
      }
  }
  // smooth normals over the lump, then box-project UVs by the dominant normal axis
  const sub0 = new MeshBuilder();
  sub0.p = mb.p.slice(start * 3);
  sub0.i = mb.i.slice(istart).map((ix) => ix - start);
  sub0.computeNormals();
  for (let v = start; v < mb.vertexCount; v++) {
    const n = sub0.n.slice((v - start) * 3, (v - start) * 3 + 3);
    mb.n.splice(v * 3, 3, ...n);
    const p = mb.p.slice(v * 3, v * 3 + 3);
    const ax = Math.abs(n[0]) > Math.abs(n[1]) ? (Math.abs(n[0]) > Math.abs(n[2]) ? 0 : 2) : Math.abs(n[1]) > Math.abs(n[2]) ? 1 : 2;
    const uv = ax === 0 ? [p[2], p[1]] : ax === 1 ? [p[0], p[2]] : [p[0], p[1]];
    mb.uv.splice(v * 2, 2, uv[0] / tile, uv[1] / tile);
  }
}

// ------------------------------------------------------------------------------------------------
// props


/** The gallery set piece: drawbridge (3 states), pulleys, chains, winch, lever, slab. Origin = bridge_hinge. */
function galleryBridge(ctx) {
  const A = ctx.cave; // cave anchors (world)
  const H = A.bridge_hinge;
  const rel = (p) => sub(p, H);
  const DECK = { len: 8.8, width: 1.8, top: 0.15, bottom: -0.1, south: 5.2, plank: 0.6 };
  const ANG = { raised: -Math.PI / 3, lowered: 0, broken: (35 * Math.PI) / 180 };
  const spec = N("gallery_bridge", { children: [] });
  const extras = { kind: "set piece", frame: "world axes, origin at the cave anchor bridge_hinge", at: r3(H), yaw: 0 };

  // ---- deck (lowered pose; the hinge rotates it about +X)
  const hinge = N("bridge_hinge", { children: [] });
  const south = new Parts();
  const boardsSouth = 18, pitchS = DECK.south / boardsSouth;
  const deckBoard = (p, z0, z1, k) => {
    box(p.get("planks"), [0, (0.06 + DECK.top) / 2, (z0 + z1) / 2], [DECK.width, DECK.top - 0.06, z1 - z0 - 0.012], [0, 0, 0], { tile: 2, uvOffset: [k * 0.37, k * 0.21] });
  };
  for (let k = 0; k < boardsSouth; k++) deckBoard(south, k * pitchS, (k + 1) * pitchS, k);
  const stringer = (p, z0, z1) => {
    for (const x of [-0.72, 0.72]) box(p.get("wood"), [x, -0.02, (z0 + z1) / 2], [0.18, 0.16, z1 - z0], [0, 0, 0], { tile: 1.2 });
  };
  stringer(south, 0.05, DECK.south);
  const strap = (p, z) => {
    box(p.get("iron"), [0, DECK.top + 0.004, z], [DECK.width + 0.02, 0.012, 0.07], [0, 0, 0], { tile: 0.6 });
    for (const x of [-0.91, 0.91]) box(p.get("iron"), [x, 0.03, z], [0.012, 0.25, 0.07], [0, 0, 0], { tile: 0.6 });
  };
  for (const z of [0.9, 2.5, 4.1]) strap(south, z);
  // knuckles around the pin
  for (const x of [-0.7, 0.7]) cylinder(south.get("iron"), [x, 0, 0], 0.085, 0.3, [0, 0, Math.PI / 2], { sides: 12, tile: 0.6 });
  // edge irons along both sides
  for (const x of [-0.905, 0.905]) box(south.get("iron"), [x, DECK.top - 0.02, DECK.south / 2], [0.012, 0.05, DECK.south], [0, 0, 0], { tile: 0.6 });
  hinge.children.push(N("bridge_deck_south", { parts: south }));
  const planks = [];
  for (let k = 0; k < 6; k++) {
    const z0 = DECK.south + k * DECK.plank, z1 = z0 + DECK.plank, zc = (z0 + z1) / 2;
    const p = new Parts();
    deckBoard(p, z0 - zc, z0 - zc + 0.3, 20 + k * 2);
    deckBoard(p, z0 - zc + 0.3, z1 - zc, 21 + k * 2);
    stringer(p, z0 - zc, z1 - zc);
    for (const x of [-0.905, 0.905]) box(p.get("iron"), [x, DECK.top - 0.02, 0], [0.012, 0.05, DECK.plank - 0.01], [0, 0, 0], { tile: 0.6 });
    if (k === 2) strap(p, 0);
    if (k === 5) {
      // tip: iron edge band and the two eye-bolts the chains hang from
      box(p.get("iron"), [0, 0.03, DECK.plank / 2 - 0.02], [DECK.width + 0.02, 0.25, 0.03], [0, 0, 0], { tile: 0.6 });
      for (const x of [-0.8, 0.8]) torus(p.get("iron"), [x, DECK.top + 0.045, DECK.plank / 2 - 0.06], 0.035, 0.011, [0, 0, Math.PI / 2], { segments: 10, sides: 5, tile: 0.3 });
    }
    planks.push({ name: `bridge_plank_${k}`, at: [0, 0, zc], half: [DECK.width / 2 + 0.01, (DECK.top - DECK.bottom) / 2 + 0.02, DECK.plank / 2] });
    hinge.children.push(N(`bridge_plank_${k}`, { t: [0, 0, zc], parts: p, extras: { debris: { half: r3([DECK.width / 2 + 0.01, 0.13, DECK.plank / 2]), centre: [0, 0.025, 0], massHint: 45 } } }));
  }
  const eye = (x) => [x, DECK.top + 0.045, DECK.len - 0.06];
  hinge.children.push(N("bridge_tip_w", { t: eye(-0.8) }), N("bridge_tip_e", { t: eye(0.8) }));
  spec.children.push(hinge);

  // ---- hinge frame on the south bank (static): stone blocks, straps, the pin
  const frame = new Parts();
  for (const x of [-1.12, 1.12]) {
    lumpBox(frame.get("rock"), [x, -0.2, -0.05], [0.42, 0.95, 0.6], { amp: 0.025, round: 0.15, seed: 7 + x * 10, div: [3, 4, 3], tile: 2, color: [0.85, 0.85, 0.85, 1] });
    box(frame.get("iron"), [x, 0.05, 0.0], [0.44, 0.16, 0.22], [0, 0, 0], { tile: 0.6 });
  }
  cylinder(frame.get("iron"), [0, 0, 0], 0.045, 2.6, [0, 0, Math.PI / 2], { sides: 10, tile: 0.6 });
  spec.children.push(N("bridge_frame", { parts: frame }));
  const frameCol = new MeshBuilder();
  for (const x of [-1.12, 1.12]) colBox(frameCol, [x, -0.1, -0.05], [0.44, 1.0, 0.62]);
  spec.children.push(N("bridge_frame_col", { col: frameCol, extras: { tag: "bridge_frame", static: true } }));

  // ---- deck colliders, one per state (static bodies; enable one at a time)
  const deckBox = (ang, z1) => {
    const mb = new MeshBuilder();
    const c = rotX([0, (DECK.top + DECK.bottom) / 2, z1 / 2], ang);
    colBox(mb, c, [DECK.width, DECK.top - DECK.bottom, z1], [ang, 0, 0]);
    return mb;
  };
  const states = {
    raised: { angle: ANG.raised, col: "bridge_deck_raised_col" },
    lowered: { angle: ANG.lowered, col: "bridge_deck_lowered_col" },
    broken: { angle: ANG.broken, col: "bridge_deck_broken_col" },
  };
  for (const [k, s] of Object.entries(states)) spec.children.push(N(s.col, { col: deckBox(s.angle, k === "broken" ? DECK.south : DECK.len), extras: { tag: `bridge_deck_${k}`, state: k, hingeAngle: +s.angle.toFixed(4) } }));

  // ---- pulleys on the dome above mid-span (the slab, 2.4 m wide, falls between them): 0.5 m north of
  // the raised deck's tip eyes, hung from the rock field's ceiling there (the bracket plate's top 4 cm
  // into the rock at the highest point of its footprint)
  const raisedEye = rotX(eye(0), ANG.raised);
  const PUL = { dx: 1.4, z: raisedEye[2] + 0.5, r: 0.18, plateTop: 0.52, bite: 0.04 };
  const pulleys = {};
  const pulleyInfo = {};
  for (const [side, sx] of [["w", -1], ["e", 1]]) {
    let top = -Infinity;
    for (const [fx, fz] of [[0, 0], [-0.15, -0.17], [0.15, -0.17], [-0.15, 0.17], [0.15, 0.17]]) {
      const c = ctx.field.ceilingAt(H[0] + sx * PUL.dx + fx, H[2] + PUL.z + fz, H[1] + raisedEye[1]);
      if (c === null) throw new Error(`procprops: no rock above the ${side} pulley at (${r3([H[0] + sx * PUL.dx + fx, H[2] + PUL.z + fz]).join(", ")}) within 4 m of the raised deck tip`);
      top = Math.max(top, c);
    }
    const P = [sx * PUL.dx, top + PUL.bite - PUL.plateTop - H[1], PUL.z];
    pulleyInfo[side] = { at: r3(add(H, P)), ceiling: +top.toFixed(3) };
    pulleys[side] = P;
    const p = new Parts();
    // sheave (axle along X) and its cheeks, bolted up into the rock
    cylinder(p.get("iron"), P, PUL.r, 0.05, [0, 0, Math.PI / 2], { sides: 16, tile: 0.4 });
    torus(p.get("iron"), P, PUL.r - 0.01, 0.018, [0, 0, Math.PI / 2], { segments: 16, sides: 5, tile: 0.4 });
    cylinder(p.get("iron"), P, 0.03, 0.2, [0, 0, Math.PI / 2], { sides: 8, tile: 0.4 });
    for (const dx of [-0.07, 0.07]) box(p.get("iron"), [P[0] + dx, P[1] + 0.2, P[2]], [0.02, 0.62, 0.26], [0, 0, 0], { tile: 0.5 });
    box(p.get("iron"), [P[0], P[1] + 0.5, P[2]], [0.3, 0.04, 0.34], [0, 0, 0], { tile: 0.5 });
    spec.children.push(N(`bridge_pulley_${side}`, { parts: p, pulley: P }));
  }

  // ---- winch (on the north ledge): drum axis across the haul direction
  const W = rel(A.winch);
  const towardPulleys = sub(mul(add(pulleys.w, pulleys.e), 0.5), W);
  const haulYaw = Math.atan2(towardPulleys[0], towardPulleys[2]); // heading of the haul in XZ
  const drumAxis = nrm([Math.cos(haulYaw), 0, -Math.sin(haulYaw)]); // perpendicular to the haul heading
  const winchYaw = Math.atan2(-drumAxis[2], drumAxis[0]); // rotation about +Y that takes local X to drumAxis
  const winch = N("winch", { t: W, r: qAxis([0, 1, 0], winchYaw), children: [] });
  const DRUM = { y: 0.78, r: 0.2, half: 0.32 };
  const wf = new Parts();
  // stone foundation (sunk into the sloping ledge) and timber sills
  lumpBox(wf.get("rock"), [0, -0.085, 0], [1.05, 0.73, 0.66], { amp: 0.02, round: 0.12, seed: 31, div: [4, 3, 3], tile: 2, color: [0.9, 0.9, 0.9, 1] });
  for (const z of [-0.24, 0.24]) box(wf.get("wood"), [0, 0.33, z], [1.0, 0.12, 0.14], [0, 0, 0], { tile: 1 });
  // A-frames at both ends of the drum
  for (const x of [-0.42, 0.42]) {
    for (const z of [-0.24, 0.24]) {
      const a = [x, 0.38, z], b = [x, DRUM.y + 0.05, z * 0.15];
      const m = mul(add(a, b), 0.5), d = sub(b, a);
      box(wf.get("wood"), m, [0.09, len(d) + 0.08, 0.09], [Math.atan2(d[2], d[1]), 0, 0], { tile: 1 });
    }
    box(wf.get("iron"), [x, DRUM.y, 0], [0.1, 0.14, 0.16], [0, 0, 0], { tile: 0.5 });
  }
  // the pawl on the east frame
  box(wf.get("iron"), [0.5, DRUM.y + 0.16, -0.16], [0.03, 0.04, 0.22], [0.5, 0, 0], { tile: 0.4 });
  winch.children.push(N("winch_frame", { parts: wf }));
  const drum = N("winch_drum", { t: [0, DRUM.y, 0], children: [] });
  const dp = new Parts();
  cylinder(dp.get("wood"), [0, 0, 0], DRUM.r, DRUM.half * 2, [0, 0, Math.PI / 2], { sides: 14, tile: 1 });
  for (const x of [-DRUM.half - 0.02, DRUM.half + 0.02]) cylinder(dp.get("iron"), [x, 0, 0], DRUM.r + 0.06, 0.04, [0, 0, Math.PI / 2], { sides: 16, tile: 0.5 });
  cylinder(dp.get("iron"), [0, 0, 0], 0.035, 1.2, [0, 0, Math.PI / 2], { sides: 8, tile: 0.5 });
  // coiled chain on the drum
  for (let k = 0; k < 7; k++) torus(dp.get("iron"), [-DRUM.half + 0.06 + k * 0.085, 0, 0], DRUM.r + 0.018, 0.018, [0, 0, Math.PI / 2], { segments: 14, sides: 4, tile: 0.3 });
  // ratchet wheel (outside the east frame) and the crank (west)
  cylinder(dp.get("iron"), [0.52, 0, 0], 0.22, 0.035, [0, 0, Math.PI / 2], { sides: 16, tile: 0.4 });
  for (let k = 0; k < 12; k++) {
    const a = (k / 12) * Math.PI * 2;
    box(dp.get("iron"), [0.52, Math.cos(a) * 0.235, Math.sin(a) * 0.235], [0.035, 0.05, 0.035], [a, 0, 0], { tile: 0.4 });
  }
  box(dp.get("iron"), [-0.6, -0.15, 0], [0.03, 0.34, 0.05], [0, 0, 0], { tile: 0.4 });
  cylinder(dp.get("wood"), [-0.68, -0.3, 0], 0.025, 0.16, [0, 0, Math.PI / 2], { sides: 8, tile: 0.5 });
  drum.parts = dp;
  winch.children.push(drum);
  const winchCol = new MeshBuilder();
  colBox(winchCol, [0, 0.38, 0], [1.25, 1.3, 0.7]);
  winch.children.push(N("winch_col", { col: winchCol, extras: { tag: "winch", static: true } }));
  // where the haul chains leave the drum (winch-local → set-piece frame)
  const toSet = (p) => add(W, rotY(p, winchYaw));
  const drumOut = { w: toSet([-0.2, DRUM.y + DRUM.r, 0]), e: toSet([0.2, DRUM.y + DRUM.r, 0]) };
  // pair each pulley with the nearer drum end
  const dW = len(sub(drumOut.w, pulleys.w)) + len(sub(drumOut.e, pulleys.e));
  const dX = len(sub(drumOut.w, pulleys.e)) + len(sub(drumOut.e, pulleys.w));
  const haul = dW <= dX ? { w: drumOut.w, e: drumOut.e } : { w: drumOut.e, e: drumOut.w };
  spec.children.push(winch);

  // ---- chains: per state from the tip eyes to the sheaves, and the haul chains (always shown)
  const tipEye = (sx, ang) => rotX(eye(sx * 0.8), ang);
  const sheave = (side) => add(pulleys[side], [0, -PUL.r * 0.3, 0]);
  const chainNodes = {};
  for (const state of ["raised", "lowered", "broken"]) {
    const p = new Parts();
    for (const [side, sx] of [["w", -1], ["e", 1]]) {
      if (state === "broken") {
        // the eye went with the north planks: the chain hangs from the sheave
        const top = sheave(side);
        chainPath(p.get("iron"), [top, add(top, [0.02 * sx, -1.6, 0.05]), add(top, [0.05 * sx, -3.1, 0.12])]);
      } else chain(p.get("iron"), tipEye(sx, ANG[state]), sheave(side));
    }
    chainNodes[state] = `bridge_chain_${state}`;
    spec.children.push(N(`bridge_chain_${state}`, { parts: p, extras: { state } }));
  }
  const hp = new Parts();
  for (const side of ["w", "e"]) chain(hp.get("iron"), haul[side], add(pulleys[side], [0, 0.05, 0]));
  spec.children.push(N("bridge_haul_chains", { parts: hp }));
  for (const side of ["w", "e"]) spec.children.push(N(`bridge_sheave_${side}`, { t: sheave(side) }));

  // ---- lever (on its anchor; the puller stands at lever_stance facing −Z)
  const LV = ctx.lever; // pivot (lever-local), radius, rest and pulled angles, pull curve
  const Lp = rel(A.lever);
  const lever = N("lever", { t: Lp, children: [] });
  const lb = new Parts();
  // stone block, two iron cheeks up to the pivot, an axle, a toothed quadrant
  lumpBox(lb.get("rock"), [LV.pivot[0], 0.22, LV.pivot[2]], [0.5, 0.62, 0.5], { amp: 0.02, round: 0.15, seed: 41, div: [3, 3, 3], tile: 2, color: [0.9, 0.9, 0.9, 1] });
  for (const dx of [-0.075, 0.075]) box(lb.get("iron"), [LV.pivot[0] + dx, (0.5 + LV.pivot[1] + 0.12) / 2, LV.pivot[2]], [0.025, LV.pivot[1] + 0.12 - 0.5, 0.2], [0, 0, 0], { tile: 0.5 });
  cylinder(lb.get("iron"), [LV.pivot[0], LV.pivot[1], LV.pivot[2]], 0.03, 0.22, [0, 0, Math.PI / 2], { sides: 8, tile: 0.4 });
  {
    // quadrant guide beside the handle, rest → pulled
    const pts = [];
    for (let k = 0; k <= 10; k++) {
      const th = LV.rest + ((LV.rest + LV.pulled - LV.rest) * k) / 10 - 0.05 + (0.1 * k) / 10;
      pts.push(add([LV.pivot[0] + 0.11, LV.pivot[1], LV.pivot[2]], [0, Math.cos(th) * 0.55, Math.sin(th) * 0.55]));
    }
    tube(lb.get("iron"), pts, [0.025, 0.012], { sides: 6, tile: 0.4 });
    box(lb.get("iron"), [LV.pivot[0] + 0.11, LV.pivot[1] - 0.2, LV.pivot[2] + 0.1], [0.025, 0.5, 0.04], [-0.6, 0, 0], { tile: 0.4 });
  }
  lever.children.push(N("lever_base", { parts: lb }));
  const pivot = N("lever_pivot", { t: LV.pivot, children: [] });
  const hl = new Parts();
  {
    // the shaft stops just past the hand (LEVER.end): at full pull a longer overhang reaches the
    // puller's thigh and belly (checked in leverFromClip)
    const dir = [0, Math.cos(LV.rest), Math.sin(LV.rest)];
    const a = mul(dir, -0.28), b = mul(dir, LV.radius + LEVER.end - 0.01);
    const m = mul(add(a, b), 0.5);
    box(hl.get("wood"), m, [0.07, len(sub(b, a)), 0.07], [LV.rest, 0, 0], { tile: 1 });
    // counterweight, iron ferrules and end cap, leather grip (R − 0.10 … R + 0.04)
    box(hl.get("iron"), mul(dir, -0.24), [0.13, 0.14, 0.13], [LV.rest, 0, 0], { tile: 0.4 });
    for (const t of [0.05, LV.radius - 0.13, LV.radius + LEVER.end - 0.015]) box(hl.get("iron"), mul(dir, t), [0.085, 0.03, 0.085], [LV.rest, 0, 0], { tile: 0.4 });
    cylinder(hl.get("leather"), mul(dir, LV.radius - 0.03), 0.045, 0.14, [LV.rest, 0, 0], { sides: 10, tile: 0.3 });
  }
  pivot.parts = hl;
  pivot.children.push(N("lever_grip", { t: [0, Math.cos(LV.rest) * LV.radius, Math.sin(LV.rest) * LV.radius] }));
  lever.children.push(pivot);
  const leverCol = new MeshBuilder();
  colBox(leverCol, [LV.pivot[0], (LV.pivot[1] + 0.15) / 2 - 0.05, LV.pivot[2]], [0.52, LV.pivot[1] + 0.25, 0.52]);
  lever.children.push(N("lever_col", { col: leverCol, extras: { tag: "lever", static: true } }));
  spec.children.push(lever);

  // ---- the slab that breaks the deck in K12 (hidden until the crack; then a Debris box)
  const S = rel(A.slab_drop);
  const slab = new Parts();
  lumpBox(slab.get("rock"), [0, 0, 0], [2.4, 1.0, 1.8], { amp: 0.09, round: 0.35, seed: 5, div: [8, 4, 6], tile: 2, color: [0.8, 0.8, 0.8, 1] });
  spec.children.push(N("slab", { t: S, parts: slab, extras: { debris: { half: [1.2, 0.5, 0.9], massHint: 1800 }, note: "hidden until K12 2.8 s; then a Debris box from here, falls onto mid-span" } }));

  extras.deck = {
    node: "bridge_hinge",
    axis: [1, 0, 0],
    angles: { raised: +ANG.raised.toFixed(4), lowered: 0, broken: +ANG.broken.toFixed(4) },
    note: "rotationQuaternion = RotationAxis(+X, angle); lowered is identity. Broken: hide bridge_plank_0..5 and spawn Debris boxes from them (extras.debris), then swing to `broken`",
    size: [DECK.width, DECK.top - DECK.bottom, DECK.len],
    top: DECK.top,
    southLength: DECK.south,
    planks: planks.map((p) => p.name),
    tips: ["bridge_tip_w", "bridge_tip_e"],
  };
  extras.colliders = { raised: "bridge_deck_raised_col", lowered: "bridge_deck_lowered_col", broken: "bridge_deck_broken_col", static: ["bridge_frame_col", "winch_col", "lever_col"] };
  extras.chains = {
    states: chainNodes,
    haul: "bridge_haul_chains",
    sheaves: ["bridge_sheave_w", "bridge_sheave_e"],
    live: "while the deck moves, hide bridge_chain_* and draw each chain from its sheave to its tip eye (bridge_tip_w/e under bridge_hinge): `chain_strip` (1 m, 8 links along +Y) instances, n = max(1, round(L)), each scaled by L/n along Y",
  };
  extras.winch = { node: "winch_drum", axis: "winch-local +X (the drum axis); spin it while the deck moves", yaw: +winchYaw.toFixed(4) };
  extras.lever = {
    node: "lever_pivot",
    axis: [1, 0, 0],
    pulled: +LV.pulled.toFixed(4),
    grip: "lever_grip",
    clip: { name: "Farm_PickingTree", grab: LV.grab, release: LV.release, curve: LV.curve },
    restAngle: +LV.rest.toFixed(4),
    length: +(LV.radius + LEVER.end).toFixed(3),
    note: `identity = the rest pose: the handle leans ${Math.round((LV.rest * 180) / Math.PI)}° from vertical toward the puller (lever_grip at (0, ${(Math.cos(LV.rest) * LV.radius).toFixed(3)}, ${(Math.sin(LV.rest) * LV.radius).toFixed(3)}) from the pivot); pulling turns it further down toward the puller. Drive the angle by \`curve\` ([clip seconds, radians]) so the grip follows the puller's right hand`,
    handGap: LV.gap,
    lateral: LV.lateral,
    bodyClear: LV.bodyClear,
    ik: {
      bone: "hand_r",
      target: "lever_grip",
      window: [LV.grab, LV.release],
      note: `the planar handle cannot follow the clip's hand exactly: without help the hand is up to ${LV.gap} m from lever_grip (mostly sideways: the hand drifts x ${LV.lateral.min}…${LV.lateral.max} m off the lever's plane during the pull). Pull the right hand onto lever_grip with a small two-bone IK over the window (blend in and out over ~0.1 s), or accept the gap`,
    },
  };
  extras.pulleys = { nodes: ["bridge_pulley_w", "bridge_pulley_e"], ...pulleyInfo, note: "world; hung from the rock field's ceiling 0.5 m north of the raised deck's tip eyes" };
  extras.slab = { node: "slab", drop: r3(A.slab_drop) };
  spec.extras = extras;
  return spec;
}

/** Prisoner cage 2.0 × 2.2 × 2.0 m, door on the −Z face (hinged at x −0.45, opens outward). */
function cage() {
  const W = 2.0, D = 2.0, H = 2.2, door = { x0: -0.45, x1: 0.45, y1: 1.95 };
  const p = new Parts(), iron = p.get("iron");
  const t = 0.05;
  // corner posts and the top/bottom rectangles
  for (const x of [-W / 2, W / 2]) for (const z of [-D / 2, D / 2]) box(iron, [x, H / 2, z], [t, H, t], [0, 0, 0], { tile: 0.6 });
  for (const y of [0.025, 1.1, H - 0.025]) {
    for (const z of [-D / 2, D / 2]) {
      if (z < 0 && y < H - 0.1) {
        // front band broken by the door opening
        box(iron, [(-W / 2 + door.x0) / 2, y, z], [door.x0 + W / 2, t, 0.02], [0, 0, 0], { tile: 0.6 });
        box(iron, [(W / 2 + door.x1) / 2, y, z], [W / 2 - door.x1, t, 0.02], [0, 0, 0], { tile: 0.6 });
      } else box(iron, [0, y, z], [W, t, t * (y > 2 || y < 0.1 ? 1 : 0.4)], [0, 0, 0], { tile: 0.6 });
    }
    for (const x of [-W / 2, W / 2]) box(iron, [x, y, 0], [t * (y > 2 || y < 0.1 ? 1 : 0.4), t, D], [0, 0, 0], { tile: 0.6 });
  }
  // door frame posts and the lintel over the opening
  for (const x of [door.x0 - 0.03, door.x1 + 0.03]) box(iron, [x, H / 2, -D / 2], [0.04, H, 0.04], [0, 0, 0], { tile: 0.6 });
  box(iron, [0, door.y1 + 0.03, -D / 2], [door.x1 - door.x0 + 0.1, 0.04, 0.04], [0, 0, 0], { tile: 0.6 });
  const bar = (mb, a, b) => cylinder(mb, mul(add(a, b), 0.5), 0.012, len(sub(b, a)), b[0] !== a[0] ? [0, 0, Math.PI / 2] : b[2] !== a[2] ? [Math.PI / 2, 0, 0] : [0, 0, 0], { sides: 6, caps: false, tile: 0.6 });
  const step = 0.12;
  for (let x = -W / 2 + step; x < W / 2 - 0.05; x += step) {
    bar(iron, [x, 0.05, D / 2], [x, H - 0.05, D / 2]);
    if (x < door.x0 - 0.06 || x > door.x1 + 0.06) bar(iron, [x, 0.05, -D / 2], [x, H - 0.05, -D / 2]);
    else bar(iron, [x, door.y1 + 0.05, -D / 2], [x, H - 0.05, -D / 2]);
  }
  for (let z = -D / 2 + step; z < D / 2 - 0.05; z += step) for (const x of [-W / 2, W / 2]) bar(iron, [x, 0.05, z], [x, H - 0.05, z]);
  // roof grid, floor slats and a hanging ring
  for (let x = -W / 2 + 0.2; x < W / 2 - 0.05; x += 0.2) bar(iron, [x, H - 0.02, -D / 2], [x, H - 0.02, D / 2]);
  for (let z = -D / 2 + 0.25; z < D / 2 - 0.05; z += 0.25) box(iron, [0, 0.03, z], [W, 0.012, 0.05], [0, 0, 0], { tile: 0.6 });
  torus(iron, [0, H + 0.07, 0], 0.07, 0.014, [Math.PI / 2, 0, 0], { segments: 12, sides: 5, tile: 0.3 });
  // door leaf: in hinge-local coordinates (hinge at x0, z −D/2)
  const dl = new Parts(), di = dl.get("iron");
  const dw = door.x1 - door.x0;
  for (const y of [0.06, 1.0, door.y1 - 0.02]) box(di, [dw / 2, y, 0], [dw, 0.045, 0.02], [0, 0, 0], { tile: 0.6 });
  for (const x of [0.02, dw - 0.02]) box(di, [x, door.y1 / 2, 0], [0.035, door.y1 - 0.05, 0.03], [0, 0, 0], { tile: 0.6 });
  for (let x = 0.12; x < dw - 0.06; x += step) bar(di, [x, 0.08, 0], [x, door.y1 - 0.04, 0]);
  box(di, [dw - 0.06, 1.0, -0.03], [0.1, 0.14, 0.05], [0, 0, 0], { tile: 0.3 });
  for (const y of [0.3, 1.6]) cylinder(di, [0, y, 0], 0.025, 0.12, [0, 0, 0], { sides: 8, tile: 0.3 });
  const doorCol = new MeshBuilder();
  colBox(doorCol, [dw / 2, door.y1 / 2, 0], [dw, door.y1, 0.05]);
  const doorNode = N("cage_door", { t: [door.x0, 0, -D / 2], parts: dl, children: [N("cage_door_col", { col: doorCol, extras: { tag: "cage_door" } })] });
  const col = new MeshBuilder();
  colBox(col, [0, H / 2, D / 2], [W, H, 0.05]);
  for (const x of [-W / 2, W / 2]) colBox(col, [x, H / 2, 0], [0.05, H, D]);
  colBox(col, [0, H, 0], [W, 0.05, D]);
  colBox(col, [(-W / 2 + door.x0) / 2, H / 2, -D / 2], [door.x0 + W / 2, H, 0.05]);
  colBox(col, [(W / 2 + door.x1) / 2, H / 2, -D / 2], [W / 2 - door.x1, H, 0.05]);
  colBox(col, [0, (door.y1 + H) / 2, -D / 2], [dw, H - door.y1, 0.05]);
  return N("cage", {
    children: [N("cage_frame", { parts: p }), doorNode, N("cage_col", { col, extras: { tag: "cage", static: true } }), N("cage_inside", { t: [0, 0, 0.2] })],
    extras: {
      kind: "prop",
      size: [W, H, D],
      door: { node: "cage_door", hinge: [door.x0, 0, -D / 2], axis: [0, 1, 0], openYaw: +(Math.PI / 2).toFixed(4), width: dw, height: door.y1, initial: "closed", collider: "cage_door_col", note: "rotationQuaternion = RotationAxis(Up, t · openYaw); opens outward (−Z side)" },
      inside: "cage_inside",
    },
  });
}

/** Interrogation chair: high back, leather straps on the arms, ankles and chest; faces −Z. */
function strapChair() {
  const p = new Parts(), wood = p.get("wood"), lth = p.get("leather"), iron = p.get("iron");
  const S = { w: 0.6, d: 0.58, h: 0.48 };
  for (const x of [-0.26, 0.26]) for (const z of [-0.25, 0.25]) box(wood, [x, (z > 0 ? 1.3 : 0.74) / 2, z], [0.08, z > 0 ? 1.3 : 0.74, 0.08], [0, 0, 0], { tile: 1 });
  box(wood, [0, S.h, 0], [S.w, 0.06, S.d], [0, 0, 0], { tile: 1 });
  for (const z of [-0.25, 0.25]) box(wood, [0, 0.14, z], [0.52, 0.06, 0.05], [0, 0, 0], { tile: 1 });
  for (const x of [-0.26, 0.26]) box(wood, [x, 0.14, 0], [0.05, 0.06, 0.5], [0, 0, 0], { tile: 1 });
  for (const y of [0.75, 0.98, 1.22]) box(wood, [0, y, 0.26], [0.5, 0.09, 0.04], [0, 0, 0], { tile: 1 });
  for (const x of [-0.29, 0.29]) box(wood, [x, 0.76, 0], [0.11, 0.05, 0.6], [0, 0, 0], { tile: 1 });
  const strapAround = (c, size) => {
    box(lth, c, add(size, [0.012, 0.012, 0]), [0, 0, 0], { tile: 0.3 });
    box(iron, add(c, [size[0] / 2 + 0.008, 0, 0]), [0.008, 0.035, 0.03], [0, 0, 0], { tile: 0.2 });
  };
  for (const x of [-0.29, 0.29]) strapAround([x, 0.76, -0.12], [0.12, 0.06, 0.05]);
  for (const x of [-0.26, 0.26]) strapAround([x, 0.18, -0.25], [0.09, 0.05, 0.09]);
  box(lth, [0, 0.98, 0.21], [0.56, 0.06, 0.012], [0, 0, 0], { tile: 0.3 });
  const col = new MeshBuilder();
  colBox(col, [0, 0.65, 0], [0.7, 1.3, 0.62]);
  return N("strap_chair", { children: [N("strap_chair_frame", { parts: p }), N("strap_chair_col", { col, extras: { tag: "strap_chair", static: true } }), N("strap_chair_sit", { t: [0, S.h + 0.03, -0.02] })], extras: { kind: "prop", size: [0.7, 1.3, 0.62], seat: S.h + 0.03 } });
}

/** Wall shackles: two wrist chains from rings at 1.75 m, an ankle chain; the wall is at z +0.3. */
function shackles() {
  const p = new Parts(), iron = p.get("iron");
  const wall = 0.3;
  const cuffs = {};
  for (const [side, x] of [["l", -0.34], ["r", 0.34]]) {
    box(iron, [x, 1.75, wall - 0.012], [0.11, 0.15, 0.024], [0, 0, 0], { tile: 0.3 });
    torus(iron, [x, 1.68, wall - 0.05], 0.04, 0.009, [Math.PI / 2, 0, 0], { segments: 12, sides: 5, tile: 0.3 });
    const cuff = [x * 0.88, 1.25, wall - 0.2];
    cuffs[side] = cuff;
    chainPath(iron, sagPoints([x, 1.64, wall - 0.05], add(cuff, [0, 0.06, 0]), 0.12, 4), { scale: 0.6 });
    torus(iron, cuff, 0.048, 0.011, [0, 0, 0], { segments: 14, sides: 5, tile: 0.3 });
  }
  box(iron, [0, 0.28, wall - 0.012], [0.12, 0.12, 0.024], [0, 0, 0], { tile: 0.3 });
  const floorCuff = [0.18, 0.012, -0.32];
  chainPath(iron, [[0, 0.24, wall - 0.05], [0.05, 0.02, wall - 0.25], floorCuff], { scale: 0.6 });
  torus(iron, add(floorCuff, [0, 0.005, -0.04]), 0.055, 0.011, [0, 0.3, 0], { segments: 14, sides: 5, tile: 0.3 });
  return N("shackles", {
    children: [N("shackles_iron", { parts: p }), N("shackles_cuff_l", { t: cuffs.l }), N("shackles_cuff_r", { t: cuffs.r })],
    extras: { kind: "prop", wall: "the wall is at z +0.3 (the anchor stands 0.3 m out from it, facing −Z)", cuffs: { l: r3(cuffs.l), r: r3(cuffs.r), note: "a body sitting against the wall (its facing −Z) has its left wrist in cuff_l" } },
  });
}

/** Generic chains: one link, a tileable 1 m strip (along +Y, 8 links), and a 2 m hanging chain. */
function chains() {
  const link = new Parts();
  ovalRing(link.get("iron"), [0, 0, 0], [0, 1, 0], [1, 0, 0], CHAIN.L, CHAIN.W, CHAIN.r);
  const strip = new Parts();
  chain(strip.get("iron"), [0, 0, 0], [0, 1, 0]);
  const hang = new Parts();
  torus(hang.get("iron"), [0, -0.05, 0], 0.06, 0.012, [Math.PI / 2, 0, 0], { segments: 12, sides: 5, tile: 0.3 });
  box(hang.get("iron"), [0, -0.01, 0], [0.14, 0.02, 0.14], [0, 0, 0], { tile: 0.3 });
  chain(hang.get("iron"), [0, -0.1, 0], [0.03, -2.0, 0.02]);
  return [
    N("chain_link", { parts: link, extras: { kind: "part", size: [2 * (CHAIN.W + CHAIN.r), 2 * (CHAIN.L + CHAIN.r), 2 * CHAIN.r], axis: "+Y" } }),
    N("chain_strip", { parts: strip, extras: { kind: "part", length: 1, links: 8, axis: "+Y from 0 to 1; instances end to end tile seamlessly (an even link count)" } }),
    N("chain_hang", { parts: hang, extras: { kind: "dressing", length: 2.0, note: "origin at the ceiling ring; hangs down −Y" } }),
  ];
}

/** A barred panel 1.0 × 2.4 m (bars r 15 mm every 0.12 m, as the keep's cell fronts), with its collider. */
function barsPanel() {
  const p = new Parts(), iron = p.get("iron");
  const W = 1.0, H = 2.4;
  for (const y of [0.04, 1.2, H - 0.04]) box(iron, [0, y, 0], [W, 0.05, 0.03], [0, 0, 0], { tile: 0.6 });
  for (const x of [-W / 2 + 0.02, W / 2 - 0.02]) box(iron, [x, H / 2, 0], [0.04, H, 0.04], [0, 0, 0], { tile: 0.6 });
  for (let x = -W / 2 + 0.12; x < W / 2 - 0.05; x += 0.12) cylinder(iron, [x, H / 2, 0], 0.015, H - 0.06, [0, 0, 0], { sides: 6, caps: false, tile: 0.6 });
  const col = new MeshBuilder();
  colBox(col, [0, H / 2, 0], [W, H, 0.06]);
  return N("bars_panel", { children: [N("bars_panel_iron", { parts: p }), N("bars_panel_col", { col, extras: { tag: "bars", static: true } })], extras: { kind: "fixture", size: [W, H, 0.04], note: "origin at the bottom centre; tile side by side every 1.0 m" } });
}

/**
 * Rope cuffs (two turns of rope around a wrist), one per hand; the bound player in K1. Sized on the
 * base bodies' wrists (checked at build time): the section around hand_l's origin spans x −0.021…0.030,
 * z −0.039…0.041 (male and female), so the coil is centred at x +0.003 (left; mirrored for the right).
 */
export const CUFF = { cx: 0.003, rx: 0.0395, rz: 0.054, r: 0.0075, y0: -0.012, rise: 0.028 };
function cuffs() {
  const p = new Parts(), rope = p.get("rope");
  const pts = [];
  const turns = 2.3, n = 64;
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * turns * Math.PI * 2;
    pts.push([CUFF.cx + Math.cos(a) * CUFF.rx, CUFF.y0 + (i / n) * CUFF.rise + Math.sin(a * 3) * 0.0015, Math.sin(a) * CUFF.rz]);
  }
  tube(rope, pts, CUFF.r, { sides: 6, tile: 0.05 });
  // the knot and a loose end
  const kx = CUFF.cx + CUFF.rx;
  tube(rope, [[kx + 0.002, 0.004, -0.02], [kx + 0.014, 0.0, -0.01], [kx + 0.022, -0.012, 0.0], [kx + 0.024, -0.05, 0.012]], CUFF.r, { sides: 6, tile: 0.05 });
  // worn, not held: no grip; each child is its own item with one recipe keyed by bone, as `held` is
  const recipe = (bone) => ({ bone, position: [0, 0.008, 0], rotation: [0, 0, 0, 1] });
  return N("cuffs_rope", {
    children: [N("cuffs_rope_l", { parts: p }), N("cuffs_rope_r", { parts: copyParts(p, (v) => [-v[0], v[1], v[2]], (n) => [-n[0], n[1], n[2]], true) })],
    extras: {
      kind: "worn",
      worn: { cuffs_rope_l: { recipes: { hand_l: recipe("hand_l") } }, cuffs_rope_r: { recipes: { hand_r: recipe("hand_r") } } },
      note: "instantiate each child (`cuffs_rope_l`, `cuffs_rope_r`) and hang it on its hand's BoneSocket with its recipe: the coil wraps the wrist around the hand joint's +Y (bone) axis, wider across the palm (local Z)",
    },
  });
}

/** Recurve bow (limbs ±Y, string on +Z, back toward −Z) and an arrow (along +Z, tip +0.42 m). */
function bowAndArrow() {
  const p = new Parts();
  // limb centreline in YZ: a straight grip, limbs curving toward the string (+Z) to the string-bridges
  // at |y| 0.55, then recurved tips bending back toward −Z; the string rests on the bridges
  const B = { tipY: 0.64, bridge: 0.86, zb: 0.19, curl: 0.07 };
  const zOf = (a) => (a < 0.1 ? 0 : a <= B.bridge ? B.zb * Math.sin((((a - 0.1) / (B.bridge - 0.1)) * Math.PI) / 2) ** 1.3 : B.zb - ((a - B.bridge) / (1 - B.bridge)) ** 2 * B.curl);
  const profile = [];
  for (let i = -24; i <= 24; i++) {
    const a = Math.abs(i / 24);
    profile.push([0, (i / 24) * B.tipY, zOf(a)]);
  }
  tube(p.get("wood"), profile, (i) => {
    const a = Math.abs(i - 24) / 24;
    return [0.018 - a * 0.009, 0.013 - a * 0.007];
  }, { sides: 8, tile: 0.4, up: [1, 0, 0] });
  cylinder(p.get("leather"), [0, 0, 0.002], 0.021, 0.15, [0, 0, 0], { sides: 10, tile: 0.2 });
  // the string: nock → bridge (on the limb's belly) → bridge → nock
  const yb = B.bridge * B.tipY, zs = B.zb + 0.008;
  const tipTop = [0, B.tipY - 0.01, zOf(1) + 0.006], tipBottom = [0, -B.tipY + 0.01, zOf(1) + 0.006];
  const bridgeTop = [0, yb, zs], bridgeBottom = [0, -yb, zs];
  const sp = new Parts();
  tube(sp.get("rope"), [tipTop, bridgeTop, bridgeBottom, tipBottom], 0.0016, { sides: 4, tile: 0.2, caps: false });
  const bow = N("bow", {
    children: [N("bow_limbs", { parts: p }), N("bow_string", { parts: sp }), N("bow_nock", { t: [0, 0, zs] }), N("bow_string_top", { t: bridgeTop }), N("bow_string_bottom", { t: bridgeBottom }), N("bow_rest", { t: [0.014, 0.035, 0] })],
    extras: { kind: "held", length: 2 * B.tipY, braceHeight: +zs.toFixed(3), note: "string on +Z; while drawing, hide bow_string and draw two segments bow_string_top → hand → bow_string_bottom" },
  });
  // arrow, the runtime's convention (src/prologue/fx/arrow.ts): along +Z, tip at +0.42
  const ap = new Parts();
  cylinder(ap.get("wood"), [0, 0, 0], 0.0055, 0.78, [Math.PI / 2, 0, 0], { sides: 5, tile: 0.4 });
  cylinder(ap.get("iron"), [0, 0, 0.42], 0.0125, 0.06, [Math.PI / 2, 0, 0], { sides: 4, tile: 0.2, radius2: 0.0005 });
  for (let k = 0; k < 3; k++) {
    const a = (k / 3) * Math.PI * 2;
    const o = [Math.cos(a), Math.sin(a), 0];
    const mb = ap.get("vcol");
    const c = [0.82, 0.78, 0.68, 1];
    const pts = [add(mul(o, 0.005), [0, 0, -0.37]), add(mul(o, 0.022), [0, 0, -0.35]), add(mul(o, 0.02), [0, 0, -0.27]), add(mul(o, 0.005), [0, 0, -0.25])];
    const n = nrm(cross(o, [0, 0, 1]));
    const i0 = pts.map((q) => mb.vertex(q, n, [0, 0], c));
    mb.quad(i0[0], i0[1], i0[2], i0[3]);
    const i1 = pts.map((q) => mb.vertex(q, mul(n, -1), [0, 0], c));
    mb.quad(i1[3], i1[2], i1[1], i1[0]);
  }
  const arrow = N("arrow", { parts: ap, extras: { kind: "projectile", length: 0.81, tip: [0, 0, 0.42], nock: [0, 0, -0.39], note: "along +Z like src/prologue/fx/arrow.ts; nocked: put `nock` on bow_nock with +Z = the bow's −Z" } });
  return [bow, arrow];
}

/** Hand torch (shaft +Y, flame anchor at the top) and the wall sconce that holds one. */
function torches() {
  const p = new Parts();
  cylinder(p.get("wood"), [0, 0.24, 0], 0.017, 0.48, [0, 0, 0], { sides: 8, tile: 0.4, radius2: 0.021 });
  // wrapped, pitch-soaked head
  const head = p.get("vcol");
  for (let k = 0; k < 5; k++) {
    const y = 0.44 + k * 0.028;
    torus(head, [0, y, 0], 0.026 + Math.sin(k * 1.7) * 0.003, 0.016, [0.25 * Math.sin(k * 2.1), k * 0.9, 0.2 * Math.cos(k * 1.3)], { segments: 10, sides: 5, tile: 0.1, color: k > 2 ? [0.07, 0.05, 0.04, 1] : [0.2, 0.14, 0.09, 1] });
  }
  cylinder(head, [0, 0.51, 0], 0.03, 0.14, [0, 0, 0], { sides: 8, tile: 0.1, color: [0.1, 0.07, 0.05, 1], radius2: 0.02 });
  const flame = [0, 0.62, 0];
  const grip = [0, 0.14, 0];
  const torch = N("torch", { children: [N("torch_body", { parts: p }), N("torch_flame", { t: flame })], extras: { kind: "held", grip, flame } });
  // sconce: origin on the wall (the light anchor's `wall` point), wall plane z = 0, facing −Z; the torch
  // leans out 20° so its flame anchor lands 0.22 m out at the same height (the anchors' flame point)
  const lean = (20 * Math.PI) / 180;
  const flameAt = [0, 0, -0.22];
  const axis = [0, Math.cos(lean), -Math.sin(lean)];
  const base = sub(flameAt, mul(axis, flame[1]));
  const s = new Parts(), iron = s.get("iron");
  box(iron, [0, base[1] + 0.25, -0.012], [0.11, 0.3, 0.024], [0, 0, 0], { tile: 0.3 });
  const ring = add(base, mul(axis, 0.3));
  box(iron, [0, ring[1], ring[2] / 2 - 0.012], [0.025, 0.025, -ring[2]], [0, 0, 0], { tile: 0.3 });
  torus(iron, ring, 0.03, 0.007, [-lean, 0, 0], { segments: 12, sides: 4, tile: 0.2 });
  const cup = add(base, mul(axis, 0.06));
  torus(iron, cup, 0.024, 0.007, [-lean, 0, 0], { segments: 12, sides: 4, tile: 0.2 });
  box(iron, [0, cup[1] - 0.01, cup[2] / 2 - 0.012], [0.02, 0.02, -cup[2]], [0, 0, 0], { tile: 0.3 });
  // one vertex-coloured primitive per sconce (one draw call; 20 of them line the keep): the bracket plus
  // the torch baked in place; `sconce_empty` is the bracket alone, for the sconce whose torch is taken
  const leaning = copyParts(p, (v) => add(base, rotX(v, -lean)), (n) => rotX(n, -lean));
  const extras = { kind: "wall", wall: "origin on the wall at the light anchor's `wall` point, facing −Z (yaw = the anchor's yaw); the `_flame` anchor lands on the light anchor itself", drawCalls: 1, material: "pp_vcol (shared by every sconce: merge or thin-instance them per zone if draw calls run short)" };
  const sconce = N("sconce", {
    parts: bakeVcol([s, leaning], SCONCE_COLOURS),
    children: [N("sconce_flame", { t: flameAt })],
    extras: { ...extras, takeTorch: "K9: replace this sconce by `sconce_empty` (same transform) and hang a `torch` on the companion's hand_l" },
  });
  const empty = N("sconce_empty", { parts: bakeVcol([s], SCONCE_COLOURS), children: [N("sconce_empty_flame", { t: flameAt })], extras: { ...extras, note: "the bracket without its torch (K9)" } });
  return [torch, sconce, empty];
}

/** Vertex colours for the baked sconce (the textured materials' mean colours). */
const SCONCE_COLOURS = { iron: [0.2, 0.16, 0.13, 1], wood: [0.27, 0.18, 0.11, 1] };
/** All of `list`'s geometry in one `vcol` builder: textured materials become flat `colours[k]`. */
function bakeVcol(list, colours) {
  const out = new Parts(), mb = out.get("vcol");
  for (const parts of list)
    for (const [k, src] of Object.entries(parts.m)) {
      const base = mb.vertexCount;
      const flat = k === "vcol" ? null : colours[k];
      if (k !== "vcol" && !flat) throw new Error(`procprops: no bake colour for material ${k}`);
      for (let v = 0; v < src.vertexCount; v++) mb.vertex(src.p.slice(v * 3, v * 3 + 3), src.n.slice(v * 3, v * 3 + 3), src.uv.slice(v * 2, v * 2 + 2), flat ?? src.c.slice(v * 4, v * 4 + 4));
      for (const ix of src.i) mb.i.push(ix + base);
    }
  return out;
}

/** A straw bed for the cells: a low mound plus loose strands. */
function strawBed() {
  const p = new Parts(), mb = p.get("straw");
  const R = rng(77);
  const W = 1.8, D = 0.9, nx = 14, nz = 7;
  const h = (x, z) => {
    const u = (2 * x) / W, v = (2 * z) / D;
    const e = Math.max(0, (1 - u ** 4) * (1 - v ** 4));
    return -0.02 + e * (0.13 + 0.03 * Math.sin(x * 7.1 + 1.3) * Math.sin(z * 9.3)) ;
  };
  const base = mb.vertexCount;
  for (let j = 0; j <= nz; j++)
    for (let i = 0; i <= nx; i++) {
      const x = (i / nx - 0.5) * W * (1 + 0.04 * Math.sin(j * 1.7)), z = (j / nz - 0.5) * D * (1 + 0.05 * Math.sin(i * 2.3));
      const c = 0.75 + 0.25 * R();
      mb.vertex([x, h(x, z), z], [0, 1, 0], [x / 0.6, z / 0.6], [c, c * 0.97, c * 0.9, 1]);
    }
  for (let j = 0; j < nz; j++)
    for (let i = 0; i < nx; i++) {
      const a = base + j * (nx + 1) + i;
      mb.quad(a, a + nx + 1, a + nx + 2, a + 1);
    }
  const tmp = new MeshBuilder();
  tmp.p = mb.p.slice(base * 3);
  tmp.i = mb.i.map((x) => x - base);
  tmp.computeNormals();
  mb.n.splice(base * 3, tmp.n.length, ...tmp.n);
  // loose strands (double-sided material)
  for (let k = 0; k < 140; k++) {
    const x = (R() - 0.5) * W * 1.15, z = (R() - 0.5) * D * 1.2, a = R() * Math.PI, l = 0.12 + R() * 0.22;
    const y = Math.max(0.005, h(x, z) + 0.01);
    const d = [Math.cos(a) * l, (R() - 0.3) * 0.04, Math.sin(a) * l];
    const w = [-Math.sin(a) * 0.006, 0, Math.cos(a) * 0.006];
    const c = 0.7 + 0.3 * R();
    const q = [add([x, y, z], w), add([x, y, z], mul(w, -1)), add(add([x, y, z], d), mul(w, -1)), add(add([x, y, z], d), w)];
    const i0 = q.map((v, n) => mb.vertex(v, [0, 1, 0], [[0, 0], [0.05, 0], [0.05, 1], [0, 1]][n], [c, c * 0.95, c * 0.85, 1]));
    mb.quad(i0[0], i0[3], i0[2], i0[1]);
  }
  return N("straw_bed", { children: [N("straw_bed_straw", { parts: p })], extras: { kind: "prop", size: [W, 0.16, D], note: "no collider; lies along X (length) — put it along a cell's back wall" } });
}

/** The bent, broken iron grate in the drain mouth (B5 north wall): passable through its middle. */
function drainGrate() {
  const p = new Parts(), iron = p.get("iron");
  const R = rng(91);
  const Wd = 2.4, Ht = 2.6, z = -0.08;
  // frame
  for (const x of [-Wd / 2 + 0.04, Wd / 2 - 0.04]) box(iron, [x, Ht / 2, z], [0.07, Ht, 0.06], [0, 0, 0], { tile: 0.6 });
  box(iron, [0, Ht - 0.04, z], [Wd, 0.07, 0.06], [0, 0, 0], { tile: 0.6 });
  box(iron, [0, 0.03, z], [Wd, 0.05, 0.06], [0, 0, 0], { tile: 0.6 });
  const clear = 0.62; // half-width of the forced gap
  for (let x = -1.05; x <= 1.051; x += 0.15) {
    const ax = Math.abs(x);
    if (ax > clear + 0.02) {
      // intact bars, the inner ones bowed outward
      const bow = ax < 0.8 ? 0.18 * Math.sign(x) : 0;
      const pts = [];
      for (let k = 0; k <= 8; k++) {
        const t = k / 8;
        pts.push([x + bow * Math.sin(t * Math.PI), 0.06 + t * (Ht - 0.12), z]);
      }
      tube(iron, pts, 0.018, { sides: 6, tile: 0.6 });
    } else {
      // snapped: a short stub at the floor, the upper part bent up and into the drain
      const stub = 0.05 + R() * 0.18;
      tube(iron, [[x, 0.06, z], [x + (R() - 0.5) * 0.05, stub, z - 0.03]], 0.018, { sides: 6, tile: 0.6 });
      const low = 2.15 + R() * 0.2;
      const pts = [];
      for (let k = 0; k <= 6; k++) {
        const t = k / 6;
        pts.push([x + Math.sign(x || 1) * t * t * 0.12, Ht - 0.06 - t * (Ht - 0.06 - low), z - t * t * (0.25 + R() * 0.15)]);
      }
      tube(iron, pts, 0.018, { sides: 6, tile: 0.6 });
    }
  }
  // cross bars, cut through in the middle
  for (const y of [0.95, 1.85])
    for (const s of [-1, 1]) {
      const end = clear + 0.02 + R() * 0.06;
      tube(iron, [[s * (Wd / 2 - 0.05), y, z], [s * (end + 0.15), y, z], [s * end, y + (R() - 0.5) * 0.12, z - 0.12]], [0.03, 0.009], { sides: 4, tile: 0.6, up: [0, 0, 1] });
    }
  const col = new MeshBuilder();
  for (const s of [-1, 1]) colBox(col, [s * (Wd / 2 + clear + 0.08) / 2, Ht / 2, z], [Wd / 2 - clear - 0.08, Ht, 0.12]);
  return N("drain_grate", {
    children: [N("drain_grate_iron", { parts: p }), N("drain_grate_col", { col, extras: { tag: "drain_grate", static: true } })],
    extras: { kind: "fixture", opening: [Wd, Ht], gap: [-clear, clear], note: "origin at the drain opening's bottom centre on the B5 wall face; bars 8 cm inside the drain" },
  });
}

/** Paper: the (blank) warrant Ivo shows in K6, and a sealed letter (footlocker, cocoon). */
function papers() {
  const seal = [0.5, 0.06, 0.05, 1];
  const sheet = (w, h, curl) => {
    const p = new Parts(), mb = p.get("paper");
    const nx = 6, ny = 8;
    for (const side of [0, 1]) {
      const base = mb.vertexCount;
      for (let j = 0; j <= ny; j++)
        for (let i = 0; i <= nx; i++) {
          const x = (i / nx - 0.5) * w, y = (j / ny) * h;
          const zc = curl * ((2 * x) / w) ** 2 - 0.004 * Math.sin((j / ny) * Math.PI);
          const n = nrm([(-2 * curl * 2 * x) / (w * w) * (side ? -1 : 1), 0, side ? 1 : -1]);
          const u = side ? 0.5 + (1 - i / nx) * 0.5 : (i / nx) * 0.5;
          mb.vertex([x, y, zc + (side ? 0.0004 : 0)], n, [u, 1 - j / ny], undefined);
        }
      for (let j = 0; j < ny; j++)
        for (let i = 0; i < nx; i++) {
          const a = base + j * (nx + 1) + i;
          if (side) mb.quad(a, a + 1, a + nx + 2, a + nx + 1);
          else mb.quad(a, a + nx + 1, a + nx + 2, a + 1);
        }
    }
    cylinder(p.get("vcol"), [w * 0.25, 0.045, -0.004], 0.02, 0.006, [Math.PI / 2, 0, 0], { sides: 12, tile: 1, color: seal });
    return p;
  };
  const warrant = sheet(0.21, 0.3, 0.012);
  const letter = new Parts();
  box(letter.get("paper"), [0, 0.006, 0], [0.16, 0.012, 0.11], [0, 0, 0], { tile: 0.32 });
  cylinder(letter.get("vcol"), [0, 0.013, 0.02], 0.016, 0.005, [0, 0, 0], { sides: 12, tile: 1, color: seal });
  return [
    N("paper_warrant", { children: [N("paper_warrant_sheet", { parts: warrant })], extras: { kind: "held", size: [0.21, 0.3], text: "−Z side (u 0…0.5 of pp_paper)", grip: [0, 0.03, 0.06] } }),
    N("paper_letter", { children: [N("paper_letter_body", { parts: letter })], extras: { kind: "item", size: [0.16, 0.012, 0.11] } }),
  ];
}

/** Two bone dice for the jailer's table. */
function dice() {
  const p = new Parts(), mb = p.get("vcol");
  const s = 0.016, pip = 0.0032;
  const PIPS = { 1: [[0, 0]], 2: [[-1, -1], [1, 1]], 3: [[-1, -1], [0, 0], [1, 1]], 4: [[-1, -1], [1, -1], [-1, 1], [1, 1]], 5: [[-1, -1], [1, -1], [0, 0], [-1, 1], [1, 1]], 6: [[-1, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [1, 1]] };
  const faces = [[[0, 1, 0], 1], [[0, -1, 0], 6], [[1, 0, 0], 3], [[-1, 0, 0], 4], [[0, 0, 1], 2], [[0, 0, -1], 5]];
  for (const [ci, centre, yaw] of [[0, [-0.022, s / 2, 0.004], 0.4], [1, [0.019, s / 2, -0.008], 1.3]]) {
    const cube = new MeshBuilder();
    box(cube, [0, 0, 0], [s, s, s], [0, 0, 0], { tile: 1, color: [0.86, 0.82, 0.72, 1] });
    for (const [n, k] of faces) {
      const u = Math.abs(n[1]) > 0.5 ? [1, 0, 0] : [0, 1, 0];
      const v = cross(n, u);
      for (const [a, b] of PIPS[(k + ci) % 6 || 6]) {
        const c = add(mul(n, s / 2 + 0.0003), add(mul(u, a * s * 0.27), mul(v, b * s * 0.27)));
        const q = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([x, y]) => add(c, add(mul(u, x * pip / 2), mul(v, y * pip / 2))));
        const i0 = q.map((v2) => cube.vertex(v2, n, [0, 0], [0.08, 0.05, 0.04, 1]));
        if (dot(cross(sub(q[1], q[0]), sub(q[2], q[0])), n) > 0) cube.quad(i0[0], i0[1], i0[2], i0[3]);
        else cube.quad(i0[0], i0[3], i0[2], i0[1]);
      }
    }
    for (let v = 0; v < cube.vertexCount; v++) {
      const P = rotY(cube.p.slice(v * 3, v * 3 + 3), yaw), Nn = rotY(cube.n.slice(v * 3, v * 3 + 3), yaw);
      mb.vertex(add(P, centre), Nn, [0, 0], cube.c.slice(v * 4, v * 4 + 4));
    }
    const off = mb.vertexCount - cube.vertexCount;
    for (const ix of cube.i) mb.i.push(ix + off);
  }
  return N("dice", { children: [N("dice_pair", { parts: p })], extras: { kind: "dressing", note: "two dice, origin on the table top" } });
}

/** Branding irons standing in the B3 brazier (kit/fpm#Cauldron at the same anchor). */
function brazierIrons() {
  const p = new Parts();
  for (const [k, yaw] of [[0, 0.3], [1, 2.4], [2, 4.3]]) {
    const inner = rotY([0.12, 0.58, 0], yaw), dir = rotY(nrm([0.75, 0.55, 0.1 * (k - 1)]), yaw);
    const outer = add(inner, mul(dir, 0.75));
    tube(p.get("iron"), [inner, outer], 0.0075, { sides: 6, tile: 0.3 });
    tube(p.get("wood"), [add(outer, mul(dir, -0.2)), add(outer, mul(dir, 0.02))], 0.016, { sides: 8, tile: 0.3 });
    torus(p.get("iron"), add(inner, mul(dir, -0.03)), 0.03, 0.006, [0, yaw, 0], { segments: 10, sides: 4, tile: 0.2 });
  }
  return N("brazier_irons", { children: [N("brazier_irons_set", { parts: p })], extras: { kind: "dressing", note: "same anchor as the B3 brazier (kit/fpm#Cauldron): the hot ends sit in the bowl" } });
}

/** The jailer's key ring (keyring item): a ring and three keys; origin at the ring's top. */
function keyRing() {
  const p = new Parts(), iron = p.get("iron");
  torus(iron, [0, -0.04, 0], 0.04, 0.0035, [Math.PI / 2, 0, 0], { segments: 18, sides: 4, tile: 0.2 });
  for (const [k, a] of [[0, -0.5], [1, 0.1], [2, 0.7]]) {
    const top = [Math.sin(a) * 0.04, -0.04 - Math.cos(a) * 0.04, 0];
    const d = [Math.sin(a * 0.4), -Math.cos(a * 0.4), 0];
    torus(iron, add(top, mul(d, 0.014)), 0.012, 0.0028, [Math.PI / 2, 0, 0], { segments: 10, sides: 4, tile: 0.2 });
    const shaftA = add(top, mul(d, 0.026)), shaftB = add(top, mul(d, 0.09 + k * 0.01));
    tube(iron, [shaftA, shaftB], 0.0035, { sides: 5, tile: 0.2 });
    box(iron, add(shaftB, add(mul(d, -0.008), [0.008, 0, 0])), [0.014, 0.012, 0.004], [0, 0, a * 0.4], { tile: 0.2 });
  }
  return N("key_ring", { children: [N("key_ring_iron", { parts: p })], extras: { kind: "item", grip: [0, -0.005, 0] } });
}

/** Bone piles for the wolf's den (exit): long bones, ribs, vertebrae, one skull. */
function bonePile(name, seed, { skull = false } = {}) {
  const p = new Parts(), mb = p.get("vcol");
  const R = rng(seed);
  const col = () => {
    const c = 0.7 + R() * 0.2;
    return [c, c * 0.95, c * 0.82, 1];
  };
  const longBone = (c, yaw, l) => {
    const d = rotY([1, 0, 0], yaw), cc = col();
    const a = add(c, mul(d, -l / 2)), b = add(c, mul(d, l / 2));
    const pts = [];
    for (let k = 0; k <= 8; k++) pts.push(add(lerp3(a, b, k / 8), [0, 0.018 + Math.sin((k / 8) * Math.PI) * 0.01, 0]));
    tube(mb, pts, (i) => 0.011 + 0.008 * (Math.abs(i - 4) / 4) ** 3, { sides: 7, color: cc });
    for (const e of [a, b]) lumpBox(mb, add(e, [0, 0.02, 0]), [0.045, 0.035, 0.04], { amp: 0.004, round: 0.6, seed: Math.floor(R() * 1000), div: [2, 2, 2], color: cc });
  };
  const rib = (c, yaw) => {
    const pts = [], cc = col(), r = 0.13 + R() * 0.06;
    for (let k = 0; k <= 8; k++) {
      const t = (k / 8) * 2.2;
      pts.push(add(c, rotY([Math.cos(t) * r, 0.012 + Math.sin(t) * 0.04 * R(), Math.sin(t) * r * 0.6], yaw)));
    }
    tube(mb, pts, [0.006, 0.0035], { sides: 5, color: cc });
  };
  const vertebra = (c, yaw) => {
    const cc = col();
    cylinder(mb, add(c, [0, 0.016, 0]), 0.017, 0.028, [Math.PI / 2, yaw, 0], { sides: 7, color: cc });
    box(mb, add(c, [0, 0.036, 0]), [0.008, 0.03, 0.012], [0, yaw, 0.3], { tile: 1, color: cc });
  };
  for (let k = 0; k < 3; k++) longBone([(R() - 0.5) * 0.5, 0, (R() - 0.5) * 0.4], R() * Math.PI, 0.28 + R() * 0.18);
  for (let k = 0; k < 4; k++) rib([(R() - 0.5) * 0.45, 0, (R() - 0.5) * 0.4], R() * Math.PI * 2);
  for (let k = 0; k < 4; k++) vertebra([(R() - 0.5) * 0.5, 0, (R() - 0.5) * 0.45], R() * Math.PI);
  if (skull) {
    const c = [0.18, 0.06, -0.12];
    const cc = col();
    lumpBox(mb, add(c, [0, 0.05, 0]), [0.12, 0.09, 0.1], { amp: 0.006, round: 0.7, seed: 3, div: [3, 3, 3], color: cc });
    tube(mb, [add(c, [0.04, 0.05, 0]), add(c, [0.11, 0.035, 0.01]), add(c, [0.17, 0.025, 0.015])], (i) => [0.032 - i * 0.008, 0.024 - i * 0.006], { sides: 7, color: cc });
    for (const s of [-1, 1]) lumpBox(mb, add(c, [0.05, 0.07, s * 0.035]), [0.022, 0.018, 0.012], { amp: 0, round: 0.8, seed: 9, div: [2, 2, 2], color: [0.12, 0.1, 0.08, 1] });
  }
  return N(name, { children: [N(`${name}_pile`, { parts: p })], extras: { kind: "dressing", noiseRadius: 0.6, note: "stepping within noiseRadius of the origin is a noise (+0.35, design §4.3)" } });
}

// ------------------------------------------------------------------------------------------------
// the lever: pivot from a fit to Farm_PickingTree's right-hand grip path; angles and the pull curve
// measured from the clip at build time

/**
 * The lever (lever-local, world axes): pivot, grip radius, how far the shaft reaches past the grip,
 * and the body bones its handle must stay clear of during the pull (`bodyClear` m between the bone
 * segments and the handle's outer part, radius 0.9 … radius + end).
 */
export const LEVER = {
  pivot: [0.1, 1.0, -0.4],
  radius: 1.22,
  end: 0.05,
  bodyClear: 0.17,
  bones: [["pelvis", "spine_01"], ["spine_01", "spine_02"], ["spine_02", "spine_03"], ["thigh_r", "calf_r"], ["thigh_l", "calf_l"], ["upperarm_r", "lowerarm_r"]],
};

function leverFromClip(poses, cave) {
  // lever-local frame: origin on the anchor `lever`, world axes; the puller stands on lever_stance facing −Z
  const stance = sub(cave.lever_stance, cave.lever);
  const { pivot, radius } = LEVER;
  // character space (+X left, +Z forward) → facing −Z: x → −x, z → −z
  const toLever = (g) => add(stance, [-g[0], g[1], -g[2]]);
  const gripAt = (t) => {
    const P = poses("Farm_PickingTree", t);
    if (!P) return null;
    const h = P("hand_r");
    return toLever(add(h.p, qrot(h.q, [-0.03, 0.095, 0])));
  };
  const angleOf = (g) => Math.atan2(g[2] - pivot[2], g[1] - pivot[1]);
  const grab = 1.06, release = 1.68;
  const g0 = gripAt(grab), g1 = gripAt(release);
  if (!g0) throw new Error("procprops: Farm_PickingTree is missing from the UAL clips (the lever is fitted to it)");
  const rest = angleOf(g0), end = angleOf(g1);
  const curve = [];
  let gap = 0;
  for (let t = 0.9; t <= 1.8001; t += 0.06) {
    const g = gripAt(t);
    let a = Math.min(Math.max(angleOf(g) - rest, 0), end - rest);
    if (t < grab) a = 0;
    if (curve.length && a < curve[curve.length - 1][1]) a = curve[curve.length - 1][1];
    curve.push([+t.toFixed(2), +a.toFixed(4)]);
    if (t >= grab - 1e-6 && t <= release + 1e-6) {
      const th = rest + a;
      const handle = add(pivot, [0, Math.cos(th) * radius, Math.sin(th) * radius]);
      gap = Math.max(gap, len(sub(handle, g)));
    }
  }
  // the hand's sideways drift off the lever's plane (x = pivot x) while it holds the grip
  let lo = Infinity, hi = -Infinity;
  for (let t = grab; t <= release + 1e-6; t += 0.02) {
    const dx = gripAt(t)[0] - pivot[0];
    (lo = Math.min(lo, dx)), (hi = Math.max(hi, dx));
  }
  // the handle's outer part against the puller's body, from the grab to the clip's last curve key (the
  // handle stays pulled after the release while the body recovers)
  const angleAt = (t) => {
    const i = curve.findIndex(([ct]) => ct > t);
    if (i < 0) return curve[curve.length - 1][1];
    if (i === 0) return curve[0][1];
    return curve[i - 1][1] + ((curve[i][1] - curve[i - 1][1]) * (t - curve[i - 1][0])) / (curve[i][0] - curve[i - 1][0]);
  };
  const segDist = (p, a, b) => {
    const ab = sub(b, a);
    const k = Math.max(0, Math.min(1, dot(sub(p, a), ab) / dot(ab, ab)));
    return len(sub(p, add(a, mul(ab, k))));
  };
  const bodyClear = {};
  for (let t = grab; t <= curve[curve.length - 1][0] + 1e-6; t += 0.02) {
    const P = poses("Farm_PickingTree", t);
    const th = rest + angleAt(t);
    const dir = [0, Math.cos(th), Math.sin(th)];
    const h0 = add(pivot, mul(dir, 0.9)), h1 = add(pivot, mul(dir, radius + LEVER.end));
    for (const [j0, j1] of LEVER.bones) {
      const c = toLever(P(j0).p), d = toLever(P(j1).p);
      let m = Infinity;
      for (let k = 0; k <= 16; k++) m = Math.min(m, segDist(lerp3(c, d, k / 16), h0, h1));
      if (!(j0 in bodyClear) || m < bodyClear[j0].d) bodyClear[j0] = { d: +m.toFixed(3), t: +t.toFixed(2) };
    }
  }
  return { pivot, radius, rest, pulled: end - rest, curve, grab, release, gap: +gap.toFixed(3), stance, lateral: { min: +lo.toFixed(3), max: +hi.toFixed(3) }, bodyClear };
}

// ------------------------------------------------------------------------------------------------
// glTF

function emitTree(doc, mats, spec, parent, meshes, out) {
  const node = doc.createNode(spec.name);
  if (spec.t) node.setTranslation(spec.t.map((v) => +v.toFixed(5)));
  if (spec.r) node.setRotation(spec.r);
  if (spec.extras) node.setExtras(spec.extras);
  parent.addChild(node);
  out.names.push(spec.name);
  const buffer = doc.getRoot().listBuffers()[0];
  const acc = (type, arr) => doc.createAccessor().setType(type).setArray(arr).setBuffer(buffer);
  if (spec.col) {
    const mesh = doc.createMesh(spec.name);
    const prim = doc.createPrimitive().setAttribute("POSITION", acc("VEC3", new Float32Array(spec.col.p)));
    prim.setIndices(acc("SCALAR", new Uint16Array(spec.col.i)));
    mesh.addPrimitive(prim);
    node.setMesh(mesh);
    out.colliders.push({ name: spec.name, tris: spec.col.i.length / 3, ...(spec.extras ?? {}) });
  }
  if (spec.parts && !spec.parts.empty) {
    const mesh = doc.createMesh(spec.name);
    for (const [k, mb] of Object.entries(spec.parts.m)) {
      if (!mb.i.length) continue;
      const g = mb.toGeometry();
      const prim = doc.createPrimitive().setMaterial(mats.get(k));
      prim.setAttribute("POSITION", acc("VEC3", g.positions)).setAttribute("NORMAL", acc("VEC3", g.normals)).setAttribute("TEXCOORD_0", acc("VEC2", g.uvs));
      if (g.colors) {
        const c3 = new Float32Array((g.colors.length / 4) * 3);
        for (let i = 0; i < g.colors.length / 4; i++) c3.set(g.colors.subarray(i * 4, i * 4 + 3), i * 3);
        prim.setAttribute("COLOR_0", acc("VEC3", c3));
      }
      prim.setIndices(acc("SCALAR", g.positions.length / 3 > 65535 ? new Uint32Array(g.indices) : new Uint16Array(g.indices)));
      mesh.addPrimitive(prim);
      out.tris += g.indices.length / 3;
      out.wrong.push({ name: spec.name, mat: k, ...windingOf(mb) });
    }
    meshes.set(spec.name, mesh);
    node.addChild(doc.createNode(`${spec.name}_mesh`).setMesh(mesh));
  }
  for (const c of spec.children) emitTree(doc, mats, c, node, meshes, out);
  return node;
}

/** Triangles whose winding disagrees with their vertex normals. */
function windingOf(mb) {
  let bad = 0, n = 0;
  const P = mb.p, Nn = mb.n;
  for (let t = 0; t < mb.i.length; t += 3) {
    const [a, b, c] = [mb.i[t] * 3, mb.i[t + 1] * 3, mb.i[t + 2] * 3];
    const e1 = [P[b] - P[a], P[b + 1] - P[a + 1], P[b + 2] - P[a + 2]], e2 = [P[c] - P[a], P[c + 1] - P[a + 1], P[c + 2] - P[a + 2]];
    const g = cross(e1, e2);
    if (len(g) < 1e-12) continue;
    n++;
    if (dot(g, [Nn[a] + Nn[b] + Nn[c], Nn[a + 1] + Nn[b + 1] + Nn[c + 1], Nn[a + 2] + Nn[b + 2] + Nn[c + 2]]) < 0) bad++;
  }
  return { bad, n };
}

// ------------------------------------------------------------------------------------------------
// validation against the cave's rock field and the keep's rooms

/** The cave's rock field (tools/gen/cave.mjs `_debug`); the gallery is placed and checked against it. */
export async function loadCaveField() {
  let D;
  try {
    D = (await import("./cave.mjs"))._debug;
  } catch (e) {
    throw new Error(`procprops: tools/gen/cave.mjs failed to load (${e.message}): the gallery set piece is placed and checked against its rock field, so props/ cannot build without it`);
  }
  if (typeof D?.S !== "function" || typeof D?.floorAt !== "function" || typeof D?.clearAt !== "function") throw new Error("procprops: tools/gen/cave.mjs `_debug` no longer exports S, floorAt and clearAt; update tools/gen/procprops.mjs");
  const { S } = D;
  /** First rock going up from (x, y0, z) within 4 m (bisected to 5 mm); null when y0 is in rock or none. */
  const ceilingAt = (x, z, y0) => {
    if (S(x, y0, z) < 0) return null;
    let y = y0;
    while (S(x, y, z) > 0 && y < y0 + 4) y += 0.05;
    if (S(x, y, z) > 0) return null;
    let lo = y - 0.05, hi = y;
    for (let i = 0; i < 4; i++) {
      const m = (lo + hi) / 2;
      if (S(x, m, z) > 0) lo = m;
      else hi = m;
    }
    return hi;
  };
  return { ...D, ceilingAt };
}

/**
 * The field cave.mjs computes now must be the one the shipped cave was built from (else the gallery
 * would be fitted to rock that does not ship): the shipped cave/mesh_a colliders near the gallery lie
 * on its surface, and every shipped cave anchor's probed floor and clear height reproduce.
 * `meshA`: the shipped cave/mesh_a GLB (Buffer).
 */
export async function checkCaveField(D, caveAnchors, meshA, H) {
  const problems = [];
  const fix = "tools/gen/cave.mjs differs from the shipped cave (edited since cave/ last ran?): rebuild both with node tools/build-assets.mjs --only=cave/,props/";
  const doc = await io.readBinary(new Uint8Array(meshA));
  const dev = [];
  for (const n of doc.getRoot().listNodes()) {
    if (!/_col$/.test(n.getName()) || !n.getMesh()) continue;
    const M = n.getWorldMatrix();
    for (const prim of n.getMesh().listPrimitives()) {
      const P = prim.getAttribute("POSITION"), v = [];
      for (let i = 0; i < P.getCount(); i++) {
        P.getElement(i, v);
        const w = [0, 1, 2].map((r) => M[r] * v[0] + M[4 + r] * v[1] + M[8 + r] * v[2] + M[12 + r]);
        if (Math.abs(w[0] - H[0]) > 20 || w[1] < H[1] - 6 || w[1] > H[1] + 12 || w[2] < H[2] - 6 || w[2] > H[2] + 16) continue;
        dev.push(Math.abs(D.S(w[0], w[1], w[2])));
      }
    }
  }
  if (dev.length < 200) throw new Error(`procprops: the shipped cave/mesh_a has only ${dev.length} collider vertices (nodes *_col) around the gallery; update checkCaveField (tools/gen/procprops.mjs) to the cave's layout`);
  dev.sort((a, b) => a - b);
  const median = dev[dev.length >> 1], off = dev.filter((d) => d > 0.05).length / dev.length;
  if (median > 0.01 || off > 0.03) problems.push(`the shipped cave/mesh_a colliders around the gallery are off the field: median ${median.toFixed(3)} m, ${(off * 100).toFixed(1)} % beyond 5 cm (built from it: ≤ 0.01 m and ≤ 3 %)`);
  let floors = 0;
  for (const [k, a] of Object.entries(caveAnchors.anchors)) {
    if (a.sdfFloor === undefined) continue;
    floors++;
    const f = D.floorAt(a.pos[0], a.pos[2], a.sdfFloor + 0.5, 2);
    const c = f === null ? null : D.clearAt(a.pos[0], a.pos[2], f);
    if (f === null || Math.abs(f - a.sdfFloor) > 0.01 || (a.clear !== undefined && Math.abs(c - a.clear) > 0.06))
      problems.push(`cave anchor ${k}: the field's floor ${f?.toFixed(3)} / clear ${c?.toFixed(2)} vs shipped ${a.sdfFloor} / ${a.clear}`);
  }
  if (problems.length) throw new Error(`procprops: ${fix}\n  ${problems.slice(0, 8).join("\n  ")}${problems.length > 8 ? `\n  … and ${problems.length - 8} more` : ""}`);
  return { colliderVerts: dev.length, median: +median.toFixed(4), beyond5cm: +off.toFixed(4), anchorFloors: floors };
}

function checkGallery(spec, cave, problems, D) {
  const { S, floorAt } = D;
  const H = cave.bridge_hinge;
  const find = (name, s = spec) => (s.name === name ? s : s.children.map((c) => find(name, c)).find(Boolean));
  const out = { minClear: {} };
  const clearOf = (label, pts, min) => {
    let m = Infinity, at = null;
    for (const p of pts) {
      const v = S(p[0], p[1], p[2]);
      if (v < m) (m = v), (at = p);
    }
    out.minClear[label] = +m.toFixed(3);
    if (m < min) problems.push(`gallery: ${label} is ${m.toFixed(2)} m from the rock (< ${min}) at (${r3(at).join(", ")})`);
  };
  const seg = (a, b, step = 0.1) => {
    const n = Math.max(1, Math.ceil(len(sub(b, a)) / step));
    return Array.from({ length: n + 1 }, (_, k) => lerp3(a, b, k / n));
  };
  const W = (p) => add(H, p);
  // deck in all three states (corners and mid-lines of its top and bottom, bar the tip resting on the ledge)
  const ex = spec.extras.deck;
  for (const [state, ang] of Object.entries(ex.angles)) {
    const pts = [];
    const L = state === "broken" ? ex.southLength : ex.size[2];
    for (let z = 0.7; z <= L - (state === "lowered" ? 0.9 : 0.05); z += 0.25) for (const x of [-0.9, 0, 0.9]) for (const y of [-0.1, 0.15]) pts.push(W(rotX([x, y, z], ang)));
    clearOf(`deck ${state}`, pts, 0.05);
  }
  // chains: haul chains and the state chains (not the last 0.35 m at the pulley bracket)
  const sheaves = ["w", "e"].map((s) => W(find(`bridge_sheave_${s}`).t));
  const tips = ["w", "e"].map((s) => find(`bridge_tip_${s}`).t);
  for (const [k, state] of [["raised", ex.angles.raised], ["lowered", 0]])
    clearOf(`chain ${k}`, tips.flatMap((t, i) => seg(W(rotX(t, state)), sheaves[i]).filter((p) => len(sub(p, sheaves[i])) > 0.35)), 0.05);
  // pulleys hang in the air under rock: the sheave clear, the bracket plate's top in the rock across its
  // footprint, and the slab (falling between them) clear of their inner cheeks
  for (const side of ["w", "e"]) {
    const P = W(find(`bridge_pulley_${side}`).pulley);
    const sv = S(...add(P, [0, -0.054, 0]));
    if (sv < 0.15) problems.push(`gallery: pulley ${side} sheave only ${sv.toFixed(2)} m from the rock`);
    for (const [fx, fz] of [[0, 0], [-0.15, -0.17], [0.15, -0.17], [-0.15, 0.17], [0.15, 0.17]]) {
      const top = S(P[0] + fx, P[1] + 0.515, P[2] + fz);
      if (top > 0) problems.push(`gallery: pulley ${side} bracket plate does not reach the rock at (${fx}, ${fz}) (${top.toFixed(2)} m of air above it)`);
    }
  }
  {
    const sp = find("slab").parts.m.rock.p;
    let mx = 0;
    const sx = find("slab").t[0];
    for (let i = 0; i < sp.length; i += 3) mx = Math.max(mx, Math.abs(sp[i] + sx));
    const inner = Math.abs(find("bridge_pulley_e").pulley[0]) - 0.1;
    out.slabHalfWidth = +mx.toFixed(3);
    if (mx > inner - 0.01) problems.push(`gallery: the slab (half-width ${mx.toFixed(2)}) would hit the pulleys' inner cheeks (${inner.toFixed(2)}) as it falls`);
  }
  // winch foundation and the lever block sit on the floor (their footprint's floor lies between their bottom and top)
  const footprint = (label, centre, half, yaw, y0, y1) => {
    let worst = null;
    for (const sx of [-1, 0, 1]) for (const sz of [-1, 0, 1]) {
      const p = add(centre, rotY([sx * half[0], 0, sz * half[1]], yaw));
      const f = floorAt(p[0], p[2], p[1] + 2.5, 6);
      if (f === null || f < y0 + 0.04 || f > y1 - 0.04) worst = { p, f };
    }
    if (worst) problems.push(`gallery: ${label} does not sit on the floor at (${r3(worst.p).join(", ")}): floor ${worst.f?.toFixed(2)} outside ${y0.toFixed(2)}…${y1.toFixed(2)}`);
  };
  const winch = find("winch");
  const wYaw = 2 * Math.atan2(winch.r[1], winch.r[3]);
  footprint("the winch foundation", W(winch.t), [0.48, 0.3], wYaw, H[1] + winch.t[1] - 0.45, H[1] + winch.t[1] + 0.28);
  const lever = find("lever"), LV = spec.extras.lever;
  const lp = W(add(lever.t, find("lever_pivot").t));
  footprint("the lever block", [lp[0], H[1] + lever.t[1], lp[2]], [0.22, 0.22], 0, H[1] + lever.t[1] - 0.09, H[1] + lever.t[1] + 0.53);
  // the lever's handle sweep and the winch frame are in the air
  const sweep = [];
  const rest = find("lever_pivot").restAngle;
  for (let a = 0; a <= LV.pulled + 1e-6; a += 0.05) for (let r = 0.1; r <= LEVER.radius + LEVER.end + 1e-6; r += 0.1) sweep.push(add(lp, [0, Math.cos(rest + a) * r, Math.sin(rest + a) * r]));
  clearOf("lever handle sweep", sweep, 0.05);
  const wt = W(winch.t);
  clearOf("winch frame top", [-0.5, 0, 0.5].flatMap((x) => [-0.3, 0.3].map((z) => add(wt, rotY([x, 0.95, z], wYaw)))), 0.05);
  // the slab starts in the air below the dome (its top may touch it) and falls clear
  const sl = W(find("slab").t);
  clearOf("slab body", [-1.1, 1.1].flatMap((x) => [-0.8, 0.8].flatMap((z) => [-0.45, 0].map((y) => add(sl, [x, y, z])))), 0.0);
  // the lowered deck's top meets both banks (steps the capsule can take)
  const deckTop = H[1] + ex.top;
  const north = floorAt(H[0], H[2] + ex.size[2] + 0.4, H[1] + 2, 4), southF = floorAt(H[0], H[2] - 0.6, H[1] + 2, 4);
  out.steps = { north: +(deckTop - north).toFixed(3), south: +(deckTop - southF).toFixed(3) };
  if (Math.abs(deckTop - north) > 0.3 || Math.abs(deckTop - southF) > 0.3) problems.push(`gallery: the lowered deck top ${deckTop.toFixed(2)} vs bank floors ${north.toFixed(2)} (north) / ${southF.toFixed(2)} (south)`);
  return out;
}

/**
 * The rope cuffs clear both base bodies' wrists (bind pose, hand-local; the cuff recipe lifts the coil 8 mm).
 * Fails, rather than passing with nothing measured, when a body lacks a skin with both `hand_<side>` and
 * `lowerarm_<side>`, or when no skinned vertex of that wrist falls in the coil's height band.
 */
async function checkWrists(SRC, problems) {
  const out = {};
  for (const body of ["Superhero_Male_FullBody", "Superhero_Female_FullBody"]) {
    const file = path.join(SRC, "chars/base", `${body}.gltf`);
    const doc = await io.read(file).catch((e) => {
      throw new Error(`procprops: the rope cuffs are sized on the base bodies, but ${path.relative(path.dirname(SRC), file)} does not load (${e.message}); run node tools/fetch-extra.mjs`);
    });
    const root = doc.getRoot();
    for (const side of ["l", "r"]) {
      const key = `${body}.hand_${side}`;
      let worst = 0, samples = 0, skins = 0;
      const cx = side === "l" ? CUFF.cx : -CUFF.cx;
      for (const skin of root.listSkins()) {
        const joints = skin.listJoints();
        const ji = joints.findIndex((j) => j.getName() === `hand_${side}`), li = joints.findIndex((j) => j.getName() === `lowerarm_${side}`);
        if (ji < 0 || li < 0) continue;
        skins++;
        const M = skin.getInverseBindMatrices().getElement(ji, []);
        for (const n of root.listNodes())
          if (n.getSkin() === skin && n.getMesh())
            for (const prim of n.getMesh().listPrimitives()) {
              const P = prim.getAttribute("POSITION"), J = prim.getAttribute("JOINTS_0"), W = prim.getAttribute("WEIGHTS_0");
              if (!J || !W) continue;
              const v = [], j = [], w = [];
              for (let i = 0; i < P.getCount(); i++) {
                J.getElement(i, j);
                W.getElement(i, w);
                let wt = 0;
                for (let k = 0; k < 4; k++) if (j[k] === ji || j[k] === li) wt += w[k];
                if (wt < 0.5) continue;
                P.getElement(i, v);
                const h = [0, 1, 2].map((r) => M[r] * v[0] + M[4 + r] * v[1] + M[8 + r] * v[2] + M[12 + r]);
                // within the coil's height (recipe lift 8 mm)
                if (h[1] < CUFF.y0 + 0.008 || h[1] > CUFF.y0 + CUFF.rise + 0.008) continue;
                samples++;
                worst = Math.max(worst, Math.hypot((h[0] - cx) / (CUFF.rx - CUFF.r), h[2] / (CUFF.rz - CUFF.r)));
              }
            }
      }
      if (!skins) {
        problems.push(`cuffs: ${body} has no skin with both hand_${side} and lowerarm_${side}, so its ${side} wrist cannot be checked against the rope coil`);
        continue;
      }
      if (!samples) {
        problems.push(`cuffs: no vertex of ${body}'s ${side} wrist (weighted ≥ 0.5 to hand_${side}/lowerarm_${side}) lies in the rope coil's height band, so the check measured nothing`);
        continue;
      }
      out[key] = { fill: +worst.toFixed(2), samples };
      if (worst > 1) problems.push(`cuffs: ${body}'s ${side} wrist pokes through the rope coil (${worst.toFixed(2)} of its inner radius)`);
    }
  }
  return out;
}

function checkKeep(keep, problems) {
  const rooms = keep.rooms;
  const A = keep.anchors;
  const inRoom = (label, room, pts) => {
    const r = rooms[room];
    if (!r) return problems.push(`keep: room ${room} missing for ${label}`);
    for (const p of pts) {
      if (p[0] < r.worldMin[0] - 0.02 || p[0] > r.worldMax[0] + 0.02 || p[2] < r.worldMin[2] - 0.02 || p[2] > r.worldMax[2] + 0.02)
        return problems.push(`keep: ${label} reaches outside room ${room} at (${r3(p).join(", ")})`);
    }
  };
  const corners = (a, half) => {
    const yaw = a.yaw ?? 0;
    return [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([sx, sz]) => add(a.world, rotY([sx * half[0], 0, sz * half[1]], yaw)));
  };
  if (A.prop_cage) inRoom("the cage", A.prop_cage.room, corners(A.prop_cage, [1.0, 1.0]));
  if (A.prop_strap_chair) inRoom("the strap chair", A.prop_strap_chair.room, corners(A.prop_strap_chair, [0.35, 0.31]));
  if (A.prop_shackles_corpse) inRoom("the shackles", A.prop_shackles_corpse.room, corners(A.prop_shackles_corpse, [0.45, 0.3]));
}

// ------------------------------------------------------------------------------------------------
// build

/**
 * Both documents (PNG textures, before compression) and their metadata.
 * `anchors`: {cave, keep} — the shipped cave/anchors and keep/anchors JSON; `caveMeshA`: the shipped
 * cave/mesh_a GLB, to check that tools/gen/cave.mjs's field is the shipped one (required by the build;
 * a preview may leave it out, and `field.checked` then says so).
 */
export async function buildProcPropsDocs(SRC, { anchors, poses, caveMeshA } = {}) {
  if (!anchors?.cave?.anchors || !anchors?.keep?.anchors) throw new Error("procprops: needs the cave and keep anchors (build cave/ and keep/interior first)");
  const caveA = Object.fromEntries(Object.entries(anchors.cave.anchors).map(([k, v]) => [k, v.pos]));
  for (const k of ["bridge_hinge", "slab_drop", "lever", "lever_stance", "winch"]) if (!caveA[k]) throw new Error(`procprops: cave anchor ${k} missing`);
  poses ??= clipPoses([path.join(SRC, "chars/anim_full/UAL1.glb"), path.join(SRC, "chars/anim_full/UAL2.glb")]);
  const problems = [], notes = [];
  const D = await loadCaveField();
  const field = caveMeshA ? { checked: true, ...(await checkCaveField(D, anchors.cave, caveMeshA, caveA.bridge_hinge)) } : { checked: false };
  if (!caveMeshA) notes.push("the cave field was not compared with a shipped cave/mesh_a (preview)");
  const lever = leverFromClip(poses, caveA);
  if (lever.gap > 0.25) problems.push(`lever: the handle grip strays ${lever.gap} m from the puller's hand during the pull (> 0.25)`);
  for (const [bone, c] of Object.entries(lever.bodyClear)) if (c.d < LEVER.bodyClear) problems.push(`lever: the handle comes within ${c.d} m of the puller's ${bone} bone at ${c.t} s (< ${LEVER.bodyClear})`);
  const wrists = await checkWrists(SRC, problems);

  const keepSpecs = [galleryBridge({ cave: caveA, lever, field: D }), cage(), strapChair(), shackles(), barsPanel(), ...chains(), cuffs(), ...bowAndArrow(), ...torches(), strawBed(), drainGrate(), ...papers(), dice(), brazierIrons(), keyRing()];
  const exitSpecs = [bonePile("bones_a", 101, { skull: true }), bonePile("bones_b", 202), bonePile("bones_c", 303)];
  const gb = keepSpecs[0];
  const findIn = (name, s) => (s.name === name ? s : s.children.map((c) => findIn(name, c)).find(Boolean));
  findIn("lever_pivot", gb).restAngle = lever.rest;

  // held items: recipes and their clip checks
  const held = {
    torch: { side: "l", grip: [0, 0.14, 0], axes: { Y: "+Z", X: "+X" }, check: [{ clip: "Idle_Torch_Loop", t: 0.5, axis: [0, 1, 0], want: [0, 1, 0], deg: 30, what: "flame up in Idle_Torch_Loop" }] },
    bow: {
      side: "l",
      grip: [0, 0, 0],
      axes: { Y: "+Z", Z: "-Y" },
      check: [
        { clip: "Bow_Aim_Neutral", t: 0.5, axis: [0, 0, -1], want: [0, 0, 1], deg: 25, what: "the back (−Z) faces forward in Bow_Aim_Neutral" },
        { clip: "Bow_Aim_Neutral", t: 0.5, axis: [0, 1, 0], want: [0, 1, 0], deg: 25, what: "the upper limb up in Bow_Aim_Neutral" },
      ],
    },
    paper_warrant: { side: "l", grip: [0, 0.03, 0.06], axes: { Z: "-Y", Y: "-X" }, check: [{ clip: "Interact", t: 0.8, axis: [0, 0, -1], want: [0, 0, 1], deg: 35, what: "the written side faces forward in Interact" }] },
    key_ring: { side: "r", grip: [0, -0.005, 0], axes: { Y: "+Y", Z: "+Z" } },
  };
  const heldMeta = {};
  for (const [name, h] of Object.entries(held)) {
    const recipe = heldRecipe(h.side, h.grip, h.axes);
    const checks = [];
    for (const c of h.check ?? []) {
      const r = heldInPose(poses, recipe, c.clip, c.t, c.axis);
      if (!r) {
        problems.push(`${name}: clip ${c.clip} missing for the held check`);
        continue;
      }
      const deg = angleDeg(r.dir, c.want);
      checks.push({ clip: c.clip, t: c.t, what: c.what, deg: +deg.toFixed(1) });
      if (deg > c.deg) problems.push(`${name}: ${c.what}: off by ${deg.toFixed(1)}° (> ${c.deg}°)`);
    }
    heldMeta[name] = { grip: h.grip, recipes: { [recipe.bone]: recipe }, checks };
    const spec = keepSpecs.find((s) => s.name === name);
    spec.extras = { ...(spec.extras ?? {}), held: heldMeta[name] };
  }

  const gallery = checkGallery(gb, caveA, problems, D);
  checkKeep(anchors.keep, problems);

  const build = async (specs, label) => {
    const doc = new Document();
    doc.createBuffer();
    const scene = doc.createScene(label);
    const mats = new MaterialSet(doc, SRC);
    // materials first (async), then the synchronous tree
    const used = new Set();
    const walk = (s) => {
      if (s.parts) for (const [k, mb] of Object.entries(s.parts.m)) if (mb.i.length) used.add(k);
      s.children.forEach(walk);
    };
    specs.forEach(walk);
    const matMap = new Map();
    for (const k of used) matMap.set(k, await mats.get(k));
    const meshes = new Map();
    const out = { names: [], colliders: [], tris: 0, wrong: [] };
    for (const s of specs) emitTree(doc, matMap, s, scene, meshes, out);
    const lower = new Map();
    for (const n of out.names) {
      const k = n.toLowerCase();
      if (lower.has(k)) problems.push(`${label}: node names ${lower.get(k)} and ${n} differ only by case (or repeat)`);
      lower.set(k, n);
    }
    for (const w of out.wrong) if (w.n && w.bad / w.n > 0.02 && !MATS[w.mat].doubleSided) problems.push(`${label}: ${w.name} (${w.mat}) has ${w.bad}/${w.n} triangles wound against their normals`);
    const meta = {};
    for (const s of specs) meta[s.name] = { ...(s.extras ?? {}), tris: countTris(s) };
    return { doc, meta, out };
  };
  const keep = await build(keepSpecs, "procprops_keep");
  const exit = await build(exitSpecs, "procprops_exit");
  if (problems.length) throw new Error(`procprops:\n  ${problems.join("\n  ")}`);
  return { keep, exit, gallery, lever, wrists, notes, field };
}

function countTris(s) {
  return (s.parts ? s.parts.tris : 0) + s.children.reduce((a, c) => a + countTris(c), 0);
}

/** Build and emit procprops/keep and procprops/exit; returns their metadata (for props/meta). */
export async function buildProcProps({ emit, SRC, anchors, caveMeshA }) {
  if (!caveMeshA) throw new Error("procprops: needs the shipped cave/mesh_a (to check tools/gen/cave.mjs's field against it)");
  const r = await buildProcPropsDocs(SRC, { anchors, caveMeshA });
  const result = { notes: r.notes, gallery: r.gallery, wrists: r.wrists, field: r.field, lever: { gap: r.lever.gap, lateral: r.lever.lateral, bodyClear: r.lever.bodyClear } };
  for (const [k, part] of [["keep", r.keep], ["exit", r.exit]]) {
    await compressTextures(part.doc, 1024, 512, 256);
    // pp_rock is untextured in the GLB: the runtime binds cave/tex/rock_* by its extras, through its
    // box-projected TEXCOORD_0, which prune's default would drop. Keep the attributes, minus the UVs of
    // materials that read no texture at all (pp_vcol, pp_leather, pp_rope)
    const boundByExtras = part.doc.getRoot().listMaterials().filter((m) => m.getExtras()?.textures).map((m) => m.getName());
    dropUnusedTexcoords(part.doc);
    const glb = await finalize(part.doc, { keepLeaves: true, keepAttributes: true });
    // the encoded file still has every node, top-level ones at the identity
    const back = await io.readBinary(glb);
    // every primitive still has the UVs its material reads, those bound from extras included (the
    // extras must survive too, or the check below would pass vacuously)
    for (const name of boundByExtras)
      if (!back.getRoot().listMaterials().find((m) => m.getName() === name)?.getExtras()?.textures) throw new Error(`procprops: material ${name} lost its extras.textures in the encoded ${PROCPROPS[k].id}`);
    const noUV = missingTexcoords(back);
    if (noUV.length) throw new Error(`procprops: the encoded ${PROCPROPS[k].id} lacks UVs its materials read (the runtime would sample one texel):\n  ${noUV.join("\n  ")}`);
    const names = new Set(back.getRoot().listNodes().map((n) => n.getName()));
    for (const n of part.out.names) if (!names.has(n)) throw new Error(`procprops: ${n} is missing from the encoded ${PROCPROPS[k].id}`);
    for (const mesh of back.getRoot().listMeshes()) {
      const users = mesh.listParents().filter((x) => x.propertyType === "Node");
      if (users.length > 1) throw new Error(`procprops: mesh ${mesh.getName()} is shared by ${users.map((n) => n.getName()).join(", ")} (props must not share meshes)`);
    }
    for (const top of back.getRoot().listScenes()[0].listChildren()) {
      const t = top.getTranslation(), q = top.getRotation(), s = top.getScale();
      if (t.some((v) => v !== 0) || q[3] !== 1 || s.some((v) => v !== 1)) throw new Error(`procprops: top-level ${top.getName()} is not at the identity after encoding`);
    }
    const P = PROCPROPS[k];
    result[k] = { meta: part.meta, tris: part.out.tris, colliders: part.out.colliders.map((c) => c.name), entry: await emit(P.id, { segment: P.segment, priority: P.priority, type: "glb", ext: "glb", data: glb, pos: P.pos }) };
    const extrasUV = back.getRoot().listMeshes().flatMap((m) => m.listPrimitives()).filter((p) => boundByExtras.includes(p.getMaterial()?.getName() ?? "")).length;
    console.log(`  ${P.id}: ${Object.keys(part.meta).length} props, ${part.out.tris} triangles, ${part.out.colliders.length} colliders${boundByExtras.length ? `; ${extrasUV} primitives of ${boundByExtras.join(", ")} (textures bound from extras) keep TEXCOORD_0` : ""}`);
  }
  for (const n of r.notes) console.log(`  note: ${n}`);
  console.log(`  cuffs: wrist fill of the rope coil's inner section ${JSON.stringify(r.wrists)}`);
  console.log(`  cave field = shipped cave: ${JSON.stringify(r.field)}`);
  console.log(`  gallery: rock clearances ${JSON.stringify(r.gallery.minClear)}, deck steps ${JSON.stringify(r.gallery.steps)}, slab half-width ${r.gallery.slabHalfWidth}`);
  console.log(`  lever: hand gap ${r.lever.gap} m, hand x off the plane ${r.lever.lateral.min}…${r.lever.lateral.max} m, body clearance ${JSON.stringify(r.lever.bodyClear)}`);
  return result;
}
