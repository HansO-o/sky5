import { Quaternion, Vector3 } from "@babylonjs/core/Maths/math.vector";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import type { AnimationGroup } from "@babylonjs/core/Animations/animationGroup";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import type { Observer } from "@babylonjs/core/Misc/observable";
import type { Scene } from "@babylonjs/core/scene";
import type { Node } from "@babylonjs/core/node";
import { audio } from "../core/audio";
import { loadGLB } from "../game/loaders";
import { precompile } from "../engine/render/precompile";
import type { World } from "./World";

/** Model scale: the source rig is ~1 unit long; the dragon is ~16 m nose to tail. */
export const DRAGON_SCALE = 1.3;
/** per-clip re-centring (the source clips carry different root offsets), in model units */
const CLIP_OFFSET: Record<string, [number, number, number]> = {
  Idle: [-0.7, 4.2, -2.0],
  Sit: [-0.7, 1.0, -1.0],
  Walk: [-0.7, 4.9, -4.5],
  Run: [-0.7, 4.9, -4.5],
  Fly: [0, 0, -11.2],
};
export const PIVOT: [number, number, number] = [-2.35, 74.9, 25.07];
const JAW = "DEF-Teeth_Bottom_016";
const HEAD = "DEF-Teeth_Top_013";
/** jaw hinge angle at full roar (sign picked so the mouth opens) */
export let JAW_OPEN = 0.55;
export const setJawOpen = (v: number) => (JAW_OPEN = v);
const NECK = ["DEF-neck_08", "DEF-neck.001_09", "DEF-neck.002_010", "DEF-neck.003_011", "DEF-neck.004_012"];

const ease = (t: number) => t * t * (3 - 2 * t);

/**
 * The dragon: a skinned glTF with Fly / Idle / Sit / Walk / Run clips; roars (jaw + neck), flight
 * along splines and the fire breath are layered on procedurally.
 */
export class Dragon {
  readonly root: TransformNode;
  private groups = new Map<string, AnimationGroup>();
  private current: AnimationGroup | null = null;
  private nodes = new Map<string, TransformNode>();
  readonly meshes: AbstractMesh[] = [];
  /** 0..1 procedural jaw opening, 0..1 neck rear-back (applied after animation each frame) */
  jaw = 0;
  rear = 0;
  private obs: Observer<Scene>;
  private obsRestore: Observer<Scene>;
  /** rotations before the procedural layer (restored before animations run, so offsets never accumulate) */
  private base = new Map<TransformNode, Quaternion>();
  private flight: (() => void) | null = null;
  private pivot: TransformNode;
  private offset = new Vector3();
  private offsetTarget = new Vector3();
  /** cross-fade in progress: its per-frame observer and the clip it is fading out */
  private fade: { obs: Observer<Scene>; out: AnimationGroup } | null = null;

  /** Loads the dragon and compiles its shaders (and shadow pass) before it is first shown. */
  static async create(world: World) {
    const c = await loadGLB("dragon/dragon", world.scene);
    const d = new Dragon(world, c.instantiateModelsToScene((n) => n, false, { doNotInstantiate: true }));
    // out of sight while it compiles (it would stand at the origin meanwhile)
    d.root.setEnabled(false);
    await precompile(d.meshes, { shadows: world.env.shadows });
    d.root.setEnabled(true);
    return d;
  }

  private constructor(
    private world: World,
    inst: { rootNodes: Node[]; animationGroups: AnimationGroup[] },
  ) {
    const scene = world.scene;
    this.root = new TransformNode("dragon", scene);
    this.root.rotationQuaternion = Quaternion.Identity();
    this.root.scaling.setAll(DRAGON_SCALE);
    // the source armature sits far from its origin: re-centre so the root is under the chest, feet at 0
    const pivot = new TransformNode("dragon_pivot", scene);
    pivot.parent = this.root;
    pivot.position.copyFromFloats(...PIVOT);
    this.pivot = pivot;
    for (const r of inst.rootNodes) r.parent = pivot;
    const visit = (n: Node) => {
      if (n instanceof TransformNode) this.nodes.set(n.name, n);
      for (const c of n.getChildren()) visit(c);
    };
    inst.rootNodes.forEach(visit);
    for (const r of inst.rootNodes) if (r instanceof TransformNode) this.meshes.push(...r.getChildMeshes(false));
    for (const m of this.meshes) {
      m.alwaysSelectAsActiveMesh = true;
      m.isPickable = false;
    }
    world.addShadowCasters(this.meshes);
    for (const g of inst.animationGroups) {
      g.stop();
      this.groups.set(g.name, g);
    }
    this.obsRestore = scene.onBeforeAnimationsObservable.add(() => {
      for (const [n, q] of this.base) n.rotationQuaternion!.copyFrom(q);
      this.base.clear();
    });
    this.obs = scene.onBeforeRenderObservable.add(() => this.postAnimate());
  }

