import { Dragon } from "./dragon";
import { Scene } from "@babylonjs/core/scene";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { AssetContainer } from "@babylonjs/core/assetContainer";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial";
import type { Node } from "@babylonjs/core/node";
import type { AbstractEngine } from "@babylonjs/core/Engines/abstractEngine";
import { loadGLB, loadJSON, loadKTX2, nextFrame } from "../game/loaders";
import { assets } from "../core/assets/AssetClient";
import { audio } from "../core/audio";
import type { Quality } from "../core/settings";
import { Route } from "../world/route";
import { createEnvironment, type Environment } from "../world/environment";
import { createTerrainMaterial, LAYERS, swayShadows, WindPlugin, type TerrainSplatPlugin } from "../world/materials";
import { InstancedSet, prepareForInstancing, type LodLevel } from "../world/instancing";
import { CharacterFactory, type Character, type CharacterSpec } from "../world/characters";
import { CameraRig } from "./camera";
import type { Physics } from "../physics/Physics";
import { LightPool } from "../engine/world/LightPool";
import { enforceLightBudget } from "../engine/render/lightBudget";
import type { Disposer } from "../engine/core/types";
import { RootMotionLibrary } from "../engine/anim/rootMotion";

interface ScatterHeader {
  types: { name: string; count: number; offset: number }[];
}

/**
 * A part of the outdoor world owned elsewhere (the town, its fires), hidden and shown with the
 * terrain. `keep`: the keep building stays (the player is on its ground floor).
 */
export interface OutdoorPart {
  setOutdoorVisible(on: boolean, o: { keep: boolean }): void;
}

export function meshesUnder(container: AssetContainer, nodeName?: string): Mesh[] {
  return container.meshes.filter((m) => {
    if (!m.getTotalVertices()) return false;
    if (!nodeName) return true;
    let n: Node | null = m;
    while (n) {
      if (n.name === nodeName) return true;
      n = n.parent;
    }
    return false;
  }) as Mesh[];
}

/**
 * Everything that persists across the prologue's chapters: the scene, lighting, terrain, scattered
 * vegetation, the character factory and a registry of named NPCs. Chapters add their own content.
 */
export class World {
  scene: Scene;
  rig: CameraRig;
  route!: Route;
  env!: Environment;
  /**
   * The light pool: 3 point lights that exist from boot (with the sun and the sky fill the scene
   * always has exactly 5 lights) shared by every fire, brazier and torch. Created with the environment.
   */
  lights!: LightPool;
  factory!: CharacterFactory;
  /**
   * Root-motion curves of the attack clips (`chars/anim_rootmotion`); empty until
   * {@link ensureCombat} has loaded them, and when the sidecar is missing (attacks then play in place).
   */
  rootMotion = new RootMotionLibrary();
  npcs = new Map<string, Character>();
  private terrainPlugin!: TerrainSplatPlugin;
  private sets: { set: InstancedSet; kind: string }[] = [];
  private heightfield!: { n: number; x0: number; z0: number; step: number; h: Float32Array };
  private scatter!: { header: ScatterHeader; data: Float32Array };
  private emitters: { panner: PannerNode; pos: () => Vector3 }[] = [];
  private updaters = new Set<(dt: number) => void>();
  private terrainMeshes: AbstractMesh[] = [];
  private outdoorParts = new Set<OutdoorPart>();
  private outdoor = { on: true, keep: false };
  private offBudget: Disposer;
  disposed = false;
  physics: Physics | null = null;
  /** seconds of world time (pauses with the game) */
  time = 0;

  constructor(engine: AbstractEngine) {
    const scene = new Scene(engine);
    scene.useRightHandedSystem = true;
    scene.skipPointerMovePicking = true;
    scene.constantlyUpdateMeshUnderPointer = false;
    this.scene = scene;
    // every lit material compiles for the fixed light set (sun, fill, pool) from the start
    this.offBudget = enforceLightBudget(scene);
    this.rig = new CameraRig(scene);
  }

