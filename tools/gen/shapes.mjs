// Primitive shape helpers that append into a MeshBuilder with world-scaled UVs.

/** Rotation matrix from Euler XYZ (radians), applied as R = Ry * Rx * Rz. */
export function euler([rx, ry, rz]) {
  const cx = Math.cos(rx), sx = Math.sin(rx), cy = Math.cos(ry), sy = Math.sin(ry), cz = Math.cos(rz), sz = Math.sin(rz);
  // Rz
  const Rz = [cz, -sz, 0, sz, cz, 0, 0, 0, 1];
  const Rx = [1, 0, 0, 0, cx, -sx, 0, sx, cx];
  const Ry = [cy, 0, sy, 0, 1, 0, -sy, 0, cy];
  return mul(Ry, mul(Rx, Rz));
}
function mul(a, b) {
  const o = new Array(9).fill(0);
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) for (let k = 0; k < 3; k++) o[r * 3 + c] += a[r * 3 + k] * b[k * 3 + c];
  return o;
}
export function apply(m, v) {
  return [m[0] * v[0] + m[1] * v[1] + m[2] * v[2], m[3] * v[0] + m[4] * v[1] + m[5] * v[2], m[6] * v[0] + m[7] * v[1] + m[8] * v[2]];
}

/**
 * Axis-aligned (then rotated) box. UVs: 1 unit = `tile` metres; the longest dimension of each face
 * maps to u so plank textures run along the board.
 */
export function box(mb, center, size, rot = [0, 0, 0], { tile = 1.2, color, uvOffset = [0, 0] } = {}) {
  const m = euler(rot);
  const [hx, hy, hz] = size.map((s) => s / 2);
  const faces = [
    { n: [1, 0, 0], u: [0, 0, -1], v: [0, 1, 0], du: size[2], dv: size[1], d: hx },
    { n: [-1, 0, 0], u: [0, 0, 1], v: [0, 1, 0], du: size[2], dv: size[1], d: hx },
    { n: [0, 1, 0], u: [1, 0, 0], v: [0, 0, -1], du: size[0], dv: size[2], d: hy },
    { n: [0, -1, 0], u: [1, 0, 0], v: [0, 0, 1], du: size[0], dv: size[2], d: hy },
    { n: [0, 0, 1], u: [1, 0, 0], v: [0, 1, 0], du: size[0], dv: size[1], d: hz },
    { n: [0, 0, -1], u: [-1, 0, 0], v: [0, 1, 0], du: size[0], dv: size[1], d: hz },
  ];
  const half = [hx, hy, hz];
  for (const f of faces) {
    // half extents along u and v
    const eu = Math.abs(f.u[0]) * half[0] + Math.abs(f.u[1]) * half[1] + Math.abs(f.u[2]) * half[2];
    const ev = Math.abs(f.v[0]) * half[0] + Math.abs(f.v[1]) * half[1] + Math.abs(f.v[2]) * half[2];
    const swap = f.dv > f.du; // run the long side along u
    const idx = [];
    for (const [a, b] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      const local = [0, 1, 2].map((k) => f.n[k] * f.d + f.u[k] * eu * a + f.v[k] * ev * b);
      const p = apply(m, local);
      const n = apply(m, f.n);
      let uu = ((a + 1) / 2) * f.du / tile, vv = ((b + 1) / 2) * f.dv / tile;
      if (swap) [uu, vv] = [vv, uu];
      idx.push(mb.vertex([center[0] + p[0], center[1] + p[1], center[2] + p[2]], n, [uu + uvOffset[0], vv + uvOffset[1]], color));
    }
    mb.quad(idx[0], idx[1], idx[2], idx[3]);
  }
}