  get clipNames() {
    return [...this.groups.keys()];
  }

  bone(name: string) {
    return this.nodes.get(name);
  }

  play(name: string, { loop = true, speed = 1, blend = 0.4 } = {}) {
    const g = this.groups.get(name);
    if (!g) return;
    // a clip stopped by an interrupted cross-fade is started again
    if (this.current === g && g.isStarted) {
      g.speedRatio = speed;
      return;
    }
    const prev = this.current === g ? null : this.current;
    this.current = g;
    const scene = this.world.scene;
    // settle a cross-fade still in progress: the clip it was fading out stops unless it is wanted again
    if (this.fade) {
      if (this.fade.out !== g) this.fade.out.stop();
      scene.onBeforeAnimationsObservable.remove(this.fade.obs);
      this.fade = null;
    }
    // X->Y->X within the blend: X is still playing (fading out), so pick it up where it is
    const g0 = g.isStarted ? g.weight : 0;
    if (g.isStarted) {
      g.loopAnimation = loop;
      g.speedRatio = speed;
    } else g.start(loop, speed, g.from, g.to, false);
    this.offsetTarget.fromArray(CLIP_OFFSET[name] ?? [0, 0, 0]);
    if (!prev) this.offset.copyFrom(this.offsetTarget);
    if (!prev || blend <= 0) {
      prev?.stop();
      g.weight = 1;
      return;
    }
    const p0 = prev.weight;
    g.weight = g0;
    let t = 0;
    const obs = scene.onBeforeAnimationsObservable.add(() => {
      t += scene.getEngine().getDeltaTime() / 1000;
      const k = Math.min(1, t / blend);
      g.weight = g0 + (1 - g0) * k;
      prev.weight = p0 * (1 - k);
      if (k >= 1) {
        prev.stop();
        prev.weight = 1;
        scene.onBeforeAnimationsObservable.remove(obs);
        this.fade = null;
      }
    });
    this.fade = { obs, out: prev };
  }

  /** World position of the mouth. */
  mouth(out = new Vector3()) {
    const h = this.nodes.get(HEAD);
    if (!h) return out.copyFrom(this.root.position);
    h.computeWorldMatrix(true);
    return out.copyFrom(h.getAbsolutePosition());
  }

  /** Where the fire comes from and where it goes: the mouth, along the neck → head direction. */
  breathSource() {
    const pos = this.mouth();
    const n = this.nodes.get(NECK[NECK.length - 1]);
    let dir: Vector3;
    if (n) {
      n.computeWorldMatrix(true);
      dir = pos.subtract(n.getAbsolutePosition()).normalize();
    } else dir = this.forward();
    return { pos: pos.addInPlace(dir.scale(0.6)), dir };
  }

  /** Forward direction of the body (model faces +Z). */
  forward() {
    return Vector3.TransformNormal(Vector3.Forward(), this.root.getWorldMatrix()).normalize();
  }

  /** Face a heading (radians, -Z-forward convention like the camera). */
  setYaw(yaw: number, pitch = 0, roll = 0) {
    Quaternion.RotationYawPitchRollToRef(yaw + Math.PI, -pitch, roll, this.root.rotationQuaternion!);
  }

  /** Jaw + neck procedural layer: rotations about each bone's local X axis (the rig's hinge). */
  private postAnimate() {
    const dt = this.world.scene.getEngine().getDeltaTime() / 1000;
    Vector3.LerpToRef(this.offset, this.offsetTarget, Math.min(1, dt * 2.5), this.offset);
    this.pivot.position.set(PIVOT[0] + this.offset.x, PIVOT[1] + this.offset.y, PIVOT[2] + this.offset.z);
    const add = (n: TransformNode | undefined, angle: number) => {
      if (!n) return;
      n.rotationQuaternion ??= Quaternion.FromEulerVector(n.rotation);
      if (!this.base.has(n)) this.base.set(n, n.rotationQuaternion.clone());
      n.rotationQuaternion.multiplyInPlace(Quaternion.RotationAxis(Vector3.Right(), angle));
    };
    if (this.jaw > 0.001) add(this.nodes.get(JAW), this.jaw * JAW_OPEN);
    if (this.rear > 0.001) NECK.forEach((n, i) => add(this.nodes.get(n), -this.rear * (i < 2 ? 0.12 : 0.06)));
  }

