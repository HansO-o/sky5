// Asset build: turns assets-src/ + procedural generators into content-hashed files in
// public/assets/ and writes public/manifest.json (+ src/generated/credits.json).
//
//   node tools/build-assets.mjs            build everything
//   node tools/build-assets.mjs --only=cart/fir  rebuild matching ids (others are reused from the old manifest)
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import zlib from "node:zlib";
import sharp from "sharp";
import { Document } from "@gltf-transform/core";
import { io, compressTextures, finalize, ktxTexture, makePrimitive, pbr, MeshBuilder, simplifyPermissive } from "./lib/gltf.mjs";
import { toKTX2, shutdownKtx } from "./lib/ktx.mjs";
import { readHDR, downsample, writeHDR } from "./lib/hdr.mjs";
import { buildRoute, makeTerrain, fbm } from "./gen/world.mjs";
import { buildTerrainChunks } from "./gen/terrain.mjs";
import { buildFirTextures, buildFirMesh, buildImpostor } from "./gen/fir.mjs";
import { buildCart, SEATS, CART } from "./gen/cart.mjs";
import { buildHouse, HOUSE_VARIANTS } from "./gen/houses.mjs";
import { buildTower, buildInn, buildKeep, buildPlatform } from "./gen/townbuildings.mjs";
import { scatter, packScatter } from "./gen/scatter.mjs";
import { buildAudio } from "./gen/audio.mjs";
import { buildCharacters } from "./gen/characters.mjs";
import { EXTRA_CREDITS } from "./credits-extra.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");
const SRC = path.join(ROOT, "assets-src");
const OUT = path.join(ROOT, "public/data");
const only = process.argv.find((a) => a.startsWith("--only="))?.slice(7);

const manifest = { version: "", generated: new Date().toISOString(), assets: [] };
let previous = { assets: [] };
try {
  previous = JSON.parse(await fs.readFile(path.join(ROOT, "public/manifest.json"), "utf8"));
} catch {}

await fs.mkdir(OUT, { recursive: true });

const sha = (buf) => crypto.createHash("sha256").update(buf).digest("hex");

let currentStep = "";
/** Register an output file. */
async function emit(id, { segment, priority = 50, type, ext, data, pos, variants }) {
  const hash = sha(data);
  const file = `${hash.slice(0, 16)}.${ext}`;
  await fs.writeFile(path.join(OUT, file), data);
  const e = { id, url: `data/${file}`, hash, size: data.length, type, segment, priority, _step: currentStep };
  if (pos) e.pos = pos;
  if (variants) e.variants = variants;
  manifest.assets.push(e);
  const br = zlib.brotliCompressSync(data, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 9 } }).length;
  e._br = br;
  console.log(`  ${id.padEnd(34)} ${(data.length / 1024).toFixed(0).padStart(7)} KB  (br ${(br / 1024).toFixed(0)} KB)`);
  return e;
}

/** Skip a step when --only is set and doesn't match; reuse the previous manifest entries instead. */
async function step(prefix, fn) {
  if (only && !prefix.startsWith(only) && !only.startsWith(prefix)) {
    const prev = previous.assets.filter((a) => (a._step ? a._step === prefix : a.id.startsWith(prefix)));
    manifest.assets.push(...prev);
    return;
  }
  currentStep = prefix;
  console.log(`[${prefix}]`);
  const t = performance.now();
  await fn();
  console.log(`  -> ${((performance.now() - t) / 1000).toFixed(1)}s`);
}

// ------------------------------------------------------------------ menu
await step("menu/", async () => {
  // soft smoke puff sprite, 256x256 RGBA
  const S = 256;
  const buf = Buffer.alloc(S * S * 4);
  for (let y = 0; y < S; y++)
    for (let x = 0; x < S; x++) {
      const u = (x / S) * 2 - 1, v = (y / S) * 2 - 1;
      const r = Math.hypot(u, v);
      const n = fbm(x / 40, y / 40, 5, 3) * 0.5 + 0.5;
      const a = Math.max(0, 1 - r) ** 1.6 * (0.35 + 0.9 * n);
      const i = (y * S + x) * 4;
      const c = 200 + n * 55;
      buf[i] = c;
      buf[i + 1] = c;
      buf[i + 2] = c;
      buf[i + 3] = Math.min(255, a * 255);
    }
  const png = await sharp(buf, { raw: { width: S, height: S, channels: 4 } }).png().toBuffer();
  await emit("menu/smoke", { segment: "menu", priority: 100, type: "ktx2", ext: "ktx2", data: await toKTX2(png, { preset: "color" }) });
});

