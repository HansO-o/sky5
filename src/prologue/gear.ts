import type { AssetContainer } from "@babylonjs/core/assetContainer";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial";
import type { Node } from "@babylonjs/core/node";
import type { Scene } from "@babylonjs/core/scene";
import { assets } from "../core/assets/AssetClient";
import { loadGLB, loadJSON } from "../game/loaders";
import { hud } from "../ui/hud";
import { applyLightBudget } from "../engine/render/lightBudget";
import { BoneSocket } from "../engine/actors/BoneSocket";
import { attachToSocket, frameOrigin, recipeRotation, relativeRecipe, type AttachRecipe, type PoseT, type QuatT, type Vec3T } from "../engine/actors/attach";
import { bodyHost, Equipment, type EquipmentHost, type ItemPlacement } from "../engine/actors/Equipment";
import { poseFromGroup } from "../engine/actors/fingers";
import { fingerBones, gripCentre, UAL_DRAW, UAL_GRIP_CLIP, UAL_SHEATHE } from "../engine/actors/presets/ueMannequin";
import type { Disposer } from "../engine/core/types";
import type { Character } from "../world/characters";
import type { Appearance } from "../world/appearance";
import type { PrologueFlags } from "./flags";
import type { PlayerController } from "./player";
import { createPlayerBody, outfitForArmour } from "./playerBody";
import type { World } from "./World";

export type ItemId = "sword" | "axe" | "shield";

// ---------------------------------------------------------------------------------------------
// Attach recipes (design §3.3). Hand-local frames: every joint points along +Y; a held handle
// runs along +Z through the grip centre (∓0.03, 0.095, 0). Values marked "tune" are first guesses
// to adjust by eye.

const GRIP_R = gripCentre("r");
const GRIP_L = gripCentre("l");

/** `ph/wooden_axe_03`: handle (+Y) along the grip axis, head out, ×1.25 (§13 item 10). */
export const AXE_HAND: AttachRecipe = { bone: "hand_r", rotation: [0, 0.7071, 0.7071, 0], position: [-0.03, 0.095, 0.15], scale: 1.25 };

/** The sword's rotation in the hand (FPM `Sword_Bronze`: handle +Y, edge +X). */
const SWORD_ROT: QuatT = [0.5, 0.5, 0.5, 0.5];

/** Kite shield on the left forearm: face out of the back of the hand, point along the grip axis. Position: tune. */
const SHIELD_ROT_RAW: QuatT = [0.5, -0.5, -0.5, 0.5];
/** set when the shield's face turns out to point inward: turns it 180° about the hand's Z */
export const SHIELD_FLIP = false;
const SHIELD_ROT: QuatT = SHIELD_FLIP ? mulQ([0, 0, 1, 0], SHIELD_ROT_RAW) : SHIELD_ROT_RAW;
export const SHIELD_HAND: AttachRecipe = { bone: "hand_l", rotation: SHIELD_ROT, position: [GRIP_L[0] - 0.09, GRIP_L[1], 0.04] };

/**
 * Where the right hand is when `Sword_Exit` lets go of the sword (0.47 s), relative to `spine_03`:
 * the hand's rotation and its grip centre (over the right shoulder, behind the back).
 */
const SHEATH_HAND_ROT: QuatT = [0.26, 0.659, -0.486, 0.512];
const SHEATH_GRIP: Vec3T = [-0.138, 0.347, -0.216];
export const SHEATH_HAND: PoseT = { rotation: SHEATH_HAND_ROT, position: frameOrigin(SHEATH_HAND_ROT, SHEATH_GRIP, GRIP_R) };

/** The kite shield on the back (face out, point down), behind the sheathed blade. Tune. */
export const SHIELD_BACK: AttachRecipe = { bone: "spine_03", rotation: [0, 1, 0, 0], position: [0.02, -0.06, -0.27] };

/** How far up from the pommel end a sword is gripped (m), when its grip is estimated from its bounds. */
const GRIP_FROM_POMMEL = 0.09;

interface ItemSpec {
  /** models in order of preference: a manifest id, or `id#node` for one model in a kit */
  sources: readonly string[];
  /**
   * model-space point the hand holds (the grip centre goes there): fixed, or "bounds" to estimate
   * it from the model (handle along +Y, pommel at the bottom). Default: the recipe as written.
   */
  grip?: Vec3T | "bounds";
  /** rotation in the hand (for the grip correction) */
  rotation?: QuatT;
  hand: AttachRecipe;
  /** put away on the body (null: hidden while not drawn) */
  stow: (hand: AttachRecipe) => AttachRecipe | null;
  /** stand-in when no source ships (handle along +Y, grip at the origin) */
  fallback?: (scene: Scene) => TransformNode;
}

