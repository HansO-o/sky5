import type { Game, Stage } from "../game/Game";
import { loadGLB } from "../game/loaders";
import { assets } from "../core/assets/AssetClient";
import type { SegmentId } from "../core/assets/manifest";
import { audio } from "../core/audio";
import { input } from "../core/input";
import { settings, type Quality } from "../core/settings";
import { hud } from "../ui/hud";
import { buildTown, LAYOUT, type Town } from "../world/town";
import { Physics } from "../physics/Physics";
import { VertexBuffer } from "@babylonjs/core/Buffers/buffer";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import { nextFrame } from "../game/loaders";
import { Cancelled, Director } from "./Director";
import { World } from "./World";
import type { Wagon } from "./wagon";
import type { Chapter, ChapterContext } from "./chapters/types";
import { defaultAppearance, type Appearance } from "../world/appearance";
import { PlayerController } from "./player";
import { createPlayerBody } from "./playerBody";
import { CartChapter } from "./chapters/cart";
import { RoamChapter } from "./chapters/roam";
import { ExecutionChapter } from "./chapters/execution";
import { MusterChapter } from "./chapters/muster";

type ChapterFactory = (ctx: ChapterContext) => Chapter;

/** Chapters in play order. Later milestones append to this list. */
export const CHAPTERS: { id: SegmentId; make: ChapterFactory }[] = [
  { id: "cart", make: (c) => new CartChapter(c) },
  { id: "muster", make: (c) => new MusterChapter(c) },
  { id: "execution", make: (c) => new ExecutionChapter(c) },
];
const DEBUG = new URLSearchParams(location.search);
if (DEBUG.has("debug") && DEBUG.has("roam")) CHAPTERS.splice(0, CHAPTERS.length, { id: "muster", make: (c) => new RoamChapter(c) });

export interface PrologueSave {
  chapter: SegmentId;
  state: Record<string, unknown> | null;
  /** the player's character (set during the muster) */
  appearance?: Appearance | null;
}

/**
 * The whole prologue runs in one persistent world; chapters (cart ride, muster, execution, dragon
 * attack, ...) follow each other without loading screens.
 */
export class PrologueStage implements Stage {
  world: World;
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
  private townP: Promise<void> | null = null;
  private physicsP: Promise<Physics> | null = null;
  private prepared: { index: number; chapter: Chapter; resume: Record<string, unknown> | null } | null = null;
  private ctx: ChapterContext;
  private paused = false;

  constructor(private game: Game) {
    this.world = new World(game.engine);
    this.ctx = { game, world: this.world, director: this.director, stage: this };
  }

  get scene() {
    return this.world.scene;
  }

  async init() {
    const T0 = performance.now();
    const lap = (what: string) => console.info(`[timing] world ${what} +${(performance.now() - T0).toFixed(0)} ms`);
    await this.world.init(lap);
    // most players start a new game: get the first chapter ready behind the menu
    await this.prepareChapter({ chapter: CHAPTERS[0].id, state: null });
    lap("chapter prepared");
    this.applyQuality(settings.value.quality);
    await this.scene.whenReadyAsync();
    lap("shaders ready");
    return this;
  }

  /** Prepare the chapter a save (or a new game) starts in. */
  async prepareChapter(save: PrologueSave) {
    if (save.appearance !== undefined) this.appearance = save.appearance;
    const index = Math.max(0, CHAPTERS.findIndex((c) => c.id === save.chapter));
    if (this.prepared && this.prepared.index === index && !save.state && !this.prepared.resume) return;
    this.prepared?.chapter.dispose();
    const chapter = CHAPTERS[index].make(this.ctx);
    // chapters after the ride need the town straight away
    if (index > 0) await this.ensureTown();
    await chapter.prepare(save.state);
    this.prepared = { index, chapter, resume: save.state };
  }

  /** Load and build the town once; shared by every chapter after the gate. */
  ensureTown() {
    this.townP ??= (async () => {
      const t0 = performance.now();
      const opt = (id: string) => loadGLB(id, this.scene).catch((e) => (console.warn(id, e), null));
      const [fort, houses, buildings, door] = await Promise.all([loadGLB("ph/modular_fort_01", this.scene), opt("cart/houses"), opt("town/buildings"), opt("ph/large_castle_door")]);
      if (this.world.disposed) return;
      const town = await buildTown(this.scene, { fort, houses, buildings, door }, (x, z) => this.world.heightAt(x, z));
      this.town = town;
      this.world.addShadowCasters(town.meshes);
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
      if (this.world.disposed) {
        ph.dispose();
        throw new Error("disposed");
      }
      const w = this.world;
      // terrain around the town (512 m square, ~2 m spacing)
      const size = 512;
      ph.addHeightField(LAYOUT.square.x - size / 2, LAYOUT.square.z - size / 2, size, 256, (x, z) => w.heightAt(x, z));
      await nextFrame();
      if (this.town) {
        // one static mesh body per building, built over several frames
        const groups = new Map<unknown, AbstractMesh[]>();
        for (const m of this.town.colliders) {
          let top: unknown = m;
          while ((top as AbstractMesh).parent && (top as AbstractMesh).parent !== this.town.root) top = (top as AbstractMesh).parent;
          if (!groups.has(top)) groups.set(top, []);
          groups.get(top)!.push(m);
        }
        for (const list of groups.values()) {
          const pos: number[] = [], idx: number[] = [];
          for (const m of list) appendWorldGeometry(m, pos, idx);
          if (idx.length) ph.addStaticMesh(pos, idx);
          await nextFrame();
        }
        const b: number[] = [], bi: number[] = [];
        for (const m of this.town.breach.meshes) appendWorldGeometry(m, b, bi);
        if (bi.length) this.breachBody = ph.addStaticMesh(b, bi);
      }
      this.physics = ph;
      this.world.physics = ph;
      return ph;
    })();
    return this.physicsP;
  }
  breachBody: ReturnType<Physics["addStaticMesh"]> | null = null;

