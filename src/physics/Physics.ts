import type JoltType from "jolt-physics/wasm";
import { Quaternion, Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { TransformNode } from "@babylonjs/core/Meshes/transformNode";

export type Jolt = typeof JoltType;
type JoltInstance = Awaited<ReturnType<typeof JoltType>>;

/** Object layers. */
export const L = { STATIC: 0, MOVING: 1, DEBRIS: 2, RAGDOLL: 3 } as const;
const NUM_LAYERS = 4;

let modP: Promise<JoltInstance> | null = null;
/** Load the Jolt wasm module once (lazy; ~1 MB of code + wasm, cached by the service worker). */
export function loadJolt() {
  modP ??= (async () => {
    const [{ default: init }, { default: wasmUrl }] = await Promise.all([import("jolt-physics/wasm"), import("jolt-physics/jolt-physics.wasm.wasm?url")]);
    return init({ locateFile: () => wasmUrl });
  })();
  return modP;
}

interface Synced {
  id: JoltType.BodyID;
  node: TransformNode;
}

/**
 * Thin wrapper around a Jolt PhysicsSystem: static colliders, dynamic props synced to Babylon
 * nodes, ray casts, and explicit destruction of every Jolt object we create (no leaks across
 * chapters or when returning to the menu).
 */
export class Physics {
  J: JoltInstance;
  jolt: JoltType.JoltInterface;
  system: JoltType.PhysicsSystem;
  bi: JoltType.BodyInterface;
  private bodies = new Set<JoltType.BodyID>();
  private synced: Synced[] = [];
  private accumulator = 0;
  private steppers = new Set<(dt: number) => void>();
  readonly step = 1 / 60;
  private tmpRay: JoltType.RRayCast;
  private rayCollector: JoltType.CastRayClosestHitCollisionCollector;
  private raySettings: JoltType.RayCastSettings;
  private bpFilter: JoltType.DefaultBroadPhaseLayerFilter;
  private objFilter: JoltType.DefaultObjectLayerFilter;
  bodyFilter: JoltType.BodyFilter;
  shapeFilter: JoltType.ShapeFilter;
  private disposed = false;

  static async create() {
    return new Physics(await loadJolt());
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
    const BP_STATIC = new J.BroadPhaseLayer(0), BP_MOVING = new J.BroadPhaseLayer(1);
    const bp = new J.BroadPhaseLayerInterfaceTable(NUM_LAYERS, 2);
    bp.MapObjectToBroadPhaseLayer(L.STATIC, BP_STATIC);
    bp.MapObjectToBroadPhaseLayer(L.MOVING, BP_MOVING);
    bp.MapObjectToBroadPhaseLayer(L.DEBRIS, BP_MOVING);
    bp.MapObjectToBroadPhaseLayer(L.RAGDOLL, BP_MOVING);
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
    this.bpFilter = new J.DefaultBroadPhaseLayerFilter(this.jolt.GetObjectVsBroadPhaseLayerFilter(), L.MOVING);
    this.objFilter = new J.DefaultObjectLayerFilter(this.jolt.GetObjectLayerPairFilter(), L.MOVING);
    this.bodyFilter = new J.BodyFilter();
    this.shapeFilter = new J.ShapeFilter();
  }

  vec(v: { x: number; y: number; z: number }) {
    return new this.J.Vec3(v.x, v.y, v.z);
  }
  rvec(v: { x: number; y: number; z: number }) {
    return new this.J.RVec3(v.x, v.y, v.z);
  }

  private addBody(shape: JoltType.Shape, pos: Vector3, rot: Quaternion, motion: number, layer: number, configure?: (s: JoltType.BodyCreationSettings) => void) {
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
    return id;
  }

  /** Static triangle mesh collider (world-space positions). */
  addStaticMesh(positions: ArrayLike<number>, indices: ArrayLike<number>) {
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
    if (res.HasError()) throw new Error("mesh shape: " + res.GetError().c_str());
    const shape = res.Get();
    const id = this.addBody(shape, Vector3.Zero(), Quaternion.Identity(), J.EMotionType_Static, L.STATIC);
    for (const o of [verts, tris, f, t, mats, settings]) J.destroy(o);
    return id;
  }

  /** Height field collider over a square region. `sample(x,z)` gives terrain height. */
  addHeightField(x0: number, z0: number, size: number, samples: number, sample: (x: number, z: number) => number) {
    const J = this.J;
    const s = new J.HeightFieldShapeSettings();
    const step = size / (samples - 1);
    s.mOffset = new J.Vec3(x0, 0, z0);
    s.mScale = new J.Vec3(step, 1, step);
    s.mSampleCount = samples;
    s.mBlockSize = 4;
    const arr = s.mHeightSamples;
    arr.resize(samples * samples);
    const heap = new Float32Array(J.HEAPF32.buffer, J.getPointer(arr.data()), samples * samples);
    // Jolt's height field is indexed [z][x]
    for (let j = 0; j < samples; j++) for (let i = 0; i < samples; i++) heap[j * samples + i] = sample(x0 + i * step, z0 + j * step);
    const res = s.Create();
    if (res.HasError()) throw new Error("height field: " + res.GetError().c_str());
    const id = this.addBody(res.Get(), Vector3.Zero(), Quaternion.Identity(), J.EMotionType_Static, L.STATIC);
    J.destroy(s);
    return id;
  }

  addBox(center: Vector3, half: Vector3, rot = Quaternion.Identity(), o: { dynamic?: boolean; mass?: number; node?: TransformNode; layer?: number; friction?: number } = {}) {
    const J = this.J;
    const he = this.vec(half);
    const shape = new J.BoxShape(he, Math.min(0.05, Math.min(half.x, half.y, half.z) * 0.5));
    J.destroy(he);
    const id = this.addBody(shape, center, rot, o.dynamic ? J.EMotionType_Dynamic : J.EMotionType_Static, o.layer ?? (o.dynamic ? L.DEBRIS : L.STATIC), (s) => {
      if (o.mass) {
        s.mOverrideMassProperties = J.EOverrideMassProperties_CalculateInertia;
        s.mMassPropertiesOverride.mMass = o.mass;
      }
      if (o.friction !== undefined) s.mFriction = o.friction;
    });
    if (o.node) this.sync(id, o.node);
    return id;
  }

  /** Copy a dynamic body's transform onto a node after every step. */
  sync(id: JoltType.BodyID, node: TransformNode) {
    node.rotationQuaternion ??= Quaternion.Identity();
    this.synced.push({ id, node });
  }

  setVelocity(id: JoltType.BodyID, v: Vector3, w?: Vector3) {
    const lv = this.vec(v);
    this.bi.SetLinearVelocity(id, lv);
    this.J.destroy(lv);
    if (w) {
      const av = this.vec(w);
      this.bi.SetAngularVelocity(id, av);
      this.J.destroy(av);
    }
  }

  removeBody(id: JoltType.BodyID) {
    if (!this.bodies.delete(id)) return;
    this.bi.RemoveBody(id);
    this.bi.DestroyBody(id);
    this.synced = this.synced.filter((s) => s.id !== id);
  }

  /** Called every fixed step (character controllers, ragdoll drivers, soft-body wind...). */
  onStep(fn: (dt: number) => void) {
    this.steppers.add(fn);
    return () => this.steppers.delete(fn);
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
    }
    if (!n) return;
    for (const s of this.synced) {
      const p = this.bi.GetPosition(s.id), q = this.bi.GetRotation(s.id);
      s.node.position.set(p.GetX(), p.GetY(), p.GetZ());
      s.node.rotationQuaternion!.set(q.GetX(), q.GetY(), q.GetZ(), q.GetW());
    }
  }

  /** Closest hit distance along a ray against static + moving geometry, or Infinity. */
  rayCast(from: Vector3, dir: Vector3, maxDist: number) {
    const J = this.J;
    const o = this.tmpRay.mOrigin, d = this.tmpRay.mDirection;
    o.Set(from.x, from.y, from.z);
    d.Set(dir.x * maxDist, dir.y * maxDist, dir.z * maxDist);
    this.tmpRay.mOrigin = o;
    this.tmpRay.mDirection = d;
    this.rayCollector.Reset();
    this.system.GetNarrowPhaseQuery().CastRay(this.tmpRay, this.raySettings, this.rayCollector, this.bpFilter, this.objFilter, this.bodyFilter, this.shapeFilter);
    void J;
    return this.rayCollector.HadHit() ? this.rayCollector.mHit.mFraction * maxDist : Infinity;
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
    const J = this.J;
    for (const o of [this.tmpRay, this.rayCollector, this.raySettings, this.bpFilter, this.objFilter, this.bodyFilter, this.shapeFilter]) J.destroy(o);
    J.destroy(this.jolt);
  }
}