// ------------------------------------------------------------------ cart: world data
const route = buildRoute();
const T = makeTerrain(route);

await step("cart/route", async () => {
  const r = { step: 1, x: [], y: [], z: [] };
  for (const p of route) {
    r.x.push(+p.x.toFixed(2));
    r.y.push(+p.y.toFixed(2));
    r.z.push(+p.z.toFixed(2));
  }
  await emit("cart/route", { segment: "cart", priority: 100, type: "json", ext: "json", data: Buffer.from(JSON.stringify(r)) });
});

await step("cart/terrain", async () => {
  const chunks = buildTerrainChunks(T, route);
  const doc = new Document();
  doc.createBuffer();
  const scene = doc.createScene("terrain");
  const mat = doc.createMaterial("terrain").setRoughnessFactor(0.95).setMetallicFactor(0);
  for (const c of chunks) {
    const mesh = doc.createMesh(c.name).addPrimitive(makePrimitive(doc, c, mat));
    scene.addChild(doc.createNode(c.name).setMesh(mesh));
  }
  const glb = await finalize(doc);
  await emit("cart/terrain", { segment: "cart", priority: 100, type: "glb", ext: "glb", data: glb });
  // Height field for gameplay queries (2 m grid over the route corridor would be large; ship 4 m over the map).
  const N = 451, half = 900;
  const hf = new Float32Array(N * N);
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) hf[j * N + i] = T.height(-half + i * 4, -half + j * 4);
  const hdr = Buffer.alloc(16);
  hdr.writeUInt32LE(N, 0);
  hdr.writeFloatLE(-half, 4);
  hdr.writeFloatLE(-half, 8);
  hdr.writeFloatLE(4, 12);
  await emit("cart/heightfield", { segment: "cart", priority: 60, type: "bin", ext: "bin", data: Buffer.concat([hdr, Buffer.from(hf.buffer)]) });
});

const TERRAIN_LAYERS = {
  grass: "forrest_ground_01",
  dirt: "forest_ground_04",
  rock: "rocky_terrain_02",
  road: "rocky_trail",
  snow: "snow_02",
};
await step("cart/tex/terrain", async () => {
  await Promise.all(
    Object.entries(TERRAIN_LAYERS).map(async ([layer, src]) => {
      const d = await fs.readFile(path.join(SRC, "textures", src, "Diffuse.jpg"));
      const n = await fs.readFile(path.join(SRC, "textures", src, "nor_gl.jpg"));
      await emit(`cart/tex/terrain_${layer}_d`, { segment: "cart", priority: 95, type: "ktx2", ext: "ktx2", data: await toKTX2(d, { preset: "color", maxSize: 1024 }) });
      await emit(`cart/tex/terrain_${layer}_n`, { segment: "cart", priority: 90, type: "ktx2", ext: "ktx2", data: await toKTX2(n, { preset: "normal", maxSize: 512 }) });
    }),
  );
});

await step("cart/sky", async () => {
  const id = "kloofendal_overcast_puresky";
  const jpg = path.join(SRC, "hdri", id, `${id}_tonemapped.jpg`);
  // upper hemisphere only (v 0..0.5 of the equirect), 4096x1024
  const meta = await sharp(jpg).metadata();
  const top = await sharp(jpg)
    .extract({ left: 0, top: 0, width: meta.width, height: Math.floor(meta.height / 2) })
    .resize(4096, 1024)
    .modulate({ brightness: 0.92, saturation: 0.85 })
    .png()
    .toBuffer();
  await emit("cart/sky", { segment: "cart", priority: 92, type: "ktx2", ext: "ktx2", data: await toKTX2(top, { preset: "sky" }) });
  const hdr = readHDR(await fs.readFile(path.join(SRC, "hdri", id, `${id}.hdr`)));
  await emit("cart/sky_env", { segment: "cart", priority: 92, type: "hdr", ext: "hdr", data: writeHDR(downsample(hdr, 256, 128)) });
});

