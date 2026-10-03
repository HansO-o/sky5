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
