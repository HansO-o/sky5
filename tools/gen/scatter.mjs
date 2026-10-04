// Deterministic scatter of vegetation and rocks around the cart route.
// Output: Map<typeName, Float32Array [x, y, z, yaw, scale] * n>
import { fbm, rng, smoothstep, TOWN, GATE } from "./world.mjs";

/**
 * Circles kept free of scatter (world x/z, radius in metres). Applied when an instance is pushed,
 * after all its random draws, so excluding one never shifts the others.
 */
export const SCATTER_EXCLUDE = [
  // the balcony outcrop over the cave mouth (tools/gen/cave.mjs, design §4.4): 10 m around
  // (−18, −676) in the design, widened to 19 m so it covers the outcrop's whole footprint down to
  // the terrain (cave.mjs validates that)
  { x: -18, z: -676, r: 19 },
];

export function scatter(T, route) {
  const out = new Map();
  const push = (type, x, y, z, yaw, s) => {
    for (const e of SCATTER_EXCLUDE) if (Math.hypot(x - e.x, z - e.z) < e.r) return;
    if (!out.has(type)) out.set(type, []);
    out.get(type).push(x, y, z, yaw, s);
  };
  const R = rng(1234);
  const slopeAt = (x, z) => {
    const e = 1.5;
    const hx = T.height(x + e, z) - T.height(x - e, z);
    const hz = T.height(x, z + e) - T.height(x, z - e);
    const n = [-hx, 2 * e, -hz];
    const l = Math.hypot(...n);
    return 1 - n[1] / l;
  };
  const inTown = (x, z, pad = 0) => Math.hypot(x - TOWN.x, z - TOWN.z) < TOWN.r + pad || (Math.abs(x - GATE.x) < 30 && z < GATE.z + 40 && z > GATE.z - 10);

  // --- trees: jittered grid
  const step = 7;
  const xs = route.map((p) => p.x), zs = route.map((p) => p.z);
  const minX = Math.min(...xs) - 520, maxX = Math.max(...xs) + 520;
  const minZ = Math.min(...zs) - 420, maxZ = Math.max(...zs) + 120;
  let trees = 0;
  for (let gz = minZ; gz < maxZ; gz += step)
    for (let gx = minX; gx < maxX; gx += step) {
      const x = gx + (R() - 0.5) * step * 0.9, z = gz + (R() - 0.5) * step * 0.9;
      const { h, d } = T.sample(x, z);
      if (d < 9 + R() * 4 || d > 520) continue;
      if (inTown(x, z, 25)) continue;
      if (h > 150 + fbm(x / 50, z / 50, 2, 3) * 20) continue;
      const slope = slopeAt(x, z);
      if (slope > 0.42) continue;
      const dens = smoothstep(-0.35, 0.25, fbm(x / 140, z / 140, 3, 77)) * 0.8 + 0.12;
      // thin out right next to the road so the view stays open
      const nearRoad = smoothstep(9, 28, d);
      if (R() > dens * (0.35 + 0.65 * nearRoad) * (1 - smoothstep(120, 150, h) * 0.7)) continue;
      const variant = Math.floor(R() * 3);
      const s = 0.7 + R() * 0.6;
      push(`fir${variant}`, +x.toFixed(2), +(h - 0.15).toFixed(2), +z.toFixed(2), R() * Math.PI * 2, +s.toFixed(3));
      trees++;
    }

  // --- rocks, ferns, stumps along the corridor (Poisson-ish by rejection)
  const corridor = (n, dMin, dMax, fn) => {
    let placed = 0, tries = 0;
    while (placed < n && tries < n * 30) {
      tries++;
      const p = route[Math.floor(R() * route.length)];
      const side = R() < 0.5 ? -1 : 1;
      const dist = dMin + R() * (dMax - dMin);
      // perpendicular offset from the route sample
      const q = route[Math.min(route.length - 1, p.s + 1)];
      const tx = q.x - p.x, tz = q.z - p.z;
      const l = Math.hypot(tx, tz) || 1;
      const x = p.x + (-tz / l) * side * dist + (R() - 0.5) * 6;
      const z = p.z + (tx / l) * side * dist + (R() - 0.5) * 6;
      const smp = T.sample(x, z);
      if (smp.d < dMin || inTown(x, z, 5)) continue;
      if (fn(x, z, smp)) placed++;
    }
  };
  corridor(260, 6, 60, (x, z, { h }) => {
    const slope = slopeAt(x, z);
    if (slope > 0.5) return false;
    const k = Math.floor(R() * 13);
    const s = 0.5 + R() * 1.1;
    push(k < 6 ? `rockA${k}` : `rockB${k - 6}`, x, h - 0.15 * s, z, R() * Math.PI * 2, s);
    return true;
  });
  corridor(60, 12, 90, (x, z, { h }) => {
    push("boulder", x, h - 0.3, z, R() * Math.PI * 2, 0.8 + R() * 1.6);
    return true;
  });
  corridor(1400, 4.5, 70, (x, z, { h }) => {
    if (h > 135 || slopeAt(x, z) > 0.4) return false;
    push(`fern${Math.floor(R() * 4)}`, x, h - 0.05, z, R() * Math.PI * 2, 0.7 + R() * 0.7);
    return true;
  });
  corridor(70, 10, 80, (x, z, { h }) => {
    if (h > 140) return false;
    push("stump", x, h - 0.08, z, R() * Math.PI * 2, 0.8 + R() * 0.5);
    return true;
  });
  corridor(45, 10, 80, (x, z, { h }) => {
    if (h > 140) return false;
    push("log", x, h + 0.05, z, R() * Math.PI * 2, 0.8 + R() * 0.4);
    return true;
  });
  // cliffs: big rock faces on steep ground near the pass
  corridor(70, 26, 120, (x, z, { h, d }) => {
    const slope = slopeAt(x, z);
    if (slope < 0.3) return false;
    const big = R() < 0.6;
    // face the road: yaw toward nearest route point
    const p = route[T.idx.nearest(x, z).i];
    const yaw = Math.atan2(p.x - x, p.z - z);
    push(big ? "cliff" : "rockface", x, h - (big ? 4 : 1.5), z, yaw + (R() - 0.5) * 0.6, big ? 1.4 + R() * 1.4 : 1.2 + R() * 1.4);
    return true;
  });
  return { types: out, trees };
}

/** Pack scatter into: u32 headerLen | header JSON | pad | float32 data. */
export function packScatter(types) {
  const header = { types: [] };
  let offset = 0;
  const chunks = [];
  for (const [name, arr] of [...types.entries()].sort()) {
    header.types.push({ name, count: arr.length / 5, offset });
    chunks.push(new Float32Array(arr));
    offset += arr.length;
  }
  const json = Buffer.from(JSON.stringify(header));
  const pad = (4 - ((4 + json.length) % 4)) % 4;
  const out = Buffer.alloc(4 + json.length + pad + offset * 4);
  out.writeUInt32LE(json.length, 0);
  json.copy(out, 4);
  let o = 4 + json.length + pad;
  for (const c of chunks) {
    Buffer.from(c.buffer).copy(out, o);
    o += c.byteLength;
  }
  return out;
}
