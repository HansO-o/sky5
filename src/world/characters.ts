import type { AssetContainer } from "@babylonjs/core/assetContainer";
import { AnimationGroup } from "@babylonjs/core/Animations/animationGroup";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { Matrix, Quaternion, Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { Scene } from "@babylonjs/core/scene";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import type { Node } from "@babylonjs/core/node";
import { instantiateSubset } from "../game/loaders";

/** Parts available in chars/male (see tools/gen/characters.mjs). */
export type Part =
  | "outfit_ranger_Acc_Pauldron"
  | "outfit_ranger_Arms"
  | "outfit_ranger_Arms_Bracer"
  | "outfit_ranger_Body"
  | "outfit_ranger_Body_Belt_1"
  | "outfit_ranger_Body_Belt_1.001"
  | "outfit_ranger_Feet_Boots"
  | "outfit_ranger_Head_Hood"
  | "outfit_ranger_Legs"
  | "outfit_peasant_Arms"
  | "outfit_peasant_Body"
  | "outfit_peasant_Feet"
  | "outfit_peasant_Legs"
  | "head"
  | "eyes"
  | "brows"
  | "hair_simpleparted"
  | "hair_beard"
  | "hair_buzzed"
  | "hair_long"
  | "hair_buns"
  | "hair_buzzedfemale";

export const OUTFITS = {
  rebel: ["outfit_ranger_Arms", "outfit_ranger_Body", "outfit_ranger_Body_Belt_1", "outfit_ranger_Feet_Boots", "outfit_ranger_Legs", "outfit_ranger_Arms_Bracer"],
  rebelLeader: ["outfit_ranger_Arms", "outfit_ranger_Body", "outfit_ranger_Body_Belt_1", "outfit_ranger_Body_Belt_1.001", "outfit_ranger_Feet_Boots", "outfit_ranger_Legs", "outfit_ranger_Acc_Pauldron", "outfit_ranger_Head_Hood"],
  peasant: ["outfit_peasant_Arms", "outfit_peasant_Body", "outfit_peasant_Feet", "outfit_peasant_Legs"],
  soldier: ["outfit_peasant_Arms", "outfit_peasant_Body", "outfit_peasant_Legs", "outfit_ranger_Feet_Boots", "outfit_ranger_Acc_Pauldron", "outfit_ranger_Head_Hood", "outfit_ranger_Arms_Bracer"],
} satisfies Record<string, Part[]>;

export interface CharacterSpec {
  name: string;
  /** body: male (default) or female */
  sex?: "m" | "f";
  outfit: Part[];
  hair?: Part[];
  /** hood hides hair */
  face?: boolean;
}

/** Shared factory: one loaded body container + one animation container. */
export class CharacterFactory {
  private clips = new Map<string, AnimationGroup>();
  /** female body container, loaded on demand (see World.ensureFemale) */
  female: AssetContainer | null = null;
  constructor(
    private scene: Scene,
    private body: AssetContainer,
    anims: AssetContainer[],
  ) {
    for (const c of anims) for (const g of c.animationGroups) this.clips.set(g.name, g);
  }

  clipNames() {
    return [...this.clips.keys()];
  }

  create(spec: CharacterSpec) {
    const keep = new Set<string>([...spec.outfit, ...(spec.hair ?? []), ...(spec.face === false ? [] : ["head", "eyes", "brows"])]);
    const body = spec.sex === "f" ? this.female : this.body;
    if (!body) throw new Error("female body not loaded");
    const inst = instantiateSubset(body, (n) => keep.has(n), (n) => PART_RE.test(n));
    const root = new TransformNode(`npc_${spec.name}`, this.scene);
    root.rotationQuaternion = Quaternion.Identity();
    for (const r of inst.rootNodes) r.parent = root;
    const nodes = new Map<string, TransformNode>();
    const meshes: AbstractMesh[] = [];
    const visit = (n: Node) => {
      if (n instanceof TransformNode) nodes.set(n.name, n);
      for (const c of n.getChildren()) visit(c);
    };
    inst.rootNodes.forEach(visit);
    for (const r of inst.rootNodes) meshes.push(...r.getChildMeshes(false));
    // skinned bounds are computed in bind pose; characters are few, so skip culling them
    for (const m of meshes) m.alwaysSelectAsActiveMesh = true;
    for (const g of inst.animationGroups) g.dispose();
    return new Character(this.scene, spec.name, root, nodes, meshes, this.clips);
  }
}

const PART_RE = /^(outfit_|head$|eyes$|brows$|hair_)/;

const tmpM = new Matrix();
const tmpM2 = new Matrix();
const tmpQ = new Quaternion();
const tmpV = new Vector3();
const tmpS = new Vector3();

export class Character {
  private groups = new Map<string, AnimationGroup>();
  current: AnimationGroup | null = null;
  private head: TransformNode | undefined;
  private lookTarget: Vector3 | null = null;
  private lookYaw = 0;
  private lookPitch = 0;
  /** extra downward head tilt (radians), e.g. for a captive staring at the floor */
  headDown = 0;

  constructor(
    readonly scene: Scene,
    readonly name: string,
    readonly root: TransformNode,
    private nodes: Map<string, TransformNode>,
    readonly meshes: AbstractMesh[],
    private clips: Map<string, AnimationGroup>,
  ) {
    this.head = nodes.get("Head");
  }

  /** Clone a shared clip onto this character's bones (by bone name). */
  private group(clip: string) {
    let g = this.groups.get(clip);
    if (g) return g;
    const src = this.clips.get(clip);
    if (!src) throw new Error(`missing clip ${clip}`);
    g = new AnimationGroup(`${this.name}_${clip}`, this.scene);
    for (const ta of src.targetedAnimations) {
      const t = this.nodes.get((ta.target as Node).name);
      if (t) g.addTargetedAnimation(ta.animation, t);
    }
    g.normalize(src.from, src.to);
    this.groups.set(clip, g);
    return g;
  }

  play(clip: string, { loop = true, speed = 1, blend = 0.25, offset = Math.random() } = {}) {
    const g = this.group(clip);
    if (this.current === g) {
      g.speedRatio = speed;
      return g;
    }
    const prev = this.current;
    this.current = g;
    g.start(loop, speed, g.from, g.to, false);
    g.goToFrame(g.from + (g.to - g.from) * offset);
    if (prev && blend > 0) {
      // linear cross-fade by weights
      g.weight = 0;
      prev.weight = 1;
      let t = 0;
      const obs = this.scene.onBeforeAnimationsObservable.add(() => {
        t += this.scene.getEngine().getDeltaTime() / 1000;
        const k = Math.min(1, t / blend);
        g.weight = k;
        prev.weight = 1 - k;
        if (k >= 1) {
          prev.stop();
          prev.weight = 1;
          this.scene.onBeforeAnimationsObservable.remove(obs);
        }
      });
    } else {
      prev?.stop();
      g.weight = 1;
    }
    return g;
  }

  lookAt(p: Vector3 | null) {
    this.lookTarget = p;
  }

  /** Call after animations have been evaluated (scene.onBeforeRenderObservable). */
  postAnimate(dt: number) {
    const head = this.head;
    if (!head || !head.parent) return;
    let wantYaw = 0, wantPitch = this.headDown;
    head.computeWorldMatrix(true);
    const hw = head.getWorldMatrix();
    const hp = hw.getTranslation();
    if (this.lookTarget) {
      // body forward = root's +Z (glTF characters face +Z)
      const fwd = Vector3.TransformNormal(new Vector3(0, 0, 1), this.root.getWorldMatrix()).normalize();
      const to = this.lookTarget.subtract(hp);
      const yawBody = Math.atan2(fwd.x, fwd.z);
      const yawTo = Math.atan2(to.x, to.z);
      let d = yawTo - yawBody;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      wantYaw = Math.max(-1.1, Math.min(1.1, d));
      const horiz = Math.hypot(to.x, to.z);
      wantPitch += Math.max(-0.35, Math.min(0.35, -Math.atan2(to.y, horiz)));
    }
    const k = 1 - Math.exp(-dt * 4);
    this.lookYaw += (wantYaw - this.lookYaw) * k;
    this.lookPitch += (wantPitch - this.lookPitch) * k;
    if (Math.abs(this.lookYaw) < 1e-3 && Math.abs(this.lookPitch) < 1e-3) return;
    // world-space rotation about the head pivot: yaw around world Y, pitch around the body's right axis
    const right = Vector3.TransformNormal(Vector3.Right(), this.root.getWorldMatrix()).normalize();
    const qYaw = Quaternion.RotationAxis(Vector3.Up(), this.lookYaw);
    const qPitch = Quaternion.RotationAxis(right, this.lookPitch);
    qYaw.multiplyToRef(qPitch, tmpQ);
    Matrix.FromQuaternionToRef(tmpQ, tmpM);
    // W' = W * T(-p) * R * T(p)
    const W = hw.clone();
    W.multiplyToRef(Matrix.Translation(-hp.x, -hp.y, -hp.z), tmpM2);
    tmpM2.multiplyToRef(tmpM, tmpM2);
    tmpM2.multiplyToRef(Matrix.Translation(hp.x, hp.y, hp.z), tmpM2);
    // local = W' * parentWorld^-1
    const parentW = (head.parent as TransformNode).getWorldMatrix();
    const inv = parentW.clone().invert();
    tmpM2.multiplyToRef(inv, tmpM2);
    tmpM2.decompose(tmpS, tmpQ, tmpV);
    head.rotationQuaternion ??= new Quaternion();
    head.rotationQuaternion.copyFrom(tmpQ);
    head.computeWorldMatrix(true);
  }

  /** Stop every clip (e.g. before a ragdoll takes over). */
  stopAnimations() {
    for (const g of this.groups.values()) g.stop();
    this.current = null;
    this.lookTarget = null;
  }

  /** Skeleton bone (glTF joint node) by name. */
  bone(name: string) {
    return this.nodes.get(name);
  }

  setEnabled(on: boolean) {
    this.root.setEnabled(on);
  }

  dispose() {
    for (const g of this.groups.values()) g.dispose();
    this.root.dispose(false, false);
  }
}
