// Characters: Quaternius Universal Base Characters + Modular Outfits (Fantasy) + Universal Animation
// Library (all CC0, same 65-joint skeleton). Everything is merged onto one skeleton so the runtime can
// show/hide parts per NPC and play shared animation clips retargeted by bone name.
//
// Output:
//   chars/male             one skeleton with parts: outfit_ranger_*, outfit_peasant_*, head, eyes, brows, hair_*
//   chars/anim_base        animation clips only (no meshes), segment cart
//   chars/anim_combat      the keep/exit combat and interaction clips (no meshes), segment keep
//   chars/anim_rootmotion  JSON root-motion curves of the clips in ROOT_MOTION (their root bone is pinned, see rootPin)
//   chars/horse            0 A.D. horse (CC-BY-SA 3.0, Wildfire Games) with walk clip
// Every requested clip must exist in the source library, or the build fails (see animclips.mjs).
import path from "node:path";
import fs from "node:fs/promises";
import { mergeDocuments, unpartition, prune } from "@gltf-transform/functions";
import { io, compressTextures, finalize, ktxTexture } from "../lib/gltf.mjs";
import { pickClips, extractRootMotion, restDeviation, jointPositions, clipDuration } from "./animclips.mjs";

// chars/anim_base (UAL1, then UAL2)
const KEEP_CLIPS = [
  "Sitting_Idle_Loop",
  "Sitting_Talking_Loop",
  "Driving_Loop",
  "Idle_Loop",
  "Idle_Talking_Loop",
  "Walk_Loop",
  "Walk_Formal_Loop",
  "Jog_Fwd_Loop",
  "Death01",
  "Hit_Chest",
  "Hit_Head",
  "Sprint_Loop",
  "Jump_Start",
  "Jump_Loop",
  "Jump_Land",
  "Crouch_Idle_Loop",
  "Crouch_Fwd_Loop",
  "Interact",
  "Fixing_Kneeling",
  "Sitting_Exit",
  "Spell_Simple_Idle_Loop",
  "Sword_Idle",
  "Idle_Torch_Loop",
  "Death02",
  "Crying",
  "GroundSit_Idle_Loop",
  "PickUp_Kneeling",
  "Idle_LookAround_Loop",
  "Idle_Tired_Loop",
  "Hit_Stomach",
  "Walk_Formal_Loop",
  "Turn90_L",
  "Turn90_R",
];
const KEEP_CLIPS_2 = [
  "Idle_FoldArms_Loop", "Idle_No_Loop", "Yes", "LayToIdle", "IdleToLay", "Hit_Knockback", "Idle_Shield_Loop", "Sword_Block",
  "Idle_Rail_Loop", "Idle_Rail_Call", "OverhandThrow", "Bow_Notch", "Bow_Aim_Neutral", "Bow_Shoot", "Surprise", "KipUp",
  "Walk_Carry_Loop", "LiftAir_Fall_Impact",
];
// chars/anim_combat (design keep-exit-chapters.md §3.4; 44 clips). PickUp_Table lives in UAL1, not UAL2.
const COMBAT_CLIPS_1 = [
  "Sword_Enter", "Sword_Exit", "Sword_Attack", "Hit_Shoulder_L", "Hit_Shoulder_R", "Push_Enter", "Push_Loop", "Push_Exit",
  "Punch_Jab", "Punch_Cross", "Kick", "Crouch_Enter", "Crouch_Exit", "Crouch_Bwd_Loop", "Crouch_Left_Loop", "Crouch_Right_Loop",
  "Jog_Left_Loop", "Jog_Right_Loop", "Jog_Bwd_Loop", "PickUp_Table",
];
const COMBAT_CLIPS_2 = [
  "Sword_Light_A", "Sword_Light_A_Rec", "Sword_Light_B", "Sword_Light_B_Rec", "Sword_Light_C", "SwordLight_C_Rec",
  "Sword_Regular_A", "Sword_Regular_A_Rec", "Sword_Regular_B", "Sword_Regular_B_Rec", "Sword_Heavy_A", "Sword_Heavy_A_Rec",
  "Sword_Dash_RM", "Shield_OneShot", "Idle_Shield_Break", "Walk_L_Loop", "Walk_R_Loop", "Walk_Bwd_Loop", "Bandage_Loop",
  "Chest_Open", "Consume", "Farm_PickingTree", "Bow_Aim_Up", "Bow_Aim_Down",
];
// UAL2 cut its Sword_* segments out of baked combos, so their root keeps absolute offsets (up to 2 m
// at the start of a clip). Their root motion goes to the sidecar and the root bone is pinned (rootPin);
// the runtime moves the controller along the curve instead.
const ROOT_MOTION = new Set([...COMBAT_CLIPS_2.filter((n) => n.startsWith("Sword")), "Sword_Block"]);
// Where the root bone of a ROOT_MOTION clip is pinned (model space, m). The UAL2 sword set stands its root
// 7.58 cm behind the origin and bakes a matching +7.58 cm forward offset into the pelvis and leg pose:
// Sword_Block holds root z = -0.07584 throughout, Sword_Heavy_A starts there, and the _Rec clips (root 0 or
// rebased) end 7.6-7.9 cm ahead of Idle_Loop's footprint relative to their root. Pinning at rest (0) would
// put all of them 7.6 cm ahead of Idle_Loop and the capsule. So they are pinned at that static offset, read
// from Sword_Block (SWORD_ROOT_FROM), which then ships unchanged. Sword_Dash_RM starts at root 0 like Idle_Loop.
// The curve does not depend on the pin. checkPoses() verifies the pins by forward kinematics, and all clips
// of one chain (CHAINS) must share a pin, or every join would jump by the difference.
const SWORD_ROOT_FROM = "Sword_Block";
const ROOT_PIN = { Sword_Dash_RM: [0, 0, 0] }; // default: the sword-set offset

