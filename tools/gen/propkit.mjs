// The Quaternius "Fantasy Props MegaKit [Standard]" (CC0) merged into one kit GLB, `kit/fpm`, so the
// four shared trim texture sets ship once (design §10.2, research/props.md).
//
// Self-contained: model list and licence in tools/sources.mjs (FPM_KIT), sources in
// assets-src/props/fpm (tools/fetch-extra.mjs). Exports buildPropKit({emit, SRC}) for build-assets
// and buildPropKitDoc(SRC) (the document before texture compression, for previews).
//
// Layout of kit/fpm:
// - One top-level node per model, named as FPM_KIT.models (renamed by FPM_KIT.as), all at the origin
//   with an identity transform: instantiate one by name (`kit/fpm#Barrel`).
// - Under it `<Name>_mesh` (the geometry; quantisation moves only this node), anchor empties
//   `<Name>_<anchor>` (flames, slots, seats), and for Chest_Wood a rigid lid on a hinge node.
// - Placeable models are turned to face −Z, the keep and cave anchors' facing convention (an anchor's
//   yaw turns local −Z to the facing). Held items keep the source axes, which the runtime's attach
//   recipes assume (Sword_Bronze: handle +Y, edge +X).
// - The top-level node's glTF extras (Babylon: node.metadata.gltf.extras) describe it: source,
//   triangles, bounds, facing, anchors, and for held items `held` (grip point and a ready attach
//   recipe per hand, checked against the clips by forward kinematics at build time).
//
// Fixes over the source files (research/props.md "Build gotchas"):
// - COLOR_0 on materials not named *_Vertex multiplies wood/metal trims toward black: it becomes a mild
//   grey multiplier (30 % of its luminance deficit), dropped where it is all white.
// - Bronze vertex tints on the weapons are retinted to steel/iron; colours stay VEC3 (no vertex alpha).
// - Every material binds the ORM image as occlusion (R) as well as metal/rough; the palette is muted
//   through baseColorFactor as characters.mjs mutes the outfits.
// - Chest_Wood is rigidly skinned (base 100 % Chest_Bottom, lid 100 % Chest_Top): it ships as rigid
//   nodes with the four clips retargeted to them, renamed Chest_Wood_Open/_Opened/_Close/_Closed.
import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { Document } from "@gltf-transform/core";
import { io, compressTextures, finalize } from "../lib/gltf.mjs";
import { heldRecipe, clipPoses, heldInPose, angleDeg } from "../lib/handheld.mjs";
import { FPM_KIT } from "../sources.mjs";

export const PROPKIT = { id: "kit/fpm", segment: "keep", priority: 92, pos: [60, -662] };

/** Kit materials: which source material names map to each, texture sizes and the palette mute. */
const MATERIALS = {
  furniture: { re: /Furniture/, trim: "T_Trim_Furniture", size: 1024, factor: [0.8, 0.77, 0.73, 1] },
  metal: { re: /Metal/, trim: "T_Trim_Metal", size: 1024, factor: [0.85, 0.85, 0.86, 1] },
  props: { re: /Props/, trim: "T_Trim_Props", size: 1024, factor: [0.9, 0.88, 0.85, 1] },
  cloth: { re: /Cloth/, trim: "T_Trim_Cloth", size: 512, factor: [0.78, 0.76, 0.72, 1] },
  page: { re: /Page/, page: "T_Page_Noise.png", size: 256, factor: [0.95, 0.92, 0.86, 1], metal: 0, rough: 0.85 },
};

/** Bronze tints → steel / iron, leather (exact source colours, matched within 0.02). */
const STEEL = {
  blade: [[0.72, 0.25, 0.01], [0.64, 0.65, 0.68]],
  fittings: [[0.46, 0.18, 0.03], [0.4, 0.41, 0.43]],
  grip: [[0.21, 0.07, 0.04], [0.16, 0.1, 0.07]],
  rim: [[0.28, 0.28, 0.36], [0.3, 0.3, 0.32]],
  boss: [[0.71, 0.6, 0.49], [0.5, 0.5, 0.52]],
};

