import { Quaternion, Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import type { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import type { Scene } from "@babylonjs/core/scene";
import { ProceduralLayer } from "../anim/ProceduralLayer";
import { BoneSocket } from "./BoneSocket";
import { applyRecipe, recipePosition, recipeRotation, type AttachRecipe } from "./attach";
import { JointPose } from "./fingers";

/** Per-frame game-time updates (the world's update bus). */
export interface UpdateBus {
  onUpdate(fn: (dt: number) => void): () => unknown;
}

/** The body equipment hangs on. */
export interface EquipmentHost {
  /** a skeleton joint by name (on the current body: looked up again after a rebuild) */
  bone(name: string): TransformNode | undefined;
  /**
   * Start a one-shot body clip for a draw or sheathe. False when it can't (no such clip, or the
   * host declines, e.g. while running): the swap then happens at once.
   */
  playOnce?(clip: string, o: { speed: number; blend: number }): boolean;
  /** The clip may give way to the body's own animation now (or it was interrupted). */
  releaseOnce?(clip: string): void;
  /** clip length in seconds at rate 1 (0 or missing: use the spec's) */
  clipLength?(clip: string): number;
}

/** A body that plays clips by name (a `Character`): enough to be an {@link EquipmentHost}. */
export interface AnimatedBody {
  bone(name: string): TransformNode | undefined;
  play(clip: string, o?: { loop?: boolean; speed?: number; blend?: number; offset?: number }): unknown;
  clipLength?(clip: string): number;
  hasClip?(clip: string): boolean;
}

/** An NPC body as an equipment host (draw and sheathe play its clip; its own logic resumes after). */
export function bodyHost(body: AnimatedBody | (() => AnimatedBody)): EquipmentHost {
  const b = typeof body === "function" ? body : () => body;
  return {
    bone: (n) => b().bone(n),
    playOnce: (clip, o) => {
      const cur = b();
      if (cur.hasClip && !cur.hasClip(clip)) return false;
      cur.play(clip, { loop: false, speed: o.speed, blend: o.blend, offset: 0 });
      return true;
    },
    clipLength: (clip) => b().clipLength?.(clip) ?? 0,
  };
}

/** A draw or sheathe: the body clip and when, in clip seconds, the items change place. */
export interface SwapClip {
  clip: string;
  /** the items move (hand <-> stow) at this clip time */
  at: number;
  /** clip length (used when the host does not know it) */
  length: number;
  /** the body may go back to its own animation at this clip time (default: the end) */
  release?: number;
  /** cross-fade into the clip (s; default 0.15) */
  blend?: number;
}

export type Slot = "main" | "off";

/** Where an item hangs while drawn (`hand`) and while put away (`stow`; null: hidden). */
export interface ItemPlacement {
  hand: AttachRecipe;
  stow?: AttachRecipe | null;
}

export interface EquipmentOptions {
  scene: Scene;
  bus: UpdateBus;
  draw?: SwapClip | null;
  sheathe?: SwapClip | null;
  /** seconds an item that changed place glides onto its recipe (default 0.15) */
  settle?: number;
  /**
   * The weapon hand's grip: while the main item is in the hand, these joints are held in `pose`
   * (fading over `fade` s), so clips made for an empty hand still close it on the handle.
   */
  grip?: { pose: ReadonlyMap<string, Quaternion>; fade?: number } | null;
}

interface Held {
  node: TransformNode;
  place: ItemPlacement;
  at: "hand" | "stow" | "none";
  /** gliding onto the recipe: elapsed seconds (negative: settled) */
  settle: number;
  from: { p: Vector3; q: Quaternion };
}

interface Action {
  kind: "draw" | "sheathe";
  spec: SwapClip;
  t: number;
  speed: number;
  length: number;
  swapped: boolean;
  promise: Promise<boolean>;
  resolve: (ok: boolean) => void;
}

const ease = (t: number) => t * t * (3 - 2 * t);
const tmpQ = new Quaternion();
const tmpP = new Vector3();

/**
 * What an actor carries: a main item (weapon) and an off-hand item (shield), each either drawn
 * (in the hand) or put away (sheathed, on the back), on {@link BoneSocket}s that follow the body's
 * joints. `draw()` / `sheathe()` play the body's clip and move the items when the hand reaches
 * them; the weapon hand is held closed on the handle while armed. Survives a body rebuild
 * (`rebind()`).
 */
export class Equipment {
  private items: Partial<Record<Slot, Held>> = {};
  /** worn things that are neither drawn nor put away (cuffs, a torch, a paper) */
  private wornItems = new Map<string, { node: TransformNode; recipe: AttachRecipe }>();
  private sockets = new Map<string, BoneSocket>();
  private layer: ProceduralLayer;
  private grip: JointPose | null = null;
  private action: Action | null = null;
  private drawn = false;
  private shown = true;
  private offBus: () => unknown;
  private disposed = false;

  constructor(
    private host: EquipmentHost,
    private o: EquipmentOptions,
  ) {
    this.layer = new ProceduralLayer(o.scene);
    if (o.grip?.pose.size) this.grip = new JointPose(this.layer, o.grip.pose, (n) => this.host.bone(n), o.grip.fade ?? 0.1);
    this.offBus = o.bus.onUpdate((dt) => this.update(dt));
  }

  /** Items are in the hands (or a draw has reached its swap). */
  get armed() {
    return this.drawn;
  }

  /** A draw or sheathe is playing. */
  get busy(): "draw" | "sheathe" | null {
    return this.action?.kind ?? null;
  }

  /** The item in `slot` (null when empty). */
  item(slot: Slot) {
    return this.items[slot]?.node ?? null;
  }

  /** Where the item in `slot` is: in the hand, stowed, or hidden (no stow place, or empty). */
  where(slot: Slot) {
    return this.items[slot]?.at ?? "none";
  }

  /** Every mesh of every item and worn thing (e.g. to hide with the body in first person). */
  get meshes(): AbstractMesh[] {
    const out: AbstractMesh[] = [];
    for (const n of this.nodes()) out.push(...n.getChildMeshes(false));
    return out;
  }

  private nodes(): TransformNode[] {
    const out: TransformNode[] = [];
    for (const h of Object.values(this.items)) if (h && !h.node.isDisposed()) out.push(h.node);
    for (const w of this.wornItems.values()) if (!w.node.isDisposed()) out.push(w.node);
    return out;
  }

  /**
   * Hang something that is neither drawn nor put away on the body: rope cuffs, a torch in the off
   * hand, a paper. Replaces (and returns, detached) what `id` held; null just removes it.
   */
  wear(id: string, node: TransformNode | null, recipe?: AttachRecipe): TransformNode | null {
    if (this.disposed) return null;
    const prev = this.wornItems.get(id);
    this.wornItems.delete(id);
    if (prev && prev.node !== node && !prev.node.isDisposed()) {
      prev.node.setParent(null);
      prev.node.setEnabled(false);
    }
    if (node && recipe) {
      this.wornItems.set(id, { node, recipe });
      node.setEnabled(true);
      node.parent = this.socket(recipe.bone).node;
      applyRecipe(node, recipe);
      for (const m of node.getChildMeshes(false)) m.isVisible = this.shown;
    }
    return prev && prev.node !== node ? prev.node : null;
  }

  /** What `wear(id, ...)` hung there (null when nothing). */
  worn(id: string) {
    return this.wornItems.get(id)?.node ?? null;
  }

  /**
   * Put `node` in `slot` (null empties it), placed for the current state: in the hand while armed,
   * stowed otherwise. Returns the item that was there, detached (not disposed).
   */
  set(slot: Slot, node: TransformNode | null, place?: ItemPlacement): TransformNode | null {
    if (this.disposed) return null;
    const prev = this.items[slot];
    delete this.items[slot];
    if (prev && prev.node !== node && !prev.node.isDisposed()) {
      prev.node.setParent(null);
      prev.node.setEnabled(false);
    }
    if (node && place) {
      const h: Held = { node, place, at: "none", settle: -1, from: { p: new Vector3(), q: new Quaternion() } };
      this.items[slot] = h;
      this.put(h, this.drawn ? "hand" : "stow", false);
      this.applyVisible(h);
    }
    this.updateGrip(true);
    return prev && prev.node !== node ? prev.node : null;
  }

  /** Draw: resolves true once the items are in hand (at once when already armed), false if interrupted. */
  draw(o: { animate?: boolean; speed?: number } = {}): Promise<boolean> {
    return this.request("draw", o);
  }

  /** Sheathe: resolves true once the items are put away, false if interrupted. */
  sheathe(o: { animate?: boolean; speed?: number } = {}): Promise<boolean> {
    return this.request("sheathe", o);
  }

  /** Armed or not, at once (a resumed save, a skip, a cutscene): any draw or sheathe resolves false. */
  setArmed(on: boolean) {
    this.interrupt();
    this.swap(on, false);
    this.grip?.snap();
  }

  /** Show or hide every item (first person hides the body and what it carries). */
  setVisible(on: boolean) {
    if (this.shown === on) return;
    this.shown = on;
    for (const n of this.nodes()) for (const m of n.getChildMeshes(false)) m.isVisible = on;
  }

  /** The body was rebuilt: follow its joints (sockets and grip). */
  rebind() {
    for (const [name, s] of this.sockets) s.rebind(this.host.bone(name) ?? null);
    this.grip?.bind();
  }

  /** The socket following `bone` (made on first use). */
  socket(bone: string): BoneSocket {
    let s = this.sockets.get(bone);
    if (!s) {
      s = new BoneSocket(this.o.scene, this.host.bone(bone) ?? null, { name: `equip_${bone}`, disposeWithBone: false });
      this.sockets.set(bone, s);
    }
    return s;
  }

  private request(kind: "draw" | "sheathe", o: { animate?: boolean; speed?: number }): Promise<boolean> {
    if (this.disposed) return Promise.resolve(false);
    if (this.action?.kind === kind) return this.action.promise;
    this.interrupt();
    const want = kind === "draw";
    if (this.drawn === want) return Promise.resolve(true);
    if (!this.items.main && !this.items.off) return Promise.resolve(false);
    const spec = want ? this.o.draw : this.o.sheathe;
    const speed = Math.max(0.05, o.speed ?? 1);
    if (!spec || o.animate === false || !this.host.playOnce?.(spec.clip, { speed, blend: spec.blend ?? 0.15 })) {
      this.swap(want, true);
      return Promise.resolve(true);
    }
    let resolve!: (ok: boolean) => void;
    const promise = new Promise<boolean>((r) => (resolve = r));
    const length = this.host.clipLength?.(spec.clip) || spec.length;
    this.action = { kind, spec, t: 0, speed, length, swapped: false, promise, resolve };
    return promise;
  }

  /** Stop a draw or sheathe where it got to (the items stay where they are now). */
  private interrupt() {
    const a = this.action;
    if (!a) return;
    this.action = null;
    this.host.releaseOnce?.(a.spec.clip);
    a.resolve(false);
  }

  /** Advance the draw/sheathe clock, the gliding items and the grip (runs on the bus). */
  update(dt: number) {
    if (this.disposed) return;
    const a = this.action;
    if (a) {
      a.t += dt * a.speed;
      if (!a.swapped && a.t >= a.spec.at) {
        a.swapped = true;
        this.swap(a.kind === "draw", true);
      }
      if (a.t >= Math.min(a.length, a.spec.release ?? a.length)) {
        this.action = null;
        this.host.releaseOnce?.(a.spec.clip);
        a.resolve(true);
      }
    }
    const settle = this.o.settle ?? 0.15;
    for (const h of Object.values(this.items)) {
      if (!h || h.settle < 0) continue;
      const recipe = h.at === "hand" ? h.place.hand : h.place.stow;
      if (!recipe || h.node.isDisposed()) {
        h.settle = -1;
        continue;
      }
      h.settle += dt;
      const k = settle > 0 ? ease(Math.min(1, h.settle / settle)) : 1;
      Vector3.LerpToRef(h.from.p, recipePosition(recipe, tmpP), k, h.node.position);
      Quaternion.SlerpToRef(h.from.q, recipeRotation(recipe, tmpQ), k, h.node.rotationQuaternion!);
      if (k >= 1) h.settle = -1;
    }
    this.grip?.update(dt);
  }

  private swap(armed: boolean, glide: boolean) {
    this.drawn = armed;
    for (const h of Object.values(this.items)) if (h) this.put(h, armed ? "hand" : "stow", glide);
    this.updateGrip(!glide);
  }

  private updateGrip(snap: boolean) {
    if (!this.grip) return;
    this.grip.active = this.drawn && this.items.main?.at === "hand";
    if (snap) this.grip.snap();
  }

  /** Hang an item at its place; `glide`: keep where it is in the world and glide onto the recipe. */
  private put(h: Held, where: "hand" | "stow", glide: boolean) {
    const recipe = where === "hand" ? h.place.hand : h.place.stow;
    const n = h.node;
    if (n.isDisposed()) return;
    if (!recipe) {
      n.setEnabled(false);
      h.at = "none";
      h.settle = -1;
      return;
    }
    const socket = this.socket(recipe.bone).node;
    n.setEnabled(true);
    h.at = where;
    if (glide && n.parent && (this.o.settle ?? 0.15) > 0) {
      n.setParent(socket);
      n.rotationQuaternion ??= new Quaternion();
      h.from.p.copyFrom(n.position);
      h.from.q.copyFrom(n.rotationQuaternion);
      // scale is not blended
      const s = recipe.scale ?? 1;
      if (typeof s === "number") n.scaling.setAll(s);
      else n.scaling.set(s[0], s[1], s[2]);
      h.settle = 0;
    } else {
      n.parent = socket;
      applyRecipe(n, recipe);
      h.settle = -1;
    }
  }

  private applyVisible(h: Held) {
    for (const m of h.node.getChildMeshes(false)) m.isVisible = this.shown;
  }

  /**
   * Stop following the body. `items`: also dispose the items (default true; false leaves them
   * unparented and hidden for the caller).
   */
  dispose(items = true) {
    if (this.disposed) return;
    this.interrupt();
    this.disposed = true;
    this.offBus();
    this.grip?.dispose();
    this.layer.dispose();
    for (const h of Object.values(this.items)) {
      if (!h || h.node.isDisposed()) continue;
      if (items) h.node.dispose(false, false);
      else {
        h.node.setParent(null);
        h.node.setEnabled(false);
      }
    }
    this.items = {};
    for (const w of this.wornItems.values()) {
      if (w.node.isDisposed()) continue;
      if (items) w.node.dispose(false, false);
      else {
        w.node.setParent(null);
        w.node.setEnabled(false);
      }
    }
    this.wornItems.clear();
    for (const s of this.sockets.values()) s.dispose();
    this.sockets.clear();
  }
}