  async init(lap: (what: string) => void) {
    const scene = this.scene;
    const [route, env, terrain, fir, scatterBuf, bodyC, animC, rocksA, ferns, hfBuf] = await Promise.all([
      loadJSON<{ x: number[]; y: number[]; z: number[] }>("cart/route"),
      // the pool lights right after the sun and the fill, before any mesh is in the scene: nothing
      // ever compiles for another light count
      createEnvironment(scene, this.rig.camera).then((env) => {
        this.lights = new LightPool(scene, { name: "pool" });
        return env;
      }),
      loadGLB("cart/terrain", scene),
      loadGLB("cart/fir", scene),
      assets.get("cart/scatter"),
      loadGLB("chars/male", scene),
      loadGLB("chars/anim_base", scene),
      loadGLB("ph/rock_moss_set_01", scene),
      loadGLB("ph/fern_02", scene),
      assets.get("cart/heightfield"),
    ]);
    lap("assets loaded");
    this.route = new Route(route);
    this.env = env;
    this.parseHeightfield(hfBuf);
    this.parseScatter(scatterBuf);
    await nextFrame();
    await this.setupTerrain(terrain);
    lap("terrain");
    await nextFrame();
    this.setupTrees(fir);
    this.addScatter(rocksA, (k) => `rock_moss_set_01_rock0${k + 1}`, ["rockA0", "rockA1", "rockA2", "rockA3", "rockA4", "rockA5"], 140, false);
    this.addScatter(ferns, (k) => `fern_02_${"abcd"[k]}`, ["fern0", "fern1", "fern2", "fern3"], 55, true);
    await nextFrame();
    lap("vegetation");
    this.factory = new CharacterFactory(scene, bodyC, [animC]);

    // Scenery that streams in later; instances near the camera stay hidden until it moves away.
    this.streamScatter("ph/boulder_01", undefined, ["boulder"], 220);
    this.streamScatter("ph/rock_moss_set_02", (k) => `rock_moss_set_02_rock${String(k + 7).padStart(2, "0")}`, ["rockB0", "rockB1", "rockB2", "rockB3", "rockB4", "rockB5", "rockB6"], 140);
    this.streamScatter("ph/tree_stump_01", undefined, ["stump"], 120);
    this.streamScatter("ph/dead_tree_trunk", undefined, ["log"], 120);
    this.streamScatter("ph/mountainside", undefined, ["cliff"], 900);
    this.streamScatter("ph/rock_face_01", undefined, ["rockface"], 600);
    this.watchNpcs();
  }

  /**
   * A bare world for sandboxes (`?debug&arena`): sky, sun, shadows, the light pool and the
   * character factory over flat ground at y 0 (`heightAt` is 0 everywhere); no terrain,
   * vegetation, route or town. The owner adds its own floor and colliders.
   */
  async initBare() {
    const scene = this.scene;
    const [env, bodyC, animC] = await Promise.all([
      createEnvironment(scene, this.rig.camera).then((env) => {
        this.lights = new LightPool(scene, { name: "pool" });
        return env;
      }),
      loadGLB("chars/male", scene),
      loadGLB("chars/anim_base", scene),
    ]);
    this.env = env;
    this.heightfield = { n: 2, x0: -4096, z0: -4096, step: 8192, h: new Float32Array(4) };
    this.factory = new CharacterFactory(scene, bodyC, [animC]);
    this.watchNpcs();
  }

  /** Named NPCs' per-frame pose fix-ups (fingers, look-at) after the animations. */
  private watchNpcs() {
    this.scene.onBeforeRenderObservable.add(() => {
      const dt = this.scene.getEngine().getDeltaTime() / 1000;
      for (const c of this.npcs.values()) c.postAnimate(dt);
    });
  }

  // ------------------------------------------------------------------ queries

  private parseHeightfield(buf: ArrayBuffer) {
    const dv = new DataView(buf);
    const n = dv.getUint32(0, true);
    this.heightfield = { n, x0: dv.getFloat32(4, true), z0: dv.getFloat32(8, true), step: dv.getFloat32(12, true), h: new Float32Array(buf, 16, n * n) };
  }

  /** Terrain height (bilinear over the 4 m gameplay height field). */
  heightAt(x: number, z: number) {
    const hf = this.heightfield;
    const fx = (x - hf.x0) / hf.step, fz = (z - hf.z0) / hf.step;
    const i = Math.max(0, Math.min(hf.n - 2, Math.floor(fx))), j = Math.max(0, Math.min(hf.n - 2, Math.floor(fz)));
    const u = Math.min(1, Math.max(0, fx - i)), v = Math.min(1, Math.max(0, fz - j));
    const h = hf.h, n = hf.n;
    return (h[j * n + i] * (1 - u) + h[j * n + i + 1] * u) * (1 - v) + (h[(j + 1) * n + i] * (1 - u) + h[(j + 1) * n + i + 1] * u) * v;
  }

  get heightField() {
    return this.heightfield;
  }

