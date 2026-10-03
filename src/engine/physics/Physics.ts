import type JoltType from "jolt-physics/wasm";
import { Quaternion, Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { loadJolt, type JoltInstance } from "./jolt";
import { inHoles, type Rect2 } from "./holes";

export { loadJolt, type Jolt, type JoltInstance } from "./jolt";

/** Object layers. */
export const L = { STATIC: 0, MOVING: 1, DEBRIS: 2, RAGDOLL: 3 } as const;
const NUM_LAYERS = 4;
/** Broad-phase layers: non-moving and moving. */
const BP = { STATIC: 0, MOVING: 1 } as const;

/** A body made by {@link Physics} (stable while the body exists, enabled or not). */
export type BodyId = JoltType.BodyID;

/** Options every body-creating call accepts. */
export interface BodyOptions {
  /** registry tag (several bodies may share one), e.g. "keep_door_l", "blocker_gate" */
  tag?: string;
}

/** What a ray hit. */
export interface RayHit {
  /** distance from the ray origin */
  distance: number;
  /** the body hit (null for one not made here, e.g. a ragdoll part or a character's inner body) */
  body: BodyId | null;
}

interface Synced {
  id: BodyId;
  node: TransformNode;
  /** body state before and after the last step (the node shows a blend of the two) */
  p0: Vector3;
  p1: Vector3;
  q0: Quaternion;
  q1: Quaternion;
}

/** Jolt's "no collision here" height sample (FLT_MAX). */
const FLT_MAX = 3.4028234663852886e38;
function noCollisionValue(J: JoltInstance) {
  try {
    // a static constant: the binding reads it without an instance
    const v = J.HeightFieldShapeConstantValues.prototype.cNoCollisionValue;
    return typeof v === "number" && v > 1e30 ? v : FLT_MAX;
  } catch {
    return FLT_MAX;
  }
}

/**
 * Thin wrapper around a Jolt PhysicsSystem: static colliders (with a tag registry and on/off
 * switching), dynamic props synced to Babylon nodes, ray casts, and explicit destruction of every
 * Jolt object we create (no leaks across chapters or when returning to the menu).
 */
export class Physics {
  J: JoltInstance;
  jolt: JoltType.JoltInterface;
  system: JoltType.PhysicsSystem;
  bi: JoltType.BodyInterface;
  private bodies = new Set<BodyId>();
  /** bodies by Jolt's id value (a ray hit reports a fresh BodyID object) */
  private byKey = new Map<number, BodyId>();
  /** bodies taken out of the simulation by setBodyEnabled(id, false) (still allocated) */
  private disabled = new Set<BodyId>();
  private tags = new Map<string, Set<BodyId>>();
  private tagOfBody = new Map<BodyId, string>();
  private synced: Synced[] = [];
  private accumulator = 0;
  private steppers = new Set<(dt: number) => void>();
  /** height-field squares (the walkable terrain; past them there is nothing to stand on) */
  private fields: { x0: number; z0: number; size: number }[] = [];
  readonly step = 1 / 60;
  private tmpRay: JoltType.RRayCast;
  private rayCollector: JoltType.CastRayClosestHitCollisionCollector;
  private raySettings: JoltType.RayCastSettings;
  private bpFilter: JoltType.DefaultBroadPhaseLayerFilter;
  private objFilter: JoltType.DefaultObjectLayerFilter;
  private staticBpFilter: JoltType.SpecifiedBroadPhaseLayerFilter;
  private staticObjFilter: JoltType.SpecifiedObjectLayerFilter;
  bodyFilter: JoltType.BodyFilter;
  shapeFilter: JoltType.ShapeFilter;
  private disposed = false;

  /** A new physics world (`jolt`: an already loaded module, e.g. in Node tests; default: {@link loadJolt}). */
  static async create(jolt?: JoltInstance | Promise<JoltInstance>) {
    return new Physics(await (jolt ?? loadJolt()));
  }

  private constructor(J: JoltInstance) {
    this.J = J;
    const settings = new J.JoltSettings();
    settings.mMaxBodies = 4096;
    settings.mMaxBodyPairs = 8192;
    settings.mMaxContactConstraints = 4096;
    const pairs = new J.ObjectLayerPairFilterTable(NUM_LAYERS);
    pairs.EnableCollision(L.STATIC, L.MOVING);
    pairs.EnableCollision(L.STATIC, L.DEBRIS);
    pairs.EnableCollision(L.STATIC, L.RAGDOLL);
    pairs.EnableCollision(L.MOVING, L.MOVING);
    pairs.EnableCollision(L.MOVING, L.DEBRIS);
    pairs.EnableCollision(L.DEBRIS, L.DEBRIS);
    pairs.EnableCollision(L.DEBRIS, L.RAGDOLL);
    // ragdoll parts don't collide with each other (joint limits keep them apart)
    const BP_STATIC = new J.BroadPhaseLayer(BP.STATIC), BP_MOVING = new J.BroadPhaseLayer(BP.MOVING);
    const bp = new J.BroadPhaseLayerInterfaceTable(NUM_LAYERS, 2);
    bp.MapObjectToBroadPhaseLayer(L.STATIC, BP_STATIC);
    bp.MapObjectToBroadPhaseLayer(L.MOVING, BP_MOVING);
    bp.MapObjectToBroadPhaseLayer(L.DEBRIS, BP_MOVING);
    bp.MapObjectToBroadPhaseLayer(L.RAGDOLL, BP_MOVING);
    // the static-only ray filter keeps its own copy of the layer
    this.staticBpFilter = new J.SpecifiedBroadPhaseLayerFilter(BP_STATIC);
    // the table keeps copies
    J.destroy(BP_STATIC);
    J.destroy(BP_MOVING);
    settings.mObjectLayerPairFilter = pairs;
    settings.mBroadPhaseLayerInterface = bp;
    settings.mObjectVsBroadPhaseLayerFilter = new J.ObjectVsBroadPhaseLayerFilterTable(bp, 2, pairs, NUM_LAYERS);
    this.jolt = new J.JoltInterface(settings);
    J.destroy(settings);
    this.system = this.jolt.GetPhysicsSystem();
    this.bi = this.system.GetBodyInterface();
    this.tmpRay = new J.RRayCast();
    this.rayCollector = new J.CastRayClosestHitCollisionCollector();
    this.raySettings = new J.RayCastSettings();
    // camera rays also stop at back faces: one that starts inside a wall slab (or meets a mirrored,
    // inside-out mesh) would otherwise pass straight through
    this.raySettings.mBackFaceModeTriangles = J.EBackFaceMode_CollideWithBackFaces;
    this.bpFilter = new J.DefaultBroadPhaseLayerFilter(this.jolt.GetObjectVsBroadPhaseLayerFilter(), L.MOVING);
    this.objFilter = new J.DefaultObjectLayerFilter(this.jolt.GetObjectLayerPairFilter(), L.MOVING);
    this.staticObjFilter = new J.SpecifiedObjectLayerFilter(L.STATIC);
    this.bodyFilter = new J.BodyFilter();
    this.shapeFilter = new J.ShapeFilter();
  }

  vec(v: { x: number; y: number; z: number }) {
    return new this.J.Vec3(v.x, v.y, v.z);
  }
  rvec(v: { x: number; y: number; z: number }) {
    return new this.J.RVec3(v.x, v.y, v.z);
  }

  private addBody(shape: JoltType.Shape, pos: Vector3, rot: Quaternion, motion: number, layer: number, tag: string | undefined, configure?: (s: JoltType.BodyCreationSettings) => void) {
    const J = this.J;
    const p = this.rvec(pos), q = new J.Quat(rot.x, rot.y, rot.z, rot.w);
    const s = new J.BodyCreationSettings(shape, p, q, motion, layer);
    configure?.(s);
    const body = this.bi.CreateBody(s);
    const id = body.GetID();
    this.bi.AddBody(id, motion === J.EMotionType_Static ? J.EActivation_DontActivate : J.EActivation_Activate);
    J.destroy(s);
    J.destroy(p);
    J.destroy(q);
    this.bodies.add(id);
    this.byKey.set(id.GetIndexAndSequenceNumber(), id);
    if (tag) this.tagBody(id, tag);
    return id;
  }

  /** Static triangle mesh collider (world-space positions). */
  addStaticMesh(positions: ArrayLike<number>, indices: ArrayLike<number>, o: BodyOptions & { layer?: number } = {}) {
    const J = this.J;
    const verts = new J.VertexList();
    const tris = new J.IndexedTriangleList();
    const f = new J.Float3(0, 0, 0);
    for (let i = 0; i < positions.length; i += 3) {
      f.x = positions[i];
      f.y = positions[i + 1];
      f.z = positions[i + 2];
      verts.push_back(f);
    }
    const t = new J.IndexedTriangle();
    for (let i = 0; i < indices.length; i += 3) {
      t.set_mIdx(0, indices[i]);
      t.set_mIdx(1, indices[i + 1]);
      t.set_mIdx(2, indices[i + 2]);
      tris.push_back(t);
    }
    const mats = new J.PhysicsMaterialList();
    const settings = new J.MeshShapeSettings(verts, tris, mats);
    const res = settings.Create();
    try {
      if (res.HasError()) throw new Error("mesh shape: " + res.GetError().c_str());
      return this.addBody(res.Get(), Vector3.Zero(), Quaternion.Identity(), J.EMotionType_Static, o.layer ?? L.STATIC, o.tag);
    } finally {
      for (const x of [verts, tris, f, t, mats, settings]) J.destroy(x);
    }
  }

  /**
   * Height field collider over a square region. `sample(x,z)` gives terrain height. Samples inside
   * one of `holes` get no collision (Jolt drops every triangle touching such a sample, so the
   * opening reaches up to one sample spacing past the rectangle; see `effectiveHole`).
   */
  addHeightField(x0: number, z0: number, size: number, samples: number, sample: (x: number, z: number) => number, holes: readonly { samples: Rect2 }[] = [], o: BodyOptions = {}) {
    const J = this.J;
    const s = new J.HeightFieldShapeSettings();
    const step = size / (samples - 1);
    // the setters copy
    const off = new J.Vec3(x0, 0, z0), sc = new J.Vec3(step, 1, step);
    s.mOffset = off;
    s.mScale = sc;
    J.destroy(off);
    J.destroy(sc);
    s.mSampleCount = samples;
    s.mBlockSize = 4;
    const arr = s.mHeightSamples;
    arr.resize(samples * samples);
    const heap = new Float32Array(J.HEAPF32.buffer, J.getPointer(arr.data()), samples * samples);
    const none = holes.length ? noCollisionValue(J) : 0;
    // Jolt's height field is indexed [z][x]
    for (let j = 0; j < samples; j++)
      for (let i = 0; i < samples; i++) {
        const x = x0 + i * step, z = z0 + j * step;
        heap[j * samples + i] = holes.length && inHoles(holes, x, z) ? none : sample(x, z);
      }
    const res = s.Create();
    try {
      if (res.HasError()) throw new Error("height field: " + res.GetError().c_str());
      const id = this.addBody(res.Get(), Vector3.Zero(), Quaternion.Identity(), J.EMotionType_Static, L.STATIC, o.tag);
      this.fields.push({ x0, z0, size });
      return id;
    } finally {
      J.destroy(s);
    }
  }

  /** Whether (x, z) lies over a height field, at least `margin` inside its edge (always true without one). */
  inBounds(x: number, z: number, margin = 0) {
    return !this.fields.length || this.fields.some((f) => x >= f.x0 + margin && x <= f.x0 + f.size - margin && z >= f.z0 + margin && z <= f.z0 + f.size - margin);
  }

  addBox(center: Vector3, half: Vector3, rot = Quaternion.Identity(), o: BodyOptions & { dynamic?: boolean; mass?: number; node?: TransformNode; layer?: number; friction?: number } = {}) {
    const J = this.J;
    const he = this.vec(half);
    const shape = new J.BoxShape(he, Math.min(0.05, Math.min(half.x, half.y, half.z) * 0.5));
    J.destroy(he);
    const id = this.addBody(shape, center, rot, o.dynamic ? J.EMotionType_Dynamic : J.EMotionType_Static, o.layer ?? (o.dynamic ? L.DEBRIS : L.STATIC), o.tag, (s) => {
      if (o.mass) {
        s.mOverrideMassProperties = J.EOverrideMassProperties_CalculateInertia;
        s.mMassPropertiesOverride.mMass = o.mass;
      }
      if (o.friction !== undefined) s.mFriction = o.friction;
    });
    if (o.node) this.sync(id, o.node);
    return id;
  }

  // ------------------------------------------------------------------ registry

  private tagBody(id: BodyId, tag: string) {
    let set = this.tags.get(tag);
    if (!set) this.tags.set(tag, (set = new Set()));
    set.add(id);
    this.tagOfBody.set(id, tag);
  }

  /** Give an existing body a registry tag (replacing its old one). */
  setTag(id: BodyId, tag: string | null) {
    if (!this.bodies.has(id)) return;
    const old = this.tagOfBody.get(id);
    if (old !== undefined) {
      this.tags.get(old)?.delete(id);
      if (!this.tags.get(old)?.size) this.tags.delete(old);
      this.tagOfBody.delete(id);
    }
    if (tag) this.tagBody(id, tag);
  }

  /** The bodies carrying `tag` (empty when none). */
  tagged(tag: string): BodyId[] {
    return [...(this.tags.get(tag) ?? [])];
  }

  /** A body's registry tag, if it has one. */
  tagOf(id: BodyId) {
    return this.tagOfBody.get(id);
  }

  /** Whether the body exists (made here and not removed). */
  has(id: BodyId) {
    return this.bodies.has(id);
  }

  /**
   * Take a body out of the simulation (a door that opened, a web that was cut) or put it back. A
   * disabled body keeps its shape and transform; rays and characters no longer meet it.
   */
  setBodyEnabled(id: BodyId, on: boolean) {
    if (!this.bodies.has(id) || on === !this.disabled.has(id)) return;
    if (on) {
      this.disabled.delete(id);
      this.bi.AddBody(id, this.bi.GetMotionType(id) === this.J.EMotionType_Static ? this.J.EActivation_DontActivate : this.J.EActivation_Activate);
    } else {
      this.disabled.add(id);
      this.bi.RemoveBody(id);
    }
  }

  /** {@link setBodyEnabled} for every body with `tag`. */
  setTagEnabled(tag: string, on: boolean) {
    for (const id of this.tagged(tag)) this.setBodyEnabled(id, on);
  }

  bodyEnabled(id: BodyId) {
    return this.bodies.has(id) && !this.disabled.has(id);
  }

  /**
   * Move a body (a static door leaf swinging on its hinge, a deck on its chains). Static bodies are
   * teleported (characters see the new pose on their next update); dynamic ones are woken.
   */
  setBodyTransform(id: BodyId, pos: { x: number; y: number; z: number }, rot: { x: number; y: number; z: number; w: number }) {
    if (!this.bodies.has(id)) return;
    const J = this.J;
    const p = this.rvec(pos), q = new J.Quat(rot.x, rot.y, rot.z, rot.w);
    const dynamic = this.bi.GetMotionType(id) === J.EMotionType_Dynamic;
    this.bi.SetPositionAndRotation(id, p, q, dynamic && !this.disabled.has(id) ? J.EActivation_Activate : J.EActivation_DontActivate);
    J.destroy(p);
    J.destroy(q);
  }

  /** A body's current position and rotation (e.g. a settled piece of debris). */
  bodyTransform(id: BodyId) {
    const p = this.bi.GetPosition(id), q = this.bi.GetRotation(id);
    return { position: new Vector3(p.GetX(), p.GetY(), p.GetZ()), rotation: new Quaternion(q.GetX(), q.GetY(), q.GetZ(), q.GetW()) };
  }

  // ------------------------------------------------------------------ dynamics

  /** Copy a dynamic body's transform onto a node every frame (interpolated between steps). */
  sync(id: BodyId, node: TransformNode) {
    node.rotationQuaternion ??= Quaternion.Identity();
    const p = this.bi.GetPosition(id), q = this.bi.GetRotation(id);
    const p1 = new Vector3(p.GetX(), p.GetY(), p.GetZ()), q1 = new Quaternion(q.GetX(), q.GetY(), q.GetZ(), q.GetW());
    this.synced.push({ id, node, p0: p1.clone(), p1, q0: q1.clone(), q1 });
  }

  /** Stop copying a body's transform onto its node (the node keeps its last pose). */
  unsync(id: BodyId) {
    this.synced = this.synced.filter((s) => s.id !== id);
  }

  setVelocity(id: BodyId, v: Vector3, w?: Vector3) {
    const lv = this.vec(v);
    this.bi.SetLinearVelocity(id, lv);
    this.J.destroy(lv);
    if (w) {
      const av = this.vec(w);
      this.bi.SetAngularVelocity(id, av);
      this.J.destroy(av);
    }
  }

  removeBody(id: BodyId) {
    if (!this.bodies.delete(id)) return;
    // a disabled body is already out of the simulation
    if (!this.disabled.delete(id)) this.bi.RemoveBody(id);
    this.setTagFree(id);
    this.byKey.delete(id.GetIndexAndSequenceNumber());
    this.bi.DestroyBody(id);
    this.synced = this.synced.filter((s) => s.id !== id);
  }

  private setTagFree(id: BodyId) {
    const tag = this.tagOfBody.get(id);
    if (tag === undefined) return;
    this.tagOfBody.delete(id);
    const set = this.tags.get(tag);
    set?.delete(id);
    if (set && !set.size) this.tags.delete(tag);
  }

  /** Called every fixed step (character controllers, ragdoll drivers, soft-body wind...). */
  onStep(fn: (dt: number) => void) {
    this.steppers.add(fn);
    return () => this.steppers.delete(fn);
  }

  /**
   * How far the frame is between the last two fixed steps (0..1). Rendering shows stepped state
   * blended by this, or motion judders on displays faster than 60 Hz (frames without a step).
   */
  get alpha() {
    return Math.max(0, Math.min(1, this.accumulator / this.step));
  }

  update(dt: number) {
    if (this.disposed) return;
    this.accumulator = Math.min(this.accumulator + dt, this.step * 4);
    let n = 0;
    while (this.accumulator >= this.step && n < 4) {
      for (const fn of this.steppers) fn(this.step);
      this.jolt.Step(this.step, 1);
      this.accumulator -= this.step;
      n++;
      for (const s of this.synced) {
        const p = this.bi.GetPosition(s.id), q = this.bi.GetRotation(s.id);
        s.p0.copyFrom(s.p1);
        s.q0.copyFrom(s.q1);
        s.p1.set(p.GetX(), p.GetY(), p.GetZ());
        s.q1.set(q.GetX(), q.GetY(), q.GetZ(), q.GetW());
      }
    }
    const a = this.alpha;
    for (const s of this.synced) {
      Vector3.LerpToRef(s.p0, s.p1, a, s.node.position);
      Quaternion.SlerpToRef(s.q0, s.q1, a, s.node.rotationQuaternion!);
    }
  }

  // ------------------------------------------------------------------ queries

  private cast(from: Vector3, dir: Vector3, maxDist: number, bp: JoltType.BroadPhaseLayerFilter, obj: JoltType.ObjectLayerFilter) {
    const o = this.tmpRay.mOrigin, d = this.tmpRay.mDirection;
    o.Set(from.x, from.y, from.z);
    d.Set(dir.x * maxDist, dir.y * maxDist, dir.z * maxDist);
    this.tmpRay.mOrigin = o;
    this.tmpRay.mDirection = d;
    this.rayCollector.Reset();
    this.system.GetNarrowPhaseQuery().CastRay(this.tmpRay, this.raySettings, this.rayCollector, bp, obj, this.bodyFilter, this.shapeFilter);
    return this.rayCollector.HadHit();
  }

  /**
   * Closest hit distance along a ray against static + moving geometry (including characters' inner
   * bodies, so not from inside a character), or Infinity. `dir` is a unit vector.
   */
  rayCast(from: Vector3, dir: Vector3, maxDist: number) {
    return this.cast(from, dir, maxDist, this.bpFilter, this.objFilter) ? this.rayCollector.mHit.mFraction * maxDist : Infinity;
  }

  /**
   * Closest hit distance against STATIC colliders only (terrain, buildings, enabled doors and
   * blockers), or Infinity: line of sight and camera booms, which must not stop at characters or
   * loose debris. `dir` is a unit vector.
   */
  rayCastStatic(from: Vector3, dir: Vector3, maxDist: number) {
    return this.cast(from, dir, maxDist, this.staticBpFilter, this.staticObjFilter) ? this.rayCollector.mHit.mFraction * maxDist : Infinity;
  }

  /** {@link rayCastStatic} with the body hit (null when nothing is). */
  rayHitStatic(from: Vector3, dir: Vector3, maxDist: number): RayHit | null {
    if (!this.cast(from, dir, maxDist, this.staticBpFilter, this.staticObjFilter)) return null;
    const h = this.rayCollector.mHit;
    return { distance: h.mFraction * maxDist, body: this.idOf(h.mBodyID) };
  }

  /** The registered BodyId object for a Jolt body id (ids are values in Jolt, objects here). */
  private idOf(raw: JoltType.BodyID) {
    return this.byKey.get(raw.GetIndexAndSequenceNumber()) ?? null;
  }

  get tempAllocator() {
    return this.jolt.GetTempAllocator();
  }
  get movingBPFilter() {
    return this.bpFilter;
  }
  get movingObjFilter() {
    return this.objFilter;
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    for (const id of [...this.bodies]) this.removeBody(id);
    this.steppers.clear();
    const J = this.J;
    for (const o of [this.tmpRay, this.rayCollector, this.raySettings, this.bpFilter, this.objFilter, this.staticBpFilter, this.staticObjFilter, this.bodyFilter, this.shapeFilter]) J.destroy(o);
    J.destroy(this.jolt);
  }

  get isDisposed() {
    return this.disposed;
  }
}