/**
 * Per model: `turn` (rotate 180° about Y so the front faces −Z), `retint` ([from, to] colour pairs),
 * `anchors` (name → model-space point after the turn, or a function of the bounds), `wall` (the back
 * sits at z = 0: put that plane on the wall), `seat`, `held` (grip and hand axes, see HELD).
 */
const MODELS = {
  Sword_Bronze: { retint: [STEEL.blade, STEEL.fittings, STEEL.grip] },
  Axe_Bronze: { retint: [STEEL.blade] },
  Shield_Wooden: { retint: [STEEL.rim, STEEL.boss] },
  Torch_Metal: { turn: true, wall: true, anchors: { flame: "torch_basket" } },
  Lantern_Wall: { turn: true, wall: true, anchors: { flame: "lantern" } },
  Candle_1: { anchors: { flame: (b) => [0, b.max[1] + 0.02, 0] } },
  Barrel: {},
  Crate_Wooden: { turn: true },
  Crate_Metal: { turn: true },
  Chest_Wood: { turn: true, chest: true, anchors: { loot: [0, 0.32, 0] } },
  Bag: { turn: true },
  Pouch_Large: { turn: true },
  Table_Large: { turn: true, anchors: { top: (b) => [0, b.max[1], 0] } },
  Chair_1: { turn: true, seat: 0.5, anchors: { sit: [0, 0.5, -0.02] } },
  Bench: { turn: true, seat: 0.526, anchors: { sit: [0, 0.526, 0] } },
  Stool: { seat: 0.582, anchors: { sit: [0, 0.582, 0] } },
  Bed_Twin1: { turn: true, anchors: { lie: (b) => [0, b.max[1] - 0.12, 0.1] } },
  // five notches in the top bar (y 0.84): an upright weapon stands at a slot (its lowest point on the
  // slot node, its handle axis +Y, turned 90° so a blade's flat faces along the bar); a shield leans at `lean`
  WeaponStand: {
    turn: true,
    anchors: Object.fromEntries([
      ...[-0.35, -0.17, 0, 0.17, 0.35].map((x, i) => [`slot_${i}`, { at: [x, 0, 0], rotY: Math.PI / 2 }]),
      ["lean", { at: [0, 0, -0.55] }],
    ]),
  },
  Peg_Rack: { turn: true, wall: true },
  Shelf_Small_Bottles: { turn: true, wall: true, anchors: { top_0: [-0.24, 0.628, -0.15], top_1: [0.22, 0.628, -0.15] } },
  Dummy: { turn: true },
  Chain_Coil: {},
  Cage_Small: { turn: true },
  Cauldron: { anchors: { fire: (b) => [0, b.max[1] - 0.08, 0] } },
  Key_Metal: {},
  Potion_1: {},
  Potion_2: {},
  Potion_4: {},
  Bottle_1: {},
  SmallBottle: {},
  SmallBottles_1: { turn: true },
  Scroll_1: {},
  Book_7: { turn: true, rebase: true },
  Mug: { turn: true },
};

/**
 * Held items: `grip` is the model-space point the hand closes around (a function of the measured
 * parts), `hands` the hand axis each model axis goes to (hand +Z = grip axis toward the business end,
 * +Y = toward the fingers), and `check` a clip pose in which a model axis must point a given way
 * (character space: +Y up, +Z forward, +X left), within `deg`.
 */
