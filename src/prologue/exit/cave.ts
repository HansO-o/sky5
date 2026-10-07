import type { AssetContainer } from "@babylonjs/core/assetContainer";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import { CreateBox } from "@babylonjs/core/Meshes/Builders/boxBuilder";
import { CreateCylinder } from "@babylonjs/core/Meshes/Builders/cylinderBuilder";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import type { Node } from "@babylonjs/core/node";
import { assets } from "../../core/assets/AssetClient";
import { audio } from "../../core/audio";
import { loadGLB, nextFrame } from "../../game/loaders";
import { hud } from "../../ui/hud";
import type { BodyId } from "../../engine/physics/Physics";
import { applyLightBudget } from "../../engine/render/lightBudget";
import { precompile } from "../../engine/render/precompile";
import type { Interactable, Interactables } from "../../engine/world/Interactables";
import type { LightClaim } from "../../engine/world/LightPool";
import type { ZoneDef } from "../../engine/world/zones";
import { KEEP_PROMPTS } from "../chapters/keepScript";
import { Cancelled } from "../Director";
import { bindCaveMaterials } from "../keep/caveMaterials";
import type { V3 } from "../keep/anchors";
import { placeNode, spawn } from "../keep/propAssets";
import type { Underground, UndergroundSet } from "../keep/underground";
import type { PrologueStage } from "../PrologueStage";
import { bankOf, beyond, inZoneBox, pathProgress, pathTangent, respawnTarget, respawnVolumes, splitBoxes, type ExitAnchors, type RespawnVolume, type ZoneBox } from "./layout";
import { EXIT_IDS, EXIT_MARKS } from "./rules";
import { CaveCocoon, CaveWeb } from "./webs";

/**
 * The exit's zones (design §3.2, Appendix "Zones"): the pipeline's B and C, its D split along the
 * climb where the wind bed starts (`climb_mid`: Dw) and where the outdoor world shows and the
 * daylight blend begins (`cp_light`: Dl), and its E split into the last bend (Eb) and the outcrop's
 * deck (E, the outdoor profile: the climb-out blend reads the distance to `bend`, which the deck is
 * 11 m past).
 */
export const EXIT_ZONES = { B: "B", C: "C", D: "D", wind: "Dw", light: "Dl", bend: "Eb", outcrop: "E" } as const;
/** Zones that see the outdoor world (§6.1 X3: from `cp_light` on). */
const OUTDOOR_ZONES: ReadonlySet<string> = new Set([EXIT_ZONES.light, EXIT_ZONES.bend, EXIT_ZONES.outcrop]);

/** Ambience beds (§10.5: X0–X2 cave and drips, X3 the cave wind from `climb_mid`, X4 the wind outside). */
const BED = { cave: "audio/amb_cave", drips: "audio/amb_drips", wind: "audio/amb_cave_wind", outside: "audio/wind" } as const;
/** Gains where the design sets one (drips 0.3; the town's wind as at the keep gate); the rest the underground's 0.35. */
const BED_GAIN: Partial<Record<string, number>> = { [BED.drips]: 0.3, [BED.outside]: 0.25 };

/** The den's bones (`procprops/exit`): node, anchor, facing (props/meta `placements.bones`). */
const BONES = [
  { node: "bones_a", anchor: "bones_1", yaw: 0.4 },
  { node: "bones_b", anchor: "bones_2", yaw: 2.1 },
  { node: "bones_c", anchor: "bones_3", yaw: -1.2 },
] as const;
/** Stepping this close to a pile's origin is a noise (+0.35 on the wolf's meter, §4.3); re-armed beyond `rearm`. */
const BONE_STEP = { radius: 0.6, rearm: 1.0 };

/** The rest of the cave as the underground built it (`cave/mesh`: its container and the bodies by tag). */
type Rest = NonNullable<Underground["caveRest"]>;

const caves = new WeakMap<PrologueStage, Promise<CaveWorld>>();
const built = new WeakMap<PrologueStage, CaveWorld>();

/**
 * The exit chapter's cave, made once per stage (later calls return the same promise; a failure
 * lets a later call try again). Waits for `stage.ensureUnderground()` (the keep's interior and the
 * gallery), then for the rest of the cave (`cave/mesh`, zones B–E behind the outcrop's mouth plug,
 * which the underground loads in the background; loaded here if that never lands), then adds what
 * the exit needs on top: its zones and beds, its pool lights, the den's bones and the satchel, the
 * cuttable web walls and the courier's cocoon, the respawn volumes, the outdoor world from
 * `cp_light` on, and the mouth plug gone. Everything is parked hidden until its zone shows it.
 * Rejects when the build lacks the underground or `cave/anchors`.
 */