/**
 * Kit containers the FPM props may ship in (the pipeline merges them into one GLB with a node per
 * model). `kit/<Model>` ids are tried first, as the keep anchors name props that way.
 */
const KIT_ASSETS = ["kit/fpm", "kit/props", "kit/megakit", "props/kit"];

export const ITEMS: Record<ItemId, ItemSpec> = {
  sword: {
    sources: ["kit/Sword_Bronze", ...KIT_ASSETS.map((k) => `${k}#Sword_Bronze`)],
    grip: "bounds",
    rotation: SWORD_ROT,
    hand: { bone: "hand_r", rotation: SWORD_ROT, position: GRIP_R },
    stow: (hand) => relativeRecipe("spine_03", SHEATH_HAND, hand),
    fallback: standInSword,
  },
  axe: {
    sources: ["ph/wooden_axe_03"],
    hand: AXE_HAND,
    stow: (hand) => relativeRecipe("spine_03", SHEATH_HAND, hand),
  },
  shield: {
    sources: ["ph/kite_shield"],
    hand: SHIELD_HAND,
    stow: () => SHIELD_BACK,
  },
};

// ---------------------------------------------------------------------------------------------
// Loading

const kits = new WeakMap<World, Map<string, Promise<AssetContainer>>>();

/** A loaded container per world and asset (shared by every copy of its items). A failed load is retried. */
function container(world: World, id: string) {
  let m = kits.get(world);
  if (!m) {
    const made = (m = new Map<string, Promise<AssetContainer>>());
    kits.set(world, made);
    // the containers' own resources (never added to the scene) go with it
    world.scene.onDisposeObservable.addOnce(() => {
      for (const p of made.values()) void p.then((c) => c.dispose()).catch(() => {});
      made.clear();
    });
  }
  let p = m.get(id);
  if (!p) {
    p = loadGLB(id, world.scene);
    m.set(id, p);
    p.catch(() => m.delete(id));
  }
  return p;
}

/** A fresh copy of a model: a whole asset, or one node (and what is under it) of a kit. */
async function instantiate(world: World, source: string): Promise<TransformNode | null> {
  const [id, nodeName] = source.split("#");
  if (!assets.has(id)) return null;
  const c = await container(world, id);
  if (world.disposed) return null;
  const root = new TransformNode(`item_${nodeName ?? id}`, world.scene);
  if (!nodeName) {
    const inst = c.instantiateModelsToScene((n) => n, false, { doNotInstantiate: true });
    for (const r of inst.rootNodes) r.parent = root;
    for (const g of inst.animationGroups) g.dispose();
    return root;
  }
  const target = [...c.transformNodes, ...c.meshes].find((n) => n.name === nodeName);
  if (!target) {
    root.dispose();
    return null;
  }
  // the node, its ancestors (to clone it at all) and what is under it
  const keep = new Set<Node>([target, ...target.getDescendants(false)]);
  for (let p = target.parent; p; p = p.parent) keep.add(p);
  const inst = c.instantiateModelsToScene((n) => n, false, { doNotInstantiate: true, predicate: (e: unknown) => keep.has(e as Node) });
  for (const g of inst.animationGroups) g.dispose();
  const all = inst.rootNodes.flatMap((r) => [r, ...r.getDescendants(false)]);
  const copy = all.find((n) => n.name === nodeName) as TransformNode | undefined;
  if (!copy) {
    for (const r of inst.rootNodes) r.dispose();
    root.dispose();
    return null;
  }
  // keep the model's own transform, drop the kit's layout above it
  copy.parent = root;
  for (const r of inst.rootNodes) if (r !== copy) r.dispose();
  return root;
}

/** The model-space point a sword is held at: up from the bottom of its bounds, centred across (null without meshes). */
function gripFromBounds(node: TransformNode): Vector3 | null {
  const meshes = node.getChildMeshes(false).filter((m) => m.getTotalVertices() > 0);
  if (!meshes.length) return null;
  node.computeWorldMatrix(true);
  for (const m of meshes) m.computeWorldMatrix(true);
  const { min, max } = node.getHierarchyBoundingVectors(true);
  const inv = node.getWorldMatrix().clone().invert();
  const lo = Vector3.TransformCoordinates(min, inv), hi = Vector3.TransformCoordinates(max, inv);
  return new Vector3((lo.x + hi.x) / 2, Math.min(lo.y, hi.y) + GRIP_FROM_POMMEL, (lo.z + hi.z) / 2);
}