/** Cylinder along local Y, rotated by rot, centred at center. */
export function cylinder(mb, center, radius, length, rot = [0, 0, 0], { sides = 12, tile = 1, caps = true, color, radius2 } = {}) {
  const m = euler(rot);
  const r2 = radius2 ?? radius;
  const base = mb.vertexCount;
  for (let j = 0; j <= 1; j++) {
    const y = (j - 0.5) * length;
    const r = j ? r2 : radius;
    for (let i = 0; i <= sides; i++) {
      const a = (i / sides) * Math.PI * 2;
      const local = [Math.cos(a) * r, y, Math.sin(a) * r];
      const p = apply(m, local);
      const n = apply(m, [Math.cos(a), 0, Math.sin(a)]);
      mb.vertex([center[0] + p[0], center[1] + p[1], center[2] + p[2]], n, [(i / sides) * (2 * Math.PI * radius) / tile, (j * length) / tile], color);
    }
  }
  for (let i = 0; i < sides; i++) {
    const a = base + i, b = a + 1, c = a + sides + 2, d = a + sides + 1;
    mb.quad(a, d, c, b);
  }
  if (!caps) return;
  for (const j of [0, 1]) {
    const y = (j - 0.5) * length;
    const r = j ? r2 : radius;
    const nl = [0, j ? 1 : -1, 0];
    const n = apply(m, nl);
    const cpos = apply(m, [0, y, 0]);
    const ci = mb.vertex([center[0] + cpos[0], center[1] + cpos[1], center[2] + cpos[2]], n, [0.5, 0.5], color);
    const ring = [];
    for (let i = 0; i <= sides; i++) {
      const a = (i / sides) * Math.PI * 2;
      const p = apply(m, [Math.cos(a) * r, y, Math.sin(a) * r]);
      ring.push(mb.vertex([center[0] + p[0], center[1] + p[1], center[2] + p[2]], n, [0.5 + Math.cos(a) * 0.5, 0.5 + Math.sin(a) * 0.5], color));
    }
    for (let i = 0; i < sides; i++) {
      if (j) mb.tri(ci, ring[i + 1], ring[i]);
      else mb.tri(ci, ring[i], ring[i + 1]);
    }
  }
}

/** Arbitrary quad from four points (counter-clockwise seen from the front), planar-mapped UVs. */
export function quad(mb, a, b, c, d, { tile = 1, color, uv } = {}) {
  const e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const e2 = [d[0] - a[0], d[1] - a[1], d[2] - a[2]];
  let n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
  const l = Math.hypot(...n) || 1;
  n = n.map((x) => x / l);
  const lu = Math.hypot(...e1), lv = Math.hypot(...e2);
  const uvs = uv ?? [[0, 0], [lu / tile, 0], [lu / tile, lv / tile], [0, lv / tile]];
  const i = [a, b, c, d].map((p, k) => mb.vertex(p, n, uvs[k], color));
  mb.quad(i[0], i[1], i[2], i[3]);
}

/** Triangle with planar UVs. */
export function tri(mb, a, b, c, { tile = 1, color } = {}) {
  const e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const e2 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
  let n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
  const l = Math.hypot(...n) || 1;
  n = n.map((x) => x / l);
  const lu = Math.hypot(...e1);
  const ue = e1.map((x) => x / lu);
  const proj = (p) => {
    const d = [p[0] - a[0], p[1] - a[1], p[2] - a[2]];
    const u = d[0] * ue[0] + d[1] * ue[1] + d[2] * ue[2];
    const w = [n[1] * ue[2] - n[2] * ue[1], n[2] * ue[0] - n[0] * ue[2], n[0] * ue[1] - n[1] * ue[0]];
    const v = d[0] * w[0] + d[1] * w[1] + d[2] * w[2];
    return [u / tile, Math.abs(v) / tile];
  };
  const i = [a, b, c].map((p) => mb.vertex(p, n, proj(p), color));
  mb.tri(i[0], i[1], i[2]);
}

/**
 * Torus around local Y (the ring lies in the XZ plane), rotated by rot, centred at center.
 * `R`: ring radius (or [Rx, Rz] for an oval ring, e.g. a chain link), `r`: tube radius.
 * UVs: u along the ring, v around the tube, 1 unit = `tile` metres.
 */
export function torus(mb, center, R, r, rot = [0, 0, 0], { segments = 16, sides = 8, tile = 1, color, arc = Math.PI * 2 } = {}) {
  const m = euler(rot);
  const [Rx, Rz] = Array.isArray(R) ? R : [R, R];
  const base = mb.vertexCount;
  const closed = arc >= Math.PI * 2 - 1e-6;
  const nU = closed ? segments : segments + 1;
  const len = (arc * (Rx + Rz)) / 2;
  for (let i = 0; i <= segments; i++) {
    const a = (i / segments) * arc;
    const ca = Math.cos(a), sa = Math.sin(a);
    // ring point and its outward normal in the ring plane (an ellipse's normal for an oval ring)
    const c = [Rx * ca, 0, Rz * sa];
    let nx = Rz * ca, nz = Rx * sa;
    const nl = Math.hypot(nx, nz) || 1;
    (nx /= nl), (nz /= nl);
    for (let j = 0; j <= sides; j++) {
      const b = (j / sides) * Math.PI * 2;
      const cb = Math.cos(b), sb = Math.sin(b);
      const n = [nx * cb, sb, nz * cb];
      const p = apply(m, [c[0] + n[0] * r, n[1] * r, c[2] + n[2] * r]);
      mb.vertex([center[0] + p[0], center[1] + p[1], center[2] + p[2]], apply(m, n), [((i / segments) * len) / tile, ((j / sides) * 2 * Math.PI * r) / tile], color);
    }
  }
  for (let i = 0; i < segments; i++)
    for (let j = 0; j < sides; j++) {
      const a = base + i * (sides + 1) + j, b = base + (i + 1) * (sides + 1) + j;
      mb.quad(a, a + 1, b + 1, b);
    }
  return nU;
}

