import sharp from "sharp";
import { buildRoute, makeTerrain, WORLD_HALF } from "./gen/world.mjs";
const route = buildRoute();
const T = makeTerrain(route);
const N = 360, img = Buffer.alloc(N * N * 3);
let hmin = 1e9, hmax = -1e9;
const H = [];
for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
  const x = -WORLD_HALF + (i / (N - 1)) * 2 * WORLD_HALF, z = -WORLD_HALF + (j / (N - 1)) * 2 * WORLD_HALF;
  const s = T.sample(x, z); H.push(s); hmin = Math.min(hmin, s.h); hmax = Math.max(hmax, s.h);
}
H.forEach((s, k) => {
  const v = (s.h - hmin) / (hmax - hmin);
  let r = v * 255, g = v * 255, b = v * 255;
  if (s.h > 125) { r = g = b = 250; }
  if (s.d < 4) { r = 200; g = 80; b = 30; }
  img[k * 3] = r; img[k * 3 + 1] = g; img[k * 3 + 2] = b;
});
await sharp(img, { raw: { width: N, height: N, channels: 3 } }).png().toFile(process.argv[2]);
console.log("route length", route.length, "m; h range", hmin.toFixed(1), hmax.toFixed(1));
