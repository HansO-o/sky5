import type { Game, Stage } from "../game/Game";
import type { SaveGame } from "../core/saves";
import { loadGLB } from "../game/loaders";
import { assets } from "../core/assets/AssetClient";
import type { SegmentId } from "../core/assets/manifest";
import { audio } from "../core/audio";
import { input } from "../core/input";
import { settings, type Quality } from "../core/settings";
import { hud } from "../ui/hud";
import { heading } from "../ui/widgets";
import { buildTown, GATE, LAYOUT, type Town } from "../world/town";
import { Physics, type BodyId } from "../engine/physics/Physics";
import { Debris } from "../engine/physics/Debris";
import { BodyFollower } from "../engine/physics/BodyFollower";
import { activeTerrainHoles } from "../world/terrainHoles";
import { VertexBuffer } from "@babylonjs/core/Buffers/buffer";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import type { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { nextFrame } from "../game/loaders";
import { Cancelled, Director, type ScriptScope } from "./Director";
import { World } from "./World";
import type { Wagon } from "./wagon";
import type { Chapter, ChapterContext } from "./chapters/types";
import { defaultAppearance, type Appearance } from "../world/appearance";
import { PlayerController } from "./player";
import { createPlayerBody } from "./playerBody";
import { CartChapter } from "./chapters/cart";
import { RoamChapter } from "./chapters/roam";
import { DragonChapter } from "./chapters/dragon";
import { ExecutionChapter } from "./chapters/execution";
import { MusterChapter } from "./chapters/muster";
import { WorldState, type WorldSnapshot } from "../engine/state/WorldState";
import { DEFAULT_FLAGS, normalizeFlags, type PrologueFlags } from "./flags";
import { FireFx } from "./fx/fire";
import { TownFires } from "./fx/townFires";
import { prepareArrows } from "./fx/arrow";
import { DragonDirector } from "./dragonDirector";
import { NodeHider } from "../engine/world/visibility";
import { Zones, type ZoneDef, type ZoneEffects } from "../engine/world/zones";
import type { InteriorOptions, LightingProfile } from "../world/environment";

type ChapterFactory = (ctx: ChapterContext) => Chapter;

/**
 * One leaf of the keep's main gate (hinged at x 58 "l" and x 62 "r"). Swing `hinge` about Y, then
 * `sync()` carries the leaf's collider along; or switch the collider off with
 * `physics.setBodyEnabled(body, false)` / `setTagEnabled("keep_door_l", false)`.
 */
export interface DoorLeaf {
  hinge: TransformNode;
  /** the leaf's static collider (registry tag "keep_door_l" / "keep_door_r") */
  body: BodyId | null;
  sync(): void;
}
/** A chapter and the script scope its scripts run in. */
type ScopedChapter = { chapter: Chapter; scope: ScriptScope };

/** Chapters in play order. Later milestones append to this list. */
export const CHAPTERS: { id: SegmentId; make: ChapterFactory }[] = [
  { id: "cart", make: (c) => new CartChapter(c) },
  { id: "muster", make: (c) => new MusterChapter(c) },
  { id: "execution", make: (c) => new ExecutionChapter(c) },
  { id: "dragon", make: (c) => new DragonChapter(c) },
];
const DEBUG = new URLSearchParams(location.search);
if (DEBUG.has("debug") && DEBUG.has("roam")) CHAPTERS.splice(0, CHAPTERS.length, { id: "muster", make: (c) => new RoamChapter(c) });

export interface PrologueSave {
  chapter: SegmentId;
  state: Record<string, unknown> | null;
  /** the player's character (set during the muster) */
  appearance?: Appearance | null;
  /** story flags as of the last checkpoint (missing in saves from before flags existed: defaults) */
  flags?: PrologueFlags;
  /** world-state parts of registered Saveables (only written when there are any) */
  parts?: WorldSnapshot["parts"];
}

/**
 * The whole prologue runs in one persistent world; chapters (cart ride, muster, execution, dragon
 * attack, ...) follow each other without loading screens.
 */
export class PrologueStage implements Stage {
  world: World;
  /** the script clock; every chapter gets its own scope on it */
  director = new Director();
  segment: SegmentId = "cart";
  gameplay = true;
  chapter: Chapter | null = null;
  wagons: Wagon[] = [];
  townReady = false;
  town: Town | null = null;
  /** the player's created character; null until the muster */
  appearance: Appearance | null = null;
  /** on-foot player (created by the first chapter that needs it, kept across chapters) */
  player: PlayerController | null = null;
  physics: Physics | null = null;
  /** loose pieces that tumble and freeze into scenery (set with the physics) */
  debris: Debris | null = null;
  /** the keep gate's leaves with their colliders (set with the physics when the town has the doors) */
  keepDoors: { l: DoorLeaf; r: DoorLeaf } | null = null;
  /**
   * Persistent story state (faction, inventory, outcomes, ...). Saves record it as of the last
   * checkpoint: every autosave is one, and so is `snapshotFlags()` (e.g. an encounter starting).
   */
  readonly state = new WorldState<PrologueFlags>(DEFAULT_FLAGS, { normalize: (raw) => normalizeFlags(raw) });
  /**
   * World events that outlive the chapter that started them (created on first use by
   * `ensureTownFx` / `ensureDragons`): the town's fire effects, its burning houses and the dragon.
   */
  townFx: FireFx | null = null;
  townFires: TownFires | null = null;
  dragons: DragonDirector | null = null;
  /** hides the town (not the keep while on its ground floor) with the outdoor world */
  private townHider = new NodeHider();
  private townFxP: Promise<FireFx> | null = null;
  private dragonsP: Promise<DragonDirector> | null = null;
  private townP: Promise<void> | null = null;
  private physicsP: Promise<Physics> | null = null;
  private prepared: (ScopedChapter & { index: number; resume: Record<string, unknown> | null }) | null = null;
  /** the chapter the story loop is preparing or playing */
  private running: ScopedChapter | null = null;
  /** what a save records while no chapter is current: the next one from its start, or the last one's end */
  private gap: { id: SegmentId; label: string; state: Record<string, unknown> | null } | null = null;
  private ctx: Omit<ChapterContext, "director">;
  private paused = false;
  private disposed = false;
  /** begin() has run: the stage reached the screen */
  private begun = false;

  constructor(private game: Game) {
    this.world = new World(game.engine);
    this.ctx = { game, world: this.world, stage: this };
  }

  get scene() {
    return this.world.scene;
  }

  /** The live story flags (see `state`). */
  get flags(): PrologueFlags {
    return this.state.flags;
  }

  /** Make the flags as they are now the checkpoint later saves record (a chapter checkpoint, an encounter start). */
  snapshotFlags() {
    this.state.checkpoint();
  }

  /** Put the flags back to the last checkpoint (an encounter retried after the player died). */
  restoreFlags() {
    return this.state.rollback();
  }

  /** A chapter checkpoint: snapshot the flags and autosave (resolves with whether the save was written). */
  checkpoint() {
    this.snapshotFlags();
    return this.game.save("auto");
  }

  async init() {
    const T0 = performance.now();
    const lap = (what: string) => console.info(`[timing] world ${what} +${(performance.now() - T0).toFixed(0)} ms`);
    this.game.shaders?.mark("load");
    await this.world.init(lap);
    // most players start a new game: get the first chapter ready behind the menu
    await this.prepareChapter({ chapter: CHAPTERS[0].id, state: null });
    lap("chapter prepared");
    this.applyQuality(settings.value.quality);
    // every scatter LOD as it will draw (thin-instanced, shadowed), even those with no instance yet
    await this.world.precompileSets();
    await this.scene.whenReadyAsync();
    lap("shaders ready");
    return this;
  }

  /** Prepare the chapter a save (or a new game) starts in. */
  async prepareChapter(save: PrologueSave) {
    if (save.appearance !== undefined) this.appearance = save.appearance;
    // a save from before flags existed starts from the defaults (so does a new game)
    await this.state.restore({ v: 1, flags: save.flags as PrologueFlags, parts: save.parts ?? {} });
    this.state.checkpoint();
    const index = Math.max(0, CHAPTERS.findIndex((c) => c.id === save.chapter));
    if (this.prepared && this.prepared.index === index && !save.state && !this.prepared.resume) return;
    if (this.prepared) {
      this.prepared.scope.cancel();
      this.prepared.chapter.dispose();
      this.prepared = null;
    }
    const { chapter, scope } = this.make(index);
    // chapters after the ride need the town straight away
    if (index > 0) await this.ensureTown();
    await chapter.prepare(save.state);
    // a ride prepared behind the menu leaves its convoy: once the chapter has stood its cast up,
    // whoever still sits in a wagon goes with it (no disposed Characters left in world.npcs)
    if (index > 0 && this.wagons.length) {
      const seated = (n: TransformNode) => this.wagons.some((wg) => n.isDescendantOf(wg.root) || n.isDescendantOf(wg.horseRoot));
      for (const [k, c] of [...this.world.npcs]) if (seated(c.root)) this.world.removeNpc(k);
      for (const wg of this.wagons) wg.dispose();
      this.wagons = [];
    }
    this.prepared = { index, chapter, scope, resume: save.state };
  }

  /** A chapter with its own script scope (cancelling it stops exactly that chapter's scripts). */
  private make(index: number): ScopedChapter {
    const scope = this.director.scope();
    return { chapter: CHAPTERS[index].make({ ...this.ctx, director: scope }), scope };
  }

  /** Load and build the town once; shared by every chapter after the gate. */
  ensureTown() {
    this.townP ??= (async () => {
      const t0 = performance.now();
      const opt = (id: string) => loadGLB(id, this.scene).catch((e) => (console.warn(id, e), null));
      const [fort, houses, buildings, door] = await Promise.all([loadGLB("ph/modular_fort_01", this.scene), opt("cart/houses"), opt("town/buildings"), opt("ph/large_castle_door")]);
      if (this.world.disposed) return;
      const town = await buildTown(this.scene, { fort, houses, buildings, door }, (x, z) => this.world.heightAt(x, z), {
        casters: (m) => this.world.addShadowCasters(m),
        shadows: () => this.world.env.shadows,
      });
      this.town = town;
      // hidden with the outdoor world; on the keep's ground floor its building and gate stay
      const keepParts = new Set<unknown>([town.keep, ...town.keepDoors.map((h) => h.parent)]);
      this.world.addOutdoorPart({
        setOutdoorVisible: (on, o) => this.townHider.hideOnly(on ? [] : town.root.getChildren().filter((c) => !(o.keep && keepParts.has(c)))),
      });
      // the arrows' shader, ahead of the first shot (muster, raid)
      void prepareArrows(this.world);
      console.info(`[timing] town built +${(performance.now() - t0).toFixed(0)} ms`);
      this.townReady = true;
    })().catch((e) => {
      console.error("town failed", e);
      this.townReady = true; // never block the story forever
    });
    return this.townP;
  }

  /** Jolt world with the town's static colliders (lazy: only chapters on foot need it). */
  ensurePhysics() {
    this.physicsP ??= (async () => {
      const [ph] = await Promise.all([Physics.create(), this.ensureTown()]);
      const w = this.world;
      // the stage can be disposed during any of the frames this takes: then free the Jolt world
      const alive = () => {
        if (w.disposed) throw new Cancelled();
      };
      let doors: PrologueStage["keepDoors"] = null;
      try {
        alive();
        // terrain around the town (512 m square, ~2 m spacing), open where the keep's basement and
        // the cave tunnel go below ground (once the geometry covering the openings ships)
        const size = 512;
        ph.addHeightField(LAYOUT.square.x - size / 2, LAYOUT.square.z - size / 2, size, 256, (x, z) => w.heightAt(x, z), activeTerrainHoles((id) => assets.has(id)), { tag: "terrain" });
        // on foot the town is the whole stage: close the gateway at its outer arch (the terrain collider
        // ends ~160 m up the road; the gate piece is 7.4 m wide)
        const gz = GATE.z + 1;
        ph.addBox(new Vector3(GATE.x, w.heightAt(GATE.x, gz) + 3, gz), new Vector3(3.7, 3.5, 0.3), undefined, { tag: "blocker_town_gate" });
        await nextFrame();
        alive();
        if (this.town) {
          const town = this.town;
          // the keep gate's leaves: one tagged body each, kept so the chapter can swing them
          const doorTag = new Map<unknown, "l" | "r">();
          town.keepDoors.forEach((hinge, i) => hinge.parent && doorTag.set(hinge.parent, i === 0 ? "l" : "r"));
          const doorBody: Partial<Record<"l" | "r", BodyId>> = {};
          // one static mesh body per building, built over several frames
          const groups = new Map<unknown, AbstractMesh[]>();
          for (const m of town.colliders) {
            let top: unknown = m;
            while ((top as AbstractMesh).parent && (top as AbstractMesh).parent !== town.root) top = (top as AbstractMesh).parent;
            if (!groups.has(top)) groups.set(top, []);
            groups.get(top)!.push(m);
          }
          for (const [top, list] of groups) {
            const pos: number[] = [], idx: number[] = [];
            for (const m of list) appendWorldGeometry(m, pos, idx);
            const side = doorTag.get(top);
            if (idx.length) {
              const id = ph.addStaticMesh(pos, idx, side ? { tag: `keep_door_${side}` } : {});
              if (side) doorBody[side] = id;
            }
            // the leaves move when the gate opens: their meshes follow their hinges again
            if (side) for (const m of list) m.unfreezeWorldMatrix();
            await nextFrame();
            alive();
          }
          if (town.keepDoors.length === 2) {
            const leaf = (side: "l" | "r", hinge: TransformNode): DoorLeaf => {
              const body = doorBody[side] ?? null;
              const f = body ? new BodyFollower(ph, body, hinge) : null;
              return { hinge, body, sync: () => f?.sync() };
            };
            doors = { l: leaf("l", town.keepDoors[0]), r: leaf("r", town.keepDoors[1]) };
          }
          const b: number[] = [], bi: number[] = [];
          for (const m of this.town.breach.meshes) appendWorldGeometry(m, b, bi);
          if (bi.length) this.breachBody = ph.addStaticMesh(b, bi, { tag: "tower_breach" });
        }
      } catch (e) {
        ph.dispose();
        throw e;
      }
      this.physics = ph;
      this.world.physics = ph;
      this.keepDoors = doors;
      this.debris = new Debris({ physics: ph, scene: this.scene, shadows: (m) => this.world.addShadowCasters(m) });
      // the breach stones' shader, ahead of the raid
      void this.debris.warm([this.town?.breach.meshes[0]?.material]);
      return ph;
    })().catch((e) => {
      this.physicsP = null; // a later chapter tries again
      throw e;
    });
    return this.physicsP;
  }
  /**
   * The town's fire effects and burning houses, owned by the stage: a chapter that lights fires (the
   * dragon raid) hands them over to the next one instead of putting them out.
   */
  ensureTownFx() {
    this.townFxP ??= (async () => {
      // no lights of its own: its fires light up through the world's light pool
      const [fx] = await Promise.all([FireFx.create(this.world), this.ensureTown()]);
      if (this.disposed || this.world.disposed) {
        fx.dispose();
        throw new Cancelled();
      }
      this.townFx = fx;
      const fires = new TownFires(fx, this.town?.houses ?? [], (x, z) => this.world.heightAt(x, z));
      this.townFires = fires;
      // the burning town goes dark with the outdoor world (and relights already burning)
      this.world.addOutdoorPart({
        setOutdoorVisible: (on) => {
          // (the story's end put them out)
          if (this.townFires !== fires) return;
          if (on) fires.resume();
          else fires.pause();
          fx.setDecalsVisible(on);
        },
      });
      return fx;
    })().catch((e) => {
      this.townFxP = null; // a later chapter tries again
      throw e;
    });
    return this.townFxP;
  }

  /** The dragon as a stage-owned world event (see {@link DragonDirector}). */
  ensureDragons() {
    this.dragonsP ??= (async () => {
      const [dragon] = await Promise.all([this.world.ensureDragon(), this.ensureTownFx()]);
      if (this.disposed || this.world.disposed) throw new Cancelled();
      this.dragons = new DragonDirector({
        world: this.world,
        dragon,
        // the stage's own script scope: chapters come and go, the dragon flies on
        scope: this.director.scope(),
        fx: () => this.townFx,
        fires: () => this.townFires,
      });
      return this.dragons;
    })().catch((e) => {
      this.dragonsP = null;
      throw e;
    });
    return this.dragonsP;
  }

  /** The story is over (end card): the dragon leaves and the fires go out behind the black screen. */
  private endWorldEvents() {
    this.dragons?.hide();
    this.townFires?.dispose();
    this.townFires = null;
    this.townFx?.dispose();
    this.townFx = null;
    this.townFxP = null;
  }

  breachBody: BodyId | null = null;
  breached = false;

  /**
   * The dragon smashes the tower's east wall: the wall section disappears and (with `push`) breaks
   * into tumbling stones that settle and then freeze (they never block the player: ragdoll layer).
   */
  breakBreach(push?: Vector3) {
    if (this.breached || !this.town) return;
    this.breached = true;
    const br = this.town.breach;
    const ph = this.physics;
    if (ph && this.breachBody) ph.removeBody(this.breachBody);
    this.breachBody = null;
    const src = br.meshes[0];
    // broken for good: showing the outdoor world again must not bring it back
    this.townHider.forget(br.node);
    br.node.setEnabled(false);
    if (!push || !ph || !src || !this.debris) return;
    src.computeWorldMatrix(true);
    const { minimumWorld: min, maximumWorld: max } = src.getBoundingInfo().boundingBox;
    // stones on the ragdoll layer (never in the player's way) that become scenery once settled
    this.debris.burst({ min, max }, { count: 16, push, material: src.material });
  }

  /**
   * Zones wired to this stage (design §3.2), checked 4 times a second against the player's feet (the
   * camera before there is a player). For each zone change:
   * - `profile` → `world.env.setInterior(profile, blend, o.profiles?.[profile])` ("climb-out" needs
   *   its anchor there);
   * - visibility sets: the built-in "outdoor" (shown: the outdoor world) and "keep" (shown while the
   *   outdoor world is hidden: the keep building stays) drive `world.setOutdoorVisible`; any other set
   *   name calls `o.sets[name](on)`;
   * - beds → audio beds keyed by asset id (gain 0.35 unless the bed gives one: the beds are
   *   loudness-normalised);
   * - music: an audio id to play (3 s fade), null to stop.
   * The chapter owns the result: `dispose()` it (its beds stop; profile and visibility stay).
   */
  createZones(defs: readonly ZoneDef[], o: { sets?: Record<string, (on: boolean) => void>; outside?: ZoneEffects; profiles?: Partial<Record<LightingProfile, InteriorOptions>> } = {}) {
    const w = this.world;
    const vis = { outdoor: w.outdoorVisible, keep: false, dirty: false };
    return new Zones(
      {
        probe: () => this.player?.position ?? w.rig.position,
        profile: (name, seconds) => w.env.setInterior(name as LightingProfile, seconds, o.profiles?.[name as LightingProfile]),
        show: (set, on) => {
          if (set === "outdoor" || set === "keep") {
            vis[set] = on;
            vis.dirty = true;
          } else o.sets?.[set]?.(on);
        },
        startBed: (id, gain) => void audio.startBed(id, id, gain ?? 0.35, 2).catch((e) => console.warn("bed", id, e)),
        stopBed: (id) => audio.stopBed(id, 2),
        music: (id) => (id ? void audio.playMusic(id, { fade: 3 }) : audio.stopMusic(3)),
        entered: () => {
          if (!vis.dirty) return;
          vis.dirty = false;
          w.setOutdoorVisible(vis.outdoor, { keep: vis.keep });
        },
      },
      defs,
      { outside: o.outside, bus: w },
    );
  }

  /** The on-foot player, created at `pos` facing `yaw` on first use (later calls teleport it). */
  async ensurePlayer(pos: Vector3, yaw: number) {
    const ph = await this.ensurePhysics();
    if (this.world.disposed) throw new Cancelled();
    if (!this.player) {
      const { body, heightScale } = await createPlayerBody(this.world, this.appearance ?? defaultAppearance());
      // no character controller in a Jolt world the disposed stage has already freed
      if (this.world.disposed) throw new Cancelled();
      this.player = new PlayerController(ph, this.world.rig, body, pos, yaw);
      this.player.setEyeHeight(1.62 * heightScale);
    } else this.player.teleport(pos, yaw);
    this.world.rig.follow(this.player);
    return this.player;
  }

  private skipResolve: (() => void) | null = null;
  /**
   * Skip the rest of the current chapter (pause menu / hold-to-skip). `target` is the chapter the
   * request was made in: if it ends before the screen is black, nothing is skipped. A chapter whose
   * `canSkip()` says no (a choice the player must make) is not skipped unless `force` (tests, debug).
   */
  async skipChapter(target: Chapter | null = this.chapter, force = false) {
    const resolve = this.skipResolve;
    if (!resolve || !target || target !== this.chapter) return;
    if (!force && target.canSkip?.() === false) return;
    await hud.fade(true, 0.5);
    // a chapter that ended meanwhile is followed by one that fades itself in: never skip that one
    if (this.skipResolve === resolve && this.chapter === target) resolve();
  }
  /** Whether the pause menu offers 跳过本章 now. */
  get canSkip() {
    return !!this.skipResolve && this.chapter?.canSkip?.() !== false;
  }

  /** Called by Game.setStage when this stage becomes active. */
  begin() {
    this.begun = true;
    void this.play();
  }

  private async play() {
    const p = this.prepared!;
    this.prepared = null;
    try {
      for (let i = p.index; i < CHAPTERS.length; i++) {
        const first = i === p.index;
        const cur = first ? p : this.make(i);
        const ch = cur.chapter;
        this.running = cur;
        // saved before it starts, a chapter begins from the top (or where the loaded save left it)
        this.gap = { id: ch.id, label: ch.label, state: first ? p.resume : null };
        const how = await this.playChapter(ch, first ? p.resume : null, !first);
        // the stage was disposed meanwhile: dispose() has ended the chapter
        if (this.disposed) return;
        this.skipResolve = null;
        if (how !== "done") {
          // stop the chapter's scripts, then put the world into the chapter's end state (a chapter
          // that failed is passed over the same way instead of leaving the story stuck)
          cur.scope.cancel();
          hud.clearSubtitle();
          hud.prompt(null);
          this.world.rig.clearSteer();
          if (how === "failed") hud.toast("本章出现错误，已跳过", 5000);
          try {
            ch.skip?.();
          } catch (e) {
            console.error(`chapter ${ch.id}: skip failed`, e);
          }
        }
        const end = { id: ch.id, label: ch.label, state: ch.save() };
        // also ends what a finished chapter left running (detached script branches)
        cur.scope.cancel();
        ch.dispose();
        // every chapter starts with no music states (it registers its own tracks)
        audio.resetMusicState();
        this.running = null;
        this.chapter = null;
        this.gap = end;
      }
      await this.endCard();
    } catch (e) {
      if (!this.disposed && !(e instanceof Cancelled)) console.error(e);
    }
  }

  /** Prepare (when `prepare`), start and play one chapter; resolves with how it ended. */
  private async playChapter(ch: Chapter, resume: Record<string, unknown> | null, prepare: boolean): Promise<"done" | "skip" | "failed"> {
    try {
      if (prepare) {
        // chapters change behind a black screen (unless one picks up mid-shot); each chapter
        // fades in when it is ready
        if (!ch.seamless) await hud.fade(true, 1.0);
        if (this.disposed) return "failed";
        // the town may still be loading (a ride skipped early, a cold cache): say so behind the
        // black screen, but not for a prepare that is over in a moment
        this.game.shaders?.mark(`${ch.id}:prepare`);
        let hint = false;
        const t = setTimeout(() => {
          if (this.townReady || this.disposed) return;
          hint = true;
          hud.loading(true, "加载中");
        }, 400);
        try {
          await ch.prepare(null, true);
        } finally {
          clearTimeout(t);
          // (dispose() has cleared it already; by now the hint may belong to the next load)
          if (hint && !this.disposed) hud.loading(false);
        }
      }
      // the story never moves on behind the pause menu
      while (this.paused && !this.disposed) await nextFrame();
      if (this.disposed) return "failed";
      this.chapter = ch;
      this.segment = ch.id;
      assets.setSegment(ch.id);
      // debug: a shader built from here on is one built mid-play (a hitch)
      this.game.shaders?.mark(`${ch.id}:play`);
      // checkpoint at the start of every chapter (the ride saves its own progress on new game)
      if (prepare) await this.autosave();
      if (this.disposed) return "failed";
      const run = ch.run(resume);
      run.catch((e) => !(e instanceof Cancelled) && console.error(`chapter ${ch.id}`, e));
      const skipped = new Promise<"skip">((r) => (this.skipResolve = () => r("skip")));
      return await Promise.race([run.then(() => "done" as const, () => "failed" as const), skipped]);
    } catch (e) {
      if (!(e instanceof Cancelled)) console.error(`chapter ${ch.id}`, e);
      return "failed";
    }
  }

  /** A failed autosave (storage full or blocked) is reported but never stops the story. */
  private async autosave() {
    try {
      await this.game.save("auto");
    } catch (e) {
      console.warn("autosave failed", e);
      hud.toast("自动存档失败", 3000);
    }
  }

  private async endCard() {
    this.game.shaders?.mark("end");
    await this.autosave();
    if (this.disposed) return;
    await hud.fade(true, 2);
    // not behind the pause menu: once gameplay is over, 继续 could no longer close it
    while (this.paused && !this.disposed) await nextFrame();
    if (this.disposed) return;
    this.endWorldEvents();
    hud.clearSubtitle();
    audio.stopAllBeds(2);
    audio.stopMusic(3);
    audio.resetMusicState();
    const card = document.createElement("section");
    card.id = "endcard";
    card.appendChild(heading("雾门镇"));
    card.insertAdjacentHTML("beforeend", `<p>序章 · 未完待续</p><p style="font-size:13px;letter-spacing:.2em">阵营选择、要塞与出洞将在之后的版本中开放</p><button>返回主菜单</button>`);
    card.querySelector("button")!.addEventListener("click", () => {
      card.remove();
      void hud.fade(false, 0.5);
      this.game.exitToMenu();
    });
    document.getElementById("ui")!.appendChild(card);
    // Enter / Space work on the card straight away
    card.querySelector("button")!.focus({ preventScroll: true });
    input.releaseLock();
    this.gameplay = false;
  }

  update(dt: number) {
    if (this.paused) return;
    this.director.update(dt);
    this.player?.update(dt);
    this.chapter?.update?.(dt);
    this.world.update(dt);
  }

  applyQuality(q: Quality) {
    this.world.applyQuality(q);
  }

  setPaused(p: boolean) {
    this.paused = p;
    // the line waits under the pause menu (its reading time stops with the game) and comes back on resume
    hideSubtitle(p);
  }

  saveState(kind?: SaveGame["kind"]) {
    // an autosave is a checkpoint: the flags as they are now become what this and later saves record
    if (kind === "auto") this.snapshotFlags();
    const ch = this.chapter ?? this.prepared?.chapter;
    // between chapters the next one from its start, after the last one its end: never a restart from the ride
    const at = ch ? { id: ch.id, label: ch.label, state: ch.save() } : (this.gap ?? { id: CHAPTERS[0].id, label: "序章", state: null });
    // quick and manual saves between checkpoints record the flags of the checkpoint their chapter step resumes from
    const snap = this.state.checkpointed;
    const save: PrologueSave = { chapter: at.id, state: at.state, appearance: this.appearance, flags: snap.flags };
    if (Object.keys(snap.parts).length) save.parts = snap.parts;
    return { label: at.label, state: save as unknown as Record<string, unknown> };
  }

  dispose() {
    this.disposed = true;
    this.skipResolve = null;
    // ends every chapter's scripts, including those of a chapter still being prepared
    this.director.cancelAll();
    this.running?.chapter.dispose();
    this.prepared?.chapter.dispose();
    // the stage's world events (their sound loops would outlive the world otherwise)
    this.dragons?.dispose();
    this.townFires = null;
    this.townFx?.dispose();
    this.townFx = null;
    for (const w of this.wagons) w.dispose();
    this.player?.dispose();
    this.debris?.dispose();
    this.world.dispose();
    this.physics?.dispose();
    // a stage that never reached the screen (a failed load from the pause menu) owns none of the
    // global audio/HUD state: that still belongs to the game being played
    if (this.begun) {
      audio.stopAllBeds(1);
      hud.clearSubtitle();
      hideSubtitle(false);
      hud.loading(false);
      hud.prompt(null);
    }
  }
}

/** Hide the subtitle line without ending it (hud.clearSubtitle would lose the rest of the line). */
function hideSubtitle(hidden: boolean) {
  const s = document.getElementById("subtitle");
  if (s) s.style.visibility = hidden ? "hidden" : "";
}

/** Append a mesh's triangles in world space (for static colliders). */
function appendWorldGeometry(m: AbstractMesh, pos: number[], idx: number[]) {
  const p = m.getVerticesData(VertexBuffer.PositionKind);
  const ind = m.getIndices();
  if (!p || !ind) return;
  m.computeWorldMatrix(true);
  const W = m.getWorldMatrix();
  const base = pos.length / 3;
  const v = new Vector3();
  for (let i = 0; i < p.length; i += 3) {
    Vector3.TransformCoordinatesFromFloatsToRef(p[i], p[i + 1], p[i + 2], W, v);
    pos.push(v.x, v.y, v.z);
  }
  // a mirrored transform (negative scale) flips winding; Jolt mesh shapes are double-sided for
  // the character anyway, so winding does not matter here
  for (let i = 0; i < ind.length; i++) idx.push(base + ind[i]);
}
