// The keep's props behind one module (design §4.2 anchors, §10.2): chests with lids, weapon racks
// and their pickups, the storeroom shelf with its potions, the key ring, the prisoner cage with its
// door, wall torches, the beam and bar that seal the doors, and the rooms' dressing (braziers,
// tables, beds, barrels, the strap chair, the camp's fire pit). Each uses the content pipeline's
// model when the manifest has it (`kit/<Model>`, `ph/<id>`, `procprops/<name>`, the ids the keep
// anchors suggest) and a procedural stand-in made of boxes and cylinders in the interior's own
// materials otherwise, so swapping in the real props later happens here only.
import type { AnimationGroup } from "@babylonjs/core/Animations/animationGroup";
import type { AssetContainer } from "@babylonjs/core/assetContainer";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Quaternion, Vector3 } from "@babylonjs/core/Maths/math.vector";
import { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial";
import type { Material } from "@babylonjs/core/Materials/material";
import { VertexBuffer } from "@babylonjs/core/Buffers/buffer";
import { CreateBox } from "@babylonjs/core/Meshes/Builders/boxBuilder";
import { CreateCylinder } from "@babylonjs/core/Meshes/Builders/cylinderBuilder";
import { CreateTorus } from "@babylonjs/core/Meshes/Builders/torusBuilder";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import type { Node } from "@babylonjs/core/node";
import type { Scene } from "@babylonjs/core/scene";
import { assets } from "../../core/assets/AssetClient";
import { loadGLB } from "../../game/loaders";
import { applyLightBudget } from "../../engine/render/lightBudget";
import { worldGeometry } from "../../engine/physics/meshGeometry";
import type { BodyId, Physics } from "../../engine/physics/Physics";
import { HingedDoor } from "../../engine/world/HingedDoor";
import { loadItem, type ItemId } from "../gear";
import type { World } from "../World";
import type { KeepAnchor } from "./anchors";

/** A visibility set of the underground ("gf", "stair", "bs", "caveA", …). */
export type PropSet = string;

/** What the props need from the underground they stand in. */
export interface PropHost {
  readonly world: World;
  readonly physics: Physics;
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
  /** lift the lid (the real model plays `Chest_Open`); resolves once open */
  open(seconds?: number): Promise<void>;
  /** open or shut at once (a resumed checkpoint) */
  set(open: boolean): void;
  /** where something lies inside (world) */
  readonly inside: Vector3;
  /** put an item's node in the chest (the armour bundle, the letter); `take` removes it */
  content: TransformNode | null;
  take(): void;
}

/** One thing on a rack. */
export interface RackSlot {
  readonly id: string;
  readonly kind: ItemId;
  /** where it hangs (world) */
  readonly pos: Vector3;
  node: TransformNode | null;
  readonly taken: boolean;
}

/** A weapon stand with its weapons (the imperial sword and kite shield; Brun's father's axe, a sword and an axe). */
export interface RackProp extends PropBase {
  readonly slots: readonly RackSlot[];
  /** loaded once the weapon models are in */
  readonly ready: Promise<void>;
  slot(id: string): RackSlot | null;
  /** take a weapon off the rack (it disappears from it) */
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

/** A small thing lying somewhere (a potion in a cell, a key). */
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

/** A torch that can be carried (the companion's from K9), with its flame point. */
export interface CarriedTorch {
  readonly root: TransformNode;
  /** the flame's foot (put a sconce flame here; it moves with the torch) */
  readonly flame: TransformNode;
  dispose(): void;
}

const KIT_ASSETS = ["kit/fpm", "kit/props", "kit/megakit", "props/kit"];
/** The flat "baked" shade stand-ins in the interior's materials get (its mean vertex luminance is about 0.3). */
const BAKED_SHADE = 0.38;

/** Manifest sources for an anchor's suggested prop (`kit/X`, `ph/x`, `procprops/x`), best first. */
export function propSources(suggested: string): string[] {
  const [ns, name] = suggested.split("/");
  if (!name) return [];
  if (ns === "kit") return [`kit/${name}`, ...KIT_ASSETS.map((k) => `${k}#${name}`)];
  if (ns === "procprops") return [`procprops/${name}`, `procprops#${name}`, `props/procprops#${name}`];
  return [suggested];
}

/** The first source the manifest has (null: build the stand-in). */
export function shippedSource(suggested: string): string | null {
  return propSources(suggested).find((s) => assets.has(s.split("#")[0])) ?? null;
}

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

function plain(scene: Scene, name: string, c: [number, number, number], o: { metal?: number; rough?: number; emissive?: [number, number, number]; alpha?: number } = {}) {
  const m = new PBRMaterial(`keepprop_${name}`, scene);
  m.albedoColor = new Color3(c[0], c[1], c[2]);
  m.metallic = o.metal ?? 0;
  m.roughness = o.rough ?? 0.85;
  if (o.emissive) m.emissiveColor = new Color3(o.emissive[0], o.emissive[1], o.emissive[2]);
  applyLightBudget([m]);
  return m;
}

/**
 * The keep's props, made from the anchors when the underground is built (`underground.props`), each
 * hidden and shown with its room's level. Chapters work them: `chest(name).open()`,
 * `rack(name).take("sword")`, `shelf.take()`, `cage.open()`, `beam(on)`, `gateBar(on)`, and get
 * fresh ones made with `keyring()`, `key()`, `carriedTorch()`.
 */
export class KeepProps {
  readonly chests = new Map<string, ChestProp>();
  readonly racks = new Map<string, RackProp>();
  readonly pickups = new Map<string, PickupProp>();
  shelf: ShelfProp | null = null;
  cage: CageProp | null = null;
  private mats: Mats;
  /** the interior's own materials among `mats` (they expect its baked AO in the vertex colours) */
  private baked = new Set<Material>();
  private nodes: TransformNode[] = [];
  private bodies: BodyId[] = [];
  private doors: HingedDoor[] = [];
  private beamNode: Toggle | null = null;
  private barNode: Toggle | null = null;
  private containers = new Map<string, Promise<AssetContainer | null>>();
  private disposed = false;

  constructor(private host: PropHost) {
    const s = host.world.scene;
    const m = host.materials;
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

  // ---------------------------------------------------------------- factories for the chapter

  /** A key ring (the leader's, handed to Kaja): a ring and three keys, about 12 cm across. */
  keyring(): TransformNode {
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
    this.track(root);
    return root;
  }

  /** One iron key (the cage key the interrogator throws). */
  key(): TransformNode {
    const root = new TransformNode("key", this.host.world.scene);
    this.keyMesh("key_mesh").parent = root;
    this.track(root);
    return root;
  }

  /** A wall torch to carry (`hand_l`, `Idle_Torch_Loop`): a stick with a pitch-wrapped head; the flame sits at `flame`. */
  carriedTorch(): CarriedTorch {
    const s = this.host.world.scene;
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
    this.host.world.addShadowCasters([mesh]);
    return {
      root,
      flame,
      dispose: () => root.dispose(),
    };
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
    // wall torches under the sconce flames
    for (const [name, a] of Object.entries(an)) if (a.kind === "light" && a.light === "sconce" && a.wall) this.wallTorch(name);
    // the beam behind the postern and the bar across the gate (hidden until a chapter bars them)
    if (an.blocker_postern) this.beamNode = this.postBeam();
    if (an.blocker_gate) this.barNode = this.gateBeam();
    // the gallery camp's fire pit
    const camp = this.host.cave?.anchors.camp_fire;
    if (camp) this.firePit(new Vector3(camp.pos[0], camp.pos[1], camp.pos[2]));
  }

  private buildUse(name: string, a: KeepAnchor) {
    const prop = a.prop ?? "";
    if (/Chest_Wood/.test(prop)) this.chests.set(name, this.makeChest(name));
    else if (/WeaponStand/.test(prop)) this.racks.set(name, this.makeRack(name, a.items ?? []));
    else if (/Shelf_Small_Bottles/.test(prop)) this.shelf = this.makeShelf(name, (a.items ?? []).length || 2);
    else if (/Table_Large/.test(prop)) this.table(name, { records: true });
    else if (name === "use_cell_potion") this.pickups.set(name, this.makePotionPickup(name));
  }

  private buildDressing(name: string, a: KeepAnchor) {
    const prop = a.prop ?? "";
    if (/Cauldron/.test(prop)) this.brazier(name);
    else if (/wooden_table_02/.test(prop)) this.table(name, { small: true });
    else if (/Table_Large/.test(prop)) this.table(name, { dice: true });
    else if (/Bed_Twin1/.test(prop)) this.bed(name);
    else if (/Stool/.test(prop)) this.stool(name);
    else if (/procprops\/cage/.test(prop)) this.cage = this.makeCage(name);
    else if (/strap_chair/.test(prop)) this.strapChair(name);
    else if (/shackles/.test(prop)) this.shackles(name);
    else if (/^ph\//.test(prop)) this.shipped(name, prop);
  }

  /** A prop root at an anchor: on the floor, facing the anchor's yaw (its front is local −Z). */
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

  /** Merge parts (each with its material) into one mesh under `root`, a shadow caster that never moves. */
  private merge(root: TransformNode, name: string, parts: Mesh[], o: { cast?: boolean } = {}) {
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
    if (o.cast !== false) this.host.world.env.addShadowCaster(m);
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

  // ---------------------------------------------------------------- the props

  private makeChest(name: string): ChestProp {
    const { root, an } = this.rootAt(name);
    const M = this.mats;
    const W = 0.9, H = 0.48, D = 0.55;
    const real = this.model(root, an.def.prop);
    if (real) return this.realChest(name, root, real, { W, H, D });
    const parts = [
      this.box(`${name}_body`, W, H, D, 0, H / 2, 0, M.wood),
      this.box(`${name}_band1`, W + 0.02, 0.05, D + 0.02, 0, 0.12, 0, M.iron),
      this.box(`${name}_band2`, W + 0.02, 0.05, D + 0.02, 0, H - 0.08, 0, M.iron),
      this.box(`${name}_foot1`, 0.08, 0.04, D, -W / 2 + 0.06, 0.02, 0, M.iron),
      this.box(`${name}_foot2`, 0.08, 0.04, D, W / 2 - 0.06, 0.02, 0, M.iron),
    ];
    // the hollow: a dark inner floor seen with the lid up
    parts.push(this.box(`${name}_inner`, W - 0.08, 0.02, D - 0.08, 0, H - 0.04, 0, M.planks));
    this.merge(root, `${name}_mesh`, parts);
    // the lid on a hinge along the back edge (local +Z is the back: the front faces −Z)
    const s = this.host.world.scene;
    const hinge = new TransformNode(`${name}_lid_hinge`, s);
    hinge.parent = root;
    hinge.position.set(0, H, D / 2);
    const lid = this.merge(hinge, `${name}_lid`, [this.box(`${name}_lidb`, W + 0.02, 0.1, D + 0.02, 0, 0.05, -D / 2, M.wood), this.box(`${name}_lidband`, W + 0.04, 0.03, 0.06, 0, 0.05, -D + 0.04, M.iron), this.box(`${name}_lock`, 0.08, 0.1, 0.03, 0, 0.0, -D - 0.005, M.iron)]);
    void lid;
    const door = new HingedDoor({ hinge, openYaw: (105 * Math.PI) / 180, axis: new Vector3(1, 0, 0), bus: this.host.world });
    this.doors.push(door);
    const body = this.collider(root, 0, H / 2, 0, W / 2, H / 2, D / 2);
    const inside = Vector3.TransformCoordinates(new Vector3(0, H - 0.02, 0), root.computeWorldMatrix(true));
    let content: TransformNode | null = null;
    const chest: ChestProp = {
      name,
      root,
      use: this.front(root, 0.45),
      body,
      real: false,
      inside,
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
          n.position.set(0, H - 0.03, 0);
        }
      },
      take: () => {
        content?.dispose();
        content = null;
      },
    };
    return chest;
  }

  /** A chest from the pipeline's kit: its `Chest_Open` clip lifts the lid. */
  private realChest(name: string, root: TransformNode, groups: Promise<AnimationGroup[]>, size: { W: number; H: number; D: number }): ChestProp {
    const { W, H, D } = size;
    const body = this.collider(root, 0, H / 2, 0, W / 2, H / 2, D / 2);
    let group: AnimationGroup | null = null;
    let opened = false;
    void groups.then((gs) => {
      group = gs.find((g) => /open/i.test(g.name)) ?? gs[0] ?? null;
      for (const g of gs) g.stop();
      if (group) group.goToFrame(opened ? group.to : group.from);
    });
    let content: TransformNode | null = null;
    return {
      name,
      root,
      use: this.front(root, 0.45),
      body,
      real: true,
      inside: Vector3.TransformCoordinates(new Vector3(0, H - 0.02, 0), root.computeWorldMatrix(true)),
      get opened() {
        return opened;
      },
      open: async (seconds = 0.9) => {
        if (opened) return;
        opened = true;
        await groups;
        const g = group;
        if (!g) return;
        const len = (g.to - g.from) / 60;
        g.start(false, len > 0 && seconds > 0 ? len / seconds : 1, g.from, g.to);
        await new Promise<void>((r) => g.onAnimationGroupEndObservable.addOnce(() => r()));
      },
      set: (open) => {
        opened = open;
        if (group) {
          group.stop();
          group.goToFrame(open ? group.to : group.from);
        }
      },
      get content() {
        return content;
      },
      set content(n) {
        content = n;
        if (n) {
          n.parent = root;
          n.position.set(0, H - 0.03, 0);
        }
      },
      take: () => {
        content?.dispose();
        content = null;
      },
    };
  }

  /** A folded leather armour bundle (the chest's armour; `chest.content = props.armour()`). */
  armour(): TransformNode {
    const root = new TransformNode("armour_bundle", this.host.world.scene);
    const M = this.mats;
    this.merge(root, "armour_mesh", [this.box("armour_fold", 0.55, 0.1, 0.36, 0, 0.05, 0, M.leather), this.box("armour_belt", 0.6, 0.025, 0.05, 0, 0.1, 0.06, M.iron), this.box("armour_strap", 0.04, 0.02, 0.4, 0.18, 0.105, 0, M.leather)], { cast: false });
    this.track(root);
    return root;
  }

  /** A folded letter (the barracks footlocker's). */
  letter(): TransformNode {
    const root = new TransformNode("letter", this.host.world.scene);
    this.merge(root, "letter_mesh", [this.box("letter_sheet", 0.2, 0.01, 0.14, 0, 0.005, 0, this.mats.paper)], { cast: false });
    this.track(root);
    return root;
  }

  private makeRack(name: string, items: readonly string[]): RackProp {
    const { root, an } = this.rootAt(name);
    const M = this.mats;
    const W = 1.3, D = 0.4;
    this.toWall(root, D);
    if (!this.model(root, an.def.prop))
      this.merge(root, `${name}_mesh`, [
      this.box(`${name}_base`, W, 0.08, D, 0, 0.04, 0, M.wood),
      this.box(`${name}_postl`, 0.08, 1.35, 0.08, -W / 2 + 0.05, 0.7, 0.1, M.wood),
      this.box(`${name}_postr`, 0.08, 1.35, 0.08, W / 2 - 0.05, 0.7, 0.1, M.wood),
      this.box(`${name}_top`, W, 0.07, 0.1, 0, 1.25, 0.1, M.wood),
      this.box(`${name}_rail`, W - 0.1, 0.05, 0.08, 0, 0.42, -0.02, M.wood),
      this.box(`${name}_brace`, W - 0.1, 0.03, 0.03, 0, 1.25, 0.16, M.iron),
    ]);
    const body = this.collider(root, 0, 0.68, 0.05, W / 2, 0.68, D / 2);
    const kinds = items.map((s): ItemId => (/shield/.test(s) ? "shield" : /axe/.test(s) ? "axe" : "sword"));
    const ids: string[] = [];
    kinds.forEach((k, i) => {
      // Brun's father's axe comes first on the rebel stand
      const id = k === "axe" && /father|Brun/.test(items[i]) ? "father_axe" : ids.includes(k) ? `${k}${i}` : k;
      ids.push(id);
    });
    const n = kinds.length;
    const slots: (RackSlot & { taken: boolean })[] = kinds.map((kind, i) => {
      const x = n === 1 ? 0 : -0.4 + (0.8 * i) / (n - 1);
      return { id: ids[i], kind, pos: Vector3.TransformCoordinates(new Vector3(x, 0.08, 0), root.computeWorldMatrix(true)), node: null, taken: false };
    });
    const ready = Promise.all(
      slots.map(async (sl, i) => {
        const it = await loadItem(this.host.world, sl.kind);
        if (!it) return;
        if (this.disposed || sl.taken) {
          it.node.dispose();
          return;
        }
        const x = n === 1 ? 0 : -0.4 + (0.8 * i) / (n - 1);
        const node = it.node;
        node.parent = root;
        node.rotationQuaternion = null;
        if (sl.kind === "shield") {
          // leaning against the front of the rail, its face out
          node.position.set(x, 0.62, -0.16);
          node.rotation.set(-0.18, Math.PI, 0);
        } else if (sl.kind === "sword") {
          // grip low, blade up against the top rail
          node.position.set(x, 0.33, 0.02);
          node.rotation.set(0.06, 0, 0);
        } else {
          node.position.set(x, 0.1, 0.02);
          node.rotation.set(0.08, 0, 0);
        }
        for (const m of node.getChildMeshes(false)) m.isPickable = false;
        sl.node = node;
      }),
    ).then(() => undefined);
    const rack: RackProp = {
      name,
      root,
      use: this.front(root, 0.6),
      body,
      real: false,
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
    return rack;
  }

  private potionMesh(name: string, parent: TransformNode, x: number, y: number, z: number) {
    const M = this.mats;
    const m = this.merge(parent, name, [this.cyl(`${name}_b`, 0.09, 0.11, x, y + 0.055, z, M.potion, { tess: 10 }), this.cyl(`${name}_n`, 0.035, 0.05, x, y + 0.135, z, M.potion, { tess: 8 }), this.cyl(`${name}_c`, 0.04, 0.025, x, y + 0.17, z, M.wood, { tess: 8 })], { cast: false });
    return m!;
  }

  private makeShelf(name: string, count: number): ShelfProp {
    // a small shelf on the wall at the anchor's height (the potions stand on it), in brackets
    const { root, an } = this.rootAt(name);
    const M = this.mats;
    const W = 0.9, D = 0.26;
    this.toWall(root, D);
    const real = this.model(root, an.def.prop);
    const parts = [this.box(`${name}_board`, W, 0.04, D, 0, -0.02, 0, M.planks), this.box(`${name}_board2`, W, 0.04, D, 0, 0.42, 0, M.planks)];
    for (const x of [-0.36, 0.36]) parts.push(this.box(`${name}_br${x}`, 0.04, 0.2, 0.04, x, -0.13, D / 2 - 0.03, M.iron), this.box(`${name}_bru${x}`, 0.04, 0.16, 0.04, x, 0.32, D / 2 - 0.03, M.iron));
    // dressing that stays: jars and a bottle on the top board
    parts.push(this.cyl(`${name}_jar1`, 0.13, 0.17, -0.28, 0.525, 0, M.stone), this.cyl(`${name}_jar2`, 0.1, 0.13, 0.05, 0.505, 0, M.stone), this.cyl(`${name}_jar3`, 0.07, 0.2, 0.3, 0.54, 0, M.leather, { tess: 8 }));
    if (real) for (const m of parts) m.dispose();
    else this.merge(root, `${name}_mesh`, parts);
    const potions: Mesh[] = [];
    for (let i = 0; i < count; i++) potions.push(this.potionMesh(`${name}_potion${i}`, root, -0.1 + i * 0.2, 0, -0.02));
    let left = count;
    const show = () => potions.forEach((p, i) => p.setEnabled(i < left));
    // (the prompt's point on the floor in front of it)
    const use = this.front(root, 0.6);
    const down = this.host.physics.rayCastStatic(use.add(new Vector3(0, 0.1, 0)), new Vector3(0, -1, 0), 2);
    if (Number.isFinite(down)) use.y += 0.1 - down;
    const shelf: ShelfProp = {
      name,
      root,
      use,
      body: null,
      real: !!real,
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
        left = Math.max(0, Math.min(count, n));
        show();
      },
    };
    return shelf;
  }

  private makePotionPickup(name: string): PickupProp {
    const { root } = this.rootAt(name);
    const mesh = this.potionMesh(`${name}_potion`, root, 0, 0, 0);
    let taken = false;
    return {
      name,
      root,
      use: root.position.clone(),
      body: null,
      real: false,
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
    const parts = [this.cyl(`${name}_shaft`, 0.008, 0.075, 0, 0, 0, M.iron, { tess: 6 }), CreateTorusAt(this.host.world.scene, `${name}_bow`, 0.025, 0.006, 0, 0.045, 0, M.iron), this.box(`${name}_bit`, 0.018, 0.012, 0.004, 0.008, -0.03, 0, M.iron)];
    for (const p of parts) this.shade(p);
    return Mesh.MergeMeshes(parts, true, true, undefined, false, true)!;
  }

  private makeCage(name: string): CageProp {
    const { root, an } = this.rootAt(name);
    const M = this.mats;
    const size = an.def.size ?? [2, 2.2, 2];
    const [W, H, D] = size;
    const s = this.host.world.scene;
    const bars: Mesh[] = [];
    const r = 0.015, step = 0.12;
    const hw = W / 2, hd = D / 2, doorW = 0.9;
    // the frame: bottom and top rings and a mid band (flat iron), and corner posts
    for (const y of [0.04, H / 2, H - 0.03])
      bars.push(this.box(`${name}_fb${y}`, W, 0.05, 0.03, 0, y, -hd, M.iron), this.box(`${name}_bb${y}`, W, 0.05, 0.03, 0, y, hd, M.iron), this.box(`${name}_lb${y}`, 0.03, 0.05, D, -hw, y, 0, M.iron), this.box(`${name}_rb${y}`, 0.03, 0.05, D, hw, y, 0, M.iron));
    for (const [x, z] of [[-hw, -hd], [hw, -hd], [-hw, hd], [hw, hd]]) bars.push(this.box(`${name}_post${x}${z}`, 0.06, H, 0.06, x, H / 2, z, M.iron));
    const vbar = (x: number, z: number) => bars.push(this.cyl(`${name}_v${x.toFixed(2)}_${z.toFixed(2)}`, r * 2, H, x, H / 2, z, M.iron, { tess: 5 }));
    for (let x = -hw + step; x < hw - 0.01; x += step) {
      vbar(x, hd);
      // the front: no bars where the door is
      if (Math.abs(x) > doorW / 2 + 0.02) vbar(x, -hd);
    }
    for (let z = -hd + step; z < hd - 0.01; z += step) {
      vbar(-hw, z);
      vbar(hw, z);
    }
    // the roof: bars across
    for (let x = -hw + step; x < hw - 0.01; x += step * 2) bars.push(this.cyl(`${name}_t${x.toFixed(2)}`, r * 2, D, x, H - 0.02, 0, M.iron, { tess: 5, rx: Math.PI / 2 }));
    this.merge(root, `${name}_bars`, bars);
    // the floor boards and a little straw
    this.merge(root, `${name}_floor`, [this.box(`${name}_planks`, W - 0.05, 0.05, D - 0.05, 0, 0.025, 0, M.planks), this.box(`${name}_straw`, 0.9, 0.06, 0.7, 0.3, 0.06, 0.4, M.cloth)], { cast: false });
    // walls: one thin box per side (the front in two pieces either side of the door)
    const t = 0.05;
    this.collider(root, 0, H / 2, hd, hw, H / 2, t);
    this.collider(root, -hw, H / 2, 0, t, H / 2, hd);
    this.collider(root, hw, H / 2, 0, t, H / 2, hd);
    const side = (hw - doorW / 2) / 2;
    this.collider(root, -hw + side, H / 2, -hd, side, H / 2, t);
    this.collider(root, hw - side, H / 2, -hd, side, H / 2, t);
    // the door: hinged on its left post (seen from the front), swinging outward
    const hinge = new TransformNode(`${name}_door_hinge`, s);
    hinge.parent = root;
    hinge.position.set(-doorW / 2, 0, -hd);
    const db: Mesh[] = [];
    for (let x = 0.08; x < doorW - 0.04; x += step) db.push(this.cyl(`${name}_dv${x.toFixed(2)}`, r * 2, H - 0.25, x, (H - 0.25) / 2 + 0.08, 0, M.iron, { tess: 5 }));
    for (const y of [0.1, (H - 0.1) / 2, H - 0.2]) db.push(this.box(`${name}_dh${y}`, doorW, 0.05, 0.03, doorW / 2, y, 0, M.iron));
    db.push(this.box(`${name}_lock`, 0.1, 0.14, 0.06, doorW - 0.06, (H - 0.1) / 2, -0.02, M.iron));
    this.merge(hinge, `${name}_door`, db);
    // its collider: a box mesh under the hinge, made a body from its world geometry at rest
    const dc = CreateBox(`${name}_door_col`, { width: doorW, height: H - 0.1, depth: 0.06 }, s);
    dc.parent = hinge;
    dc.position.set(doorW / 2, (H - 0.1) / 2 + 0.05, 0);
    root.computeWorldMatrix(true);
    hinge.computeWorldMatrix(true);
    const g = worldGeometry([dc]);
    dc.dispose();
    const body = this.host.physics.addStaticMesh(g.pos, g.idx, { tag: "cage_door" });
    this.bodies.push(body);
    const door = new HingedDoor({ hinge, openYaw: 1.75, physics: this.host.physics, body, bus: this.host.world, locked: false });
    this.doors.push(door);
    return {
      name,
      root,
      use: this.front(root, 0.5),
      body,
      real: false,
      door,
      inside: Vector3.TransformCoordinates(new Vector3(0.2, 0.05, 0.3), root.computeWorldMatrix(true)),
      open: (seconds = 1.2) => door.open(seconds),
    };
  }

  private wallTorch(name: string) {
    const a = this.host.keep.anchors[name];
    const flame = this.host.anchor(name).pos;
    const wall = this.host.anchor(name).pos.clone();
    if (a.wall) {
      // the bracket point is in keep-local coordinates like the anchor
      const d = new Vector3(a.wall.local[0] - a.local[0], a.wall.local[1] - a.local[1], a.wall.local[2] - a.local[2]);
      wall.addInPlace(d);
    }
    const s = this.host.world.scene;
    const root = new TransformNode(`torch_${name}`, s);
    root.position.copyFrom(wall);
    this.track(root, this.host.setAt(flame));
    const M = this.mats;
    // the stick from below the bracket out to just under the flame
    const tip = flame.subtract(wall).add(new Vector3(0, -0.14, 0));
    const base = new Vector3(tip.x * 0.15, -0.32, tip.z * 0.15);
    const dir = tip.subtract(base);
    const len = dir.length();
    const stick = this.cyl(`${name}_stick`, 0.035, len, 0, 0, 0, M.wood, { top: 0.05, tess: 7 });
    stick.position.copyFrom(base.add(tip).scale(0.5));
    stick.rotationQuaternion = rotationFromUp(dir.normalize());
    const head = this.cyl(`${name}_head`, 0.065, 0.11, tip.x, tip.y + 0.02, tip.z, M.rope, { tess: 7 });
    const plate = this.box(`${name}_plate`, 0.1, 0.18, 0.02, 0, -0.26, 0, M.iron);
    const n = a.normal ?? [0, 0, 1];
    plate.rotation.y = Math.atan2(n[0], n[2]);
    const ring = this.cyl(`${name}_ring`, 0.08, 0.03, tip.x * 0.55, -0.32 + (tip.y + 0.32) * 0.55, tip.z * 0.55, M.iron, { tess: 8 });
    this.merge(root, `${name}_mesh`, [stick, head, plate, ring], { cast: false });
  }

  private brazier(name: string) {
    const { root, an } = this.rootAt(name);
    const M = this.mats;
    if (this.model(root, an.def.prop)) {
      this.collider(root, 0, 0.4, 0, 0.32, 0.4, 0.32);
      return;
    }
    const parts: Mesh[] = [
      this.cyl(`${name}_bowl`, 0.42, 0.22, 0, 0.6, 0, M.iron, { top: 0.7, tess: 14 }),
      this.cyl(`${name}_coals`, 0.62, 0.05, 0, 0.73, 0, M.coals, { tess: 14 }),
      this.cyl(`${name}_ring`, 0.3, 0.06, 0, 0.06, 0, M.iron, { tess: 12 }),
    ];
    for (let i = 0; i < 3; i++) {
      const a = (i * Math.PI * 2) / 3;
      const leg = this.cyl(`${name}_leg${i}`, 0.04, 0.62, Math.sin(a) * 0.2, 0.3, Math.cos(a) * 0.2, M.iron, { tess: 6 });
      leg.rotation.x = Math.cos(a) * 0.25;
      leg.rotation.z = -Math.sin(a) * 0.25;
      parts.push(leg);
    }
    this.merge(root, `${name}_mesh`, parts);
    this.collider(root, 0, 0.4, 0, 0.32, 0.4, 0.32);
  }

  private table(name: string, o: { small?: boolean; records?: boolean; dice?: boolean }) {
    const { root, an } = this.rootAt(name);
    const M = this.mats;
    const W = o.small ? 1.7 : 1.9, D = o.small ? 0.85 : 0.95, H = 0.78;
    if (this.model(root, an.def.prop)) {
      this.collider(root, 0, H / 2, 0, W / 2, H / 2, D / 2);
      return;
    }
    const parts: Mesh[] = [this.box(`${name}_top`, W, 0.06, D, 0, H - 0.03, 0, M.wood)];
    for (const [x, z] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) parts.push(this.box(`${name}_leg${x}${z}`, 0.08, H - 0.06, 0.08, x * (W / 2 - 0.08), (H - 0.06) / 2, z * (D / 2 - 0.08), M.wood));
    parts.push(this.box(`${name}_stretch`, W - 0.2, 0.05, 0.05, 0, 0.2, 0, M.wood));
    if (o.records) {
      parts.push(this.box(`${name}_book`, 0.28, 0.06, 0.2, -0.4, H + 0.03, 0.05, M.leather), this.box(`${name}_paper1`, 0.22, 0.005, 0.3, 0.1, H + 0.003, -0.1, M.paper), this.box(`${name}_paper2`, 0.21, 0.005, 0.29, 0.15, H + 0.008, -0.05, M.paper));
      const scroll = this.cyl(`${name}_scroll`, 0.05, 0.32, 0.55, H + 0.025, 0.1, M.paper, { tess: 8 });
      scroll.rotation.z = Math.PI / 2;
      parts.push(scroll);
    }
    if (o.dice) parts.push(this.box(`${name}_die1`, 0.025, 0.025, 0.025, 0.1, H + 0.0125, 0.05, M.paper), this.box(`${name}_die2`, 0.025, 0.025, 0.025, 0.16, H + 0.0125, 0.02, M.paper), this.cyl(`${name}_cup`, 0.08, 0.1, -0.2, H + 0.05, 0.0, M.leather, { tess: 10 }), this.cyl(`${name}_candle`, 0.04, 0.12, 0.3, H + 0.06, -0.2, M.paper, { tess: 8 }));
    this.merge(root, `${name}_mesh`, parts);
    this.collider(root, 0, H / 2, 0, W / 2, H / 2, D / 2);
  }

  private bed(name: string) {
    const { root, an } = this.rootAt(name);
    const M = this.mats;
    const W = 0.95, L = 2.0, H = 0.42;
    if (this.model(root, an.def.prop)) {
      this.collider(root, 0, H / 2 + 0.05, 0, W / 2, H / 2 + 0.05, L / 2);
      return;
    }
    // the head is against the wall behind it (+Z local): the frame runs from there toward the front
    const parts = [this.box(`${name}_frame`, W, 0.2, L, 0, 0.25, 0, M.wood), this.box(`${name}_mattress`, W - 0.08, 0.14, L - 0.1, 0, 0.42, 0, M.cloth), this.box(`${name}_head`, W, 0.8, 0.07, 0, 0.4, L / 2 - 0.035, M.wood), this.box(`${name}_foot`, W, 0.5, 0.06, 0, 0.25, -L / 2 + 0.03, M.wood), this.box(`${name}_pillow`, W - 0.3, 0.08, 0.3, 0, 0.52, L / 2 - 0.3, M.cloth)];
    this.merge(root, `${name}_mesh`, parts);
    this.collider(root, 0, H / 2 + 0.05, 0, W / 2, H / 2 + 0.05, L / 2);
  }

  private stool(name: string) {
    const { root, an } = this.rootAt(name);
    const M = this.mats;
    if (this.model(root, an.def.prop)) return;
    const parts: Mesh[] = [this.cyl(`${name}_seat`, 0.36, 0.05, 0, 0.45, 0, M.wood, { tess: 12 })];
    for (let i = 0; i < 3; i++) {
      const a = (i * Math.PI * 2) / 3;
      parts.push(this.cyl(`${name}_leg${i}`, 0.04, 0.44, Math.sin(a) * 0.12, 0.22, Math.cos(a) * 0.12, M.wood, { tess: 6 }));
    }
    this.merge(root, `${name}_mesh`, parts);
  }

  private strapChair(name: string) {
    const { root } = this.rootAt(name);
    const M = this.mats;
    const parts = [this.box(`${name}_seat`, 0.6, 0.08, 0.6, 0, 0.48, 0, M.wood), this.box(`${name}_back`, 0.6, 0.9, 0.08, 0, 0.95, 0.28, M.wood), this.box(`${name}_strap1`, 0.62, 0.05, 0.62, 0, 0.56, 0, M.leather), this.box(`${name}_strap2`, 0.62, 0.05, 0.1, 0, 1.15, 0.25, M.leather)];
    for (const [x, z] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) parts.push(this.box(`${name}_leg${x}${z}`, 0.07, 0.46, 0.07, x * 0.26, 0.23, z * 0.26, M.wood));
    for (const x of [-1, 1]) parts.push(this.box(`${name}_arm${x}`, 0.08, 0.06, 0.55, x * 0.3, 0.75, 0, M.wood), this.box(`${name}_cuff${x}`, 0.1, 0.07, 0.08, x * 0.3, 0.79, -0.15, M.iron));
    this.merge(root, `${name}_mesh`, parts);
    this.collider(root, 0, 0.6, 0, 0.32, 0.6, 0.32);
  }

  private shackles(name: string) {
    const { root } = this.rootAt(name);
    this.toWall(root, 0.1);
    const M = this.mats;
    const s = this.host.world.scene;
    const parts: Mesh[] = [];
    for (const x of [-0.5, 0.5]) {
      parts.push(this.box(`${name}_plate${x}`, 0.12, 0.12, 0.03, x, 1.7, 0.05, M.iron));
      for (let i = 0; i < 5; i++) {
        const l = CreateTorusAt(s, `${name}_link${x}_${i}`, 0.05, 0.012, x * (1 - i * 0.08), 1.62 - i * 0.07, 0.04, M.iron);
        l.rotation.y = i % 2 ? Math.PI / 2 : 0;
        l.rotation.x = Math.PI / 2;
        parts.push(l);
      }
      parts.push(CreateTorusAt(s, `${name}_cuff${x}`, 0.1, 0.02, x * 0.62, 1.25, 0.04, M.iron));
    }
    // chains on the floor and a heap of rags where the corpse lies
    parts.push(this.box(`${name}_rags`, 0.7, 0.12, 0.45, 0, 0.06, -0.25, M.cloth));
    this.merge(root, `${name}_mesh`, parts);
  }

  /** A pipeline model as dressing (barrels, crates): the shipped asset, or a box of its size. */
  private shipped(name: string, prop: string) {
    const { root } = this.rootAt(name);
    const src = shippedSource(prop);
    const crate = /crate/.test(prop);
    const size = crate ? [0.8, 0.8, 0.8] : [1.3, 1.0, 0.9];
    this.collider(root, 0, size[1] / 2, 0, size[0] / 2, size[1] / 2, size[2] / 2);
    if (!src) {
      const M = this.mats;
      this.merge(root, `${name}_mesh`, crate ? [this.box(`${name}_crate`, 0.8, 0.8, 0.8, 0, 0.4, 0, M.planks)] : [this.cyl(`${name}_b1`, 0.6, 0.9, -0.33, 0.45, 0, M.wood), this.cyl(`${name}_b2`, 0.6, 0.9, 0.33, 0.45, 0, M.wood)]);
      return;
    }
    void this.model(root, prop);
  }

  private firePit(at: Vector3) {
    const s = this.host.world.scene;
    const root = new TransformNode("prop_camp_fire_pit", s);
    root.position.copyFrom(at);
    this.track(root, "caveA");
    const M = this.mats;
    const parts: Mesh[] = [];
    for (let i = 0; i < 9; i++) {
      const a = (i * Math.PI * 2) / 9;
      const b = this.box(`pit_stone${i}`, 0.24, 0.16, 0.18, Math.sin(a) * 0.55, 0.07, Math.cos(a) * 0.55, M.stone);
      b.rotation.y = a;
      parts.push(b);
    }
    for (let i = 0; i < 3; i++) {
      const l = this.cyl(`pit_log${i}`, 0.08, 0.7, 0, 0.12, 0, M.wood, { tess: 7 });
      l.rotation.set(Math.PI / 2 - 0.3, (i * Math.PI * 2) / 3, 0);
      parts.push(l);
    }
    parts.push(this.cyl("pit_coals", 0.6, 0.04, 0, 0.03, 0, M.coals, { tess: 12 }));
    this.merge(root, "camp_fire_pit", parts, { cast: false });
  }

  /** A wooden beam across the postern on its inside, in iron brackets. */
  private postBeam() {
    const an = this.host.anchor("blocker_postern");
    const s = this.host.world.scene;
    const root = new TransformNode("postern_beam", s);
    // across the opening (along z), just inside the inner wall face
    root.position.set(an.pos.x + 0.78, an.pos.y - 0.15, an.pos.z);
    const M = this.mats;
    this.merge(root, "postern_beam_mesh", [this.box("beam", 0.22, 0.24, 2.3, 0, 0, 0, M.wood), this.box("beam_br1", 0.26, 0.34, 0.08, -0.02, 0, -1.0, M.iron), this.box("beam_br2", 0.26, 0.34, 0.08, -0.02, 0, 1.0, M.iron)]);
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

  /** A bar across both leaves of the main gate on the hall side. */
  private gateBeam() {
    const an = this.host.anchor("blocker_gate");
    const s = this.host.world.scene;
    const root = new TransformNode("gate_bar", s);
    root.position.set(an.pos.x, an.pos.y - 1.2, an.pos.z - 0.45);
    const M = this.mats;
    this.merge(root, "gate_bar_mesh", [this.box("bar", 4.6, 0.26, 0.24, 0, 0, 0, M.wood), this.box("bar_br1", 0.1, 0.4, 0.3, -2.05, 0, 0.02, M.iron), this.box("bar_br2", 0.1, 0.4, 0.3, 2.05, 0, 0.02, M.iron)]);
    return this.toggle(root, "gf");
  }

  // ---------------------------------------------------------------- shipped models

  /**
   * The anchor's own model when the build ships it, loaded under `root` with its front (+Z, glTF)
   * turned to the root's front (−Z): resolves with its animation groups. Null when the build has
   * none (the caller builds the stand-in).
   */
  private model(root: TransformNode, suggested: string | undefined): Promise<AnimationGroup[]> | null {
    const src = suggested ? shippedSource(suggested) : null;
    if (!src) return null;
    return this.instantiate(src).then((inst) => {
      if (!inst) return [];
      if (this.disposed) {
        inst.root.dispose();
        return [];
      }
      inst.root.parent = root;
      inst.root.rotation.y = Math.PI;
      const ms = inst.root.getChildMeshes(false);
      for (const m of ms) {
        m.isPickable = false;
        m.receiveShadows = true;
      }
      this.host.world.addShadowCasters(ms);
      return inst.groups;
    });
  }

  /** A fresh copy of a model: a whole asset, or one node (and what is under it) of a kit; its animations kept. */
  private async instantiate(source: string): Promise<{ root: TransformNode; groups: AnimationGroup[] } | null> {
    const [id, nodeName] = source.split("#");
    let p = this.containers.get(id);
    if (!p) {
      p = loadGLB(id, this.host.world.scene).catch((e) => {
        console.warn(`keep prop ${id}`, e);
        return null;
      });
      this.containers.set(id, p);
    }
    const c = await p;
    if (!c || this.disposed) return null;
    const root = new TransformNode(`model_${nodeName ?? id}`, this.host.world.scene);
    let keep: Set<Node> | null = null;
    if (nodeName) {
      const target = [...c.transformNodes, ...c.meshes].find((n) => n.name === nodeName);
      if (!target) {
        root.dispose();
        return null;
      }
      keep = new Set<Node>([target, ...target.getDescendants(false)]);
      for (let q = target.parent; q; q = q.parent) keep.add(q);
    }
    const inst = c.instantiateModelsToScene((n) => n, false, { doNotInstantiate: true, predicate: keep ? (e: unknown) => keep.has(e as Node) : undefined });
    for (const r of inst.rootNodes) r.parent = root;
    return { root, groups: inst.animationGroups };
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    for (const d of this.doors) d.dispose();
    for (const id of this.bodies) this.host.physics.removeBody(id);
    for (const n of this.nodes) n.dispose();
    for (const p of this.containers.values()) void p.then((c) => c?.dispose());
    this.chests.clear();
    this.racks.clear();
    this.pickups.clear();
  }
}

/** A node shown while wanted and while its set is shown. */
interface Toggle {
  want(on: boolean): void;
  setEnabled(on: boolean): void;
}

/** A torus at a point (for chain links, rings and key bows). */
function CreateTorusAt(scene: Scene, name: string, diameter: number, thickness: number, x: number, y: number, z: number, mat: Material) {
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

export type { AbstractMesh };
