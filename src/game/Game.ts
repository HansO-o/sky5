import { heading, menuList, orn } from "../ui/widgets";
import type { AbstractEngine } from "@babylonjs/core/Engines/abstractEngine";
import type { Scene } from "@babylonjs/core/scene";
import { assets } from "../core/assets/AssetClient";
import type { SegmentId } from "../core/assets/manifest";
import { audio } from "../core/audio";
import { input } from "../core/input";
import { writeSave, type SaveGame } from "../core/saves";
import { settings, type Quality } from "../core/settings";
import { hud } from "../ui/hud";
import { closePanel, openLoad, openSettings, panelOpen } from "../ui/panels";
import { createEngine } from "./engine";
import { SceneInstrumentation } from "@babylonjs/core/Instrumentation/sceneInstrumentation";
import { ShaderWatch } from "../engine/render/shaderWatch";

/** One playable piece of the game (menu background, cart ride, ...). */
export interface Stage {
  scene: Scene;
  segment: SegmentId;
  /** false for the main menu: no pause menu, no pointer lock */
  gameplay: boolean;
  update(dt: number): void;
  applyQuality(q: Quality): void;
  setPaused(paused: boolean): void;
  /** Serializable progress for save games (`kind` "auto" is a checkpoint). */
  saveState(kind?: SaveGame["kind"]): { label: string; state: Record<string, unknown> };
  /**
   * The stage's own game-time multiplier this frame (hit-stop, slow motion), applied inside its
   * `update`; skeletal animation follows it too. Read after `update`. Default 1.
   */
  readonly timeScale?: number;
  /** false: the stage keeps no progress (a sandbox); 存档 and quicksave say so instead of writing */
  readonly canSave?: boolean;
  dispose(): void;
}

export class Game {
  engine!: AbstractEngine;
  api: "webgpu" | "webgl2" = "webgl2";
  stage: Stage | null = null;
  paused = false;
  private last = performance.now();
  private playSeconds = 0;
  private debugEl: HTMLElement | null = null;
  private instr: SceneInstrumentation | null = null;
  /** debug: simulation speed multiplier (?timescale=N together with ?debug) */
  timeScale = 1;
  /** a modal UI (e.g. character creation) owns the mouse: no pause menu, no pointer lock */
  modal = false;
  /** the open modal UI's session (see openModal) */
  private modalSession: { close: () => void } | null = null;
  /** 读取 from the pause menu is loading: the old game waits behind the loading hint, paused */
  private loadingSave = false;
  onExitToMenu: (() => void) | null = null;
  /**
   * Debug (?debug): every shader program built, tagged with the phase the stage reports
   * ("<chapter>:prepare", "<chapter>:play", ...). One built in a play phase is a mid-play hitch and is
   * logged as `[shader] built while playing`.
   */
  shaders: ShaderWatch | null = null;

  constructor(readonly canvas: HTMLCanvasElement) {}

  async init() {
    const { engine, api } = await createEngine(this.canvas);
    this.engine = engine;
    this.api = api;
    if (new URLSearchParams(location.search).has("debug"))
      this.shaders = new ShaderWatch(engine, {
        report: (c) => c.phase.endsWith(":play") && console.info(`[shader] built while playing (${c.phase}): ${c.name}`),
      });
    input.attach(this.canvas);
    this.applyResolution();
    // graphics are re-applied only when they change, not on every volume or sensitivity slider tick
    let { quality, renderScale } = settings.value;
    settings.on((s) => {
      if (s.renderScale !== renderScale) {
        renderScale = s.renderScale;
        this.applyResolution();
      }
      if (s.quality !== quality) {
        quality = s.quality;
        this.stage?.applyQuality(quality);
      }
    });
    window.addEventListener("resize", () => this.engine.resize());
    document.addEventListener("visibilitychange", () => {
      // not over a modal UI (character creation): Esc and Tab couldn't close that pause menu
      if (document.hidden && this.stage?.gameplay && !this.modal) this.pause(true);
    });
    document.addEventListener("pointerlockchange", () => {
      // Esc releases pointer lock in the browser; treat that as "open the pause menu".
      if (!input.locked && this.stage?.gameplay && !this.paused && !this.transitioning && !this.modal) this.pause(true);
    });
    this.canvas.addEventListener("click", () => {
      if (this.stage?.gameplay && !this.paused && !this.modal) input.requestLock(this.canvas);
    });
    if (new URLSearchParams(location.search).has("debug")) {
      this.debugEl = document.createElement("div");
      this.debugEl.style.cssText = "position:fixed;left:8px;bottom:8px;font:12px monospace;color:#9f9;text-shadow:0 0 3px #000;pointer-events:none;white-space:pre";
      document.body.appendChild(this.debugEl);
      this.timeScale = +(new URLSearchParams(location.search).get("timescale") ?? 1) || 1;
    }
    this.engine.runRenderLoop(() => this.frame());
  }

