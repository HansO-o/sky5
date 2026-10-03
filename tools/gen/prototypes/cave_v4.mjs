// Prototype: cave = smooth union of D-shaped swept capsules + ellipsoid chambers (air SDF < 0),
// polygonised with naive surface nets on a sparse 0.5 m grid, SDF ambient occlusion, meshopt
// simplification for render + collision. Measures counts / timings / rock cover vs world terrain.
import { buildRoute, makeTerrain } from "/home/user/northern-prologue/tools/gen/world.mjs";
import { MeshoptSimplifier } from "/home/user/northern-prologue/node_modules/meshoptimizer/index.js";
await MeshoptSimplifier.ready;
const T = makeTerrain(buildRoute());
const t0 = performance.now();

// ---------------------------------------------------------------- 3D gradient noise
const P = new Uint8Array(512); { const p = [...Array(256).keys()]; let s = 1337; for (let i = 255; i > 0; i--) { s = (s * 16807) % 2147483647; const j = s % (i + 1); [p[i], p[j]] = [p[j], p[i]]; } for (let i = 0; i < 512; i++) P[i] = p[i & 255]; }
const G = [[1,1,0],[-1,1,0],[1,-1,0],[-1,-1,0],[1,0,1],[-1,0,1],[1,0,-1],[-1,0,-1],[0,1,1],[0,-1,1],[0,1,-1],[0,-1,-1]];
const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);
function noise3(x, y, z) {
  const X = Math.floor(x), Y = Math.floor(y), Z = Math.floor(z); x -= X; y -= Y; z -= Z;
  const xi = X & 255, yi = Y & 255, zi = Z & 255, u = fade(x), v = fade(y), w = fade(z);
  const g = (h, dx, dy, dz) => { const q = G[h % 12]; return q[0] * dx + q[1] * dy + q[2] * dz; };
  const A = P[xi] + yi, AA = P[A] + zi, AB = P[A + 1] + zi, B = P[xi + 1] + yi, BA = P[B] + zi, BB = P[B + 1] + zi;
  const l = (a, b, t) => a + (b - a) * t;
  return l(l(l(g(P[AA], x, y, z), g(P[BA], x - 1, y, z), u), l(g(P[AB], x, y - 1, z), g(P[BB], x - 1, y - 1, z), u), v),
           l(l(g(P[AA + 1], x, y, z - 1), g(P[BA + 1], x - 1, y, z - 1), u), l(g(P[AB + 1], x, y - 1, z - 1), g(P[BB + 1], x - 1, y - 1, z - 1), u), v), w);
}
const fbm3 = (x, y, z) => noise3(x, y, z) * 0.6 + noise3(x * 2.1, y * 2.1, z * 2.1) * 0.28 + noise3(x * 4.3, y * 4.3, z * 4.3) * 0.12;

