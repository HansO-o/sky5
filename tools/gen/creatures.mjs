// Creatures (design keep-exit-chapters.md §10.3, §6.3, §8): the cave spiders and the great wolf as
// animated GLBs for src/engine/creatures/Creature.ts.
//
//   creatures/spider          Quaternius "Easy Enemy Pack" Spider (CC0 1.0). The FBX is converted in Node
//                             with assimpjs (no Blender). One asset for both spiders: scale 1 is the
//                             洞穴巨蛛 (2.6 m leg span, black), the 小洞蛛 is the same asset at 0.55, brown.
//   creatures/wolf            the 0 A.D. wolf (Wildfire Games, CC BY-SA 3.0; this is a modified work and
//                             stays CC BY-SA 3.0): mesh + skeleton of one clip glb, the clips of the others
//                             merged by node name, grey fur. Scale 1 is the 巨狼 (0 A.D. wolf ×1.5).
//   creatures/wolf_fur_brown  ktx2: the 0 A.D. "fur-brown" skin, an optional swap for the grey fur.
//
// Self-contained (it can move to tools/engine later): sources in assets-src/creatures (fetched by
// tools/fetch-extra.mjs), only @gltf-transform, sharp, assimpjs and the shared lib/gltf + lib/ktx helpers.
// Exports buildCreatures({ emit, SRC }) for build-assets and buildCreatureDocs(SRC) (the documents before
// finalize, for previews and checks).
//
// Layout of each GLB (checked here at build time; the design appendix "Pipeline outputs" documents it):
// - One top-level node named after the creature ("spider", "wolf"): origin on the ground under the body,
//   identity transform, facing +Z (the head), +Y up, metres. Its glTF extras (Babylon:
//   node.metadata.gltf.extras) describe the rig: clips (durations, loops, measured speeds and strike
//   times), logical bones, variants, materials, bounds.
// - Under it "<name>_mesh" (the skinned mesh, identity transform, vertices in model space) and the skeleton
//   root joint, whose rest transform carries the baked scale. No other node above the joints.
// - Every clip starts at t = 0. A channel that is static at the same value in every clip is baked into the
//   rest pose and dropped; every other animated channel exists in every clip, so cross-fades never leave a
//   joint at another clip's value. Quaternion keys are sign-continuous.
//
// Fixes over the sources (research/creatures.md):
// - Spider: assimp's FB_ngon_encoding is dropped; clip names lose the "HumanArmature|" prefix; the FBX
//   centimetre ×100 armature scale (and its -90°/+90° X pair) is replaced by one uniform scale on the root
//   joint sized to the leg span; materials are forced OPAQUE with alpha 1 (FBX alpha is 0 in other importers)
//   and renamed spider_body / spider_eyes; the eyes glow (emissive), so a runtime body tint keeps them red.
// - Wolf: the clip glbs (all one 32-joint skeleton with identical inverse bind matrices, checked) are merged
//   by node name with their times re-based to 0; the 0.6 node scale and the clips' constant 1.667 root-bone
//   scale are folded into the root joint together with the ×1.5 size; wolf_idle_01 is cut into LieDown /
//   Sleep / StandUp (boundary keys resampled, so no constant channel is lost). Every clip is taken
//   rotation-only (rotations of all joints plus the root joint's translation): the converted clips also key
//   a translation on every bone that stretches the legs by up to 60 % (Walk drove the front paws 38 cm
//   through the floor, Run 34 cm), while rotations alone give a clean gait on the ground (checked by
//   rendering both, and by the lowest-vertex numbers this build logs). The lying and dying clips and the bite
//   are then fitted to the ground key by key (the rotation-only lying pose hovered 16 cm, the corpse sank
//   21 cm, the bite's hind feet sank 8.9 cm in its rear-up and its feet floated 6.7 cm around it).
// - Loops: the 0 A.D. cycles lack their closing frame, so the first pose is appended one frame (the clip's
//   most common key interval) after the end. Only a gap of one frame's motion is closed (closeLoop: ≤ 1.5 ×
//   the clip's largest per-key joint step and ≤ loopClose.cap); anything larger fails the build.
// - Floor: every clip's lowest vertex (24 fps) must stay above minLowest (−5 cm) or the clip's own `lowest`.
import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { io, finalize, ktxTexture } from "../lib/gltf.mjs";
import { toKTX2 } from "../lib/ktx.mjs";

// ------------------------------------------------------------------ configuration

const EXIT_SEGMENT = "exit";

/** Quaternius Easy Enemy Pack spider (design §10.3, §8 "小洞蛛" / "洞穴巨蛛"). */
export const SPIDER = {
  id: "creatures/spider",
  segment: EXIT_SEGMENT,
  priority: 92,
  pos: [18, -750], // the spider chamber (cave anchor spider_c)
  file: "creatures/spider/Spider.fbx",
  /** leg span (tip to tip, bind pose) at scale 1: the giant (design §8 "about 2.6 m span") */
  span: 2.6,
  /**
   * clip name -> expected duration (s), loop flag and the design's hit time (§8; the build measures the real
   * strike and reports both), optionally `lowest` (m) in place of minLowest; the FBX names them
   * "HumanArmature|<name>"
   */
  clips: {
    Spider_Idle: { duration: 4.1667, loop: true },
    Spider_Walk: { duration: 0.8333, loop: true },
    Spider_Attack: { duration: 0.75, loop: false, designHit: 0.4 },
    Spider_Death: { duration: 1.0417, loop: false },
    Spider_Jump: { duration: 0.7083, loop: false, designHit: 0.52 },
  },
  /** source material name -> ours */
  materials: { Material: "spider_body", "Material.001": "spider_eyes" },
  /** body colours (linear RGB) of the two spiders; the asset ships the giant's */
  variants: {
    giant: { label: "洞穴巨蛛", scale: 1, body: [0.03, 0.027, 0.026] },
    small: { label: "小洞蛛", scale: 0.55, body: [0.15, 0.075, 0.03] },
  },
  eyes: { base: [0.25, 0.012, 0.01], emissive: [0.55, 0.035, 0.02] },
  bones: { body: "Body", head: "Head", thorax: "Thorax", abdomen: "Abdomen" },
  /**
   * Loop closing (closeLoop): a loop clip whose last pose is not its first may be closed only if the gap is
   * one frame's motion (≤ factor × its largest per-key joint step) and at most cap (m). The FBX loops are
   * already seamless, so nothing is closed today.
   */
  loopClose: { factor: 1.5, cap: 0.05 },
  /** lowest skinned vertex allowed over every clip (m below y = 0); a clip's own `lowest` overrides it */
  minLowest: -0.05,
  /** the (weighted) joints at the eight leg tips */
  footJoints: ["FrontFoot.L", "MidFrontFoot.L", "MidBackFoot.L", "BackFoot.L", "FrontFoot2.R", "MidFrontFoot.R", "MidBackFoot.R", "BackFoot.R"],
};

