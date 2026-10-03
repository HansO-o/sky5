import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import type { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial";
import type { Material } from "@babylonjs/core/Materials/material";
import type { Character } from "./characters";

export type RaceId = "nord" | "imperial" | "redsand" | "woodelf" | "rockborn";
export type Sex = "m" | "f";

export interface Race {
  id: RaceId;
  name: string;
  desc: string;
  /** skin tint at slider 0 (light) and 1 (dark) — multiplies the albedo texture */
  skin: [number[], number[]];
  height: number;
  build: number;
  head: number;
  ears?: boolean;
  /** default hair colour index */
  hairColor: number;
}

/** Original peoples of the northern realm. */
export const RACES: Race[] = [
  { id: "nord", name: "北地人", desc: "生于冰原与峡湾的高大民族，耐寒善战，天生不惧霜雪。", skin: [[1.18, 1.08, 1.02], [0.98, 0.88, 0.8]], height: 1.04, build: 1.05, head: 1, hairColor: 4 },
  { id: "imperial", name: "帝国人", desc: "金狮帝国的子民，精于商贸与律法，足迹遍布各省。", skin: [[1.05, 0.95, 0.86], [0.82, 0.7, 0.6]], height: 1, build: 1, head: 1, hairColor: 1 },
  { id: "redsand", name: "赤沙人", desc: "来自南方赤色沙海的游民，身手敏捷，擅使弯刀。", skin: [[0.66, 0.53, 0.44], [0.4, 0.3, 0.25]], height: 1.01, build: 0.98, head: 1, hairColor: 0 },
  { id: "woodelf", name: "林精灵", desc: "古老林地的守望者，身形修长，弓术冠绝诸族。", skin: [[1.0, 1.0, 0.86], [0.8, 0.8, 0.66]], height: 1.05, build: 0.9, head: 0.97, ears: true, hairColor: 5 },
  { id: "rockborn", name: "岩裔", desc: "山脉深处的部族，筋骨如石，以力量与荣誉立身。", skin: [[0.66, 0.78, 0.58], [0.44, 0.54, 0.4]], height: 1.02, build: 1.15, head: 1.05, hairColor: 0 },
];

export const HAIR_COLORS: { name: string; c: number[] }[] = [
  { name: "乌黑", c: [0.16, 0.14, 0.13] },
  { name: "深褐", c: [0.34, 0.24, 0.16] },
  { name: "栗色", c: [0.55, 0.36, 0.22] },
  { name: "赤铜", c: [0.68, 0.32, 0.17] },
  { name: "金黄", c: [1.05, 0.86, 0.58] },
  { name: "亚麻", c: [0.86, 0.8, 0.66] },
  { name: "灰白", c: [1.1, 1.1, 1.1] },
];

export const HAIR_STYLES: Record<Sex, { part: string; name: string }[]> = {
  m: [
    { part: "hair_simpleparted", name: "分头" },
    { part: "hair_buzzed", name: "短发" },
    { part: "hair_long", name: "长发" },
    { part: "", name: "光头" },
  ],
  f: [
    { part: "hair_long", name: "长发" },
    { part: "hair_buns", name: "盘发" },
    { part: "hair_buzzedfemale", name: "短发" },
  ],
};

export interface Appearance {
  name: string;
  sex: Sex;
  race: RaceId;
  /** sliders, -1..1 */
  height: number;
  build: number;
  head: number;
  /** 0 light .. 1 dark */
  skin: number;
  hair: number;
  hairColor: number;
  beard: boolean;
}

export function defaultAppearance(): Appearance {
  return { name: "", sex: "m", race: "nord", height: 0, build: 0, head: 0, skin: 0.3, hair: 1, hairColor: 4, beard: true };
}

/** Every hair part a player body is created with (style switching only toggles visibility). */
export const ALL_HAIR = ["hair_simpleparted", "hair_buzzed", "hair_long", "hair_beard", "hair_buns", "hair_buzzedfemale"];

const isSkin = (m: Material) => /Superhero|Regular/.test(m.name);
const isHair = (m: Material) => /Hair/.test(m.name);

/**
 * Applies an appearance to a character created with all hair parts. Skin and hair materials are
 * cloned the first time so tinting never affects NPCs sharing the same body asset.
 */
export function applyAppearance(ch: Character, a: Appearance) {
  const race = RACES.find((r) => r.id === a.race)!;
  // unique materials
  const clones = (ch as unknown as { _matClones?: Map<Material, Material> })._matClones ?? new Map<Material, Material>();
  (ch as unknown as { _matClones: Map<Material, Material> })._matClones = clones;
  for (const m of ch.meshes) {
    const mat = m.material;
    if (!mat || (!isSkin(mat) && !isHair(mat))) continue;
    if ([...clones.values()].includes(mat)) continue;
    let c = clones.get(mat);
    if (!c) {
      c = mat.clone(`${mat.name}_${ch.name}`)!;
      clones.set(mat, c);
    }
    m.material = c;
  }
  const lerp = (x: number[], y: number[], t: number) => x.map((v, i) => v + (y[i] - v) * t);
  const skin = lerp(race.skin[0], race.skin[1], a.skin);
  const hair = HAIR_COLORS[a.hairColor]?.c ?? HAIR_COLORS[0].c;
  for (const c of clones.values()) {
    const pbr = c as PBRMaterial;
    if (isSkin(c)) pbr.albedoColor = new Color3(skin[0], skin[1], skin[2]);
    else if (isHair(c)) pbr.albedoColor = new Color3(hair[0], hair[1], hair[2]);
  }
  // hair style + beard visibility
  const style = HAIR_STYLES[a.sex][a.hair % HAIR_STYLES[a.sex].length]?.part ?? "";
  for (const m of ch.meshes) {
    let n: { name: string; parent: unknown } | null = m as unknown as { name: string; parent: unknown };
    let part = "";
    while (n) {
      if (/^hair_/.test(n.name)) part = n.name.replace(/_primitive\d+$/, "");
      n = n.parent as typeof n;
    }
    if (!part) continue;
    const on = part === "hair_beard" ? a.sex === "m" && a.beard : part === style;
    m.setEnabled(on);
  }
  // proportions
  const h = race.height * (1 + a.height * 0.06);
  ch.root.scaling.setAll(h);
  const build = race.build * (1 + a.build * 0.12);
  for (const bone of ["spine_02", "spine_03"]) ch.bone(bone)?.scaling.set(build, 1, build);
  const head = race.head * (1 + a.head * 0.07);
  // the spine scale also scales its children: compensate so the head keeps its own size
  ch.bone("neck_01")?.scaling.set(1 / build, 1, 1 / build);
  ch.bone("Head")?.scaling.setAll(head);
  setEars(ch, !!race.ears, clones);
  return { heightScale: h };
}

function setEars(ch: Character, on: boolean, clones: Map<Material, Material>) {
  const store = ch as unknown as { _ears?: Mesh[] };
  if (!on) {
    store._ears?.forEach((e) => e.dispose());
    store._ears = undefined;
    return;
  }
  if (store._ears) return;
  const head = ch.bone("Head");
  if (!head) return;
  const skinMat = [...clones.values()].find(isSkin) ?? null;
  // Build in character-root space (rest pose, facing +Z), then re-parent to the head bone keeping
  // the world transform, so the ears follow head animation.
  head.computeWorldMatrix(true);
  ch.root.computeWorldMatrix(true);
  const inv = ch.root.getWorldMatrix().clone().invert();
  const headLocal = Vector3.TransformCoordinates(head.getAbsolutePosition(), inv);
  const ears: Mesh[] = [];
  for (const side of [-1, 1]) {
    const ear = MeshBuilder.CreateCylinder(`ear_${side}`, { height: 0.075, diameterTop: 0, diameterBottom: 0.032, tessellation: 6 }, head.getScene());
    ear.parent = ch.root;
    ear.scaling.set(1, 1, 0.45);
    ear.position.set(headLocal.x + side * 0.074, headLocal.y + 0.085, headLocal.z - 0.01);
    ear.rotation.set(-0.5, 0, side * -1.0);
    ear.material = skinMat;
    ear.computeWorldMatrix(true);
    ear.setParent(head);
    ears.push(ear);
    ch.meshes.push(ear);
  }
  store._ears = ears;
}