// ---------------------------------------------------------------- layout (world coords)
// tunnel control points: [x, floorY, z, halfWidth, clearHeight]
const TUNNELS = {
  entry:  [[54, 33.1, -687, 1.3, 2.7], [54, 31.0, -697, 1.8, 3.0], [52, 29.6, -710, 2.0, 3.2], [49, 28.0, -720, 2.2, 3.4], [48, 28.0, -731, 2.4, 3.6]],
  toSpider: [[48, 28.0, -731, 2.2, 3.4], [47, 28.0, -741, 2.0, 3.3], [42, 28.2, -746, 2.0, 3.2], [32, 28.4, -749, 1.9, 3.2], [18, 28.5, -750, 2.2, 3.4]],
  toDen:  [[18, 28.5, -750, 2.0, 3.2], [6, 29.2, -748, 2.0, 3.2], [-6, 30.6, -741, 1.9, 3.0], [-16, 32.0, -731, 2.0, 3.2], [-24, 33.5, -720, 2.2, 3.4]],
  exit:   [[-24, 33.5, -720, 2.0, 3.2], [-28, 34.3, -709, 2.0, 3.2], [-33, 36.3, -699, 2.1, 3.2], [-40, 38.8, -690, 2.2, 3.3], [-46, 41.6, -681, 2.3, 3.4], [-44, 44.2, -671, 2.3, 3.4], [-36, 46.8, -674, 2.3, 3.4], [-30, 49.6, -682, 2.4, 3.5], [-25, 52.2, -684, 2.6, 3.6], [-21, 54.8, -680, 2.8, 3.8], [-17.5, 57.0, -673.5, 3.2, 4.2]],
};
// stream channel only inside the gallery: [x, bedY, z, halfWidth]
const STREAM = [[64, 23.4, -733, 1.6], [56, 23.3, -732.5, 2.6], [48, 23.2, -731.5, 3.7], [40, 23.1, -731, 2.6], [32, 23.0, -731, 1.6]];
const CHAMBERS = {
  streamGallery: { c: [48, 28.0, -731], r: [14, 10, 11], yaw: 0 },
  spider: { c: [18, 28.5, -750], r: [9, 8.5, 7], yaw: 0.1 },
  den: { c: [-24, 33.5, -720], r: [8, 6, 7], yaw: -0.4 },
};

function catmull(pts, n = 1) {
  const out = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)], p1 = pts[i], p2 = pts[i + 1], p3 = pts[Math.min(pts.length - 1, i + 2)];
    const len = Math.hypot(p2[0] - p1[0], p2[1] - p1[1], p2[2] - p1[2]);
    const steps = Math.max(2, Math.ceil(len / n));
    for (let k = 0; k < steps; k++) {
      const t = k / steps, t2 = t * t, t3 = t2 * t;
      out.push(p1.map((_, j) => 0.5 * (2 * p1[j] + (-p0[j] + p2[j]) * t + (2 * p0[j] - 5 * p1[j] + 4 * p2[j] - p3[j]) * t2 + (-p0[j] + 3 * p1[j] - 3 * p2[j] + p3[j]) * t3)));
    }
  }
  out.push(pts[pts.length - 1]);
  return out;
}
const segs = [];
for (const [name, pts] of Object.entries(TUNNELS)) {
  const s = catmull(pts, 1.0);
  for (let i = 0; i < s.length - 1; i++) segs.push({ name, a: s[i], b: s[i + 1] });
}
let pathLen = 0; for (const s of segs) pathLen += Math.hypot(s.b[0] - s.a[0], s.b[1] - s.a[1], s.b[2] - s.a[2]);

const smin = (a, b, k) => { const h = Math.max(k - Math.abs(a - b), 0) / k; return Math.min(a, b) - h * h * k * 0.25; };

