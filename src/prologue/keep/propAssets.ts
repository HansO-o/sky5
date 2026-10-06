// The content pipeline's props (design Appendix "Props"): `props/meta` and the containers it
// points at (`kit/fpm`, `procprops/keep`, the Poly Haven models), loaded once, and copies of single
// nodes out of them with their colliders. Everything here degrades to null when the build lacks an
// asset: `props.ts` then builds its procedural stand-in.
import type { AnimationGroup } from "@babylonjs/core/Animations/animationGroup";
import type { AssetContainer } from "@babylonjs/core/assetContainer";
import { Quaternion, Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import type { Node } from "@babylonjs/core/node";
import type { Scene } from "@babylonjs/core/scene";
import { assets } from "../../core/assets/AssetClient";
import { loadGLB, loadJSON } from "../../game/loaders";
import { worldGeometry } from "../../engine/physics/meshGeometry";
import type { BodyId, Physics } from "../../engine/physics/Physics";
import type { V3 } from "./anchors";
import { bindCaveMaterials } from "./caveMaterials";

type Q4 = readonly [number, number, number, number];

/** A world placement (`props/meta.placements`): where a prop goes and its game-convention yaw. */
export interface Placement {
  anchor?: string;
  asset?: string;
  node?: string;
  /** `asset#node` (or a whole `ph/<id>`) */
  item?: string | null;
  at: V3;
  yaw?: number;
  rotation?: Q4;
  /** uniform scale the pipeline computed `at` for (e.g. Brun's father's axe, 1.25 as in the hand) */
  scale?: number;
  flame?: V3;
  slot?: string;
  room?: string;
}

/** What the runtime reads of `props/meta` (version 1). */
export interface PropsMeta {
  version: number;
  /** `kit/<Model>` / `procprops/<name>` → the asset and node to copy */
  resolve: Record<string, { asset: string; node: string }>;
  kit: Record<string, { bbox?: { min: V3; max: V3 }; hinge?: { node: string; axis: V3; openAngle: number }; anchors?: Record<string, { node: string; at: V3 }> }>;
  procprops: Record<string, Record<string, { door?: { node: string; axis: V3; openYaw: number }; deck?: { node: string; axis: V3; angles: Record<"raised" | "lowered" | "broken", number>; planks: string[] }; colliders?: Record<string, string | string[]>; chains?: { states: Record<string, string> }; slab?: { node: string } }>>;
  held: Record<string, { grip: V3; recipes: Record<string, { bone: string; rotation: Q4; position: V3 }> }>;
  placements: {
    gallery_bridge?: Placement;
    drain_grate?: Placement;
    sconces?: Placement[];
    straw_beds?: Placement[];
    cage?: Placement;
    strap_chair?: Placement;
    shackles?: Placement;
    brazier_irons?: Placement;
    dice?: Placement;
    records?: Placement[];
    store_shelf?: Placement & { potions: Placement[] };
    weapon_stands?: (Placement & { items: Placement[]; shield: Placement | null })[];
    camp_fire?: Placement;
  };
}

/** The props' assets as loaded (any of them may be missing). */
export interface PropAssets {
  meta: PropsMeta | null;
  containers: Map<string, AssetContainer>;
}

/** Ids the keep's props come from (the meta resolves the `kit/` and `procprops/` names into the first two). */
const PROP_ASSETS = ["kit/fpm", "procprops/keep", "ph/wooden_table_02", "ph/stone_fire_pit", "ph/wooden_barrels_01", "ph/wooden_crate_01", "ph/wooden_axe_03", "ph/kite_shield"];

/**
 * Load `props/meta` and the prop containers the build ships (none are added to the scene: props
 * are copies of their nodes). `procprops/keep`'s rock material is bound to the cave's textures.
 */
export async function loadPropAssets(scene: Scene): Promise<PropAssets> {
  const meta = assets.has("props/meta") ? await loadJSON<PropsMeta>("props/meta").catch((e) => (console.warn("props/meta", e), null)) : null;
  const containers = new Map<string, AssetContainer>();
  await Promise.all(
    PROP_ASSETS.filter((id) => assets.has(id)).map((id) =>
      loadGLB(id, scene).then(
        (c) => void containers.set(id, c),
        (e) => console.warn(`prop asset ${id}`, e),
      ),
    ),
  );
  const pp = containers.get("procprops/keep");
  if (pp) await bindCaveMaterials(scene, pp.materials);
  return { meta, containers };
}

/** A prop copied out of a container: its root (identity, at the parent's origin) and what is under it. */
export interface Spawned {
  /** the copied top-level node */
  node: TransformNode;
  meshes: AbstractMesh[];
  /** its `*_col` nodes, hidden: build bodies with `colliders()` once it stands where it goes */
  cols: AbstractMesh[];
  find(name: string): TransformNode | null;
  dispose(): void;
}

/**
 * A copy of `source` (`asset#node`, or a whole asset by id) under `parent`; null when the build
 * lacks it. The copy shares the container's materials; its animation groups are dropped (props
 * move through their pivot nodes).
 */
export function spawn(pa: PropAssets, source: string, parent: TransformNode | null, scene: Scene): Spawned | null {
  const [id, nodeName] = source.split("#");
  const c = pa.containers.get(id);
  if (!c) return null;
  let keep: Set<Node> | null = null;
  if (nodeName) {
    const target = [...c.transformNodes, ...c.meshes].find((n) => n.name === nodeName);
    if (!target) return null;
    keep = new Set<Node>([target, ...target.getDescendants(false)]);
    for (let p = target.parent; p; p = p.parent) keep.add(p);
  }
  const inst = c.instantiateModelsToScene((n) => n, false, { doNotInstantiate: true, predicate: keep ? (e: unknown) => keep.has(e as Node) : undefined });
  for (const g of inst.animationGroups as AnimationGroup[]) g.dispose();
  let node: TransformNode;
  if (nodeName) {
    const all = inst.rootNodes.flatMap((r) => [r, ...r.getDescendants(false)]);
    const copy = all.find((n) => n.name === nodeName) as TransformNode | undefined;
    if (!copy) {
      for (const r of inst.rootNodes) r.dispose();
      return null;
    }
    copy.parent = parent;
    for (const r of inst.rootNodes) if (r !== copy) r.dispose();
    node = copy;
  } else {
    node = new TransformNode(`ph_${id}`, scene);
    node.parent = parent;
    for (const r of inst.rootNodes) r.parent = node;
  }
  const meshes = node.getChildMeshes(false);
  const cols = meshes.filter((m) => /_col$/.test(m.name));
  for (const m of meshes) {
    m.isPickable = false;
    m.receiveShadows = true;
  }
  for (const m of cols) m.setEnabled(false);
  const desc = [node, ...node.getDescendants(false)] as TransformNode[];
  return {
    node,
    meshes: meshes.filter((m) => !cols.includes(m) && m.getTotalVertices() > 0),
    cols,
    find: (name) => desc.find((n) => n.name === name) ?? null,
    dispose: () => node.dispose(),
  };
}

/** The registry tag a collider's glTF extras give (else `fallback`). */
export function colTag(m: AbstractMesh, fallback: string) {
  const ex = (m.metadata as { gltf?: { extras?: { tag?: string } } } | null)?.gltf?.extras;
  return ex?.tag ?? fallback;
}

/** Static bodies from a spawned prop's colliders (where it stands now), by name. */
export function colliders(ph: Physics, sp: Spawned, fallback: string, only?: (m: AbstractMesh) => boolean): Map<string, BodyId> {
  const out = new Map<string, BodyId>();
  for (const m of sp.cols) {
    if (only && !only(m)) continue;
    const g = worldGeometry([m]);
    if (g.idx.length) out.set(m.name, ph.addStaticMesh(g.pos, g.idx, { tag: colTag(m, fallback) }));
  }
  return out;
}

/**
 * The point set at `p`, `yaw` (game convention: rotation.y = yaw turns local −Z to the facing), or
 * at an explicit `rotation`; `scale` (uniform) when the placement gives one.
 */
export function placeNode(n: TransformNode, p: { x: number; y: number; z: number }, yaw = 0, rotation?: Q4, scale?: number) {
  n.position.set(p.x, p.y, p.z);
  if (scale && scale > 0) n.scaling.setAll(scale);
  if (rotation) n.rotationQuaternion = new Quaternion(rotation[0], rotation[1], rotation[2], rotation[3]);
  else {
    n.rotationQuaternion = null;
    n.rotation.set(0, yaw, 0);
  }
  return n;
}

export const v3 = (a: V3, dy = 0) => new Vector3(a[0], a[1] + dy, a[2]);
