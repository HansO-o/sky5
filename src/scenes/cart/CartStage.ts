import { Scene } from "@babylonjs/core/scene";
import { FreeCamera } from "@babylonjs/core/Cameras/freeCamera";
import { Camera } from "@babylonjs/core/Cameras/camera";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { AssetContainer } from "@babylonjs/core/assetContainer";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial";
import type { Node } from "@babylonjs/core/node";
import type { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import type { Game, Stage } from "../../game/Game";
import { loadGLB, loadJSON, loadKTX2, nextFrame } from "../../game/loaders";
import { assets } from "../../core/assets/AssetClient";
import { audio } from "../../core/audio";
import { input } from "../../core/input";
import { settings, type Quality } from "../../core/settings";
import { hud } from "../../ui/hud";
import { Route } from "../../world/route";
import { createEnvironment, type Environment } from "../../world/environment";
import { createTerrainMaterial, LAYERS, WindPlugin, type TerrainSplatPlugin } from "../../world/materials";
import { InstancedSet, prepareForInstancing, type LodLevel } from "../../world/instancing";
import { CharacterFactory, OUTFITS, type Character } from "../../world/characters";
import { buildTown } from "../../world/town";
import { Wagon } from "./wagon";
import { SCRIPT, SPEAKER_NAMES, lineDuration, type Line, type Speaker } from "./dialogue";

/** The ride starts part-way along the road (the first stretch is scenery behind the camera). */
const START_S = 300;
const CRUISE = 2.9; // m/s
const LEAD_GAP = 22; // metres between the wagons

interface ScatterHeader {
  types: { name: string; count: number; offset: number }[];
}

function meshesUnder(container: AssetContainer, nodeName?: string): Mesh[] {
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

export class CartStage implements Stage {
  scene: Scene;
  segment = "cart" as const;
  gameplay = true;
  private camera: FreeCamera;
  private route!: Route;
  private env!: Environment;
  private terrainPlugin!: TerrainSplatPlugin;
  private sets: { set: InstancedSet; kind: string }[] = [];
  private wagon!: Wagon;
  private lead!: Wagon;
  private npc = new Map<string, Character>();
  private walkers: Character[] = [];
  private factory!: CharacterFactory;
  private s = START_S;
  private speed = 0;
  private time = 0;
  private lineIdx = 0;
  private lineEnd = 0;
  private nextAllowed = 0;
  private speaking: { who: Speaker; until: number } | null = null;
  private headYaw = 0;
  private headPitch = -0.05;
  private finished = false;
  private townState: "none" | "loading" | "ready" = "none";
  private waitingForTown = false;
  private heightfield: { n: number; x0: number; z0: number; step: number; h: Float32Array } | null = null;
  private scatter: { header: ScatterHeader; data: Float32Array } | null = null;
  private emitters: { panner: PannerNode; node: () => Vector3 }[] = [];
  private disposed = false;

  constructor(private game: Game) {
    const scene = new Scene(game.engine);
    scene.useRightHandedSystem = true;
    scene.skipPointerMovePicking = true;
    scene.constantlyUpdateMeshUnderPointer = false;
    this.scene = scene;
    this.camera = new FreeCamera("eye", new Vector3(0, 0, 0), scene);
    this.camera.minZ = 0.06;
    this.camera.maxZ = 4000;
    this.camera.fovMode = Camera.FOVMODE_HORIZONTAL_FIXED;
    this.camera.inertia = 0;
    this.applyFov();
    settings.on(() => this.applyFov());
  }

  private applyFov() {
    this.camera.fov = (settings.value.fov * Math.PI) / 180;
  }

  // ------------------------------------------------------------------ loading

  /** Resume a saved ride (call after init, before the stage becomes active). */
  applyState(state: Record<string, number> | null) {
    this.s = state?.s ?? START_S;
    this.lineIdx = state?.line ?? 0;
    this.time = state?.time ?? 0;
    this.nextAllowed = this.time;
    this.placeConvoy(0);
    this.updateSets(true);
  }

  /** Called when the stage becomes the active one (audio, prompts). */
  begin() {
    this.startAudio();
  }

  async init() {
    const scene = this.scene;
    const T0 = performance.now();
    const lap = (what: string) => console.info(`[timing] cart ${what} +${(performance.now() - T0).toFixed(0)} ms`);

    const [route, env, terrain, fir, scatterBuf, wagonC, horseC, bodyC, animC, rocksA, ferns, hfBuf] = await Promise.all([
      loadJSON<{ x: number[]; y: number[]; z: number[] }>("cart/route"),
      createEnvironment(scene, this.camera),
      loadGLB("cart/terrain", scene),
      loadGLB("cart/fir", scene),
      assets.get("cart/scatter"),
      loadGLB("cart/wagon", scene),
      loadGLB("chars/horse", scene),
      loadGLB("chars/male", scene),
      loadGLB("chars/anim_base", scene),
      loadGLB("ph/rock_moss_set_01", scene),
      loadGLB("ph/fern_02", scene),
      assets.get("cart/heightfield"),
      audio.load("audio/sfx_hooves"),
      audio.load("audio/sfx_cart"),
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
    this.setupConvoy(wagonC, horseC);
    this.streamProps();
    this.placeConvoy(0);

    // Scenery that streams in during the ride; instances near the camera stay hidden until it moves away.
    this.streamScatter("ph/boulder_01", undefined, ["boulder"], 220);
    this.streamScatter("ph/rock_moss_set_02", (k) => `rock_moss_set_02_rock${String(k + 7).padStart(2, "0")}`, ["rockB0", "rockB1", "rockB2", "rockB3", "rockB4", "rockB5", "rockB6"], 140);
    this.streamScatter("ph/tree_stump_01", undefined, ["stump"], 120);
    this.streamScatter("ph/dead_tree_trunk", undefined, ["log"], 120);
    this.streamScatter("ph/mountainside", undefined, ["cliff"], 900);
    this.streamScatter("ph/rock_face_01", undefined, ["rockface"], 600);

    scene.onBeforeRenderObservable.add(() => {
      const dt = this.scene.getEngine().getDeltaTime() / 1000;
      for (const c of this.npc.values()) c.postAnimate(dt);
    });

    lap("convoy");
    this.applyQuality(settings.value.quality);
    this.updateSets(true);
    await scene.whenReadyAsync();
    lap("shaders ready");
    return this;
  }

  private parseHeightfield(buf: ArrayBuffer) {
    const dv = new DataView(buf);
    const n = dv.getUint32(0, true);
    this.heightfield = { n, x0: dv.getFloat32(4, true), z0: dv.getFloat32(8, true), step: dv.getFloat32(12, true), h: new Float32Array(buf, 16, n * n) };
  }

  heightAt(x: number, z: number) {
    const hf = this.heightfield!;
    const fx = (x - hf.x0) / hf.step, fz = (z - hf.z0) / hf.step;
    const i = Math.max(0, Math.min(hf.n - 2, Math.floor(fx))), j = Math.max(0, Math.min(hf.n - 2, Math.floor(fz)));
    const u = Math.min(1, Math.max(0, fx - i)), v = Math.min(1, Math.max(0, fz - j));
    const h = hf.h, n = hf.n;
    return (h[j * n + i] * (1 - u) + h[j * n + i + 1] * u) * (1 - v) + (h[(j + 1) * n + i] * (1 - u) + h[(j + 1) * n + i + 1] * u) * v;
  }

  private parseScatter(buf: ArrayBuffer) {
    const dv = new DataView(buf);
    const len = dv.getUint32(0, true);
    const header = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 4, len))) as ScatterHeader;
    const start = 4 + len + ((4 - ((4 + len) % 4)) % 4);
    this.scatter = { header, data: new Float32Array(buf, start) };
  }

  private scatterData(type: string) {
    const t = this.scatter!.header.types.find((x) => x.name === type);
    if (!t) return new Float32Array(0);
    return this.scatter!.data.subarray(t.offset, t.offset + t.count * 5);
  }

  private async setupTerrain(c: AssetContainer) {
    const { material, plugin } = createTerrainMaterial(this.scene);
    this.terrainPlugin = plugin;
    const tex = await Promise.all(
      LAYERS.flatMap((l) => [loadKTX2(`cart/tex/terrain_${l}_d`, this.scene), loadKTX2(`cart/tex/terrain_${l}_n`, this.scene)]),
    );
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
      if (mat.name === "needles") {
        mat.albedoColor.set(0.82, 0.86, 0.78);
      }
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
    // remove the glTF root/transform nodes left behind
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

  /**
   * Props on the lead wagon (a lantern on the driver's bench, a shield on the side board) stream in
   * during the ride; they are attached only while the lead wagon is out of view.
   */
  private streamProps() {
    void Promise.all([loadGLB("ph/wooden_lantern_01", this.scene), loadGLB("ph/kite_shield", this.scene)])
      .then(([lanternC, shieldC]) => {
        const attach = () => {
          if (this.disposed) return;
          const body = this.lead.seats.get("seat_0")?.parent as TransformNode | undefined;
          const visible = this.lead.meshes.some((m) => m.isEnabled() && this.camera.isInFrustum(m));
          if (!body || visible) {
            setTimeout(attach, 500);
            return;
          }
          const lantern = lanternC.instantiateModelsToScene((n) => n, false);
          for (const r of lantern.rootNodes as TransformNode[]) {
            r.parent = body;
            r.position.set(0.62, 1.68, -1.45);
          }
          const shield = shieldC.instantiateModelsToScene((n) => n, false);
          for (const r of shield.rootNodes as TransformNode[]) {
            r.parent = body;
            r.position.set(0.82, 1.15, 0.6);
            r.rotation.set(0, Math.PI / 2, 0.15);
          }
          for (const r of [...lantern.rootNodes, ...shield.rootNodes]) for (const m of r.getChildMeshes()) this.env.addShadowCaster(m);
        };
        attach();
      })
      .catch((e) => console.warn("props failed", e));
  }

  private setupConvoy(wagonC: AssetContainer, horseC: AssetContainer) {
    this.wagon = new Wagon(this.scene, wagonC, horseC, "playerWagon");
    this.lead = new Wagon(this.scene, wagonC, horseC, "leadWagon");
    for (const w of [this.wagon, this.lead])
      for (const m of w.meshes) {
        this.env.addShadowCaster(m);
        m.receiveShadows = true;
        m.isPickable = false;
      }
    // camera sits on the right rear bench of the player's wagon
    const seat = this.wagon.seats.get("seat_0");
    if (!seat) throw new Error("wagon model has no seat_0 anchor");
    this.camera.parent = seat;
    this.camera.position.set(0, 0.8, -0.08);

    const sit = (wagon: Wagon, seatName: string, ch: Character, clip = "Sitting_Idle_Loop") => {
      const seatNode = wagon.seats.get(seatName)!;
      ch.root.parent = seatNode;
      // character origin at floor level just in front of the bench; glTF characters face +Z
      ch.root.position.set(0, -0.48, -0.18);
      ch.root.rotationQuaternion!.copyFromFloats(0, 1, 0, 0);
      ch.play(clip);
      for (const m of ch.meshes) {
        this.env.addShadowCaster(m);
        m.receiveShadows = true;
        m.isPickable = false;
      }
    };
    const F = this.factory;
    const brun = F.create({ name: "brun", outfit: OUTFITS.rebel, hair: ["hair_simpleparted", "hair_beard"] });
    const rowan = F.create({ name: "rowan", outfit: OUTFITS.peasant, hair: ["hair_buzzed"] });
    const leader = F.create({ name: "leader", outfit: OUTFITS.rebelLeader, hair: ["hair_beard"] });
    const driver = F.create({ name: "driver", outfit: OUTFITS.soldier });
    sit(this.wagon, "seat_1", brun);
    sit(this.wagon, "seat_3", rowan);
    sit(this.wagon, "seat_2", leader);
    leader.headDown = 0.45;
    sit(this.wagon, "driver_seat", driver, "Driving_Loop");
    driver.root.position.set(0, -0.62, 0.05);
    this.npc.set("brun", brun);
    this.npc.set("rowan", rowan);
    this.npc.set("leader", leader);
    this.npc.set("driver", driver);
    // lead wagon: driver and two prisoners
    const ld = F.create({ name: "lead_driver", outfit: OUTFITS.soldier });
    sit(this.lead, "driver_seat", ld, "Driving_Loop");
    ld.root.position.set(0, -0.62, 0.05);
    sit(this.lead, "seat_1", F.create({ name: "p1", outfit: OUTFITS.peasant, hair: ["hair_long"] }));
    sit(this.lead, "seat_0", F.create({ name: "p2", outfit: OUTFITS.rebel, hair: ["hair_buzzed", "hair_beard"] }));
    // two escorts walking beside the lead wagon
    for (let i = 0; i < 2; i++) {
      const w = F.create({ name: `escort${i}`, outfit: OUTFITS.soldier });
      w.play("Walk_Loop", { speed: 1.6 });
      for (const m of w.meshes) {
        this.env.addShadowCaster(m);
        m.isPickable = false;
      }
      this.walkers.push(w);
    }
  }

  private tmp = new Vector3();
  private placeConvoy(dt: number) {
    const r = this.route;
    this.wagon.place(r, this.s, this.speed, dt, this.time);
    this.lead.place(r, this.s + LEAD_GAP, this.speed, dt, this.time);
    this.walkers.forEach((w, i) => {
      const s = this.s + LEAD_GAP + 1 - i * 3;
      const p = r.pos(s, this.tmp);
      const d = r.dir(s);
      const side = i === 0 ? 1.7 : -1.7;
      // perpendicular offset to the left/right of the road
      w.root.position.set(p.x - d.z * side, this.heightAt(p.x - d.z * side, p.z + d.x * side), p.z + d.x * side);
      const yaw = r.yaw(s) + Math.PI;
      w.root.rotationQuaternion!.copyFromFloats(0, Math.sin(yaw / 2), 0, Math.cos(yaw / 2));
      w.play(this.speed > 0.3 ? "Walk_Loop" : "Idle_Loop", { speed: Math.max(0.6, this.speed / 1.8) });
    });
  }

  private startAudio() {
    audio.musicTracks = { calm: "audio/music_cart" };
    void audio.startBed("forest", "audio/amb_forest", 0.7, 4);
    const hooves = audio.emitter("sfx");
    const creak = audio.emitter("sfx");
    if (hooves) {
      void audio.loopAt("audio/sfx_hooves", hooves, 0.55);
      this.emitters.push({ panner: hooves, node: () => this.wagon.horseRoot.position });
    }
    if (creak) {
      void audio.loopAt("audio/sfx_cart", creak, 0.75);
      this.emitters.push({ panner: creak, node: () => this.wagon.root.position });
    }
    // music fades in after the first exchange
    setTimeout(() => !this.disposed && void audio.playMusic("audio/music_cart", { fade: 8, volume: 0.45 }).catch(() => {}), 40000);
  }

  // ------------------------------------------------------------------ per frame

  update(dt: number) {
    this.time += dt;
    WindPlugin.time += dt;
    const remaining = this.route.length - this.s;

    // town assets: request early, wait at a natural stop if they are late
    if (remaining < 520 && this.townState === "none") this.loadTown();
    let target = this.finished ? 0 : CRUISE;
    if (this.time < 3) target = 0;
    if (remaining < 60) target = Math.min(target, 0.6 + remaining * 0.04);
    if (remaining < 2) target = 0;
    if (this.townState !== "ready" && remaining < 260) {
      target = 0; // halt at the checkpoint until the town is ready
      if (!this.waitingForTown) {
        this.waitingForTown = true;
        hud.loading(true, "加载中");
      }
    } else if (this.waitingForTown) {
      this.waitingForTown = false;
      hud.loading(false);
    }
    this.speed += (target - this.speed) * Math.min(1, dt * 0.6);
    this.s = Math.min(this.route.length - 1.2, this.s + this.speed * dt);
    this.placeConvoy(dt);

    this.updateHead(dt);
    hud.prompt(!input.locked && !input.usingPad && this.time > 4 && this.time < 60 ? "点击画面以环顾四周" : null);
    this.updateDialogue(remaining);
    this.updateSets(false);
    this.updateAudio();
    assets.setPlayerPosition(this.wagon.root.position.x, this.wagon.root.position.z);
    audio.setBedRate("forest", 1);

    if (!this.finished && remaining < 3 && this.lineIdx >= SCRIPT.length && this.time > this.lineEnd + 2) this.finish();
  }

  private updateHead(dt: number) {
    const [dx, dy] = input.consumeLook();
    this.headYaw = Math.max(-1.9, Math.min(1.9, this.headYaw - dx));
    this.headPitch = Math.max(-0.95, Math.min(0.75, this.headPitch - dy));
    // gentle sway with the wagon
    const sway = Math.sin(this.time * 1.7) * 0.004;
    this.camera.rotation.set(this.headPitch + sway, this.headYaw, Math.sin(this.time * 1.1) * 0.003);
    void dt;
  }

  private updateSets(force: boolean) {
    this.camera.computeWorldMatrix();
    const p = this.camera.globalPosition;
    for (const { set } of this.sets) set.update(p, force);
  }

  private updateAudio() {
    const cam = this.camera;
    const f = cam.getDirection(new Vector3(0, 0, -1));
    const p = cam.globalPosition;
    audio.setListener(p.x, p.y, p.z, f.x, f.y, f.z);
    const ctx = audio.ctx;
    if (!ctx) return;
    for (const e of this.emitters) {
      const q = e.node();
      e.panner.positionX.setTargetAtTime(q.x, ctx.currentTime, 0.05);
      e.panner.positionY.setTargetAtTime(q.y + 0.5, ctx.currentTime, 0.05);
      e.panner.positionZ.setTargetAtTime(q.z, ctx.currentTime, 0.05);
    }
  }

  private lookTargetFor(l: Line): Vector3 | null {
    const look = l.look ?? "player";
    if (look === "player") return this.camera.globalPosition;
    if (look === "ahead") return this.route.pos(this.s + 40).addInPlace(new Vector3(0, 1.6, 0));
    const c = this.npc.get(look === "leader" ? "leader" : look);
    if (!c) return null;
    return c.root.getAbsolutePosition().add(new Vector3(0, 0.9, 0));
  }

  private updateDialogue(remaining: number) {
    if (this.speaking && this.time >= this.speaking.until) {
      const c = this.npc.get(this.speaking.who);
      c?.play("Sitting_Idle_Loop", { blend: 0.4 });
      hud.clearSubtitle();
      this.speaking = null;
    }
    // idle look: talkative NPCs glance at the player now and then
    if (!this.speaking) {
      const brun = this.npc.get("brun");
      brun?.lookAt(Math.sin(this.time * 0.13) > 0.2 ? this.camera.globalPosition : null);
      this.npc.get("rowan")?.lookAt(Math.sin(this.time * 0.09 + 2) > 0.5 ? this.camera.globalPosition : null);
    }
    if (this.lineIdx >= SCRIPT.length || this.speaking || this.time < this.nextAllowed) return;
    const l = SCRIPT[this.lineIdx];
    if (l.t !== undefined && this.time < l.t) return;
    if (l.remaining !== undefined && remaining > l.remaining) return;
    this.lineIdx++;
    const dur = lineDuration(l);
    // subtitles are always shown in M1 (no voice-over yet)
    const sub = settings.value.subtitles;
    if (!sub) settings.value.subtitles = true;
    hud.subtitle(SPEAKER_NAMES[l.who], l.text);
    if (!sub) settings.value.subtitles = false;
    this.speaking = { who: l.who, until: this.time + dur };
    this.lineEnd = this.time + dur;
    this.nextAllowed = this.time + dur + (l.gap ?? 0.6);
    const c = this.npc.get(l.who);
    if (c) {
      if (l.who === "brun" || l.who === "rowan") c.play("Sitting_Talking_Loop", { blend: 0.35 });
      c.lookAt(this.lookTargetFor(l));
    }
  }

  private loadTown() {
    this.townState = "loading";
    const t0 = performance.now();
    void Promise.all([loadGLB("ph/modular_fort_01", this.scene), loadGLB("cart/houses", this.scene).catch(() => null)])
      .then(async ([fort, houses]) => {
        if (this.disposed) return;
        console.info(`[timing] town assets parsed +${(performance.now() - t0).toFixed(0)} ms`);
        const town = await buildTown(this.scene, fort, houses, (x, z) => this.heightAt(x, z));
        console.info(`[timing] town built +${(performance.now() - t0).toFixed(0)} ms`);
        for (const m of town.meshes) this.env.addShadowCaster(m);
        this.townState = "ready";
      })
      .catch((e) => {
        console.error("town failed", e);
        this.townState = "ready"; // don't block the ride forever
      });
  }

  private async finish() {
    this.finished = true;
    await this.game.save("auto");
    await hud.fade(true, 2);
    hud.clearSubtitle();
    audio.stopAllBeds(2);
    audio.stopMusic(3);
    const card = document.createElement("section");
    card.id = "endcard";
    card.innerHTML = `<h2>囚 车</h2><p>第一段 · 完</p><p style="font-size:13px">下一段「点名」将在后续版本中开放</p><button>返回主菜单</button>`;
    card.querySelector("button")!.addEventListener("click", () => {
      card.remove();
      void hud.fade(false, 0.5);
      this.game.exitToMenu();
    });
    document.getElementById("ui")!.appendChild(card);
    input.releaseLock();
    this.gameplay = false;
  }

  // ------------------------------------------------------------------ Stage

  applyQuality(q: Quality) {
    this.env?.applyQuality(q);
    if (this.terrainPlugin) {
      this.terrainPlugin.useNormals = q !== "low";
      this.terrainPlugin.markAllDefinesAsDirty();
    }
    // LOD distances per tier
    const lod = { low: [45, 120, 700], medium: [60, 150, 900], high: [75, 190, 1100] }[q];
    for (const { set, kind } of this.sets) {
      if (kind === "tree") {
        set.lods[0].maxDistance = lod[0];
        set.lods[1].maxDistance = lod[1];
        set.lods[2].maxDistance = lod[2];
      } else if (kind === "foliage") set.lods[0].maxDistance = q === "low" ? 30 : q === "medium" ? 45 : 60;
    }
    this.updateSets(true);
  }

  setPaused(p: boolean) {
    if (p) hud.clearSubtitle();
  }

  saveState() {
    return { label: "囚车", state: { s: this.s, line: this.lineIdx, time: this.time } };
  }

  dispose() {
    this.disposed = true;
    hud.prompt(null);
    for (const e of this.emitters) e.panner.disconnect();
    audio.stopAllBeds(1);
    for (const { set } of this.sets) set.dispose();
    for (const c of this.npc.values()) c.dispose();
    this.env?.dispose();
    this.scene.dispose();
    hud.clearSubtitle();
    hud.loading(false);
  }
}