/** The hand recipe with the model's grip point moved onto the grip centre. */
function gripped(spec: ItemSpec, grip: Vector3 | null): AttachRecipe {
  if (!grip) return spec.hand;
  const q = recipeRotation({ rotation: spec.rotation ?? spec.hand.rotation });
  const r = grip.rotateByQuaternionToRef(q, new Vector3());
  const p = spec.hand.position ?? [0, 0, 0];
  return { ...spec.hand, position: [p[0] - r.x, p[1] - r.y, p[2] - r.z] };
}

/**
 * A fresh copy of an item with where it hangs: the shipped model, or a stand-in when the build
 * lacks it (null only when there is neither, or the world is gone).
 */
export async function loadItem(world: World, id: ItemId): Promise<{ node: TransformNode; place: ItemPlacement } | null> {
  const spec = ITEMS[id];
  let node: TransformNode | null = null;
  let stand = false;
  let used: string | null = null;
  for (const src of spec.sources) {
    try {
      node = await instantiate(world, src);
    } catch (e) {
      console.warn(`gear: ${src} failed to load`, e);
    }
    if (node) {
      used = src;
      break;
    }
  }
  if (world.disposed) {
    node?.dispose();
    return null;
  }
  if (!node && spec.fallback) {
    console.warn(`gear: no model for ${id}, using a stand-in`);
    node = spec.fallback(world.scene);
    stand = true;
  }
  if (!node) return null;
  node.rotationQuaternion ??= node.rotation.toQuaternion();
  world.addShadowCasters(node.getChildMeshes(false));
  // the pipeline measured how its models are held (props/meta.held: the sword's grip is under the
  // guard, not at its pommel); a stand-in is built with its grip at the origin
  // (only the kit's models: the Poly Haven axe and shield keep the recipes tuned here)
  const measured = used?.startsWith("kit/") ? (await heldRecipes(world))?.[used]?.recipes?.[spec.hand.bone] : null;
  if (world.disposed) {
    node.dispose();
    return null;
  }
  const g = stand ? undefined : spec.grip;
  const grip = g === "bounds" ? gripFromBounds(node) : g ? new Vector3(g[0], g[1], g[2]) : null;
  const hand: AttachRecipe = measured ? { bone: measured.bone, rotation: measured.rotation, position: measured.position, scale: spec.hand.scale } : gripped(spec, grip);
  return { node, place: { hand, stow: spec.stow(hand) } };
}

/** `props/meta.held`: attach recipes the content pipeline checked on the clips, by `asset#node` (or `ph/<id>`). */
type HeldTable = Record<string, { recipes?: Record<string, { bone: string; rotation: QuatT; position: Vec3T }> }>;
const heldTables = new WeakMap<World, Promise<HeldTable | null>>();
function heldRecipes(world: World): Promise<HeldTable | null> {
  let p = heldTables.get(world);
  if (!p) {
    p = assets.has("props/meta")
      ? loadJSON<{ held?: HeldTable }>("props/meta").then(
          (m) => m.held ?? null,
          (e) => (console.warn("gear: props/meta", e), null),
        )
      : Promise.resolve(null);
    heldTables.set(world, p);
  }
  return p;
}

const standInMats = new WeakMap<Scene, { steel: PBRMaterial; leather: PBRMaterial; rope: PBRMaterial }>();
function mats(scene: Scene) {
  let m = standInMats.get(scene);
  if (!m) {
    const mk = (name: string, c: Color3, metal: number, rough: number) => {
      const mat = new PBRMaterial(name, scene);
      mat.albedoColor = c;
      mat.metallic = metal;
      mat.roughness = rough;
      applyLightBudget([mat]);
      return mat;
    };
    m = { steel: mk("gear_steel", new Color3(0.55, 0.56, 0.58), 0.9, 0.38), leather: mk("gear_leather", new Color3(0.22, 0.14, 0.08), 0, 0.85), rope: mk("gear_rope", new Color3(0.45, 0.36, 0.24), 0, 1) };
    standInMats.set(scene, m);
  }
  return m;
}

