import type { AnimationGroup } from "@babylonjs/core/Animations/animationGroup";
import type { AssetContainer } from "@babylonjs/core/assetContainer";
import { Quaternion } from "@babylonjs/core/Maths/math.vector";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import type { Node } from "@babylonjs/core/node";
import type { Scene } from "@babylonjs/core/scene";
import type { Skeleton } from "@babylonjs/core/Bones/skeleton";
import { AnimController, type PlayOptions } from "../anim/AnimController";
import { ProceduralLayer } from "../anim/ProceduralLayer";

/** A logical clip: an asset clip, optionally a segment of it (seconds from the clip's start). */
export interface CreatureClip {
  clip: string;
  from?: number;
  to?: number;
  /** default loop for this clip (default true) */
  loop?: boolean;
  /** default playback rate (default 1) */
  speed?: number;
}

/** How to set up a creature from its asset. */
export interface CreatureProfile {
  /** name of the root node (and prefix of its clips' groups) */
  name: string;
  /** uniform model scale (default 1) */
  scale?: number;
  /** which way the model faces (default "+z", like glTF characters) */
  forward?: "+z" | "-z";
  /** model offset under the root (m, before scale): re-centres a rig whose origin is elsewhere */
  pivot?: readonly [number, number, number];
  /** logical clip names (`play("bite")`) for asset clips or segments of them; asset names work too */
  clips?: Record<string, string | CreatureClip>;
  /** logical joint names (`bone("head")`) for asset joint names */
  bones?: Record<string, string>;
}

/** Options for one `play()`: a segment (seconds from the clip's start) on top of the usual ones. */
export interface CreaturePlayOptions extends PlayOptions {
  from?: number;
  to?: number;
}

/** What `AssetContainer.instantiateModelsToScene` returns (only the parts used). */
export interface CreatureInstance {
  rootNodes: Node[];
  animationGroups: AnimationGroup[];
}

/**
 * A non-human animated model (spider, wolf): a cloned instance of an animated glb with its own
 * animation groups. Clips play by name with cross-fades, whole or as a segment (each segment is a
 * clone of the clip's group over that range, so segments of one clip cross-fade into each other).
 * Bones are found by name or logical alias; `procedural` layers bone offsets on top (breathing, a
 * stagger wobble). Facing uses the game's forward-yaw convention.
 */
export class Creature {
  readonly root: TransformNode;
  readonly meshes: AbstractMesh[] = [];
  readonly anim: AnimController;
  readonly procedural: ProceduralLayer;
  private model: TransformNode;
  private nodes = new Map<string, TransformNode>();
  /** the asset's clips by name */
  private sources = new Map<string, AnimationGroup>();
  /** groups as played: whole clips by name, segments by `name@from:to` */
  private groups = new Map<string, AnimationGroup>();
  private skeletons = new Set<Skeleton>();
  private yawValue = 0;
  private disposed = false;

  /**
   * A new instance of `container`'s models and clips (the container itself is untouched: create
   * as many as needed). `cloneMaterials`: own materials, e.g. to tint one creature.
   */
  static fromContainer(scene: Scene, container: AssetContainer, p: CreatureProfile, o: { cloneMaterials?: boolean } = {}) {
    const inst = container.instantiateModelsToScene((n) => n, !!o.cloneMaterials, { doNotInstantiate: true });
    return new Creature(scene, inst, p);
  }

  constructor(
    readonly scene: Scene,
    inst: CreatureInstance,
    readonly profile: CreatureProfile,
  ) {
    this.root = new TransformNode(profile.name, scene);
    this.root.rotationQuaternion = Quaternion.Identity();
    this.model = new TransformNode(`${profile.name}_model`, scene);
    this.model.parent = this.root;
    this.model.rotationQuaternion = Quaternion.Identity();
    this.model.scaling.setAll(profile.scale ?? 1);
    // a rig facing -Z turns around under the root, so the root always faces +Z
    if (profile.forward === "-z") this.model.rotationQuaternion.copyFromFloats(0, 1, 0, 0);
    const pivotNode = new TransformNode(`${profile.name}_pivot`, scene);
    pivotNode.parent = this.model;
    if (profile.pivot) pivotNode.position.set(profile.pivot[0], profile.pivot[1], profile.pivot[2]);
    for (const r of inst.rootNodes) r.parent = pivotNode;
    const visit = (n: Node) => {
      if (n instanceof TransformNode && !this.nodes.has(n.name)) this.nodes.set(n.name, n);
      for (const c of n.getChildren()) visit(c);
    };
    inst.rootNodes.forEach(visit);
    for (const r of inst.rootNodes) if (r instanceof TransformNode) this.meshes.push(...r.getChildMeshes(false));
    for (const m of this.meshes) {
      if (m.skeleton) this.skeletons.add(m.skeleton);
      // skinned bounds are computed in bind pose: never cull a creature by them
      m.alwaysSelectAsActiveMesh = true;
      m.isPickable = false;
    }
    for (const g of inst.animationGroups) {
      g.stop();
      g.weight = 1;
      this.sources.set(g.name, g);
    }
    this.anim = new AnimController(scene, (key) => this.resolve(key));
    this.procedural = new ProceduralLayer(scene);
  }

