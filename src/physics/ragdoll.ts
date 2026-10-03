import type JoltType from "jolt-physics/wasm";
import { Matrix, Quaternion, Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { L, type Physics } from "./Physics";
import type { Character } from "../world/characters";
import { stopWalk } from "../prologue/actors";

/** Ragdoll parts for the UE-mannequin skeleton: [bone, child bone that ends the capsule, radius, parent part] */
const PARTS: [string, string, number, string | null][] = [
  ["pelvis", "spine_02", 0.13, null],
  ["spine_02", "neck_01", 0.15, "pelvis"],
  ["Head", "", 0.11, "spine_02"],
  ["upperarm_l", "lowerarm_l", 0.055, "spine_02"],
  ["lowerarm_l", "hand_l", 0.05, "upperarm_l"],
  ["upperarm_r", "lowerarm_r", 0.055, "spine_02"],
  ["lowerarm_r", "hand_r", 0.05, "upperarm_r"],
  ["thigh_l", "calf_l", 0.08, "pelvis"],
  ["calf_l", "foot_l", 0.06, "thigh_l"],
  ["thigh_r", "calf_r", 0.08, "pelvis"],
  ["calf_r", "foot_r", 0.06, "thigh_r"],
];

/** Swing/twist limits per joint (radians): [normal half cone, plane half cone, twist min, twist max] */
const LIMITS: Record<string, [number, number, number, number]> = {
  spine_02: [0.5, 0.4, -0.3, 0.3],
  Head: [0.6, 0.5, -0.6, 0.6],
  upperarm_l: [1.3, 1.1, -0.8, 0.8],
  upperarm_r: [1.3, 1.1, -0.8, 0.8],
  lowerarm_l: [1.2, 0.1, -0.4, 0.4],
  lowerarm_r: [1.2, 0.1, -0.4, 0.4],
  thigh_l: [1.0, 0.5, -0.4, 0.4],
  thigh_r: [1.0, 0.5, -0.4, 0.4],
  calf_l: [1.3, 0.1, -0.2, 0.2],
  calf_r: [1.3, 0.1, -0.2, 0.2],
};

interface Part {
  bone: TransformNode;
  id: JoltType.BodyID;
  body: JoltType.Body;
  /** bone world rotation expressed in the body's frame (row-vector: boneWorld = offset * bodyWorld) */
  offset: Matrix;
  /** pelvis only: bone origin relative to the body centre, in body space */
  posOffset?: Vector3;
}

const worldRot = (n: TransformNode) => {
  n.computeWorldMatrix(true);
  const q = new Quaternion();
  n.getWorldMatrix().decompose(undefined, q, undefined);
  return q;
};

/**
 * Turns an animated character into a physics ragdoll: one capsule per major bone, swing-twist joints
 * between them; each frame the bodies drive the bone nodes (other bones keep their last pose).
 */
export class Ragdoll {
  private parts: Part[] = [];
  private constraints: JoltType.Constraint[] = [];
  private off: () => void;

  constructor(
    private ph: Physics,
    private ch: Character,
    impulse = Vector3.Zero(),
    at = "spine_02",
  ) {
    const J = ph.J;
    stopWalk(ch);
    ch.stopAnimations();
    const byName = new Map<string, Part>();
    // the character's side-to-side axis (knees and elbows hinge about it, whatever the heading)
    const side = Vector3.TransformNormal(Vector3.Right(), ch.root.computeWorldMatrix(true)).normalize();
    for (const [boneName, endName, radius, parentName] of PARTS) {
      const bone = ch.bone(boneName);
      if (!bone) continue;
      bone.computeWorldMatrix(true);
      const a = bone.getAbsolutePosition().clone();
      let b: Vector3;
      const end = endName ? ch.bone(endName) : null;
      if (end) {
        end.computeWorldMatrix(true);
        b = end.getAbsolutePosition().clone();
      } else {
        // head: extend upward from the neck joint
        b = a.add(new Vector3(0, 0.22, 0));
      }
      const dir = b.subtract(a);
      const len = Math.max(0.05, dir.length());
      dir.normalize();
      const center = a.add(b).scale(0.5);
      const halfH = Math.max(0.01, len / 2 - radius * 0.6);
      // capsule axis (Y) aligned with the bone direction
      const rot = new Quaternion();
      Quaternion.FromUnitVectorsToRef(Vector3.Up(), dir, rot);
      const shape = new J.CapsuleShape(halfH, radius);
      const p = new J.RVec3(center.x, center.y, center.z), q = new J.Quat(rot.x, rot.y, rot.z, rot.w);
      const s = new J.BodyCreationSettings(shape, p, q, J.EMotionType_Dynamic, L.RAGDOLL);
      s.mOverrideMassProperties = J.EOverrideMassProperties_CalculateInertia;
      s.mMassPropertiesOverride.mMass = boneName === "pelvis" || boneName === "spine_02" ? 14 : 4;
      s.mLinearDamping = 0.1;
      s.mAngularDamping = 0.6;
      s.mFriction = 0.8;
      const body = ph.bi.CreateBody(s);
      const id = body.GetID();
      ph.bi.AddBody(id, J.EActivation_Activate);
      J.destroy(s);
      J.destroy(p);
      J.destroy(q);
      const bodyM = Matrix.Compose(Vector3.One(), rot, center);
      const boneR = worldRot(bone);
      const boneM = Matrix.Compose(Vector3.One(), boneR, a);
      // boneWorld = offset * bodyWorld  =>  offset = boneWorld * inv(bodyWorld)
      const offset = boneM.multiply(bodyM.clone().invert());
      const part: Part = { bone, id, body, offset };
      this.parts.push(part);
      byName.set(boneName, part);

      if (parentName && byName.has(parentName)) {
        const parent = byName.get(parentName)!;
        const [nc, pc, tmin, tmax] = LIMITS[boneName] ?? [0.6, 0.6, -0.5, 0.5];
        const c = new J.SwingTwistConstraintSettings();
        const pos = new J.RVec3(a.x, a.y, a.z);
        c.mPosition1 = pos;
        c.mPosition2 = pos;
        const tw = new J.Vec3(dir.x, dir.y, dir.z);
        c.mTwistAxis1 = tw;
        c.mTwistAxis2 = tw;
        // Jolt limits the swing about the plane axis by the normal half cone and the swing about the
        // normal axis (plane x twist) by the plane half cone. LIMITS give flexion the normal half
        // cone, so the plane axis is the body's side axis made perpendicular to the bone; a bone
        // lying along that axis (an arm held out sideways) hinges about the vertical instead.
        let perp = side.subtract(dir.scale(Vector3.Dot(side, dir)));
        if (perp.lengthSquared() < 0.04) perp = Vector3.Up().subtract(dir.scale(dir.y));
        perp.normalize();
        const pa = new J.Vec3(perp.x, perp.y, perp.z);
        c.mPlaneAxis1 = pa;
        c.mPlaneAxis2 = pa;
        c.mNormalHalfConeAngle = nc;
        c.mPlaneHalfConeAngle = pc;
        c.mTwistMinAngle = tmin;
        c.mTwistMaxAngle = tmax;
        const constraint = c.Create(parent.body, body);
        ph.system.AddConstraint(constraint);
        this.constraints.push(constraint);
        for (const o of [c, pos, tw, pa]) J.destroy(o);
      }
    }
    // pelvis drives the character's position
    const pelvis = byName.get("pelvis");
    if (pelvis) {
      const bp = ph.bi.GetPosition(pelvis.id);
      pelvis.posOffset = pelvis.bone.getAbsolutePosition().subtract(new Vector3(bp.GetX(), bp.GetY(), bp.GetZ()));
    }
    const hit = byName.get(at) ?? pelvis;
    if (hit) ph.setVelocity(hit.id, impulse);
    this.off = ph.onStep(() => {});
    ch.scene.onBeforeRenderObservable.add(this.drive);
  }

  private tmpM = new Matrix();
  private drive = () => {
    const bi = this.ph.bi;
    for (const p of this.parts) {
      const bp = bi.GetPosition(p.id), bq = bi.GetRotation(p.id);
      const pos = new Vector3(bp.GetX(), bp.GetY(), bp.GetZ());
      const q = new Quaternion(bq.GetX(), bq.GetY(), bq.GetZ(), bq.GetW());
      const bodyM = Matrix.Compose(Vector3.One(), q, pos);
      const boneWorld = p.offset.multiply(bodyM);
      const parent = p.bone.parent as TransformNode;
      parent.computeWorldMatrix(true);
      boneWorld.multiplyToRef(parent.getWorldMatrix().clone().invert(), this.tmpM);
      const lq = new Quaternion(), lp = new Vector3();
      this.tmpM.decompose(undefined, lq, lp);
      p.bone.rotationQuaternion ??= new Quaternion();
      p.bone.rotationQuaternion.copyFrom(lq.normalize());
      if (p.posOffset) p.bone.position.copyFrom(lp);
      p.bone.computeWorldMatrix(true);
    }
  };

  dispose() {
    this.off();
    this.ch.scene.onBeforeRenderObservable.removeCallback(this.drive);
    for (const c of this.constraints) this.ph.system.RemoveConstraint(c);
    for (const p of this.parts) {
      this.ph.bi.RemoveBody(p.id);
      this.ph.bi.DestroyBody(p.id);
    }
    this.parts = [];
    this.constraints = [];
  }
}