/** A plain arming sword: handle along +Y with the grip centre at the origin, edge along +X. */
function standInSword(scene: Scene): TransformNode {
  const m = mats(scene);
  const root = new TransformNode("item_sword_standin", scene);
  const part = (name: string, w: number, h: number, d: number, y: number, mat: PBRMaterial) => {
    const b = MeshBuilder.CreateBox(name, { width: w, height: h, depth: d }, scene);
    b.position.y = y;
    b.material = mat;
    b.parent = root;
    return b;
  };
  part("sword_blade", 0.05, 0.74, 0.008, 0.47, m.steel);
  part("sword_guard", 0.17, 0.025, 0.03, 0.09, m.steel);
  part("sword_grip", 0.03, 0.15, 0.03, 0, m.leather);
  part("sword_pommel", 0.045, 0.035, 0.045, -0.09, m.steel);
  return root;
}

/** Rope cuffs around a wrist (on the hand joint, around its +Y axis). */
function cuff(scene: Scene, side: "l" | "r") {
  const t = MeshBuilder.CreateTorus(`cuff_${side}`, { diameter: 0.085, thickness: 0.022, tessellation: 14 }, scene);
  t.material = mats(scene).rope;
  const root = new TransformNode(`cuffs_${side}`, scene);
  t.parent = root;
  return root;
}

function mulQ(a: QuatT, b: QuatT): QuatT {
  return [
    a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
    a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
    a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
    a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
  ];
}

// ---------------------------------------------------------------------------------------------
// Equipment for bodies

/** The armed right hand's grip (`Sword_Idle` frame 0), or null when the clip is missing. */
export function swordGrip(world: World) {
  const g = world.factory.clip(UAL_GRIP_CLIP);
  if (!g) return null;
  const pose = poseFromGroup(g, fingerBones("r"));
  return pose.size ? { pose, fade: 0.1 } : null;
}

/** Equipment on an NPC's body (draw and sheathe play its clips). The caller disposes it with the NPC. */
export function equipNpc(world: World, ch: Character): Equipment {
  return new Equipment(bodyHost(ch), { scene: world.scene, bus: world, draw: UAL_DRAW, sheathe: UAL_SHEATHE, grip: swordGrip(world) });
}

/**
 * Arm an NPC: load its items and hang them, drawn or put away (default drawn). Returns its
 * equipment (dispose it when the NPC goes). Items that fail to load are skipped.
 */
export async function armNpc(world: World, ch: Character, items: { main?: "sword" | "axe" | null; off?: "shield" | null }, o: { drawn?: boolean; equipment?: Equipment } = {}) {
  const eq = o.equipment ?? equipNpc(world, ch);
  eq.setArmed(o.drawn ?? true);
  const [main, off] = await Promise.all([items.main ? loadItem(world, items.main) : null, items.off ? loadItem(world, items.off) : null]);
  if (ch.root.isDisposed()) {
    main?.node.dispose();
    off?.node.dispose();
    return eq;
  }
  if (main) eq.set("main", main.node, main.place)?.dispose();
  if (off) eq.set("off", off.node, off.place)?.dispose();
  return eq;
}

/**
 * Hang one item on a body joint for good (a prop that never changes hands, like the headsman's
 * axe): it follows the joint without the body's scaling and goes with the body.
 */
export async function attachItem(world: World, ch: Character, id: ItemId, recipe?: AttachRecipe): Promise<TransformNode | null> {
  const it = await loadItem(world, id);
  if (!it) return null;
  const r = recipe ?? it.place.hand;
  const bone = ch.bone(r.bone);
  if (!bone || ch.root.isDisposed()) {
    it.node.dispose();
    return null;
  }
  const socket = new BoneSocket(world.scene, bone, { name: `${ch.name}_${r.bone}_socket` });
  attachToSocket(it.node, socket.node, r);
  return it.node;
}

/** The player's body as an equipment host: draws play as a short scripted clip, never on the move. */
function playerHost(p: PlayerController): EquipmentHost {
  return {
    bone: (n) => p.body.bone(n),
    playOnce: (clip, o) => {
      // on the move (or during another script) the weapon changes hands without the clip: a
      // full-body clip would freeze the legs mid-stride
      if (p.speed > 0.6 || p.scripted || !p.body.hasClip(clip)) return false;
      void p.playScripted(clip, { speed: o.speed, blend: o.blend, camera: false, hold: true });
      return true;
    },
    releaseOnce: (clip) => {
      if (p.scripted === clip) p.clearScripted();
    },
    clipLength: (clip) => (p.body.hasClip(clip) ? p.body.clipLength(clip) : 0),
  };
}

type Inv = PrologueFlags["inv"];

/**
 * The player's kit: the items `flags.inv` lists (weapon, shield), the outfit its armour rating
 * gives (the body is rebuilt behind a short black dip), rope cuffs while `player.bound`, and third
 * person while armed. Lives as long as the player (the stage owns it).
 */
