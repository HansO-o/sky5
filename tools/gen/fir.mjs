// Procedural fir trees built from Poly Haven's fir_tree_01 twig atlas (CC0).
// 1. Cut individual sprigs out of the atlas (connected components of the alpha mask).
// 2. Compose full branch cards (sprigs arranged along a stem) into a 1024x1024 RGBA atlas.
// 3. Build tree meshes from drooping branch cards around a bark trunk, plus a far-LOD impostor.
import sharp from "sharp";
import path from "node:path";
import { rng } from "./world.mjs";
import { MeshBuilder } from "../lib/gltf.mjs";

const SRC = path.resolve(import.meta.dirname, "../../assets-src/textures/fir_tree_01");

async function loadRGBA(file, size) {
  const { data, info } = await sharp(file).resize(size, size).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data, w: info.width, h: info.height };
}

/** Find sprig bounding boxes: connected components of alpha > 0.5 in the upper 80% of the atlas. */
function findSprigs(alpha, w, h) {
  const seen = new Uint8Array(w * h);
  const boxes = [];
  const stack = [];
  for (let y = 0; y < h * 0.82; y++)
    for (let x = Math.floor(w * 0.3); x < w; x++) {
      const i = y * w + x;
      if (seen[i] || alpha[i * 4] < 128) continue;
      let minx = x, maxx = x, miny = y, maxy = y, count = 0;
      stack.push(i);
      seen[i] = 1;
      while (stack.length) {
        const j = stack.pop();
        const jx = j % w, jy = (j / w) | 0;
        count++;
        if (jx < minx) minx = jx;
        if (jx > maxx) maxx = jx;
        if (jy < miny) miny = jy;
        if (jy > maxy) maxy = jy;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [2, 0], [-2, 0], [0, 2], [0, -2]]) {
          const nx = jx + dx, ny = jy + dy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          const k = ny * w + nx;
          if (!seen[k] && alpha[k * 4] >= 128) {
            seen[k] = 1;
            stack.push(k);
          }
        }
      }
      if (count > 400 && maxy < h * 0.85) boxes.push({ x: minx, y: miny, w: maxx - minx + 1, h: maxy - miny + 1, count });
    }
  return boxes.sort((a, b) => b.count - a.count);
}

/** Cut a sprig as an RGBA PNG (tip pointing up in the source). */
async function cutSprig(diff, alpha, b, W) {
  const buf = Buffer.alloc(b.w * b.h * 4);
  for (let y = 0; y < b.h; y++)
    for (let x = 0; x < b.w; x++) {
      const si = ((b.y + y) * W + b.x + x) * 4;
      const di = (y * b.w + x) * 4;
      buf[di] = diff.data[si];
      buf[di + 1] = diff.data[si + 1];
      buf[di + 2] = diff.data[si + 2];
      buf[di + 3] = alpha.data[si];
    }
  return sharp(buf, { raw: { width: b.w, height: b.h, channels: 4 } }).png().toBuffer();
}

/**
 * Compose one branch card (W x H, stem along +x from the left edge, centred vertically).
 * Sprigs are rotated so their tips point outward/forward, alternating sides.
 */