  private parseScatter(buf: ArrayBuffer) {
    const dv = new DataView(buf);
    const len = dv.getUint32(0, true);
    const header = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 4, len))) as ScatterHeader;
    const start = 4 + len + ((4 - ((4 + len) % 4)) % 4);
    this.scatter = { header, data: new Float32Array(buf, start) };
  }

  private scatterData(type: string) {
    const t = this.scatter.header.types.find((x) => x.name === type);
    if (!t) return new Float32Array(0);
    return this.scatter.data.subarray(t.offset, t.offset + t.count * 5);
  }

  // ------------------------------------------------------------------ terrain + vegetation

  private async setupTerrain(c: AssetContainer) {
    const { material, plugin } = createTerrainMaterial(this.scene);
    this.terrainPlugin = plugin;
    const tex = await Promise.all(LAYERS.flatMap((l) => [loadKTX2(`cart/tex/terrain_${l}_d`, this.scene), loadKTX2(`cart/tex/terrain_${l}_n`, this.scene)]));
    LAYERS.forEach((l, i) => {
      plugin.diffuse[l] = tex[i * 2];
      plugin.normal[l] = tex[i * 2 + 1];
    });
    c.addAllToScene();
    for (const m of c.meshes) {
      if (!m.getTotalVertices()) continue;
      m.material = material;
      m.useVertexColors = false;
      m.hasVertexAlpha = false;
      m.receiveShadows = true;
      m.isPickable = false;
      m.computeWorldMatrix(true);
      m.freezeWorldMatrix();
      this.terrainMeshes.push(m);
    }
    for (const mat of c.materials) if (mat !== material) mat.dispose();
  }

  private setupTrees(c: AssetContainer) {
    c.addAllToScene();
    const heights = [17, 21, 14];
    const impostor = meshesUnder(c, "fir_impostor").map((m) => prepareForInstancing(m));
    for (const mat of c.materials) {
      if (!(mat instanceof PBRMaterial)) continue;
      if (mat.name === "needles" || mat.name === "fir_impostor") {
        const w = new WindPlugin(mat);
        w.amplitude = mat.name === "needles" ? 0.18 : 0.05;
        mat.twoSidedLighting = true;
        mat.environmentIntensity = 0.8;
      }
      if (mat.name === "needles") {
        mat.albedoColor.set(0.82, 0.86, 0.78);
        // LOD0 needles cast shadows: sway them in the shadow pass too
        swayShadows(mat);
      }
    }
    for (let v = 0; v < 3; v++) {
      const lod0 = meshesUnder(c, `fir${v}_lod0`).map((m) => prepareForInstancing(m));
      const lod1 = meshesUnder(c, `fir${v}_lod1`).map((m) => prepareForInstancing(m));
      // impostors are shared across variants: give each variant its own clone so instance buffers differ
      const imp = v === 0 ? impostor : impostor.map((m) => m.clone(`${m.name}_${v}`, null, true) as Mesh);
      const lods: LodLevel[] = [
        { meshes: lod0, maxDistance: 70 },
        { meshes: lod1, maxDistance: 180 },
        { meshes: imp, maxDistance: 1100, scale: heights[v] },
      ];
      const set = new InstancedSet(this.scatterData(`fir${v}`), lods, { tilt: 0.03 });
      this.sets.push({ set, kind: "tree" });
      lod0.forEach((m) => this.env.addShadowCaster(m));
      [...lod0, ...lod1, ...imp].forEach((m) => {
        m.receiveShadows = true;
        m.isPickable = false;
      });
    }
  }

  /** Add a scatter type from a loaded container (one InstancedSet per source mesh/type); returns the new sets. */
  private addScatter(c: AssetContainer, nodeFor: ((k: number) => string) | undefined, types: string[], maxDist: number, foliage: boolean, reveal = 0) {
    const added: InstancedSet[] = [];
    c.addAllToScene();
    for (const mat of c.materials) {
      if (foliage && mat instanceof PBRMaterial) {
        new WindPlugin(mat).amplitude = 0.9;
        mat.twoSidedLighting = true;
      }
    }
    types.forEach((type, k) => {
      const name = nodeFor?.(k);
      // a kit piece is drawn around its own origin, not at its layout offset in the source file
      const piece = name === undefined ? undefined : [...c.transformNodes, ...c.meshes].find((n) => n.name === name);
      piece?.computeWorldMatrix(true);
      const origin = piece?.getAbsolutePosition().clone();
      const meshes = meshesUnder(c, name).map((m) => prepareForInstancing(m, origin));
      if (!meshes.length) return;
      const set = new InstancedSet(this.scatterData(type), [{ meshes, maxDistance: maxDist }], { revealDistance: reveal });
      this.sets.push({ set, kind: foliage ? "foliage" : "rock" });
      added.push(set);
      // streamed in while the outdoor world is hidden: stays hidden with it
      if (!this.outdoor.on) set.setEnabled(false);
      for (const m of meshes) {
        m.receiveShadows = true;
        m.isPickable = false;
      }
      if (!foliage && maxDist < 300) meshes.forEach((m) => this.env.addShadowCaster(m));
    });
    for (const n of c.transformNodes) if (!n.getChildMeshes().length) n.dispose();
    return added;
  }

  private streamScatter(id: string, nodeFor: ((k: number) => string) | undefined, types: string[], maxDist: number) {
    void loadGLB(id, this.scene)
      .then(async (c) => {
        if (this.disposed) return c.dispose();
        await nextFrame();
        const sets = this.addScatter(c, nodeFor, types, maxDist, false, 70);
        // compiled as drawn (thin-instanced, with their shadow pass) before any instance shows
        await Promise.all(sets.map((s) => s.precompile(this.env.shadows)));
        if (this.disposed) return;
        this.updateSets(true);
      })
      .catch((e) => console.warn("stream failed", id, e));
  }

  updateSets(force: boolean) {
    const p = this.rig.position;
    for (const { set } of this.sets) set.update(p, force);
  }

  /**
   * Compile the scatter sets' shaders as they draw (thin-instanced, with shadows), LODs with no
   * instances yet included: once the stage is loaded no LOD compiles when it first gets instances.
   */
  precompileSets() {
    return Promise.all(this.sets.map(({ set }) => set.precompile(this.env.shadows)));
  }

  // ------------------------------------------------------------------ outdoor visibility

  /** False while the outdoor world is hidden (underground). */
  get outdoorVisible() {
    return this.outdoor.on;
  }

  /**
   * Show or hide the outdoor world: terrain, scattered vegetation and rocks, the sky dome and every
   * registered {@link OutdoorPart} (the town, its fires). `keep`: while hidden, the keep building
   * stays (the ground floor's walls and gate are its walls). Toggling never recompiles a shader.
   */
  setOutdoorVisible(on: boolean, o: { keep?: boolean } = {}) {
    const keep = !on && !!o.keep;
    if (this.outdoor.on === on && this.outdoor.keep === keep) return;
    this.outdoor = { on, keep };
    for (const m of this.terrainMeshes) m.setEnabled(on);
    for (const { set } of this.sets) set.setEnabled(on);
    this.env?.sky.setEnabled(on);
    for (const p of this.outdoorParts) p.setOutdoorVisible(on, { keep });
    if (on) this.updateSets(true);
  }

  /** Hide and show `part` with the outdoor world (it is told the current state at once when hidden). */
  addOutdoorPart(part: OutdoorPart): Disposer {
    this.outdoorParts.add(part);
    if (!this.outdoor.on) part.setOutdoorVisible(false, { keep: this.outdoor.keep });
    return () => {
      this.outdoorParts.delete(part);
    };
  }

  // ------------------------------------------------------------------ NPCs

  private femaleP: Promise<void> | null = null;
  /** Load the female body (muster segment) once; a failed load is retried on the next call. */
  ensureFemale() {
    this.femaleP ??= loadGLB("chars/female", this.scene)
      .then((c) => {
        this.factory.female = c;
      })
      .catch((e) => {
        this.femaleP = null;
        throw e;
      });
    return this.femaleP;
  }

  private combatP: Promise<RootMotionLibrary> | null = null;
  private combatHave = { clips: false, motion: false };
  /**
   * The combat clip set (`chars/anim_combat`, keep segment: draw/sheathe, sword chains, hits,
   * chest, potion, lever...) and its root-motion sidecar, loaded once. An asset the build does not
   * ship is skipped with a warning (its clips are missing, attacks play in place); a failed load is
   * tried again by the next call. Resolves with {@link rootMotion}.
   */
  ensureCombat(): Promise<RootMotionLibrary> {
    this.combatP ??= (async () => {
      let failed = false;
      const load = async <T>(id: string, have: boolean, get: () => Promise<T>): Promise<T | null> => {
        if (have) return null;
        if (!assets.has(id)) {
          console.warn(`combat: ${id} is not in this build`);
          return null;
        }
        try {
          return await get();
        } catch (e) {
          console.warn(`combat: ${id} failed to load`, e);
          failed = true;
          return null;
        }
      };
      const [clips, motion] = await Promise.all([
        load("chars/anim_combat", this.combatHave.clips, () => loadGLB("chars/anim_combat", this.scene)),
        load("chars/anim_rootmotion", this.combatHave.motion, () => loadJSON<unknown>("chars/anim_rootmotion")),
      ]);
      if (this.disposed) {
        clips?.dispose();
        return this.rootMotion;
      }
      if (clips) {
        this.factory.addClips(clips);
        this.combatHave.clips = true;
      }
      if (motion) {
        this.rootMotion.merge(motion);
        this.combatHave.motion = true;
      }
      if (failed) this.combatP = null;
      return this.rootMotion;
    })();
    return this.combatP;
  }

  private dragonP: Promise<Dragon> | null = null;
  /** The dragon (loaded on first use; its assets stream with the "dragon" segment). A failed load is retried. */
  ensureDragon() {
    this.dragonP ??= Dragon.create(this).catch((e) => {
      this.dragonP = null;
      throw e;
    });
    return this.dragonP;
  }

  /** Get a named NPC, creating it on first use. */
  npc(name: string, spec?: Omit<CharacterSpec, "name">) {
    let c = this.npcs.get(name);
    if (!c) {
      if (!spec) throw new Error(`unknown NPC ${name}`);
      c = this.factory.create({ name, ...spec });
      for (const m of c.meshes) {
        this.env.addShadowCaster(m);
        m.receiveShadows = true;
        m.isPickable = false;
      }
      this.npcs.set(name, c);
    }
    return c;
  }

  removeNpc(name: string) {
    this.npcs.get(name)?.dispose();
    this.npcs.delete(name);
  }

  addShadowCasters(meshes: AbstractMesh[]) {
    for (const m of meshes) {
      this.env.addShadowCaster(m);
      m.receiveShadows = true;
      m.isPickable = false;
    }
  }

  // ------------------------------------------------------------------ audio

  async loopEmitter(id: string, pos: () => Vector3, volume = 1) {
    const p = audio.emitter("sfx");
    if (!p) return null;
    const h = await audio.loopAt(id, p, volume);
    this.emitters.push({ panner: p, pos });
    return { panner: p, ...h, stop: () => {
      h?.src.stop();
      p.disconnect();
      this.emitters = this.emitters.filter((e) => e.panner !== p);
    } };
  }

  // ------------------------------------------------------------------ frame

  onUpdate(fn: (dt: number) => void) {
    this.updaters.add(fn);
    return () => this.updaters.delete(fn);
  }

  update(dt: number) {
    this.time += dt;
    WindPlugin.time += dt;
    this.physics?.update(dt);
    for (const fn of this.updaters) fn(dt);
    this.rig.update(dt);
    this.updateSets(false);
    const cam = this.rig.camera;
    const f = cam.getDirection(new Vector3(0, 0, -1));
    const p = this.rig.position;
    this.lights?.update(dt, p, f);
    this.env?.update(dt, p);
    audio.setListener(p.x, p.y, p.z, f.x, f.y, f.z);
    const ctx = audio.ctx;
    if (ctx)
      for (const e of this.emitters) {
        const q = e.pos();
        e.panner.positionX.setTargetAtTime(q.x, ctx.currentTime, 0.05);
        e.panner.positionY.setTargetAtTime(q.y + 0.5, ctx.currentTime, 0.05);
        e.panner.positionZ.setTargetAtTime(q.z, ctx.currentTime, 0.05);
      }
    assets.setPlayerPosition(p.x, p.z);
  }

  private quality: Quality | null = null;
  applyQuality(q: Quality) {
    // settings changes (every slider tick) re-apply the tier: only a new tier has work to do
    if (!this.env || q === this.quality) return;
    this.quality = q;
    this.env.applyQuality(q);
    // the pool keeps its 3 lights on every tier (no recompiles): low just leaves one dark
    this.lights?.setSlots(q === "low" ? 2 : 3);
    if (this.terrainPlugin) {
      this.terrainPlugin.useNormals = q !== "low";
      this.terrainPlugin.markAllDefinesAsDirty();
    }
    const lod = { low: [45, 120, 700], medium: [60, 150, 900], high: [75, 190, 1100] }[q];
    for (const { set, kind } of this.sets) {
      if (kind === "tree") {
        set.lods[0].maxDistance = lod[0];
        set.lods[1].maxDistance = lod[1];
        set.lods[2].maxDistance = lod[2];
      } else if (kind === "foliage") set.lods[0].maxDistance = q === "low" ? 30 : q === "medium" ? 45 : 60;
    }
    if (this.sets.length) this.updateSets(true);
  }

  dispose() {
    this.disposed = true;
    for (const e of this.emitters) e.panner.disconnect();
    this.emitters = [];
    for (const { set } of this.sets) set.dispose();
    for (const c of this.npcs.values()) c.dispose();
    this.npcs.clear();
    this.outdoorParts.clear();
    this.offBudget();
    this.lights?.dispose();
    this.env?.dispose();
    this.scene.dispose();
  }
}