/** 0 A.D. wolf (design §10.3, §6.3 E6, §8 "巨狼"). */
export const WOLF = {
  id: "creatures/wolf",
  segment: EXIT_SEGMENT,
  priority: 90,
  pos: [-22, -718], // the den (cave anchor wolf_bed)
  dir: "creatures/wolf",
  /** the clip glb whose mesh and skeleton the asset keeps (not meshes/skeletal/wolf.glb: other IBMs) */
  base: "wolf_walk.glb",
  /**
   * Metres per 0 A.D. unit at the wolf's natural size (a large grey wolf: about 0.9 m at the back, 1.7 m
   * nose to tail tip), and the giant's factor (decision §0 #7). The 0 A.D. unit is the animated size: the
   * clip glbs' 0.6 node scale times their 1.667 root-bone scale.
   */
  metresPerUnit: 0.3,
  giant: 1.5,
  /** take the clips' rotations only (and the root joint's translation): see the header */
  rotationOnly: true,
  /**
   * Loop closing (closeLoop): the 0 A.D. cycles lack their closing frame, so a loop clip's last pose is one
   * frame short of its first. It is closed only if that gap is one frame's motion (≤ factor × the clip's
   * largest per-key joint step) and at most cap (m); Run's gap is 0.173 m (its largest frame step 0.316 m).
   */
  loopClose: { factor: 1.5, cap: 0.25 },
  /** lowest skinned vertex allowed over every clip (m below y = 0); a clip's own `lowest` overrides it */
  minLowest: -0.05,
  /**
   * Clips: name -> source file, optional [from, to] segment (s, in the source clip) and flags: `loop`;
   * `groundFit`: move the root joint vertically, key by key, so the lowest vertex touches y = 0; `lowest`:
   * this clip's floor-penetration tolerance (m) in place of minLowest.
   * wolf_idle_01 lies down (0-1.5 s), lies still (1.5-6.7 s) and stands up (6.7-8.25 s), then idles.
   */
  clips: {
    Idle: { file: "wolf_idle_02.glb", loop: true },
    Walk: { file: "wolf_walk.glb", loop: true },
    Run: { file: "wolf_run.glb", loop: true },
    // the bite: rotation-only, its hind feet sank 8.9 cm into the floor during the rear-up and all four feet
    // floated up to 6.7 cm before and after it (the source has no hop: with its bone translations the feet
    // are at or below the floor throughout), so it is fitted like the lying clips. Not Attack2: its 14 cm
    // lift is the pounce's leap, and its lowest vertex (-3.3 cm) passes minLowest.
    Attack1: { file: "wolf_attack_01.glb", loop: false, groundFit: true },
    Attack2: { file: "wolf_attack_02.glb", loop: false },
    Death: { file: "wolf_death_01.glb", loop: false, groundFit: true },
    LieDown: { file: "wolf_idle_01.glb", from: 0, to: 1.5, loop: false, groundFit: true },
    Sleep: { file: "wolf_idle_01.glb", from: 2.0, to: 6.0, loop: true, groundFit: true },
    StandUp: { file: "wolf_idle_01.glb", from: 6.7, to: 8.25, loop: false, groundFit: true },
  },
  texture: "animal_wolf_grey.png",
  /** the 0 A.D. "fur-brown" variant, shipped as creatures/wolf_fur_brown */
  textureBrown: "animal_wolf.png",
  textureSize: 256,
  bones: { pelvis: "Bone", spine: "Bone.005", chest: "Bone.001", neck: "Neck2", head: "Head", jaw: "Jaw1", tail: "Tail1" },
  feet: ["FrontToe_L", "FrontToe_R", "BackToe_L", "BackToe_R"],
};

// ------------------------------------------------------------------ small math (column-major 4x4)

function compose(t, q, s) {
  const [x, y, z, w] = q;
  const xx = x * x, yy = y * y, zz = z * z, xy = x * y, xz = x * z, yz = y * z, wx = w * x, wy = w * y, wz = w * z;
  return [
    (1 - 2 * (yy + zz)) * s[0], 2 * (xy + wz) * s[0], 2 * (xz - wy) * s[0], 0,
    2 * (xy - wz) * s[1], (1 - 2 * (xx + zz)) * s[1], 2 * (yz + wx) * s[1], 0,
    2 * (xz + wy) * s[2], 2 * (yz - wx) * s[2], (1 - 2 * (xx + yy)) * s[2], 0,
    t[0], t[1], t[2], 1,
  ];
}
function mul(a, b) {
  const o = new Array(16);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) o[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
  return o;
}
function invert(m) {
  const [a00, a01, a02, a03, a10, a11, a12, a13, a20, a21, a22, a23, a30, a31, a32, a33] = m;
  const b00 = a00 * a11 - a01 * a10, b01 = a00 * a12 - a02 * a10, b02 = a00 * a13 - a03 * a10, b03 = a01 * a12 - a02 * a11;
  const b04 = a01 * a13 - a03 * a11, b05 = a02 * a13 - a03 * a12, b06 = a20 * a31 - a21 * a30, b07 = a20 * a32 - a22 * a30;
  const b08 = a20 * a33 - a23 * a30, b09 = a21 * a32 - a22 * a31, b10 = a21 * a33 - a23 * a31, b11 = a22 * a33 - a23 * a32;
  const det = b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06;
  if (!det) throw new Error("creatures: singular matrix");
  const d = 1 / det;
  return [
    (a11 * b11 - a12 * b10 + a13 * b09) * d, (a02 * b10 - a01 * b11 - a03 * b09) * d, (a31 * b05 - a32 * b04 + a33 * b03) * d, (a22 * b04 - a21 * b05 - a23 * b03) * d,
    (a12 * b08 - a10 * b11 - a13 * b07) * d, (a00 * b11 - a02 * b08 + a03 * b07) * d, (a32 * b02 - a30 * b05 - a33 * b01) * d, (a20 * b05 - a22 * b02 + a23 * b01) * d,
    (a10 * b10 - a11 * b08 + a13 * b06) * d, (a01 * b08 - a00 * b10 - a03 * b06) * d, (a30 * b04 - a31 * b02 + a33 * b00) * d, (a21 * b02 - a20 * b04 - a23 * b00) * d,
    (a11 * b07 - a10 * b09 - a12 * b06) * d, (a00 * b09 - a01 * b07 + a02 * b06) * d, (a31 * b01 - a30 * b03 - a32 * b00) * d, (a20 * b03 - a21 * b01 + a22 * b00) * d,
  ];
}
const point = (m, v) => [0, 1, 2].map((r) => m[r] * v[0] + m[4 + r] * v[1] + m[8 + r] * v[2] + m[12 + r]);
const dir = (m, v) => [0, 1, 2].map((r) => m[r] * v[0] + m[4 + r] * v[1] + m[8 + r] * v[2]);
const maxDiff = (a, b) => a.reduce((d, x, i) => Math.max(d, Math.abs(x - b[i])), 0);
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const r3 = (x) => Math.round(x * 1e3) / 1e3 || 0;
const r4 = (x) => Math.round(x * 1e4) / 1e4 || 0;
const qdot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];

// ------------------------------------------------------------------ animation helpers

/** Value of a LINEAR/STEP sampler at time t (quaternions: sign-safe normalised lerp). */
function sample(smp, t) {
  const interp = smp.getInterpolation();
  if (interp === "CUBICSPLINE") throw new Error("creatures: CUBICSPLINE samplers are not supported");
  const T = smp.getInput().getArray(), V = smp.getOutput().getArray(), k = smp.getOutput().getElementSize();
  const at = (i) => Array.from(V.subarray(i * k, i * k + k));
  if (t <= T[0]) return at(0);
  if (t >= T[T.length - 1]) return at(T.length - 1);
  let i = 0;
  while (T[i + 1] < t) i++;
  if (interp === "STEP") return at(i);
  const u = (t - T[i]) / (T[i + 1] - T[i]);
  const a = at(i);
  let b = at(i + 1);
  if (k === 4 && qdot(a, b) < 0) b = b.map((x) => -x);
  const r = a.map((x, j) => x + (b[j] - x) * u);
  if (k !== 4) return r;
  const l = Math.hypot(...r);
  return r.map((x) => x / l);
}

const clipStart = (anim) => Math.min(...anim.listSamplers().map((s) => s.getInput().getArray()[0]));
const clipEnd = (anim) => Math.max(...anim.listSamplers().map((s) => { const T = s.getInput().getArray(); return T[T.length - 1]; }));
export const clipDuration = (anim) => clipEnd(anim) - clipStart(anim);

/** World matrices (scene space) of the rest pose (anim null) or of `anim` at time t. */
function poser(doc, anim, t) {
  const byNode = new Map();
  if (anim) for (const c of anim.listChannels()) {
    if (!byNode.has(c.getTargetNode())) byNode.set(c.getTargetNode(), {});
    byNode.get(c.getTargetNode())[c.getTargetPath()] = c.getSampler();
  }
  const world = new Map();
  const W = (n) => {
    if (world.has(n)) return world.get(n);
    const a = byNode.get(n) ?? {};
    const m = compose(a.translation ? sample(a.translation, t) : n.getTranslation(), a.rotation ? sample(a.rotation, t) : n.getRotation(), a.scale ? sample(a.scale, t) : n.getScale());
    const p = n.getParentNode();
    const r = p ? mul(W(p), m) : m;
    world.set(n, r);
    return r;
  };
  return W;
}

function nodeIndex(doc) {
  const m = new Map();
  for (const n of doc.getRoot().listNodes()) {
    if (m.has(n.getName())) throw new Error(`creatures: two nodes named ${n.getName()}`);
    m.set(n.getName(), n);
  }
  return m;
}
const nodeNamed = (doc, name) => {
  const n = doc.getRoot().listNodes().filter((x) => x.getName() === name);
  if (n.length !== 1) throw new Error(`creatures: ${n.length} nodes named ${name}`);
  return n[0];
};