await step("cart/fir", async () => {
  const { atlas, impostor } = await buildFirTextures();
  const doc = new Document();
  doc.createBuffer();
  const scene = doc.createScene("firs");
  const barkDir = path.join(SRC, "textures/pine_bark");
  const bark = pbr(doc, "bark", {
    color: await ktxTexture(doc, "bark_d", await fs.readFile(path.join(barkDir, "Diffuse.jpg")), "color", 512),
    normal: await ktxTexture(doc, "bark_n", await fs.readFile(path.join(barkDir, "nor_gl.jpg")), "normal", 512),
  });
  const needles = pbr(doc, "needles", {
    color: await ktxTexture(doc, "needles_d", atlas, "colorHQ", 1024),
    rough: 0.8,
    alphaMode: "MASK",
    alphaCutoff: 0.45,
    doubleSided: true,
  });
  const imp = pbr(doc, "fir_impostor", {
    color: await ktxTexture(doc, "fir_impostor_d", impostor, "colorHQ", 512),
    rough: 0.9,
    alphaMode: "MASK",
    alphaCutoff: 0.5,
    doubleSided: true,
  });
  const heights = [17, 21, 14];
  for (let v = 0; v < 3; v++)
    for (const lod of [0, 1]) {
      const { trunk, foliage } = buildFirMesh({ height: heights[v], seed: 100 + v, lod });
      const mesh = doc.createMesh(`fir${v}_lod${lod}`);
      mesh.addPrimitive(makePrimitive(doc, trunk.toGeometry(), bark));
      mesh.addPrimitive(makePrimitive(doc, foliage.toGeometry(), needles));
      scene.addChild(doc.createNode(`fir${v}_lod${lod}`).setMesh(mesh));
    }
  // one impostor mesh, height 1; runtime scales by the variant height
  const im = doc.createMesh("fir_impostor").addPrimitive(makePrimitive(doc, buildImpostor(1).toGeometry(), imp));
  scene.addChild(doc.createNode("fir_impostor").setMesh(im));
  await emit("cart/fir", { segment: "cart", priority: 88, type: "glb", ext: "glb", data: await finalize(doc) });
});

await step("cart/scatter", async () => {
  const { types, trees } = scatter(T, route);
  console.log(`  trees: ${trees}`);
  await emit("cart/scatter", { segment: "cart", priority: 85, type: "bin", ext: "bin", data: packScatter(types) });
});

async function texSet(doc, name, dir, maxSize = 1024) {
  const d = path.join(SRC, "textures", dir);
  const has = async (f) => fs.access(path.join(d, f)).then(() => true, () => false);
  return {
    color: await ktxTexture(doc, `${name}_d`, await fs.readFile(path.join(d, "Diffuse.jpg")), "color", maxSize),
    normal: await ktxTexture(doc, `${name}_n`, await fs.readFile(path.join(d, "nor_gl.jpg")), "normal", maxSize),
    orm: (await has("arm.jpg")) ? await ktxTexture(doc, `${name}_arm`, await fs.readFile(path.join(d, "arm.jpg")), "linear", maxSize / 2) : undefined,
  };
}

await step("cart/wagon", async () => {
  const doc = new Document();
  doc.createBuffer();
  const scene = doc.createScene("wagon");
  const wood = pbr(doc, "wagon_wood", await texSet(doc, "planks", "weathered_brown_planks", 1024));
  const iron = pbr(doc, "wagon_iron", { ...(await texSet(doc, "iron", "rusty_metal_02", 512)), metal: 1 });
  const { wood: w, iron: i, wheel } = buildCart();
  const body = doc.createMesh("cart_body");
  body.addPrimitive(makePrimitive(doc, w.toGeometry(), wood)).addPrimitive(makePrimitive(doc, i.toGeometry(), iron));
  const root = doc.createNode("wagon");
  scene.addChild(root);
  root.addChild(doc.createNode("cart_body").setMesh(body));
  const wm = doc.createMesh("wheel");
  wm.addPrimitive(makePrimitive(doc, wheel.wood.toGeometry(), wood)).addPrimitive(makePrimitive(doc, wheel.iron.toGeometry(), iron));
  for (const [name, x, z] of [
    ["wheel_fl", -CART.track - 0.05, CART.axleFront],
    ["wheel_fr", CART.track + 0.05, CART.axleFront],
    ["wheel_rl", -CART.track - 0.05, CART.axleRear],
    ["wheel_rr", CART.track + 0.05, CART.axleRear],
  ])
    root.addChild(doc.createNode(name).setMesh(wm).setTranslation([x, CART.wheelRadius, z]));
  for (const s of SEATS)
    root.addChild(doc.createNode(s.name).setTranslation(s.p).setRotation([0, Math.sin(s.yaw / 2), 0, Math.cos(s.yaw / 2)]));
  root.addChild(doc.createNode("hitch").setTranslation([0, CART.floorY - 0.1, -CART.length / 2 - 2.6]));
  await emit("cart/wagon", { segment: "cart", priority: 98, type: "glb", ext: "glb", data: await finalize(doc, { keepLeaves: true }) });
});

