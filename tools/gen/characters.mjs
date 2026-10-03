// Characters: Quaternius Universal Base Characters + Modular Outfits (Fantasy) + Universal Animation
// Library (all CC0, same 65-joint skeleton). Everything is merged onto one skeleton so the runtime can
// show/hide parts per NPC and play shared animation clips retargeted by bone name.
//
// Output:
//   chars/male       one skeleton with parts: outfit_ranger_*, outfit_peasant_*, head, eyes, brows, hair_*
//   chars/anim_base  animation clips only (no meshes)
//   chars/horse      0 A.D. horse (CC-BY-SA 3.0, Wildfire Games) with walk clip
import path from "node:path";
import fs from "node:fs/promises";
import { mergeDocuments, unpartition, prune } from "@gltf-transform/functions";
import { io, compressTextures, finalize, ktxTexture } from "../lib/gltf.mjs";

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

function disposeAnimation(a) {
  for (const c of a.listChannels()) c.dispose();
  for (const s of a.listSamplers()) s.dispose();
  a.dispose();
}

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
  // full UAL1/UAL2 clip sets when available (same skeleton), else the free "Standard" packs
  const full = await fs.access(path.join(C, "anim_full/UAL2.glb")).then(() => true, () => false);
  const anim = await io.read(path.join(C, full ? "anim_full/UAL1.glb" : "anim/UAL1_Standard.glb"));
  const anim2 = await io.read(path.join(C, full ? "anim_full/UAL2.glb" : "anim/UAL2_Standard.glb"));
  for (const a of anim2.getRoot().listAnimations()) if (!KEEP_CLIPS_2.includes(a.getName())) disposeAnimation(a);
  const keepIn2 = new Set(anim2.getRoot().listAnimations());
  if (keepIn2.size) {
    // merge UAL2 clips, retargeting their channels to UAL1 nodes by name
    const byName = new Map(anim.getRoot().listNodes().map((n) => [n.getName(), n]));
    const map = mergeDocuments(anim, anim2);
    for (const a of keepIn2) {
      const ca = map.get(a);
      for (const ch of ca.listChannels()) {
        const t = byName.get(ch.getTargetNode()?.getName());
        if (t) ch.setTargetNode(t);
        else ch.dispose();
      }
    }
    for (const s of anim.getRoot().listScenes().slice(1)) {
      s.traverse((n) => n !== s && n.dispose());
      s.dispose();
    }
  }
  for (const a of anim.getRoot().listAnimations()) {
    if (![...KEEP_CLIPS, ...KEEP_CLIPS_2].includes(a.getName())) {
      disposeAnimation(a);
      continue;
    }
    // Scale never changes and only root/pelvis translate; per-bone translations would also fight
    // the slightly different proportions of each outfit/body, so keep rotations only.
    for (const c of a.listChannels()) {
      const keepT = c.getTargetPath() === "translation" && ["root", "pelvis"].includes(c.getTargetNode()?.getName());
      if (c.getTargetPath() === "rotation" || keepT) continue;
      const smp = c.getSampler();
      c.dispose();
      smp.dispose();
    }
  }
  for (const n of anim.getRoot().listNodes()) {
    n.setMesh(null);
    n.setSkin(null);
  }
  for (const m of anim.getRoot().listMeshes()) m.dispose();
  for (const s of anim.getRoot().listSkins()) s.dispose();
  await anim.transform(unpartition(), prune({ keepLeaves: true }));
  await emit("chars/anim_base", { segment: "cart", priority: 96, type: "glb", ext: "glb", data: await finalize(anim) });

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