/** D-shaped tunnel segment: ellipse cross-section (half width w, height hgt above the floor), flat floor. */
function segSdf(px, py, pz, s) {
  const [ax, ay, az, aw, ah] = s.a, [bx, by, bz, bw, bh] = s.b;
  const dx = bx - ax, dz = bz - az, L2 = dx * dx + dz * dz || 1e-6;
  let t = ((px - ax) * dx + (pz - az) * dz) / L2; t = Math.max(0, Math.min(1, t));
  const cx = ax + dx * t, cz = az + dz * t, fy = ay + (by - ay) * t, w = aw + (bw - aw) * t, h = ah + (bh - ah) * t;
  const hd = Math.hypot(px - cx, pz - cz);             // horizontal distance to the axis
  const ey = (py - (fy + h * 0.35)) / (h * 0.65 / w);   // ellipse centre at 35% of the clear height
  const d = (Math.hypot(hd, ey) - w);
  return Math.max(d, fy - py);                          // flat floor
}
function chamberSdf(px, py, pz, ch) {
  const [cx, cy, cz] = ch.c, [rx, ry, rz] = ch.r, c = Math.cos(ch.yaw), s = Math.sin(ch.yaw);
  const lx = (px - cx) * c - (pz - cz) * s, lz = (px - cx) * s + (pz - cz) * c, ly = py - (cy - ry * 0.25);
  const k = Math.hypot(lx / rx, ly / ry, lz / rz);
  const d = (k - 1) * Math.min(rx, ry, rz);
  return Math.max(d, cy - py);
}
/** Stream channel: 3 m wide trench cut 3.4 m below the gallery ledges, following the stream spline. */
const streamPts = catmull(STREAM, 1);
function channelSdf(px, py, pz) {
  let best = 1e9, fy = 0, hwAt = 1.5;
  for (let i = 0; i < streamPts.length - 1; i++) {
    const a = streamPts[i], b = streamPts[i + 1], dx = b[0] - a[0], dz = b[2] - a[2], L2 = dx * dx + dz * dz;
    let t = ((px - a[0]) * dx + (pz - a[2]) * dz) / L2; t = Math.max(0, Math.min(1, t));
    const d = Math.hypot(px - (a[0] + dx * t), pz - (a[2] + dz * t));
    if (d < best) { best = d; fy = a[1] + (b[1] - a[1]) * t; hwAt = a[3] + (b[3] - a[3]) * t; }
  }
  return Math.max(best - (hwAt + 0.2 * noise3(px * 0.2, 0, pz * 0.2)), fy - py, py - (fy + 6));
}
function airBase(px, py, pz) {
  let d = 1e9;
  for (const s of segs) {
    // quick reject
    const mx = (s.a[0] + s.b[0]) / 2, mz = (s.a[2] + s.b[2]) / 2;
    if (Math.abs(px - mx) > 12 || Math.abs(pz - mz) > 12) continue;
    d = smin(d, segSdf(px, py, pz, s), 1.2);
  }
  for (const ch of Object.values(CHAMBERS)) d = smin(d, chamberSdf(px, py, pz, ch), 2.0);
  d = smin(d, channelSdf(px, py, pz), 0.8);
  return d;
}
/** Final air SDF (negative = air). Noise strong on walls/ceiling, weak on walkable floors. */
function air(px, py, pz) {
  const d = airBase(px, py, pz);
  if (d > 2.5) return d;
  const n = fbm3(px * 0.35, py * 0.35, pz * 0.35) * 0.9 + noise3(px * 1.7, py * 1.7, pz * 1.7) * 0.12;
  // floor flattening: estimate distance above the local floor with a downward probe of the base SDF
  const below = airBase(px, py - 0.6, pz) > 0 ? 1 : 0; // near the floor -> damp the noise
  return d + n * (below ? 0.12 : 0.55);
}