await step("cart/houses", async () => {
  const doc = new Document();
  doc.createBuffer();
  const scene = doc.createScene("houses");
  const stone = pbr(doc, "house_stone", await texSet(doc, "stone", "plastered_stone_wall", 1024));
  const timber = pbr(doc, "house_timber", await texSet(doc, "timber", "medieval_wood", 1024));
  const thatch = pbr(doc, "house_thatch", await texSet(doc, "thatch", "thatch_roof_angled", 1024));
  const dark = pbr(doc, "house_dark", { ...(await texSet(doc, "darkwood", "weathered_brown_planks", 512)), baseColorFactor: [0.55, 0.5, 0.45, 1] });
  HOUSE_VARIANTS.forEach((v, k) => {
    const h = buildHouse(v);
    const mesh = doc.createMesh(`house_${k}`);
    for (const [mb, m] of [[h.stone, stone], [h.timber, timber], [h.thatch, thatch], [h.dark, dark]]) mesh.addPrimitive(makePrimitive(doc, mb.toGeometry(), m));
    scene.addChild(doc.createNode(`house_${k}`).setMesh(mesh));
  });
  await emit("cart/houses", { segment: "muster", priority: 90, type: "glb", ext: "glb", data: await finalize(doc), pos: [60, -560] });
});

await step("town/buildings", async () => {
  const doc = new Document();
  doc.createBuffer();
  const scene = doc.createScene("buildings");
  const mat = async (name, dir, size = 1024, extra = {}) => pbr(doc, name, { ...(await texSet(doc, name, dir, size)), ...extra });
  const towerStone = await mat("tower_stone", "rough_block_wall");
  const keepStone = await mat("keep_stone", "castle_wall_slates");
  const floor = await mat("floor_planks", "old_planks_02");
  const timber = await mat("inn_timber", "medieval_wood");
  const thatch = await mat("inn_thatch", "thatch_roof_angled");
  const footing = await mat("inn_footing", "plastered_stone_wall");
  const dark = await mat("dark_wood", "rough_wood", 512);
  const deck = await mat("deck_planks", "weathered_brown_planks", 1024);
  const node = (name, parts) => {
    const mesh = doc.createMesh(name);
    for (const [mb, m] of parts) if (mb.i.length) mesh.addPrimitive(makePrimitive(doc, mb.toGeometry(), m));
    scene.addChild(doc.createNode(name).setMesh(mesh));
  };
  const t = buildTower();
  node("tower", [[t.stone, towerStone], [t.wood, floor]]);
  node("tower_breach", [[t.breach, towerStone]]);
  const i = buildInn();
  node("inn", [[i.timber, timber], [i.stone, footing], [i.wood, floor], [i.thatch, thatch], [i.dark, dark]]);
  const k = buildKeep();
  node("keep", [[k.stone, keepStone], [k.dark, dark]]);
  const p = buildPlatform();
  node("platform", [[p.wood, deck], [p.dark, dark]]);
  node("block", [[p.block, dark]]);
  await emit("town/buildings", { segment: "muster", priority: 96, type: "glb", ext: "glb", data: await finalize(doc), pos: [70, -590] });
});

// ------------------------------------------------------------------ Poly Haven models
const PH = {
  boulder_01: { ratio: 0.06, permissive: true, tex: 1024, segment: "cart", priority: 80 },
  rock_moss_set_01: { ratio: 0.12, error: 0.01, tex: 1024, segment: "cart", priority: 80 },
  rock_moss_set_02: { ratio: 0.12, error: 0.01, tex: 1024, segment: "cart", priority: 80 },
  rock_face_01: { ratio: 0.5, tex: 1024, segment: "cart", priority: 75 },
  mountainside: { ratio: 0.06, error: 0.01, tex: 1024, segment: "cart", priority: 75 },
  fern_02: { ratio: 0.5, tex: 512, segment: "cart", priority: 78 },
  tree_stump_01: { ratio: 0.12, permissive: true, tex: 512, segment: "cart", priority: 70 },
  dead_tree_trunk: { ratio: 0.06, permissive: true, tex: 512, segment: "cart", priority: 70 },
  modular_fort_01: { ratio: 1, tex: 1024, segment: "muster", priority: 65, pos: [60, -500] },
  large_castle_door: { ratio: 0.5, tex: 1024, segment: "muster", priority: 60, pos: [60, -500] },
  wooden_barrels_01: { ratio: 0.4, tex: 512, segment: "muster", priority: 55, pos: [60, -540] },
  wooden_crate_01: { ratio: 1, tex: 512, segment: "muster", priority: 55, pos: [60, -540] },
  wooden_lantern_01: { ratio: 0.6, tex: 512, segment: "cart", priority: 70 },
  wooden_bucket_01: { ratio: 1, tex: 512, segment: "muster", priority: 55, pos: [60, -540] },
  kite_shield: { ratio: 0.5, tex: 512, segment: "cart", priority: 72 },
  wicker_basket_01: { ratio: 0.3, tex: 512, segment: "muster", priority: 55, pos: [60, -540] },
  wooden_axe_03: { ratio: 0.5, tex: 512, segment: "muster", priority: 80, pos: [60, -590] },
  wooden_bucket_02: { ratio: 0.6, tex: 512, segment: "muster", priority: 50, pos: [60, -590] },
};
for (const [id, o] of Object.entries(PH)) {
  await step(`ph/${id}`, async () => {
    const doc = await io.read(path.join(SRC, "models", id, `${id}.gltf`));
    await compressTextures(doc, o.tex, Math.min(o.tex, 1024));
    if (o.permissive) await simplifyPermissive(doc, o.ratio);
    const glb = await finalize(doc, { simplifyRatio: o.permissive ? 1 : o.ratio, simplifyError: o.error ?? 0.002 });
    await emit(`ph/${id}`, { segment: o.segment, priority: o.priority, type: "glb", ext: "glb", data: glb, pos: o.pos });
  });
}

