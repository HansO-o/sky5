import type { AssetContainer } from "@babylonjs/core/assetContainer";
import { Quaternion, Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import type { Material } from "@babylonjs/core/Materials/material";
import type { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import type { Node } from "@babylonjs/core/node";
import { assets } from "../../core/assets/AssetClient";
import { audio } from "../../core/audio";
import { loadGLB, loadJSON, nextFrame } from "../../game/loaders";
import { floorAt } from "../../engine/physics/ground";
import { worldGeometry } from "../../engine/physics/meshGeometry";
import type { BodyId, Physics } from "../../engine/physics/Physics";
import { precompile } from "../../engine/render/precompile";
import { HingedDoor } from "../../engine/world/HingedDoor";
import { Zones, type ZoneDef } from "../../engine/world/zones";
import type { LightingProfile } from "../../world/environment";
import type { FireFx, FireHandle } from "../fx/fire";
import type { World } from "../World";
import { inBox, keepWorld, type CaveAnchors, type KeepAnchor, type KeepAnchors, type KeepDoorTag, type V3 } from "./anchors";
import { bindCaveMaterials } from "./caveMaterials";
import { KeepProps } from "./props";

/**
 * What the underground shows and hides together (design §3.2 visibility sets): the keep's ground
 * floor, its stairwell, its basement, and the cave gallery (zone A), each with its lights and props.
 */
export type UndergroundSet = "gf" | "stair" | "bs" | "caveA" | "caveB" | "caveC" | "caveD" | "caveE";
export type UndergroundLevel = "gf" | "bs" | "cave";

/** Where the ground floor ends and the basement begins on the stairs (keep-local y; world ≈ 36.73). */
const SPLIT_LOCAL_Y = -1.0;
/** keep-local frame origin when there is no town to read it from (design §4) */
const DEFAULT_ORIGIN = { x: 60, y: 37.73, z: -662 };
/** Rooms on the ground floor (the rest of the keep's rooms are the basement's). */
const GF_ROOMS = new Set(["G1", "G2", "G2n", "G3", "G4", "G5t", "g2_door", "g3_door", "store_door", "stair_door"]);
/** Ambience beds per level (only those the build ships play; gain 0.35: the beds are loudness-normalised). */
const BEDS: Record<UndergroundLevel, string[]> = {
  gf: ["audio/amb_torch"],
  bs: ["audio/amb_dungeon", "audio/amb_drips"],
  cave: ["audio/amb_cave", "audio/amb_stream"],
};
/** The interior doors (the postern lives with the town: `stage.postern`). */
const INTERIOR_DOORS: readonly Exclude<KeepDoorTag, "postern">[] = ["g2_door", "store_door", "stair_door", "torture_door", "cell_gate"];

/** A light anchor made real: its flame (sprite or fire) and the set that shows it. */
interface LightEntry {
  name: string;
  set: UndergroundSet;
  handle: FireHandle;
}

/** Something a set shows and hides: a node, or anything with an on/off switch. */
type Showable = Node | { setEnabled(on: boolean): void };

export interface UndergroundHost {
  world: World;
  physics: Physics;
  /** the stage's fire effects (sconce sprites, braziers); null: none (no flames, no pool lights) */
  fx: FireFx | null;
  /** the keep building's holder (the interior shares its frame); null: the design's origin */
  keepHolder: TransformNode | null;
  /** the zones' probe (the player's feet; the camera before there is a player) */
  probe(): { x: number; y: number; z: number } | null;
  /** an exterior door (main gate, postern) stands open: the outdoor world stays visible through it */
  exteriorOpen(): boolean;
  /** subscribe to exterior door changes */
  onExterior(fn: () => void): () => unknown;
}

/**
 * The keep's interior and the cave gallery (design §4.2, §4.3, Appendix "Pipeline outputs"), built
 * once by `stage.ensureUnderground()` and kept until the stage goes (both keep and exit play in it):
 *
 * - `keep/interior` in the keep's frame, its `*_col` colliders as static bodies (tags `keep_gf`,
 *   `keep_stair`, `keep_bs`), the five interior doors as hinged leaves with their own bodies
 *   (tags from §3.1; `cell_gate` open, `store_door` locked), the drain plug (`blocker_drain`) and the
 *   anchors' blockers (`blocker_gate`, `blocker_postern`, off until switched on);
 * - `cave/mesh_a` (the gallery) when the build ships it, its collider (`cave_A`), textures and water;
 * - zones per room (G1–G5, B1–B5, the cells, the gallery) with their lighting profile (hall,
 *   basement, cave), visibility sets, ambience beds; the outdoor world is hidden inside (on the
 *   ground floor the keep building and its gate stay), unless an exterior door stands open;
 * - every light anchor as a flame (sconce sprites, brazier and fire effects) asking the light pool
 *   for a slot, the props (`props`), all parked hidden until a zone shows their set.
 */
export class Underground {
  readonly keep: KeepAnchors;
  readonly cave: CaveAnchors | null;
  /** the keep frame's world origin (local → world: origin + local) */
  readonly origin: Vector3;
  /** the interior doors by tag */
  readonly doors: Record<Exclude<KeepDoorTag, "postern">, HingedDoor>;
  readonly props: KeepProps;
  readonly zones: Zones;
  /** the interior's materials (props reuse them: wood, iron, planks) */
  readonly materials: Map<string, Material>;
  private sets = new Map<UndergroundSet, Set<Showable>>();
  private lights: LightEntry[] = [];
  private zoneShown = new Set<string>();
  private shown = new Set<UndergroundSet>();
  private blockers = new Map<string, BodyId>();
  private plug: { meshes: AbstractMesh[]; body: BodyId | null } | null;
  private offs: (() => unknown)[] = [];
  private water: { update(dt: number): void } | null = null;
  private rest: { container: AssetContainer; bodies: Record<string, BodyId | null> } | null = null;
  private disposed = false;

  /** Build everything from the loaded assets (see {@link loadUnderground}). */
  constructor(
    private host: UndergroundHost,
    a: { keep: KeepAnchors; interior: AssetContainer; cave: CaveAnchors | null; caveA: AssetContainer | null; water?: { update(dt: number): void } | null },
  ) {
    const w = host.world, ph = host.physics;
    this.keep = a.keep;
    this.cave = a.cave;
    const holder = host.keepHolder;
    holder?.computeWorldMatrix(true);
    const o = holder ? holder.getAbsolutePosition() : DEFAULT_ORIGIN;
    this.origin = new Vector3(o.x, o.y, o.z);
    for (const s of ["gf", "stair", "bs", "caveA", "caveB", "caveC", "caveD", "caveE"] as const) this.sets.set(s, new Set());

    // ---- the interior, in the keep's frame (not parented under the town: hiding the outdoor world must not hide it)
    const c = a.interior;
    c.addAllToScene();
    const root = c.meshes.find((m) => !m.parent) ?? c.meshes[0];
    root.position.copyFrom(this.origin);
    root.rotationQuaternion = holder?.absoluteRotationQuaternion?.clone() ?? Quaternion.Identity();
    this.materials = new Map(c.materials.map((m) => [m.name, m]));
    const node = (name: string) => [...c.transformNodes, ...c.meshes].find((n) => n.name === name) ?? null;
    const meshesOf = (name: string) => {
      const n = node(name);
      if (!n) return [];
      const list = [n, ...n.getDescendants(false)].filter((m): m is AbstractMesh => "getTotalVertices" in m && (m as AbstractMesh).getTotalVertices() > 0);
      return list;
    };
    for (const m of c.meshes) {
      m.isPickable = false;
      m.hasVertexAlpha = false;
      m.receiveShadows = true;
    }
    // render nodes: parked hidden, each in its set
    for (const [name, set] of [["keep_gf", "gf"], ["keep_stair", "stair"], ["keep_bs", "bs"]] as const) {
      const n = node(name);
      if (!n) {
        console.warn(`keep/interior: no ${name}`);
        continue;
      }
      this.addToSet(set, n);
    }
    // colliders: permanent static bodies; their meshes never draw
    for (const name of ["keep_gf_col", "keep_stair_col", "keep_bs_col"]) {
      const ms = meshesOf(name);
      const g = worldGeometry(ms);
      if (g.idx.length) ph.addStaticMesh(g.pos, g.idx, { tag: name.replace(/_col$/, "") });
      else console.warn(`keep/interior: no collider ${name}`);
      node(name)?.setEnabled(false);
    }
    // the interior doors: hinge + leaf + box collider (their own body, moving with the leaf)
    const doors = {} as Record<Exclude<KeepDoorTag, "postern">, HingedDoor>;
    for (const tag of INTERIOR_DOORS) {
      const def = a.keep.doors[tag];
      const hinge = def ? (node(def.node) as TransformNode | null) : null;
      if (!def || !hinge) {
        console.warn(`keep/interior: no door ${tag}`);
        continue;
      }
      const col = def.collider ? meshesOf(def.collider) : [];
      const g = worldGeometry(col);
      const body = g.idx.length ? ph.addStaticMesh(g.pos, g.idx, { tag }) : null;
      for (const m of col) m.setEnabled(false);
      doors[tag] = new HingedDoor({ hinge, openYaw: def.openYaw, physics: ph, body, bus: w, t: def.initial === "open" ? 1 : 0, locked: def.initial === "locked" });
      this.addToSet(this.levelAt(this.keepPoint(def.hinge.local).addInPlaceFromFloats(0, 0.5, 0)) === "gf" ? "gf" : "bs", hinge);
    }
    this.doors = doors;
    // the drain plug: a black card and a box at the far end of the drain mouth, until the cave shows (K9)
    const plugMeshes = meshesOf("drain_plug_mesh");
    const plugCol = meshesOf("drain_plug_col");
    const pg = worldGeometry(plugCol);
    for (const m of plugCol) m.setEnabled(false);
    this.plug = { meshes: plugMeshes, body: pg.idx.length ? ph.addStaticMesh(pg.pos, pg.idx, { tag: "blocker_drain" }) : null };
    for (const m of plugMeshes) this.addToSet("bs", m);
    // the anchors' blockers (the gate once both are inside, the K1 beam): off until a chapter needs them
    for (const [name, an] of Object.entries(a.keep.anchors)) {
      if (an.kind !== "blocker" || !an.half || !an.tag || an.tag === "blocker_drain") continue;
      const p = this.keepPoint(an.local);
      const id = ph.addBox(p, new Vector3(an.half[0], an.half[1], an.half[2]), undefined, { tag: an.tag });
      ph.setBodyEnabled(id, false);
      this.blockers.set(an.tag, id);
      void name;
    }
    // the static render meshes never move again
    for (const set of ["gf", "stair", "bs"] as const)
      for (const n of this.sets.get(set)!)
        if ("getChildMeshes" in n && !(n as TransformNode).name.startsWith("door_"))
          for (const m of [n as AbstractMesh, ...(n as TransformNode).getChildMeshes(false)]) {
            if (!("freezeWorldMatrix" in m)) continue;
            m.computeWorldMatrix(true);
            m.freezeWorldMatrix();
          }

    // ---- the cave gallery (world coordinates: added at the origin, never parented)
    if (a.caveA) {
      const cc = a.caveA;
      cc.addAllToScene();
      const cnode = (name: string) => [...cc.transformNodes, ...cc.meshes].find((n) => n.name === name) ?? null;
      for (const m of cc.meshes) {
        m.isPickable = false;
        m.hasVertexAlpha = false;
        m.receiveShadows = false;
      }
      for (const name of ["cave_A", "cave_water"]) {
        const n = cnode(name);
        if (n) this.addToSet("caveA", n);
      }
      const colNode = cnode("cave_A_col");
      if (colNode) {
        const ms = [colNode, ...colNode.getDescendants(false)].filter((m): m is AbstractMesh => "getTotalVertices" in m && (m as AbstractMesh).getTotalVertices() > 0);
        const g = worldGeometry(ms);
        if (g.idx.length) ph.addStaticMesh(g.pos, g.idx, { tag: "cave_A" });
        colNode.setEnabled(false);
      }
      for (const m of cc.meshes) {
        if (m.name.startsWith("cave_water")) continue;
        m.computeWorldMatrix(true);
        m.freezeWorldMatrix();
      }
    }

    // ---- flames and pool lights (sconce sprites, braziers, the G2 fire, the J candle, the camp fire)
    const fx = host.fx;
    if (fx) {
      for (const [name, an] of Object.entries(a.keep.anchors)) {
        if (an.kind !== "light") continue;
        const p = this.keepPoint(an.local);
        const set = this.setAt(p);
        const hint = an.lightHint;
        const light = hint ? { intensity: hint.intensity * 0.5, range: hint.range, color: hint.color, reach: 20 } : true;
        let handle: FireHandle;
        if (an.light === "brazier") handle = fx.fire(p.add(new Vector3(0, -0.12, 0)), 0.32, { smoke: false, light: { ...(light === true ? {} : light), height: 0.8 } });
        else if (an.light === "fire") handle = fx.fire(p.add(new Vector3(0, -0.6, 0)), 0.5, { smoke: true, light: { ...(light === true ? {} : light), height: 0.6 } });
        else if (an.light === "candle") handle = fx.sconce(p.add(new Vector3(0, -0.06, 0)), { size: 0.12, light: { ...(light === true ? {} : light), height: 0.08 } });
        else handle = fx.sconce(p.add(new Vector3(0, -0.12, 0)), { size: 0.4, light: { ...(light === true ? {} : light), height: 0.12 } });
        handle.pause();
        this.lights.push({ name, set, handle });
      }
      const camp = a.cave?.lights.light_camp_fire;
      if (camp && a.caveA) {
        const ground = a.cave?.anchors.camp_fire?.pos ?? camp.pos;
        const h = fx.fire(new Vector3(ground[0], ground[1] + 0.12, ground[2]), 0.5, { smoke: true, light: { intensity: camp.hint.intensity * 0.6, range: camp.hint.range, color: camp.hint.color, height: 0.6, reach: 24 } });
        h.pause();
        this.lights.push({ name: "light_camp_fire", set: "caveA", handle: h });
      }
    }

    // ---- props (chests, racks, shelves, the cage, torches, the dressing), each in its level's set
    this.props = new KeepProps(this);

    // ---- zones (4 Hz on the player's feet)
    this.zones = new Zones(
      {
        probe: () => host.probe(),
        profile: (name, seconds) => {
          // the climb out blends to daylight by the distance to the last bend (design §3.2)
          const bend = name === "climb-out" ? this.cave?.anchors.bend?.pos : null;
          w.env.setInterior(name as LightingProfile, seconds, bend ? { anchor: { x: bend[0], y: bend[1], z: bend[2] }, from: "cave" } : undefined);
        },
        show: (set, on) => {
          if (on) this.zoneShown.add(set);
          else this.zoneShown.delete(set);
        },
        startBed: (id, gain) => void audio.startBed(id, id, gain ?? 0.35, 2).catch((e) => console.warn("bed", id, e)),
        stopBed: (id) => audio.stopBed(id, 2),
        entered: () => this.apply(),
      },
      this.zoneDefs(),
      { outside: { profile: "outdoor", show: [] }, bus: w },
    );
    this.offs.push(host.onExterior(() => this.apply()));
    this.water = a.water ?? null;
    this.offs.push(w.onUpdate((dt) => this.water?.update(dt)));
    // everything starts hidden; the first zone check shows what the player's place needs
    for (const s of this.sets.keys()) this.setShown(s, false, true);
    this.zones.check();
  }

  get world() {
    return this.host.world;
  }

  get physics() {
    return this.host.physics;
  }

  // ---------------------------------------------------------------- places

  /** Keep-local → world (a new vector). */
  keepPoint(local: V3) {
    const p = keepWorld(this.origin, local);
    return new Vector3(p[0], p[1], p[2]);
  }

  /** A keep anchor: its world position (from the runtime origin), facing and definition. */
  anchor(name: string): { pos: Vector3; yaw: number; def: KeepAnchor } {
    const def = this.keep.anchors[name];
    if (!def) throw new Error(`no keep anchor ${name}`);
    return { pos: this.keepPoint(def.local), yaw: def.yaw ?? 0, def };
  }

  /** A cave anchor (world; y = the collider floor). */
  caveAnchor(name: string): { pos: Vector3; yaw: number } {
    const a = this.cave?.anchors[name];
    if (!a) throw new Error(`no cave anchor ${name}`);
    return { pos: new Vector3(a.pos[0], a.pos[1], a.pos[2]), yaw: a.yaw ?? 0 };
  }

  /** The static floor under (x, z) near `yHint` (null: none within 4 m below). */
  floor(x: number, z: number, yHint: number) {
    return floorAt(this.host.physics, x, z, yHint);
  }

  /** The keep room (anchors' air box) `p` is in, or null. */
  roomAt(p: { x: number; y: number; z: number }) {
    for (const [name, r] of Object.entries(this.keep.rooms)) {
      if (r.kind === "hidden") continue;
      const min = keepWorld(this.origin, r.min), max = keepWorld(this.origin, r.max);
      if (inBox({ min: [min[0], min[1] - 0.6, min[2]], max }, p)) return name;
    }
    return null;
  }

  /** The level `p` is on: ground floor, basement, the cave, or null (outside). */
  levelAt(p: { x: number; y: number; z: number }): UndergroundLevel | null {
    const room = this.roomAt(p);
    if (room) {
      if (room === "G5") return p.y - this.origin.y >= SPLIT_LOCAL_Y ? "gf" : "bs";
      return GF_ROOMS.has(room) ? "gf" : "bs";
    }
    const z = this.cave?.zones.A;
    if (z && z.boxes.some((b) => inBox(b, p, 0.3))) return "cave";
    return null;
  }

  /** The set a thing at `p` belongs to (the stairwell's lights and props: "stair"). */
  setAt(p: { x: number; y: number; z: number }): UndergroundSet {
    const room = this.roomAt(p);
    if (room === "G5" || room === "G5t") return "stair";
    const l = this.levelAt(p);
    return l === "gf" ? "gf" : l === "cave" ? "caveA" : "bs";
  }

  /** The zone the player is in (a room name, "A" for the gallery; null outside). */
  get zone() {
    return this.zones.current?.id ?? null;
  }

  /** The level of the current zone. */
  get level(): UndergroundLevel | null {
    const z = this.zones.current;
    return z ? ((z as ZoneDef & { level?: UndergroundLevel }).level ?? null) : null;
  }

  // ---------------------------------------------------------------- world state

  /** Switch an anchors' blocker on or off (`blocker_gate`, `blocker_postern`). */
  setBlocker(tag: string, on: boolean) {
    const id = this.blockers.get(tag);
    if (id) this.host.physics.setBodyEnabled(id, on);
  }

  blockerOn(tag: string) {
    const id = this.blockers.get(tag);
    return !!id && this.host.physics.bodyEnabled(id);
  }

  /** The drain is open (K9: the cave shows through it): the plug's card and box go for good. */
  openDrain() {
    const p = this.plug;
    if (!p) return;
    this.plug = null;
    for (const m of p.meshes) {
      this.sets.get("bs")?.delete(m);
      m.setEnabled(false);
    }
    if (p.body) this.host.physics.removeBody(p.body);
  }

  get drainOpen() {
    return !this.plug;
  }

  /** Show and hide `item` with a set (props, chapter dressing). */
  addToSet(set: UndergroundSet, item: Showable) {
    this.sets.get(set)!.add(item);
    if (this.zones) this.showItem(item, this.shown.has(set));
    return () => this.sets.get(set)?.delete(item);
  }

  /** Check the zones now (after a teleport: the profile and sets follow at once). */
  check() {
    this.zones.check();
  }

  // ---------------------------------------------------------------- zones and visibility

  /** One zone per keep room (G5 split where the floors meet) and the gallery (design §3.2). */
  private zoneDefs(): ZoneDef[] {
    const defs: (ZoneDef & { level: UndergroundLevel })[] = [];
    const beds = (l: UndergroundLevel) => BEDS[l].filter((id) => assets.has(id));
    const splitY = this.origin.y + SPLIT_LOCAL_Y;
    const gf = { profile: "hall", show: ["gf", "stair"], beds: beds("gf"), level: "gf" as const };
    const bs = { profile: "basement", show: ["stair", "bs"], beds: beds("bs"), level: "bs" as const };
    for (const [name, r] of Object.entries(this.keep.rooms)) {
      if (r.kind === "hidden") continue;
      const min = keepWorld(this.origin, r.min), max = keepWorld(this.origin, r.max);
      // the probe is the feet: reach a little below the floor
      const lo: [number, number, number] = [min[0], min[1] - 0.6, min[2]];
      if (name === "G5") {
        // the stairwell: the ground floor's above the split, the basement's below it; both see everything
        defs.push({ id: "G5", boxes: [{ min: [lo[0], splitY, lo[2]], max }], ...gf, show: ["gf", "stair", "bs"], priority: 1 });
        defs.push({ id: "G5b", boxes: [{ min: lo, max: [max[0], splitY, max[2]] }], ...bs, show: ["gf", "stair", "bs"], priority: 1 });
        continue;
      }
      const level = GF_ROOMS.has(name) ? gf : bs;
      const near = name === "B5" || name === "drain" ? ["A"] : undefined;
      defs.push({ id: name, boxes: [{ min: lo, max }], ...level, neighbours: near, priority: 1 });
    }
    const A = this.cave?.zones.A;
    if (A)
      defs.push({ id: "A", boxes: A.boxes, profile: "cave", show: ["caveA"], neighbours: ["B5", ...A.neighbours], beds: beds("cave"), level: "cave", priority: 0 });
    return defs;
  }

  /** Apply the zone's sets, plus what an open exterior door shows; hide the outdoor world inside. */
  private apply() {
    if (this.disposed) return;
    const lvl = this.level;
    const ext = this.host.exteriorOpen();
    const want = new Set(this.zoneShown) as Set<string>;
    // the hall seen through an open gate or postern from outside
    if (!lvl && ext) want.add("gf");
    for (const s of this.sets.keys()) this.setShown(s, want.has(s));
    // (from the climb's last stretch on, the daylight at the mouth: the outcrop and the valley)
    const outdoor = !lvl || (lvl === "gf" && ext) || this.zone === "E";
    this.host.world.setOutdoorVisible(outdoor, { keep: lvl === "gf" });
  }

  private setShown(set: UndergroundSet, on: boolean, force = false) {
    if (!force && this.shown.has(set) === on) return;
    if (on) this.shown.add(set);
    else this.shown.delete(set);
    for (const item of this.sets.get(set) ?? []) this.showItem(item, on);
    for (const l of this.lights) {
      if (l.set !== set) continue;
      if (on) l.handle.resume();
      else l.handle.pause();
    }
  }

  private showItem(item: Showable, on: boolean) {
    if ("isDisposed" in item && (item as Node).isDisposed()) return;
    item.setEnabled(on);
  }

  /** Every render mesh of the underground (to compile before anything shows). */
  meshes(): AbstractMesh[] {
    const out: AbstractMesh[] = [];
    for (const set of this.sets.values())
      for (const n of set) {
        if (!("getChildMeshes" in n)) continue;
        const t = n as TransformNode;
        if ("getTotalVertices" in t && (t as unknown as AbstractMesh).getTotalVertices() > 0) out.push(t as unknown as AbstractMesh);
        out.push(...t.getChildMeshes(false).filter((m) => m.getTotalVertices() > 0));
      }
    return out;
  }

  /** The rest of the cave is in (zones B–E, `cave/mesh`). */
  get caveRest() {
    return this.rest;
  }

  /**
   * Add the rest of the cave (`cave/mesh`: zones B–E behind the outcrop's mouth plug, the web
   * walls, the cocoons): its render nodes in their zones' sets, its colliders as static bodies
   * (`cave_B` … `cave_E`; the web walls `web_A` / `web_B` and the courier's cocoon `cocoon` on
   * their own, for the exit chapter to remove), and zones B–E (cave profile; E the climb out).
   */
  addCave(c: AssetContainer) {
    if (this.disposed || this.rest || !this.cave) {
      c.dispose();
      return;
    }
    const ph = this.host.physics;
    const all = [...c.transformNodes, ...c.meshes];
    const node = (name: string) => all.find((n) => n.name === name) ?? null;
    const meshesOf = (name: string) => {
      const n = node(name);
      return n ? ([n, ...n.getDescendants(false)].filter((m) => "getTotalVertices" in m && (m as AbstractMesh).getTotalVertices() > 0) as AbstractMesh[]) : [];
    };
    for (const m of c.meshes) {
      m.isPickable = false;
      m.hasVertexAlpha = false;
      m.receiveShadows = false;
    }
    for (const mat of c.materials)
      if (mat.name === "cave_web") {
        mat.disableDepthWrite = true;
        mat.backFaceCulling = false;
      }
    const bodies: Record<string, BodyId | null> = {};
    for (const [name, tag] of [["cave_B_col", "cave_B"], ["cave_C_col", "cave_C"], ["cave_D_col", "cave_D"], ["cave_E_col", "cave_E"], ["web_A_col", "web_A"], ["web_B_col", "web_B"], ["cocoon_courier_col", "cocoon"]] as const) {
      const ms = meshesOf(name);
      const g = worldGeometry(ms);
      bodies[tag] = g.idx.length ? ph.addStaticMesh(g.pos, g.idx, { tag }) : null;
      for (const m of ms) m.setEnabled(false);
    }
    const put = (set: UndergroundSet, name: string) => {
      const n = node(name);
      if (n) this.addToSet(set, n);
    };
    for (const z of ["B", "C", "D", "E"] as const) put(`cave${z}`, `cave_${z}`);
    for (const n of ["web_A_cards", "web_B_cards", "cave_webs", "cocoon_courier_mesh", "cave_cocoons", "cave_eggs"]) put("caveB", n);
    put("caveC", "den_fissure");
    for (const m of c.meshes) {
      m.computeWorldMatrix(true);
      m.freezeWorldMatrix();
    }
    // (parked while it compiled: its parts are in their sets now, hidden until a zone shows them)
    for (const m of c.meshes) if (!m.parent) m.setEnabled(true);
    this.rest = { container: c, bodies };
    const beds = BEDS.cave.filter((id) => assets.has(id));
    for (const id of ["B", "C", "D", "E"] as const) {
      const z = this.cave.zones[id];
      if (!z) continue;
      this.zones.define({ id, boxes: z.boxes, profile: z.profile, show: [`cave${id}`], neighbours: z.neighbours, beds, priority: 0, level: "cave" } as ZoneDef);
    }
    this.zones.reset();
    this.zones.check();
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    for (const o of this.offs) o();
    this.offs = [];
    this.zones.dispose();
    for (const d of Object.values(this.doors)) d.dispose();
    for (const l of this.lights) l.handle.stop();
    this.lights = [];
    this.props.dispose();
  }
}

/**
 * Load and build the underground (see {@link Underground}): `keep/interior` + `keep/anchors`, and
 * `cave/mesh_a` + `cave/anchors` when the build ships them. Its shaders compile while it is still
 * hidden. Throws when the keep interior is missing (the build lacks the keep).
 */
export async function loadUnderground(host: UndergroundHost): Promise<Underground> {
  const w = host.world;
  const opt = <T>(id: string, p: () => Promise<T>) =>
    assets.has(id)
      ? p().catch((e) => {
          console.warn(`underground: ${id} failed`, e);
          return null;
        })
      : Promise.resolve(null);
  const [interior, keep, caveA, cave] = await Promise.all([
    loadGLB("keep/interior", w.scene),
    loadJSON<KeepAnchors>("keep/anchors"),
    opt("cave/mesh_a", () => loadGLB("cave/mesh_a", w.scene)),
    opt("cave/anchors", () => loadJSON<CaveAnchors>("cave/anchors")),
  ]);
  if (w.disposed) {
    interior.dispose();
    caveA?.dispose();
    throw new Error("underground: the world is gone");
  }
  await nextFrame();
  // the gallery's textures bound before anything compiles (the cave and the outcrop share them)
  const water = caveA && cave ? await bindCaveMaterials(w.scene, caveA.materials, cave.materials) : null;
  if (w.disposed) {
    interior.dispose();
    caveA?.dispose();
    throw new Error("underground: the world is gone");
  }
  const u = new Underground(host, { keep, interior, cave, caveA: cave ? caveA : null, water });
  // compiled hidden, as each mesh will draw (with the sun's shadow pass for those that receive it)
  await precompile(u.meshes(), { shadows: w.env.shadows, timeout: 20 });
  // the rest of the cave (the exit's segment) follows in the background: the gallery's far end
  // opens into it, and nothing waits for it
  if (cave && assets.has("cave/mesh"))
    void loadGLB("cave/mesh", w.scene)
      .then(async (c) => {
        await bindCaveMaterials(w.scene, c.materials, cave.materials);
        if (w.disposed) return c.dispose();
        // in the scene but parked (its root off) while its shaders compile
        c.addAllToScene();
        for (const m of c.meshes) if (!m.parent) m.setEnabled(false);
        await precompile(c.meshes.filter((m) => m.getTotalVertices() > 0 && !/_col$/.test(m.name)), { timeout: 20 });
        u.addCave(c);
      })
      .catch((e) => console.warn("underground: cave/mesh", e));
  return u;
}