// ---------------------------------------------------------------- sparse naive surface nets
const H = 0.5, B = 8; // cell size, cells per block
let min = [1e9, 1e9, 1e9], max = [-1e9, -1e9, -1e9];
const grow = (p, r) => { for (let k = 0; k < 3; k++) { min[k] = Math.min(min[k], p[k] - r); max[k] = Math.max(max[k], p[k] + r); } };
for (const s of segs) { grow(s.a, 7); grow(s.b, 7); }
for (const ch of Object.values(CHAMBERS)) grow(ch.c, Math.max(...ch.r) + 3);
min = min.map((v) => Math.floor(v / H) * H); max = max.map((v) => Math.ceil(v / H) * H);
const N = [0, 1, 2].map((k) => Math.round((max[k] - min[k]) / H) + 1);
const verts = new Map(); const pos = []; const idx = [];
let evals = 0, blocks = 0, skipped = 0;
const field = new Map(); // key -> sdf at grid point (only for active blocks)
const key = (i, j, k) => (k * N[1] + j) * N[0] + i;
const sdfAt = (i, j, k) => {
  const kk = key(i, j, k); let v = field.get(kk);
  if (v === undefined) { v = air(min[0] + i * H, min[1] + j * H, min[2] + k * H); field.set(kk, v); evals++; }
  return v;
};
const active = [];
for (let bk = 0; bk < N[2]; bk += B) for (let bj = 0; bj < N[1]; bj += B) for (let bi = 0; bi < N[0]; bi += B) {
  blocks++;
  const c = [min[0] + (bi + B / 2) * H, min[1] + (bj + B / 2) * H, min[2] + (bk + B / 2) * H];
  const d = airBase(...c);
  if (Math.abs(d) > (B * H) * 0.87 + 1.2) { skipped++; continue; }
  active.push([bi, bj, bk]);
}
// cells with a sign change get one vertex (mass point of the edge crossings)
const EDGES = [[0,1],[2,3],[4,5],[6,7],[0,2],[1,3],[4,6],[5,7],[0,4],[1,5],[2,6],[3,7]];
const C = [[0,0,0],[1,0,0],[0,1,0],[1,1,0],[0,0,1],[1,0,1],[0,1,1],[1,1,1]];
function cellVertex(i, j, k) {
  const kk = key(i, j, k); if (verts.has(kk)) return verts.get(kk);
  const v = C.map(([a, b, c]) => sdfAt(i + a, j + b, k + c));
  let sx = 0, sy = 0, sz = 0, n = 0;
  for (const [e0, e1] of EDGES) {
    if ((v[e0] < 0) === (v[e1] < 0)) continue;
    const t = v[e0] / (v[e0] - v[e1]);
    sx += C[e0][0] + (C[e1][0] - C[e0][0]) * t; sy += C[e0][1] + (C[e1][1] - C[e0][1]) * t; sz += C[e0][2] + (C[e1][2] - C[e0][2]) * t; n++;
  }
  if (!n) { verts.set(kk, -1); return -1; }
  const id = pos.length / 3;
  pos.push(min[0] + (i + sx / n) * H, min[1] + (j + sy / n) * H, min[2] + (k + sz / n) * H);
  verts.set(kk, id); return id;
}
for (const [bi, bj, bk] of active)
  for (let k = bk; k < Math.min(bk + B, N[2] - 1); k++) for (let j = bj; j < Math.min(bj + B, N[1] - 1); j++) for (let i = bi; i < Math.min(bi + B, N[0] - 1); i++) {
    if (i < 1 || j < 1 || k < 1) continue;
    const d0 = sdfAt(i, j, k);
    // three edges leaving this grid point in +x, +y, +z; each sign change -> quad of the 4 cells around the edge
    for (const [ax, cells] of [[[1, 0, 0], [[0, -1, -1], [0, 0, -1], [0, 0, 0], [0, -1, 0]]], [[0, 1, 0], [[-1, 0, -1], [-1, 0, 0], [0, 0, 0], [0, 0, -1]]], [[0, 0, 1], [[-1, -1, 0], [0, -1, 0], [0, 0, 0], [-1, 0, 0]]]]) {
      const d1 = sdfAt(i + ax[0], j + ax[1], k + ax[2]);
      if ((d0 < 0) === (d1 < 0)) continue;
      const q = cells.map(([a, b, c]) => cellVertex(i + a, j + b, k + c));
      if (q.some((x) => x < 0)) continue;
      // face the air side (negative SDF): flip by the sign
      if (d0 < 0) idx.push(q[0], q[2], q[1], q[0], q[3], q[2]);
      else idx.push(q[0], q[1], q[2], q[0], q[2], q[3]);
    }
  }
const tMesh = performance.now();

