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
import { SpriteManager } from "@babylonjs/core/Sprites/spriteManager";
import { Sprite } from "@babylonjs/core/Sprites/sprite";
import "@babylonjs/core/Sprites/spriteSceneComponent";
import { Constants } from "@babylonjs/core/Engines/constants";
import type { Texture } from "@babylonjs/core/Materials/Textures/texture";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import { audio } from "../../core/audio";
import { loadKTX2 } from "../../game/loaders";
import { applyLightBudget } from "../../engine/render/lightBudget";
import { precompile } from "../../engine/render/precompile";
import type { LightClaim } from "../../engine/world/LightPool";
import type { World } from "../World";

export interface FireHandle {
  pos: Vector3;
  /** put the fire out (it dies down over its particles' lifetime) */
  stop(): void;
  /**
   * Hide the fire at once (particles cleared, sound and light released), e.g. while the outdoor
   * world is hidden; `resume` lights it again, already burning.
   */
  pause(): void;
  resume(): void;
  readonly paused: boolean;
}

/** A handle for a fire that does nothing (asked for after dispose). */
const deadFire = (pos: Vector3): FireHandle => ({ pos, stop() {}, pause() {}, resume() {}, paused: false });

/** The light a fire asks the scene's light pool for (`true`: the defaults). */
export interface FireLight {
  /** default 9 for a fire, 4 for a sconce */
  intensity?: number;
  /** metres (default 18 for a fire, 9 for a sconce) */
  range?: number;
  /** linear RGB (default warm orange) */
  color?: readonly [number, number, number];
  /** metres above the fire's base (default 1.2 for a fire, 0.25 for a sconce) */
  height?: number;
  /** wins a pool slot over nearer lower-priority sources (default 0) */
  priority?: number;
}

