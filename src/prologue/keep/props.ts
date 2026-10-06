// The keep's props behind one module (design §4.2 anchors, §10.2, Appendix "Props"): chests with
// lids, weapon stands and their pickups, the storeroom shelf with its potions, the key ring, the
// prisoner cage with its door, the wall sconces, the beam and bar that seal the doors, the gallery's
// drawbridge set piece, and the rooms' dressing (braziers, tables, beds, barrels, the strap chair,
// shackles, straw, the drain grate, the camp's fire pit). Each uses the content pipeline's model when
// the manifest has it (resolved through `props/meta`: `kit/fpm`, `procprops/keep`, `ph/<id>`) and a
// procedural stand-in made of boxes and cylinders in the interior's own materials otherwise, so the
// chapters see one API either way.
import { VertexBuffer } from "@babylonjs/core/Buffers/buffer";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Quaternion, Vector3 } from "@babylonjs/core/Maths/math.vector";
import { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial";
import type { Material } from "@babylonjs/core/Materials/material";
import { CreateBox } from "@babylonjs/core/Meshes/Builders/boxBuilder";
import { CreateCylinder } from "@babylonjs/core/Meshes/Builders/cylinderBuilder";
import { CreateTorus } from "@babylonjs/core/Meshes/Builders/torusBuilder";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import type { Node } from "@babylonjs/core/node";
import type { Scene } from "@babylonjs/core/scene";
import { applyLightBudget } from "../../engine/render/lightBudget";
import { worldGeometry } from "../../engine/physics/meshGeometry";
import type { BodyId, Physics } from "../../engine/physics/Physics";
import { HingedDoor } from "../../engine/world/HingedDoor";
import { loadItem, type ItemId } from "../gear";
import type { World } from "../World";
import type { KeepAnchor, V3 } from "./anchors";
import { colliders, placeNode, spawn, v3, type Placement, type PropAssets, type Spawned } from "./propAssets";

/** A visibility set of the underground ("gf", "stair", "bs", "caveA", …). */
export type PropSet = string;

/** What the props need from the underground they stand in. */
export interface PropHost {
  readonly world: World;
  readonly physics: Physics;
  /** the keep frame's runtime origin (the pipeline's keep placements use y 37.73) */
  readonly origin: Vector3;
  readonly materials: Map<string, Material>;
  readonly keep: { anchors: Record<string, KeepAnchor> };
  readonly cave: { anchors: Record<string, { pos: readonly [number, number, number]; yaw?: number }> } | null;
  anchor(name: string): { pos: Vector3; yaw: number; def: KeepAnchor };
  setAt(p: { x: number; y: number; z: number }): PropSet;
  addToSet(set: PropSet, item: Node | { setEnabled(on: boolean): void }): () => void;
}

/** Something the player can use: where the prompt sits and how to make it go. */
export interface PropBase {
  /** the anchor it was made for */
  readonly name: string;
  readonly root: TransformNode;
  /** where an interactable for it goes (its front, on the floor) */
  readonly use: Vector3;
  /** its static collider (null: none) */
  readonly body: BodyId | null;
  /** the pipeline's model (false: the procedural stand-in) */
  readonly real: boolean;
}

/** A chest (the confiscation chest, the armour locker, the footlocker, J's chest). */
export interface ChestProp extends PropBase {
  readonly opened: boolean;
  /** lift the lid; resolves once open */
  open(seconds?: number): Promise<void>;
  /** open or shut at once (a resumed checkpoint) */
  set(open: boolean): void;
  /** where something lies inside (world) */
  readonly inside: Vector3;
  /** an item's node in the chest (the armour bundle, the letter); `take` removes it */
  content: TransformNode | null;
  take(): void;
}

/** One thing on a weapon stand. */
export interface RackSlot {
  /** "sword", "axe", "shield", or "father_axe" (Brun's, on the rebel stand) */
  readonly id: string;
  readonly kind: ItemId;
  /** where it stands (world) */
  readonly pos: Vector3;
  node: TransformNode | null;
  readonly taken: boolean;
}

/** A weapon stand with its weapons (the imperial sword and kite shield; Brun's father's axe, a sword and an axe). */
export interface RackProp extends PropBase {
  readonly slots: readonly RackSlot[];
  /** resolves once the weapons are on it */
  readonly ready: Promise<void>;
  slot(id: string): RackSlot | null;
  /** take a weapon off the stand (it disappears from it) */
  take(id: string): void;
  has(id: string): boolean;
}

/** The storeroom shelf and its potions. */
export interface ShelfProp extends PropBase {
  /** potions still on it */
  readonly left: number;
  /** take `n` potions (default all); returns how many were taken */
  take(n?: number): number;
  /** set how many are left (a resumed checkpoint) */
  setLeft(n: number): void;
}

/** A small thing lying somewhere (a potion in a cell). */
export interface PickupProp extends PropBase {
  readonly taken: boolean;
  take(): void;
}

/** The prisoner cage (2.0 × 2.2 × 2.0 m, the door on its front). */
export interface CageProp extends PropBase {
  readonly door: HingedDoor;
  /** inside, on the floor (where Kaja sits) */
  readonly inside: Vector3;
  open(seconds?: number): Promise<boolean>;
}

export type BridgeState = "raised" | "lowered" | "broken";

/**
 * The gallery's drawbridge set piece (deck, chains, winch, lever, slab): posed per state with its
 * deck collider (`bridge_deck_<state>`). The chapter animates it through the nodes it exposes.
 */
export interface GalleryBridge {
  readonly state: BridgeState;
  /** pose the deck, chains and deck collider for `state`; the lever with it (at rest when raised, pulled otherwise) */
  set(state: BridgeState): void;
  /** the lever's handle at `t` of its full pull (0 rest … 1 pulled; K11 drives it along the clip's curve) */
  pull(t: number): void;
  /** the deck's pivot (RotationAxis(+X, angle)), the lever's pivot (+X, pulled 0.6457), the winch drum */
  readonly hinge: TransformNode | null;
  readonly lever: TransformNode | null;
  readonly drum: TransformNode | null;
  /** the slab over the chasm (hidden until K12) and the north planks that break away */
  readonly slab: TransformNode | null;
  readonly planks: readonly TransformNode[];
  /** the deck angle of each state (rad) */
  readonly angles: Readonly<Record<BridgeState, number>>;
}

/** A torch that can be carried (the companion's from K9), with its flame point. */
export interface CarriedTorch {
  readonly root: TransformNode;
  /** the flame's foot (put a sconce flame here; it moves with the torch) */
  readonly flame: TransformNode;
  dispose(): void;
}

/** The lever's full pull about +X from its rest pose (rad; Appendix "Props": `extras.lever`, pulling adds up to 0.6457). */
const LEVER_PULL = 0.6457;

/** The flat "baked" shade stand-ins in the interior's materials get (its mean vertex luminance is about 0.3). */
const BAKED_SHADE = 0.38;
/** design 37.73: the keep base the pipeline's world placements were computed with */
const KEEP_BASE = 37.73;

/** Plain materials for what the interior has none of (leather, glass, stone, cloth, rope, coals). */
interface Mats {
  wood: Material;
  planks: Material;
  iron: Material;
  leather: Material;
  potion: Material;
  stone: Material;
  cloth: Material;
  rope: Material;
  coals: Material;
  paper: Material;
}

function plain(scene: Scene, name: string, c: [number, number, number], o: { metal?: number; rough?: number; emissive?: [number, number, number] } = {}) {
  const m = new PBRMaterial(`keepprop_${name}`, scene);
  m.albedoColor = new Color3(c[0], c[1], c[2]);
  m.metallic = o.metal ?? 0;
  m.roughness = o.rough ?? 0.85;
  if (o.emissive) m.emissiveColor = new Color3(o.emissive[0], o.emissive[1], o.emissive[2]);
  applyLightBudget([m]);
  return m;
}

/** A node shown while wanted and while its set is shown. */
interface Toggle {
  want(on: boolean): void;
  setEnabled(on: boolean): void;
}

/**
 * The keep's props, made from the anchors and the pipeline's placements when the underground is
 * built (`underground.props`), each hidden and shown with its room's level. Chapters work them:
 * `chest(name).open()`, `rack(name).take("sword")`, `shelf.take()`, `cage.open()`, `bridge.set()`,
 * `beam(on)`, `gateBar(on)`, and get fresh items from `keyring()`, `key()`, `carriedTorch()`,
 * `armour()`, `letter()`, `warrant()`.
 */
export class KeepProps {
  readonly chests = new Map<string, ChestProp>();
  readonly racks = new Map<string, RackProp>();
  readonly pickups = new Map<string, PickupProp>();
  shelf: ShelfProp | null = null;
  cage: CageProp | null = null;
  bridge: GalleryBridge | null = null;
  /** the wall sconces' torches by light anchor (K9: the companion takes one off its bracket) */
  readonly sconces = new Map<string, { root: TransformNode; torch: TransformNode | null }>();
  private mats: Mats;
  /** the interior's own materials among `mats` (they expect its baked AO in the vertex colours) */
  private baked = new Set<Material>();
  private nodes: TransformNode[] = [];
  private bodies: BodyId[] = [];
  private doors: HingedDoor[] = [];
  private beamNode: Toggle | null = null;
  private barNode: Toggle | null = null;
  private disposed = false;
  /** the keep placements' height correction (runtime keep base − 37.73) */
  private dy: number;

  constructor(
    private host: PropHost,
    private pa: PropAssets = { meta: null, containers: new Map() },
  ) {
    const s = host.world.scene;
    const m = host.materials;
    this.dy = host.origin.y - KEEP_BASE;
    this.mats = {
      wood: m.get("ki_wood") ?? plain(s, "wood", [0.24, 0.16, 0.1]),
      planks: m.get("ki_planks") ?? plain(s, "planks", [0.42, 0.33, 0.22]),
      iron: m.get("ki_iron") ?? plain(s, "iron", [0.2, 0.18, 0.17], { metal: 0.8, rough: 0.55 }),
      leather: plain(s, "leather", [0.32, 0.19, 0.1], { rough: 0.75 }),
      potion: plain(s, "potion", [0.55, 0.04, 0.05], { rough: 0.15, emissive: [0.12, 0.0, 0.01] }),
      stone: plain(s, "stone", [0.36, 0.35, 0.33], { rough: 0.95 }),
      cloth: plain(s, "cloth", [0.45, 0.4, 0.32], { rough: 1 }),
      rope: plain(s, "rope", [0.5, 0.4, 0.26], { rough: 1 }),
      coals: plain(s, "coals", [0.08, 0.03, 0.02], { emissive: [0.5, 0.12, 0.02] }),
      paper: plain(s, "paper", [0.78, 0.72, 0.58], { rough: 1 }),
    };
    for (const k of ["ki_wood", "ki_planks", "ki_iron"]) {
      const mat = m.get(k);
      if (mat) this.baked.add(mat);
    }
    this.build();
  }

  /** The pipeline's placements (empty without `props/meta`). */
  private get pl() {
    return this.pa.meta?.placements ?? {};
  }

  // ---------------------------------------------------------------- lookups

  chest(name: string) {
    return this.chests.get(name) ?? null;
  }

  rack(name: string) {
    return this.racks.get(name) ?? null;
  }

  pickup(name: string) {
    return this.pickups.get(name) ?? null;
  }

  /** The beam that bars the postern from inside (K1 rebel), shown with the `blocker_postern` collider. */
  beam(on: boolean) {
    this.beamNode?.want(on);
  }

  /** The bar across the main gate's leaves (K1 imperial), shown with `blocker_gate`. */
  gateBar(on: boolean) {
    this.barNode?.want(on);
  }

  /** The attach recipe the pipeline measured for a held item (`kit/fpm#Sword_Bronze`, `procprops/keep#torch`, …). */
  held(source: string) {
    return this.pa.meta?.held[source] ?? null;
  }

  // ---------------------------------------------------------------- factories for the chapter

  /** A copy of a pipeline node (`asset#node`) as a free item, or null without it. */
  private item(source: string, name: string): TransformNode | null {
    const sp = spawn(this.pa, source, null, this.host.world.scene);
    if (!sp) return null;
    const root = new TransformNode(name, this.host.world.scene);
    sp.node.parent = root;
    this.nodes.push(root);
    return root;
  }

  /** The key ring (the leader's, handed to Kaja): a ring and three keys. */
  keyring(): TransformNode {
    const real = this.item("procprops/keep#key_ring", "keyring");
    if (real) return real;
    const s = this.host.world.scene;
    const root = new TransformNode("keyring", s);
    const ring = CreateTorus("keyring_ring", { diameter: 0.08, thickness: 0.008, tessellation: 16 }, s);
    ring.material = this.mats.iron;
    this.shade(ring);
    ring.parent = root;
    for (let i = 0; i < 3; i++) {
      const k = this.keyMesh(`keyring_key${i}`);
      k.parent = root;
      k.position.set(Math.cos(i * 0.6 - 0.6) * 0.04, -0.05, Math.sin(i * 0.6 - 0.6) * 0.04);
      k.rotation.z = (i - 1) * 0.35;
    }
    this.nodes.push(root);
    return root;
  }

  /** One iron key (the cage key the interrogator throws). */
  key(): TransformNode {
    const real = this.item("kit/fpm#Key_Metal", "key");
    if (real) return real;
    const root = new TransformNode("key", this.host.world.scene);
    this.keyMesh("key_mesh").parent = root;
    this.nodes.push(root);
    return root;
  }

  /** A torch to carry (`hand_l`, `Idle_Torch_Loop`; recipe `held("procprops/keep#torch")`); the flame sits at `flame`. */
  carriedTorch(): CarriedTorch {
    const s = this.host.world.scene;
    const real = spawn(this.pa, "procprops/keep#torch", null, s);
    if (real) {
      const root = new TransformNode("carried_torch", s);
      real.node.parent = root;
      const flame = real.find("torch_flame") ?? root;
      return { root, flame, dispose: () => root.dispose() };
    }
    const root = new TransformNode("carried_torch", s);
    const stick = CreateCylinder("torch_stick", { height: 0.55, diameterTop: 0.035, diameterBottom: 0.028, tessellation: 7 }, s);
    stick.material = this.mats.wood;
    stick.position.y = 0.2;
    const head = CreateCylinder("torch_head", { height: 0.12, diameter: 0.06, tessellation: 7 }, s);
    head.material = this.mats.rope;
    head.position.y = 0.48;
    this.shade(stick);
    this.shade(head);
    const mesh = Mesh.MergeMeshes([stick, head], true, true, undefined, false, true)!;
    mesh.parent = root;
    mesh.isPickable = false;
    const flame = new TransformNode("torch_flame", s);
    flame.parent = root;
    flame.position.y = 0.55;
    return { root, flame, dispose: () => root.dispose() };
  }

  /** A folded leather armour bundle (the chest's armour: `chest.content = props.armour()`). */
  armour(): TransformNode {
    const root = new TransformNode("armour_bundle", this.host.world.scene);
    const M = this.mats;
    this.merge(root, "armour_mesh", [this.box("armour_fold", 0.55, 0.1, 0.36, 0, 0.05, 0, M.leather), this.box("armour_belt", 0.6, 0.025, 0.05, 0, 0.1, 0.06, M.iron), this.box("armour_strap", 0.04, 0.02, 0.4, 0.18, 0.105, 0, M.leather)]);
    this.nodes.push(root);
    return root;
  }

  /** A sealed letter (the barracks footlocker's, the courier's). */
  letter(): TransformNode {
    const real = this.item("procprops/keep#paper_letter", "letter");
    if (real) return real;
    const root = new TransformNode("letter", this.host.world.scene);
    this.merge(root, "letter_mesh", [this.box("letter_sheet", 0.2, 0.01, 0.14, 0, 0.005, 0, this.mats.paper)]);
    this.nodes.push(root);
    return root;
  }

  /** The blank warrant Ivo shows (K6 imperial, `hand_l`; recipe `held("procprops/keep#paper_warrant")`). */
  warrant(): TransformNode {
    const real = this.item("procprops/keep#paper_warrant", "warrant");
    if (real) return real;
    const root = new TransformNode("warrant", this.host.world.scene);
    this.merge(root, "warrant_mesh", [this.box("warrant_sheet", 0.21, 0.3, 0.004, 0, 0, 0, this.mats.paper)]);
    this.nodes.push(root);
    return root;
  }

  // ---------------------------------------------------------------- building

  private build() {
    const an = this.host.keep.anchors;
    for (const [name, a] of Object.entries(an)) {
      try {
        if (a.kind === "use") this.buildUse(name, a);
        else if (a.kind === "prop") this.buildDressing(name, a);
      } catch (e) {
        console.warn(`keep prop ${name}`, e);
      }
    }
    // the wall sconces under the light anchors' flames, and the fixtures the pipeline placed
    try {
      this.buildSconces();
      this.buildFixtures();
    } catch (e) {
      console.warn("keep props", e);
    }
    // the beam behind the postern and the bar across the gate (hidden until a chapter bars them)
    if (an.blocker_postern) this.beamNode = this.postBeam();
    if (an.blocker_gate) this.barNode = this.gateBeam();
  }

  private buildUse(name: string, a: KeepAnchor) {
    const prop = a.prop ?? "";
    if (/Chest_Wood/.test(prop)) this.chests.set(name, this.makeChest(name, a));
    else if (/WeaponStand/.test(prop)) this.racks.set(name, this.makeRack(name, a.items ?? []));
    else if (/Shelf_Small_Bottles/.test(prop)) this.shelf = this.makeShelf(name, (a.items ?? []).length || 2);
    else if (/Table_Large/.test(prop)) this.table(name, a, { records: true });
    else if (name === "use_cell_potion") this.pickups.set(name, this.makePotionPickup(name));
  }

  private buildDressing(name: string, a: KeepAnchor) {
    const prop = a.prop ?? "";
    if (/Cauldron/.test(prop)) this.brazier(name, a);
    else if (/wooden_table_02/.test(prop)) this.table(name, a, { small: true });
    else if (/Table_Large/.test(prop)) this.table(name, a, { dice: true });
    else if (/Bed_Twin1/.test(prop)) this.bed(name, a);
    else if (/Stool/.test(prop)) this.stool(name, a);
    else if (/procprops\/cage/.test(prop)) this.cage = this.makeCage(name);
    else if (/strap_chair/.test(prop)) this.strapChair(name);
    else if (/shackles/.test(prop)) this.shackles(name);
    else if (/^ph\//.test(prop)) this.phDressing(name, prop);
  }

  /** A prop root at an anchor (or a placement): on the floor, facing the yaw (its front is local −Z). */
  private rootAt(name: string, o: { at?: Vector3; yaw?: number; set?: PropSet } = {}) {
    const s = this.host.world.scene;
    const an = this.host.anchor(name);
    const root = new TransformNode(`prop_${name}`, s);
    root.position.copyFrom(o.at ?? an.pos);
    root.rotation.y = o.yaw ?? an.yaw;
    this.track(root, o.set ?? this.host.setAt(root.position.add(new Vector3(0, 0.3, 0))));
    return { root, an };
  }

  private track(root: TransformNode, set?: PropSet) {
    this.nodes.push(root);
    if (set) this.host.addToSet(set, root);
  }

  /** A keep placement's position at the runtime keep base. */
  private kp(p: Placement) {
    return v3(p.at, this.dy);
  }

  /** The pipeline's model for an anchor's suggestion (`kit/X`, `procprops/x`, `ph/x`) under `root`, or null. */
  private model(root: TransformNode, suggested: string | undefined): Spawned | null {
    if (!suggested) return null;
    const r = this.pa.meta?.resolve[suggested];
    const source = r ? `${r.asset}#${r.node}` : /^ph\//.test(suggested) ? suggested : null;
    if (!source) return null;
    return spawn(this.pa, source, root, this.host.world.scene);
  }

  /** A box collider from a kit model's bounds (meta), in the root's frame. */
  private bboxCollider(root: TransformNode, kitName: string, fallback: [number, number, number]) {
    const b = this.pa.meta?.kit[kitName]?.bbox;
    if (b) return this.collider(root, (b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2, (b.min[2] + b.max[2]) / 2, (b.max[0] - b.min[0]) / 2, (b.max[1] - b.min[1]) / 2, (b.max[2] - b.min[2]) / 2);
    return this.collider(root, 0, fallback[1], 0, fallback[0], fallback[1], fallback[2]);
  }

  /** Static bodies for a spawned prop's own colliders (tags from their extras). */
  private colliders(sp: Spawned, root: TransformNode, only?: (m: AbstractMesh) => boolean) {
    root.computeWorldMatrix(true);
    for (const n of root.getDescendants(false)) (n as TransformNode).computeWorldMatrix?.(true);
    const bodies = colliders(this.host.physics, sp, "prop", only);
    this.bodies.push(...bodies.values());
    return bodies;
  }

  /** Merge parts (each with its material) into one mesh under `root`. */
  private merge(root: TransformNode, name: string, parts: Mesh[]) {
    if (!parts.length) return null;
    // the interior's materials are lit through its baked ambient occlusion (vertex colours, mean
    // ≈ 0.3): stand-in parts in them get a matching flat shade, the rest white
    for (const p of parts) this.shade(p);
    const m = parts.length === 1 ? parts[0] : Mesh.MergeMeshes(parts, true, true, undefined, false, true);
    if (!m) return null;
    m.hasVertexAlpha = false;
    m.name = name;
    m.parent = root;
    m.isPickable = false;
    m.receiveShadows = true;
    return m;
  }

  /** Flat vertex colours: the interior's baked shade for its materials, white for the others. */
  private shade(m: Mesh) {
    const n = m.getTotalVertices();
    if (!n) return;
    const k = m.material && this.baked.has(m.material) ? BAKED_SHADE : 1;
    const c = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) c.set([k, k, k, 1], i * 4);
    m.setVerticesData(VertexBuffer.ColorKind, c);
  }

  private box(name: string, w: number, h: number, d: number, x: number, y: number, z: number, mat: Material) {
    const b = CreateBox(name, { width: w, height: h, depth: d }, this.host.world.scene);
    b.position.set(x, y, z);
    b.material = mat;
    return b;
  }

  private cyl(name: string, dia: number, h: number, x: number, y: number, z: number, mat: Material, o: { top?: number; tess?: number; rx?: number; rz?: number } = {}) {
    const c = CreateCylinder(name, { height: h, diameterTop: o.top ?? dia, diameterBottom: dia, tessellation: o.tess ?? 10 }, this.host.world.scene);
    c.position.set(x, y, z);
    if (o.rx) c.rotation.x = o.rx;
    if (o.rz) c.rotation.z = o.rz;
    c.material = mat;
    return c;
  }

  /** A static box collider in the root's frame (centre and half extents local). */
  private collider(root: TransformNode, cx: number, cy: number, cz: number, hx: number, hy: number, hz: number, tag = "prop") {
    root.computeWorldMatrix(true);
    const c = Vector3.TransformCoordinates(new Vector3(cx, cy, cz), root.getWorldMatrix());
    const q = Quaternion.RotationYawPitchRoll(root.rotation.y, 0, 0);
    const id = this.host.physics.addBox(c, new Vector3(hx, hy, hz), q, { tag });
    this.bodies.push(id);
    return id;
  }

  /** The point `d` m in front of a root (on its floor), where the player stands to use it. */
  private front(root: TransformNode, d: number) {
    const y = root.rotation.y;
    return root.position.add(new Vector3(-Math.sin(y) * d, 0, -Math.cos(y) * d));
  }

  /** Move a wall prop back until its back (`depth` / 2 behind its centre) touches the wall behind it (within 1.2 m). */
  private toWall(root: TransformNode, depth: number) {
    const y = root.rotation.y;
    const back = new Vector3(Math.sin(y), 0, Math.cos(y));
    const from = root.position.add(new Vector3(0, 1.0, 0));
    const d = this.host.physics.rayCastStatic(from, back, 1.6);
    if (!Number.isFinite(d)) return;
    const gap = d - depth / 2 - 0.02;
    if (gap > 0.01 && gap < 1.2) root.position.addInPlace(back.scale(gap));
  }

  // ---------------------------------------------------------------- chests

  private makeChest(name: string, a: KeepAnchor): ChestProp {
    const { root } = this.rootAt(name);
    const sp = this.model(root, a.prop);
    const h = this.pa.meta?.kit.Chest_Wood?.hinge;
    const lid = sp && h ? sp.find(h.node) : null;
    if (sp && lid && h) {
      const door = new HingedDoor({ hinge: lid, openYaw: h.openAngle, axis: v3(h.axis), bus: this.host.world });
      this.doors.push(door);
      const body = this.bboxCollider(root, "Chest_Wood", [0.6, 0.35, 0.35]);
      const loot = sp.find("Chest_Wood_loot");
      const at = loot ? loot.position.clone() : new Vector3(0, 0.32, 0);
      return this.chestHandle(name, root, door, body, at, true);
    }
    sp?.dispose();
    const M = this.mats;
    const W = 0.9, H = 0.48, D = 0.55;
    const parts = [
      this.box(`${name}_body`, W, H, D, 0, H / 2, 0, M.wood),
      this.box(`${name}_band1`, W + 0.02, 0.05, D + 0.02, 0, 0.12, 0, M.iron),
      this.box(`${name}_band2`, W + 0.02, 0.05, D + 0.02, 0, H - 0.08, 0, M.iron),
      this.box(`${name}_inner`, W - 0.08, 0.02, D - 0.08, 0, H - 0.04, 0, M.planks),
    ];
    this.merge(root, `${name}_mesh`, parts);
    // the lid on a hinge along the back edge (local +Z is the back: the front faces −Z)
    const hinge = new TransformNode(`${name}_lid_hinge`, this.host.world.scene);
    hinge.parent = root;
    hinge.position.set(0, H, D / 2);
    this.merge(hinge, `${name}_lid`, [this.box(`${name}_lidb`, W + 0.02, 0.1, D + 0.02, 0, 0.05, -D / 2, M.wood), this.box(`${name}_lidband`, W + 0.04, 0.03, 0.06, 0, 0.05, -D + 0.04, M.iron), this.box(`${name}_lock`, 0.08, 0.1, 0.03, 0, 0.0, -D - 0.005, M.iron)]);
    const door = new HingedDoor({ hinge, openYaw: (105 * Math.PI) / 180, axis: new Vector3(1, 0, 0), bus: this.host.world });
    this.doors.push(door);
    const body = this.collider(root, 0, H / 2, 0, W / 2, H / 2, D / 2);
    return this.chestHandle(name, root, door, body, new Vector3(0, H - 0.03, 0), false);
  }

  private chestHandle(name: string, root: TransformNode, door: HingedDoor, body: BodyId, inside: Vector3, real: boolean): ChestProp {
    let content: TransformNode | null = null;
    return {
      name,
      root,
      use: this.front(root, 0.5),
      body,
      real,
      inside: Vector3.TransformCoordinates(inside, root.computeWorldMatrix(true)),
      get opened() {
        return door.t > 0.5;
      },
      open: async (seconds = 0.9) => {
        await door.open(seconds);
      },
      set: (open) => door.set(open ? 1 : 0),
      get content() {
        return content;
      },
      set content(n) {
        content = n;
        if (n) {
          n.parent = root;
          n.position.copyFrom(inside);
        }
      },
      take: () => {
        content?.dispose();
        content = null;
      },
    };
  }

  // ---------------------------------------------------------------- weapon stands

  private makeRack(name: string, items: readonly string[]): RackProp {
    const place = this.pl.weapon_stands?.find((p) => p.anchor === name);
    const at = place ? this.kp(place) : undefined;
    const { root } = this.rootAt(name, { at, yaw: place?.yaw });
    const sp = place ? spawn(this.pa, place.item ?? "kit/fpm#WeaponStand", root, this.host.world.scene) : null;
    const kinds = items.map((s): ItemId => (/shield/i.test(s) ? "shield" : /axe/i.test(s) ? "axe" : "sword"));
    const ids: string[] = [];
    kinds.forEach((k, i) => ids.push(k === "axe" && /father|Brun/.test(items[i]) ? "father_axe" : ids.includes(k) ? `${k}${i}` : k));
    type Slot = RackSlot & { taken: boolean };
    let slots: Slot[];
    let ready: Promise<void>;
    let body: BodyId;
    const real = !!sp;
    if (sp && place) {
      body = this.bboxCollider(root, "WeaponStand", [0.65, 0.55, 0.45]);
      // the pipeline put each weapon in its notch: copy them where it says (world), in its order
      const list: (Placement & { kind: ItemId; id: string })[] = place.items.map((it, i) => ({ ...it, kind: kinds[i] ?? "sword", id: ids[i] ?? `item${i}` }));
      const si = kinds.indexOf("shield");
      if (place.shield?.item && si >= 0) list.push({ ...place.shield, kind: "shield", id: ids[si] });
      const set = this.host.setAt(root.position.add(new Vector3(0, 0.3, 0)));
      slots = list.map((it) => {
        const node = it.item ? (spawn(this.pa, it.item, null, this.host.world.scene)?.node ?? null) : null;
        const pos = this.kp(it);
        if (node) {
          placeNode(node, pos, it.yaw ?? 0, it.rotation, it.scale);
          // the kite shield leans back against the stand's front
          if (it.kind === "shield" && !it.rotation) node.rotation.x = -0.22;
          this.track(node, set);
        }
        return { id: it.id, kind: it.kind, pos, node, taken: false };
      });
      ready = Promise.resolve();
    } else {
      // the stand-in: a frame against the wall with the weapons upright in it
      const M = this.mats;
      const W = 1.3, D = 0.4;
      this.toWall(root, D);
      this.merge(root, `${name}_mesh`, [
        this.box(`${name}_base`, W, 0.08, D, 0, 0.04, 0, M.wood),
        this.box(`${name}_postl`, 0.08, 1.35, 0.08, -W / 2 + 0.05, 0.7, 0.1, M.wood),
        this.box(`${name}_postr`, 0.08, 1.35, 0.08, W / 2 - 0.05, 0.7, 0.1, M.wood),
        this.box(`${name}_top`, W, 0.07, 0.1, 0, 1.25, 0.1, M.wood),
        this.box(`${name}_rail`, W - 0.1, 0.05, 0.08, 0, 0.42, -0.02, M.wood),
      ]);
      body = this.collider(root, 0, 0.68, 0.05, W / 2, 0.68, D / 2);
      const n = kinds.length;
      const xOf = (i: number) => (n === 1 ? 0 : -0.4 + (0.8 * i) / (n - 1));
      slots = kinds.map((kind, i) => ({ id: ids[i], kind, pos: Vector3.TransformCoordinates(new Vector3(xOf(i), 0.08, 0), root.computeWorldMatrix(true)), node: null, taken: false }));
      ready = Promise.all(
        slots.map(async (sl, i) => {
          const it = await loadItem(this.host.world, sl.kind);
          if (!it) return;
          if (this.disposed || sl.taken) return it.node.dispose();
          const node = it.node;
          node.parent = root;
          node.rotationQuaternion = null;
          if (sl.kind === "shield") {
            node.position.set(xOf(i), 0.62, -0.16);
            node.rotation.set(-0.18, Math.PI, 0);
          } else {
            node.position.set(xOf(i), sl.kind === "sword" ? 0.33 : 0.1, 0.02);
            node.rotation.set(0.06, 0, 0);
          }
          for (const m of node.getChildMeshes(false)) m.isPickable = false;
          sl.node = node;
        }),
      ).then(() => undefined);
    }
    return {
      name,
      root,
      use: this.front(root, 0.75),
      body,
      real,
      slots,
      ready,
      slot: (id) => slots.find((s) => s.id === id) ?? null,
      has: (id) => !!slots.find((s) => s.id === id && !s.taken),
      take: (id) => {
        const s = slots.find((x) => x.id === id);
        if (!s || s.taken) return;
        s.taken = true;
        s.node?.dispose();
        s.node = null;
      },
    };
  }

  // ---------------------------------------------------------------- the storeroom shelf, potions

  private potionMesh(name: string, parent: TransformNode, x: number, y: number, z: number) {
    const M = this.mats;
    return this.merge(parent, name, [this.cyl(`${name}_b`, 0.09, 0.11, x, y + 0.055, z, M.potion, { tess: 10 }), this.cyl(`${name}_n`, 0.035, 0.05, x, y + 0.135, z, M.potion, { tess: 8 }), this.cyl(`${name}_c`, 0.04, 0.025, x, y + 0.17, z, M.wood, { tess: 8 })])!;
  }

  private makeShelf(name: string, count: number): ShelfProp {
    const place = this.pl.store_shelf;
    const at = place ? this.kp(place) : undefined;
    const { root } = this.rootAt(name, { at, yaw: place?.yaw });
    const sp = place ? spawn(this.pa, place.item ?? "kit/fpm#Shelf_Small_Bottles", root, this.host.world.scene) : null;
    const potions: TransformNode[] = [];
    if (sp && place) {
      for (const p of place.potions.slice(0, count)) {
        const n = spawn(this.pa, p.item ?? "kit/fpm#Potion_2", null, this.host.world.scene)?.node;
        if (!n) continue;
        placeNode(n, this.kp(p), p.yaw ?? 0, p.rotation, p.scale);
        this.track(n, this.host.setAt(root.position));
        potions.push(n);
      }
    } else {
      // a small wall shelf at the anchor's height, in brackets, with a jar either side
      const M = this.mats;
      const W = 0.9, D = 0.26;
      this.toWall(root, D);
      const parts = [this.box(`${name}_board`, W, 0.04, D, 0, -0.02, 0, M.planks)];
      for (const x of [-0.36, 0.36]) parts.push(this.box(`${name}_br${x}`, 0.04, 0.22, 0.04, x, -0.13, D / 2 - 0.03, M.iron));
      parts.push(this.cyl(`${name}_jar1`, 0.13, 0.17, -0.33, 0.085, 0, M.stone), this.cyl(`${name}_jar2`, 0.1, 0.13, 0.34, 0.065, 0.02, M.stone));
      this.merge(root, `${name}_mesh`, parts);
      for (let i = 0; i < count; i++) potions.push(this.potionMesh(`${name}_potion${i}`, root, -0.1 + i * 0.2, 0, -0.02));
    }
    let left = potions.length;
    const show = () => potions.forEach((p, i) => p.setEnabled(i < left));
    // the prompt on the floor in front of it
    const use = this.front(root, 0.6);
    const down = this.host.physics.rayCastStatic(use.add(new Vector3(0, 0.1, 0)), new Vector3(0, -1, 0), 2);
    if (Number.isFinite(down)) use.y += 0.1 - down;
    return {
      name,
      root,
      use,
      body: null,
      real: !!sp,
      get left() {
        return left;
      },
      take: (n = left) => {
        const k = Math.max(0, Math.min(left, n));
        left -= k;
        show();
        return k;
      },
      setLeft: (n) => {
        left = Math.max(0, Math.min(potions.length, n));
        show();
      },
    };
  }

  private makePotionPickup(name: string): PickupProp {
    const { root } = this.rootAt(name);
    const sp = spawn(this.pa, "kit/fpm#Potion_2", root, this.host.world.scene);
    const mesh: Node = sp ? sp.node : this.potionMesh(`${name}_potion`, root, 0, 0, 0);
    let taken = false;
    return {
      name,
      root,
      use: root.position.clone(),
      body: null,
      real: !!sp,
      get taken() {
        return taken;
      },
      take: () => {
        taken = true;
        mesh.setEnabled(false);
      },
    };
  }

  private keyMesh(name: string) {
    const M = this.mats;
    const parts = [this.cyl(`${name}_shaft`, 0.008, 0.075, 0, 0, 0, M.iron, { tess: 6 }), torusAt(this.host.world.scene, `${name}_bow`, 0.025, 0.006, 0, 0.045, 0, M.iron), this.box(`${name}_bit`, 0.018, 0.012, 0.004, 0.008, -0.03, 0, M.iron)];
    for (const p of parts) this.shade(p);
    return Mesh.MergeMeshes(parts, true, true, undefined, false, true)!;
  }

  // ---------------------------------------------------------------- the cage

  private makeCage(name: string): CageProp {
    const place = this.pl.cage;
    const { root, an } = this.rootAt(name, { at: place ? this.kp(place) : undefined, yaw: place?.yaw });
    const s = this.host.world.scene;
    const sp = spawn(this.pa, "procprops/keep#cage", root, s);
    const meta = this.pa.meta?.procprops.keep?.cage?.door;
    const hingeNode = sp && meta ? sp.find(meta.node) : null;
    if (sp && meta && hingeNode) {
      // the frame's colliders are static; the door's follows its hinge
      const doorCol = sp.cols.filter((m) => m.isDescendantOf(hingeNode));
      this.colliders(sp, root, (m) => !doorCol.includes(m));
      const g = worldGeometry(doorCol);
      const body = g.idx.length ? this.host.physics.addStaticMesh(g.pos, g.idx, { tag: "cage_door" }) : null;
      if (body) this.bodies.push(body);
      const door = new HingedDoor({ hinge: hingeNode, openYaw: meta.openYaw, axis: v3(meta.axis), physics: this.host.physics, body, bus: this.host.world });
      this.doors.push(door);
      const inside = sp.find("cage_inside");
      return {
        name,
        root,
        use: this.front(root, 1.5),
        body,
        real: true,
        door,
        inside: Vector3.TransformCoordinates(inside?.position ?? new Vector3(0, 0, 0.2), root.computeWorldMatrix(true)),
        open: (seconds = 1.2) => door.open(seconds),
      };
    }
    sp?.dispose();
    return this.standInCage(name, root, an.def.size ?? [2, 2.2, 2]);
  }

  private standInCage(name: string, root: TransformNode, size: V3): CageProp {
    const M = this.mats;
    const [W, H, D] = size;
    const s = this.host.world.scene;
    const bars: Mesh[] = [];
    const r = 0.015, step = 0.12;
    const hw = W / 2, hd = D / 2, doorW = 0.9;
    for (const y of [0.04, H / 2, H - 0.03])
      bars.push(this.box(`${name}_fb${y}`, W, 0.05, 0.03, 0, y, -hd, M.iron), this.box(`${name}_bb${y}`, W, 0.05, 0.03, 0, y, hd, M.iron), this.box(`${name}_lb${y}`, 0.03, 0.05, D, -hw, y, 0, M.iron), this.box(`${name}_rb${y}`, 0.03, 0.05, D, hw, y, 0, M.iron));
    for (const [x, z] of [[-hw, -hd], [hw, -hd], [-hw, hd], [hw, hd]]) bars.push(this.box(`${name}_post${x}${z}`, 0.06, H, 0.06, x, H / 2, z, M.iron));
    const vbar = (x: number, z: number) => bars.push(this.cyl(`${name}_v${x.toFixed(2)}_${z.toFixed(2)}`, r * 2, H, x, H / 2, z, M.iron, { tess: 5 }));
    for (let x = -hw + step; x < hw - 0.01; x += step) {
      vbar(x, hd);
      if (Math.abs(x) > doorW / 2 + 0.02) vbar(x, -hd);
    }
    for (let z = -hd + step; z < hd - 0.01; z += step) {
      vbar(-hw, z);
      vbar(hw, z);
    }
    for (let x = -hw + step; x < hw - 0.01; x += step * 2) bars.push(this.cyl(`${name}_t${x.toFixed(2)}`, r * 2, D, x, H - 0.02, 0, M.iron, { tess: 5, rx: Math.PI / 2 }));
    this.merge(root, `${name}_bars`, bars);
    this.merge(root, `${name}_floor`, [this.box(`${name}_planks`, W - 0.05, 0.05, D - 0.05, 0, 0.025, 0, M.planks), this.box(`${name}_straw`, 0.9, 0.06, 0.7, 0.3, 0.06, 0.4, M.cloth)]);
    const t = 0.05;
    this.collider(root, 0, H / 2, hd, hw, H / 2, t);
    this.collider(root, -hw, H / 2, 0, t, H / 2, hd);
    this.collider(root, hw, H / 2, 0, t, H / 2, hd);
    const side = (hw - doorW / 2) / 2;
    this.collider(root, -hw + side, H / 2, -hd, side, H / 2, t);
    this.collider(root, hw - side, H / 2, -hd, side, H / 2, t);
    const hinge = new TransformNode(`${name}_door_hinge`, s);
    hinge.parent = root;
    hinge.position.set(-doorW / 2, 0, -hd);
    const db: Mesh[] = [];
    for (let x = 0.08; x < doorW - 0.04; x += step) db.push(this.cyl(`${name}_dv${x.toFixed(2)}`, r * 2, H - 0.25, x, (H - 0.25) / 2 + 0.08, 0, M.iron, { tess: 5 }));
    for (const y of [0.1, (H - 0.1) / 2, H - 0.2]) db.push(this.box(`${name}_dh${y}`, doorW, 0.05, 0.03, doorW / 2, y, 0, M.iron));
    db.push(this.box(`${name}_lock`, 0.1, 0.14, 0.06, doorW - 0.06, (H - 0.1) / 2, -0.02, M.iron));
    this.merge(hinge, `${name}_door`, db);
    const dc = CreateBox(`${name}_door_col`, { width: doorW, height: H - 0.1, depth: 0.06 }, s);
    dc.parent = hinge;
    dc.position.set(doorW / 2, (H - 0.1) / 2 + 0.05, 0);
    root.computeWorldMatrix(true);
    hinge.computeWorldMatrix(true);
    const g = worldGeometry([dc]);
    dc.dispose();
    const body = this.host.physics.addStaticMesh(g.pos, g.idx, { tag: "cage_door" });
    this.bodies.push(body);
    const door = new HingedDoor({ hinge, openYaw: Math.PI / 2, physics: this.host.physics, body, bus: this.host.world });
    this.doors.push(door);
    return {
      name,
      root,
      use: this.front(root, 1.5),
      body,
      real: false,
      door,
      inside: Vector3.TransformCoordinates(new Vector3(0.2, 0.05, 0.3), root.computeWorldMatrix(true)),
      open: (seconds = 1.2) => door.open(seconds),
    };
  }

  // ---------------------------------------------------------------- sconces, fixtures, the gallery

  /** Wall sconces under the light anchors' flames (`placements.sconces`; else a stand-in torch per sconce anchor). */
  private buildSconces() {
    const list = this.pl.sconces;
    const s = this.host.world.scene;
    if (list?.length && this.pa.containers.has("procprops/keep")) {
      for (const p of list) {
        const flame = p.flame ? v3(p.flame, this.dy) : this.kp(p);
        const root = new TransformNode(`sconce_${p.anchor}`, s);
        placeNode(root, this.kp(p), p.yaw ?? 0);
        const sp = spawn(this.pa, "procprops/keep#sconce", root, s);
        if (!sp) {
          root.dispose();
          continue;
        }
        this.track(root, this.host.setAt(flame));
        this.sconces.set(p.anchor ?? root.name, { root, torch: sp.find("sconce_torch") });
      }
      return;
    }
    for (const [name, a] of Object.entries(this.host.keep.anchors)) if (a.kind === "light" && a.light === "sconce" && a.wall) this.wallTorch(name);
  }

  private wallTorch(name: string) {
    const a = this.host.keep.anchors[name];
    const flame = this.host.anchor(name).pos;
    const wall = flame.clone();
    if (a.wall) wall.addInPlace(new Vector3(a.wall.local[0] - a.local[0], a.wall.local[1] - a.local[1], a.wall.local[2] - a.local[2]));
    const s = this.host.world.scene;
    const root = new TransformNode(`torch_${name}`, s);
    root.position.copyFrom(wall);
    this.track(root, this.host.setAt(flame));
    const M = this.mats;
    const tip = flame.subtract(wall).add(new Vector3(0, -0.14, 0));
    const base = new Vector3(tip.x * 0.15, -0.32, tip.z * 0.15);
    const dir = tip.subtract(base);
    const stick = this.cyl(`${name}_stick`, 0.035, dir.length(), 0, 0, 0, M.wood, { top: 0.05, tess: 7 });
    stick.position.copyFrom(base.add(tip).scale(0.5));
    stick.rotationQuaternion = rotationFromUp(dir.normalize());
    const head = this.cyl(`${name}_head`, 0.065, 0.11, tip.x, tip.y + 0.02, tip.z, M.rope, { tess: 7 });
    const plate = this.box(`${name}_plate`, 0.1, 0.18, 0.02, 0, -0.26, 0, M.iron);
    const n = a.normal ?? [0, 0, 1];
    plate.rotation.y = Math.atan2(n[0], n[2]);
    this.merge(root, `${name}_mesh`, [stick, head, plate]);
    this.sconces.set(name, { root, torch: null });
  }

  /** The straw in the cells, the drain grate, the B3 irons, the J dice, the records, the camp's fire pit and the drawbridge. */
  private buildFixtures() {
    const s = this.host.world.scene;
    const P = this.pl;
    const simple = (p: Placement | undefined, source: string, set?: PropSet, cave = false) => {
      if (!p) return null;
      const root = new TransformNode(`fixture_${source.split("#").pop()}`, s);
      placeNode(root, cave ? v3(p.at) : this.kp(p), p.yaw ?? 0, p.rotation, p.scale);
      const sp = spawn(this.pa, p.item ?? source, root, s);
      if (!sp) {
        root.dispose();
        return null;
      }
      this.track(root, set ?? this.host.setAt(root.position.add(new Vector3(0, 0.3, 0))));
      this.colliders(sp, root);
      return { root, sp };
    };
    for (const p of P.straw_beds ?? []) simple(p, "procprops/keep#straw_bed");
    simple(P.drain_grate, "procprops/keep#drain_grate", "bs");
    simple(P.brazier_irons, "procprops/keep#brazier_irons");
    simple(P.dice, "procprops/keep#dice");
    for (const p of P.records ?? []) simple(p, p.item ?? "kit/fpm#Scroll_1");
    // the gallery (cave coordinates): the fire pit and the drawbridge set piece
    const camp = this.host.cave?.anchors.camp_fire;
    if (!simple(P.camp_fire, "ph/stone_fire_pit", "caveA", true) && camp) this.firePit(new Vector3(camp.pos[0], camp.pos[1], camp.pos[2]));
    const gb = simple(P.gallery_bridge, "procprops/keep#gallery_bridge", "caveA", true);
    if (gb) this.bridge = this.makeBridge(gb.sp);
  }

  /** The drawbridge (raised at first: the K11 lever lowers it, the K12 slab breaks it). */
  private makeBridge(sp: Spawned): GalleryBridge {
    const meta = this.pa.meta?.procprops.keep?.gallery_bridge;
    const angles = meta?.deck?.angles ?? { raised: -1.0472, lowered: 0, broken: 0.6109 };
    const hinge = sp.find(meta?.deck?.node ?? "bridge_hinge");
    const planks = (meta?.deck?.planks ?? []).map((n) => sp.find(n)).filter((n): n is TransformNode => !!n);
    const slab = sp.find(meta?.slab?.node ?? "slab");
    const chains: Record<BridgeState, TransformNode | null> = { raised: sp.find("bridge_chain_raised"), lowered: sp.find("bridge_chain_lowered"), broken: sp.find("bridge_chain_broken") };
    // every collider was built static; the deck's three take turns, one per state
    const ph = this.host.physics;
    const deckBodies: Record<BridgeState, BodyId[]> = { raised: ph.tagged("bridge_deck_raised"), lowered: ph.tagged("bridge_deck_lowered"), broken: ph.tagged("bridge_deck_broken") };
    slab?.setEnabled(false);
    const lever = sp.find("lever_pivot");
    const pull = (t: number) => {
      if (lever) lever.rotationQuaternion = Quaternion.RotationAxis(Vector3.Right(), LEVER_PULL * Math.max(0, Math.min(1, t)));
    };
    let state: BridgeState = "raised";
    const set = (st: BridgeState) => {
      state = st;
      pull(st === "raised" ? 0 : 1);
      if (hinge) hinge.rotationQuaternion = Quaternion.RotationAxis(Vector3.Right(), angles[st]);
      for (const k of ["raised", "lowered", "broken"] as const) {
        chains[k]?.setEnabled(k === st);
        for (const id of deckBodies[k]) ph.setBodyEnabled(id, k === st);
      }
      for (const p of planks) p.setEnabled(st !== "broken");
    };
    set("raised");
    return {
      get state() {
        return state;
      },
      set,
      pull,
      hinge,
      lever,
      drum: sp.find("winch_drum"),
      slab,
      planks,
      angles,
    };
  }

  // ---------------------------------------------------------------- dressing

  private brazier(name: string, a: KeepAnchor) {
    const { root } = this.rootAt(name);
    if (this.model(root, a.prop)) {
      this.bboxCollider(root, "Cauldron", [0.45, 0.4, 0.45]);
      return;
    }
    const M = this.mats;
    const parts: Mesh[] = [
      this.cyl(`${name}_bowl`, 0.42, 0.22, 0, 0.6, 0, M.iron, { top: 0.7, tess: 14 }),
      this.cyl(`${name}_coals`, 0.62, 0.05, 0, 0.73, 0, M.coals, { tess: 14 }),
      this.cyl(`${name}_ring`, 0.3, 0.06, 0, 0.06, 0, M.iron, { tess: 12 }),
    ];
    for (let i = 0; i < 3; i++) {
      const ang = (i * Math.PI * 2) / 3;
      const leg = this.cyl(`${name}_leg${i}`, 0.04, 0.62, Math.sin(ang) * 0.2, 0.3, Math.cos(ang) * 0.2, M.iron, { tess: 6 });
      leg.rotation.x = Math.cos(ang) * 0.25;
      leg.rotation.z = -Math.sin(ang) * 0.25;
      parts.push(leg);
    }
    this.merge(root, `${name}_mesh`, parts);
    this.collider(root, 0, 0.4, 0, 0.32, 0.4, 0.32);
  }

  private table(name: string, a: KeepAnchor, o: { small?: boolean; records?: boolean; dice?: boolean }) {
    const { root } = this.rootAt(name);
    const W = o.small ? 1.7 : 1.9, D = o.small ? 0.85 : 0.95, H = 0.78;
    const sp = this.model(root, a.prop);
    if (sp) {
      if (/Table_Large/.test(a.prop ?? "")) this.bboxCollider(root, "Table_Large", [W / 2, H / 2, D / 2]);
      else this.boundsCollider(root, sp);
      return;
    }
    const M = this.mats;
    const parts: Mesh[] = [this.box(`${name}_top`, W, 0.06, D, 0, H - 0.03, 0, M.wood)];
    for (const [x, z] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) parts.push(this.box(`${name}_leg${x}${z}`, 0.08, H - 0.06, 0.08, x * (W / 2 - 0.08), (H - 0.06) / 2, z * (D / 2 - 0.08), M.wood));
    parts.push(this.box(`${name}_stretch`, W - 0.2, 0.05, 0.05, 0, 0.2, 0, M.wood));
    if (o.records) {
      parts.push(this.box(`${name}_book`, 0.28, 0.06, 0.2, -0.4, H + 0.03, 0.05, M.leather), this.box(`${name}_paper1`, 0.22, 0.005, 0.3, 0.1, H + 0.003, -0.1, M.paper));
      parts.push(this.cyl(`${name}_scroll`, 0.05, 0.32, 0.55, H + 0.025, 0.1, M.paper, { tess: 8, rz: Math.PI / 2 }));
    }
    if (o.dice) parts.push(this.box(`${name}_die1`, 0.025, 0.025, 0.025, 0.1, H + 0.0125, 0.05, M.paper), this.box(`${name}_die2`, 0.025, 0.025, 0.025, 0.16, H + 0.0125, 0.02, M.paper), this.cyl(`${name}_cup`, 0.08, 0.1, -0.2, H + 0.05, 0.0, M.leather, { tess: 10 }));
    this.merge(root, `${name}_mesh`, parts);
    this.collider(root, 0, H / 2, 0, W / 2, H / 2, D / 2);
  }

  /** An axis-aligned box collider around a spawned model's meshes (a Poly Haven model has no bounds in the meta). */
  private boundsCollider(root: TransformNode, sp: Spawned) {
    root.computeWorldMatrix(true);
    if (!sp.meshes.length) return null;
    let min = new Vector3(Infinity, Infinity, Infinity), max = new Vector3(-Infinity, -Infinity, -Infinity);
    for (const m of sp.meshes) {
      m.computeWorldMatrix(true);
      const b = m.getBoundingInfo().boundingBox;
      min = Vector3.Minimize(min, b.minimumWorld);
      max = Vector3.Maximize(max, b.maximumWorld);
    }
    const id = this.host.physics.addBox(min.add(max).scale(0.5), max.subtract(min).scale(0.5), undefined, { tag: "prop" });
    this.bodies.push(id);
    return id;
  }

  private bed(name: string, a: KeepAnchor) {
    const { root } = this.rootAt(name);
    const W = 0.95, L = 2.0, H = 0.42;
    if (this.model(root, a.prop)) {
      this.bboxCollider(root, "Bed_Twin1", [W / 2, H / 2, L / 2]);
      return;
    }
    const M = this.mats;
    this.merge(root, `${name}_mesh`, [this.box(`${name}_frame`, W, 0.2, L, 0, 0.25, 0, M.wood), this.box(`${name}_mattress`, W - 0.08, 0.14, L - 0.1, 0, 0.42, 0, M.cloth), this.box(`${name}_head`, W, 0.8, 0.07, 0, 0.4, L / 2 - 0.035, M.wood), this.box(`${name}_foot`, W, 0.5, 0.06, 0, 0.25, -L / 2 + 0.03, M.wood)]);
    this.collider(root, 0, H / 2 + 0.05, 0, W / 2, H / 2 + 0.05, L / 2);
  }

  private stool(name: string, a: KeepAnchor) {
    const { root } = this.rootAt(name);
    if (this.model(root, a.prop)) return;
    const M = this.mats;
    const parts: Mesh[] = [this.cyl(`${name}_seat`, 0.36, 0.05, 0, 0.45, 0, M.wood, { tess: 12 })];
    for (let i = 0; i < 3; i++) {
      const ang = (i * Math.PI * 2) / 3;
      parts.push(this.cyl(`${name}_leg${i}`, 0.04, 0.44, Math.sin(ang) * 0.12, 0.22, Math.cos(ang) * 0.12, M.wood, { tess: 6 }));
    }
    this.merge(root, `${name}_mesh`, parts);
  }

  private strapChair(name: string) {
    const place = this.pl.strap_chair;
    const { root } = this.rootAt(name, { at: place ? this.kp(place) : undefined, yaw: place?.yaw });
    const sp = spawn(this.pa, "procprops/keep#strap_chair", root, this.host.world.scene);
    if (sp) {
      this.colliders(sp, root);
      return;
    }
    const M = this.mats;
    const parts = [this.box(`${name}_seat`, 0.6, 0.08, 0.6, 0, 0.48, 0, M.wood), this.box(`${name}_back`, 0.6, 0.9, 0.08, 0, 0.95, 0.28, M.wood), this.box(`${name}_strap1`, 0.62, 0.05, 0.62, 0, 0.56, 0, M.leather)];
    for (const [x, z] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) parts.push(this.box(`${name}_leg${x}${z}`, 0.07, 0.46, 0.07, x * 0.26, 0.23, z * 0.26, M.wood));
    this.merge(root, `${name}_mesh`, parts);
    this.collider(root, 0, 0.6, 0, 0.32, 0.6, 0.32);
  }

  private shackles(name: string) {
    const place = this.pl.shackles;
    const { root } = this.rootAt(name, { at: place ? this.kp(place) : undefined, yaw: place?.yaw });
    if (spawn(this.pa, "procprops/keep#shackles", root, this.host.world.scene)) return;
    this.toWall(root, 0.1);
    const M = this.mats;
    const s = this.host.world.scene;
    const parts: Mesh[] = [];
    for (const x of [-0.5, 0.5]) {
      parts.push(this.box(`${name}_plate${x}`, 0.12, 0.12, 0.03, x, 1.7, 0.05, M.iron));
      parts.push(torusAt(s, `${name}_cuff${x}`, 0.1, 0.02, x * 0.62, 1.25, 0.04, M.iron));
    }
    parts.push(this.box(`${name}_rags`, 0.7, 0.12, 0.45, 0, 0.06, -0.25, M.cloth));
    this.merge(root, `${name}_mesh`, parts);
  }

  /** A Poly Haven model as dressing (barrels, crates): the shipped asset, or a box of its size. */
  private phDressing(name: string, prop: string) {
    const { root } = this.rootAt(name);
    const sp = this.model(root, prop);
    if (sp) {
      this.boundsCollider(root, sp);
      return;
    }
    const crate = /crate/.test(prop);
    const size = crate ? [0.8, 0.8, 0.8] : [1.3, 1.0, 0.9];
    this.collider(root, 0, size[1] / 2, 0, size[0] / 2, size[1] / 2, size[2] / 2);
    const M = this.mats;
    this.merge(root, `${name}_mesh`, crate ? [this.box(`${name}_crate`, 0.8, 0.8, 0.8, 0, 0.4, 0, M.planks)] : [this.cyl(`${name}_b1`, 0.6, 0.9, -0.33, 0.45, 0, M.wood), this.cyl(`${name}_b2`, 0.6, 0.9, 0.33, 0.45, 0, M.wood)]);
  }

  private firePit(at: Vector3) {
    const s = this.host.world.scene;
    const root = new TransformNode("prop_camp_fire_pit", s);
    root.position.copyFrom(at);
    this.track(root, "caveA");
    const M = this.mats;
    const parts: Mesh[] = [];
    for (let i = 0; i < 9; i++) {
      const ang = (i * Math.PI * 2) / 9;
      const b = this.box(`pit_stone${i}`, 0.24, 0.16, 0.18, Math.sin(ang) * 0.55, 0.07, Math.cos(ang) * 0.55, M.stone);
      b.rotation.y = ang;
      parts.push(b);
    }
    parts.push(this.cyl("pit_coals", 0.6, 0.04, 0, 0.03, 0, M.coals, { tess: 12 }));
    this.merge(root, "camp_fire_pit", parts);
  }

  /** A wooden beam across the postern on its inside, in iron brackets (its blocker reaches over it: underground.ts BLOCKER_REACH). */
  private postBeam() {
    const an = this.host.anchor("blocker_postern");
    const root = new TransformNode("postern_beam", this.host.world.scene);
    // across the opening (along z), just inside the inner wall face
    root.position.set(an.pos.x + 0.78, an.pos.y - 0.15, an.pos.z);
    const M = this.mats;
    this.merge(root, "postern_beam_mesh", [this.box("beam", 0.22, 0.24, 2.3, 0, 0, 0, M.wood), this.box("beam_br1", 0.26, 0.34, 0.08, -0.02, 0, -1.0, M.iron), this.box("beam_br2", 0.26, 0.34, 0.08, -0.02, 0, 1.0, M.iron)]);
    return this.toggle(root, "gf");
  }

  /** A bar across both leaves of the main gate on the hall side (its blocker reaches over it: underground.ts BLOCKER_REACH). */
  private gateBeam() {
    const an = this.host.anchor("blocker_gate");
    const root = new TransformNode("gate_bar", this.host.world.scene);
    root.position.set(an.pos.x, an.pos.y - 1.2, an.pos.z - 0.45);
    const M = this.mats;
    this.merge(root, "gate_bar_mesh", [this.box("bar", 4.6, 0.26, 0.24, 0, 0, 0, M.wood), this.box("bar_br1", 0.1, 0.4, 0.3, -2.05, 0, 0.02, M.iron), this.box("bar_br2", 0.1, 0.4, 0.3, 2.05, 0, 0.02, M.iron)]);
    return this.toggle(root, "gf");
  }

  /** A root shown only while both its set shows it and it is wanted (a beam, a bar). */
  private toggle(root: TransformNode, set: PropSet): Toggle {
    let wanted = false, shown = false;
    root.setEnabled(false);
    this.nodes.push(root);
    const t: Toggle = {
      want: (on) => {
        wanted = on;
        root.setEnabled(wanted && shown);
      },
      setEnabled: (on) => {
        shown = on;
        root.setEnabled(wanted && shown);
      },
    };
    this.host.addToSet(set, t);
    return t;
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    for (const d of this.doors) d.dispose();
    for (const id of this.bodies) this.host.physics.removeBody(id);
    for (const n of this.nodes) n.dispose();
    for (const c of this.pa.containers.values()) c.dispose();
    this.chests.clear();
    this.racks.clear();
    this.pickups.clear();
  }
}

/** A torus at a point (for rings and key bows). */
function torusAt(scene: Scene, name: string, diameter: number, thickness: number, x: number, y: number, z: number, mat: Material) {
  const t = CreateTorus(name, { diameter, thickness, tessellation: 10 }, scene);
  t.position.set(x, y, z);
  t.material = mat;
  return t;
}

/** The rotation that turns +Y onto `dir` (unit). */
function rotationFromUp(dir: Vector3) {
  const up = Vector3.Up();
  const axis = Vector3.Cross(up, dir);
  const s = axis.length();
  if (s < 1e-6) return dir.y >= 0 ? Quaternion.Identity() : Quaternion.RotationAxis(Vector3.Right(), Math.PI);
  return Quaternion.RotationAxis(axis.scale(1 / s), Math.atan2(s, Vector3.Dot(up, dir)));
}
