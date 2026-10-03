import type { Game, Stage } from "../game/Game";
import { loadGLB } from "../game/loaders";
import { assets } from "../core/assets/AssetClient";
import type { SegmentId } from "../core/assets/manifest";
import { audio } from "../core/audio";
import { input } from "../core/input";
import { settings, type Quality } from "../core/settings";
import { hud } from "../ui/hud";
import { buildTown } from "../world/town";
import { Cancelled, Director } from "./Director";
import { World } from "./World";
import type { Wagon } from "./wagon";
import type { Chapter, ChapterContext } from "./chapters/types";
import { CartChapter } from "./chapters/cart";

type ChapterFactory = (ctx: ChapterContext) => Chapter;

/** Chapters in play order. Later milestones append to this list. */
export const CHAPTERS: { id: SegmentId; make: ChapterFactory }[] = [{ id: "cart", make: (c) => new CartChapter(c) }];

export interface PrologueSave {
  chapter: SegmentId;
  state: Record<string, unknown> | null;
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
  private townP: Promise<void> | null = null;
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
    await this.prepareChapter({ chapter: "cart", state: null });
    lap("chapter prepared");
    this.applyQuality(settings.value.quality);
    await this.scene.whenReadyAsync();
    lap("shaders ready");
    return this;
  }

  /** Prepare the chapter a save (or a new game) starts in. */
  async prepareChapter(save: PrologueSave) {
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
      const [fort, houses] = await Promise.all([loadGLB("ph/modular_fort_01", this.scene), loadGLB("cart/houses", this.scene).catch(() => null)]);
      if (this.world.disposed) return;
      const town = await buildTown(this.scene, fort, houses, (x, z) => this.world.heightAt(x, z));
      this.world.addShadowCasters(town.meshes);
      console.info(`[timing] town built +${(performance.now() - t0).toFixed(0)} ms`);
      this.townReady = true;
    })().catch((e) => {
      console.error("town failed", e);
      this.townReady = true; // never block the story forever
    });
    return this.townP;
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
        if (i !== p.index) await ch.prepare(null);
        this.chapter = ch;
        this.segment = ch.id;
        assets.setSegment(ch.id);
        // checkpoint at the start of every chapter (the ride saves its own progress on new game)
        if (i !== p.index) await this.game.save("auto");
        await ch.run(i === p.index ? p.resume : null);
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
    return { label: ch?.label ?? "序章", state: { chapter: ch?.id ?? "cart", state: ch?.save() ?? null } as unknown as Record<string, unknown> };
  }

  dispose() {
    this.director.cancelAll();
    this.chapter?.dispose();
    this.prepared?.chapter.dispose();
    for (const w of this.wagons) w.dispose();
    audio.stopAllBeds(1);
    this.world.dispose();
    hud.clearSubtitle();
    hud.loading(false);
    hud.prompt(null);
  }
}