const FIRE_COLOR = [1, 0.55, 0.22] as const;
const SCONCE_COLOR = [1, 0.6, 0.3] as const;

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
  /** wall-sconce flames: animated sprites from one manager (created on first use or by the warm-up) */
  private sprites: SpriteManager | null = null;
  private sconceFlames = new Set<{ sprite: Sprite; cell: number }>();
  private decalsVisible = true;
  private offs: (() => void)[] = [];
  /** pending after() timers: each forgets itself when it fires */
  private timers = new Set<() => void>();
  /** breaths and fireballs in progress: each ends itself (sound, mesh) when called, e.g. by dispose */
  private active = new Set<() => void>();
  private disposed = false;

  /**
   * Loads the textures and compiles every shader the effects use (particles, scorch decal, fireball,
   * sconce sprites) before resolving, so the first fire never compiles mid-play. FireFx has no lights
   * of its own: `fire(..., {light})` asks the world's light pool (`world.lights`), so the scene's
   * light set never changes. (`o.lights` is accepted for old callers and ignored.)
   */
  static async create(world: World, _o: { lights?: number } = {}) {
    const s = world.scene;
    const [fire, smoke, flame, spark, scorch] = await Promise.all(
      ["fx/fire_sheet", "fx/smoke_sheet", "fx/flame", "fx/spark", "fx/scorch"].map((id) => loadKTX2(id, s, { wrap: false })),
    );
    const fx = new FireFx(world, { fire, smoke, flame, spark, scorch });
    await fx.warm();
    return fx;
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
    applyLightBudget([this.scorchMat, this.ballMat]);
    // particles advance on game time (pause, debug time scale): set on every rendered frame, paused
    // ones included (no world update runs then)
    const ob = s.onBeforeRenderObservable.add(() => {
      const k = s.animationTimeScale;
      for (const ps of this.systems) ps.updateSpeed = k / 60;
    });
    this.offs.push(() => s.onBeforeRenderObservable.remove(ob));
    // sconce flames animate on game time too (24 fps through the 8x8 sheet)
    let t = 0;
    this.offs.push(
      world.onUpdate((dt) => {
        t += dt;
        const f = Math.floor(t * 24);
        for (const fl of this.sconceFlames) fl.sprite.cellIndex = (fl.cell + f) % 64;
      }),
    );
  }

  /**
   * Compile what the effects draw with, behind the caller's loading: the two particle shaders
   * (sprite-sheet and plain), the scorch decal and the fireball, and the sconce sprites. Best effort,
   * capped at a few seconds.
   */
  private async warm() {
    const s = this.world.scene;
    const far = new Vector3(0, -1000, 0);
    const sheet = this.system("warm", 1, true);
    this.flames(sheet, 1);
    sheet.emitter = far;
    const plain = this.system("warm", 1, false);
    plain.particleTexture = this.tex.spark;
    plain.emitter = far;
    const decal = CreateGround("warm_scorch", { width: 1, height: 1 }, s);
    decal.material = this.scorchMat;
    decal.receiveShadows = true;
    const ball = CreateSphere("warm_ball", { diameter: 0.5, segments: 4 }, s);
    ball.material = this.ballMat;
    for (const m of [decal, ball]) {
      m.isPickable = false;
      m.setEnabled(false);
    }
    const sprites = this.spriteManager();
    const end = performance.now() + 4000;
    try {
      const shaders = precompile([decal, ball], { timeout: 4 });
      // (a timer, not a frame: a hidden tab renders no frames)
      while (performance.now() < end && !this.disposed && !(sheet.isReady() && plain.isReady() && sprites.spriteRenderer.isReady()))
        await new Promise((r) => setTimeout(r, 16));
      await shaders;
    } finally {
      this.release(sheet);
      this.release(plain);
      decal.dispose();
      ball.dispose();
    }
  }

  /** The sconce sprites' manager (one for every flame; it shares the fire sheet texture). */
  private spriteManager() {
    if (this.sprites) return this.sprites;
    const m = new SpriteManager("sconces", "", 64, 128, this.world.scene);
    m.texture = this.tex.fire;
    m.blendMode = Constants.ALPHA_ADD;
    m.disableDepthWrite = true;
    m.isPickable = false;
    this.sprites = m;
    return m;
  }

  /** A light from the world's pool for a fire at `p` (null without a pool). */
  private claimLight(p: Vector3, o: FireLight, d: { intensity: number; range: number; height: number; color: readonly [number, number, number]; flicker: number }): LightClaim | null {
    const pool = this.world.lights;
    if (!pool || this.disposed) return null;
    return pool.add({
      at: p.add(new Vector3(0, o.height ?? d.height, 0)),
      color: o.color ?? d.color,
      intensity: o.intensity ?? d.intensity,
      range: o.range ?? d.range,
      flicker: d.flicker,
      priority: o.priority,
    });
  }

  private system(name: string, capacity: number, sheet: boolean) {
    const ps = new ParticleSystem(name, capacity, this.world.scene, null, sheet);
    ps.updateSpeed = 1 / 60;
    this.systems.add(ps);
    return ps;
  }

  /** Dispose a system, never its texture (shared by every system of its kind). */
  private release(ps: ParticleSystem) {
    // already gone (dispose() took it)
    if (!this.systems.delete(ps)) return;
    ps.dispose(false);
  }

  /** Run `fn` after `seconds` of game time (stops with the pause; dropped by dispose). */
  private after(seconds: number, fn: () => void) {
    if (this.disposed) return;
    let t = 0;
    const off = this.world.onUpdate((dt) => {
      t += dt;
      if (t < seconds) return;
      off();
      this.timers.delete(off);
      fn();
    });
    this.timers.add(off);
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

  /**
   * A burning spot (roof, rubble, a hit, a brazier) with a smoke column; `light` makes it a source
   * for the world's light pool (lit while among the nearest in view; see {@link FireLight}).
   * `seconds`: put out by itself after that much game time (on this instance's clock, so a chapter
   * ending meanwhile does not cut it short).
   */
  fire(pos: Vector3, scale = 1, o: { smoke?: boolean; light?: boolean | FireLight; sound?: boolean; seconds?: number } = {}): FireHandle {
    const p = pos.clone();
    // a script left running past the chapter's end: nothing to light
    if (this.disposed) return deadFire(p);
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
    const lightOpts = o.light ? (o.light === true ? {} : o.light) : null;
    const lit = () => (lightOpts ? this.claimLight(p, lightOpts, { intensity: 9, range: 18, height: 1.2, color: FIRE_COLOR, flicker: 0.3 }) : null);
    let light: LightClaim | null = null;
    // the stop handle arrives once the loop has loaded: a fire stopped before then still stops it
    const sound = () => (o.sound !== false ? this.world.loopEmitter("audio/burning", () => p, 0.5 * Math.min(1.5, scale)) : null);
    let snd = sound();
    let paused = false;
    const h: FireHandle = {
      pos: p,
      get paused() {
        return paused;
      },
      stop: () => {
        // stopped already
        if (!this.fires.includes(h)) return;
        this.fires = this.fires.filter((x) => x !== h);
        f.stop();
        sm?.stop();
        void snd?.then((s) => s?.stop());
        snd = null;
        light?.stop();
        light = null;
        this.after(6, () => {
          this.release(f);
          if (sm) this.release(sm);
        });
      },
      pause: () => {
        if (paused || !this.fires.includes(h)) return;
        paused = true;
        for (const ps of [f, sm]) {
          ps?.stop();
          ps?.reset();
        }
        void snd?.then((s) => s?.stop());
        snd = null;
        light?.stop();
        light = null;
      },
      resume: () => {
        if (!paused || !this.fires.includes(h) || this.disposed) return;
        paused = false;
        // back already burning: simulate the flames' and the smoke column's lifetimes first
        for (const [ps, cycles] of [[f, 20], [sm, 60]] as const) {
          if (!ps) continue;
          ps.preWarmStepOffset = 6;
          ps.preWarmCycles = cycles;
          ps.start();
          ps.preWarmCycles = 0;
        }
        snd = sound();
        light = lit();
      },
    };
    this.fires.push(h);
    light = lit();
    if (o.seconds !== undefined) this.after(o.seconds, () => h.stop());
    return h;
  }

  /**
   * A small steady flame (wall sconce, torch head, candle cluster): one animated sprite from a
   * shared manager instead of particle systems, optionally a light-pool source. Cheap enough for a
   * dozen per room. The handle's `stop` removes it; `pause`/`resume` hide and show it.
   */
  sconce(pos: Vector3, o: { size?: number; light?: boolean | FireLight } = {}): FireHandle {
    const p = pos.clone();
    if (this.disposed) return deadFire(p);
    const size = o.size ?? 0.45;
    const sprite = new Sprite("sconce", this.spriteManager());
    sprite.width = size * 0.7;
    sprite.height = size;
    // the sprite is centred: lift it so the flame's foot sits at `pos`
    sprite.position.copyFrom(p).addInPlaceFromFloats(0, size * 0.4, 0);
    sprite.color = new Color4(1, 0.85, 0.65, 1);
    sprite.isPickable = false;
    const flame = { sprite, cell: Math.floor(Math.random() * 64) };
    sprite.cellIndex = flame.cell;
    this.sconceFlames.add(flame);
    const lightOpts = o.light ? (o.light === true ? {} : o.light) : null;
    const lit = () => (lightOpts ? this.claimLight(p, lightOpts, { intensity: 4, range: 9, height: 0.25, color: SCONCE_COLOR, flicker: 0.35 }) : null);
    let light = lit();
    let paused = false, stopped = false;
    const h: FireHandle = {
      pos: p,
      get paused() {
        return paused;
      },
      stop: () => {
        if (stopped) return;
        stopped = true;
        this.sconceFlames.delete(flame);
        sprite.dispose();
        light?.stop();
        light = null;
      },
      pause: () => {
        if (paused || stopped) return;
        paused = true;
        sprite.isVisible = false;
        light?.stop();
        light = null;
      },
      resume: () => {
        if (!paused || stopped || this.disposed) return;
        paused = false;
        sprite.isVisible = true;
        light = lit();
      },
    };
    return h;
  }

  /** Show or hide the scorch decals (they lie on the town's ground: hidden with the outdoor world). */
  setDecalsVisible(on: boolean) {
    if (on === this.decalsVisible) return;
    this.decalsVisible = on;
    for (const m of this.meshes) m.setEnabled(on);
  }

  /** Every fire burning now (paused ones included). */
  get burning(): readonly FireHandle[] {
    return this.fires;
  }

  get isDisposed() {
    return this.disposed;
  }

  /** Ground scorch decal. */
  scorch(x: number, z: number, size = 4) {
    const m = CreateGround("scorch", { width: size, height: size }, this.world.scene);
    m.position.set(x, this.world.heightAt(x, z) + 0.06, z);
    m.rotation.y = Math.random() * Math.PI * 2;
    m.material = this.scorchMat;
    m.isPickable = false;
    m.receiveShadows = true;
    m.setEnabled(this.decalsVisible);
    this.meshes.push(m);
    return m;
  }

  /** One-shot burst (impact, explosion). */
  burst(pos: Vector3, scale = 1) {
    if (this.disposed) return;
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
    sm.start();
    // each ends by targetStopDuration and is released once played out: not with disposeOnStop, which
    // would dispose the shared textures (and every other fire with them), and not from inside the
    // scene's particle loop that reports the end
    for (const ps of [f, sp, sm]) ps.onAnimationEnd = () => this.after(0, () => this.release(ps));
  }

  /**
   * A fireball falling from the sky onto (x, z): trail, impact burst, scorch, a short fire, sound and a
   * shake that falls off with the camera's distance. Resolves at impact with the impact point.
   */
  fireball(from: Vector3, x: number, z: number, speed = 38, o: { linger?: number } = {}) {
    return this.fireballTo(from, new Vector3(x, this.world.heightAt(x, z) + 0.3, z), speed, o);
  }

  /** A fireball between two points (e.g. from the dragon's mouth into a wall). Never resolves once disposed first. */
  fireballTo(from: Vector3, to: Vector3, speed = 38, o: { linger?: number; scorch?: boolean } = {}) {
    const w = this.world;
    if (this.disposed) return new Promise<Vector3>(() => {});
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
      // (also dispose's way to end a ball still in flight)
      const end = () => {
        off();
        this.active.delete(end);
        trail.stop();
        smoke.stop();
        ball.dispose();
      };
      const off = w.onUpdate((dt) => {
        t += dt;
        const k = Math.min(1, (t * speed) / dist);
        Vector3.LerpToRef(from, to, k, ball.position);
        if (k >= 1) {
          end();
          this.after(2.5, () => {
            this.release(trail);
            this.release(smoke);
          });
          this.impact(to, o.linger ?? 8, 1, o.scorch !== false);
          resolve(to);
        }
      });
      this.active.add(end);
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
    if (linger > 0) this.fire(at, 0.6 * scale, { sound: false, seconds: linger });
  }

  /**
   * Dragon fire breath: a dense cone of flame from `source()` (mouth position + direction), for
   * `seconds`. Resolves when the stream stops.
   */
  breath(source: () => { pos: Vector3; dir: Vector3 }, seconds = 2.5) {
    const w = this.world;
    if (this.disposed) return Promise.resolve();
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
      // (also dispose's way to end a stream still burning: its sound loop would play on)
      const end = () => {
        off();
        this.active.delete(end);
        ps.stop();
        void snd.then((h) => h?.stop());
        resolve();
      };
      const off = w.onUpdate((dt) => {
        t += dt;
        cur = source();
        cur.dir.normalize();
        em.copyFrom(cur.pos);
        if (t < seconds) return;
        end();
        this.after(1.5, () => this.release(ps));
      });
      this.active.add(end);
    });
  }

  dispose() {
    this.disposed = true;
    for (const o of this.offs) o();
    for (const off of this.timers) off();
    this.timers.clear();
    for (const end of [...this.active]) end();
    for (const f of [...this.fires]) f.stop();
    for (const ps of this.systems) ps.dispose(false);
    this.systems.clear();
    for (const m of this.meshes) m.dispose();
    for (const f of this.sconceFlames) f.sprite.dispose();
    this.sconceFlames.clear();
    // (the manager disposes the fire sheet with it: disposed below with the other textures anyway)
    this.sprites?.dispose();
    this.sprites = null;
    this.scorchMat.dispose();
    this.ballMat.dispose();
    for (const t of Object.values(this.tex)) t.dispose();
  }
}