/** Positions (scene space) of named nodes, for the rest pose (anim null) or `anim` at t. */
function positions(doc, anim, t, names) {
  const W = poser(doc, anim, t);
  return names.map((n) => point(W(nodeNamed(doc, n)), [0, 0, 0]));
}

/** Skinned-vertex bounds (scene space) of every skinned mesh, rest pose (anim null) or `anim` at t. */
function skinnedBounds(doc, anim, t) {
  const W = poser(doc, anim, t);
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (const node of doc.getRoot().listNodes()) {
    const skin = node.getSkin(), mesh = node.getMesh();
    if (!skin || !mesh) continue;
    const ibm = skin.getInverseBindMatrices().getArray();
    const M = skin.listJoints().map((j, i) => mul(W(j), Array.from(ibm.subarray(i * 16, i * 16 + 16))));
    for (const p of mesh.listPrimitives()) {
      const P = p.getAttribute("POSITION"), J = p.getAttribute("JOINTS_0"), Wt = p.getAttribute("WEIGHTS_0");
      const v = [], j = [], w = [];
      for (let i = 0; i < P.getCount(); i++) {
        P.getElement(i, v);
        J.getElement(i, j);
        Wt.getElement(i, w);
        const o = [0, 0, 0];
        for (let k = 0; k < 4; k++) {
          if (!w[k]) continue;
          const q = point(M[j[k]], v);
          for (let r = 0; r < 3; r++) o[r] += w[k] * q[r];
        }
        for (let r = 0; r < 3; r++) (min[r] = Math.min(min[r], o[r])), (max[r] = Math.max(max[r], o[r]));
      }
    }
  }
  return { min, max };
}

/** The keys of `smp` over [a, b], boundary values resampled (no channel loses its value), rebased to 0. */
function sliceKeys(smp, a, b) {
  const T = smp.getInput().getArray(), V = smp.getOutput().getArray(), k = smp.getOutput().getElementSize();
  const times = [0], values = [...sample(smp, a)];
  const eps = 1e-5;
  for (let i = 0; i < T.length; i++)
    if (T[i] > a + eps && T[i] < b - eps) {
      times.push(T[i] - a);
      values.push(...V.subarray(i * k, i * k + k));
    }
  times.push(b - a);
  values.push(...sample(smp, b));
  return { times: new Float32Array(times), values: new Float32Array(values) };
}

/**
 * Copy `src` (an animation of another document on the same skeleton) into `doc` as clip `name`, channels
 * retargeted by node name, over [from, to] (default: the whole clip) re-based to start at 0.
 * `keep(node, path)` filters channels.
 */
function copyClip(doc, src, name, { from, to, keep = () => true } = {}) {
  const byName = nodeIndex(doc);
  const buffer = doc.getRoot().listBuffers()[0];
  const a = from ?? clipStart(src), b = to ?? clipEnd(src);
  if (!(b > a)) throw new Error(`creatures: ${name}: empty range ${a}..${b}`);
  const anim = doc.createAnimation(name);
  for (const ch of src.listChannels()) {
    const tname = ch.getTargetNode()?.getName();
    const target = byName.get(tname);
    if (!target) throw new Error(`creatures: ${name}: no node "${tname}" to retarget to`);
    if (!keep(target, ch.getTargetPath())) continue;
    const smp = ch.getSampler();
    const { times, values } = sliceKeys(smp, a, b);
    const s = doc
      .createAnimationSampler()
      .setInput(doc.createAccessor().setType("SCALAR").setArray(times).setBuffer(buffer))
      .setOutput(doc.createAccessor().setType(smp.getOutput().getType()).setArray(values).setBuffer(buffer))
      .setInterpolation(smp.getInterpolation() === "STEP" ? "STEP" : "LINEAR");
    anim.addSampler(s).addChannel(doc.createAnimationChannel().setTargetNode(target).setTargetPath(ch.getTargetPath()).setSampler(s));
  }
  return anim;
}

function disposeAnimation(a) {
  for (const c of a.listChannels()) c.dispose();
  for (const s of a.listSamplers()) s.dispose();
  a.dispose();
}
function disposeChannel(c) {
  const s = c.getSampler();
  c.dispose();
  if (s && !s.listParents().some((p) => p.propertyType === "AnimationChannel")) s.dispose();
}
const restOf = (node, path) => (path === "rotation" ? node.getRotation() : path === "scale" ? node.getScale() : node.getTranslation());
const setRest = (node, path, v) => (path === "rotation" ? node.setRotation(v) : path === "scale" ? node.setScale(v) : node.setTranslation(v));
const same = (path, a, b, eps) => (path === "rotation" ? 1 - Math.abs(qdot(a, b)) <= eps : maxDiff(a, b) <= eps);

/** Every channel of `node` in every clip is static at its rest value (else throws). */
function assertStaticAtRest(doc, node, eps = 1e-4) {
  for (const a of doc.getRoot().listAnimations())
    for (const c of a.listChannels()) {
      if (c.getTargetNode() !== node) continue;
      const V = c.getSampler().getOutput().getArray(), k = c.getSampler().getOutput().getElementSize();
      const rest = restOf(node, c.getTargetPath());
      for (let i = 0; i < V.length; i += k)
        if (!same(c.getTargetPath(), Array.from(V.subarray(i, i + k)), rest, eps)) throw new Error(`creatures: ${a.getName()} animates ${node.getName()}.${c.getTargetPath()} away from its rest value; it cannot be folded into the root joint`);
    }
}

/**
 * Bake channels that hold one value in every clip into the rest pose and drop them. A (node, path) that
 * some clip does not animate is baked only if the value is its rest value. Returns the baked count.
 */
function bakeStaticChannels(doc, eps = 1e-5) {
  const anims = doc.getRoot().listAnimations();
  const groups = new Map();
  for (const a of anims)
    for (const c of a.listChannels()) {
      const key = `${c.getTargetNode().getName()}\u0000${c.getTargetPath()}`;
      if (!groups.has(key)) groups.set(key, { node: c.getTargetNode(), path: c.getTargetPath(), channels: [] });
      groups.get(key).channels.push(c);
    }
  let baked = 0;
  for (const { node, path, channels } of groups.values()) {
    let v0 = null, ok = true;
    for (const c of channels) {
      const V = c.getSampler().getOutput().getArray(), k = c.getSampler().getOutput().getElementSize();
      for (let i = 0; i < V.length && ok; i += k) {
        const v = Array.from(V.subarray(i, i + k));
        if (!v0) v0 = v;
        else ok = same(path, v, v0, eps);
      }
      if (!ok) break;
    }
    if (!ok || !v0) continue;
    if (channels.length < anims.length && !same(path, v0, restOf(node, path), eps)) continue;
    setRest(node, path, v0);
    channels.forEach(disposeChannel);
    baked++;
  }
  return baked;
}

/**
 * Give every clip a channel for each (node, path) that some clip animates, holding the rest value where
 * the clip itself has none (a clip copied rotation-only), so no joint keeps another clip's value.
 */
function fillMissingChannels(doc) {
  const anims = doc.getRoot().listAnimations();
  const buffer = doc.getRoot().listBuffers()[0];
  const all = new Map();
  for (const a of anims) for (const c of a.listChannels()) all.set(`${c.getTargetNode().getName()}.${c.getTargetPath()}`, [c.getTargetNode(), c.getTargetPath()]);
  let added = 0;
  for (const a of anims) {
    const have = new Set(a.listChannels().map((c) => `${c.getTargetNode().getName()}.${c.getTargetPath()}`));
    const D = clipDuration(a);
    for (const [key, [node, p]] of all) {
      if (have.has(key)) continue;
      const v = restOf(node, p);
      const s = doc
        .createAnimationSampler()
        .setInput(doc.createAccessor().setType("SCALAR").setArray(new Float32Array([0, D])).setBuffer(buffer))
        .setOutput(doc.createAccessor().setType(p === "rotation" ? "VEC4" : "VEC3").setArray(new Float32Array([...v, ...v])).setBuffer(buffer))
        .setInterpolation("LINEAR");
      a.addSampler(s).addChannel(doc.createAnimationChannel().setTargetNode(node).setTargetPath(p).setSampler(s));
      added++;
    }
  }
  return added;
}

/** Every animated (node, path) must exist in every clip (else a cross-fade leaves it at another clip's value). */
function assertChannelSets(doc) {
  const sets = doc.getRoot().listAnimations().map((a) => [a.getName(), new Set(a.listChannels().map((c) => `${c.getTargetNode().getName()}.${c.getTargetPath()}`))]);
  const all = new Set(sets.flatMap(([, s]) => [...s]));
  const bad = sets.filter(([, s]) => s.size !== all.size).map(([n, s]) => `${n} lacks ${[...all].filter((x) => !s.has(x)).join(", ")}`);
  if (bad.length) throw new Error(`creatures: clips animate different channels: ${bad.join("; ")}`);
  return all.size;
}