export function ensureCave(stage: PrologueStage): Promise<CaveWorld> {
  let p = caves.get(stage);
  if (!p) {
    p = makeCave(stage);
    caves.set(stage, p);
    p.catch(() => {
      if (caves.get(stage) === p) caves.delete(stage);
    });
  }
  return p;
}

/** The cave once `ensureCave` has made it (null before, or without one). */
export function caveOf(stage: PrologueStage): CaveWorld | null {
  return built.get(stage) ?? null;
}

async function makeCave(stage: PrologueStage): Promise<CaveWorld> {
  const u = await stage.ensureUnderground();
  const w = stage.world;
  if (!u.cave) throw new Error("exit: this build has no cave/anchors");
  const rest = await caveRest(stage, u);
  const bones = assets.has("procprops/exit") ? await loadGLB("procprops/exit", w.scene).catch((e) => (console.warn("exit: procprops/exit", e), null)) : null;
  if (w.disposed) {
    bones?.dispose();
    throw new Cancelled();
  }
  const cave = new CaveWorld(stage, u, u.cave as ExitAnchors, rest, bones);
  if (cave.meshes.length) await precompile(cave.meshes, { timeout: 10 });
  if (w.disposed) {
    cave.dispose();
    throw new Cancelled();
  }
  built.set(stage, cave);
  w.scene.onDisposeObservable.addOnce(() => cave.dispose());
  return cave;
}

/**
 * Zones B–E (`cave/mesh`) in the underground: the load `ensureUnderground` started in the background
 * (waited for up to 45 s), else loaded here. Null when the build doesn't ship it.
 */
async function caveRest(stage: PrologueStage, u: Underground): Promise<Rest | null> {
  if (u.caveRest) return u.caveRest;
  if (!assets.has("cave/mesh")) {
    console.warn("exit: this build has no cave/mesh (zones B–E)");
    return null;
  }
  const w = stage.world;
  const t0 = performance.now();
  while (!u.caveRest && performance.now() - t0 < 45000) {
    await nextFrame();
    if (w.disposed) throw new Cancelled();
  }
  if (u.caveRest) return u.caveRest;
  // (the background load failed or hangs: load it here; a late one is dropped by addCave)
  console.warn("exit: cave/mesh did not arrive with the underground; loading it");
  const c = await loadGLB("cave/mesh", w.scene);
  await bindCaveMaterials(w.scene, c.materials, u.cave?.materials ?? null);
  if (w.disposed) {
    c.dispose();
    throw new Cancelled();
  }
  c.addAllToScene();
  for (const m of c.meshes) if (!m.parent) m.setEnabled(false);
  await precompile(c.meshes.filter((m) => m.getTotalVertices() > 0 && !/_col$/.test(m.name)), { timeout: 20 });
  u.addCave(c);
  return u.caveRest;
}

/** The hunter's satchel by the wolf (anchor `satchel`, §6.1 X2; optional): a leather bag, taken once. */
export class Satchel {
  readonly root: TransformNode;
  private isTaken = false;

  constructor(
    private cave: CaveWorld,
    at: Vector3,
    yaw: number,
  ) {
    const s = cave.stage.world.scene;
    this.root = new TransformNode("exit_satchel", s);
    const leather = new PBRMaterial("exit_satchel_leather", s);
    leather.albedoColor = new Color3(0.3, 0.18, 0.09);
    leather.roughness = 0.8;
    leather.metallic = 0;
    applyLightBudget([leather]);
    const bag = CreateBox("exit_satchel_bag", { width: 0.42, height: 0.3, depth: 0.2 }, s);
    bag.position.y = 0.15;
    const flap = CreateBox("exit_satchel_flap", { width: 0.43, height: 0.03, depth: 0.22 }, s);
    flap.position.set(0, 0.31, 0.01);
    flap.rotation.x = 0.12;
    const strap = CreateCylinder("exit_satchel_strap", { height: 0.9, diameter: 0.025, tessellation: 6 }, s);
    strap.rotation.z = Math.PI / 2;
    strap.position.set(0, 0.02, 0.18);
    for (const m of [bag, flap, strap]) {
      m.material = leather;
      m.parent = this.root;
      m.isPickable = false;
      m.receiveShadows = true;
    }
    this.root.position.copyFrom(at);
    this.root.rotation.y = yaw;
    // (lying on its side against the wall)
    this.root.rotation.z = 0.25;
    cave.u.addToSet("caveC", this.root);
  }

