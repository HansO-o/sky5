import { Quaternion, Vector3 } from "@babylonjs/core/Maths/math.vector";
import { CreateBox } from "@babylonjs/core/Meshes/Builders/boxBuilder";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import type { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import type { Material } from "@babylonjs/core/Materials/material";
import type { Scene } from "@babylonjs/core/scene";
import { L, type BodyId, type Physics } from "./Physics";
import { precompile } from "../render/precompile";

/** One loose box: a node to drive (or a box mesh made for it), its body and initial motion. */
export interface DebrisPiece {
  /** existing node to move with the body (e.g. a plank of a broken deck); else a box mesh is made */
  node?: TransformNode;
  /** body centre (world) */
  center: Vector3;
  /** box half extents (m) */
  half: Vector3;
  rot?: Quaternion;
  velocity?: Vector3;
  spin?: Vector3;
}

export interface DebrisOptions {
  /**
   * Object layer while loose: L.RAGDOLL (default) never blocks characters; L.DEBRIS is pushed
   * around by them and blocks them.
   */
  layer?: number;
  /** per piece (kg) */
  mass?: number;
  friction?: number;
  /** seconds of game time until the pieces freeze into scenery */
  settle?: number;
  /** material of the box meshes made for pieces without a node */
  material?: Material | null;
  /** after settling, leave a static box collider at each piece's final pose (walkable rubble) */
  solid?: boolean;
  /** registry tag of those static colliders */
  tag?: string;
  /** name of made meshes */
  name?: string;
}

/** A random burst of boxes from a volume (a wall breaking apart). */
export interface BurstOptions extends DebrisOptions {
  count: number;
  /** half size range of a piece (m); pieces are s × 0.7 s × 0.85 s */
  size?: [number, number];
  /** direction (and scale) the pieces are thrown along */
  push?: Vector3;
  /** throw speed range, times |push| */
  speed?: [number, number];
  rng?: () => number;
}

interface Live {
  node: TransformNode;
  half: Vector3;
  body: BodyId | null;
}

/** Pieces spawned together; they freeze together `settle` seconds later. */
export class DebrisSet {
  /** the made box meshes (nodes passed in are not included) */
  readonly meshes: Mesh[] = [];
  /** static colliders left by a `solid` set once it settled */
  readonly colliders: BodyId[] = [];
  readonly done: Promise<void>;
  private resolveDone!: () => void;
  private pieces: Live[] = [];
  private offStep: (() => void) | null = null;
  private frozen = false;
  private disposed = false;

  /** @internal made by {@link Debris.spawn} */
  constructor(
    private ph: Physics,
    private o: Required<Pick<DebrisOptions, "settle">> & DebrisOptions,
    private onGone: (s: DebrisSet) => void,
  ) {
    this.done = new Promise((r) => (this.resolveDone = r));
  }

  /** @internal */
  add(p: Live) {
    this.pieces.push(p);
  }

  /** @internal start the settle clock (game time: physics steps) */
  start() {
    let t = 0;
    this.offStep = this.ph.onStep((dt) => {
      t += dt;
      if (t >= this.o.settle) this.freeze();
    });
  }

  get settled() {
    return this.frozen;
  }

  /** Stop simulating now: the pieces stay where they are (plus static colliders when `solid`). */
  freeze() {
    if (this.frozen || this.disposed) return;
    this.frozen = true;
    this.offStep?.();
    this.offStep = null;
    const ph = this.ph;
    for (const p of this.pieces) {
      if (!p.body) continue;
      if (this.o.solid && !ph.isDisposed) {
        const { position, rotation } = ph.bodyTransform(p.body);
        this.colliders.push(ph.addBox(position, p.half, rotation, { tag: this.o.tag }));
      }
      ph.removeBody(p.body);
      p.body = null;
    }
    for (const m of this.meshes) {
      m.computeWorldMatrix(true);
      m.freezeWorldMatrix();
    }
    this.resolveDone();
  }

  /** Remove the bodies, the colliders and the made meshes. */
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.offStep?.();
    this.offStep = null;
    if (!this.ph.isDisposed) {
      for (const p of this.pieces) if (p.body) this.ph.removeBody(p.body);
      for (const id of this.colliders) this.ph.removeBody(id);
    }
    this.colliders.length = 0;
    for (const m of this.meshes) m.dispose();
    this.meshes.length = 0;
    this.pieces = [];
    this.resolveDone();
    this.onGone(this);
  }
}

