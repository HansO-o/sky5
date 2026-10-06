// Asset build: turns assets-src/ + procedural generators into content-hashed files in
// public/assets/ and writes public/manifest.json (+ src/generated/credits.json).
//
//   node tools/build-assets.mjs            build everything
//   node tools/build-assets.mjs --only=cart/fir  rebuild matching ids (others are reused from the old manifest)
//   node tools/build-assets.mjs --only=cart/terrain,keep/  several prefixes, comma-separated
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
import { TERRAIN_HOLES, activeHoles } from "./gen/terrainHoles.mjs";
import { buildKeepInterior, AIR as KEEP_AIR, ORIGIN as KEEP_ORIGIN, MATERIALS as KEEP_MATERIALS } from "./gen/keepinterior.mjs";
import { checkDrainJoin, checkPropsJoin } from "./lib/joins.mjs";
import { buildFirTextures, buildFirMesh, buildImpostor } from "./gen/fir.mjs";
import { buildCart, SEATS, CART } from "./gen/cart.mjs";
import { buildHouse, HOUSE_VARIANTS } from "./gen/houses.mjs";
import { buildTower, buildInn, buildKeep, buildPlatform } from "./gen/townbuildings.mjs";
import { scatter, packScatter } from "./gen/scatter.mjs";
import { buildAudio, AUDIO_STREAMED, audioCredits } from "./gen/audio.mjs";
import { buildCharacters } from "./gen/characters.mjs";
import { EXTRA_CREDITS } from "./credits-extra.mjs";
import { buildDragon } from "./gen/dragon.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");
const SRC = path.join(ROOT, "assets-src");
const OUT = path.join(ROOT, "public/data");
const only = process.argv.find((a) => a.startsWith("--only="))?.slice(7);
const onlyList = only ? only.split(",").filter(Boolean) : [];
/** --only entries that selected a step (the rest are reported: they rebuilt nothing). */
const onlyUsed = new Set();
/**
 * Whether --only selects the step `prefix` or one of its `aliases` (the id prefixes a step emits under
 * other names); a step matches a selected prefix in either direction.
 */
const selected = (prefix, aliases = []) => {
  let hit = false;
  for (const o of onlyList)
    if ([prefix, ...aliases].some((p) => p.startsWith(o) || o.startsWith(p))) {
      onlyUsed.add(o);
      hit = true;
    }
  return hit;
};

const manifest = { version: "", generated: new Date().toISOString(), assets: [] };
// --only reuses every other entry from the last manifest, and the sweep at the end deletes whatever
// the new one doesn't list: without a valid previous manifest that would empty public/data.
let previous = { assets: [] };
if (only) {
  try {
    previous = JSON.parse(await fs.readFile(path.join(ROOT, "public/manifest.json"), "utf8"));
  } catch (e) {
    throw new Error(`--only needs a valid public/manifest.json (${e.message}); run a full build instead`);
  }
  if (!Array.isArray(previous?.assets)) throw new Error("--only needs a valid public/manifest.json (no asset list); run a full build instead");
}

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

/**
 * Skip a step when --only is set and doesn't match; reuse the previous manifest entries instead.
 * `aliases`: other id prefixes the step emits (so --only=<alias> rebuilds it).
 */