// Footprint check (FK on the built files, capsule-local because the root is pinned): each pose must stand on
// Idle_Loop's frame-0 footprint, which Sword_Idle and Idle_Shield_Loop share. Measured on ball_l / ball_r
// (horizontal distance). The supporting (nearer) foot must be within FOOT_TOL: a wrong pin moves both feet,
// a swing foot moves one (Sword_Light_A's left foot is already 6 cm into its step at frame 0). Both are logged.
const FOOT_REF = ["Idle_Loop", 0];
const FOOT_TOL = 0.01;
const FOOTPRINTS = [
  ["Sword_Idle", 0], ["Idle_Shield_Loop", 0],
  ["Sword_Block", 0], ["Sword_Block", 0.4], ["Sword_Block", "end"], // 0.4 s: the held guard (design §8)
  ["Sword_Light_A", 0], ["Sword_Regular_A", 0], ["Sword_Heavy_A", 0], ["Sword_Dash_RM", 0],
  ["Sword_Light_A_Rec", "end"], ["Sword_Light_B_Rec", "end"], ["SwordLight_C_Rec", "end"],
  ["Sword_Regular_A_Rec", "end"], ["Sword_Regular_B_Rec", "end"], ["Sword_Heavy_A_Rec", "end"], ["Sword_Dash_RM", "end"],
];
// Declared chains: end of the first clip -> start of the second, with the controller carried along the curve
// (so capsule-local poses are compared). A join's pop is the distance from the second clip's first frame to the
// first clip's last frame or to its one-frame extrapolation, whichever is smaller: UAL2 cut its pieces one frame
// apart, which during a fast swing moves the hand 10-12 cm without being a pop. The build reports the largest
// pop of each join and fails on one over CHAIN_TOL unless it is listed in CHAIN_POPS, which the design appendix
// documents for the runtime.
const CHAINS = [
  ["Sword_Light_A", "Sword_Light_B"], ["Sword_Light_B", "Sword_Light_C"],
  ["Sword_Light_A", "Sword_Light_A_Rec"], ["Sword_Light_B", "Sword_Light_B_Rec"], ["Sword_Light_C", "SwordLight_C_Rec"],
  ["Sword_Regular_A", "Sword_Regular_B"], ["Sword_Regular_A", "Sword_Regular_A_Rec"], ["Sword_Regular_B", "Sword_Regular_B_Rec"],
  ["Sword_Heavy_A", "Sword_Heavy_A_Rec"],
];
const CHAIN_JOINTS = ["pelvis", "ball_l", "ball_r", "hand_r"];
const CHAIN_TOL = 0.1;
const SRC_FRAME = 1 / 30; // UAL key rate
const CHAIN_POPS = {
  // no frame of Sword_Light_C matches SwordLight_C_Rec's first pose, and the other exits are further away
  "Sword_Light_C>SwordLight_C_Rec": "UAL2 source pose discontinuity (pelvis ~0.21 m, ball_l ~0.18 m, hand_r ~0.42 m); cross-fade >= 0.2 s",
};