const HELD = {
  // handle +Y, blade tip up the grip axis, edge (+X) toward the knuckles: the design §3.3 rotation (0.5, 0.5, 0.5, 0.5).
  // The leather grip runs y −0.109…0.076 (a hand-and-a-half grip); one hand sits under the guard.
  Sword_Bronze: {
    grip: (p) => [0, p.grip.max[1] - 0.05, 0],
    hands: { r: { Y: "+Z", X: "+Y" } },
    check: [{ hand: "r", clip: "Sword_Attack", t: 0.4, axis: [0, 1, 0], want: [0, 1, 0], deg: 40, what: "blade up in the overhead swing" }],
  },
  // handle +Y with the head up the grip axis, the blade (−X) toward the knuckles; gripped 0.09 m above the butt
  Axe_Bronze: {
    grip: (p) => [p.handle.mid[0], p.handle.min[1] + 0.09, 0],
    hands: { r: { Y: "+Z", X: "-Y" } },
    check: [{ hand: "r", clip: "Sword_Attack", t: 0.4, axis: [0, 1, 0], want: [0, 1, 0], deg: 40, what: "head up in the overhead swing" }],
  },
  // the vertical bar on the back (+Y along the grip axis); the face (+Z) away from the back of the hand
  Shield_Wooden: {
    grip: (p) => [0, 0, p.handle.min[2] + 0.012],
    hands: { l: { Y: "+Z", Z: "-X" } },
    check: [
      { hand: "l", clip: "Idle_Shield_Loop", t: 0.5, axis: [0, 0, 1], want: [0, 0, 1], deg: 30, what: "face forward in Idle_Shield_Loop" },
      { hand: "l", clip: "Shield_OneShot", t: 0.3, axis: [0, 0, 1], want: [0, 0, 1], deg: 30, what: "face forward in Shield_OneShot" },
    ],
  },
  // potions and the scroll: upright in the hand (tune by eye; no clip pins their roll)
  Potion_2: { grip: (p) => [0, p.all.max[1] * 0.4, 0], hands: { l: { Y: "+Z", X: "+X" }, r: { Y: "+Z", X: "+X" } } },
  Key_Metal: { grip: (p) => [p.all.mid[0], 0, p.all.min[2] + 0.02], hands: { r: { Z: "+Z", Y: "+Y" } } },
};

const near = (a, b, e = 0.02) => Math.abs(a[0] - b[0]) < e && Math.abs(a[1] - b[1]) < e && Math.abs(a[2] - b[2]) < e;
const lum = (c) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];

/** Read every primitive of a source model as plain arrays in model space (node transforms baked, turned). */
function extract(doc, { turn, retint = [], keepColours }) {
  const T = turn ? [-1, 1, -1] : [1, 1, 1];
  const out = [];
  for (const node of doc.getRoot().listNodes()) {
    const mesh = node.getMesh();
    if (!mesh) continue;
    // skinned parts are posed by their (rigid) joint: the chest is handled by the caller via `joint`
    const M = node.getSkin() ? [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1] : node.getWorldMatrix();
    for (const prim of mesh.listPrimitives()) {
      const P = prim.getAttribute("POSITION"), N = prim.getAttribute("NORMAL"), UV = prim.getAttribute("TEXCOORD_0"), C = prim.getAttribute("COLOR_0");
      const J = prim.getAttribute("JOINTS_0");
      const n = P.getCount();
      const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), uv = new Float32Array(n * 2);
      let col = C ? new Float32Array(n * 3) : null;
      const v = [], nn = [], t = [], c = [], j = [];
      let joint = null;
      for (let i = 0; i < n; i++) {
        P.getElement(i, v);
        const w = [0, 1, 2].map((r) => M[r] * v[0] + M[4 + r] * v[1] + M[8 + r] * v[2] + M[12 + r]);
        pos.set([w[0] * T[0], w[1] * T[1], w[2] * T[2]], i * 3);
        N.getElement(i, nn);
        const m = [0, 1, 2].map((r) => M[r] * nn[0] + M[4 + r] * nn[1] + M[8 + r] * nn[2]);
        const l = Math.hypot(...m) || 1;
        nor.set([(m[0] / l) * T[0], (m[1] / l) * T[1], (m[2] / l) * T[2]], i * 3);
        if (UV) uv.set(UV.getElement(i, t), i * 2);
        if (C) {
          C.getElement(i, c);
          let rgb = c.slice(0, 3);
          for (const [from, to] of retint) if (near(rgb, from)) rgb = to;
          col.set(rgb, i * 3);
        }
        if (J) {
          J.getElement(i, j);
          if (joint === null) joint = j[0];
          else if (joint !== j[0]) throw new Error("propkit: a primitive spans two joints (not rigid)");
        }
      }
      const material = prim.getMaterial()?.getName() ?? "";
      const key = Object.keys(MATERIALS).find((k) => MATERIALS[k].re.test(material));
      if (!key) throw new Error(`propkit: no kit material for source material ${material}`);
      // COLOR_0 is a real tint only on *_Vertex materials and the page; elsewhere a mild grey multiplier
      if (col && !keepColours && !/_Vertex/.test(material) && key !== "page") {
        for (let i = 0; i < n; i++) {
          const g = 1 - 0.3 * (1 - Math.min(1, lum(col.subarray(i * 3, i * 3 + 3))));
          col.set([g, g, g], i * 3);
        }
      }
      if (col && col.every((x) => x > 0.995)) col = null;
      const idx = prim.getIndices().getArray();
      // a turn of 180° about Y keeps the winding (det +1)
      out.push({ key, pos, nor, uv, col, idx: Uint32Array.from(idx), joint, srcMaterial: material });
    }
  }
  return out;
}

