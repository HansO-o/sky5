import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Quaternion, Vector3 } from "@babylonjs/core/Maths/math.vector";
import { applyLightBudget } from "../../engine/render/lightBudget";
import { precompile } from "../../engine/render/precompile";
import type { World } from "../World";

let shared: Mesh | null = null;

/** The hidden arrow every shot clones (built once per scene). */
function template(world: World) {
  if (shared && !shared.isDisposed() && shared.getScene() === world.scene) return shared;
  const scene = world.scene;
  const wood = new StandardMaterial("arrowWood", scene);
  wood.diffuseColor = new Color3(0.42, 0.3, 0.18);
  wood.specularColor = Color3.Black();
  const iron = new StandardMaterial("arrowIron", scene);
  iron.diffuseColor = new Color3(0.25, 0.25, 0.27);
  const fl = new StandardMaterial("arrowFletch", scene);
  fl.diffuseColor = new Color3(0.8, 0.78, 0.7);
  fl.backFaceCulling = false;
  applyLightBudget([wood, iron, fl]);
  // built along +Z, tip at +0.4
  const shaft = MeshBuilder.CreateCylinder("shaft", { height: 0.78, diameter: 0.012, tessellation: 5 }, scene);
  shaft.rotation.x = Math.PI / 2;
  shaft.material = wood;
  const tip = MeshBuilder.CreateCylinder("tip", { height: 0.06, diameterTop: 0, diameterBottom: 0.025, tessellation: 4 }, scene);
  tip.rotation.x = Math.PI / 2;
  tip.position.z = 0.42;
  tip.material = iron;
  const f1 = MeshBuilder.CreatePlane("f1", { width: 0.035, height: 0.12 }, scene);
  f1.rotation.x = Math.PI / 2;
  f1.position.z = -0.32;
  f1.material = fl;
  const f2 = f1.clone("f2");
  f2.rotation.z = Math.PI / 2;
  shared = Mesh.MergeMeshes([shaft, tip, f1, f2], true, true, undefined, false, true)!;
  shared.setEnabled(false);
  return shared;
}

function arrowMesh(world: World) {
  return template(world).clone("arrow", null)!;
}

/** Build the arrow and compile its shaders ahead of the first shot (nothing compiles mid-flight). */
export function prepareArrows(world: World) {
  return precompile([template(world)]);
}

/**
 * Fire an arrow along a slight ballistic arc; resolves when it reaches the target. The arrow stays
 * where it hit (optionally parented to a moving node).
 */
export function shootArrow(world: World, from: Vector3, to: () => Vector3, speed = 45) {
  const m = arrowMesh(world);
  m.setEnabled(true);
  m.position.copyFrom(from);
  m.rotationQuaternion = Quaternion.Identity();
  const start = from.clone();
  const dist = Vector3.Distance(from, to());
  const T = Math.max(0.12, dist / speed);
  let t = 0;
  return new Promise<{ mesh: Mesh; hit: Vector3 }>((resolve) => {
    const off = world.onUpdate((dt) => {
      t = Math.min(T, t + dt);
      const k = t / T;
      const target = to();
      const p = Vector3.Lerp(start, target, k);
      p.y += Math.sin(k * Math.PI) * dist * 0.03;
      const dir = p.subtract(m.position);
      if (dir.lengthSquared() > 1e-8) {
        dir.normalize();
        Quaternion.FromUnitVectorsToRef(new Vector3(0, 0, 1), dir, m.rotationQuaternion!);
      }
      m.position.copyFrom(p);
      if (k >= 1) {
        off();
        resolve({ mesh: m, hit: p.clone() });
      }
    });
  });
}
