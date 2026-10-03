import { Color3, Color4 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { ParticleSystem } from "@babylonjs/core/Particles/particleSystem";
import { ConeParticleEmitter } from "@babylonjs/core/Particles/EmitterTypes/coneParticleEmitter";
import { SphereParticleEmitter } from "@babylonjs/core/Particles/EmitterTypes/sphereParticleEmitter";
import { CylinderParticleEmitter } from "@babylonjs/core/Particles/EmitterTypes/cylinderParticleEmitter";
import "@babylonjs/core/Particles/particleSystemComponent";
import { CreateGround } from "@babylonjs/core/Meshes/Builders/groundBuilder";
import { CreateSphere } from "@babylonjs/core/Meshes/Builders/sphereBuilder";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { PointLight } from "@babylonjs/core/Lights/pointLight";
import type { Texture } from "@babylonjs/core/Materials/Textures/texture";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import { audio } from "../../core/audio";
import { loadKTX2 } from "../../game/loaders";
import type { World } from "../World";

export interface FireHandle {
  pos: Vector3;
  stop(): void;
}

/**
 * Fire, smoke, dragon breath, falling fireballs and scorch marks. Textures come from the "dragon"
 * segment (Babylon's CC-BY fire/smoke sprite sheets and Kenney's CC0 particles).
 */
export class FireFx {
  private systems = new Set<ParticleSystem>();
  private meshes: Mesh[] = [];
  private fires: FireHandle[] = [];
  private scorchMat: StandardMaterial;
  private ballMat: StandardMaterial;
  private lights: PointLight[] = [];
  private offs: (() => void)[] = [];

  static async create(world: World) {
    const s = world.scene;
    const [fire, smoke, flame, spark, scorch] = await Promise.all(
      ["fx/fire_sheet", "fx/smoke_sheet", "fx/flame", "fx/spark", "fx/scorch"].map((id) => loadKTX2(id, s, { wrap: false })),
    );
    return new FireFx(world, { fire, smoke, flame, spark, scorch });
  }

  private constructor(
    private world: World,
    private tex: Record<"fire" | "smoke" | "flame" | "spark" | "scorch", Texture>,
  ) {
    const s = world.scene;
    this.scorchMat = new StandardMaterial("scorch", s);
    this.scorchMat.diffuseTexture = tex.scorch;
    this.scorchMat.diffuseTexture.hasAlpha = true;
    this.scorchMat.useAlphaFromDiffuseTexture = true;
    this.scorchMat.diffuseColor = new Color3(0.05, 0.04, 0.035);
    this.scorchMat.specularColor = Color3.Black();
    this.scorchMat.zOffset = -2;
    this.scorchMat.backFaceCulling = false;
    this.ballMat = new StandardMaterial("fireball", s);
    this.ballMat.disableLighting = true;
    this.ballMat.emissiveColor = new Color3(1, 0.62, 0.25);
    // a few flickering lights shared by the biggest fires
    for (let i = 0; i < 2; i++) {
      const l = new PointLight(`firelight${i}`, new Vector3(0, -100, 0), s);
      l.diffuse = new Color3(1, 0.55, 0.22);
      l.specular = Color3.Black();
      l.intensity = 0;
      l.range = 18;
      this.lights.push(l);
    }
    let t = 0;
    this.offs.push(
      world.onUpdate((dt) => {
        t += dt;
        // particles advance on game time (pause, debug time scale)
        const k = world.scene.animationTimeScale;
        for (const ps of this.systems) ps.updateSpeed = k / 60;
        this.lights.forEach((l, i) => {
          if (l.position.y < -50) return;
          l.intensity = 9 + Math.sin(t * 13 + i * 2) * 1.6 + Math.sin(t * 29 + i) * 1.1;
        });
      }),
    );
  }

  private system(name: string, capacity: number, sheet: boolean) {
    const ps = new ParticleSystem(name, capacity, this.world.scene, null, sheet);
    ps.updateSpeed = 1 / 60;
    this.systems.add(ps);
    return ps;
  }

  private release(ps: ParticleSystem) {
    this.systems.delete(ps);
    ps.dispose(false);
  }

  /** Fire sheet particles (animated 8x8 sprite sheet), additive. */
  private flames(ps: ParticleSystem, size: number) {
    ps.particleTexture = this.tex.fire;
    ps.spriteCellWidth = 128;
    ps.spriteCellHeight = 128;
    ps.startSpriteCellID = 0;
    ps.endSpriteCellID = 63;
    ps.spriteCellChangeSpeed = 1.6;
    ps.spriteRandomStartCell = true;
    ps.blendMode = ParticleSystem.BLENDMODE_ADD;
    ps.color1 = new Color4(1, 0.75, 0.5, 1);
    ps.color2 = new Color4(1, 0.55, 0.3, 1);
    ps.colorDead = new Color4(0.4, 0.1, 0, 0);
    ps.minSize = size * 0.7;
    ps.maxSize = size * 1.2;
    ps.minInitialRotation = -0.3;
    ps.maxInitialRotation = 0.3;
  }

  private smokeOf(ps: ParticleSystem, size: number, dark = 0.18) {
    ps.particleTexture = this.tex.smoke;
    ps.spriteCellWidth = 128;
    ps.spriteCellHeight = 128;
    ps.startSpriteCellID = 0;
    ps.endSpriteCellID = 63;
    ps.spriteCellChangeSpeed = 0.5;
    ps.spriteRandomStartCell = true;
    ps.blendMode = ParticleSystem.BLENDMODE_STANDARD;
    ps.color1 = new Color4(dark, dark, dark, 0.55);
    ps.color2 = new Color4(dark * 1.4, dark * 1.3, dark * 1.2, 0.4);
    ps.colorDead = new Color4(dark, dark, dark, 0);
    ps.minSize = size;
    ps.maxSize = size * 1.8;
    ps.addSizeGradient(0, size * 0.6);
    ps.addSizeGradient(1, size * 2.2);
    ps.minInitialRotation = 0;
    ps.maxInitialRotation = Math.PI * 2;
    ps.minAngularSpeed = -0.4;
    ps.maxAngularSpeed = 0.4;
  }

  /** A burning spot (roof, rubble, a hit) with a smoke column; `light` borrows one of the flicker lights. */
  fire(pos: Vector3, scale = 1, o: { smoke?: boolean; light?: boolean; sound?: boolean } = {}): FireHandle {
    const p = pos.clone();
    const f = this.system("fire", Math.round(50 * scale) + 10, true);
    this.flames(f, 1.5 * scale);
    // tongues of flame rising from a disc, shrinking as they climb
    f.particleEmitterType = new CylinderParticleEmitter(0.75 * scale, 0.1, 1, 0.35);
    f.emitter = p.add(new Vector3(0, 0.35 * scale, 0));
    f.minLifeTime = 0.55;
    f.maxLifeTime = 1.15;
    f.emitRate = 34 * scale;
    f.minEmitPower = 0.8 * scale;
    f.maxEmitPower = 2.2 * scale;
    f.gravity = new Vector3(0, 2.6 * scale, 0);
    f.addSizeGradient(0, 1.3 * scale);
    f.addSizeGradient(0.6, 1.0 * scale);
    f.addSizeGradient(1, 0.35 * scale);
    f.start();
    let sm: ParticleSystem | null = null;
    if (o.smoke !== false) {
      sm = this.system("smoke", Math.round(30 * scale) + 8, true);
      this.smokeOf(sm, 2.4 * scale);
      const se = new SphereParticleEmitter(0.6 * scale, 0.5);
      sm.particleEmitterType = se;
      sm.emitter = p.add(new Vector3(0, 1.4 * scale, 0));
      sm.minLifeTime = 3.5;
      sm.maxLifeTime = 6;
      sm.emitRate = 6 * scale;
      sm.minEmitPower = 0.8;
      sm.maxEmitPower = 1.6;
      sm.gravity = new Vector3(0.6, 1.4, 0.2);
      sm.start();
    }
    let light: PointLight | null = null;
    if (o.light) {
      light = this.lights.find((l) => l.position.y < -50) ?? null;
      light?.position.copyFrom(p.add(new Vector3(0, 1.2, 0)));
    }
    let snd: { stop(): void } | null = null;
    if (o.sound !== false) void this.world.loopEmitter("audio/burning", () => p, 0.5 * Math.min(1.5, scale)).then((h) => (snd = h));
    const h: FireHandle = {
      pos: p,
      stop: () => {
        f.stop();
        sm?.stop();
        snd?.stop();
        if (light) {
          light.position.y = -100;
          light.intensity = 0;
        }
        setTimeout(() => {
          this.release(f);
          if (sm) this.release(sm);
        }, 6000);
        this.fires = this.fires.filter((x) => x !== h);
      },
    };
    this.fires.push(h);
    return h;
  }

  /** Ground scorch decal. */
  scorch(x: number, z: number, size = 4) {
    const m = CreateGround("scorch", { width: size, height: size }, this.world.scene);
    m.position.set(x, this.world.heightAt(x, z) + 0.06, z);
    m.rotation.y = Math.random() * Math.PI * 2;
    m.material = this.scorchMat;
    m.isPickable = false;
    m.receiveShadows = true;
    this.meshes.push(m);
    return m;
  }

  /** One-shot burst (impact, explosion). */
  burst(pos: Vector3, scale = 1) {
    const f = this.system("burst", 60, true);
    this.flames(f, 2.6 * scale);
    f.particleEmitterType = new SphereParticleEmitter(0.6 * scale, 1);
    f.emitter = pos.clone();
    f.minLifeTime = 0.4;
    f.maxLifeTime = 0.9;
    f.manualEmitCount = Math.round(40 * scale);
    f.minEmitPower = 4 * scale;
    f.maxEmitPower = 9 * scale;
    f.gravity = new Vector3(0, 3, 0);
    f.targetStopDuration = 1.2;
    f.disposeOnStop = true;
    f.start();
    const sp = this.system("sparks", 80, false);
    sp.particleTexture = this.tex.spark;
    sp.blendMode = ParticleSystem.BLENDMODE_ADD;
    sp.particleEmitterType = new SphereParticleEmitter(0.4, 1);
    sp.emitter = pos.clone();
    sp.color1 = new Color4(1, 0.8, 0.4, 1);
    sp.color2 = new Color4(1, 0.5, 0.2, 1);
    sp.colorDead = new Color4(1, 0.2, 0, 0);
    sp.minSize = 0.08;
    sp.maxSize = 0.22;
    sp.minLifeTime = 0.8;
    sp.maxLifeTime = 1.8;
    sp.manualEmitCount = Math.round(60 * scale);
    sp.minEmitPower = 6;
    sp.maxEmitPower = 14;
    sp.gravity = new Vector3(0, -9.8, 0);
    sp.targetStopDuration = 2;
    sp.disposeOnStop = true;
    sp.start();
    const sm = this.system("burstSmoke", 30, true);
    this.smokeOf(sm, 3 * scale, 0.12);
    sm.particleEmitterType = new SphereParticleEmitter(1.2 * scale, 1);
    sm.emitter = pos.clone();
    sm.minLifeTime = 2.5;
    sm.maxLifeTime = 4.5;
    sm.manualEmitCount = Math.round(18 * scale);
    sm.minEmitPower = 1;
    sm.maxEmitPower = 3;
    sm.gravity = new Vector3(0, 1.2, 0);
    sm.targetStopDuration = 5;
    sm.disposeOnStop = true;
    sm.start();
    for (const ps of [f, sp, sm]) ps.onDisposeObservable.addOnce(() => this.systems.delete(ps));
  }

  /**
   * A fireball falling from the sky onto (x, z): trail, impact burst, scorch, a short fire, sound and a
   * shake that falls off with the camera's distance. Resolves at impact with the impact point.
   */
  fireball(from: Vector3, x: number, z: number, speed = 38, o: { linger?: number } = {}) {
    return this.fireballTo(from, new Vector3(x, this.world.heightAt(x, z) + 0.3, z), speed, o);
  }

  /** A fireball between two points (e.g. from the dragon's mouth into a wall). */
  fireballTo(from: Vector3, to: Vector3, speed = 38, o: { linger?: number; scorch?: boolean } = {}) {
    const w = this.world;
    const ball = CreateSphere("fireball", { diameter: 0.9, segments: 8 }, w.scene);
    ball.material = this.ballMat;
    ball.isPickable = false;
    ball.position.copyFrom(from);
    const trail = this.system("trail", 120, true);
    this.flames(trail, 1.8);
    trail.particleEmitterType = new SphereParticleEmitter(0.4, 1);
    trail.emitter = ball;
    trail.minLifeTime = 0.25;
    trail.maxLifeTime = 0.6;
    trail.emitRate = 120;
    trail.minEmitPower = 0.2;
    trail.maxEmitPower = 0.8;
    trail.start();
    const smoke = this.system("trailSmoke", 80, true);
    this.smokeOf(smoke, 1.6, 0.1);
    smoke.particleEmitterType = new SphereParticleEmitter(0.3, 1);
    smoke.emitter = ball;
    smoke.minLifeTime = 1.2;
    smoke.maxLifeTime = 2.2;
    smoke.emitRate = 30;
    smoke.start();
    const dist = Vector3.Distance(from, to);
    let t = 0;
    return new Promise<Vector3>((resolve) => {
      const off = w.onUpdate((dt) => {
        t += dt;
        const k = Math.min(1, (t * speed) / dist);
        Vector3.LerpToRef(from, to, k, ball.position);
        if (k >= 1) {
          off();
          trail.stop();
          smoke.stop();
          ball.dispose();
          setTimeout(() => {
            this.release(trail);
            this.release(smoke);
          }, 2500);
          this.impact(to, o.linger ?? 8, 1, o.scorch !== false);
          resolve(to);
        }
      });
      this.offs.push(off);
    });
  }

  /** Explosion at a point: burst, scorch, lingering fire, sound, camera shake by distance. */
  impact(at: Vector3, linger = 8, scale = 1, scorch = true) {
    const w = this.world;
    this.burst(at, scale);
    if (scorch) this.scorch(at.x, at.z, 3.5 * scale + Math.random());
    const d = Vector3.Distance(at, w.rig.position);
    w.rig.shake(Math.min(0.03, 0.35 / Math.max(4, d)) * scale, 0.7);
    void audio.playOneShot(Math.random() < 0.5 ? "audio/collapse_small" : "audio/rubble", 1.1 * scale, at, "sfx", 0.8 + Math.random() * 0.3, 14);
    if (linger > 0) {
      const f = this.fire(at, 0.6 * scale, { sound: false });
      setTimeout(() => f.stop(), linger * 1000);
    }
  }

  /**
   * Dragon fire breath: a dense cone of flame from `source()` (mouth position + direction), for
   * `seconds`. Resolves when the stream stops.
   */
  breath(source: () => { pos: Vector3; dir: Vector3 }, seconds = 2.5) {
    const w = this.world;
    const ps = this.system("breath", 600, true);
    this.flames(ps, 2.2);
    ps.particleEmitterType = new ConeParticleEmitter(0.6, 0.22);
    const em = source().pos.clone();
    ps.emitter = em;
    ps.minLifeTime = 0.6;
    ps.maxLifeTime = 1.1;
    ps.emitRate = 420;
    ps.minEmitPower = 16;
    ps.maxEmitPower = 24;
    ps.addSizeGradient(0, 0.6);
    ps.addSizeGradient(1, 4.2);
    ps.gravity = new Vector3(0, 1.5, 0);
    ps.start();
    // aim the stream every frame from the mouth along the head's direction
    let cur = source();
    ps.startDirectionFunction = (_wm, out) => {
      const r = 0.16, d = cur.dir;
      out.set(d.x + (Math.random() - 0.5) * r, d.y + (Math.random() - 0.5) * r, d.z + (Math.random() - 0.5) * r);
    };
    ps.startPositionFunction = (_wm, out) => {
      out.copyFrom(cur.pos);
    };
    const snd = w.loopEmitter("audio/fire_loop", () => cur.pos, 1.2);
    void audio.playOneShot("audio/breath", 1.2, cur.pos, "sfx", 1, 20);
    let t = 0;
    return new Promise<void>((resolve) => {
      const off = w.onUpdate((dt) => {
        t += dt;
        cur = source();
        cur.dir.normalize();
        em.copyFrom(cur.pos);
        if (t < seconds) return;
        off();
        ps.stop();
        void snd.then((h) => h?.stop());
        setTimeout(() => this.release(ps), 1500);
        resolve();
      });
      this.offs.push(off);
    });
  }

  dispose() {
    for (const o of this.offs) o();
    for (const f of [...this.fires]) f.stop();
    for (const ps of this.systems) ps.dispose(false);
    this.systems.clear();
    for (const m of this.meshes) m.dispose();
    for (const l of this.lights) l.dispose();
    this.scorchMat.dispose();
    this.ballMat.dispose();
    for (const t of Object.values(this.tex)) t.dispose();
  }
}