// ---------------------------------------------------------------- normals (SDF gradient), projection, AO, cover check
const nrm = new Float32Array(pos.length), ao = new Float32Array(pos.length / 3);
const e = 0.05;
let minCover = 1e9, coverFails = 0;
for (let v = 0; v < pos.length / 3; v++) {
  let x = pos[v * 3], y = pos[v * 3 + 1], z = pos[v * 3 + 2];
  for (let it = 0; it < 2; it++) { // project onto the surface
    const d = air(x, y, z);
    const gx = air(x + e, y, z) - air(x - e, y, z), gy = air(x, y + e, z) - air(x, y - e, z), gz = air(x, y, z + e) - air(x, y, z - e);
    const gl = Math.hypot(gx, gy, gz) / (2 * e) || 1;
    x -= (d * gx) / (2 * e) / (gl * gl); y -= (d * gy) / (2 * e) / (gl * gl); z -= (d * gz) / (2 * e) / (gl * gl);
  }
  pos[v * 3] = x; pos[v * 3 + 1] = y; pos[v * 3 + 2] = z;
  let gx = air(x + e, y, z) - air(x - e, y, z), gy = air(x, y + e, z) - air(x, y - e, z), gz = air(x, y, z + e) - air(x, y, z - e);
  const l = Math.hypot(gx, gy, gz) || 1; gx = -gx / l; gy = -gy / l; gz = -gz / l; // into the air
  nrm[v * 3] = gx; nrm[v * 3 + 1] = gy; nrm[v * 3 + 2] = gz;
  // SDF AO: 5 probes along the normal, 0.35 m apart
  let occ = 0, w = 1;
  for (let i = 1; i <= 5; i++) { const h = i * 0.35; const dist = -air(x + gx * h, y + gy * h, z + gz * h); occ += w * Math.max(0, h - dist); w *= 0.6; }
  ao[v] = Math.max(0.25, 1 - occ * 0.9);
  // rock cover above every vertex (except the last metres before the mouth)
  const cover = T.height(x, z) - y;
  const nearMouth = x > -27 && z > -686;
  if (!nearMouth) { minCover = Math.min(minCover, cover); if (cover < 1.5) { coverFails++; if (coverFails < 4) console.log('thin cover at', x.toFixed(1), y.toFixed(1), z.toFixed(1), cover.toFixed(2)); } }
}
const tAO = performance.now();

// ---------------------------------------------------------------- simplification (render / collision)
const P32 = new Float32Array(pos), I32 = new Uint32Array(idx);
const [rIdx, rErr] = MeshoptSimplifier.simplify(I32, P32, 3, Math.floor(I32.length * 0.35 / 3) * 3, 0.01, []);
const [cIdx, cErr] = MeshoptSimplifier.simplify(I32, P32, 3, Math.floor(I32.length * 0.12 / 3) * 3, 0.03, []);
const tEnd = performance.now();

let area = 0; for (let t = 0; t < idx.length; t += 3) { const a = idx[t] * 3, b = idx[t + 1] * 3, c = idx[t + 2] * 3; const u = [pos[b] - pos[a], pos[b + 1] - pos[a + 1], pos[b + 2] - pos[a + 2]], w2 = [pos[c] - pos[a], pos[c + 1] - pos[a + 1], pos[c + 2] - pos[a + 2]]; area += Math.hypot(u[1] * w2[2] - u[2] * w2[1], u[2] * w2[0] - u[0] * w2[2], u[0] * w2[1] - u[1] * w2[0]) / 2; }
const aoHist = [0, 0, 0, 0, 0]; for (const a of ao) aoHist[Math.min(4, Math.floor(a * 5))]++;
console.log(JSON.stringify({
  bbox: { min, max, grid: N }, pathLenM: +pathLen.toFixed(0), blocks, skippedBlocks: skipped, sdfEvals: evals,
  vertices: pos.length / 3, triangles: idx.length / 3, surfaceM2: +area.toFixed(0),
  renderTris: rIdx.length / 3, renderErr: +rErr.toFixed(4), colliderTris: cIdx.length / 3, colliderErr: +cErr.toFixed(4),
  minRockCoverM: +minCover.toFixed(2), coverFails, aoHistogram: aoHist,
  ms: { mesh: +(tMesh - t0).toFixed(0), normalsAoCover: +(tAO - tMesh).toFixed(0), simplify: +(tEnd - tAO).toFixed(0) },
}, null, 1));
// terrain height at the mouth and at chamber centres
for (const [n, p] of [["stub-end", [-37.5, -655]], ["mouth", [-37, -646]], ["spider", [18, -750]], ["gallery", [48, -731]], ["den", [-24, -720]], ["collapse", [54, -697]]]) console.log(n, "terrain", T.height(p[0], p[1]).toFixed(1));