  get taken() {
    return this.isTaken;
  }

  get position() {
    return this.root.position.clone();
  }

  /** The hold-E target on `set` (搜查, kneeling over it): taken, `use` runs (the charm). Null once taken. */
  target(set: Interactables, use: () => unknown): Interactable | null {
    if (this.isTaken) return null;
    return set.add({
      id: "exit_satchel",
      pos: this.root.position,
      label: KEEP_PROMPTS.search,
      // (kneeling to lift it off the wolf's floor; the noise comes with it)
      hold: 1.15,
      use: () => {
        this.take();
        return use();
      },
    });
  }

  /**
   * Take it now: gone, recorded (`looted`), and the pick-up's noise for the wolf (§9: 4 m, weight
   * 0.5, about +0.27 from 2.1 m over the kneel).
   */
  take(noiseSeconds = 1.15) {
    if (this.isTaken) return;
    this.set(true);
    this.cave.record(EXIT_IDS.satchel);
    this.cave.stage.ai?.noise.emit({ kind: "pickup", at: this.root.position, source: "player", seconds: noiseSeconds });
  }

  /** Pose it for a checkpoint. */
  set(taken: boolean) {
    this.isTaken = taken;
    for (const m of this.root.getChildMeshes(false)) m.isVisible = !taken;
  }
}

/**
 * The exit's cave (see {@link ensureCave}): the underground (`u`), its anchors (`a`), the web walls
 * (`webs.A` / `webs.B`), the courier's `cocoon`, the hunter's `satchel`, the den's bones (each a
 * noise underfoot), the climb's marks along the exit walk (`at`), the wolf's leash line, the
 * spider chamber's box, the nest's chatter, the respawn volumes (the stream, below the deck) and
 * the zones' outdoor switch. Lives as long as the stage (like the underground).
 */
export class CaveWorld {
  readonly u: Underground;
  readonly a: ExitAnchors;
  readonly webs: { readonly A: CaveWeb | null; readonly B: CaveWeb | null };
  readonly cocoon: CaveCocoon | null;
  readonly satchel: Satchel;
  /** the rest of the cave (zones B–E) is in: without it the exit has nothing to walk on past the gallery */
  readonly complete: boolean;
  /** the exit walk (`paths.walk.exit`: the den to the mouth) */
  readonly path: readonly V3[];
  /** where the climb's marks lie along `path` (m) */
  readonly at: { readonly climbS23: number; readonly climbMid: number; readonly cpLight: number; readonly bend: number };
  /** meshes this added (compiled before it shows) */
  readonly meshes: AbstractMesh[] = [];
  /** put a player who falls into a respawn volume back (default on) */
  respawn = true;
  private volumes: RespawnVolume[];
  private lastBank: "north" | "south" | null = null;
  private respawning = false;
  private claims: LightClaim[] = [];
  private bones: { at: Vector3; inside: boolean }[] = [];
  private nest: { on: boolean; shown: boolean; sound: { stop(): void; gain: GainNode | undefined } | null; starting: boolean } = { on: true, shown: false, sound: null, starting: false };
  /** the outdoor world as forced by the chapter (null: the zones decide) and as last applied */
  private outdoorForced: boolean | null = null;
  private outdoorApplied: boolean | null = null;
  private offs: (() => unknown)[] = [];
  private disposed = false;