function findSkin(doc) {
  const skins = doc.getRoot().listSkins();
  if (skins.length !== 1) throw new Error(`expected one skin, got ${skins.length}`);
  return skins[0];
}
const jointNames = (skin) => skin.listJoints().map((j) => j.getName());

/** Merge every skinned mesh node from `src` into `dst`, re-pointing it at `dst`'s skin. */
function mergeParts(dst, src, rename) {
  const dstSkin = findSkin(dst);
  const srcSkin = findSkin(src);
  const a = jointNames(dstSkin), b = jointNames(srcSkin);
  if (a.length !== b.length || a.some((n, i) => n !== b[i])) throw new Error("skeleton mismatch");
  const map = mergeDocuments(dst, src);
  const dstScene = dst.getRoot().listScenes()[0];
  const copiedScene = map.get(src.getRoot().listScenes()[0]);
  const meshNodes = [];
  copiedScene.traverse((n) => {
    if (n.getMesh() && n.getSkin()) meshNodes.push(n);
  });
  for (const n of meshNodes) {
    n.detach();
    n.setSkin(dstSkin);
    n.setName(rename(n.getName() || n.getMesh().getName()));
    dstScene.addChild(n);
  }
  // drop the copied armature
  copiedScene.traverse((n) => n !== copiedScene && n.dispose());
  copiedScene.dispose();
  map.get(srcSkin).dispose();
  return meshNodes;
}

/** Keep only triangles weighted to the head / neck. */
function cutHead(doc, nodeName) {
  const skin = findSkin(doc);
  const names = jointNames(skin);
  const keepJ = new Set(["Head", "neck_01"].map((n) => names.indexOf(n)));
  const node = doc.getRoot().listNodes().find((n) => n.getName() === nodeName);
  for (const prim of node.getMesh().listPrimitives()) {
    const J = prim.getAttribute("JOINTS_0"), W = prim.getAttribute("WEIGHTS_0");
    const idx = prim.getIndices();
    const headW = (v) => {
      const j = J.getElement(v, []), w = W.getElement(v, []);
      let s = 0;
      for (let k = 0; k < 4; k++) if (keepJ.has(j[k])) s += w[k];
      return s;
    };
    const out = [];
    const arr = idx.getArray();
    for (let t = 0; t < arr.length; t += 3) {
      if (headW(arr[t]) > 0.5 && headW(arr[t + 1]) > 0.5 && headW(arr[t + 2]) > 0.5) out.push(arr[t], arr[t + 1], arr[t + 2]);
    }
    idx.setArray(new Uint32Array(out));
  }
}

/** The constant root translation that `clip` holds in `doc` (throws if it moves). */
function staticRootOffset(doc, clip) {
  const a = doc.getRoot().listAnimations().find((x) => x.getName() === clip);
  const ch = a?.listChannels().find((c) => c.getTargetNode()?.getName() === "root" && c.getTargetPath() === "translation");
  if (!ch) throw new Error(`${clip} has no root translation to take the static root offset from`);
  const V = ch.getSampler().getOutput().getArray();
  for (let i = 3; i < V.length; i++) if (V[i] !== V[i % 3]) throw new Error(`${clip}'s root translation is not constant`);
  return Array.from(V.subarray(0, 3));
}

