import { Scene } from "@babylonjs/core/scene";
import { FreeCamera } from "@babylonjs/core/Cameras/freeCamera";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Color4 } from "@babylonjs/core/Maths/math.color";
import { ParticleSystem } from "@babylonjs/core/Particles/particleSystem";
import { BoxParticleEmitter } from "@babylonjs/core/Particles/EmitterTypes/boxParticleEmitter";
import "@babylonjs/core/Particles/particleSystemComponent";
import type { AbstractEngine } from "@babylonjs/core/Engines/abstractEngine";
import type { Texture } from "@babylonjs/core/Materials/Textures/texture";
import { loadKTX2 } from "../game/loaders";
import type { Stage } from "../game/Game";

/** Main menu background: slow drifting smoke on black. */
export class MenuStage implements Stage {
  scene: Scene;
  segment = "menu" as const;
  gameplay = false;
  private systems: ParticleSystem[] = [];
  private cam: FreeCamera;
  private t = 0;

  constructor(engine: AbstractEngine) {
    this.scene = new Scene(engine);
    this.scene.clearColor = new Color4(0, 0, 0, 1);
    this.scene.skipPointerMovePicking = true;
    this.cam = new FreeCamera("menuCam", new Vector3(0, 0, -20), this.scene);
    this.cam.setTarget(Vector3.Zero());
    this.cam.fov = 0.9;
  }

  async init() {
    const tex = await loadKTX2("menu/smoke", this.scene, { wrap: false });
    this.addSmoke(tex, { y: -7, count: 180, size: [7, 14], alpha: 0.11, speed: 0.25, w: 34 });
    this.addSmoke(tex, { y: -3, count: 90, size: [5, 10], alpha: 0.06, speed: 0.18, w: 30 });
    this.addSmoke(tex, { y: 4, count: 50, size: [6, 12], alpha: 0.035, speed: 0.12, w: 30 });
    // pre-warm so the screen isn't empty
    for (const s of this.systems) {
      s.preWarmCycles = 120;
      s.preWarmStepOffset = 8;
      s.start();
    }
    await this.scene.whenReadyAsync();
    return this;
  }

  private addSmoke(tex: Texture, o: { y: number; count: number; size: [number, number]; alpha: number; speed: number; w: number }) {
    const ps = new ParticleSystem("smoke", o.count, this.scene);
    ps.particleTexture = tex;
    const em = new BoxParticleEmitter();
    em.minEmitBox = new Vector3(-o.w / 2 - 6, o.y - 2, -4);
    em.maxEmitBox = new Vector3(o.w / 2, o.y + 2, 6);
    em.direction1 = new Vector3(0.6, 0.12, 0);
    em.direction2 = new Vector3(1, 0.3, 0);
    ps.particleEmitterType = em;
    ps.emitter = Vector3.Zero();
    ps.minSize = o.size[0];
    ps.maxSize = o.size[1];
    ps.minLifeTime = 30;
    ps.maxLifeTime = 45;
    ps.emitRate = o.count / 35;
    ps.minEmitPower = o.speed;
    ps.maxEmitPower = o.speed * 2;
    ps.minAngularSpeed = -0.03;
    ps.maxAngularSpeed = 0.03;
    ps.minInitialRotation = 0;
    ps.maxInitialRotation = Math.PI * 2;
    ps.updateSpeed = 1 / 60;
    ps.blendMode = ParticleSystem.BLENDMODE_STANDARD;
    ps.color1 = new Color4(0.75, 0.74, 0.72, o.alpha);
    ps.color2 = new Color4(0.55, 0.55, 0.56, o.alpha * 0.8);
    ps.colorDead = new Color4(0.4, 0.4, 0.4, 0);
    ps.addColorGradient(0, new Color4(0.7, 0.7, 0.7, 0));
    ps.addColorGradient(0.2, new Color4(0.72, 0.71, 0.7, o.alpha));
    ps.addColorGradient(0.8, new Color4(0.6, 0.6, 0.6, o.alpha * 0.8));
    ps.addColorGradient(1, new Color4(0.5, 0.5, 0.5, 0));
    ps.addSizeGradient(0, o.size[0]);
    ps.addSizeGradient(1, o.size[1] * 1.4);
    this.systems.push(ps);
  }

  update(dt: number) {
    this.t += dt;
    // very slow camera drift
    this.cam.position.x = Math.sin(this.t * 0.05) * 0.8;
    this.cam.position.y = Math.cos(this.t * 0.04) * 0.4;
    this.cam.setTarget(Vector3.Zero());
  }

  applyQuality() {}
  setPaused() {}
  saveState() {
    return { label: "", state: {} };
  }
  dispose() {
    this.scene.dispose();
  }
}