  constructor(
    readonly stage: PrologueStage,
    u: Underground,
    a: ExitAnchors,
    rest: Rest | null,
    bonesAsset: AssetContainer | null,
  ) {
    this.u = u;
    this.a = a;
    this.complete = !!rest;
    const w = stage.world;
    const ph = u.physics;
    this.path = a.paths?.walk?.exit ?? [];
    const along = (name: string) => {
      const p = this.anchor(name).pos;
      return pathProgress(this.path, p).s;
    };
    this.at = { climbS23: along("climb_s23"), climbMid: along("climb_mid"), cpLight: along("cp_light"), bend: along("bend") };
    this.volumes = respawnVolumes(a.volumes);

    // ---- the web walls and the courier's cocoon (bodies built by the underground: tags web_A, web_B, cocoon)
    const all: Node[] = rest ? [...rest.container.transformNodes, ...rest.container.meshes] : [];
    const node = (name: string) => (all.find((n) => n.name === name) as TransformNode | undefined) ?? null;
    const body = (tag: string): BodyId | null => rest?.bodies[tag] ?? null;
    const record = (id: string) => this.record(id);
    const web = (id: "web_A" | "web_B", flag: string) => {
      const cards = node(`${id}_cards`);
      if (!cards && !body(id)) return null;
      return new CaveWeb({ id, flag, world: w, physics: ph, cards, body: body(id), def: a.webs?.[id] ?? null, record });
    };
    this.webs = { A: web("web_A", EXIT_IDS.webA), B: web("web_B", EXIT_IDS.webB) };
    const cocoonMesh = node("cocoon_courier_mesh");
    this.cocoon = cocoonMesh || body("cocoon") ? new CaveCocoon({ flag: EXIT_IDS.cocoon, world: w, physics: ph, mesh: cocoonMesh, body: body("cocoon"), at: this.anchor("cocoon").pos, record }) : null;

    // ---- the den: the hunter's satchel, the bones
    const sat = this.anchor("satchel");
    const bed = this.anchor("wolf_bed").pos;
    this.satchel = new Satchel(this, sat.pos, Math.atan2(-(bed.x - sat.pos.x), -(bed.z - sat.pos.z)));
    this.meshes.push(...this.satchel.root.getChildMeshes(false));
    this.buildBones(bonesAsset);

    // ---- pool lights: the egg sacs' glow (chamber), the den's daylight fissure (cosmetic, §4.3)
    const eggs = a.lights?.light_eggs;
    if (eggs) this.poolLight("caveB", eggs.pos, { color: eggs.hint.color, intensity: eggs.hint.intensity * 1.5, range: eggs.hint.range * 1.4, flicker: 0.04 });
    const fissure = a.lights?.light_den_fissure;
    if (fissure) this.poolLight("caveC", [fissure.pos[0], fissure.pos[1] - 1.5, fissure.pos[2]], { color: fissure.hint.color, intensity: 3, range: 13 });

    // ---- the nest's chatter while the chamber shows (the chapter silences it once the spiders are dead)
    this.offs.push(
      u.addToSet("caveB", {
        setEnabled: (on: boolean) => {
          this.nest.shown = on;
          this.nestSound();
        },
      }),
    );

    // ---- zones B–E with the exit's beds and profiles
    if (rest) this.defineZones();

    // ---- the mouth: the outcrop's plug goes now that the tunnel behind it exists (Appendix checklist 5)
    if (rest) this.openMouth();

    this.offs.push(w.onUpdate((dt) => this.update(dt)));
    u.check();
  }

  // ---------------------------------------------------------------- places

  /** A cave anchor (world; y the collider floor), §11's position when the build lacks it. */
  anchor(name: string): { pos: Vector3; yaw: number } {
    const an = this.a.anchors[name];
    if (an) return { pos: new Vector3(an.pos[0], an.pos[1], an.pos[2]), yaw: an.yaw ?? 0 };
    const m = EXIT_MARKS[name];
    if (m) return { pos: new Vector3(m[0], m[1], m[2]), yaw: 0 };
    throw new Error(`exit: no cave anchor ${name}`);
  }

  /** An anchor on the static floor under it (a ray down from its height; the anchor's own y without a floor). */
  floorAt(name: string): Vector3 {
    const p = this.anchor(name).pos;
    const y = this.u.floor(p.x, p.z, p.y);
    return new Vector3(p.x, y ?? p.y, p.z);
  }

  /** How far along the exit walk `p` is (m from the den), and how far from the walk it stands. */
  progress(p: { x: number; y: number; z: number }) {
    return pathProgress(this.path, p);
  }

  /**
   * The wolf's leash line (§6.3 E6): false past `climb_s23` on the climb (the plane across the
   * tunnel there, facing up the walk).
   */
  readonly leash = (p: { x: number; z: number }): boolean => {
    const s23 = this.anchor("climb_s23").pos;
    const dir = pathTangent(this.path, this.at.climbS23);
    return !dir || !beyond(p, s23, dir);
  };

  /** Whether `p` is in the spider chamber (`volumes.spider_arena`, x 9…27, z −757…−743; `pad` m of slack). */
  inSpiderArena(p: { x: number; y: number; z: number }, pad = 0) {
    const v = this.a.volumes?.spider_arena;
    const box: ZoneBox = v?.min && v.max ? { min: v.min, max: v.max } : { min: [9, 26, -757], max: [27, 36, -743] };
    return inZoneBox(box, p, pad);
  }

  /** The zone the player is in ("B", "C", "D", "Dw", "Dl", "Eb", "E"; the keep's and "A" too). */
  get zone() {
    return this.u.zone;
  }

