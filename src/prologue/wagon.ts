import type { AssetContainer } from "@babylonjs/core/assetContainer";
import type { AnimationGroup } from "@babylonjs/core/Animations/animationGroup";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { Quaternion, Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { Scene } from "@babylonjs/core/scene";
import type { Node } from "@babylonjs/core/node";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import type { Route } from "../world/route";

const WHEEL_R = 0.58;
const AXLE = 1.15;
/** distance from the wagon centre to the horse's centre along the road */
const HORSE_AHEAD = 3.7;
/** the 0 A.D. horse is authored ~2.5x life size */
const HORSE_SCALE = 0.4;

function findNode(roots: Node[], name: string): TransformNode | undefined {
  for (const r of roots) {
    if (r.name === name && r instanceof TransformNode) return r;
    const hit = r.getDescendants(false, (n) => n.name === name)[0];
    if (hit) return hit as TransformNode;
  }
}

/** A horse-drawn prisoner wagon following the road. */
export class Wagon {
  root: TransformNode;
  body: TransformNode;
  seats = new Map<string, TransformNode>();
  meshes: AbstractMesh[] = [];
  private wheels: TransformNode[] = [];
  private wheelBase: Quaternion[] = [];
  private wheelAngle = 0;
  horseRoot: TransformNode;
  private horseWalk: AnimationGroup | null = null;
  private seed = Math.random() * 100;
  /** vertical bounce + roll added to the body (felt through the seat camera) */
  bump = 0;

  constructor(
    scene: Scene,
    wagon: AssetContainer,
    horse: AssetContainer,
    readonly name: string,
  ) {
    const w = wagon.instantiateModelsToScene((n) => n, false);
    this.root = new TransformNode(`${name}_root`, scene);
    this.root.rotationQuaternion = Quaternion.Identity();
    // inner node carries bounce/roll so the axles stay on the road
    this.body = new TransformNode(`${name}_body`, scene);
    this.body.parent = this.root;
    this.body.rotationQuaternion = Quaternion.Identity();
    for (const r of w.rootNodes) r.parent = this.body;
    for (const r of w.rootNodes) this.meshes.push(...(r as TransformNode).getChildMeshes(false));
    for (const n of ["wheel_fl", "wheel_fr", "wheel_rl", "wheel_rr"]) {
      const node = findNode(w.rootNodes, n);
      if (node) {
        this.wheels.push(node);
        node.rotationQuaternion ??= Quaternion.Identity();
        this.wheelBase.push(node.rotationQuaternion.clone());
      }
    }
    for (const n of ["seat_0", "seat_1", "seat_2", "seat_3", "driver_seat"]) {
      const node = findNode(w.rootNodes, n);
      if (node) this.seats.set(n, node);
    }

    const h = horse.instantiateModelsToScene((n) => `${name}_${n}`, false, { doNotInstantiate: true });
    this.horseRoot = new TransformNode(`${name}_horse`, scene);
    this.horseRoot.rotationQuaternion = Quaternion.Identity();
    this.horseRoot.scaling.setAll(HORSE_SCALE);
    for (const r of h.rootNodes) r.parent = this.horseRoot;
    for (const r of h.rootNodes) this.meshes.push(...(r as TransformNode).getChildMeshes(false));
    this.horseWalk = h.animationGroups[0] ?? null;
    this.horseWalk?.start(true, 1);
  }

  private tmpA = new Vector3();
  private tmpB = new Vector3();

  /** Place the wagon with its centre at route distance s; speed in m/s drives wheels and horse gait. */
  place(route: Route, s: number, speed: number, dt: number, time: number) {
    const front = route.pos(s + AXLE, this.tmpA);
    const rear = route.pos(s - AXLE, this.tmpB);
    const dx = front.x - rear.x, dy = front.y - rear.y, dz = front.z - rear.z;
    const len = Math.hypot(dx, dy, dz) || 1;
    const yaw = Math.atan2(-dx, -dz);
    const pitch = Math.asin(dy / len);
    this.root.position.set((front.x + rear.x) / 2, (front.y + rear.y) / 2, (front.z + rear.z) / 2);
    Quaternion.RotationYawPitchRollToRef(yaw, pitch, 0, this.root.rotationQuaternion!);

    // road roughness: small bumps proportional to speed
    const k = Math.min(1, speed / 2.5);
    const p = s * 1.7 + this.seed;
    const bounce = (Math.sin(p * 2.1) * 0.5 + Math.sin(p * 3.7 + 1.3) * 0.3 + Math.sin(p * 7.9) * 0.2) * 0.018 * k;
    const roll = (Math.sin(p * 1.3 + 0.7) * 0.7 + Math.sin(p * 4.1) * 0.3) * 0.012 * k;
    const pitchJ = Math.sin(p * 2.9 + 2.1) * 0.006 * k;
    this.body.position.y = bounce;
    Quaternion.RotationYawPitchRollToRef(0, pitchJ, roll, this.body.rotationQuaternion!);
    this.bump = bounce;

    this.wheelAngle -= (speed * dt) / WHEEL_R;
    const spin = Quaternion.RotationAxis(Vector3.Right(), this.wheelAngle);
    this.wheels.forEach((w, i) => this.wheelBase[i].multiplyToRef(spin, w.rotationQuaternion!));

    // horse: on the road ahead, facing along it
    const hp = route.pos(s + HORSE_AHEAD, this.tmpA);
    this.horseRoot.position.copyFrom(hp);
    const hy = route.yaw(s + HORSE_AHEAD);
    const hpitch = Math.asin(Math.max(-1, Math.min(1, route.dir(s + HORSE_AHEAD, this.tmpB).y)));
    // the 0 A.D. horse faces +Z; our forward is -Z
    Quaternion.RotationYawPitchRollToRef(hy + Math.PI, -hpitch, 0, this.horseRoot.rotationQuaternion!);
    if (this.horseWalk) {
      // one walk cycle (1.67 s) covers ~2.4 m at life size
      this.horseWalk.speedRatio = Math.max(0.05, speed / 1.45);
      if (speed < 0.05) this.horseWalk.pause();
      else if (!this.horseWalk.isPlaying) this.horseWalk.play(true);
    }
    void time;
  }

  dispose() {
    this.horseRoot.dispose(false, false);
    this.root.dispose(false, false);
  }
}