/** Footprint check and chain-join report on the built clip files (see FOOTPRINTS and CHAINS). */
function checkPoses(docs) {
  const clip = (name) => {
    for (const doc of docs) {
      const anim = doc.getRoot().listAnimations().find((a) => a.getName() === name);
      if (anim) return { doc, anim };
    }
    throw new Error(`pose check: no clip ${name}`);
  };
  const pose = (name, t, joints) => {
    const { doc, anim } = clip(name);
    return jointPositions(doc, anim, t === "end" ? clipDuration(anim) : t, joints);
  };
  const flat = (a, b) => Math.hypot(a[0] - b[0], a[2] - b[2]);
  const cm = (x) => (x * 100).toFixed(1);

  const FEET = ["ball_l", "ball_r"];
  const ref = pose(...FOOT_REF, FEET);
  const feetBad = [], feetLog = [];
  for (const [name, t] of FOOTPRINTS) {
    const d = pose(name, t, FEET).map((p, i) => flat(p, ref[i]));
    const label = `${name}@${t}`;
    feetLog.push(`${label} ${cm(d[0])}/${cm(d[1])}`);
    if (Math.min(...d) > FOOT_TOL) feetBad.push(`${label} (ball_l ${cm(d[0])} cm, ball_r ${cm(d[1])} cm)`);
  }
  console.log(`  footprints vs ${FOOT_REF.join("@")} (ball_l/ball_r, cm): ${feetLog.join(", ")}`);
  if (feetBad.length) throw new Error(`poses off ${FOOT_REF[0]}'s footprint by more than ${FOOT_TOL} m (check rootPin): ${feetBad.join("; ")}`);

  const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
  const chainBad = [], chainLog = [];
  for (const [a, b] of CHAINS) {
    const end = clipDuration(clip(a).anim);
    const pa = pose(a, end, CHAIN_JOINTS), pa1 = pose(a, end - SRC_FRAME, CHAIN_JOINTS), pb = pose(b, 0, CHAIN_JOINTS);
    const d = pa.map((p, i) => Math.min(dist(p, pb[i]), dist(p.map((x, k) => 2 * x - pa1[i][k]), pb[i])));
    const worst = d.indexOf(Math.max(...d));
    const key = `${a}>${b}`;
    chainLog.push(`${key} ${cm(d[worst])} (${CHAIN_JOINTS[worst]})`);
    if (d[worst] > CHAIN_TOL && !CHAIN_POPS[key]) chainBad.push(`${key}: ${CHAIN_JOINTS.map((j, i) => `${j} ${cm(d[i])} cm`).join(", ")}`);
    if (d[worst] > CHAIN_TOL && CHAIN_POPS[key]) console.log(`  known pop ${key}: ${CHAIN_POPS[key]}`);
    if (d[worst] <= CHAIN_TOL && CHAIN_POPS[key]) console.log(`  note: ${key} is listed in CHAIN_POPS but now joins within ${CHAIN_TOL} m`);
  }
  console.log(`  chain joins, largest pop (cm): ${chainLog.join(", ")}`);
  if (chainBad.length) throw new Error(`chained clips jump more than ${CHAIN_TOL} m (fix, or document in CHAIN_POPS): ${chainBad.join("; ")}`);
}

