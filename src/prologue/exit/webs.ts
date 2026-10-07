import { Quaternion, Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import type { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { assets } from "../../core/assets/AssetClient";
import { audio } from "../../core/audio";
import { Emitter } from "../../engine/core/emitter";
import type { Disposer } from "../../engine/core/types";
import type { CombatEvent, Combatant } from "../../engine/combat/CombatSystem";
import type { BodyId, Physics } from "../../engine/physics/Physics";
import type { Interactable, Interactables } from "../../engine/world/Interactables";
import { KEEP_PROMPTS } from "../chapters/keepScript";
import type { World } from "../World";
import type { WebDef } from "./layout";
import { WEB, WebCut, webInSwing } from "./rules";

/** Who brought a web wall down. */
export type CutBy = "player" | "companion" | "script";

export type WebEvent = { type: "hit"; hits: number } | { type: "cut"; by: CutBy };

/** What a web listens to: the combat system's events and the player's combatant (`PrologueCombat` fits). */
export interface SwingSource {
  readonly system: { readonly events: { on(fn: (e: CombatEvent) => void): Disposer } };
  readonly player: Combatant;
}

/** One shown part of the world: its meshes, and how it stood when built (restored when it comes back). */
interface Shape {
  node: TransformNode | null;
  meshes: AbstractMesh[];
  pos: Vector3 | null;
  scaling: Vector3 | null;
  /** its rotation as built (glTF nodes turn by quaternion; null: Euler angles, zero) */
  rot: Quaternion | null;
}

function shapeOf(node: TransformNode | null): Shape {
  const meshes = node ? ([node, ...node.getChildMeshes(false)].filter((m) => "getTotalVertices" in m && (m as AbstractMesh).getTotalVertices() > 0) as AbstractMesh[]) : [];
  return { node, meshes, pos: node?.position.clone() ?? null, scaling: node?.scaling.clone() ?? null, rot: node?.rotationQuaternion?.clone() ?? null };
}

const tmpQ = new Quaternion();
const AXIS_Z = new Vector3(0, 0, 1);

/** Tilt a shape `angle` rad about its own Z from how it was built. */
function tilt(s: Shape, angle: number) {
  const n = s.node;
  if (!n) return;
  if (s.rot) {
    n.rotationQuaternion ??= s.rot.clone();
    s.rot.multiplyToRef(Quaternion.RotationAxisToRef(AXIS_Z, angle, tmpQ), n.rotationQuaternion);
  } else n.rotation.z = angle;
}

/**
 * Hidden for good (a cut web, an opened cocoon) or back as built. The underground's sets switch
 * `setEnabled` on these nodes as zones come and go, so "gone" is `isVisible`, which they leave alone.
 */
function showShape(s: Shape, on: boolean) {
  if (s.node && s.pos && s.scaling) {
    s.node.position.copyFrom(s.pos);
    s.node.scaling.copyFrom(s.scaling);
    tilt(s, 0);
  }
  for (const m of s.meshes) {
    m.isVisible = on;
    m.visibility = 1;
    m.computeWorldMatrix(true);
  }
}

/**
 * Animate a shape away over `seconds` of game time (`step(u)` poses it at 0..1): `done` resolves
 * when it is gone (hidden), or when `cancel()` stopped it first (a checkpoint posing it meanwhile).
 */
function animateAway(world: World, s: Shape, seconds: number, step: (u: number) => void): { done: Promise<void>; cancel(): void } {
  // (the cave's static meshes have frozen world matrices: they move again while this runs)
  for (const m of s.meshes) m.unfreezeWorldMatrix();
  if (s.node && !s.meshes.includes(s.node as AbstractMesh) && "unfreezeWorldMatrix" in s.node) (s.node as AbstractMesh).unfreezeWorldMatrix();
  let off: () => void = () => {};
  let finish: () => void = () => {};
  const done = new Promise<void>((resolve) => {
    let t = 0;
    finish = () => {
      off();
      resolve();
    };
    off = world.onUpdate((dt) => {
      t += dt;
      const u = Math.min(1, t / seconds);
      try {
        step(u);
      } catch (e) {
        console.error("exit: dissolve", e);
      }
      if (u < 1 && !world.disposed) return;
      for (const m of s.meshes) m.isVisible = false;
      finish();
    }) as () => void;
  });
  return { done, cancel: () => finish() };
}

function sfx(id: string, at: Vector3, volume: number) {
  if (assets.has(id)) void audio.playOneShot(id, volume, at, "sfx", 0.95 + Math.random() * 0.1, 3);
}

/**
 * A web wall of the spider chamber (`web_A` at its east door, `web_B` at its west door; design
 * §4.3, §6.1 X1): three cards and one box collider. Three blows of any attack or one heavy bring it
 * down (`arm(combat)` counts the player's swings that reach it); the companion's fallback and the
 * soft-lock timer call `cutNow()`. Cut, its collider goes at once, the cards sag and dissolve, and
 * the flag `looted` records it (`record`). `set()` poses it for a checkpoint without a sound.
 */
export class CaveWeb {
  readonly events = new Emitter<WebEvent>();
  private state = new WebCut();
  private shape: Shape;
  private dissolving: { done: Promise<void>; cancel(): void } | null = null;
  private disposed = false;

  constructor(
    private o: {
      id: "web_A" | "web_B";
      /** its flag id (`EXIT_IDS.webA` / `webB`) */
      flag: string;
      world: World;
      physics: Physics;
      /** `web_X_cards` */
      cards: TransformNode | null;
      /** the `web_X` body (tag `web_A` / `web_B`) */
      body: BodyId | null;
      def: WebDef | null;
      /** write the flag (it is gone for good) */
      record(flag: string): void;
    },
  ) {
    this.shape = shapeOf(o.cards);
  }

  get id() {
    return this.o.id;
  }

  get cut() {
    return this.state.cut;
  }

  get hits() {
    return this.state.hits;
  }

  /** The middle of the wall at chest height (where the companion swings, the marker points). */
  get centre(): Vector3 {
    const d = this.o.def;
    if (d) return new Vector3(d.centre[0], d.floor + 1.3, d.centre[2]);
    const n = this.o.cards;
    return n ? n.getAbsolutePosition().clone() : Vector3.Zero();
  }

  /** The floor in front of the wall on the side its normal points away from (where to stand to cut it). */
  standPoint(side: 1 | -1 = -1, distance = 1.3): Vector3 {
    const d = this.o.def;
    if (!d) return this.centre;
    return new Vector3(d.centre[0] + d.normal[0] * distance * side, d.floor, d.centre[2] + d.normal[2] * distance * side);
  }

  /**
   * Count the player's swings that reach the wall (the combat system's `swing` event: the strike
   * window opening), each once. The disposer stops listening.
   */
  arm(combat: SwingSource): Disposer {
    return combat.system.events.on((e) => {
      if (e.type !== "swing" || e.attacker !== combat.player || this.cut || this.disposed || !this.o.def) return;
      if (!webInSwing(e.attacker.pose, e.attack, this.o.def)) return;
      this.blow(!!e.attack.heavy);
    });
  }

  /** One blow (a heavy cuts at once); true when it brought the wall down. */
  blow(heavy: boolean, by: CutBy = "player"): boolean {
    if (this.cut || this.disposed) return false;
    const fell = this.state.hit(heavy);
    if (fell) {
      this.fall(by);
      return true;
    }
    sfx("audio/sfx_web", this.centre, 0.35);
    this.shiver();
    this.events.emit({ type: "hit", hits: this.state.hits });
    return false;
  }

  /** Bring it down (the companion's cut, the soft-lock timer, a script). */
  cutNow(by: CutBy = "script") {
    if (this.cut || this.disposed) return;
    this.state.give();
    this.fall(by);
  }

  /** Resolves once a cut wall has finished dissolving (at once when intact or already gone). */
  get gone(): Promise<void> {
    return this.dissolving?.done ?? Promise.resolve();
  }

  /** Pose it for a checkpoint: standing (false) or gone (true), without a sound or an event. */
  set(cut: boolean) {
    if (this.disposed) return;
    this.dissolving?.cancel();
    this.dissolving = null;
    if (cut) {
      this.state.give();
      showShape(this.shape, false);
      this.collider(false);
      return;
    }
    this.state = new WebCut();
    showShape(this.shape, true);
    this.collider(true);
  }

  private collider(on: boolean) {
    const id = this.o.body;
    if (id !== null && this.o.physics.bodyEnabled(id) !== on) this.o.physics.setBodyEnabled(id, on);
  }

  private fall(by: CutBy) {
    this.collider(false);
    this.o.record(this.o.flag);
    sfx("audio/sfx_web", this.centre, 0.75);
    const s = this.shape;
    const n = s.node;
    const p0 = s.pos?.clone() ?? null, k0 = s.scaling?.clone() ?? null;
    const lean = (Math.random() - 0.5) * 0.3;
    // the cut cards sag to the floor and fade out
    this.dissolving = animateAway(this.o.world, s, WEB.dissolve, (u) => {
      const e = u * u;
      if (n && p0 && k0) {
        n.position.set(p0.x, p0.y - 1.1 * e, p0.z);
        n.scaling.set(k0.x, k0.y * (1 - 0.45 * e), k0.z);
        tilt(s, lean * u);
      }
      for (const m of s.meshes) m.visibility = 1 - u;
    });
    this.events.emit({ type: "cut", by });
  }

  /** A blow that didn't bring it down: the cards shiver for a moment. */
  private shiver() {
    const s = this.shape;
    if (!s.node || this.dissolving) return;
    for (const m of s.meshes) m.unfreezeWorldMatrix();
    let t = 0;
    const off = this.o.world.onUpdate((dt) => {
      t += dt;
      if (this.disposed || this.dissolving || t >= 0.35) {
        off();
        if (!this.dissolving) tilt(s, 0);
        return;
      }
      tilt(s, Math.sin(t * 40) * 0.02 * (1 - t / 0.35));
    });
  }

  dispose() {
    this.disposed = true;
    this.events.clear();
  }
}

/**
 * The courier's cocoon (`cocoon_courier` at anchor `cocoon`; design §4.3, §6.1 X1): an optional
 * hold-E search (搜查). Searched, it splits and shrinks away, its collider goes, and the flag
 * `looted` records it; the chapter reads the letter (X1-L) in `target()`'s `use`.
 */
export class CaveCocoon {
  private shape: Shape;
  private opened = false;
  private shrinking: { cancel(): void } | null = null;

  constructor(
    private o: {
      flag: string;
      world: World;
      physics: Physics;
      /** `cocoon_courier_mesh` */
      mesh: TransformNode | null;
      body: BodyId | null;
      /** where it lies (anchor `cocoon`) */
      at: Vector3;
      record(flag: string): void;
    },
  ) {
    this.shape = shapeOf(o.mesh);
  }

  get searched() {
    return this.opened;
  }

  get position() {
    return this.o.at.clone();
  }

  /**
   * The hold-E target on `set` (label 搜查, the kneel): searched, it opens and `use` runs (the
   * letter). Null once searched.
   */
  target(set: Interactables, use: () => unknown): Interactable | null {
    if (this.opened) return null;
    return set.add({
      id: "exit_cocoon",
      pos: this.o.at,
      label: KEEP_PROMPTS.search,
      hold: true,
      // (it lies inside its own collider, against the wall)
      sight: false,
      use: () => {
        this.open();
        return use();
      },
    });
  }

  /** Cut it open now. */
  open() {
    if (this.opened) return;
    this.opened = true;
    this.o.record(this.o.flag);
    this.collider(false);
    sfx("audio/sfx_web", this.o.at, 0.5);
    const s = this.shape;
    const n = s.node;
    const k0 = s.scaling?.clone() ?? null;
    // (shrinking, not fading: its material is opaque, and a visibility under 1 would recompile it blended)
    this.shrinking = animateAway(this.o.world, s, 0.7, (u) => {
      const k = 1 - 0.85 * u * u;
      if (n && k0) n.scaling.set(k0.x * k, k0.y * k, k0.z * (1 - 0.3 * u));
    });
  }

  /** Pose it for a checkpoint (searched: gone). */
  set(searched: boolean) {
    this.shrinking?.cancel();
    this.shrinking = null;
    this.opened = searched;
    showShape(this.shape, !searched);
    this.collider(!searched);
  }

  private collider(on: boolean) {
    const id = this.o.body;
    if (id !== null && this.o.physics.bodyEnabled(id) !== on) this.o.physics.setBodyEnabled(id, on);
  }
}