async function composeBranch(sprigs, W, H, seed) {
  const R = rng(seed);
  const layers = [];
  // stem
  const stem = Buffer.from(
    `<svg width="${W}" height="${H}"><path d="M0 ${H / 2} Q ${W * 0.5} ${H / 2 + 6} ${W * 0.97} ${H / 2 - 4}" stroke="#4a3a28" stroke-width="7" fill="none" stroke-linecap="round"/></svg>`,
  );
  layers.push({ input: stem, left: 0, top: 0 });
  const n = 15;
  for (let k = 0; k < n; k++) {
    const t = 0.06 + (k / (n - 1)) * 0.86;
    const side = k % 2 === 0 ? -1 : 1;
    const s = sprigs[Math.floor(R() * Math.min(sprigs.length, 5))];
    const scale = (0.52 - t * 0.22) * (0.85 + R() * 0.3);
    const meta = await sharp(s).metadata();
    const sh = Math.round(H * scale * 1.15);
    const sw = Math.max(8, Math.round((meta.width / meta.height) * sh));
    // Sprig tip points up in the source with its base at the bottom centre. Rotate clockwise by
    // theta so the tip points forward along the stem and out to one side, then place it so the
    // rotated base sits on the stem.
    const alpha = 32 + R() * 26;
    const theta = 90 + side * (90 - alpha);
    const rotated = await sharp(await sharp(s).resize(sw, sh).png().toBuffer())
      .rotate(theta, { background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png()
      .toBuffer();
    const rm = await sharp(rotated).metadata();
    const th = (theta * Math.PI) / 180;
    const bx = 0, by = sh / 2 - sh * 0.04; // base offset from sprig centre (y down)
    const rbx = bx * Math.cos(th) - by * Math.sin(th), rby = bx * Math.sin(th) + by * Math.cos(th);
    const cx = t * W, cy = H / 2 + (t - 0.5) * 4;
    const left = Math.round(cx - rbx - rm.width / 2);
    const top = Math.round(cy - rby - rm.height / 2);
    layers.push({ input: rotated, left: Math.max(-rm.width + 1, left), top });
  }
  // terminal sprig at the tip
  const tip = sprigs[0];
  const tipH = Math.round(H * 0.55);
  const tipMeta = await sharp(tip).metadata();
  const tipW = Math.round((tipMeta.width / tipMeta.height) * tipH);
  const tipImg = await sharp(await sharp(tip).resize(tipW, tipH).png().toBuffer()).rotate(90, { background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer();
  const tm = await sharp(tipImg).metadata();
  layers.push({ input: tipImg, left: Math.round(W - tm.width), top: Math.round(H / 2 - tm.height / 2) });

  // Composite on a transparent canvas, clipping layers that fall outside.
  const clipped = [];
  for (const l of layers) {
    const m = await sharp(l.input).metadata();
    const x0 = Math.max(0, l.left), y0 = Math.max(0, l.top);
    const x1 = Math.min(W, l.left + m.width), y1 = Math.min(H, l.top + m.height);
    if (x1 <= x0 || y1 <= y0) continue;
    const input = await sharp(l.input).extract({ left: x0 - l.left, top: y0 - l.top, width: x1 - x0, height: y1 - y0 }).png().toBuffer();
    clipped.push({ input, left: x0, top: y0 });
  }
  return sharp({ create: { width: W, height: H, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite(clipped)
    .png()
    .toBuffer();
}

/** Fill transparent texels with nearby colour so mipmaps don't bleed black into the edges. */
async function dilate(png) {
  const { data, info } = await sharp(png).raw().toBuffer({ resolveWithObject: true });
  const blurred = await sharp(png).flatten({ background: "#3d4a2a" }).blur(12).raw().toBuffer();
  for (let i = 0; i < info.width * info.height; i++) {
    const a = data[i * 4 + 3] / 255;
    for (let c = 0; c < 3; c++) data[i * 4 + c] = Math.round(data[i * 4 + c] * a + blurred[i * 3 + c] * (1 - a));
  }
  return sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } }).png().toBuffer();
}

/** Builds the branch atlas (2 branch variants stacked vertically) and the impostor image. */
export async function buildFirTextures() {
  const S = 2048;
  const diff = await loadRGBA(path.join(SRC, "twig_diff.jpg"), S);
  const alpha = await loadRGBA(path.join(SRC, "twig_alpha.jpg"), S);
  const green = (b) => {
    let r = 0, g = 0;
    for (let y = b.y; y < b.y + b.h; y += 2)
      for (let x = b.x; x < b.x + b.w; x += 2) {
        const i = (y * S + x) * 4;
        if (alpha.data[i] < 128) continue;
        r += diff.data[i];
        g += diff.data[i + 1];
      }
    return g > r * 1.08;
  };
  const boxes = findSprigs(alpha.data, S, S).filter(green).slice(0, 7);
  if (boxes.length < 3) throw new Error("could not find sprigs in twig atlas");
  const sprigs = [];
  for (const b of boxes) sprigs.push(await cutSprig(diff, alpha, b, S));

  const W = 1024, H = 512;
  const b0 = await composeBranch(sprigs, W, H, 11);
  const b1 = await composeBranch(sprigs, W, H, 23);
  const atlas = await sharp({ create: { width: W, height: H * 2, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([
      { input: b0, left: 0, top: 0 },
      { input: b1, left: 0, top: H },
    ])
    .png()
    .toBuffer();

  // Impostor: front view of a fir silhouette (512x1024), branches mirrored left/right per whorl.
  const IW = 512, IH = 1024;
  const R = rng(5);
  const layers = [
    {
      input: Buffer.from(`<svg width="${IW}" height="${IH}"><path d="M${IW / 2 - 9} ${IH} L${IW / 2 - 2} 40 L${IW / 2 + 2} 40 L${IW / 2 + 9} ${IH} Z" fill="#3b2c20"/></svg>`),
      left: 0,
      top: 0,
    },
  ];
  layers.push({
    input: Buffer.from(`<svg width="${IW}" height="${IH}"><defs><radialGradient id="g" cx="50%" cy="60%" r="60%"><stop offset="0" stop-color="#1f2a17"/><stop offset="1" stop-color="#2c3a20"/></radialGradient></defs><path d="M${IW / 2} ${IH * 0.06} L${IW * 0.3} ${IH * 0.88} Q${IW / 2} ${IH * 0.92} ${IW * 0.7} ${IH * 0.88} Z" fill="url(#g)"/></svg>`),
    left: 0,
    top: 0,
  });
  const whorls = 40;
  for (let k = 0; k < whorls; k++) {
    const t = k / (whorls - 1); // 0 bottom .. 1 top
    const y = IH * 0.93 - t * IH * 0.88;
    const len = Math.max(30, (1 - t) * IW * 0.52 * (0.8 + R() * 0.35));
    const hgt = Math.round(len * 0.55);
    const src = k % 2 ? b0 : b1;
    const right = await sharp(src).resize(Math.round(len), hgt, { fit: "fill" }).rotate(8 + R() * 14, { background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer();
    const left = await sharp(right).flop().png().toBuffer();
    const rm = await sharp(right).metadata();
    layers.push({ input: right, left: Math.round(IW / 2 - 4), top: Math.round(y - rm.height / 2) });
    layers.push({ input: left, left: Math.round(IW / 2 + 4 - rm.width), top: Math.round(y - rm.height / 2) });
  }
  const clipped = [];
  for (const l of layers) {
    const m = await sharp(l.input).metadata();
    const x0 = Math.max(0, l.left), y0 = Math.max(0, l.top);
    const x1 = Math.min(IW, l.left + m.width), y1 = Math.min(IH, l.top + m.height);
    if (x1 <= x0 || y1 <= y0) continue;
    clipped.push({ input: await sharp(l.input).extract({ left: x0 - l.left, top: y0 - l.top, width: x1 - x0, height: y1 - y0 }).png().toBuffer(), left: x0, top: y0 });
  }
  const impostor = await sharp({ create: { width: IW, height: IH, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).composite(clipped).png().toBuffer();
  return { atlas: await dilate(atlas), impostor: await dilate(impostor) };
}

/**
 * Fir mesh. Returns { trunk: MeshBuilder, foliage: MeshBuilder } in metres, base at origin.
 * Foliage normals are bent away from the trunk axis for soft, volumetric shading.
 */
export function buildFirMesh({ height = 18, seed = 1, lod = 0 }) {
  const R = rng(seed);
  const trunk = new MeshBuilder();
  const foliage = new MeshBuilder();
  // trunk: tapered cylinder
  const sides = lod ? 5 : 8, rings = lod ? 3 : 6, r0 = height * 0.022;
  for (let j = 0; j <= rings; j++) {
    const t = j / rings;
    const y = t * height * 0.97;
    const r = r0 * (1 - t * 0.92) * (j === 0 ? 1.35 : 1);
    for (let i = 0; i <= sides; i++) {
      const a = (i / sides) * Math.PI * 2;
      const c = Math.cos(a), s = Math.sin(a);
      trunk.vertex([c * r, y, s * r], [c, 0.15, s], [(i / sides) * 2, y / 1.5]);
    }
  }
  for (let j = 0; j < rings; j++)
    for (let i = 0; i < sides; i++) {
      const a = j * (sides + 1) + i, b = a + 1, c = a + sides + 2, d = a + sides + 1;
      trunk.quad(a, d, c, b);
    }

  // branches
  const crownBase = height * (0.12 + R() * 0.06);
  const whorlCount = lod ? 9 : 17;
  for (let w = 0; w < whorlCount; w++) {
    const t = w / (whorlCount - 1);
    const y = crownBase + t * (height * 0.96 - crownBase);
    const rel = (y - crownBase) / (height - crownBase);
    const len = Math.max(0.5, (1 - rel) ** 0.95 * height * 0.3 * (0.85 + R() * 0.25));
    const n = (lod ? 4 : 6) + Math.floor(R() * 2) - (rel > 0.8 ? 2 : 0);
    const phase = R() * Math.PI * 2;
    for (let k = 0; k < n; k++) {
      const a = phase + (k / n) * Math.PI * 2 + (R() - 0.5) * 0.5;
      addBranch(foliage, a, y, len, R, lod);
    }
  }
  // leader: two crossed vertical cards at the top
  const topY = height * 0.9, topH = height * 0.14;
  for (const a of [0, Math.PI / 2]) {
    const dx = Math.cos(a) * topH * 0.35, dz = Math.sin(a) * topH * 0.35;
    const v = (vtx, uv) => foliage.vertex(vtx, [Math.cos(a + Math.PI / 2), 0.3, Math.sin(a + Math.PI / 2)], uv, [1, 1, 1, 1]);
    // card texture: stem along u; use variant row 0, rotate so tip goes up
    const p0 = v([-dx, topY, -dz], [0, 0]);
    const p1 = v([dx, topY, dz], [0, 0.5]);
    const p2 = v([dx, topY + topH, dz], [1, 0.5]);
    const p3 = v([-dx, topY + topH, -dz], [1, 0]);
    foliage.quad(p0, p1, p2, p3);
  }
  return { trunk, foliage };
}

/** One drooping, slightly V-folded branch card. */
function addBranch(mb, angle, y, len, R, lod) {
  const segs = lod ? 2 : 4;
  const width = len * 0.55;
  const droop = 0.25 + R() * 0.35; // metres of drop per metre at tip, quadratic
  const lift = 0.15 + R() * 0.1;
  const variant = R() < 0.5 ? 0 : 0.5;
  const dir = [Math.cos(angle), Math.sin(angle)];
  const side = [-dir[1], dir[0]];
  const fold = width * 0.18; // V fold: card edges raised
  const base = mb.vertexCount;
  for (let s = 0; s <= segs; s++) {
    const t = s / segs;
    const along = t * len;
    const yy = y + along * lift - droop * along * along / Math.max(len, 1);
    const cx = dir[0] * along, cz = dir[1] * along;
    for (let e = 0; e <= 2; e++) {
      const across = (e - 1) * width * 0.5 * (0.35 + 0.65 * Math.min(1, t * 2.2));
      const raise = e === 1 ? 0 : fold * t;
      const px = cx + side[0] * across, pz = cz + side[1] * across;
      // bent normal: mostly up, tilted outward from the trunk
      const nx = dir[0] * 0.55, nz = dir[1] * 0.55, ny = 0.85;
      const u = t;
      const v = variant + (e / 2) * 0.5;
      // ambient term in vertex colour alpha: darker near trunk / inner crown
      const ao = 0.55 + 0.45 * t;
      mb.vertex([px, yy + raise, pz], [nx, ny, nz], [u, v], [ao, ao, ao, 1]);
    }
  }
  for (let s = 0; s < segs; s++)
    for (let e = 0; e < 2; e++) {
      const a = base + s * 3 + e, b = a + 1, c = a + 4, d = a + 3;
      mb.quad(a, b, c, d); // faces up (+Y)
    }
}

/** Impostor: two crossed quads, base at origin. */
export function buildImpostor(height) {
  const mb = new MeshBuilder();
  const w = height * 0.5;
  for (const a of [0, Math.PI / 2]) {
    const dx = Math.cos(a) * w * 0.5, dz = Math.sin(a) * w * 0.5;
    const n = [Math.cos(a + Math.PI / 2), 0.4, Math.sin(a + Math.PI / 2)];
    const p0 = mb.vertex([-dx, 0, -dz], n, [0, 1], [1, 1, 1, 1]);
    const p1 = mb.vertex([dx, 0, dz], n, [1, 1], [1, 1, 1, 1]);
    const p2 = mb.vertex([dx, height, dz], n, [1, 0], [1, 1, 1, 1]);
    const p3 = mb.vertex([-dx, height, -dz], n, [0, 0], [1, 1, 1, 1]);
    mb.quad(p0, p1, p2, p3);
  }
  return mb;
}
