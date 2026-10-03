import type { AssetContainer } from "@babylonjs/core/assetContainer";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { Quaternion, Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { Scene } from "@babylonjs/core/scene";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import type { Node } from "@babylonjs/core/node";
import type { ShadowGenerator } from "@babylonjs/core/Lights/Shadows/shadowGenerator";
import { instantiateSubset, nextFrame } from "../game/loaders";
import { precompile } from "../engine/render/precompile";

/** Gate position, town plateau height and wall line (must match tools/gen/world.mjs). */
export const GATE = { x: 60, z: -500, y: 38 };

/**
 * Layout of 雾门镇 (world coordinates). Story beats reference these anchors.
 * Dimensions of the procedural buildings are in tools/gen/townbuildings.mjs.
 */
export const LAYOUT = {
  /** where the wagons stop, just inside the gate */
  unload: { x: 60, z: -528 },
  square: { x: 60, z: -592 },
  platform: { x: 60, z: -604, yaw: 0 },
  tower: { x: 90, z: -584, yaw: 0, w: 7, floor2: 6.4 },
  inn: { x: 101, z: -584, yaw: 0, w: 10, d: 8, floor: 3.4 },
  keep: { x: 60, z: -662, yaw: 0, d: 18 },
  /** street the player escapes along after leaving the inn */
  escape: [
    { x: 103, z: -570 },
    { x: 84, z: -566 },
    { x: 68, z: -574 },
    { x: 62, z: -610 },
    { x: 60, z: -636 },
    { x: 60, z: -650 },
  ],
};

/** House placements: [variant, x, z, yaw]. Doors face the street. */
const HOUSES: [number, number, number, number][] = [
  [0, 42, -526, Math.PI / 2],
  [1, 78, -522, -Math.PI / 2],
  [2, 40, -552, Math.PI / 2],
  [3, 79, -546, -Math.PI / 2],
  [1, 36, -588, Math.PI / 2],
  [0, 34, -615, Math.PI / 2],
  [2, 84, -622, -Math.PI / 2],
  [0, 100, -556, Math.PI],
  [1, 86, -553, Math.PI],
  [3, 36, -640, Math.PI / 2],
];

const KIT_PART = /^modular_fort_01_/;

function piece(container: AssetContainer, name: string, scene: Scene, isPart: (n: string) => boolean) {
  const inst = instantiateSubset(container, (n) => n === name, isPart);
  const holder = new TransformNode(`town_${name}`, scene);
  holder.rotationQuaternion = Quaternion.Identity();
  const keep: AbstractMesh[] = [];
  for (const r of inst.rootNodes) {
    r.parent = holder;
    keep.push(...(r as TransformNode).getChildMeshes(false));
    const target = (r as TransformNode).getDescendants(false, (n: Node) => n.name === name)[0] as TransformNode | undefined;
    // move the piece to the holder origin (kit pieces are laid out side by side in the source file)
    if (target) {
      target.computeWorldMatrix(true);
      const c = target.getAbsolutePosition();
      (r as TransformNode).position.subtractInPlace(new Vector3(c.x, 0, c.z));
    }
  }
  holder.computeWorldMatrix(true);
  let min = new Vector3(Infinity, Infinity, Infinity), max = new Vector3(-Infinity, -Infinity, -Infinity);
  for (const m of keep) {
    m.computeWorldMatrix(true);
    const b = m.getBoundingInfo().boundingBox;
    min = Vector3.Minimize(min, b.minimumWorld);
    max = Vector3.Maximize(max, b.maximumWorld);
  }
  return { holder, meshes: keep, min, max };
}

export interface Town {
  root: TransformNode;
  meshes: AbstractMesh[];
  /** static collision geometry (everything solid except the breach wall) */
  colliders: AbstractMesh[];
  tower: TransformNode;
  breach: { node: TransformNode; meshes: AbstractMesh[] };
  inn: TransformNode;
  keep: TransformNode;
  platform: TransformNode;
  block: TransformNode;
  houses: { node: TransformNode; variant: number }[];
  keepDoors: TransformNode[];
  heightAt: (x: number, z: number) => number;
}

/**
 * Builds 雾门镇: the curtain wall and gate seen at the end of the ride, the story buildings (watch
 * tower, inn, keep, execution platform) and timber houses. Work is spread over frames, and nothing
 * becomes visible until its shaders are compiled: `o.casters` registers the meshes as shadow casters
 * first, so their shadow pass (in `o.shadows()`) compiles too.
 */
export async function buildTown(
  scene: Scene,
  c: { fort: AssetContainer; houses: AssetContainer | null; buildings: AssetContainer | null; door: AssetContainer | null },
  heightAt: (x: number, z: number) => number,
  o: { casters?: (meshes: AbstractMesh[]) => void; shadows?: () => ShadowGenerator | null } = {},
): Promise<Town> {
  const meshes: AbstractMesh[] = [];
  const colliders: AbstractMesh[] = [];
  const root = new TransformNode("town", scene);
  const place = (container: AssetContainer, name: string, isPart: (n: string) => boolean, x: number, z: number, yaw: number, y?: number, solid = true) => {
    const p = piece(container, name, scene, isPart);
    p.holder.parent = root;
    p.holder.position.set(x, y ?? heightAt(x, z) - 0.3, z);
    Quaternion.RotationYawPitchRollToRef(yaw, 0, 0, p.holder.rotationQuaternion!);
    meshes.push(...p.meshes);
    if (solid) colliders.push(...p.meshes);
    for (const m of p.meshes) m.setEnabled(false);
    return p;
  };
  const kit = (n: string) => KIT_PART.test(n);

  // ---- curtain wall across the valley with the gate on the road
  const probe = piece(c.fort, "modular_fort_01_wall_thin_straight_01", scene, kit);
  const ext = probe.max.subtract(probe.min);
  probe.holder.dispose(false, false);
  const alongX = ext.x >= ext.z;
  const segLen = Math.max(ext.x, ext.z);
  const baseYaw = alongX ? 0 : Math.PI / 2;
  const gate = place(c.fort, "modular_fort_01_wall_thin_gate_01", kit, GATE.x, GATE.z, baseYaw, GATE.y - 0.3);
  const gExt = gate.max.subtract(gate.min);
  const gateLen = Math.max(gExt.x, gExt.z);
  for (const side of [-1, 1]) {
    let x = GATE.x + side * (gateLen / 2 + segLen / 2);
    for (let i = 0; i < 6; i++) {
      place(c.fort, i % 3 === 2 ? "modular_fort_01_wall_thin_straight_02" : "modular_fort_01_wall_thin_straight_01", kit, x, GATE.z, baseYaw);
      x += side * segLen;
      await nextFrame();
    }
    place(c.fort, "modular_fort_01_tower_round", kit, GATE.x + side * (gateLen / 2 + segLen * 2.5), GATE.z - 2, 0);
    place(c.fort, "modular_fort_01_tower_round", kit, x, GATE.z - 2, 0);
  }

  // ---- story buildings
  const story = (n: string) => ["tower", "tower_breach", "inn", "keep", "platform", "block"].includes(n);
  const L = LAYOUT;
  let tower = root, inn = root, keep = root, platform = root, block = root;
  let breach: Town["breach"] = { node: root, meshes: [] };
  if (c.buildings) {
    const ty = heightAt(L.tower.x, L.tower.z);
    tower = place(c.buildings, "tower", story, L.tower.x, L.tower.z, L.tower.yaw, ty).holder;
    const b = place(c.buildings, "tower_breach", story, L.tower.x, L.tower.z, L.tower.yaw, ty, false);
    breach = { node: b.holder, meshes: b.meshes };
    await nextFrame();
    inn = place(c.buildings, "inn", story, L.inn.x, L.inn.z, L.inn.yaw, heightAt(L.inn.x, L.inn.z)).holder;
    keep = place(c.buildings, "keep", story, L.keep.x, L.keep.z, L.keep.yaw, heightAt(L.keep.x, L.keep.z) - 0.2).holder;
    await nextFrame();
    const py = heightAt(L.platform.x, L.platform.z);
    platform = place(c.buildings, "platform", story, L.platform.x, L.platform.z, L.platform.yaw, py).holder;
    block = place(c.buildings, "block", story, L.platform.x, L.platform.z, L.platform.yaw, py).holder;
  }

  // ---- keep doors: two leaves of the castle door, stretched to fill the 4 x 5 m gate
  const keepDoors: TransformNode[] = [];
  if (c.door) {
    for (const side of [-1, 1]) {
      const inst = c.door.instantiateModelsToScene((n) => n, false);
      const leaf = new TransformNode(`keep_door_${side}`, scene);
      leaf.parent = root;
      // hinge at the outer edge of the opening
      const hinge = new TransformNode(`keep_door_hinge_${side}`, scene);
      hinge.parent = leaf;
      for (const r of inst.rootNodes as TransformNode[]) {
        r.parent = hinge;
        r.position.set(-side * 1.0, 0, 0);
        r.scaling.set(side < 0 ? 1 : -1, 1.68, 1);
        for (const m of r.getChildMeshes()) {
          meshes.push(m);
          colliders.push(m);
          m.setEnabled(false);
        }
      }
      leaf.position.set(L.keep.x + side * 2.0, heightAt(L.keep.x, L.keep.z + L.keep.d / 2) - 0.2, L.keep.z + L.keep.d / 2 - 0.65);
      keepDoors.push(hinge);
    }
  }

  // ---- houses
  const houses: Town["houses"] = [];
  if (c.houses) {
    for (const [v, x, z, yaw] of HOUSES) {
      const inst = instantiateSubset(c.houses, (n) => n === `house_${v}`, (n) => /^house_\d$/.test(n));
      const h = new TransformNode(`house_${v}`, scene);
      h.rotationQuaternion = Quaternion.Identity();
      for (const r of inst.rootNodes) {
        r.parent = h;
        for (const m of (r as TransformNode).getChildMeshes(false)) {
          meshes.push(m);
          colliders.push(m);
          m.setEnabled(false);
        }
      }
      h.parent = root;
      h.position.set(x, heightAt(x, z), z);
      Quaternion.RotationYawPitchRollToRef(yaw, 0, 0, h.rotationQuaternion!);
      houses.push({ node: h, variant: v });
      await nextFrame();
    }
  }

  for (const m of meshes) {
    m.receiveShadows = true;
    m.isPickable = false;
    m.computeWorldMatrix(true);
    m.freezeWorldMatrix();
  }
  // compile shaders before anything becomes visible (each mesh as it draws: glTF instances drawn
  // instanced, plus its shadow pass), then show everything at once
  o.casters?.(meshes);
  await precompile(meshes, { shadows: o.shadows?.() ?? null, timeout: 20 });
  for (const m of meshes) m.setEnabled(true);
  return { root, meshes, colliders, tower, breach, inn, keep, platform, block, houses, keepDoors, heightAt };
}