// ---------------------------------------------------------------- walkability probes along every tunnel spline
let worst = { clear: 1e9, halfW: 1e9, floorDev: 0 }, wrongWinding = 0;
for (const [name, pts] of Object.entries(TUNNELS)) {
  for (const p of catmull(pts, 2)) {
    const [x, fy, z] = p; let y = fy + 1.2;
    if (air(x, y, z) > 0) continue; // inside a chamber wall etc.
    let yf = y; while (air(x, yf, z) < 0 && yf > fy - 3) yf -= 0.05;            // floor
    let yc = y; while (air(x, yc, z) < 0 && yc < fy + 12) yc += 0.05;          // ceiling
    let wl = 0; while (air(x + wl, y, z) < 0 && wl < 8) wl += 0.05;            // +x half width
    let wr = 0; while (air(x - wr, y, z) < 0 && wr < 8) wr += 0.05;
    let wz = 0; while (air(x, y, z + wz) < 0 && wz < 8) wz += 0.05;
    let wz2 = 0; while (air(x, y, z - wz2) < 0 && wz2 < 8) wz2 += 0.05;
    worst.clear = Math.min(worst.clear, yc - yf); worst.halfW = Math.min(worst.halfW, Math.max(Math.min(wl, wr), Math.min(wz, wz2)));
    if (true && Math.abs(yf - fy) > worst.floorDev) { worst.floorDev = Math.abs(yf - fy); worst.at = [name, x.toFixed(1), fy.toFixed(1), z.toFixed(1), yf.toFixed(2)]; }
  }
}
for (let t = 0; t < idx.length; t += 3) {
  const a = idx[t] * 3, b = idx[t + 1] * 3, c = idx[t + 2] * 3;
  const u = [pos[b] - pos[a], pos[b + 1] - pos[a + 1], pos[b + 2] - pos[a + 2]], w2 = [pos[c] - pos[a], pos[c + 1] - pos[a + 1], pos[c + 2] - pos[a + 2]];
  const n = [u[1] * w2[2] - u[2] * w2[1], u[2] * w2[0] - u[0] * w2[2], u[0] * w2[1] - u[1] * w2[0]];
  if (n[0] * nrm[a] + n[1] * nrm[a + 1] + n[2] * nrm[a + 2] < 0) wrongWinding++;
}
console.log("walk probes", JSON.stringify({ minClearanceM: +worst.clear.toFixed(2), minHalfWidthM: +worst.halfW.toFixed(2), maxFloorDeviationM: +worst.floorDev.toFixed(2), at: worst.at }), "triangles facing away from air:", wrongWinding, "/", idx.length / 3);

// triangles outside the hill (above terrain + 0.3 m): these get clipped at the mouth
let outside = 0; for (let t = 0; t < idx.length; t += 3) { let all = true; for (let k = 0; k < 3; k++) { const v = idx[t + k] * 3; if (pos[v + 1] < T.height(pos[v], pos[v + 2]) + 0.3) all = false; } if (all) outside++; }
console.log("triangles above terrain (clip at mouth):", outside);