/** Flip quaternion keys so each is in the hemisphere of the previous one (q and -q are one rotation). */
function fixQuatSigns(doc) {
  let flips = 0;
  for (const a of doc.getRoot().listAnimations())
    for (const c of a.listChannels()) {
      if (c.getTargetPath() !== "rotation") continue;
      const out = c.getSampler().getOutput();
      const V = out.getArray().slice();
      let any = false;
      const rest = c.getTargetNode().getRotation();
      for (let i = 0; i < V.length; i += 4) {
        const prev = i ? V.subarray(i - 4, i) : rest;
        if (qdot(V.subarray(i, i + 4), prev) < 0) {
          for (let j = 0; j < 4; j++) V[i + j] = -V[i + j];
          any = true;
          flips++;
        }
      }
      if (any) c.getSampler().setOutput(out.clone().setArray(V));
    }
  return flips;
}

/** Sorted distinct key times of a clip, over all its samplers (s). */
function keyTimes(anim) {
  const s = new Set();
  for (const smp of anim.listSamplers()) for (const t of smp.getInput().getArray()) s.add(Math.round(t * 1e5) / 1e5);
  return [...s].sort((a, b) => a - b);
}

/**
 * A clip's frame interval (s): the most common key interval over all its samplers (the mean of the
 * intervals in that 0.1 ms bucket). Not one sampler's last interval: assimp keeps only the keys where a
 * value changes, so a spider sampler can skip frames.
 */
function keyInterval(anim) {
  const buckets = new Map();
  for (const smp of anim.listSamplers()) {
    const T = smp.getInput().getArray();
    for (let i = 1; i < T.length; i++) {
      const d = T[i] - T[i - 1];
      if (!(d > 1e-6)) continue;
      const k = Math.round(d * 1e4);
      const b = buckets.get(k) ?? { n: 0, sum: 0 };
      b.n++;
      b.sum += d;
      buckets.set(k, b);
    }
  }
  if (!buckets.size) throw new Error(`creatures: ${anim.getName()} has no key interval (every sampler has one key)`);
  const [, b] = [...buckets].sort((x, y) => y[1].n - x[1].n || x[0] - y[0])[0];
  return b.sum / b.n;
}

/** Largest joint step (m) between consecutive key times of a clip: the most a joint moves in one frame. */
function largestStep(doc, anim, joints) {
  const T = keyTimes(anim);
  let prev = positions(doc, anim, T[0], joints), best = 0;
  for (let i = 1; i < T.length; i++) {
    const p = positions(doc, anim, T[i], joints);
    for (let j = 0; j < p.length; j++) best = Math.max(best, dist(p[j], prev[j]));
    prev = p;
  }
  return best;
}

/** Measurements of each loop clip's closing (anim -> { gap, step, dt }), for the extras and the log. */
const closings = new WeakMap();

/**
 * Close a looping clip exported without its closing frame (0 A.D.: N keys for an N-frame cycle, so the last
 * key is one frame short of the first pose): append the first pose one frame (the clip's most common key
 * interval) after its end, so the loop interpolates last -> first instead of snapping.
 *
 * The gap is measured first, and the build fails unless it is one frame's worth of motion: the largest
 * joint distance from the last pose to the first must be at most `factor` × the clip's largest per-key
 * joint step, and at most `cap` m. A clip flagged loop that is not a cycle (half a gait, the wrong source
 * clip, a death) fails here instead of being papered over with a one-frame snap.
 * Returns { gap, step, dt } (m, m, s; dt 0 when the clip was already seamless).
 */
function closeLoop(doc, anim, joints, { cap, factor = 1.5, eps = 5e-4 }) {
  const gap = loopSeam(doc, anim, joints);
  const step = largestStep(doc, anim, joints);
  if (gap <= eps) {
    closings.set(anim, { gap, step, dt: 0 });
    return closings.get(anim);
  }
  if (gap > factor * step || gap > cap)
    throw new Error(`creatures: ${anim.getName()} is flagged loop, but its last pose is ${r3(gap)} m from its first (a joint moves at most ${r3(step)} m per frame in it; a missing closing frame may leave ${factor}× that, and at most ${cap} m): it is not a cycle, fix the clip's source or range`);
  const dt = keyInterval(anim);
  const D = clipEnd(anim);
  for (const s of anim.listSamplers()) {
    const T = s.getInput().getArray(), V = s.getOutput().getArray(), k = s.getOutput().getElementSize();
    const last = V.subarray(V.length - k);
    // a sparse sampler that ends before the clip holds its last value up to the end
    const hold = T[T.length - 1] < D - 1e-6;
    const n = T.length + (hold ? 2 : 1);
    const t2 = new Float32Array(n);
    t2.set(T);
    if (hold) t2[T.length] = D;
    t2[n - 1] = D + dt;
    const v2 = new Float32Array(n * k);
    v2.set(V);
    if (hold) v2.set(last, V.length);
    let first = V.subarray(0, k);
    // a quaternion takes the sign nearest the last key (q and -q are one rotation)
    if (k === 4 && qdot(first, last) < 0) first = first.map((x) => -x);
    v2.set(first, (n - 1) * k);
    s.setInput(s.getInput().clone().setArray(t2));
    s.setOutput(s.getOutput().clone().setArray(v2));
  }
  const after = loopSeam(doc, anim, joints);
  if (after > 1e-3) throw new Error(`creatures: ${anim.getName()}: closing the loop left ${r3(after)} m between its first and last pose`);
  closings.set(anim, { gap, step, dt });
  return closings.get(anim);
}

/** Make every vertex's skin weights sum to 1 (assimp writes sums up to 1.0011; quantisation skips those). */
function normalizeWeights(doc) {
  let fixed = 0;
  const done = new Set();
  for (const m of doc.getRoot().listMeshes())
    for (const p of m.listPrimitives()) {
      const W = p.getAttribute("WEIGHTS_0");
      if (!W || done.has(W)) continue;
      done.add(W);
      const w = [];
      for (let i = 0; i < W.getCount(); i++) {
        W.getElement(i, w);
        const sum = w.reduce((a, x) => a + Math.max(0, x), 0);
        if (!(sum > 0)) throw new Error(`creatures: ${m.getName()}: vertex ${i} has no skin weight`);
        if (Math.abs(sum - 1) > 1e-6 || w.some((x) => x < 0)) {
          W.setElement(i, w.map((x) => Math.max(0, x) / sum));
          fixed++;
        }
      }
    }
  return fixed;
}

/**
 * Fit a clip to the ground: at every key of `root`'s translation channel, move it vertically by minus the
 * lowest skinned vertex at that time (model space must be metres on y = 0). Returns the shift range.
 */
function groundFit(doc, anim, root) {
  const ch = anim.listChannels().find((c) => c.getTargetNode() === root && c.getTargetPath() === "translation");
  if (!ch) throw new Error(`creatures: ${anim.getName()}: no ${root.getName()} translation to fit to the ground`);
  const T = ch.getSampler().getInput().getArray();
  const shifts = Array.from(T, (t) => -skinnedBounds(doc, anim, t).min[1]);
  const out = ch.getSampler().getOutput();
  const V = out.getArray().slice();
  // a parent above the root joint would scale the shift: the root joint must sit under identity nodes
  for (let p = root.getParentNode(); p; p = p.getParentNode()) if (maxDiff(p.getMatrix(), compose([0, 0, 0], [0, 0, 0, 1], [1, 1, 1])) > 1e-6) throw new Error(`creatures: ground fit: ${p.getName()} above ${root.getName()} is not the identity`);
  shifts.forEach((d, i) => (V[i * 3 + 1] += d));
  ch.getSampler().setOutput(out.clone().setArray(V));
  return `${r3(Math.min(...shifts))}..${r3(Math.max(...shifts))}`;
}

/** Multiply a node's rest translation/scale and its translation/scale channels by a uniform factor f. */
function scaleJoint(doc, node, f) {
  node.setTranslation(node.getTranslation().map((x) => x * f));
  node.setScale(node.getScale().map((x) => x * f));
  for (const a of doc.getRoot().listAnimations())
    for (const c of a.listChannels()) {
      if (c.getTargetNode() !== node || c.getTargetPath() === "rotation") continue;
      const out = c.getSampler().getOutput();
      c.getSampler().setOutput(out.clone().setArray(out.getArray().map((x) => x * f)));
    }
}