  // ---------------------------------------------------------------- state

  /** Record a world id in `flags.looted` (gone for good). */
  record(id: string) {
    this.stage.state.update("looted", (l) => void (l.includes(id) || l.push(id)));
  }

  /** The nest's chatter on or off (off for good once the spiders are dead). */
  setNest(on: boolean) {
    this.nest.on = on;
    this.nestSound();
  }

  /**
   * The outdoor world forced on or off whatever the zone (the platform's finale, the skip), or given
   * back to the zones (null: shown from `cp_light` on, as the underground decides elsewhere).
   */
  forceOutdoor(on: boolean | null) {
    this.outdoorForced = on;
    this.applyOutdoor();
  }

  private applyOutdoor() {
    const want = this.outdoorForced ?? (OUTDOOR_ZONES.has(this.u.zone ?? "") ? true : null);
    if (want === this.outdoorApplied) return;
    this.outdoorApplied = want;
    this.u.setOutdoor(want);
  }

  // ---------------------------------------------------------------- building

  private defineZones() {
    const Z = this.a.zones;
    const zones = this.u.zones;
    const has = (id: string) => assets.has(id);
    const beds = (...ids: string[]) => ids.filter(has).map((id) => ({ id, gain: BED_GAIN[id] }));
    // the pipeline's D, split where the wind starts and where the light does (its boxes by their
    // centres along the exit walk: overlaps resolve to the earlier zone, as the pipeline's did)
    // (a build without the walk paths keeps D whole)
    const dBoxes = (Z.D?.boxes ?? []) as ZoneBox[];
    const [d0, dWind, dLight] = this.path.length >= 2 ? splitBoxes(dBoxes, this.path, [this.at.climbMid - 1, this.at.cpLight - 0.5]) : [dBoxes, [], []];
    // the pipeline's E: the deck's box (the one holding `platform`) and the bend before it
    const deck = this.anchor("platform").pos;
    const eBoxes = (Z.E?.boxes ?? []) as ZoneBox[];
    const eDeck = eBoxes.filter((b) => inZoneBox(b, deck));
    const eBend = eBoxes.filter((b) => !eDeck.includes(b));
    const defs: (ZoneDef & { level: "cave" })[] = [
      { id: EXIT_ZONES.B, boxes: Z.B?.boxes ?? [], profile: "cave", show: ["caveB"], neighbours: ["A", EXIT_ZONES.C], beds: beds(BED.cave, BED.drips), level: "cave" },
      { id: EXIT_ZONES.C, boxes: Z.C?.boxes ?? [], profile: "cave", show: ["caveC"], neighbours: [EXIT_ZONES.B, EXIT_ZONES.D], beds: beds(BED.cave, BED.drips), level: "cave" },
      { id: EXIT_ZONES.D, boxes: d0, profile: "cave", show: ["caveD"], neighbours: [EXIT_ZONES.C, EXIT_ZONES.wind], beds: beds(BED.cave), level: "cave" },
      { id: EXIT_ZONES.wind, boxes: dWind, profile: "cave", show: ["caveD"], neighbours: [EXIT_ZONES.D, EXIT_ZONES.light], beds: beds(BED.cave, BED.wind), level: "cave" },
      { id: EXIT_ZONES.light, boxes: dLight, profile: "climb-out", show: ["caveD"], neighbours: [EXIT_ZONES.wind, EXIT_ZONES.bend], beds: beds(BED.wind), level: "cave" },
      { id: EXIT_ZONES.bend, boxes: eBend, profile: "climb-out", show: ["caveE"], neighbours: [EXIT_ZONES.light, EXIT_ZONES.outcrop], beds: beds(BED.wind), level: "cave" },
      { id: EXIT_ZONES.outcrop, boxes: eDeck, profile: "outdoor", show: ["caveE"], neighbours: [EXIT_ZONES.bend, EXIT_ZONES.light], beds: beds(BED.outside), level: "cave" },
    ];
    // the underground's B–E out (define-then-remove: the disposer takes out the def it replaced
    // them with), then these in order after the gallery's A
    for (const id of ["B", "C", "D", "E"]) zones.define({ id, boxes: [] })();
    for (const d of defs) if (d.boxes.length) zones.define({ ...d, priority: 0 });
    zones.reset();
  }

  private openMouth() {
    const oc = this.stage.outcrop;
    if (!oc) return;
    for (const m of oc.plug) m.setEnabled(false);
    if (oc.plugBody) {
      this.u.physics.removeBody(oc.plugBody);
      oc.plugBody = null;
    }
  }