  private applyResolution() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.engine.setHardwareScalingLevel(1 / (settings.value.renderScale * dpr));
  }

  private frameCount = 0;
  /** the frame in which the pause menu last opened (see handleGlobalKeys) */
  private pauseFrame = -1;
  private frame() {
    this.frameCount++;
    const now = performance.now();
    const real = Math.max(1e-4, (now - this.last) / 1000);
    const dt = Math.min(0.1, real) * this.timeScale;
    this.last = now;
    input.poll(dt);
    const st = this.stage;
    if (st) {
      // a pause menu that opened before a modal UI (its chapter went on during a fade) still closes
      if (st.gameplay && !this.transitioning && (!this.modal || this.paused) && !this.loadingSave) this.handleGlobalKeys();
      if (!this.paused) {
        st.update(dt);
        if (st.gameplay) this.playSeconds += dt;
      }
      // skeletal animation runs on game time too (frozen while paused, follows the debug time scale)
      st.scene.animationTimeScale = this.paused ? 0 : (dt / real) * (st.timeScale ?? 1);
      st.scene.render();
    }
    input.endFrame();
    if (this.debugEl && st && (!this.instr || this.instr.scene !== st.scene)) {
      this.instr?.dispose();
      this.instr = new SceneInstrumentation(st.scene);
      this.instr.captureFrameTime = true;
    }
    if (this.debugEl && this.frameCount % 15 === 0 && st) {
      const s = st.scene;
      const dc = this.instr?.drawCallsCounter.current;
      (window as unknown as { __stats: unknown }).__stats = { draws: dc, tris: (s.getActiveIndices() / 3) | 0, meshes: s.getActiveMeshes().length, fps: this.engine.getFps() };
      this.debugEl.textContent =
        `${this.api}  ${this.engine.getFps().toFixed(0)} fps  frame ${(this.engine as AbstractEngine).performanceMonitor.averageFrameTime.toFixed(1)} ms\n` +
        `meshes ${s.getActiveMeshes().length}/${s.meshes.length}  draw ${dc ?? "?"}  tris ${(s.getActiveIndices() / 3) | 0}\n` +
        `dl ${((assets.progress?.bps ?? 0) / 1e6).toFixed(1)} MB/s  active ${assets.progress?.active ?? 0} queued ${assets.progress?.queued ?? 0}`;
    }
  }

  private handleGlobalKeys() {
    if (this.paused) {
      // back: the panel over the pause menu first, then the game. In play Game owns this (main.ts only
      // on the main menu). Not the Esc that released the pointer lock and so opened this menu: Chrome
      // and Firefox keep it from the page, a browser that passes it on has it in the menu's first frame
      const esc = input.pressedCode("Escape") && this.frameCount > this.pauseFrame + 1;
      if (input.pressed("menu") || esc || input.padPressed(9) || input.padPressed(1)) {
        if (!closePanel()) this.pause(false);
      }
      return;
    }
    if (input.pressed("menu") || input.padPressed(9)) this.pause(true);
    if (input.pressed("quicksave")) void this.save("quick");
  }

  transitioning = false;

  async setStage(make: () => Promise<Stage>) {
    this.transitioning = true;
    const old = this.stage;
    let st: Stage;
    try {
      st = await make();
    } catch (e) {
      // the old stage stays on; the caller reports the failure
      this.transitioning = false;
      throw e;
    }
    // what belonged to the old stage: an open modal UI, and its pause menu with any panel over it
    // (读取 from the pause menu)
    this.endModal();
    document.getElementById("pause")?.remove();
    if (this.paused) {
      closePanel();
      audio.resume();
    }
    this.stage = st;
    old?.dispose();
    st.applyQuality(settings.value.quality);
    this.paused = false;
    // a loaded game takes global keys as soon as it runs (not after its fade-in)
    this.loadingSave = false;
    this.transitioning = false;
    // pointer lock needs a fresh user gesture; the stage prompts for a click instead
    if (!st.gameplay) input.releaseLock();
    hud.crosshair(false);
    (st as Stage & { begin?: () => void }).begin?.();
  }

  pause(on: boolean) {
    // no pause menu while the stage changes: it would outlive the stage it belongs to
    if (!this.stage?.gameplay || this.paused === on || (on && this.transitioning)) return;
    this.paused = on;
    this.stage.setPaused(on);
    if (on) {
      this.pauseFrame = this.frameCount;
      input.releaseLock();
      audio.suspend();
      this.openPauseMenu();
    } else {
      closePanel();
      document.getElementById("pause")?.remove();
      audio.resume();
      // a modal UI keeps the mouse
      if (!this.modal) input.requestLock(this.canvas);
    }
  }

  private openPauseMenu() {
    document.getElementById("pause")?.remove();
    const p = document.createElement("section");
    p.id = "pause";
    p.setAttribute("role", "dialog");
    p.appendChild(heading("暂停"));
    const items: [string, () => void][] = [
      ["继续", () => this.pause(false)],
      ...((this.stage as unknown as { canSkip?: boolean }).canSkip
        ? ([["跳过本章", () => {
            this.pause(false);
            void (this.stage as unknown as { skipChapter: () => Promise<void> }).skipChapter();
          }]] as [string, () => void][])
        : []),
      ["存档", () => void this.save("manual").then((ok) => ok && hud.toast("已存档"))],
      ["读取", () => void openLoad((s) => void this.loadFromPause(s), () => {})],
      ["设置", () => openSettings()],
      ["返回主菜单", () => this.exitToMenu()],
    ];
    p.appendChild(menuList(items, { blocked: () => panelOpen() }));
    const tail = document.createElement("div");
    tail.className = "tail";
    tail.appendChild(orn("mid"));
    tail.style.display = "flex";
    p.appendChild(tail);
    document.getElementById("ui")!.appendChild(p);
  }

  /** Resolves with whether the save was written; a failure (storage full or blocked) is reported, never thrown. */
  async save(kind: SaveGame["kind"]) {
    if (!this.stage?.gameplay) return false;
    if (this.stage.canSave === false) {
      if (kind !== "auto") hud.toast("此处无法存档", 2000);
      return false;
    }
    const { label, state } = this.stage.saveState(kind);
    const id = kind === "manual" ? `manual-${Date.now()}` : kind;
    try {
      await writeSave({ id, kind, label, segment: this.stage.segment, createdAt: Date.now(), playSeconds: this.playSeconds, state });
    } catch (err) {
      console.warn("save failed", err);
      hud.toast(kind === "auto" ? "自动存档失败" : "存档失败：无法使用本地存储", 3000);
      return false;
    }
    if (kind === "quick") hud.toast("快速存档完成", 2000);
    return true;
  }

  /** Starts a game from a save (main.ts); resolves once it is running, or has failed and been reported. */
  loadSave: (s: SaveGame) => Promise<void> = async () => {};

  private async loadFromPause(s: SaveGame) {
    // the pause menu acts on the game being replaced (继续 would resume it, 返回主菜单 race the load)
    document.getElementById("pause")?.remove();
    const old = this.stage;
    this.loadingSave = true;
    try {
      await this.loadSave(s);
    } finally {
      // only after a failed load: a loaded game has had its keys since setStage, and may be loading
      // another save from its own pause menu by the time this one's fade-in ends
      if (this.stage === old) this.loadingSave = false;
    }
    // the load failed and the old game is still on: back to its pause menu
    if (this.stage === old && this.paused && !document.getElementById("pause")) {
      audio.suspend();
      this.openPauseMenu();
    }
  }

  /**
   * A modal UI (character creation) opens: no pause menu or pointer lock until it ends. `close` takes
   * the UI down if its stage goes away first (exit to menu, 读取). Call the returned function when the
   * UI is done.
   */
  openModal(close: () => void) {
    this.endModal();
    const session = { close };
    this.modalSession = session;
    this.modal = true;
    return () => {
      if (this.modalSession !== session) return;
      this.modalSession = null;
      this.modal = false;
    };
  }

  /** Closes the open modal UI, if any. */
  private endModal() {
    const session = this.modalSession;
    this.modalSession = null;
    this.modal = false;
    session?.close();
  }

  exitToMenu() {
    this.shaders?.mark("menu");
    document.getElementById("pause")?.remove();
    closePanel();
    this.paused = false;
    audio.resume();
    audio.stopAllBeds(1);
    audio.stopMusic(1);
    hud.clearSubtitle();
    hud.prompt(null);
    this.onExitToMenu?.();
  }

  get isPausePanelOpen() {
    return panelOpen();
  }
}