import fs from "node:fs"; fs.writeFileSync("cave_v4_stats.json", JSON.stringify({tris: idx.length/3}));
// --- extra probes for the design doc
const floorAt = (x, z, y0) => { let y = y0; if (air(x, y, z) > 0) return null; while (air(x, y, z) < 0 && y > y0 - 8) y -= 0.05; return y; };
for (const x of [46, 48, 50]) { let row = `x=${x}:`; for (let z = -724; z >= -739; z -= 1) { const f = floorAt(x, z, 28.8); row += ` ${z}:${f === null ? "rock" : f.toFixed(1)}`; } console.log(row); }
// worst floor deviation per tunnel excluding the channel band
for (const [name, pts] of Object.entries(TUNNELS)) { let worstDev = 0, at = null, maxSlope = 0; let prev = null;
  for (const p of catmull(pts, 1)) { const [x, fy, z] = p; if (z < -726.5 && z > -735.5 && x > 30 && x < 66) { prev = null; continue; }
    const f = floorAt(x, z, fy + 1.2); if (f === null) continue; const dev = Math.abs(f - fy); if (dev > worstDev) { worstDev = dev; at = [x.toFixed(1), z.toFixed(1)]; }
    if (prev) { const s = Math.atan2(Math.abs(f - prev[1]), Math.hypot(x - prev[0][0], z - prev[0][1])) * 180 / Math.PI; maxSlope = Math.max(maxSlope, s); } prev = [[x, z], f]; }
  console.log("tunnel", name, "maxFloorDev", worstDev.toFixed(2), at, "maxFloorSlopeDeg", maxSlope.toFixed(0)); }
// chamber floor flatness (sample grid inside radius*0.8)
for (const [n, ch] of Object.entries(CHAMBERS)) { let lo = 1e9, hi = -1e9; for (let a = 0; a < 40; a++) { const r = Math.sqrt((a % 8 + 0.5) / 8) * 0.75, t = a * 2.4; const x = ch.c[0] + Math.cos(t) * ch.r[0] * r, z = ch.c[2] + Math.sin(t) * ch.r[2] * r; if (n === "streamGallery" && z < -726.5 && z > -735.5) continue; const f = floorAt(x, z, ch.c[1] + 1.5); if (f === null) continue; lo = Math.min(lo, f); hi = Math.max(hi, f); } console.log("chamber", n, "floor range", lo.toFixed(2), hi.toFixed(2)); }
for (const [n, x, z, y0] of [["breach", 54, -688.5, 34.0], ["ramp-foot", 54, -697, 32.0], ["gal-n-west", 40, -724.5, 29.2], ["camp", 53, -723.5, 29.2], ["gal-n-east", 57, -726, 29.2], ["lever", 44.0, -725.0, 29.2], ["bridge-n", 48, -726.5, 29.2], ["bridge-s", 48, -736.5, 29.2], ["gal-s", 48, -739, 29.2], ["spider-e-door", 28, -749.5, 29.6], ["spider-c", 18, -750, 29.7], ["spider-w-door", 9, -749, 29.9], ["den-entry", -18, -727, 33.4], ["den-c", -24, -720, 34.7], ["wolf-bed", -27, -717, 34.7], ["den-path-a", -19.5, -720, 34.7], ["den-path-b", -21, -713.5, 34.7], ["den-exit", -27.5, -710, 35.5], ["satchel", -25.5, -715.5, 34.7]]) {
  const f = floorAt(x, z, y0); let c = null; if (f !== null) { let y = f + 0.3; while (air(x, y, z) < 0 && y < f + 14) y += 0.05; c = y - f; }
  console.log("anchor", n, x, z, "floor", f === null ? "rock" : f.toFixed(2), "clear", c === null ? "-" : c.toFixed(1));
}

// exit climb profile
{ const pts = catmull(TUNNELS.exit, 2); let acc = 0, prev = null;
  for (const p of pts) { const [x, fy, z] = p; if (prev) acc += Math.hypot(x - prev[0], z - prev[2]); prev = p;
    let y = fy + 1.2; const f = air(x, y, z) < 0 ? (()=>{ let yf=y; while (air(x, yf, z) < 0 && yf > fy - 4) yf -= 0.05; return yf; })() : null;
    let c = null; if (f !== null) { let yc = f + 0.3; while (air(x, yc, z) < 0 && yc < f + 12) yc += 0.05; c = yc - f; }
    console.log("exit s", acc.toFixed(1), "xyz", x.toFixed(1), fy.toFixed(1), z.toFixed(1), "floor", f===null?"-":f.toFixed(2), "clear", c===null?"-":c.toFixed(1), "terrain", T.height(x,z).toFixed(1), "cover", f===null||c===null?"-":(T.height(x,z)-(f+c)).toFixed(1)); } }
