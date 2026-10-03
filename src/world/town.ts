import type { AssetContainer } from "@babylonjs/core/assetContainer";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { Quaternion, Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { Scene } from "@babylonjs/core/scene";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import type { Node } from "@babylonjs/core/node";
import { instantiateSubset, nextFrame } from "../game/loaders";

/** Gate position, town plateau height and wall line (must match tools/gen/world.mjs). */
export const GATE = { x: 60, z: -500, y: 38 };

const KIT_PART = /^modular_fort_01_/;

function piece(container: AssetContainer, name: string, scene: Scene) {
  const inst = instantiateSubset(container, (n) => n === name, (n) => KIT_PART.test(n));
  const holder = new TransformNode(`town_${name}`, scene);
  holder.rotationQuaternion = Quaternion.Identity();
  const keep: AbstractMesh[] = [];
  for (const r of inst.rootNodes) {
    r.parent = holder;
    keep.push(...(r as TransformNode).getChildMeshes(false));
    const target = (r as TransformNode).getDescendants(false, (n: Node) => n.name === name)[0] as TransformNode | undefined;
    // move the kit piece to the holder origin (pieces are laid out side by side in the source file)
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

/**
 * Lays out the border town seen at the end of the ride: a stone curtain wall across the valley with
 * the gate on the road, round towers, and timber houses behind it.
 */
export async function buildTown(scene: Scene, fort: AssetContainer, houses: AssetContainer | null, heightAt: (x: number, z: number) => number) {
  const meshes: AbstractMesh[] = [];
  const root = new TransformNode("town", scene);
  const slow = (what: string, t: number) => {
    const d = performance.now() - t;
    if (d > 16) console.info(`[timing] town ${what} blocked ${d.toFixed(0)} ms`);
  };
  const place = (name: string, x: number, z: number, yaw: number, y?: number) => {
    const t = performance.now();
    const p = piece(fort, name, scene);
    slow(`piece ${name}`, t);
    p.holder.parent = root;
    p.holder.position.set(x, y ?? heightAt(x, z) - 0.3, z);
    Quaternion.RotationYawPitchRollToRef(yaw, 0, 0, p.holder.rotationQuaternion!);
    meshes.push(...p.meshes);
    for (const m of p.meshes) m.setEnabled(false);
    return p;
  };
  // gate first, to learn the kit's wall orientation and segment length
  const probe = piece(fort, "modular_fort_01_wall_thin_straight_01", scene);
  const ext = probe.max.subtract(probe.min);
  probe.holder.dispose(false, false);
  // wall runs along the axis with the larger horizontal extent
  const alongX = ext.x >= ext.z;
  const segLen = Math.max(ext.x, ext.z);
  const baseYaw = alongX ? 0 : Math.PI / 2;
  place("modular_fort_01_wall_thin_gate_01", GATE.x, GATE.z, baseYaw, GATE.y - 0.3);
  const gateProbe = piece(fort, "modular_fort_01_wall_thin_gate_01", scene);
  const gExt = gateProbe.max.subtract(gateProbe.min);
  gateProbe.holder.dispose(false, false);
  const gateLen = Math.max(gExt.x, gExt.z);
  for (const side of [-1, 1]) {
    let x = GATE.x + side * (gateLen / 2 + segLen / 2);
    for (let i = 0; i < 6; i++) {
      place(i % 3 === 2 ? "modular_fort_01_wall_thin_straight_02" : "modular_fort_01_wall_thin_straight_01", x, GATE.z, baseYaw);
      x += side * segLen;
      await nextFrame();
    }
    place("modular_fort_01_tower_round", GATE.x + side * (gateLen / 2 + segLen * 2.5), GATE.z - 2, 0);
    place("modular_fort_01_tower_round", x, GATE.z - 2, 0);
  }
  // houses inside the walls along the street
  if (houses) {
    const layout: [number, number, number, number][] = [
      // variant, x, z, yaw
      [0, GATE.x - 16, GATE.z - 30, Math.PI / 2],
      [1, GATE.x + 15, GATE.z - 26, -Math.PI / 2],
      [2, GATE.x - 18, GATE.z - 52, Math.PI / 2],
      [3, GATE.x + 14, GATE.z - 48, -Math.PI / 2],
      [1, GATE.x - 30, GATE.z - 70, Math.PI / 2.3],
      [0, GATE.x + 20, GATE.z - 74, -Math.PI / 2],
      [2, GATE.x - 5, GATE.z - 95, 0],
      [3, GATE.x + 34, GATE.z - 40, -Math.PI / 1.8],
    ];
    for (const [v, x, z, yaw] of layout) {
      const inst = instantiateSubset(houses, (n) => n === `house_${v}`, (n) => /^house_\d$/.test(n));
      const h = new TransformNode(`house_${v}`, scene);
      h.rotationQuaternion = Quaternion.Identity();
      for (const r of inst.rootNodes) {
        r.parent = h;
        for (const m of (r as TransformNode).getChildMeshes(false)) {
          meshes.push(m);
          m.setEnabled(false);
        }
      }
      h.parent = root;
      h.position.set(x, heightAt(x, z), z);
      Quaternion.RotationYawPitchRollToRef(yaw, 0, 0, h.rotationQuaternion!);
      await nextFrame();
    }
  }
  for (const m of meshes) {
    m.receiveShadows = true;
    m.computeWorldMatrix(true);
    m.freezeWorldMatrix();
  }
  // compile shaders before anything becomes visible, then show everything at once
  const mats = new Set(meshes.map((m) => m.material).filter((x) => !!x));
  for (const mat of mats) {
    const m = meshes.find((x) => x.material === mat)!;
    const t = performance.now();
    await mat!.forceCompilationAsync(m).catch(() => {});
    slow(`compile ${mat!.name}`, t);
  }
  const t = performance.now();
  for (const m of meshes) m.setEnabled(true);
  slow("enable", t);
  scene.onAfterRenderObservable.addOnce(() => slow("first frame after enable", t));
  return { root, meshes };
}