/**
 * Loose pieces that tumble and then freeze into scenery (a wall breaking apart, a falling
 * crenellation block, bridge planks, rubble, a dropped slab). Generalised from the tower breach.
 */
export class Debris {
  private sets = new Set<DebrisSet>();

  constructor(private deps: { physics: Physics; scene: Scene; shadows?: (meshes: AbstractMesh[]) => void }) {}

  /** Bodies for `pieces`, thrown with their velocities; they freeze after `settle` (8 s) seconds. */
  spawn(pieces: readonly DebrisPiece[], o: DebrisOptions = {}): DebrisSet {
    const { physics: ph, scene } = this.deps;
    const opts = { settle: 8, ...o };
    const set = new DebrisSet(ph, opts, (s) => this.sets.delete(s));
    this.sets.add(set);
    const made: Mesh[] = [];
    for (const p of pieces) {
      let node = p.node;
      if (!node) {
        const m = CreateBox(o.name ?? "debris", { width: p.half.x * 2, height: p.half.y * 2, depth: p.half.z * 2 }, scene);
        if (o.material !== undefined) m.material = o.material;
        m.position.copyFrom(p.center);
        made.push(m);
        set.meshes.push(m);
        node = m;
      } else {
        // the body drives the node in world space
        node.setParent(null);
      }
      const id = ph.addBox(p.center, p.half, p.rot ?? Quaternion.Identity(), { dynamic: true, mass: o.mass ?? 40, node, layer: o.layer ?? L.RAGDOLL, friction: o.friction ?? 0.9 });
      if (p.velocity || p.spin) ph.setVelocity(id, p.velocity ?? Vector3.Zero(), p.spin);
      set.add({ node, half: p.half.clone(), body: id });
    }
    if (made.length) this.deps.shadows?.(made);
    set.start();
    return set;
  }

  /** `count` random boxes inside `box`, thrown along `push` (the tower breach). */
  burst(box: { min: Vector3; max: Vector3 }, o: BurstOptions): DebrisSet {
    const rnd = o.rng ?? Math.random;
    const [s0, s1] = o.size ?? [0.22, 0.52];
    const [v0, v1] = o.speed ?? [3, 8];
    const pieces: DebrisPiece[] = [];
    for (let i = 0; i < o.count; i++) {
      const s = s0 + rnd() * (s1 - s0);
      const center = new Vector3(box.min.x + rnd() * (box.max.x - box.min.x), box.min.y + rnd() * (box.max.y - box.min.y), box.min.z + rnd() * (box.max.z - box.min.z));
      const rot = Quaternion.FromEulerAngles(rnd() * 3, rnd() * 3, rnd() * 3);
      const velocity = (o.push ?? Vector3.Zero()).scale(v0 + rnd() * (v1 - v0)).add(new Vector3((rnd() - 0.5) * 2, rnd() * 3, (rnd() - 0.5) * 2));
      const spin = new Vector3(rnd() * 6 - 3, rnd() * 6 - 3, rnd() * 6 - 3);
      pieces.push({ center, half: new Vector3(s, s * 0.7, s * 0.85), rot, velocity, spin });
    }
    return this.spawn(pieces, o);
  }

  /**
   * Compile the shaders the box meshes of later spawns will draw with (one box per material; null or
   * undefined: the scene's default material), so a burst never compiles in the middle of play.
   * `receiveShadows` defaults to whether a `shadows` callback was given (it makes them receivers).
   */
  async warm(materials: readonly (Material | null | undefined)[], o: { receiveShadows?: boolean } = {}) {
    const boxes = [...new Set(materials.map((m) => m ?? null))].map((mat) => {
      const m = CreateBox("debris_warm", { size: 1 }, this.deps.scene);
      if (mat) m.material = mat;
      m.receiveShadows = o.receiveShadows ?? !!this.deps.shadows;
      m.isPickable = false;
      m.setEnabled(false);
      return m;
    });
    try {
      await precompile(boxes);
    } finally {
      for (const b of boxes) b.dispose();
    }
  }

  /** Sets not yet disposed (settled or not). */
  get active(): readonly DebrisSet[] {
    return [...this.sets];
  }

  dispose() {
    for (const s of [...this.sets]) s.dispose();
  }
}