// portal footprint: vertices of the mesh above terrain-0.5 near the mouth
{ let mn=[1e9,1e9], mx=[-1e9,-1e9], n=0; for (let v=0; v<pos.length/3; v++){ const x=pos[v*3], y=pos[v*3+1], z=pos[v*3+2]; if (x>-30 && z>-690 && y > T.height(x,z)-0.5){ n++; mn=[Math.min(mn[0],x),Math.min(mn[1],z)]; mx=[Math.max(mx[0],x),Math.max(mx[1],z)]; } } console.log("portal verts", n, "bbox x", mn[0].toFixed(1), mx[0].toFixed(1), "z", mn[1].toFixed(1), mx[1].toFixed(1)); }
// floor/clear grids for design
const grid = (label, x0, x1, z0, z1, st, y0) => { console.log("GRID", label, "rows z, cols x", x0, "..", x1, "step", st, "(floor/clear)"); for (let z = z0; z >= z1; z -= st) { let r = String(z).padStart(5) + ":"; for (let x = x0; x <= x1; x += st) { const f = floorAt(x, z, y0); let c = null; if (f !== null) { let y = f + 0.3; while (air(x, y, z) < 0 && y < f + 14) y += 0.1; c = y - f; } r += f === null ? "    ----   " : ` ${f.toFixed(1)}/${c.toFixed(1)}`.padEnd(11); } console.log(r); } };
grid("den", -32, -16, -708, -728, 2, 34.7);
grid("gallery", 36, 60, -720, -742, 2, 29.2);
grid("spider", 10, 26, -744, -756, 2, 29.8);
for (const [n, x, z, y0] of [["cp_gallery", 51.0, -714, 30.5], ["gal-entry-mouth", 49.5, -721.5, 29.2], ["lever-stance", 44.0, -724.0, 29.2], ["perch-base", 56.5, -725.5, 29.2], ["camp-fire", 53.5, -724.0, 29.2], ["sitA", 52.0, -722.8, 29.2], ["sitB", 55.0, -723.0, 29.2], ["gal-s-cp", 47.5, -738.5, 29.0], ["comp-s", 49.2, -739.0, 29.0], ["web-A", 27.0, -749.5, 29.6], ["cp_spider", 31.5, -749.0, 29.6], ["cocoon", 22, -754, 29.8], ["burrow-n", 15, -745.5, 29.8], ["burrow-s", 21, -755, 29.8], ["web-B", 10.5, -749.2, 29.8], ["cp_spider_done", 12, -749.5, 29.8], ["cp_den", -16.5, -729, 33.2], ["wolf-bed", -22, -718, 34.5], ["satchel", -20.5, -716.5, 34.7], ["path1", -19.0, -726, 33.4], ["path2", -25.5, -723.5, 34.7], ["path3", -27.5, -718, 34.7], ["path4", -27.0, -712.5, 34.7], ["cp_climb", -28.0, -709, 35.0], ["cp_light", -25.0, -684, 52.0], ["bend", -21.0, -680, 54.8], ["stub84", -21.9, -681.3, 54.2], ["balcony-end", -17.5, -673.5, 57.2]]) {
  const f = floorAt(x, z, y0); let c = null; if (f !== null) { let y = f + 0.3; while (air(x, y, z) < 0 && y < f + 14) y += 0.05; c = y - f; }
  console.log("ANCH", n, x, z, "floor", f === null ? "rock" : f.toFixed(2), "clear", c === null ? "-" : c.toFixed(1));
}