function bounds(parts, filter = () => true) {
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (const p of parts)
    for (let i = 0; i < p.pos.length; i += 3) {
      if (!filter(p, i / 3)) continue;
      for (let a = 0; a < 3; a++) (min[a] = Math.min(min[a], p.pos[i + a])), (max[a] = Math.max(max[a], p.pos[i + a]));
    }
  return { min, max, mid: min.map((v, a) => (v + max[a]) / 2) };
}

/** Named sub-part bounds the held-item grips and some anchors are measured from. */
function partBounds(name, parts) {
  const colourIs = (rgb) => (p, i) => p.col && near(Array.from(p.col.subarray(i * 3, i * 3 + 3)), rgb);
  const b = { all: bounds(parts) };
  if (name === "Sword_Bronze") b.grip = bounds(parts, colourIs(STEEL.grip[1]));
  if (name === "Axe_Bronze") b.handle = bounds(parts, (p, i) => !p.col || p.col[i * 3] > 0.99);
  if (name === "Shield_Wooden") b.handle = bounds(parts, (p) => p.srcMaterial === "MI_Trim_Props");
  if (name === "Torch_Metal") {
    // the basket: vertices in the top 0.12 m
    const top = b.all.max[1];
    b.torch_basket = bounds(parts, (p, i) => p.pos[i * 3 + 1] > top - 0.12);
  }
  if (name === "Lantern_Wall") {
    // the lantern hangs at the bracket's far end (turned: the most negative z), below the arm
    const far = b.all.min[2];
    b.lantern = bounds(parts, (p, i) => p.pos[i * 3 + 2] < far + 0.3 && p.pos[i * 3 + 1] < b.all.max[1] - 0.25);
  }
  for (const k of Object.keys(b)) if (!Number.isFinite(b[k].min[0])) throw new Error(`propkit: ${name}: part "${k}" matched no vertices`);
  return b;
}

function anchorPoint(spec, b) {
  if (typeof spec === "function") return spec(b.all);
  if (typeof spec === "string") {
    const p = b[spec];
    // flames: centre of the part, at its top
    return [p.mid[0], spec === "lantern" ? p.mid[1] : p.max[1] + 0.03, p.mid[2]];
  }
  return spec;
}

const r3 = (v) => v.map((x) => Math.round(x * 1000) / 1000 + 0);

/**
 * The kit as a gltf-transform Document (PNG textures, not yet compressed) and its metadata.
 * `srcDir`: assets-src/props/fpm.
 */