export async function buildCharacters({ emit, SRC }) {
  const C = path.join(SRC, "chars");
  // --- bodies (male + female share part names so outfits/hair presets work for both)
  const FEMALE_RENAME = { Acc_Pauldrons: "Acc_Pauldron", Feet: "Feet_Boots", Body_Belt_2: "Body_Belt_1.001" };
  const bodies = [
    { id: "chars/male", sex: "Male", head: "Superhero_Male", hair: ["Hair_SimpleParted", "Hair_Beard", "Hair_Buzzed", "Hair_Long"], segment: "cart", priority: 97 },
    { id: "chars/female", sex: "Female", head: "Superhero_Female", hair: ["Hair_Long", "Hair_Buns", "Hair_BuzzedFemale"], segment: "muster", priority: 92 },
  ];
  for (const b of bodies) {
    const ren = (prefix, n) => {
      let part = n.replace(new RegExp(`^${b.sex}_(Ranger|Peasant)_`), "");
      if (b.sex === "Female") part = FEMALE_RENAME[part] ?? part;
      return prefix + part;
    };
    const doc = await io.read(path.join(C, `outfits/${b.sex}_Ranger.gltf`));
    doc.getRoot().listNodes().forEach((n) => {
      if (n.getMesh()) n.setName(ren("outfit_ranger_", n.getName()));
    });
    mergeParts(doc, await io.read(path.join(C, `outfits/${b.sex}_Peasant.gltf`)), (n) => ren("outfit_peasant_", n));
    const headDoc = await io.read(path.join(C, `base/${b.head}_FullBody.gltf`));
    cutHead(headDoc, b.head === "Superhero_Male" ? "SuperHero_Male" : "Superhero_Female");
    mergeParts(doc, headDoc, (n) => ({ SuperHero_Male: "head", Superhero_Female: "head", Eyes: "eyes", Eyebrows: "brows" })[n] ?? n);
    for (const h of b.hair) mergeParts(doc, await io.read(path.join(C, `hair/${h}.gltf`)), () => h.toLowerCase());
    // The Quaternius palette is bright/saturated; mute it toward the grey-brown northern look.
    for (const m of doc.getRoot().listMaterials()) {
      const f = m.getBaseColorFactor();
      const name = m.getName();
      const k = /Eye/.test(name) ? 1 : /Hair/.test(name) ? 0.7 : /Peasant|Ranger/.test(name) ? 0.78 : 0.9;
      m.setBaseColorFactor([f[0] * k, f[1] * k * 0.98, f[2] * k * 0.95, f[3]]);
    }
    await doc.transform(unpartition(), prune());
    await compressTextures(doc, 1024, 512, 512);
    await emit(b.id, { segment: b.segment, priority: b.priority, type: "glb", ext: "glb", data: await finalize(doc) });
  }

  // --- animation clips
  // Full UAL1/UAL2 clip sets (same skeleton). The free "Standard" packs lack most of the clips, so with
  // them the clip check below fails the build instead of silently shipping a smaller set.
  const full = await fs.access(path.join(C, "anim_full/UAL2.glb")).then(() => true, () => false);
  const hint = full ? "" : "(assets-src/chars/anim_full/UAL*.glb are missing and the Standard packs lack these: run node tools/fetch-extra.mjs)";
  const rootMotion = {};
  const UAL1 = path.join(C, full ? "anim_full/UAL1.glb" : "anim/UAL1_Standard.glb");
  const UAL2 = path.join(C, full ? "anim_full/UAL2.glb" : "anim/UAL2_Standard.glb");
  let swordRoot;
  const rootPin = (clip) => ROOT_PIN[clip] ?? swordRoot;
  const clipDoc = async (id, clips1, clips2, { strictInPlace }) => {
    const ual1 = await io.read(UAL1);
    const ual2 = await io.read(UAL2);
    swordRoot ??= full ? staticRootOffset(ual2, SWORD_ROOT_FROM) : null; // without the full set, pickClips fails below
    // Scale never changes and only root/pelvis translate; per-bone translations would also fight
    // the slightly different proportions of each outfit/body, so keep rotations only.
    const doc = pickClips(
      [{ doc: ual1, clips: clips1, label: "UAL1" }, { doc: ual2, clips: clips2, label: "UAL2" }],
      { keepTranslation: ["root", "pelvis"], hint },
    );
    const root = doc.getRoot().listNodes().find((n) => n.getName() === "root");
    const moving = [];
    for (const a of doc.getRoot().listAnimations()) {
      if (ROOT_MOTION.has(a.getName())) {
        rootMotion[a.getName()] = { asset: id, ...extractRootMotion(a, root, { pin: rootPin(a.getName()) }) };
        continue;
      }
      const d = restDeviation(a, root);
      if (d.translation > 1e-3 || d.rotation > 0.1) moving.push(`${a.getName()} (${d.translation.toFixed(3)} m, ${d.rotation.toFixed(1)} deg)`);
    }
    if (moving.length && strictInPlace) throw new Error(`${id}: root moves in clips without root-motion extraction: ${moving.join(", ")}`);
    if (moving.length) console.log(`  ${id}: root motion left in the clip: ${moving.join(", ")}`);
    await doc.transform(unpartition(), prune({ keepLeaves: true }));
    const secs = doc.getRoot().listAnimations().reduce((s, a) => s + Math.max(...a.listSamplers().map((x) => x.getInput().getMax([])[0])), 0);
    console.log(`  ${id}: ${doc.getRoot().listAnimations().length} clips, ${secs.toFixed(1)} s, ${doc.getRoot().listNodes().length} nodes`);
    return doc;
  };
  const BASE_CLIPS_1 = [...new Set(KEEP_CLIPS)];
  const shared = [...BASE_CLIPS_1, ...KEEP_CLIPS_2].filter((n) => [...COMBAT_CLIPS_1, ...COMBAT_CLIPS_2].includes(n));
  if (shared.length) throw new Error(`chars/anim_combat repeats chars/anim_base clips: ${shared.join(", ")}`);
  const baseData = await finalize(await clipDoc("chars/anim_base", BASE_CLIPS_1, KEEP_CLIPS_2, { strictInPlace: false }));
  const combatData = await finalize(await clipDoc("chars/anim_combat", COMBAT_CLIPS_1, COMBAT_CLIPS_2, { strictInPlace: true }));
  const chainPins = CHAINS.filter(([a, b]) => rootPin(a).some((x, i) => x !== rootPin(b)[i]));
  if (chainPins.length) throw new Error(`chained clips pin their root differently: ${chainPins.map((c) => c.join(" > ")).join(", ")}`);
  // check what ships: the files as the runtime reads them (resampled, meshopt-compressed)
  checkPoses([await io.readBinary(new Uint8Array(baseData)), await io.readBinary(new Uint8Array(combatData))]);
  const fmtPin = (v) => `(${v.map((x) => +x.toFixed(5)).join(", ")})`;
  console.log(`  root pins: ${Object.entries(ROOT_PIN).map(([n, v]) => `${n} ${fmtPin(v)}`).join(", ")}, other ROOT_MOTION clips ${fmtPin(swordRoot)} (${SWORD_ROOT_FROM})`);
  await emit("chars/anim_base", { segment: "cart", priority: 96, type: "glb", ext: "glb", data: baseData });
  const KEEP_POS = [60, -662];
  await emit("chars/anim_combat", { segment: "keep", priority: 94, type: "glb", ext: "glb", data: combatData, pos: KEEP_POS });

  const missingRM = [...ROOT_MOTION].filter((n) => !rootMotion[n]);
  if (missingRM.length) throw new Error(`root motion not extracted for ${missingRM.join(", ")}`);
  const order = [...ROOT_MOTION];
  const rm = {
    version: 1,
    bone: "root",
    space: "character model space (+Z forward, +X the character's left, +Y up), metres; yaw in radians about +Y, positive turns +Z toward +X; each clip rebased to start at 0 in its start frame",
    keys: "[t, x, y, z, yaw]",
    clips: Object.fromEntries(order.map((n) => [n, rootMotion[n]])),
  };
  await emit("chars/anim_rootmotion", { segment: "keep", priority: 94, type: "json", ext: "json", data: Buffer.from(JSON.stringify(rm)), pos: KEEP_POS });

  // --- horse
  const horse = await io.read(path.join(SRC, "horse/horse_walk.glb"));
  const tex = await ktxTexture(horse, "horse_brown", await fs.readFile(path.join(SRC, "horse/horse_brown.png")), "colorHQ", 512);
  for (const m of horse.getRoot().listMaterials()) {
    m.setBaseColorTexture(tex).setMetallicFactor(0).setRoughnessFactor(0.75).setBaseColorFactor([1, 1, 1, 1]);
    m.setDoubleSided(false);
  }
  horse.getRoot().listAnimations().forEach((a) => a.setName("Horse_Walk"));
  await horse.transform(unpartition(), prune());
  await emit("chars/horse", { segment: "cart", priority: 96, type: "glb", ext: "glb", data: await finalize(horse) });
}
