// Terrain chunk meshes: 9x9 chunks of 200 m. Resolution depends on distance to the route.
// Vertex colour = splat weights (dirt, rock, road, snow). Chunk borders get skirts to hide
// cracks between chunks of different resolution.
import { WORLD_HALF } from "./world.mjs";
import { inRenderHole } from "./terrainHoles.mjs";

export const CHUNK = 200;

/**
 * @param holes terrain holes to cut (tools/gen/terrainHoles.mjs `activeHoles`): quads whose centre
 *   lies in a hole's `render` rectangle are left out. Each chunk reports the holes it cut.
 */
export function buildTerrainChunks(T, route, holes = []) {
  const chunks = [];
  const n = Math.round((WORLD_HALF * 2) / CHUNK);
  for (let cz = 0; cz < n; cz++)
    for (let cx = 0; cx < n; cx++) {
      const x0 = -WORLD_HALF + cx * CHUNK, z0 = -WORLD_HALF + cz * CHUNK;
      // distance from chunk rectangle to the route
      let dmin = Infinity;
      for (let i = 0; i < route.length; i += 3) {
        const p = route[i];
        const dx = Math.max(x0 - p.x, 0, p.x - (x0 + CHUNK));
        const dz = Math.max(z0 - p.z, 0, p.z - (z0 + CHUNK));
        dmin = Math.min(dmin, Math.hypot(dx, dz));
      }
      const spacing = dmin < 40 ? 2 : dmin < 250 ? 5 : dmin < 600 ? 10 : 20;
      chunks.push(buildChunk(T, x0, z0, spacing, `terrain_${cx}_${cz}`, holes));
    }
  return chunks;
}

function buildChunk(T, x0, z0, spacing, name, holes) {
  const N = Math.round(CHUNK / spacing);
  const V = N + 1;
  const pos = [], nrm = [], col = [], idx = [];
  const H = new Float32Array(V * V);
  const D = new Float32Array(V * V);
  for (let j = 0; j < V; j++)
    for (let i = 0; i < V; i++) {
      const s = T.sample(x0 + i * spacing, z0 + j * spacing);
      H[j * V + i] = s.h;
      D[j * V + i] = s.d;
    }
  const e = Math.min(spacing, 2);
  for (let j = 0; j < V; j++)
    for (let i = 0; i < V; i++) {
      const x = x0 + i * spacing, z = z0 + j * spacing;
      const h = H[j * V + i];
      // normals from the continuous height function so chunk borders match
      const hx = T.height(x + e, z) - T.height(x - e, z);
      const hz = T.height(x, z + e) - T.height(x, z - e);
      let n = [-hx, 2 * e, -hz];
      const l = Math.hypot(...n);
      n = n.map((v) => v / l);
      pos.push(x, h, z);
      nrm.push(...n);
      col.push(...T.weights(x, z, h, n[1], D[j * V + i]));
    }
  // holes that reach into this chunk
  const cut = holes.filter((h) => h.render.x1 > x0 && h.render.x0 < x0 + CHUNK && h.render.z1 > z0 && h.render.z0 < z0 + CHUNK);
  let skipped = 0;
  for (let j = 0; j < N; j++)
    for (let i = 0; i < N; i++) {
      if (cut.length && inRenderHole(cut, x0 + (i + 0.5) * spacing, z0 + (j + 0.5) * spacing)) {
        skipped++;
        continue;
      }
      const a = j * V + i, b = a + 1, c = a + V + 1, d = a + V;
      // CCW seen from above (+Y) in a right-handed frame with +Z toward the viewer
      if ((i + j) % 2) idx.push(a, d, c, a, c, b);
      else idx.push(a, d, b, b, d, c);
    }
  // skirts
  const skirt = Math.max(2, spacing * 0.8);
  const edge = (list) => {
    const start = pos.length / 3;
    for (const k of list) {
      pos.push(pos[k * 3], pos[k * 3 + 1] - skirt, pos[k * 3 + 2]);
      nrm.push(nrm[k * 3], nrm[k * 3 + 1], nrm[k * 3 + 2]);
      col.push(col[k * 4], col[k * 4 + 1], col[k * 4 + 2], col[k * 4 + 3]);
    }
    for (let t = 0; t < list.length - 1; t++) {
      const a = list[t], b = list[t + 1], a2 = start + t, b2 = start + t + 1;
      // double-sided by emitting both windings (cheap: skirts are few triangles)
      idx.push(a, b, b2, a, b2, a2, a, b2, b, a, a2, b2);
    }
  };
  const row = (j) => Array.from({ length: V }, (_, i) => j * V + i);
  const colm = (i) => Array.from({ length: V }, (_, j) => j * V + i);
  edge(row(0));
  edge(row(N));
  edge(colm(0));
  edge(colm(N));
  return {
    name,
    spacing,
    x0,
    z0,
    positions: new Float32Array(pos),
    normals: new Float32Array(nrm),
    colors: new Float32Array(col),
    indices: idx,
    heights: H,
    res: V,
    /** ids of the holes cut into this chunk, and how many quads they removed */
    holes: cut.map((h) => h.id),
    skippedQuads: skipped,
  };
}