  /** The on-foot player, created at `pos` facing `yaw` on first use (later calls teleport it). */
  async ensurePlayer(pos: Vector3, yaw: number) {
    const ph = await this.ensurePhysics();
    if (!this.player) {
      const { body, heightScale } = await createPlayerBody(this.world, this.appearance ?? defaultAppearance());
      this.player = new PlayerController(ph, this.world.rig, body, pos, yaw);
      this.player.setEyeHeight(1.62 * heightScale);
    } else this.player.teleport(pos, yaw);
    this.world.rig.follow(this.player);
    return this.player;
  }

  private skipResolve: (() => void) | null = null;
  /** Skip the rest of the current chapter (pause menu / hold-to-skip). */
  async skipChapter() {
    if (!this.skipResolve || !this.chapter) return;
    await hud.fade(true, 0.5);
    this.skipResolve?.();
  }
  get canSkip() {
    return !!this.skipResolve;
  }

  /** Called by Game.setStage when this stage becomes active. */
  begin() {
    void this.play();
  }

  private async play() {
    const p = this.prepared!;
    this.prepared = null;
    try {
      for (let i = p.index; i < CHAPTERS.length; i++) {
        const ch = i === p.index ? p.chapter : CHAPTERS[i].make(this.ctx);
        if (i !== p.index) {
          // chapters change behind a black screen (unless one picks up mid-shot); each chapter
          // fades in when it is ready
          if (!ch.seamless) await hud.fade(true, 1.0);
          await ch.prepare(null, true);
        }
        this.chapter = ch;
        this.segment = ch.id;
        assets.setSegment(ch.id);
        // checkpoint at the start of every chapter (the ride saves its own progress on new game)
        if (i !== p.index) await this.game.save("auto");
        const run = ch.run(i === p.index ? p.resume : null);
        run.catch((e) => !(e instanceof Cancelled) && console.error(e));
        const skipped = new Promise<"skip">((r) => (this.skipResolve = () => r("skip")));
        const how = await Promise.race([run.then(() => "done" as const), skipped]);
        this.skipResolve = null;
        if (how === "skip") {
          // stop the chapter's scripts, then put the world into the chapter's end state
          this.director.cancelAll();
          this.director.reset();
          hud.clearSubtitle();
          hud.prompt(null);
          ch.skip?.();
        }
        ch.dispose();
      }
      this.chapter = null;
      await this.endCard();
    } catch (e) {
      if (!(e instanceof Cancelled)) console.error(e);
    }
  }

  private async endCard() {
    await this.game.save("auto");
    await hud.fade(true, 2);
    hud.clearSubtitle();
    audio.stopAllBeds(2);
    audio.stopMusic(3);
    const card = document.createElement("section");
    card.id = "endcard";
    card.innerHTML = `<h2>囚 车</h2><p>第一段 · 完</p><p style="font-size:13px">后续段落将在之后的版本中开放</p><button>返回主菜单</button>`;
    card.querySelector("button")!.addEventListener("click", () => {
      card.remove();
      void hud.fade(false, 0.5);
      this.game.exitToMenu();
    });
    document.getElementById("ui")!.appendChild(card);
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
    if (p) hud.clearSubtitle();
  }

  saveState() {
    const ch = this.chapter ?? this.prepared?.chapter;
    return { label: ch?.label ?? "序章", state: { chapter: ch?.id ?? "cart", state: ch?.save() ?? null, appearance: this.appearance } as unknown as Record<string, unknown> };
  }

  dispose() {
    this.director.cancelAll();
    this.chapter?.dispose();
    this.prepared?.chapter.dispose();
    for (const w of this.wagons) w.dispose();
    audio.stopAllBeds(1);
    this.player?.dispose();
    this.world.dispose();
    this.physics?.dispose();
    hud.clearSubtitle();
    hud.loading(false);
    hud.prompt(null);
  }
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
