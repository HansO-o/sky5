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
import { createTerrainMaterial, LAYERS, WindPlugin, type TerrainSplatPlugin } from "../world/materials";
import { InstancedSet, prepareForInstancing, type LodLevel } from "../world/instancing";
import { CharacterFactory, type Character, type CharacterSpec } from "../world/characters";
import { CameraRig } from "./camera";

interface ScatterHeader {
  types: { name: string; count: number; offset: number }[];
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
  factory!: CharacterFactory;
  npcs = new Map<string, Character>();
  private terrainPlugin!: TerrainSplatPlugin;
  private sets: { set: InstancedSet; kind: string }[] = [];
  private heightfield!: { n: number; x0: number; z0: number; step: number; h: Float32Array };
  private scatter!: { header: ScatterHeader; data: Float32Array };
  private emitters: { panner: PannerNode; pos: () => Vector3 }[] = [];
  private updaters = new Set<(dt: number) => void>();
  disposed = false;
  /** seconds of world time (pauses with the game) */
  time = 0;

  constructor(engine: AbstractEngine) {
    const scene = new Scene(engine);
    scene.useRightHandedSystem = true;
    scene.skipPointerMovePicking = true;
    scene.constantlyUpdateMeshUnderPointer = false;
    this.scene = scene;
    this.rig = new CameraRig(scene);
  }

  async init(lap: (what: string) => void) {
    const scene = this.scene;
    const [route, env, terrain, fir, scatterBuf, bodyC, animC, rocksA, ferns, hfBuf] = await Promise.all([
      loadJSON<{ x: number[]; y: number[]; z: number[] }>("cart/route"),
      createEnvironment(scene, this.rig.camera),
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

    scene.onBeforeRenderObservable.add(() => {
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
    }
    for (const mat of c.materials) if (mat !== material) mat.dispose();
  }

  private setupTrees(c: AssetContainer) {
    c.addAllToScene();
    const heights = [17, 21, 14];
    const impostor = meshesUnder(c, "fir_impostor").map(prepareForInstancing);
    for (const mat of c.materials) {
      if (!(mat instanceof PBRMaterial)) continue;
      if (mat.name === "needles" || mat.name === "fir_impostor") {
        const w = new WindPlugin(mat);
        w.amplitude = mat.name === "needles" ? 0.18 : 0.05;
        mat.twoSidedLighting = true;
        mat.environmentIntensity = 0.8;
      }
      if (mat.name === "needles") mat.albedoColor.set(0.82, 0.86, 0.78);
    }
    for (let v = 0; v < 3; v++) {
      const lod0 = meshesUnder(c, `fir${v}_lod0`).map(prepareForInstancing);
      const lod1 = meshesUnder(c, `fir${v}_lod1`).map(prepareForInstancing);
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

  /** Add a scatter type from a loaded container (one InstancedSet per source mesh/type). */
  private addScatter(c: AssetContainer, nodeFor: ((k: number) => string) | undefined, types: string[], maxDist: number, foliage: boolean, reveal = 0) {
    c.addAllToScene();
    for (const mat of c.materials) {
      if (foliage && mat instanceof PBRMaterial) {
        new WindPlugin(mat).amplitude = 0.9;
        mat.twoSidedLighting = true;
      }
    }
    types.forEach((type, k) => {
      const meshes = meshesUnder(c, nodeFor ? nodeFor(k) : undefined).map(prepareForInstancing);
      if (!meshes.length) return;
      const set = new InstancedSet(this.scatterData(type), [{ meshes, maxDistance: maxDist }], { revealDistance: reveal });
      this.sets.push({ set, kind: foliage ? "foliage" : "rock" });
      for (const m of meshes) {
        m.receiveShadows = true;
        m.isPickable = false;
      }
      if (!foliage && maxDist < 300) meshes.forEach((m) => this.env.addShadowCaster(m));
    });
    for (const n of c.transformNodes) if (!n.getChildMeshes().length) n.dispose();
  }

  private streamScatter(id: string, nodeFor: ((k: number) => string) | undefined, types: string[], maxDist: number) {
    void loadGLB(id, this.scene)
      .then(async (c) => {
        if (this.disposed) return c.dispose();
        await nextFrame();
        this.addScatter(c, nodeFor, types, maxDist, false, 70);
        for (const m of c.meshes) if (m.material) await m.material.forceCompilationAsync(m).catch(() => {});
        this.updateSets(true);
      })
      .catch((e) => console.warn("stream failed", id, e));
  }

  updateSets(force: boolean) {
    const p = this.rig.position;
    for (const { set } of this.sets) set.update(p, force);
  }

  // ------------------------------------------------------------------ NPCs

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
    for (const fn of this.updaters) fn(dt);
    this.rig.update(dt);
    this.updateSets(false);
    const cam = this.rig.camera;
    const f = cam.getDirection(new Vector3(0, 0, -1));
    const p = this.rig.position;
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

  applyQuality(q: Quality) {
    this.env?.applyQuality(q);
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
    this.env?.dispose();
    this.scene.dispose();
  }
}