// ------------------------------------------------------------------ characters + audio
await step("chars/", () => buildCharacters({ emit, SRC }));
await step("audio/", () => buildAudio({ emit, SRC }));

await shutdownKtx();

// ------------------------------------------------------------------ manifest
// Assets not needed to *enter* their segment: they stream in while the segment plays (scenery
// that first appears well ahead of the player). Everything else forms the segment's start pack.
const STREAMED = new Set([
  "ph/mountainside", "ph/rock_face_01", "ph/boulder_01", "ph/rock_moss_set_02", "ph/tree_stump_01",
  "ph/dead_tree_trunk", "audio/music_menu", "audio/music_cart", "audio/amb_forest",
  "ph/wooden_lantern_01", "ph/kite_shield",
]);
for (const a of manifest.assets) {
  if (STREAMED.has(a.id)) a.optional = true;
  else delete a.optional;
}
// AAC fallbacks live only inside their Opus entry's `variants`.
manifest.assets = manifest.assets.filter((a) => !a.id.endsWith("#aac"));
manifest.assets.sort((a, b) => a.id.localeCompare(b.id));
manifest.version = sha(Buffer.from(JSON.stringify(manifest.assets.map((a) => [a.id, a.hash])))).slice(0, 12);
const summary = {};
for (const a of manifest.assets) {
  summary[a.segment] ??= { files: 0, bytes: 0, br: 0, start: 0 };
  summary[a.segment].files++;
  summary[a.segment].bytes += a.size;
  summary[a.segment].br += a._br ?? a.size;
  if (!a.optional) summary[a.segment].start += a._br ?? a.size;
}
const clean = { ...manifest, assets: manifest.assets.map(({ _br, ...a }) => ({ ...a, _br })) };
await fs.writeFile(path.join(ROOT, "public/manifest.json"), JSON.stringify(clean));
// remove files no longer referenced
const live = new Set(manifest.assets.flatMap((a) => [a.url, a.variants?.aac?.url, a.variants?.opus?.url]).filter(Boolean).map((u) => path.basename(u)));
for (const f of await fs.readdir(OUT)) if (!live.has(f)) await fs.rm(path.join(OUT, f));
console.log("\nsegment summary:");
for (const [s, v] of Object.entries(summary))
  console.log(`  ${s.padEnd(10)} ${String(v.files).padStart(4)} files  ${(v.bytes / 1e6).toFixed(2).padStart(7)} MB  (brotli ${(v.br / 1e6).toFixed(2)} MB, start pack ${(v.start / 1e6).toFixed(2)} MB)`);
console.log("manifest version", manifest.version);

// credits page data (only assets that actually ship)
const phIds = new Set(Object.keys(PH));
for (const k of Object.keys(TERRAIN_LAYERS)) phIds.add(TERRAIN_LAYERS[k]);
["pine_bark", "weathered_brown_planks", "rusty_metal_02", "plastered_stone_wall", "medieval_wood", "thatch_roof_angled", "fir_tree_01", "kloofendal_overcast_puresky", "rough_block_wall", "castle_wall_slates", "old_planks_02", "rough_wood"].forEach((x) => phIds.add(x));
const ph = JSON.parse(await fs.readFile(path.join(SRC, "credits-polyhaven.json"), "utf8")).filter((c) => phIds.has(c.id));
await fs.mkdir(path.join(ROOT, "src/generated"), { recursive: true });
await fs.writeFile(path.join(ROOT, "src/generated/credits.json"), JSON.stringify({ polyhaven: ph, extra: EXTRA_CREDITS }, null, 1));