async function step(prefix, fn, { aliases = [] } = {}) {
  if (only && !selected(prefix, aliases)) {
    const prev = previous.assets.filter((a) => (a._step ? a._step === prefix : a.id.startsWith(prefix)));
    if (!prev.length) throw new Error(`--only: the previous manifest has nothing for ${prefix}; run a full build instead`);
    for (const a of prev)
      for (const url of [a.url, a.variants?.aac?.url].filter(Boolean))
        await fs.access(path.join(ROOT, "public", url)).catch(() => {
          throw new Error(`--only: ${a.id} would reuse public/${url}, which is missing; run a full build instead`);
        });
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

// Asset ids this build ships that cover a terrain hole (tools/gen/terrainHoles.mjs `cover`). The render
// terrain is cut only under a cover that ships, as the runtime cuts the collider only then
// (activeTerrainHoles); a gate before the manifest is written checks the two agree, against this
// table and against the runtime's own (src/world/terrainHoles.ts). A new cover's id goes here, then
// rebuild cart/terrain. EXIT_HOLE's cover is cave/outcrop (segment muster, shown with the town).
const HOLE_COVERS = new Set(["keep/interior", "cave/outcrop"]);

await step("cart/terrain", async () => {
  const holes = activeHoles((id) => HOLE_COVERS.has(id));
  const chunks = buildTerrainChunks(T, route, holes);
  for (const c of chunks) if (c.holes.length) console.log(`  ${c.name}: hole ${c.holes.join("+")} skips ${c.skippedQuads} quads (${c.spacing} m grid)`);
  const doc = new Document();
  doc.createBuffer();
  const scene = doc.createScene("terrain");
  const mat = doc.createMaterial("terrain").setRoughnessFactor(0.95).setMetallicFactor(0);
  for (const c of chunks) {
    const mesh = doc.createMesh(c.name).addPrimitive(makePrimitive(doc, c, mat));
    scene.addChild(doc.createNode(c.name).setMesh(mesh));
  }
  const glb = await finalize(doc);
  const terrain = await emit("cart/terrain", { segment: "cart", priority: 100, type: "glb", ext: "glb", data: glb });
  terrain._holes = holes.map((h) => h.id);
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
  const node = (name, parts, parent = scene) => {
    const mesh = doc.createMesh(name);
    for (const [mb, m] of parts) if (mb.i.length) mesh.addPrimitive(makePrimitive(doc, mb.toGeometry(), m));
    const n = doc.createNode(name).setMesh(mesh);
    parent.addChild(n);
    return n;
  };
  const t = buildTower();
  node("tower", [[t.stone, towerStone], [t.wood, floor]]);
  node("tower_breach", [[t.breach, towerStone]]);
  const i = buildInn();
  node("inn", [[i.timber, timber], [i.stone, footing], [i.wood, floor], [i.thatch, thatch], [i.dark, dark]]);
  // keep: a mesh-less group at the keep-local origin, so the town loader (which recentres a piece on
  // its node's position) places it exactly: keep_shell, plus the postern leaf under its hinge node
  const k = buildKeep();
  const keepGroup = doc.createNode("keep");
  scene.addChild(keepGroup);
  node("keep_shell", [[k.stone, keepStone], [k.dark, dark]], keepGroup);
  const posternWood = await mat("postern_wood", "dark_wooden_planks", 512);
  const posternIron = await mat("postern_iron", "rusty_metal_02", 256, { metal: 1 });
  const postern = doc.createNode("keep_postern").setTranslation(k.postern.hinge);
  keepGroup.addChild(postern);
  node("keep_postern_leaf", [[k.postern.wood, posternWood], [k.postern.iron, posternIron]], postern);
  const p = buildPlatform();
  node("platform", [[p.wood, deck], [p.dark, dark]]);
  node("block", [[p.block, dark]]);
  await emit("town/buildings", { segment: "muster", priority: 96, type: "glb", ext: "glb", data: await finalize(doc), pos: [70, -590] });
});

// ------------------------------------------------------------------ keep interior (segment keep)
// keep/interior (glb: rooms, *_col colliders, door leaves, anchor_* nodes) + keep/anchors (json)
await step("keep/interior", () => buildKeepInterior({ emit, SRC }));

// ------------------------------------------------------------------ cave + balcony outcrop (segments keep, exit, muster)
// cave/mesh_a (zone A, keep), cave/mesh (zones B–E, exit; covers EXIT_HOLE), cave/outcrop (muster,
// shown with the town), cave/anchors (json), cave/tex/* and fx/water_n. Imported lazily: the module
// builds its terrain caches on load (about a second) and only this step needs it.
await step("cave/", async () => (await import("./gen/cave.mjs")).buildCave({ emit, SRC }));

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
  // keep/exit props (design §10.2; placements in props/meta): hall cover tables, the cave camp fire, and
  // the outcrop brow, which is shown with the town like cave/outcrop (streamed in muster, see STREAMED)
  wooden_table_02: { ratio: 1, tex: 512, segment: "keep", priority: 90, pos: [60, -662] },
  stone_fire_pit: { ratio: 0.5, tex: 512, segment: "keep", priority: 88, pos: [53.5, -724] },
  rock_face_02: { ratio: 0.15, error: 0.01, tex: 1024, segment: "muster", priority: 60, pos: [-19, -675] },
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

// ------------------------------------------------------------------ props (segments keep, exit)
// kit/fpm (the Quaternius Fantasy Props MegaKit, merged), procprops/keep + procprops/exit (procedural:
// the gallery drawbridge set piece, cage, shackles, cuffs, bow, torches, ...) and props/meta (json:
// how to resolve, attach and place them). Built from the shipped cave and keep anchors (the steps
// above, built or reused); a gate below checks they still match. Imported lazily (it loads cave.mjs).
const readManifestJSON = async (id) => {
  const a = manifest.assets.find((x) => x.id === id);
  return a ? JSON.parse(await fs.readFile(path.join(ROOT, "public", a.url), "utf8")) : null;
};
await step(
  "props/",
  async () => {
    const { buildProps, PROPS_INPUTS } = await import("./gen/props.mjs");
    const entry = (id) => manifest.assets.find((x) => x.id === id);
    for (const id of PROPS_INPUTS) if (!entry(id)) throw new Error(`props/: needs ${id} in the manifest (build cave/ and keep/interior first)`);
    const anchors = { cave: await readManifestJSON("cave/anchors"), keep: await readManifestJSON("keep/anchors") };
    const caveMeshA = await fs.readFile(path.join(ROOT, "public", entry("cave/mesh_a").url));
    await buildProps({ emit, SRC, anchors, caveMeshA, inputs: Object.fromEntries(PROPS_INPUTS.map((id) => [id, entry(id).hash])) });
  },
  { aliases: ["kit/", "procprops/"] },
);

// ------------------------------------------------------------------ dragon + effects
await step("dragon/dragon", () => buildDragon({ emit, SRC }));
await step("fx/", async () => {
  const fx = path.join(SRC, "fx");
  // sprite sheets / sprites with alpha; white masks are tinted at runtime
  const list = [
    ["fx/fire_sheet", "bab_Fire_SpriteSheet2_8x8.png", 1024],
    ["fx/smoke_sheet", "bab_Smoke_SpriteSheet_8x8.png", 1024],
    ["fx/flame", "flame_02.png", 256],
    ["fx/smoke", "smoke_04.png", 256],
    ["fx/spark", "spark_04.png", 128],
    ["fx/scorch", "scorch_01.png", 512],
  ];
  for (const [id, file, size] of list)
    await emit(id, { segment: "dragon", priority: 94, type: "ktx2", ext: "ktx2", data: await toKTX2(await fs.readFile(path.join(fx, file)), { preset: "colorHQ", maxSize: size }) });
});

// ------------------------------------------------------------------ characters + audio
await step("chars/", () => buildCharacters({ emit, SRC }));
await step("audio/", () => buildAudio({ emit, SRC }));

// ------------------------------------------------------------------ creatures (segment exit)
// creatures/spider (Quaternius Easy Enemy Pack, CC0; the FBX converted with assimpjs), creatures/wolf (the
// 0 A.D. wolf, CC BY-SA 3.0, clips merged), creatures/wolf_fur_brown (ktx2). Imported lazily (assimpjs).
await step("creatures/", async () => (await import("./gen/creatures.mjs")).buildCreatures({ emit, SRC }));

await shutdownKtx();
for (const o of onlyList) if (!onlyUsed.has(o)) console.warn(`warning: --only entry "${o}" selected no build step, so it rebuilt nothing (step prefixes: menu/, cart/…, town/buildings, keep/interior, cave/, ph/<id>, props/ (kit/, procprops/), dragon/dragon, fx/, chars/, audio/, creatures/)`);

// ------------------------------------------------------------------ manifest
// Assets not needed to *enter* their segment: they stream in while the segment plays (scenery
// that first appears well ahead of the player). Everything else forms the segment's start pack.
const STREAMED = new Set([
  "ph/mountainside", "ph/rock_face_01", "ph/boulder_01", "ph/rock_moss_set_02", "ph/tree_stump_01",
  "ph/dead_tree_trunk", "audio/music_menu", "audio/music_cart", "audio/amb_forest",
  "ph/wooden_lantern_01", "ph/kite_shield", "ph/rock_face_02",
  "creatures/wolf_fur_brown", // an optional fur swap for creatures/wolf
  // keep/exit music that first plays well into its segment (tools/gen/audio.mjs `streamed`: music_explore,
  // music_spider, music_beast; design §10.6 "plus streamed music")
  ...AUDIO_STREAMED,
]);
for (const a of manifest.assets) {
  if (STREAMED.has(a.id)) a.optional = true;
  else delete a.optional;
}
// AAC fallbacks live only inside their Opus entry's `variants`.
manifest.assets = manifest.assets.filter((a) => !a.id.endsWith("#aac"));
// Terrain holes: the render terrain must be cut exactly where the runtime cuts the collider, i.e.
// under every hole whose cover asset ships (checked before anything is written).
{
  const ids = new Set(manifest.assets.map((a) => a.id));
  const cut = new Set(manifest.assets.find((a) => a.id === "cart/terrain")?._holes ?? []);
  for (const h of TERRAIN_HOLES)
    if (ids.has(h.cover) !== cut.has(h.id))
      throw new Error(
        ids.has(h.cover)
          ? `terrain hole "${h.id}": ${h.cover} ships but cart/terrain was built without the hole; add "${h.cover}" to HOLE_COVERS in tools/build-assets.mjs and rebuild with --only=cart/terrain,...`
          : `terrain hole "${h.id}": cart/terrain cuts it but ${h.cover} does not ship; remove "${h.cover}" from HOLE_COVERS and rebuild cart/terrain`,
      );
  // The runtime opens the collider by its own table (src/world/terrainHoles.ts, activeTerrainHoles): the
  // render cut must agree with that too. Its covers are read from the source; the build warns while
  // they differ from tools/gen/terrainHoles.mjs (mirror the change in src) and fails on a disagreement.
  const ts = await fs.readFile(path.join(ROOT, "src/world/terrainHoles.ts"), "utf8").catch(() => "");
  for (const h of TERRAIN_HOLES) {
    const runtimeCover = new RegExp(`id: "${h.id}",[\\s\\S]*?cover: "([^"]+)"`).exec(ts)?.[1];
    if (!runtimeCover) {
      console.warn(`warning: terrain hole "${h.id}": no cover found in src/world/terrainHoles.ts`);
      continue;
    }
    if (runtimeCover !== h.cover) console.warn(`warning: terrain hole "${h.id}": src/world/terrainHoles.ts names ${runtimeCover} as its cover, tools/gen/terrainHoles.mjs ${h.cover}; mirror the tools table in src`);
    if (ids.has(runtimeCover) !== cut.has(h.id))
      throw new Error(`terrain hole "${h.id}": the runtime ${ids.has(runtimeCover) ? "opens" : "keeps closed"} its collider (its cover ${runtimeCover} ${ids.has(runtimeCover) ? "ships" : "does not ship"}), but cart/terrain ${cut.has(h.id) ? "cuts" : "does not cut"} the render terrain there`);
  }
}
// The drain join: cave/ clips the cave to the keep's drain opening (keep/interior's room "drain") as it
// was when cave/ ran. --only can rebuild one step and reuse the other, so the two shipped records must
// agree (else a crack or an overlap at the breach; checked before anything is written).
{
  const readJSON = async (id) => {
    const a = manifest.assets.find((x) => x.id === id);
    return a ? JSON.parse(await fs.readFile(path.join(ROOT, "public", a.url), "utf8")) : null;
  };
  const caveAnchors = await readJSON("cave/anchors"), keepAnchors = await readJSON("keep/anchors");
  if (caveAnchors && keepAnchors) {
    const d = KEEP_AIR.find((a) => a.name === "drain");
    const source = d && { min: d.min.map((v, i) => v + KEEP_ORIGIN[i]), max: d.max.map((v, i) => v + KEEP_ORIGIN[i]) };
    const r = checkDrainJoin(caveAnchors, keepAnchors, source);
    if (!r.ok) throw new Error(r.message);
    console.log(r.message);
  }
  // The props join: props/ placed every prop from the cave and keep anchors and rooms and fitted the
  // gallery set piece to the cave's rock field, as shipped when it ran (props/meta joins.inputs pins
  // their sha256); --only can rebuild either side.
  const propsMeta = await readJSON("props/meta");
  if (propsMeta) {
    const { PROPS_INPUTS } = await import("./gen/props.mjs");
    const r = checkPropsJoin(propsMeta, manifest.assets, PROPS_INPUTS);
    if (!r.ok) throw new Error(r.message);
    console.log(r.message);
  }
}
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
// Segments: every asset's segment must be one the runtime knows (SEGMENTS in src/core/assets/manifest.ts, in
// play order: the downloader ranks by that order), and the build's own order must agree with it.
const PIPELINE_SEGMENTS = ["menu", "cart", "muster", "execution", "dragon", "keep", "exit"];
{
  const ts = await fs.readFile(path.join(ROOT, "src/core/assets/manifest.ts"), "utf8").catch(() => "");
  const list = /export const SEGMENTS = \[([^\]]*)\]/.exec(ts)?.[1];
  const runtime = list ? [...list.matchAll(/"([^"]+)"/g)].map((m) => m[1]) : null;
  if (!runtime) console.warn("warning: no SEGMENTS list found in src/core/assets/manifest.ts; segment order not checked");
  else if (runtime.join() !== PIPELINE_SEGMENTS.join()) console.warn(`warning: src/core/assets/manifest.ts SEGMENTS is [${runtime}], the build expects [${PIPELINE_SEGMENTS}]`);
  const known = new Set(runtime ?? PIPELINE_SEGMENTS);
  const stray = manifest.assets.filter((a) => !known.has(a.segment));
  if (stray.length) throw new Error(`segments: ${stray.map((a) => `${a.id} (${a.segment})`).join(", ")} not in SEGMENTS [${[...known]}]`);
}
// Start-pack budgets (brotli bytes of the non-optional assets, as the summary prints them), design
// keep-exit-chapters.md §10.6. keep: estimated 8.4 MB, limit 15 MB. exit: estimated 2.4 MB plus streamed music;
// the design gives no limit, so 6 MB (2.5x the estimate) catches a regression. Over the limit fails the build
// before the manifest is written; the summary prints each against its estimate and limit.
const START_BUDGETS = { keep: { estimate: 8.4e6, limit: 15e6 }, exit: { estimate: 2.4e6, limit: 6e6 } };
{
  const over = [];
  for (const [s, b] of Object.entries(START_BUDGETS)) {
    const start = summary[s]?.start ?? 0;
    if (start > b.limit) over.push(`${s} ${(start / 1e6).toFixed(2)} MB > ${(b.limit / 1e6).toFixed(1)} MB`);
  }
  if (over.length) throw new Error(`start pack over budget (design §10.6): ${over.join("; ")}; mark scenery or music that is not needed to enter the segment as STREAMED, or shrink it`);
}
// Credits: the entries each shipped asset needs, in tools/credits-extra.mjs (`extra`) and in
// assets-src/credits-polyhaven.json (`ph`). Every shipped id must match a rule (a procedural asset lists the
// third-party sources it reads, or none), and every credit a rule names must exist. A CC BY or CC BY-SA entry must
// say what was modified, a CC BY-SA one also that the modified version keeps the licence (share-alike), and a
// Kevin MacLeod track must carry incompetech's exact credit line. The credits page lists exactly the Poly Haven
// entries the shipped assets need (creditsPH). Checked before anything is written.
const creditsPH = new Set();
{
  const { CAVE_TEX } = await import("./gen/cave.mjs");
  const audioById = new Map();
  for (const c of audioCredits()) audioById.set(c.asset, [...(audioById.get(c.asset) ?? []), c.credit]);
  const RULES = [
    [/^menu\/smoke$/, {}],
    [/^cart\/(route|heightfield|scatter|terrain)$/, {}],
    [/^cart\/tex\/terrain_(\w+)_[dn]$/, (m) => ({ ph: [TERRAIN_LAYERS[m[1]]] })],
    [/^cart\/sky(_env)?$/, { ph: ["kloofendal_overcast_puresky"] }],
    [/^cart\/fir$/, { ph: ["fir_tree_01", "pine_bark"] }],
    [/^cart\/wagon$/, { ph: ["weathered_brown_planks", "rusty_metal_02"] }],
    [/^cart\/houses$/, { ph: ["plastered_stone_wall", "medieval_wood", "thatch_roof_angled", "weathered_brown_planks"] }],
    [/^town\/buildings$/, { ph: ["rough_block_wall", "castle_wall_slates", "old_planks_02", "medieval_wood", "thatch_roof_angled", "plastered_stone_wall", "rough_wood", "weathered_brown_planks", "dark_wooden_planks", "rusty_metal_02"] }],
    [/^keep\/interior$/, { ph: Object.values(KEEP_MATERIALS).flatMap((m) => (m.src ? [m.src] : [])) }],
    // json, and geometry whose materials bind cave/tex/* at runtime
    [/^(keep|cave)\/anchors$|^props\/meta$|^cave\/(mesh|mesh_a|outcrop)$|^fx\/water_n$/, {}],
    [/^cave\/tex\/(\w+)_(d|n|arm)$/, (m) => ({ ph: [CAVE_TEX[m[1]]?.src] })],
    [/^ph\/(.+)$/, (m) => ({ ph: [m[1]] })],
    [/^kit\/fpm$/, { extra: ["quaternius-fpm"] }],
    // tools/gen/procprops.mjs MATS (its rock binds cave/tex/rock_*)
    [/^procprops\/(keep|exit)$/, { ph: ["rusty_metal_02", "dark_wooden_planks", "weathered_planks"] }],
    [/^chars\/(male|female)$/, { extra: ["quaternius-ubc", "quaternius-outfits"] }],
    [/^chars\/anim_\w+$/, { extra: ["quaternius-ual"] }],
    [/^chars\/horse$/, { extra: ["0ad-horse"] }],
    [/^creatures\/spider$/, { extra: ["quaternius-easy-enemies"] }],
    [/^creatures\/wolf(_fur_brown)?$/, { extra: ["0ad-wolf"] }],
    [/^dragon\/dragon$/, { extra: ["dragon"] }],
    [/^fx\/(fire|smoke)_sheet$/, { extra: ["bab-sprites"] }],
    [/^fx\/(flame|smoke|spark|scorch)$/, { extra: ["kenney-particles"] }],
    [/^audio\//, (m, id) => ({ extra: audioById.get(id) })],
  ];
  const extra = new Map(EXTRA_CREDITS.map((c) => [c.id, c]));
  const phAll = new Set(JSON.parse(await fs.readFile(path.join(SRC, "credits-polyhaven.json"), "utf8")).map((c) => c.id));
  const errors = [], used = new Set();
  for (const a of manifest.assets) {
    const rule = RULES.find(([re]) => re.test(a.id));
    if (!rule) {
      errors.push(`${a.id} matches no credits rule (add one to RULES in tools/build-assets.mjs)`);
      continue;
    }
    const need = typeof rule[1] === "function" ? rule[1](rule[0].exec(a.id), a.id) : rule[1];
    if (a.id.startsWith("audio/") && !need.extra?.length) errors.push(`${a.id}: no audio credit (tools/gen/audio.mjs audioCredits)`);
    for (const id of need.extra ?? []) {
      if (!extra.has(id)) errors.push(`${a.id} needs "${id}" in tools/credits-extra.mjs`);
      used.add(id);
    }
    for (const id of need.ph ?? []) {
      if (!id || !phAll.has(id)) errors.push(`${a.id} needs Poly Haven "${id}" in assets-src/credits-polyhaven.json`);
      creditsPH.add(id);
    }
  }
  for (const id of used) {
    const c = extra.get(id);
    if (!c) continue;
    if (/^CC BY/.test(c.license) && !c.note?.includes("修改")) errors.push(`credit "${id}" (${c.license}): its note must say what was modified`);
    if (/^CC BY-SA/.test(c.license) && !c.note?.includes(c.license)) errors.push(`credit "${id}" (${c.license}): its note must say the modified version is under ${c.license} too (share-alike)`);
    if (c.authors.some((n) => n.startsWith("Kevin MacLeod")) && !c.note?.includes(`"${c.name}" Kevin MacLeod (incompetech.com) Licensed under Creative Commons: By Attribution 4.0 https://creativecommons.org/licenses/by/4.0/`))
      errors.push(`credit "${id}": a Kevin MacLeod track needs incompetech's exact credit line in its note`);
  }
  if (errors.length) throw new Error(`credits: ${errors.join("; ")}`);
}
const clean = { ...manifest, assets: manifest.assets.map(({ _br, ...a }) => ({ ...a, _br })) };
await fs.writeFile(path.join(ROOT, "public/manifest.json"), JSON.stringify(clean));
// remove files no longer referenced
const live = new Set(manifest.assets.flatMap((a) => [a.url, a.variants?.aac?.url, a.variants?.opus?.url]).filter(Boolean).map((u) => path.basename(u)));
for (const f of await fs.readdir(OUT)) if (!live.has(f)) await fs.rm(path.join(OUT, f));
console.log("\nsegment summary:");
const total = { files: 0, bytes: 0, br: 0, start: 0 };
const order = [...PIPELINE_SEGMENTS.filter((s) => summary[s]), ...Object.keys(summary).filter((s) => !PIPELINE_SEGMENTS.includes(s))];
for (const [s, v] of [...order.map((s) => [s, summary[s]]), ["total", total]]) {
  if (s !== "total") for (const k of Object.keys(total)) total[k] += v[k];
  const b = START_BUDGETS[s];
  const budget = b ? `  [budget: estimate ${(b.estimate / 1e6).toFixed(1)}, limit ${(b.limit / 1e6).toFixed(1)} MB${v.start > b.estimate ? "; over the estimate" : ""}]` : "";
  console.log(`  ${s.padEnd(10)} ${String(v.files).padStart(4)} files  ${(v.bytes / 1e6).toFixed(2).padStart(7)} MB  (brotli ${(v.br / 1e6).toFixed(2)} MB, start pack ${(v.start / 1e6).toFixed(2)} MB)${budget}`);
}
console.log("manifest version", manifest.version);

// credits page data (only assets that actually ship: the Poly Haven entries the credits gate found them to need)
const ph = JSON.parse(await fs.readFile(path.join(SRC, "credits-polyhaven.json"), "utf8")).filter((c) => creditsPH.has(c.id));
await fs.mkdir(path.join(ROOT, "src/generated"), { recursive: true });
await fs.writeFile(path.join(ROOT, "src/generated/credits.json"), JSON.stringify({ polyhaven: ph, extra: EXTRA_CREDITS }, null, 1));