/**
 * Tube along a polyline (parallel-transport frames). `radius`: a number, or a function (i, t) → r
 * or [rA, rB] for an elliptical section (rA along the frame's first axis, rB along its second).
 * `up`: a hint for the first axis at the start. Caps close the ends unless `caps` is false.
 * UVs: u around (× tile), v along the arc length (× tile).
 */
export function tube(mb, points, radius, { sides = 8, tile = 1, caps = true, color, up = [0, 1, 0] } = {}) {
  const n = points.length;
  if (n < 2) return;
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const nrm = (a) => {
    const l = Math.hypot(a[0], a[1], a[2]) || 1;
    return [a[0] / l, a[1] / l, a[2] / l];
  };
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const T = points.map((p, i) => nrm(sub(points[Math.min(n - 1, i + 1)], points[Math.max(0, i - 1)])));
  // first frame: `up` projected off the tangent
  let A = sub(up, T[0].map((x) => x * dot(up, T[0])));
  if (Math.hypot(...A) < 1e-4) A = Math.abs(T[0][0]) < 0.9 ? [1, 0, 0] : [0, 0, 1];
  A = nrm(sub(A, T[0].map((x) => x * dot(A, T[0]))));
  const frames = [];
  for (let i = 0; i < n; i++) {
    if (i > 0) {
      // transport: remove the new tangent's component and renormalise
      A = nrm(sub(A, T[i].map((x) => x * dot(A, T[i]))));
    }
    frames.push([A, cross(T[i], A)]);
  }
  let s = 0;
  const base = mb.vertexCount;
  const rad = (i) => {
    const r = typeof radius === "function" ? radius(i, i / (n - 1)) : radius;
    return Array.isArray(r) ? r : [r, r];
  };
  for (let i = 0; i < n; i++) {
    if (i > 0) s += Math.hypot(...sub(points[i], points[i - 1]));
    const [a, b] = frames[i];
    const [ra, rb] = rad(i);
    for (let j = 0; j <= sides; j++) {
      const ang = (j / sides) * Math.PI * 2, c = Math.cos(ang), sn = Math.sin(ang);
      const off = [a[0] * c * ra + b[0] * sn * rb, a[1] * c * ra + b[1] * sn * rb, a[2] * c * ra + b[2] * sn * rb];
      // the normal of an ellipse point: scale by the other radius
      const nn = nrm([a[0] * c * rb + b[0] * sn * ra, a[1] * c * rb + b[1] * sn * ra, a[2] * c * rb + b[2] * sn * ra]);
      mb.vertex([points[i][0] + off[0], points[i][1] + off[1], points[i][2] + off[2]], nn, [((j / sides) * Math.PI * (ra + rb)) / tile, s / tile], color);
    }
  }
  for (let i = 0; i < n - 1; i++)
    for (let j = 0; j < sides; j++) {
      const a = base + i * (sides + 1) + j, b = base + (i + 1) * (sides + 1) + j;
      mb.quad(a, a + 1, b + 1, b);
    }
  if (!caps) return;
  for (const [i, dir] of [[0, -1], [n - 1, 1]]) {
    const nn = T[i].map((x) => x * dir);
    const [a, b] = frames[i];
    const [ra, rb] = rad(i);
    const ci = mb.vertex(points[i], nn, [0.5, 0.5], color);
    const ring = [];
    for (let j = 0; j <= sides; j++) {
      const ang = (j / sides) * Math.PI * 2, c = Math.cos(ang), sn = Math.sin(ang);
      ring.push(mb.vertex([points[i][0] + a[0] * c * ra + b[0] * sn * rb, points[i][1] + a[1] * c * ra + b[1] * sn * rb, points[i][2] + a[2] * c * ra + b[2] * sn * rb], nn, [0.5 + c * 0.5, 0.5 + sn * 0.5], color));
    }
    for (let j = 0; j < sides; j++) {
      if (dir > 0) mb.tri(ci, ring[j], ring[j + 1]);
      else mb.tri(ci, ring[j + 1], ring[j]);
    }
  }
}