/**
 * Put the skinned mesh's vertices in model space: vertices become G·v, normals G·n and the inverse bind
 * matrices IBM·G⁻¹, so rendering is unchanged and the mesh's own bounds become the real ones. G is the
 * mesh's bind placement in model space: given, or found as the rest world matrix times the inverse bind
 * matrix, which must then be the same for every weighted joint (the rest pose is the bind pose). Returns
 * G, or null (left alone) when it is not given and the rest pose is not the bind pose.
 */
function bakeMeshSpace(doc, meshNode, given = null) {
  const skin = meshNode.getSkin();
  const joints = skin.listJoints();
  const ibmAcc = skin.getInverseBindMatrices();
  const ibm = ibmAcc.getArray();
  const W = poser(doc, null, 0);
  const used = new Set();
  for (const p of meshNode.getMesh().listPrimitives()) {
    const J = p.getAttribute("JOINTS_0"), Wt = p.getAttribute("WEIGHTS_0");
    const j = [], w = [];
    for (let i = 0; i < J.getCount(); i++) {
      J.getElement(i, j);
      Wt.getElement(i, w);
      for (let k = 0; k < 4; k++) if (w[k] > 0) used.add(j[k]);
    }
  }
  let G = given;
  if (!G) for (const i of used) {
    const g = mul(W(joints[i]), Array.from(ibm.subarray(i * 16, i * 16 + 16)));
    if (!G) G = g;
    else if (maxDiff(g, G) > 1e-4 * Math.max(1, ...G.map(Math.abs))) return null;
  }
  const Ginv = invert(G);
  const done = new Set();
  for (const p of meshNode.getMesh().listPrimitives()) {
    for (const [sem, fn] of [["POSITION", (v) => point(G, v)], ["NORMAL", (v) => { const n = dir(G, v), l = Math.hypot(...n) || 1; return n.map((x) => x / l); }]]) {
      const acc = p.getAttribute(sem);
      if (!acc || done.has(acc)) continue;
      done.add(acc);
      const v = [];
      for (let i = 0; i < acc.getCount(); i++) acc.setElement(i, fn(acc.getElement(i, v)));
    }
    if (p.getAttribute("TANGENT")) p.setAttribute("TANGENT", null);
  }
  const out = new Float32Array(ibm.length);
  for (let i = 0; i < joints.length; i++) out.set(mul(Array.from(ibm.subarray(i * 16, i * 16 + 16)), Ginv), i * 16);
  skin.setInverseBindMatrices(ibmAcc.clone().setArray(out));
  return G;
}

// ------------------------------------------------------------------ measurements (logged, and in extras)

/** Largest joint distance (m) between a clip's first and last pose: 0 for a seamless loop. */
function loopSeam(doc, anim, joints) {
  const D = clipDuration(anim);
  const a = positions(doc, anim, 0, joints), b = positions(doc, anim, D, joints);
  return Math.max(...a.map((p, i) => dist(p, b[i])));
}

/**
 * Ground speed of a gait clip (m/s at rate 1): a planted foot is still on the ground, so in model space it
 * slides backwards at the ground speed. Median of -dz/dt over all feet while each is within `contact` (m)
 * of its lowest point.
 */
function groundSpeed(doc, anim, feet, contact) {
  const D = clipDuration(anim), N = Math.max(24, Math.round(D * 120));
  const track = feet.map(() => []);
  for (let i = 0; i <= N; i++) positions(doc, anim, (D * i) / N, feet).forEach((p, k) => track[k].push([(D * i) / N, p[1], p[2]]));
  const v = [];
  for (const s of track) {
    const low = Math.min(...s.map((x) => x[1]));
    for (let i = 1; i < s.length; i++) if (s[i][1] < low + contact && s[i - 1][1] < low + contact) v.push(-(s[i][2] - s[i - 1][2]) / (s[i][0] - s[i - 1][0]));
  }
  v.sort((x, y) => x - y);
  return v.length ? v[v.length >> 1] : 0;
}

/**
 * An attack's strike, from `bone` (the head or jaw): when it moves forward (+Z) fastest (`snap`, s) and
 * when it is furthest forward (`t`, s; `z`: how far from the origin, m).
 */
function strike(doc, anim, bone) {
  const D = clipDuration(anim), N = Math.round(D * 120);
  const z = [];
  for (let i = 0; i <= N; i++) z.push(positions(doc, anim, (D * i) / N, [bone])[0][2]);
  const far = z.indexOf(Math.max(...z));
  let snap = 0;
  for (let i = 1; i <= N; i++) if (z[i] - z[i - 1] > z[snap + 1] - z[snap]) snap = i - 1;
  return { t: (D * far) / N, z: z[far], snap: (D * (snap + 0.5)) / N };
}

/** A hop in place: when `bone` peaks (s), how high above its start (m), and when it is back down. */
function hop(doc, anim, bone) {
  const D = clipDuration(anim), N = Math.round(D * 120);
  const y = [];
  for (let i = 0; i <= N; i++) y.push(positions(doc, anim, (D * i) / N, [bone])[0][1]);
  const top = y.indexOf(Math.max(...y));
  let land = top;
  while (land < N && y[land] > y[0] + 0.02) land++;
  return { apex: (D * top) / N, height: y[top] - y[0], land: (D * land) / N };
}

/** A rear-up: when the `paws` (joints) are highest (s, m above their start) and first back down within 0.1 m. */
function rear(doc, anim, paws) {
  const D = clipDuration(anim), N = Math.round(D * 120);
  const y = [];
  for (let i = 0; i <= N; i++) y.push(Math.min(...positions(doc, anim, (D * i) / N, paws).map((p) => p[1])));
  const top = y.indexOf(Math.max(...y));
  let land = top;
  while (land < N && y[land] > y[0] + 0.1) land++;
  return { rear: (D * top) / N, height: y[top] - y[0], land: (D * land) / N };
}

/** Lowest skinned vertex over a clip (m; 0 = on the ground), sampled at 24 fps. */
function lowestOver(doc, anim) {
  const D = clipDuration(anim), N = Math.max(2, Math.round(D * 24));
  let low = Infinity;
  for (let i = 0; i <= N; i++) low = Math.min(low, skinnedBounds(doc, anim, (D * i) / N).min[1]);
  return low;
}

/** The clip's lowest vertex (m, rounded); throws if it sinks below `min` (m, negative) into the floor. */
function floorCheck(doc, anim, min) {
  const low = lowestOver(doc, anim);
  if (low < min) throw new Error(`creatures: ${anim.getName()} sinks ${r3(-low)} m into the ground (its lowest vertex; allowed ${r3(-min)} m: set the clip's \`lowest\` only for a measured, accepted case)`);
  return r3(low);
}

/**
 * Extras of a loop clip, from its closing (closeLoop ran in the build): `closeGap`, the largest joint
 * distance (m) from its last pose to its first before closing; `frameStep`, its largest per-key joint
 * step (m); `closeDt`, the frame appended (s, 0 if it was already seamless); `seam`, the gap after closing
 * (m, 0).
 */
function loopExtras(doc, anim, joints) {
  const k = closings.get(anim);
  if (!k) throw new Error(`creatures: ${anim.getName()} is a loop clip, but closeLoop did not check it`);
  const seam = loopSeam(doc, anim, joints);
  if (seam > 1e-3) throw new Error(`creatures: ${anim.getName()} does not loop (${r3(seam)} m between its first and last pose)`);
  return { closeGap: r3(k.gap), frameStep: r3(k.step), closeDt: r4(k.dt), seam: r3(seam) };
}

// ------------------------------------------------------------------ spider