  /** Clip names of the asset. */
  get clipNames() {
    return [...this.sources.keys()];
  }

  /** Whether `name` (logical or asset) can be played. */
  has(name: string) {
    return !!this.source(name);
  }

  /**
   * Play a clip (logical or asset name), cross-fading from the current one. `from`/`to` (seconds
   * from the clip's start) play a segment; a logical clip may define one. Returns null (and does
   * nothing) for a clip the asset lacks.
   */
  play(name: string, o: CreaturePlayOptions = {}): AnimationGroup | null {
    const src = this.source(name);
    if (!src) return null;
    const def = this.def(name);
    const from = o.from ?? def?.from;
    const to = o.to ?? def?.to;
    const key = from === undefined && to === undefined ? src.name : `${src.name}@${from ?? 0}:${to ?? ""}`;
    if (!this.groups.has(key)) this.groups.set(key, this.segment(src, key, from, to));
    return this.anim.play(key, { ...o, loop: o.loop ?? def?.loop ?? true, speed: o.speed ?? def?.speed ?? 1 });
  }

  /** Resolves when `g` (from `play`) ends by itself (true) or is replaced or stopped (false). */
  ended(g: AnimationGroup | null) {
    return g ? this.anim.ended(g) : Promise.resolve(false);
  }

  /** Length in seconds of a clip, or of its logical segment (0 when missing). */
  clipLength(name: string) {
    const src = this.source(name);
    if (!src) return 0;
    const def = this.def(name);
    const fps = fpsOf(src);
    const full = (src.to - src.from) / fps;
    const from = def?.from ?? 0;
    const to = def?.to ?? full;
    return Math.max(0, Math.min(full, to) - from);
  }

  /** A joint by logical alias or asset name. */
  bone(name: string): TransformNode | undefined {
    return this.nodes.get(this.profile.bones?.[name] ?? name);
  }

  /** Face `yaw` (forward = (-sin yaw, -cos yaw), the game's convention). */
  setYaw(yaw: number) {
    this.yawValue = yaw;
    const y = yaw + Math.PI;
    this.root.rotationQuaternion!.copyFromFloats(0, Math.sin(y / 2), 0, Math.cos(y / 2));
  }

  get yaw() {
    return this.yawValue;
  }

  /** Turn to face a point on the ground plane. */
  faceTo(p: { x: number; z: number }) {
    const dx = p.x - this.root.position.x, dz = p.z - this.root.position.z;
    if (dx * dx + dz * dz > 1e-8) this.setYaw(Math.atan2(-dx, -dz));
  }

  setEnabled(on: boolean) {
    this.root.setEnabled(on);
  }

  stopAnimations() {
    this.anim.stopAll();
    for (const g of this.groups.values()) g.stop();
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.anim.dispose();
    this.procedural.dispose();
    const sources = new Set(this.sources.values());
    for (const g of this.groups.values()) if (!sources.has(g)) g.dispose();
    for (const g of sources) g.dispose();
    this.groups.clear();
    this.sources.clear();
    this.root.dispose(false, false);
    for (const s of this.skeletons) s.dispose();
    this.skeletons.clear();
  }

  private def(name: string): CreatureClip | undefined {
    const d = this.profile.clips?.[name];
    return typeof d === "string" ? { clip: d } : d;
  }

  private source(name: string) {
    return this.sources.get(this.def(name)?.clip ?? name) ?? this.sources.get(name);
  }

  private resolve(key: string) {
    return this.groups.get(key);
  }

  /** The group a key plays: the clip itself, or a clone over a segment of it. */
  private segment(src: AnimationGroup, key: string, from?: number, to?: number) {
    if (from === undefined && to === undefined) return src;
    const fps = fpsOf(src);
    const a = Math.max(src.from, Math.min(src.to, src.from + (from ?? 0) * fps));
    const b = Math.max(a, Math.min(src.to, to === undefined ? src.to : src.from + to * fps));
    const g = src.clone(`${this.profile.name}_${key}`, (t) => t);
    g.normalize(a, b);
    return g;
  }
}

function fpsOf(g: AnimationGroup) {
  return g.targetedAnimations[0]?.animation.framePerSecond ?? 60;
}