export async function buildPropKitDoc(SRC, { poses } = {}) {
  const dir = path.join(SRC, "props/fpm");
  const doc = new Document();
  const buffer = doc.createBuffer();
  const scene = doc.createScene("kit_fpm");

  // ---- textures and materials (one per trim set)
  const png = async (file, size) => {
    const buf = await fs.readFile(path.join(dir, file));
    const meta = await sharp(buf).metadata();
    return meta.width > size ? sharp(buf).resize(size, size).png().toBuffer() : buf;
  };
  const tex = async (name, file, size) => doc.createTexture(name).setImage(new Uint8Array(await png(file, size))).setMimeType("image/png").setURI(`${name}.png`);
  const mats = {};
  for (const [key, m] of Object.entries(MATERIALS)) {
    const mat = doc.createMaterial(`fpm_${key}`).setBaseColorFactor(m.factor).setMetallicFactor(m.metal ?? 1).setRoughnessFactor(m.rough ?? 1);
    if (m.page) mat.setBaseColorTexture(await tex(`fpm_${key}_d`, m.page, m.size));
    else {
      const orm = await tex(`fpm_${key}_orm`, `${m.trim}_ORM.png`, Math.min(512, m.size));
      mat.setBaseColorTexture(await tex(`fpm_${key}_d`, `${m.trim}_BaseColor.png`, m.size));
      mat.setNormalTexture(await tex(`fpm_${key}_n`, `${m.trim}_Normal.png`, m.size));
      mat.setMetallicRoughnessTexture(orm).setOcclusionTexture(orm);
    }
    mats[key] = mat;
  }

  const acc = (type, arr) => doc.createAccessor().setType(type).setArray(arr).setBuffer(buffer);
  const meshOf = (name, parts) => {
    const mesh = doc.createMesh(name);
    for (const p of parts) {
      const prim = doc.createPrimitive().setMaterial(mats[p.key]);
      prim.setAttribute("POSITION", acc("VEC3", p.pos)).setAttribute("NORMAL", acc("VEC3", p.nor)).setAttribute("TEXCOORD_0", acc("VEC2", p.uv));
      if (p.col) prim.setAttribute("COLOR_0", acc("VEC3", p.col));
      prim.setIndices(acc("SCALAR", p.pos.length / 3 > 65535 ? p.idx : Uint16Array.from(p.idx)));
      mesh.addPrimitive(prim);
    }
    return mesh;
  };

  const meta = { asset: PROPKIT.id, models: {} };
  poses ??= clipPoses([path.join(SRC, "chars/anim_full/UAL1.glb"), path.join(SRC, "chars/anim_full/UAL2.glb")]);
  const problems = [];
  const seen = new Set();
  for (const src of FPM_KIT.models) {
    const cfg = MODELS[src];
    if (!cfg) throw new Error(`propkit: no config for ${src} (tools/gen/propkit.mjs MODELS)`);
    const name = FPM_KIT.as?.[src] ?? src;
    if (seen.has(name.toLowerCase())) throw new Error(`propkit: duplicate node name ${name}`);
    seen.add(name.toLowerCase());
    const sdoc = await io.read(path.join(dir, `${src}.gltf`));
    const parts = extract(sdoc, cfg);
    if (cfg.rebase) {
      // lay it on y = 0 (the source is centred on its thickness)
      const y0 = bounds(parts).min[1];
      for (const p of parts) for (let i = 1; i < p.pos.length; i += 3) p.pos[i] -= y0;
    }
    const b = partBounds(src, parts);
    const group = doc.createNode(name);
    scene.addChild(group);
    const tris = parts.reduce((s, p) => s + p.idx.length / 3, 0);
    const info = { source: `Fantasy Props MegaKit/${src}`, tris, bbox: { min: r3(b.all.min), max: r3(b.all.max) }, front: cfg.turn ? "-Z" : "source" };
    if (cfg.wall) info.wall = "back at z = 0: put that plane on the wall, facing out (−Z) into the room";
    if (cfg.seat) info.seat = cfg.seat;

    if (cfg.chest) {
      // rigid chest: body (Chest_Bottom) → base mesh + lid hinge (Chest_Top) → lid mesh
      const skin = sdoc.getRoot().listSkins()[0];
      const joints = skin.listJoints();
      const jn = (i) => joints[i].getName();
      const T = [-1, 1, -1];
      const topNode = joints.find((j) => j.getName() === "Chest_Top");
      const hingeAt = topNode.getWorldTranslation().map((v, a) => v * T[a]);
      const base = parts.filter((p) => jn(p.joint) === "Chest_Bottom");
      const lid = parts.filter((p) => jn(p.joint) === "Chest_Top");
      if (base.length + lid.length !== parts.length) throw new Error("propkit: Chest_Wood has parts on other joints");
      for (const p of lid) for (let i = 0; i < p.pos.length; i += 3) for (let a = 0; a < 3; a++) p.pos[i + a] -= hingeAt[a];
      const body = doc.createNode(`${name}_body`);
      const hinge = doc.createNode(`${name}_lid`).setTranslation(hingeAt);
      group.addChild(body);
      body.addChild(doc.createNode(`${name}_mesh`).setMesh(meshOf(`${name}_base`, base)));
      body.addChild(hinge);
      hinge.addChild(doc.createNode(`${name}_lid_mesh`).setMesh(meshOf(`${name}_lid`, lid)));
      // the clips, retargeted from the joints to the rigid nodes (turned: q → (−x, y, −z, w), t → (−x, y, −z))
      const target = { Chest_Bottom: body, Chest_Top: hinge };
      let open = null;
      for (const a of sdoc.getRoot().listAnimations()) {
        const anim = doc.createAnimation(`${name}_${a.getName().replace(/^Chest_/, "")}`);
        for (const ch of a.listChannels()) {
          const node = target[ch.getTargetNode().getName()];
          const pathName = ch.getTargetPath();
          if (!node || pathName === "scale" || (pathName === "translation" && node === hinge)) continue;
          const s = ch.getSampler();
          const input = Float32Array.from(s.getInput().getArray());
          const src = s.getOutput().getArray();
          const outArr = Float32Array.from(src);
          const k = pathName === "rotation" ? 4 : 3;
          for (let i = 0; i < outArr.length; i += k) (outArr[i] = -outArr[i]), (outArr[i + 2] = -outArr[i + 2]);
          if (pathName === "translation" && node === body) {
            // the body's keys are offsets from its rest (identity): unchanged by the turn's conjugation
          }
          const sampler = doc.createAnimationSampler().setInput(acc("SCALAR", input)).setOutput(acc(k === 4 ? "VEC4" : "VEC3", outArr)).setInterpolation(s.getInterpolation());
          anim.addSampler(sampler).addChannel(doc.createAnimationChannel().setTargetNode(node).setTargetPath(pathName).setSampler(sampler));
          if (a.getName() === "Chest_Opened" && node === hinge && pathName === "rotation") open = Array.from(outArr.slice(0, 4));
        }
      }
      const angle = 2 * Math.acos(Math.min(1, Math.abs(open[3])));
      const axis = open.slice(0, 3).map((v) => (v / Math.sin(angle / 2)) * Math.sign(open[3]));
      info.hinge = {
        node: `${name}_lid`,
        at: r3(hingeAt),
        axis: r3(axis),
        openAngle: +angle.toFixed(4),
        openRotation: open.map((v) => +v.toFixed(4)),
        clips: { open: `${name}_Open`, opened: `${name}_Opened`, close: `${name}_Close`, closed: `${name}_Closed` },
        note: "rigid lid: play the clips (animation groups of this container), or set the hinge's rotationQuaternion = RotationAxis(axis, t · openAngle)",
      };
    } else {
      group.addChild(doc.createNode(`${name}_mesh`).setMesh(meshOf(name, parts)));
    }

    // anchors: empty children `<Name>_<anchor>`
    if (cfg.anchors) {
      info.anchors = {};
      for (const [k, spec] of Object.entries(cfg.anchors)) {
        const isObj = spec && typeof spec === "object" && !Array.isArray(spec);
        const p = r3(anchorPoint(isObj ? spec.at : spec, b));
        const node = doc.createNode(`${name}_${k}`).setTranslation(p);
        if (isObj && spec.rotY) node.setRotation([0, Math.sin(spec.rotY / 2), 0, Math.cos(spec.rotY / 2)]);
        group.addChild(node);
        info.anchors[k] = { node: `${name}_${k}`, at: p, ...(isObj && spec.rotY ? { rotY: +spec.rotY.toFixed(4) } : {}) };
      }
    }

    // held items: grip point, a recipe per hand, and the clip checks
    const h = HELD[src];
    if (h) {
      const grip = r3(h.grip(b));
      info.held = { grip, recipes: {} };
      for (const [side, axes] of Object.entries(h.hands)) info.held.recipes[side === "r" ? "hand_r" : "hand_l"] = heldRecipe(side, grip, axes);
      info.held.checks = [];
      for (const c of h.check ?? []) {
        const r = heldInPose(poses, info.held.recipes[c.hand === "r" ? "hand_r" : "hand_l"], c.clip, c.t, c.axis, grip);
        if (!r) {
          problems.push(`${name}: clip ${c.clip} not found for the held check`);
          continue;
        }
        const deg = angleDeg(r.dir, c.want);
        info.held.checks.push({ clip: c.clip, t: c.t, what: c.what, deg: +deg.toFixed(1) });
        if (deg > c.deg) problems.push(`${name}: ${c.what}: off by ${deg.toFixed(1)}° (> ${c.deg}°)`);
      }
    }
    group.setExtras({ kit: "fpm", ...info });
    meta.models[name] = info;
  }
  if (problems.length) throw new Error(`propkit:\n  ${problems.join("\n  ")}`);
  return { doc, meta };
}