/** Spider.fbx -> glTF Document via assimpjs (WASM; MIT), without assimp's FB_ngon_encoding. */
async function readFBX(file) {
  const { default: assimpjs } = await import("assimpjs");
  const ajs = await assimpjs();
  const list = new ajs.FileList();
  list.AddFile(path.basename(file), new Uint8Array(await fs.readFile(file)));
  const res = ajs.ConvertFileList(list, "glb2");
  if (!res.IsSuccess() || res.FileCount() < 1) throw new Error(`creatures: assimpjs could not convert ${file}: ${res.GetErrorCode()}`);
  const glb = res.GetFile(0).GetContent();
  const json = await io.binaryToJSON(new Uint8Array(glb));
  const j = json.json;
  // FB_ngon_encoding only marks how assimp triangulated; KHR_materials_volume is listed but unused
  for (const m of j.meshes ?? []) for (const p of m.primitives) if (p.extensions) delete p.extensions.FB_ngon_encoding;
  const usedVolume = (j.materials ?? []).some((m) => m.extensions?.KHR_materials_volume);
  j.extensionsUsed = (j.extensionsUsed ?? []).filter((e) => e !== "FB_ngon_encoding" && (e !== "KHR_materials_volume" || usedVolume));
  if (j.extensionsRequired) j.extensionsRequired = j.extensionsRequired.filter((e) => e !== "FB_ngon_encoding");
  return io.readJSON(json);
}

export async function buildSpiderDoc(SRC) {
  const file = path.join(SRC, SPIDER.file);
  await fs.access(file).catch(() => {
    throw new Error(`creatures: ${path.relative(path.dirname(SRC), file)} is missing: run node tools/fetch-extra.mjs`);
  });
  const doc = await readFBX(file);
  const root = doc.getRoot();

  // clips: strip the armature prefix; exactly the expected set, with the expected lengths
  for (const a of root.listAnimations()) a.setName(a.getName().replace(/^.*\|/, ""));
  const names = root.listAnimations().map((a) => a.getName());
  const want = Object.keys(SPIDER.clips);
  const missing = want.filter((n) => names.filter((x) => x === n).length !== 1);
  if (missing.length) throw new Error(`creatures: Spider.fbx lacks (or repeats) clips ${missing.join(", ")}; it has ${names.join(", ")}`);
  for (const a of root.listAnimations()) {
    const spec = SPIDER.clips[a.getName()];
    if (!spec) {
      console.log(`  spider: dropping clip ${a.getName()}`);
      disposeAnimation(a);
      continue;
    }
    if (clipStart(a) !== 0) throw new Error(`creatures: ${a.getName()} does not start at 0`);
    if (Math.abs(clipDuration(a) - spec.duration) > 0.02) throw new Error(`creatures: ${a.getName()} lasts ${clipDuration(a).toFixed(3)} s, expected ${spec.duration}`);
  }

  // the armature: RootNode (identity) > HumanArmature (R -90° X, S 100: Blender's cm export) > Root (R +90° X)
  const rootNode = nodeNamed(doc, "RootNode"), arm = nodeNamed(doc, "HumanArmature"), rootJ = nodeNamed(doc, "Root"), cube = nodeNamed(doc, "Cube");
  const skin = cube.getSkin();
  if (!skin || !cube.getMesh() || root.listSkins().length !== 1) throw new Error("creatures: Spider.fbx: expected one skinned mesh (Cube)");
  if (skin.listJoints()[0] !== rootJ) throw new Error("creatures: Spider.fbx: the skin's first joint is not Root");
  const above = mul(mul(rootNode.getMatrix(), arm.getMatrix()), rootJ.getMatrix());
  const s0 = above[0];
  if (maxDiff(above, [s0, 0, 0, 0, 0, s0, 0, 0, 0, 0, s0, 0, 0, 0, 0, 1]) > 1e-4 * s0) throw new Error(`creatures: Spider.fbx: RootNode·HumanArmature·Root is not a uniform scale (${above.map(r4)})`);
  for (const n of [rootNode, arm, rootJ]) assertStaticAtRest(doc, n);
  // assimp writes the first frame as the joints' rest pose, not the bind pose: the mesh's bind placement is
  // its node's world matrix (the joints that do rest at bind, Root and the pole targets, agree)
  const meshBind = mul(rootNode.getMatrix(), cube.getMatrix());
  {
    const i = skin.listJoints().indexOf(rootJ);
    const g = mul(above, Array.from(skin.getInverseBindMatrices().getArray().subarray(i * 16, i * 16 + 16)));
    if (maxDiff(g, meshBind) > 1e-4 * s0) throw new Error("creatures: Spider.fbx: the root joint's bind does not match the mesh node");
  }
  for (const a of root.listAnimations()) for (const c of a.listChannels()) if ([rootNode, arm, rootJ].includes(c.getTargetNode())) disposeChannel(c);

  // new top: spider > { spider_mesh, Root }; Root carries the whole scale (first 1, sized below)
  const scene = root.listScenes()[0];
  const top = doc.createNode("spider");
  scene.addChild(top);
  // (addChild re-parents; Node.detach() would also drop the joint from the skin and its channels)
  top.addChild(rootJ.setTranslation([0, 0, 0]).setRotation([0, 0, 0, 1]).setScale([1, 1, 1]));
  top.addChild(cube.setName("spider_mesh").setTranslation([0, 0, 0]).setRotation([0, 0, 0, 1]).setScale([1, 1, 1]));
  cube.getMesh().setName("spider_mesh");
  for (const n of [arm, rootNode]) n.dispose();
  for (const n of scene.listChildren()) if (n !== top) throw new Error(`creatures: Spider.fbx: unexpected top-level node ${n.getName()}`);

  // size: leg span (bind pose, tip to tip across X) -> SPIDER.span at scale 1. With the root joint at
  // scale 1 every joint is 1/s0 of before; at k, k/s0, and the mesh's bind placement with it.
  const P = cube.getMesh().listPrimitives().map((p) => p.getAttribute("POSITION"));
  const xs = P.flatMap((a) => [a.getMin([])[0], a.getMax([])[0]].map((x) => x * meshBind[0]));
  const k = (SPIDER.span * s0) / (Math.max(...xs) - Math.min(...xs));
  if (Math.abs(meshBind[1]) + Math.abs(meshBind[2]) > 1e-4 * s0) throw new Error("creatures: Spider.fbx: the mesh node turns its X axis (the leg span is measured along it)");
  rootJ.setScale([k, k, k]);
  bakeMeshSpace(doc, cube, meshBind.map((x, i) => (i % 4 === 3 ? x : (x * k) / s0)));

  // materials: opaque, renamed; the body is the giant's colour, the eyes glow
  for (const m of root.listMaterials()) {
    const name = SPIDER.materials[m.getName()];
    if (!name) throw new Error(`creatures: Spider.fbx: unexpected material ${m.getName()}`);
    m.setName(name).setAlphaMode("OPAQUE").setDoubleSided(false).setMetallicFactor(0);
    if (name === "spider_body") m.setBaseColorFactor([...SPIDER.variants.giant.body, 1]).setRoughnessFactor(0.45);
    else m.setBaseColorFactor([...SPIDER.eyes.base, 1]).setEmissiveFactor(SPIDER.eyes.emissive).setRoughnessFactor(0.3);
  }

  const baked = bakeStaticChannels(doc);
  const flips = fixQuatSigns(doc);
  const channels = assertChannelSets(doc);
  const weights = normalizeWeights(doc);
  const joints = skin.listJoints().map((j) => j.getName());
  const closed = root.listAnimations().filter((a) => SPIDER.clips[a.getName()].loop && closeLoop(doc, a, joints, SPIDER.loopClose).dt).map((a) => `${a.getName()} (${r3(closings.get(a).gap)} m)`);
  console.log(`  spider: assimpjs ok; ×${r4(s0)} armature scale -> leg span ${SPIDER.span} m (root joint scale ${r4(k)}); ${baked} static channels baked, ${channels} animated, ${flips} quaternion keys flipped, ${weights} vertex weights normalised${closed.length ? `, loops closed: ${closed.join(", ")}` : ", loops already seamless"}`);
  return doc;
}