export class PlayerGear {
  readonly equipment: Equipment;
  private held: { main: ItemId | null; off: ItemId | null } = { main: null, off: null };
  private outfit = outfitForArmour(0).join(",");
  private offBound: Disposer;
  private armedView: Disposer | null = null;
  private outfitP: Promise<void> = Promise.resolve();
  private disposed = false;

  constructor(
    private world: World,
    private player: PlayerController,
    private appearance: () => Appearance,
  ) {
    this.equipment = new Equipment(playerHost(player), { scene: world.scene, bus: world, draw: UAL_DRAW, sheathe: UAL_SHEATHE, grip: swordGrip(world) });
    player.equipment = this.equipment;
    this.offBound = player.onBound((on) => this.setCuffs(on));
    this.setCuffs(player.bound);
  }

  /** What the player holds, by slot. */
  get items() {
    return { ...this.held };
  }

  /**
   * Match the inventory: load and hang the weapon and shield it lists (dropping the rest) and put
   * on the outfit of its armour. `dip`: seconds of the black dip around a body rebuild (default
   * 0.35; 0 when the screen is already black). Resolves once everything is in place.
   */
  async sync(inv: Inv, o: { dip?: number } = {}) {
    const outfit = outfitForArmour(inv.armour);
    const key = outfit.join(",");
    const tasks: Promise<unknown>[] = [this.setItem("main", inv.weapon === "none" ? null : inv.weapon), this.setItem("off", inv.shield ? "shield" : null)];
    if (key !== this.outfit) {
      this.outfit = key;
      this.outfitP = this.outfitP.then(() => this.rebuild(outfit, o.dip ?? 0.35));
      tasks.push(this.outfitP);
    }
    await Promise.all(tasks);
  }

  /** Draw (false when bound, empty-handed or interrupted). Third person while armed. */
  async draw(o: { animate?: boolean; speed?: number } = {}) {
    if (this.player.bound || this.disposed) return false;
    if (!this.equipment.item("main") && !this.equipment.item("off")) return false;
    this.armedView ??= this.player.holdThirdPerson();
    const ok = await this.equipment.draw(o);
    if (!this.equipment.armed) this.releaseView();
    return ok;
  }

  async sheathe(o: { animate?: boolean; speed?: number } = {}) {
    const ok = await this.equipment.sheathe(o);
    if (!this.equipment.armed) this.releaseView();
    return ok;
  }

  /** Armed or not at once (a resumed checkpoint, a skip, a cutscene). */
  setArmed(on: boolean) {
    this.equipment.setArmed(on && !this.player.bound);
    if (this.equipment.armed) this.armedView ??= this.player.holdThirdPerson(0);
    else this.releaseView();
  }

  private releaseView() {
    this.armedView?.();
    this.armedView = null;
  }

  private async setItem(slot: "main" | "off", id: ItemId | null) {
    if (this.held[slot] === id) return;
    this.held[slot] = id;
    if (!id) {
      this.equipment.set(slot, null)?.dispose();
      return;
    }
    const it = await loadItem(this.world, id);
    // superseded meanwhile (another sync), or gone
    if (!it) return;
    if (this.disposed || this.held[slot] !== id) {
      it.node.dispose();
      return;
    }
    this.equipment.set(slot, it.node, it.place)?.dispose();
  }

  private async rebuild(outfit: ReturnType<typeof outfitForArmour>, dip: number) {
    if (this.disposed || this.world.disposed) return;
    if (dip > 0) await hud.fade(true, dip);
    try {
      if (this.disposed || this.world.disposed) return;
      const { body, heightScale } = await createPlayerBody(this.world, this.appearance(), outfit);
      if (this.disposed) return;
      this.player.setBody(body, heightScale);
    } finally {
      if (dip > 0) void hud.fade(false, dip);
    }
  }

  private setCuffs(on: boolean) {
    if (this.disposed) return;
    for (const side of ["l", "r"] as const) {
      const id = `cuffs_${side}`;
      if (on) {
        if (!this.equipment.worn(id)) this.equipment.wear(id, cuff(this.world.scene, side), { bone: `hand_${side}`, position: [0, 0.015, 0] });
      } else this.equipment.wear(id, null)?.dispose();
    }
    if (on) this.setArmed(false);
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.offBound();
    this.releaseView();
    if (this.player.equipment === this.equipment) this.player.equipment = null;
    this.equipment.dispose();
  }
}