  /** A roar: rear back, jaw wide, sound and camera shake that fall off with distance. */
  async roar(id: "roar_a" | "roar_b" | "roar_c" = "roar_a", seconds = 2.4, loud = 1) {
    const w = this.world;
    const m = this.mouth();
    void audio.playOneShot(`audio/${id}`, 1.4 * loud, m, "sfx", 1, 30);
    const d = Vector3.Distance(m, w.rig.position);
    w.rig.shake(Math.min(0.03, 0.9 / Math.max(10, d)) * loud, seconds);
    let t = 0;
    await new Promise<void>((resolve) => {
      const off = w.onUpdate((dt) => {
        t += dt;
        const up = Math.min(1, t / 0.35), down = Math.min(1, Math.max(0, (seconds - t) / 0.5));
        const k = ease(Math.min(up, down));
        this.jaw = k;
        this.rear = k;
        if (t >= seconds) {
          this.jaw = this.rear = 0;
          off();
          resolve();
        }
      });
    });
  }

  /** Fly along a smooth curve through `points` at `speed` m/s, banking into turns. */
  fly(points: Vector3[], speed = 22, clip = "Fly") {
    this.stopFlight();
    this.play(clip, { speed: 1 });
    const pts = [this.root.position.clone(), ...points];
    // arc-length table of a Catmull-Rom spline
    const at = (u: number, out: Vector3) => {
      const n = pts.length - 1;
      const s = Math.min(n - 1e-6, Math.max(0, u * n));
      const i = Math.floor(s), t = s - i;
      const p0 = pts[Math.max(0, i - 1)], p1 = pts[i], p2 = pts[i + 1], p3 = pts[Math.min(n, i + 2)];
      out.copyFrom(Vector3.CatmullRom(p0, p1, p2, p3, t));
      return out;
    };
    const N = 200, lens = [0];
    const a = new Vector3(), b = new Vector3();
    at(0, a);
    for (let i = 1; i <= N; i++) {
      at(i / N, b);
      lens.push(lens[i - 1] + Vector3.Distance(a, b));
      a.copyFrom(b);
    }
    const total = lens[N];
    let dist = 0, yaw: number | null = null, roll = 0;
    return new Promise<void>((resolve) => {
      const done = () => {
        off();
        this.flight = null;
        resolve();
      };
      this.flight = done;
      const pos = new Vector3(), ahead = new Vector3();
      const off = this.world.onUpdate((dt) => {
        dist = Math.min(total, dist + speed * dt);
        let k = lens.findIndex((l) => l >= dist);
        if (k < 1) k = 1;
        const u = (k - 1 + (dist - lens[k - 1]) / Math.max(1e-6, lens[k] - lens[k - 1])) / N;
        at(u, pos);
        at(Math.min(1, u + 0.01), ahead);
        const dx = ahead.x - pos.x, dz = ahead.z - pos.z;
        if (Math.hypot(dx, dz) > 1e-4) {
          const want = Math.atan2(-dx, -dz);
          const prev = yaw ?? want;
          const dyaw = Math.atan2(Math.sin(want - prev), Math.cos(want - prev));
          yaw = prev + dyaw * Math.min(1, dt * 6);
          roll += (Math.max(-0.6, Math.min(0.6, -dyaw / Math.max(dt, 1e-3) * 0.25)) - roll) * Math.min(1, dt * 3);
          const pitch = Math.atan2(ahead.y - pos.y, Math.hypot(dx, dz));
          this.setYaw(yaw, Math.max(-0.4, Math.min(0.4, pitch)), roll);
        }
        this.root.position.copyFrom(pos);
        if (dist >= total) done();
      });
    });
  }

  stopFlight() {
    this.flight?.();
  }

  dispose() {
    this.stopFlight();
    this.world.scene.onBeforeRenderObservable.remove(this.obs);
    this.world.scene.onBeforeAnimationsObservable.remove(this.obsRestore);
    if (this.fade) this.world.scene.onBeforeAnimationsObservable.remove(this.fade.obs);
    this.fade = null;
    for (const g of this.groups.values()) g.dispose();
    this.root.dispose(false, false);
  }
}