/** Checks and measurements on a built spider document; returns the extras. */
function spiderInfo(doc) {
  const root = doc.getRoot();
  const anim = (n) => root.listAnimations().find((a) => a.getName() === n);
  const idle = anim("Spider_Idle");
  const bounds = skinnedBounds(doc, idle, 0);
  // the bind pose (the vertices, baked to model space): its leg span is the size
  const prims = root.listMeshes().flatMap((m) => m.listPrimitives()).map((p) => p.getAttribute("POSITION"));
  const span = { min: [0, 1, 2].map((i) => Math.min(...prims.map((a) => a.getMin([])[i]))), max: [0, 1, 2].map((i) => Math.max(...prims.map((a) => a.getMax([])[i]))) };
  if (Math.abs(span.max[0] - span.min[0] - SPIDER.span) > 0.01) throw new Error(`creatures: spider's bind leg span is ${r3(span.max[0] - span.min[0])} m, not ${SPIDER.span}`);
  const [head, abdomen] = positions(doc, idle, 0, [SPIDER.bones.head, SPIDER.bones.abdomen]);
  if (!(head[2] > abdomen[2])) throw new Error("creatures: spider does not face +Z (head behind the abdomen)");
  if (Math.abs(bounds.min[1]) > 0.03) throw new Error(`creatures: spider's feet are ${r3(bounds.min[1])} m off the ground in Spider_Idle`);
  const allJoints = root.listSkins()[0].listJoints().map((j) => j.getName());
  const clips = {};
  for (const [name, spec] of Object.entries(SPIDER.clips)) {
    const a = anim(name);
    const c = (clips[name] = { duration: r4(clipDuration(a)), loop: spec.loop });
    if (spec.loop) Object.assign(c, loopExtras(doc, a, allJoints));
    if (spec.designHit !== undefined) c.designHit = spec.designHit;
    c.lowest = floorCheck(doc, a, spec.lowest ?? SPIDER.minLowest);
  }
  clips.Spider_Walk.groundSpeed = r3(groundSpeed(doc, anim("Spider_Walk"), SPIDER.footJoints, 0.02));
  // the bite thrusts the head forward; the jump is a hop in place (the runtime moves the body for a lunge)
  const bite = strike(doc, anim("Spider_Attack"), SPIDER.bones.head);
  Object.assign(clips.Spider_Attack, { snap: r3(bite.snap), strike: r3(bite.t), reach: r3(bite.z) });
  const jump = hop(doc, anim("Spider_Jump"), SPIDER.bones.body);
  Object.assign(clips.Spider_Jump, { apex: r3(jump.apex), height: r3(jump.height), land: r3(jump.land) });
  return {
    creature: "spider",
    source: "Quaternius, Easy Enemy Pack (Jan 2019), Spider.fbx; CC0 1.0",
    units: "metres; +Y up, faces +Z; origin on the ground under the body",
    scale: { atOne: `洞穴巨蛛: leg span ${SPIDER.span} m`, variants: "small spiders: the same asset at scale 0.55" },
    variants: SPIDER.variants,
    materials: { body: "spider_body", eyes: "spider_eyes (emissive: a body tint may cover it, the glow stays)" },
    bones: SPIDER.bones,
    feet: SPIDER.footJoints,
    bounds: { clip: "Spider_Idle@0", min: bounds.min.map(r3), max: bounds.max.map(r3) },
    bindSpan: r3(span.max[0] - span.min[0]),
    clips,
  };
}

// ------------------------------------------------------------------ wolf

export async function buildWolfDoc(SRC) {
  const dir = path.join(SRC, WOLF.dir);
  const files = [...new Set([WOLF.base, ...Object.values(WOLF.clips).map((c) => c.file), WOLF.texture, WOLF.textureBrown])];
  for (const f of files)
    await fs.access(path.join(dir, f)).catch(() => {
      throw new Error(`creatures: assets-src/${WOLF.dir}/${f} is missing: run node tools/fetch-extra.mjs`);
    });
  const doc = await io.read(path.join(dir, WOLF.base));
  const root = doc.getRoot();
  const skin = root.listSkins()[0];
  if (root.listSkins().length !== 1 || root.listMeshes().length !== 1) throw new Error(`creatures: ${WOLF.base}: expected one skinned mesh`);
  const jointNames = skin.listJoints().map((j) => j.getName());
  const ibm0 = skin.getInverseBindMatrices().getArray();
  const rest0 = new Map(root.listNodes().map((n) => [n.getName(), [...n.getTranslation(), ...n.getRotation(), ...n.getScale()]]));
  for (const a of root.listAnimations()) disposeAnimation(a);

  // every clip glb: the same skeleton (joint order, inverse bind matrices, rest pose) as the base
  const sources = new Map();
  for (const f of new Set(Object.values(WOLF.clips).map((c) => c.file))) {
    const src = await io.read(path.join(dir, f));
    const s = src.getRoot().listSkins()[0];
    const names = s?.listJoints().map((j) => j.getName()) ?? [];
    if (names.join() !== jointNames.join()) throw new Error(`creatures: ${f}: its skeleton's joints differ from ${WOLF.base}'s`);
    if (maxDiff(Array.from(s.getInverseBindMatrices().getArray()), Array.from(ibm0)) > 1e-5) throw new Error(`creatures: ${f}: its inverse bind matrices differ from ${WOLF.base}'s`);
    for (const n of src.getRoot().listNodes()) {
      const r = rest0.get(n.getName());
      if (!r || maxDiff([...n.getTranslation(), ...n.getRotation(), ...n.getScale()], r) > 1e-5) throw new Error(`creatures: ${f}: node ${n.getName()} has another rest pose than in ${WOLF.base}`);
    }
    const anims = src.getRoot().listAnimations();
    if (anims.length !== 1) throw new Error(`creatures: ${f}: expected one clip, got ${anims.length}`);
    sources.set(f, anims[0]);
  }

  const top0 = nodeNamed(doc, "Wolf"), meshNode = nodeNamed(doc, "Wolf_mesh"), bone = nodeNamed(doc, "Bone");
  const rootJoint = skin.listJoints().find((j) => !skin.listJoints().includes(j.getParentNode()));
  if (rootJoint !== bone) throw new Error("creatures: wolf: the skeleton root is not Bone");
  for (const [name, spec] of Object.entries(WOLF.clips)) {
    const src = sources.get(spec.file);
    // rotation-only: every joint keeps its rest translation and scale except the root joint, which moves the body
    const keep = WOLF.rotationOnly || spec.rotationOnly ? (n, p) => p === "rotation" || n === bone : undefined;
    copyClip(doc, src, name, { from: spec.from, to: spec.to, keep });
  }
  const copied = root.listAnimations().length;
  const filled = fillMissingChannels(doc);

  // fold the 0.6 top-node scale and the size into the root joint (after baking the clips' constant 1.667
  // root-joint scale into its rest pose); the top node becomes the identity
  const baked = bakeStaticChannels(doc);
  if (!same("translation", top0.getTranslation(), [0, 0, 0], 1e-6) || !same("rotation", top0.getRotation(), [0, 0, 0, 1], 1e-6) || !same("translation", meshNode.getMatrix(), compose([0, 0, 0], [0, 0, 0, 1], [1, 1, 1]), 1e-6))
    throw new Error("creatures: wolf: Wolf/Wolf_mesh are not plain scale/identity nodes");
  const s0 = top0.getScale();
  if (maxDiff(s0, [s0[0], s0[0], s0[0]]) > 1e-6) throw new Error("creatures: wolf: the Wolf node's scale is not uniform");
  const boneScale = bone.getScale();
  if (maxDiff(boneScale, [boneScale[0], boneScale[0], boneScale[0]]) > 1e-4) throw new Error("creatures: wolf: the root joint's (baked) scale is not uniform");
  const unit = s0[0] * boneScale[0]; // scene units per 0 A.D. unit as the clips play
  const size = WOLF.metresPerUnit * WOLF.giant;
  scaleJoint(doc, bone, (s0[0] * size) / unit);
  top0.setScale([1, 1, 1]).setName("wolf");
  meshNode.setName("wolf_mesh");
  meshNode.getMesh().setName("wolf_mesh");
  const G = bakeMeshSpace(doc, meshNode);
  if (!G) console.log("  wolf: rest pose is not the bind pose; vertices left in bind space");
  const fits = Object.entries(WOLF.clips).filter(([, c]) => c.groundFit).map(([n]) => `${n} ${groundFit(doc, root.listAnimations().find((a) => a.getName() === n), bone)}`);

  // material: grey fur, opaque, single-sided
  const png = await sharp(await fs.readFile(path.join(dir, WOLF.texture))).removeAlpha().png().toBuffer();
  const tex = await ktxTexture(doc, "wolf_fur", png, "colorHQ", WOLF.textureSize);
  const mat = doc.createMaterial("wolf_fur").setBaseColorTexture(tex).setBaseColorFactor([1, 1, 1, 1]).setMetallicFactor(0).setRoughnessFactor(0.85).setAlphaMode("OPAQUE").setDoubleSided(false);
  for (const p of meshNode.getMesh().listPrimitives()) {
    if (!p.getAttribute("TEXCOORD_0")) throw new Error("creatures: wolf mesh has no TEXCOORD_0");
    p.setMaterial(mat);
  }

  const flips = fixQuatSigns(doc);
  const channels = assertChannelSets(doc);
  const weights = normalizeWeights(doc);
  const closed = root.listAnimations().filter((a) => WOLF.clips[a.getName()].loop && closeLoop(doc, a, jointNames, WOLF.loopClose).dt).map((a) => `${a.getName()} (gap ${r3(closings.get(a).gap)} m, frame step ≤ ${r3(closings.get(a).step)} m)`);
  console.log(`  wolf: ${copied} clips from ${sources.size} files${WOLF.rotationOnly ? ", rotation-only" : ""}${filled ? ` (${filled} rest channels added to rotation-only clips)` : ""}; ground fit (root shift range, m): ${fits.join(", ")}; 0 A.D. unit ×${r4(unit)} in the clips -> ${r4(size)} m (×${WOLF.giant} of ${WOLF.metresPerUnit} m); ${baked} static channels baked, ${channels} animated, ${flips} quaternion keys flipped, ${weights} vertex weights normalised${closed.length ? `; loops closed (one key appended): ${closed.join(", ")}` : ""}${G ? "" : "; mesh in bind space"}`);
  return doc;
}

