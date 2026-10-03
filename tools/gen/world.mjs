// Deterministic world description for the cart ride (segment 2): route spline, terrain height,
// splat weights and scatter rules. Coordinates: right-handed, X east, Y up, -Z north (forward).

// ------------------------------------------------------------------ noise
function hash2(ix, iz, seed) {
  let h = (ix * 374761393 + iz * 668265263 + seed * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967295;
}
function smooth(t) {
  return t * t * t * (t * (t * 6 - 15) + 10);
}
/** 2D gradient (Perlin) noise, roughly -1..1 mapped to 0..1. */
export function valueNoise(x, z, seed = 1) {
  const ix = Math.floor(x), iz = Math.floor(z);
  const fx = x - ix, fz = z - iz;
  const g = (cx, cz, dx, dz) => {
    const a = hash2(cx, cz, seed) * Math.PI * 2;
    return Math.cos(a) * dx + Math.sin(a) * dz;
  };
  const u = smooth(fx), v = smooth(fz);
  const n00 = g(ix, iz, fx, fz), n10 = g(ix + 1, iz, fx - 1, fz);
  const n01 = g(ix, iz + 1, fx, fz - 1), n11 = g(ix + 1, iz + 1, fx - 1, fz - 1);
  const n = (n00 + (n10 - n00) * u) * (1 - v) + (n01 + (n11 - n01) * u) * v;
  return Math.min(1, Math.max(0, n * 0.75 + 0.5));
}
export function fbm(x, z, oct = 5, seed = 1) {
  let s = 0, a = 0.5, f = 1, n = 0;
  for (let i = 0; i < oct; i++) {
    s += a * (valueNoise(x * f, z * f, seed + i * 17) * 2 - 1);
    n += a;
    a *= 0.5;
    f *= 2.03;
  }
  return s / n; // -1..1
}
export function ridged(x, z, oct = 5, seed = 7) {
  let s = 0, a = 0.5, f = 1, n = 0;
  for (let i = 0; i < oct; i++) {
    const v = 1 - Math.abs(valueNoise(x * f, z * f, seed + i * 31) * 2 - 1);
    s += a * v * v;
    n += a;
    a *= 0.5;
    f *= 2.1;
  }
  return s / n; // 0..1
}
export const smoothstep = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const lerp = (a, b, t) => a + (b - a) * t;

// ------------------------------------------------------------------ route
/** Control points (x, z). The convoy drives from south (+z) to the town gate in the north (-z). */
export const ROUTE_POINTS = [
  [-30, 640], [-10, 560], [20, 470], [45, 380], [20, 290], [-20, 205], [5, 120], [40, 40],
  [25, -45], [-25, -130], [-45, -215], [-10, -300], [40, -380], [60, -455], [60, -520],
];
/** Road height keyframes along normalised arc length. */
const ROAD_PROFILE = [
  [0, 44], [0.12, 46], [0.25, 52], [0.4, 66], [0.5, 78], [0.58, 76], [0.7, 58], [0.82, 44], [0.9, 39], [1, 38],
];
export const TOWN = { x: 60, z: -560, r: 120, h: 38 };
export const GATE = { x: 60, z: -500 };

function catmull(p0, p1, p2, p3, t) {
  const t2 = t * t, t3 = t2 * t;
  return [0, 1].map(
    (k) => 0.5 * (2 * p1[k] + (-p0[k] + p2[k]) * t + (2 * p0[k] - 5 * p1[k] + 4 * p2[k] - p3[k]) * t2 + (-p0[k] + 3 * p1[k] - 3 * p2[k] + p3[k]) * t3),
  );
}

function profileHeight(u) {
  for (let i = 1; i < ROAD_PROFILE.length; i++) {
    const [u1, h1] = ROAD_PROFILE[i];
    const [u0, h0] = ROAD_PROFILE[i - 1];
    if (u <= u1) return lerp(h0, h1, smoothstep(0, 1, (u - u0) / (u1 - u0)));
  }
  return ROAD_PROFILE[ROAD_PROFILE.length - 1][1];
}

/** Dense route samples, 1 m apart: [{x, z, y, s}] */
export function buildRoute() {
  const P = ROUTE_POINTS;
  const dense = [];
  for (let i = 0; i < P.length - 1; i++) {
    const p0 = P[Math.max(0, i - 1)], p1 = P[i], p2 = P[i + 1], p3 = P[Math.min(P.length - 1, i + 2)];
    for (let k = 0; k < 200; k++) dense.push(catmull(p0, p1, p2, p3, k / 200));
  }
  dense.push(P[P.length - 1]);
  // resample to 1 m spacing
  const out = [{ x: dense[0][0], z: dense[0][1], s: 0 }];
  let acc = 0;
  let prev = dense[0];
  for (let i = 1; i < dense.length; i++) {
    const cur = dense[i];
    let seg = Math.hypot(cur[0] - prev[0], cur[1] - prev[1]);
    while (acc + seg >= 1) {
      const t = (1 - acc) / seg;
      const x = lerp(prev[0], cur[0], t), z = lerp(prev[1], cur[1], t);
      out.push({ x, z, s: out.length });
      prev = [x, z];
      seg = Math.hypot(cur[0] - prev[0], cur[1] - prev[1]);
      acc = 0;
    }
    acc += seg;
    prev = cur;
  }
  const L = out.length - 1;
  for (const p of out) p.y = profileHeight(p.s / L);
  return out;
}

/** Spatial hash for nearest-route queries. */
export class RouteIndex {
  constructor(route, cell = 32) {
    this.route = route;
    this.cell = cell;
    this.map = new Map();
    route.forEach((p, i) => {
      const k = `${Math.floor(p.x / cell)},${Math.floor(p.z / cell)}`;
      if (!this.map.has(k)) this.map.set(k, []);
      this.map.get(k).push(i);
    });
  }
  /** Nearest route sample within `maxR` (else coarse fallback). Returns {d, i}. */
  nearest(x, z, maxR = 256) {
    const c = this.cell;
    const cx = Math.floor(x / c), cz = Math.floor(z / c);
    let best = Infinity, bi = -1;
    const R = Math.ceil(maxR / c);
    for (let ring = 0; ring <= R; ring++) {
      for (let dx = -ring; dx <= ring; dx++)
        for (let dz = -ring; dz <= ring; dz++) {
          if (Math.max(Math.abs(dx), Math.abs(dz)) !== ring) continue;
          const l = this.map.get(`${cx + dx},${cz + dz}`);
          if (!l) continue;
          for (const i of l) {
            const p = this.route[i];
            const d = (p.x - x) ** 2 + (p.z - z) ** 2;
            if (d < best) {
              best = d;
              bi = i;
            }
          }
        }
      if (bi >= 0 && Math.sqrt(best) < (ring - 1) * c) break;
    }
    if (bi < 0) {
      for (let i = 0; i < this.route.length; i += 4) {
        const p = this.route[i];
        const d = (p.x - x) ** 2 + (p.z - z) ** 2;
        if (d < best) {
          best = d;
          bi = i;
        }
      }
    }
    return { d: Math.sqrt(best), i: bi };
  }
}

// ------------------------------------------------------------------ terrain
export const WORLD_HALF = 900; // terrain spans [-900, 900] in x and z

/** Mountain intensity: strong around the pass, rising toward the map edges. */
function mountainFactor(x, z) {
  const pass = smoothstep(380, 120, Math.abs(z - (-40))); // 1 near z=-40
  const edge = smoothstep(450, 850, Math.max(Math.abs(x), Math.abs(z)));
  return Math.min(1.25, 0.35 + 0.75 * pass + edge);
}

export function makeTerrain(route) {
  const idx = new RouteIndex(route);
  function natural(x, z) {
    return 45 + fbm(x / 420, z / 420, 5, 3) * 26 + fbm(x / 90, z / 90, 3, 11) * 4;
  }
  function far(x, z, d) {
    const m = mountainFactor(x, z);
    const ridge = ridged(x / 260, z / 260, 5, 9);
    const mount = (ridge * 150 + fbm(x / 140, z / 140, 4, 5) * 22) * m;
    return natural(x, z) + mount * smoothstep(35, 260, d);
  }
  /** Height and road distance at (x, z). */
  function sample(x, z) {
    const { d, i } = idx.nearest(x, z);
    const r = route[Math.max(0, i)];
    let h = far(x, z, d);
    // banks: blend from the road surface to the natural terrain
    const w = smoothstep(4.5, 26, d);
    // keep a gentle shoulder so the road sits in a shallow cut
    h = lerp(r.y - 0.15, h, w);
    // town plateau
    const td = Math.hypot(x - TOWN.x, z - TOWN.z);
    const tw = smoothstep(TOWN.r, TOWN.r + 60, td);
    h = lerp(TOWN.h + fbm(x / 40, z / 40, 2, 21) * 0.4, h, tw);
    return { h, d, s: r.s };
  }
  function height(x, z) {
    return sample(x, z).h;
  }
  /** Splat weights RGBA = dirt, rock, road, snow (grass is the remainder). */
  function weights(x, z, h, ny, d) {
    const slope = 1 - ny;
    const n1 = fbm(x / 23, z / 23, 3, 41);
    const n2 = fbm(x / 7, z / 7, 2, 43);
    const rock = smoothstep(0.18, 0.34, slope + n1 * 0.06);
    const snow = smoothstep(118, 140, h + n1 * 14) * (1 - smoothstep(0.42, 0.62, slope));
    const road = 1 - smoothstep(2.4 + n2 * 0.5, 4.2 + n2 * 0.8, d);
    const townGround = 1 - smoothstep(TOWN.r - 30, TOWN.r, Math.hypot(x - TOWN.x, z - TOWN.z));
    let dirt = smoothstep(0.05, 0.35, n1 + 0.1) * 0.8 + (1 - smoothstep(4, 9, d)) * 0.6 + townGround * 0.5;
    dirt = Math.min(1, dirt);
    // normalise so the sum including grass is 1
    let R = dirt * (1 - rock) * (1 - road), G = rock * (1 - road), B = Math.max(road, townGround * 0.25 * (n2 > 0 ? 1 : 0)), A = snow * (1 - road);
    const sum = R + G + B + A;
    if (sum > 1) {
      R /= sum;
      G /= sum;
      B /= sum;
      A /= sum;
    }
    return [R, G, B, A];
  }
  return { idx, sample, height, weights };
}

// ------------------------------------------------------------------ RNG
export function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
