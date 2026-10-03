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

/** One playable piece of the game (menu background, cart ride, ...). */
export interface Stage {
  scene: Scene;
  segment: SegmentId;
  /** false for the main menu: no pause menu, no pointer lock */
  gameplay: boolean;
  update(dt: number): void;
  applyQuality(q: Quality): void;
  setPaused(paused: boolean): void;
  /** Serializable progress for save games. */
  saveState(): { label: string; state: Record<string, unknown> };
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
  /** a modal UI (e.g. character creation) owns the mouse: don't pause on pointer unlock */
  modal = false;
  onExitToMenu: (() => void) | null = null;

  constructor(readonly canvas: HTMLCanvasElement) {}

  async init() {
    const { engine, api } = await createEngine(this.canvas);
    this.engine = engine;
    this.api = api;
    input.attach(this.canvas);
    this.applyResolution();
    settings.on(() => {
      this.applyResolution();
      this.stage?.applyQuality(settings.value.quality);
    });
    window.addEventListener("resize", () => this.engine.resize());
    document.addEventListener("visibilitychange", () => {
      if (document.hidden && this.stage?.gameplay) this.pause(true);
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
  private frame() {
    const now = performance.now();
    const real = Math.max(1e-4, (now - this.last) / 1000);
    const dt = Math.min(0.1, real) * this.timeScale;
    this.last = now;
    input.poll(dt);
    const st = this.stage;
    if (st) {
      if (st.gameplay && !this.transitioning && !this.modal) this.handleGlobalKeys();
      if (!this.paused) {
        st.update(dt);
        if (st.gameplay) this.playSeconds += dt;
      }
      // skeletal animation runs on game time too (frozen while paused, follows the debug time scale)
      st.scene.animationTimeScale = this.paused ? 0 : dt / real;
      st.scene.render();
    }
    input.endFrame();
    if (this.debugEl && st && (!this.instr || this.instr.scene !== st.scene)) {
      this.instr?.dispose();
      this.instr = new SceneInstrumentation(st.scene);
      this.instr.captureFrameTime = true;
    }
    if (this.debugEl && ++this.frameCount % 15 === 0 && st) {
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
      if (input.pressed("menu") || input.padPressed(9) || input.padPressed(1)) {
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
    const st = await make();
    this.stage = st;
    old?.dispose();
    st.applyQuality(settings.value.quality);
    this.paused = false;
    this.transitioning = false;
    // pointer lock needs a fresh user gesture; the stage prompts for a click instead
    if (!st.gameplay) input.releaseLock();
    hud.crosshair(false);
    (st as Stage & { begin?: () => void }).begin?.();
  }

  pause(on: boolean) {
    if (!this.stage?.gameplay || this.paused === on) return;
    this.paused = on;
    this.stage.setPaused(on);
    if (on) {
      input.releaseLock();
      audio.suspend();
      this.openPauseMenu();
    } else {
      closePanel();
      document.getElementById("pause")?.remove();
      audio.resume();
      input.requestLock(this.canvas);
    }
  }

  private openPauseMenu() {
    document.getElementById("pause")?.remove();
    const p = document.createElement("section");
    p.id = "pause";
    p.className = "panel";
    p.innerHTML = `<h2>暂停</h2>`;
    const items: [string, () => void][] = [
      ["继续", () => this.pause(false)],
      ...((this.stage as unknown as { canSkip?: boolean }).canSkip
        ? ([["跳过本章", () => {
            this.pause(false);
            void (this.stage as unknown as { skipChapter: () => Promise<void> }).skipChapter();
          }]] as [string, () => void][])
        : []),
      ["存档", () => void this.save("manual").then(() => hud.toast("已存档"))],
      ["读取", () => void openLoad((s) => this.loadSave(s), () => {})],
      ["设置", () => openSettings()],
      ["返回主菜单", () => this.exitToMenu()],
    ];
    const nav = document.createElement("div");
    nav.style.cssText = "display:flex;flex-direction:column;align-items:center;gap:10px";
    for (const [label, fn] of items) {
      const b = document.createElement("button");
      b.className = "btn";
      b.style.minWidth = "12em";
      b.textContent = label;
      b.onclick = () => {
        audio.uiTick("select");
        fn();
      };
      nav.appendChild(b);
    }
    p.appendChild(nav);
    document.getElementById("ui")!.appendChild(p);
  }

  async save(kind: SaveGame["kind"]) {
    if (!this.stage?.gameplay) return;
    const { label, state } = this.stage.saveState();
    const id = kind === "manual" ? `manual-${Date.now()}` : kind;
    await writeSave({ id, kind, label, segment: this.stage.segment, createdAt: Date.now(), playSeconds: this.playSeconds, state });
    if (kind === "quick") hud.toast("快速存档完成", 2000);
  }

  loadSave: (s: SaveGame) => void = () => {};

  exitToMenu() {
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