/** Checks and measurements on a built wolf document; returns the extras. */
function wolfInfo(doc) {
  const root = doc.getRoot();
  const anim = (n) => root.listAnimations().find((a) => a.getName() === n);
  const idle = anim("Idle");
  const bounds = skinnedBounds(doc, idle, 0);
  const [head, tail] = positions(doc, idle, 0, [WOLF.bones.head, WOLF.bones.tail]);
  if (!(head[2] > tail[2])) throw new Error("creatures: wolf does not face +Z");
  if (Math.abs(bounds.min[1]) > 0.03) throw new Error(`creatures: wolf's feet are ${r3(bounds.min[1])} m off the ground in Idle`);
  const allJoints = root.listSkins()[0].listJoints().map((j) => j.getName());
  const clips = {};
  for (const [name, spec] of Object.entries(WOLF.clips)) {
    const a = anim(name);
    if (!a) throw new Error(`creatures: wolf clip ${name} was not built`);
    const c = (clips[name] = { duration: r4(clipDuration(a)), loop: spec.loop, source: spec.file.replace(/\.glb$/, "") + (spec.from !== undefined ? `@${spec.from}-${spec.to}` : "") });
    if (spec.loop) Object.assign(c, loopExtras(doc, a, allJoints));
    c.lowest = floorCheck(doc, a, spec.lowest ?? WOLF.minLowest);
  }
  for (const n of ["Attack1", "Attack2"]) {
    const s = strike(doc, anim(n), WOLF.bones.jaw);
    const r = rear(doc, anim(n), WOLF.feet.slice(0, 2));
    Object.assign(clips[n], { rear: r3(r.rear), pawsUp: r3(r.height), pawsDown: r3(r.land), snap: r3(s.snap), strike: r3(s.t), reach: r3(s.z) });
  }
  clips.Walk.groundSpeed = r3(groundSpeed(doc, anim("Walk"), WOLF.feet, 0.04));
  clips.Run.groundSpeed = r3(groundSpeed(doc, anim("Run"), WOLF.feet, 0.04));
  // the joins the runtime makes: lie down -> sleep -> stand up -> idle (largest joint jump, m)
  const join = (a, b) => {
    const A = positions(doc, anim(a), clipDuration(anim(a)), allJoints), B = positions(doc, anim(b), 0, allJoints);
    return r3(Math.max(...A.map((p, i) => dist(p, B[i]))));
  };
  const joins = { "LieDown>Sleep": join("LieDown", "Sleep"), "Sleep>StandUp": join("Sleep", "StandUp"), "StandUp>Idle": join("StandUp", "Idle"), "Idle>LieDown": join("Idle", "LieDown") };
  for (const [k, d] of Object.entries(joins).slice(0, 2)) if (d > 0.02) throw new Error(`creatures: wolf ${k} jumps ${d} m`);
  return {
    creature: "wolf",
    source: "0 A.D. wolf (Wildfire Games), CC BY-SA 3.0, via ZeroAD-Godot; modified (merged, re-timed, cut, rescaled, retextured), also CC BY-SA 3.0",
    units: "metres; +Y up, faces +Z; origin on the ground under the body",
    scale: { atOne: `巨狼: the 0 A.D. wolf ×${WOLF.giant} (${WOLF.metresPerUnit} m per 0 A.D. unit natural)`, metresPerUnit: r4(WOLF.metresPerUnit * WOLF.giant) },
    materials: { fur: "wolf_fur (base colour texture wolf_fur, grey); creatures/wolf_fur_brown is the brown skin on the same UVs" },
    bones: WOLF.bones,
    feet: WOLF.feet,
    bounds: { clip: "Idle@0", min: bounds.min.map(r3), max: bounds.max.map(r3) },
    clips,
    joins,
  };
}

// ------------------------------------------------------------------ build

/** The creature documents before finalize (previews, checks). */
export async function buildCreatureDocs(SRC) {
  return { spider: await buildSpiderDoc(SRC), wolf: await buildWolfDoc(SRC) };
}

export async function buildCreatures({ emit, SRC }) {
  const { spider, wolf } = await buildCreatureDocs(SRC);
  for (const [doc, info, spec] of [[spider, spiderInfo, SPIDER], [wolf, wolfInfo, WOLF]]) {
    const x = info(doc);
    const top = doc.getRoot().listScenes()[0].listChildren()[0];
    top.setExtras(x);
    const glb = await finalize(doc);
    // check what ships: the finalised file (resampled, quantised) still holds the clips, the root layout and the size
    const back = await io.readBinary(new Uint8Array(glb));
    const tops = back.getRoot().listScenes()[0].listChildren();
    if (tops.length !== 1 || tops[0].getName() !== x.creature || maxDiff(tops[0].getMatrix(), compose([0, 0, 0], [0, 0, 0, 1], [1, 1, 1])) > 1e-6) throw new Error(`creatures: ${spec.id}: the top node is not one identity node "${x.creature}"`);
    const got = back.getRoot().listAnimations().map((a) => a.getName()).sort().join();
    if (got !== Object.keys(spec.clips).sort().join()) throw new Error(`creatures: ${spec.id} ships clips ${got}`);
    const idleName = x.creature === "spider" ? "Spider_Idle" : "Idle";
    const b = skinnedBounds(back, back.getRoot().listAnimations().find((a) => a.getName() === idleName), 0);
    if (maxDiff(b.min, x.bounds.min) > 0.01 || maxDiff(b.max, x.bounds.max) > 0.01) throw new Error(`creatures: ${spec.id}: shipped bounds ${b.min.map(r3)}..${b.max.map(r3)} differ from the source's`);
    const tris = back.getRoot().listMeshes().flatMap((m) => m.listPrimitives()).reduce((s, p) => s + p.getIndices().getCount() / 3, 0);
    const clipLog = Object.entries(x.clips).map(([n, c]) => `${n} ${c.duration}s${c.closeGap !== undefined ? ` loop gap ${c.closeGap} (frame step ≤ ${c.frameStep})${c.closeDt ? ` closed +${c.closeDt}s` : ""}` : ""}${c.groundSpeed !== undefined ? ` ${c.groundSpeed} m/s` : ""}${c.rear !== undefined ? ` rear@${c.rear} (+${c.pawsUp} m) paws down@${c.pawsDown}` : ""}${c.strike !== undefined ? ` snap@${c.snap} strike@${c.strike} reach ${c.reach} m` : ""}${c.apex !== undefined ? ` apex@${c.apex} +${c.height} m land@${c.land}` : ""} low ${c.lowest}`);
    console.log(`  ${spec.id}: ${tris} tris, ${back.getRoot().listSkins()[0].listJoints().length} joints, bounds ${x.bounds.min.map(r3)}..${x.bounds.max.map(r3)}`);
    console.log(`    clips: ${clipLog.join(" · ")}`);
    if (x.joins) console.log(`    joins: ${Object.entries(x.joins).map(([k, d]) => `${k} ${d} m`).join(", ")}`);
    await emit(spec.id, { segment: spec.segment, priority: spec.priority, type: "glb", ext: "glb", data: glb, pos: spec.pos });
  }
  const brown = await sharp(await fs.readFile(path.join(SRC, WOLF.dir, WOLF.textureBrown))).removeAlpha().png().toBuffer();
  await emit("creatures/wolf_fur_brown", { segment: EXIT_SEGMENT, priority: 40, type: "ktx2", ext: "ktx2", data: await toKTX2(brown, { preset: "colorHQ", maxSize: WOLF.textureSize }), pos: WOLF.pos });
}
