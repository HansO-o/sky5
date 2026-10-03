// Procedural Nordic timber houses: stone footing, vertical-plank walls, steep thatch gable roof.
// Local frame: origin at ground centre, ridge along X, door on the +Z side.
import { MeshBuilder } from "../lib/gltf.mjs";
import { box, quad, tri } from "./shapes.mjs";

export const HOUSE_VARIANTS = [
  { w: 8, d: 6, h: 3.0, pitch: 0.95, chimney: true },
  { w: 6.5, d: 5.5, h: 2.8, pitch: 1.0, chimney: false },
  { w: 10, d: 6.5, h: 3.4, pitch: 0.9, chimney: true },
  { w: 5.5, d: 4.5, h: 2.6, pitch: 1.05, chimney: false },
];

export function buildHouse({ w, d, h, pitch, chimney }) {
  const stone = new MeshBuilder();
  const timber = new MeshBuilder();
  const thatch = new MeshBuilder();
  const dark = new MeshBuilder();
  const hw = w / 2, hd = d / 2;
  const foot = 0.7;
  // stone footing (sinks 0.5 m into the ground to sit on uneven terrain)
  box(stone, [0, (foot - 0.5) / 2, 0], [w + 0.3, foot + 0.5, d + 0.3], [0, 0, 0], { tile: 2 });
  // walls
  box(timber, [0, foot + h / 2, 0], [w, h, d], [0, 0, 0], { tile: 1.6 });
  // corner posts and sill beams (darker wood)
  for (const x of [-hw, hw]) for (const z of [-hd, hd]) box(dark, [x, foot + h / 2, z], [0.28, h + 0.05, 0.28], [0, 0, 0], { tile: 1.2 });
  box(dark, [0, foot + h - 0.1, hd + 0.02], [w + 0.1, 0.22, 0.22]);
  box(dark, [0, foot + h - 0.1, -hd - 0.02], [w + 0.1, 0.22, 0.22]);
  // door + frame
  box(dark, [w * 0.15, foot + 1.0, hd + 0.04], [1.1, 2.0, 0.08], [0, 0, 0], { tile: 1 });
  box(dark, [w * 0.15, foot + 2.08, hd + 0.08], [1.4, 0.16, 0.16]);
  // windows: dark recesses with shutters
  for (const x of [-hw * 0.55, hw * 0.6]) {
    if (Math.abs(x - w * 0.15) < 1.2) continue;
    box(dark, [x, foot + 1.6, hd + 0.03], [0.8, 0.7, 0.05]);
    box(dark, [x - 0.62, foot + 1.6, hd + 0.06], [0.42, 0.78, 0.04]);
    box(dark, [x + 0.62, foot + 1.6, hd + 0.06], [0.42, 0.78, 0.04]);
  }
  // gable roof: ridge along X
  const over = 0.5;
  const rise = hd * pitch * 1.25;
  const y0 = foot + h, yr = y0 + rise;
  const ex = hw + over, ez = hd + over * 1.1;
  const yEave = y0 - over * 1.1 * (rise / hd);
  // two slopes (top surfaces), thickness via a second offset surface
  for (const s of [1, -1]) {
    const a = [-ex, yEave, s * ez], b = [ex, yEave, s * ez], c = [ex, yr, 0], dd = [-ex, yr, 0];
    if (s === 1) quad(thatch, a, b, c, dd, { tile: 2 });
    else quad(thatch, b, a, dd, c, { tile: 2 });
    // underside
    const t = 0.25;
    const a2 = [a[0], a[1] - t, a[2]], b2 = [b[0], b[1] - t, b[2]], c2 = [c[0], c[1] - t, c[2]], d2 = [dd[0], dd[1] - t, dd[2]];
    if (s === 1) quad(dark, b2, a2, d2, c2, { tile: 1.5 });
    else quad(dark, a2, b2, c2, d2, { tile: 1.5 });
    // eave edge
    if (s === 1) quad(thatch, a2, b2, b, a, { tile: 2 });
    else quad(thatch, b2, a2, a, b, { tile: 2 });
  }
  // gable triangles (timber)
  for (const sx of [1, -1]) {
    const p0 = [sx * hw, y0, -hd], p1 = [sx * hw, y0, hd], p2 = [sx * hw, yr - 0.05, 0];
    if (sx === 1) tri(timber, p0, p2, p1, { tile: 1.6 });
    else tri(timber, p1, p2, p0, { tile: 1.6 });
    // gable end boards on the roof edge
    for (const sz of [1, -1]) {
      const len = Math.hypot(ez, yr - yEave);
      const ang = Math.atan2(yr - yEave, ez);
      box(dark, [sx * (ex + 0.02), (yEave + yr) / 2, (sz * ez) / 2], [0.06, 0.3, len], [sz * ang, 0, 0]);
    }
  }
  // ridge beam
  box(dark, [0, yr + 0.05, 0], [w + over * 2 + 0.2, 0.22, 0.22]);
  if (chimney) box(stone, [-hw * 0.5, yr - 0.2, -hd * 0.25], [0.8, 2.0, 0.8], [0, 0, 0], { tile: 1.5 });
  return { stone, timber, thatch, dark };
}
