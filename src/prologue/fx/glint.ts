import { Constants } from "@babylonjs/core/Engines/constants";
import { DynamicTexture } from "@babylonjs/core/Materials/Textures/dynamicTexture";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { precompile } from "../../engine/render/precompile";
import type { World } from "../World";

let shared: Mesh | null = null;

/** The hidden star every glint clones (built once per scene): a soft four-pointed flare, additive. */
function template(world: World) {
  if (shared && !shared.isDisposed() && shared.getScene() === world.scene) return shared;
  const scene = world.scene;
  const size = 64;
  const tex = new DynamicTexture("glintTex", { width: size, height: size }, scene, true);
  const g = tex.getContext() as CanvasRenderingContext2D;
  const c = size / 2;
  g.clearRect(0, 0, size, size);
  const core = g.createRadialGradient(c, c, 0, c, c, c);
  core.addColorStop(0, "rgba(255,255,240,1)");
  core.addColorStop(0.18, "rgba(255,240,190,0.85)");
  core.addColorStop(0.5, "rgba(255,220,150,0.18)");
  core.addColorStop(1, "rgba(255,210,140,0)");
  g.fillStyle = core;
  g.fillRect(0, 0, size, size);
  // the four points
  for (const [w, h] of [[size, 3], [3, size]]) {
    const ray = g.createRadialGradient(c, c, 0, c, c, c);
    ray.addColorStop(0, "rgba(255,255,245,1)");
    ray.addColorStop(1, "rgba(255,240,200,0)");
    g.fillStyle = ray;
    g.fillRect(c - w / 2, c - h / 2, w, h);
  }
  tex.hasAlpha = true;
  tex.update();
  const mat = new StandardMaterial("glint", scene);
  mat.disableLighting = true;
  mat.emissiveColor = Color3.White();
  mat.diffuseColor = Color3.Black();
  mat.specularColor = Color3.Black();
  mat.emissiveTexture = tex;
  mat.opacityTexture = tex;
  mat.alphaMode = Constants.ALPHA_ADD;
  mat.disableDepthWrite = true;
  mat.backFaceCulling = false;
  mat.fogEnabled = false;
  const m = MeshBuilder.CreatePlane("glint", { size: 1 }, scene);
  m.material = mat;
  m.billboardMode = Mesh.BILLBOARDMODE_ALL;
  m.isPickable = false;
  m.setEnabled(false);
  shared = m;
  return m;
}

/** Build the glint and compile its shader ahead of the first wind-up (nothing compiles mid-fight). */
export async function prepareGlints(world: World) {
  await precompile([template(world)]);
}

/**
 * A wind-up's glint (design §8: every human wind-up glints): a star that flares and fades over
 * `seconds` (game time: it slows with hit-stop and slow motion), following `at` (the weapon).
 */
export function glint(world: World, at: () => Vector3 | null, o: { seconds?: number; size?: number } = {}) {
  if (world.disposed) return;
  const m = template(world).clone("glint", null)!;
  const life = Math.min(0.55, Math.max(0.25, o.seconds ?? 0.4));
  const size = o.size ?? 0.38;
  let t = 0;
  const place = () => {
    const p = at();
    if (p) m.position.copyFrom(p);
  };
  place();
  m.scaling.setAll(0.001);
  m.setEnabled(true);
  const off = world.onUpdate((dt) => {
    t += dt;
    if (t >= life || m.isDisposed()) {
      off();
      if (!m.isDisposed()) m.dispose();
      return;
    }
    place();
    // flares up to its peak a little before the strike, then fades
    const k = Math.sin(Math.PI * Math.min(1, t / life));
    m.scaling.setAll(Math.max(0.001, size * k));
  });
}

/** The middle of a node's meshes in the world (a held weapon's blade), or null. */
export function middleOf(node: { getHierarchyBoundingVectors(includeDescendants?: boolean): { min: Vector3; max: Vector3 }; isDisposed(): boolean } | null) {
  if (!node || node.isDisposed()) return null;
  const b = node.getHierarchyBoundingVectors(true);
  if (!(b.min.x <= b.max.x)) return null;
  return b.min.add(b.max).scaleInPlace(0.5);
}
