/**
 * The AI of a scene (keep/exit design §3.6; engine-framework §2.19 `AISystem`): brains think at
 * 10 Hz, time-sliced (`maxBrainsPerFrame`), perception looks at 5 Hz with at most 4 rays a frame,
 * noises go through one bus, agents keep their distance in one crowd, ragdolls are capped (2 at
 * once). Brains register themselves, so a script can find one by its combatant, id, body or name
 * (`suspend(ch)` / `resume(ch)`, design §3.6), and an alert spreads to the shouter's allies.
 * Dependencies come in through the constructor; the owner calls `update(dt)` on game time.
 */
import type { DisposerSink } from "../core/emitter";
import type { Disposer } from "../core/types";
import type { XYZ } from "../combat/hit";
import type { BrainSystem, CombatBrain } from "./CombatBrain";
import { NoiseBus } from "./noise";
import { Perception, type SightRay } from "./perception";
import { TimeSlicer } from "./slicer";
import { Crowd } from "./steering";
import { AI } from "./tuning";

/** Something that thinks on the AI's clock. */
export interface Thinker {
  think(dt: number): void;
}

/**
 * Ragdolls at once (§3.6: at most 2): a death may start one while fewer than `max` started in the
 * last `seconds` (the time a body takes to settle); the rest play a death clip.
 */
export class RagdollBudget {
  private ends: number[] = [];
  private time = 0;

  constructor(
    readonly max: number = AI.ragdolls,
    readonly seconds = 6,
  ) {}

  get active() {
    return this.ends.length;
  }

  /** Take a slot (true) or not (false: at the limit). */
  take(): boolean {
    if (this.ends.length >= this.max) return false;
    this.ends.push(this.time + this.seconds);
    return true;
  }

  update(dt: number) {
    this.time += Math.max(0, dt);
    if (this.ends.length && this.ends[0] <= this.time) this.ends = this.ends.filter((t) => t > this.time);
  }

  clear() {
    this.ends = [];
  }
}

export interface AISystemOptions {
  /** static line of sight (`Physics.rayCastStatic`); null: no occlusion */
  los?: SightRay | null;
  noise?: NoiseBus;
  perception?: Perception;
  /** brain rate (Hz; default 10) and brains per frame (default 12) */
  hz?: number;
  maxPerFrame?: number;
  /** ragdolls at once (default 2) */
  ragdolls?: number;
}

export class AISystem implements BrainSystem {
  readonly noise: NoiseBus;
  readonly perception: Perception;
  readonly crowd = new Crowd();
  readonly ragdolls: RagdollBudget;
  private slicer: TimeSlicer<Thinker>;
  private registry = new Set<CombatBrain>();
  private disposed = false;

  constructor(o: AISystemOptions = {}) {
    this.noise = o.noise ?? new NoiseBus();
    this.perception = o.perception ?? new Perception({ noise: this.noise, los: o.los ?? null });
    this.slicer = new TimeSlicer<Thinker>({ hz: o.hz ?? AI.hz, budget: o.maxPerFrame ?? AI.maxPerFrame });
    this.ragdolls = new RagdollBudget(o.ragdolls ?? AI.ragdolls);
  }

  /** How many brains may think in one frame (the rest think on the next). */
  get maxBrainsPerFrame() {
    return this.slicer.budget;
  }
  set maxBrainsPerFrame(n: number) {
    this.slicer.budget = n;
  }

  /** Think `hz` times a second (default 10), time-sliced with the rest. */
  add(b: Thinker, o: { hz?: number } = {}): Disposer {
    if (this.disposed) return () => {};
    return this.slicer.add(b, o);
  }

  /** Make a brain findable (`brainOf`, `suspend`) and reachable by alerts. */
  register(b: CombatBrain): Disposer {
    this.registry.add(b);
    return () => {
      this.registry.delete(b);
    };
  }

  get brains(): readonly CombatBrain[] {
    return [...this.registry];
  }

  /** The brain known by `key`: its combatant, the combatant's id, or one of its keys (its body, a name). */
  brainOf(key: unknown): CombatBrain | undefined {
    for (const b of this.registry) if (b.self === key || b.self.id === key || b.keys.includes(key)) return b;
    return undefined;
  }

  /**
   * A cutscene takes an actor (design §3.6 `ai.suspend(ch)`): its brain stops and lets go of the
   * body until `resume(key)` (or the scope ends; `untilHit`: or it takes a blow). False when no
   * brain is known by `key`.
   */
  suspend(key: unknown, o: { untilHit?: boolean; scope?: DisposerSink } = {}) {
    const b = this.brainOf(key);
    b?.suspend(o);
    return !!b;
  }

  /** Give an actor back to its brain (into `state`, default where it was). */
  resume(key: unknown, state?: string) {
    const b = this.brainOf(key);
    b?.resume(state);
    return !!b;
  }

  /**
   * `from` shouts: its group (however far) and its faction within `radius` m are alerted toward
   * `at`. Returns how many were.
   */
  alertAllies(from: CombatBrain, at: XYZ | null, radius: number = AI.alert.radius): number {
    let n = 0;
    const p = from.agent.position;
    for (const b of [...this.registry]) {
      if (b === from || !b.self.active || b.fighting || b.suspended) continue;
      const grouped = !!from.group && b.group === from.group;
      const near = b.self.faction === from.self.faction && Math.hypot(b.agent.position.x - p.x, b.agent.position.z - p.z) <= radius && Math.abs(b.agent.position.y - p.y) < 4;
      if (!grouped && !near) continue;
      b.alert(at, from.target);
      n++;
    }
    return n;
  }

  /** A ragdoll may start now. */
  ragdollSlot() {
    return this.ragdolls.take();
  }

  /** Advance `dt` seconds of game time: noises age, sensors look, brains think. */
  update(dt: number) {
    if (this.disposed || dt <= 0) return;
    this.noise.update(dt);
    this.perception.update(dt);
    this.ragdolls.update(dt);
    this.slicer.update(dt, (b, d) => {
      try {
        b.think(d);
      } catch (e) {
        console.error("ai think", e);
      }
      return 1;
    });
  }

  /** Every brain disposed, sensors and noises dropped. */
  dispose() {
    if (this.disposed) return;
    for (const b of [...this.registry]) b.dispose();
    this.registry.clear();
    this.slicer.clear();
    this.perception.dispose();
    this.noise.dispose();
    this.crowd.clear();
    this.ragdolls.clear();
    this.disposed = true;
  }
}