  private buildBones(c: AssetContainer | null) {
    const scene = this.stage.world.scene;
    const pa = { meta: null, containers: new Map(c ? [["procprops/exit", c]] : []) };
    for (const b of BONES) {
      const an = this.a.anchors[b.anchor];
      if (!an) continue;
      const at = new Vector3(an.pos[0], an.pos[1], an.pos[2]);
      this.bones.push({ at, inside: false });
      const sp = c ? spawn(pa, `procprops/exit#${b.node}`, null, scene) : null;
      if (!sp) continue;
      placeNode(sp.node, at, b.yaw);
      for (const m of sp.meshes) {
        m.computeWorldMatrix(true);
        m.freezeWorldMatrix();
      }
      this.meshes.push(...sp.meshes);
      this.u.addToSet("caveC", sp.node);
    }
  }

  private poolLight(set: UndergroundSet, pos: V3, o: { color: V3; intensity: number; range: number; flicker?: number }) {
    const pool = this.stage.world.lights;
    if (!pool) return;
    const claim = pool.add({ at: new Vector3(pos[0], pos[1], pos[2]), color: o.color, intensity: 0, range: o.range, flicker: o.flicker ?? 0, reach: 20 });
    this.claims.push(claim);
    this.offs.push(this.u.addToSet(set, { setEnabled: (on: boolean) => void (claim.intensity = on ? o.intensity : 0) }));
  }

  private nestSound() {
    const n = this.nest;
    const want = n.on && n.shown && !this.disposed;
    const id = "audio/spider_chatter";
    if (want && !n.sound && !n.starting && assets.has(id)) {
      n.starting = true;
      const c = this.anchor("spider_c").pos.add(new Vector3(0, 1.5, 0));
      void this.stage.world
        .loopEmitter(id, () => c, 0)
        .then((h) => {
          n.starting = false;
          if (!h) return;
          if (this.disposed) return h.stop();
          n.sound = { stop: h.stop, gain: h.gain };
          this.nestSound();
        })
        .catch((e) => {
          n.starting = false;
          console.warn("exit: nest", e);
        });
      return;
    }
    const g = n.sound?.gain;
    const ctx = audio.ctx;
    if (g && ctx) g.gain.setTargetAtTime(want ? 0.7 : 0, ctx.currentTime, 0.6);
  }

  // ---------------------------------------------------------------- per frame

  private update(_dt: number) {
    if (this.disposed) return;
    // from cp_light on the outdoor world shows (the zones of the stair, the bend and the deck)
    this.applyOutdoor();
    const pl = this.stage.player;
    if (!pl || !pl.enabled) return;
    const p = pl.position;
    // the den's bones: a step on a pile is a noise (the wolf's meter, +0.35 once)
    for (const b of this.bones) {
      const d = Math.hypot(p.x - b.at.x, p.z - b.at.z);
      if (!b.inside && d <= BONE_STEP.radius && Math.abs(p.y - b.at.y) < 1) {
        b.inside = true;
        this.stage.ai?.noise.emit({ kind: "bone", at: b.at, source: "player" });
      } else if (b.inside && d > BONE_STEP.rearm) b.inside = false;
    }
    // falls: into the stream (back to the bank last stood on), off the outcrop (back to the deck)
    const chasm = this.a.paths?.chasm;
    if (chasm && pl.onGround) this.lastBank = bankOf(p, chasm) ?? this.lastBank;
    if (!this.respawn || this.respawning || !this.volumes.length) return;
    const r = respawnTarget(p, this.volumes, this.lastBank);
    if (r) void this.putBack(r.to);
  }

  /** Fade 0.6 s, put the player at `anchor` (no damage), fade back. */
  private async putBack(anchor: string) {
    this.respawning = true;
    try {
      await hud.fade(true, 0.6);
      const pl = this.stage.player;
      if (this.disposed || !pl) return;
      const to = this.floorAt(anchor);
      pl.teleport(to.addInPlaceFromFloats(0, 0.05, 0), this.anchor(anchor).yaw);
      this.u.check();
    } finally {
      if (!this.disposed) void hud.fade(false, 0.6);
      this.respawning = false;
    }
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    for (const o of this.offs) o();
    this.offs = [];
    for (const c of this.claims) c.stop();
    this.claims = [];
    this.nest.sound?.stop();
    this.nest.sound = null;
    this.webs.A?.dispose();
    this.webs.B?.dispose();
  }
}