/** Build and emit kit/fpm; returns its metadata (for props/meta). */
export async function buildPropKit({ emit, SRC }) {
  const { doc, meta } = await buildPropKitDoc(SRC);
  await compressTextures(doc, 1024, 1024, 512);
  const glb = await finalize(doc, { keepLeaves: true });
  // the decoded kit must still name every model (prune/dedup must not have merged or dropped any)
  const back = await io.readBinary(glb);
  for (const mesh of back.getRoot().listMeshes()) {
    const users = mesh.listParents().filter((x) => x.propertyType === "Node");
    if (users.length > 1) throw new Error(`propkit: mesh ${mesh.getName()} is shared by ${users.map((n) => n.getName()).join(", ")}`);
  }
  const names = new Set(back.getRoot().listNodes().map((n) => n.getName()));
  for (const n of Object.keys(meta.models)) if (!names.has(n)) throw new Error(`propkit: ${n} is missing from the encoded kit`);
  for (const n of Object.keys(meta.models)) {
    const top = back.getRoot().listNodes().find((x) => x.getName() === n);
    const t = top.getTranslation(), r = top.getRotation(), s = top.getScale();
    if (t.some((v) => v !== 0) || r[3] !== 1 || s.some((v) => v !== 1)) throw new Error(`propkit: ${n} is not at the identity after encoding`);
  }
  meta.tris = Object.values(meta.models).reduce((s, m) => s + m.tris, 0);
  meta.animations = back.getRoot().listAnimations().map((a) => a.getName());
  const e = await emit(PROPKIT.id, { segment: PROPKIT.segment, priority: PROPKIT.priority, type: "glb", ext: "glb", data: glb, pos: PROPKIT.pos });
  console.log(`  kit/fpm: ${Object.keys(meta.models).length} models, ${meta.tris} triangles, clips ${meta.animations.join(", ")}`);
  return { meta, entry: e };
}
