/**
 * A creature's brain (keep/exit design §3.6 "CreatureBrain", §6.3 E5/E6): the fighting family of
 * `CombatBrain` with creature parameters (approach at its own speed, circle 3–5 m for 1.5–3 s,
 * bite or lunge, back off 1.5 m with the walk played backwards, a procedural reel instead of hit
 * clips, a death clip and the corpse stays), plus:
 * - sleep: `asleep → stir → wake` on its beast sensor's noise meter (stir 0.5, wake 1.0; any blow,
 *   the player too close or a clash nearby wakes it at once), standing up before it fights;
 * - a leash: a target beyond it sends it home (a snarl), where it rests and falls asleep again
 *   after 20 s (`events` "leash", "sleep");
 * - fear: within 2 m of a torch small spiders back off for 1 s;
 * - a charge before its special (the wolf runs at 7 m/s for up to 1.2 s, then pounces);
 * - aggro: whoever hurt it last, switching to the companion 30 % of the time.
 */
import type { Awareness, Combatant } from "../combat/CombatSystem";
import type { XYZ } from "../combat/hit";
import { CombatBrain, type BrainClips, type CombatBrainOptions } from "./CombatBrain";
import type { BrainState } from "./fsm";
import type { Perception, Sensor, SensorSpec } from "./perception";
import type { XZ } from "./steering";
import { AI } from "./tuning";

/** Sleeping and waking clips (logical or asset names; segments are the creature's profile's business). */
export interface SleepClips {
  /** asleep (loops) */
  sleep: string;
  /** stirring: head up (loops; default: stays on `sleep`) */
  stir?: string;
  /** standing up (one-shot) */
  wake?: string;
}

/** Where it lives, and how far from there it will chase. */
export interface Leash {
  /** its bed */
  home: XYZ & { yaw?: number };
  /** chases no target further than this from home (m; the wolf: 18) */
  radius: number;
  /** and none outside this (the wolf: not past `climb_s 23`) */
  inside?(p: XZ): boolean;
}

export interface CreatureBrainOptions extends CombatBrainOptions {
  /** its beast sensor: a perception to add one to (spec overrides), or a ready sensor */
  perception?: Perception | null;
  sensor?: Partial<Omit<SensorSpec, "position" | "yaw">> | Sensor | null;
  /** starts asleep (needs `sleep` clips) */
  asleep?: boolean;
  sleep?: SleepClips | null;
  leash?: Leash | null;
  /** something it shies away from (the companion's torch): where and how close */
  fear?: (() => (XZ & { r?: number }) | null) | null;
  /** the companion, which it turns on 30 % of the time */
  companion?: (() => Combatant | null) | null;
  /** clips: `idle` while calm and awake; deaths etc. as in `BrainClips` */
  clips?: Partial<BrainClips> & { idle?: string };
  /** start in the fight (default: true unless asleep or with a sensor) */
  aware?: boolean;
}

export class CreatureBrain extends CombatBrain {
  readonly sensor: Sensor | null;
  readonly leash: Leash | null;
  private ownSensor: { p: Perception; s: Sensor } | null = null;
  private sleepClips: SleepClips | null;
  private homeSince = 0;
  private fearAt = -Infinity;
  /** brain time its target was first seen beyond the leash (null: within) */
  private leashOut: number | null = null;
  private copts: CreatureBrainOptions;

  constructor(o: CreatureBrainOptions) {
    super({ ...o, clips: { alert: null, ...o.clips } });
    this.copts = o;
    this.sleepClips = o.sleep ?? null;
    this.leash = o.leash ?? null;
    const a = o.agent;
    let sensor: Sensor | null = null;
    if (o.sensor && "meter" in o.sensor) sensor = o.sensor;
    else if (o.perception && o.sensor !== null) {
      const spec = (o.sensor ?? {}) as Partial<SensorSpec>;
      sensor = o.perception.addSensor({ id: o.self.id, kind: "beast", ...spec, position: () => a.position, yaw: () => a.yaw });
      this.ownSensor = { p: o.perception, s: sensor };
    }
    this.sensor = sensor;
    if (sensor)
      this.offs.push(
        sensor.changes.on((c) => {
          if (this.disposed || !this.fsm) return;
          if (c.level === "alert") this.alert(sensor.lastKnown);
          else if (c.level === "suspicious" && this.fsm.state === "asleep") this.fsm.go("stir");
          else if (c.level === "unaware" && this.fsm.state === "stir") this.fsm.go("asleep");
        }),
      );
    const asleep = !!o.asleep && !!this.sleepClips;
    const aware = o.aware ?? (!asleep && !sensor);
    this.start({ ...this.combatStates(), ...this.creatureStates() }, asleep ? "asleep" : aware ? "alert" : "idle");
  }

  protected calmState() {
    if (this.leash && this.awayFromHome() > AI.beast.homeStop) return "return";
    return this.sleepClips && this.leash ? "rest" : "idle";
  }

  protected calmAwareness(): Awareness {
    return this.fsm.in("asleep") || this.fsm.in("stir") ? "asleep" : "unaware";
  }

  protected onAlerted(at: XYZ | null) {
    const s = this.sensor;
    if (s && !s.alerted) s.alert(at);
  }

  /** Whether the leash lets it chase something at `p`. */
  canChase(p: XZ | null) {
    const l = this.leash;
    if (!l || !p) return true;
    return Math.hypot(p.x - l.home.x, p.z - l.home.z) <= l.radius && (!l.inside || l.inside(p));
  }

  /** Asleep or stirring, it stands up first; never after something beyond its leash. */
  engage(target?: Combatant | null) {
    if (!this.fsm || (target && !this.canChase(target.pose))) return;
    if (this.fsm.in("asleep") || this.fsm.in("stir")) {
      if (target) this.target = target;
      this.fsm.go("wake");
      return;
    }
    if (this.fsm.in("wake")) {
      if (target) this.target = target;
      return;
    }
    super.engage(target);
  }

  alert(at: XYZ | null = null, by: Combatant | null = null) {
    if (at && !this.canChase(at)) return;
    super.alert(at, by);
  }

  /** Every combat update: the leash (a target beyond it for 1.5 s sends it home), the torch. */
  protected combatCheck(): string | void {
    const t = this.target;
    if (t && this.leash && !this.canChase(t.pose)) {
      this.leashOut ??= this.time;
      if (this.time - this.leashOut >= 1.5) return "return";
    } else this.leashOut = null;
    const fear = this.copts.fear?.();
    if (fear && this.fsm.state !== "backoff" && this.fsm.state !== "attack" && this.fsm.state !== "stagger" && this.time - this.fearAt > AI.creature.fear.seconds + 0.5) {
      const me = this.agent.position;
      if (Math.hypot(me.x - fear.x, me.z - fear.z) < (fear.r ?? AI.creature.fear.r)) {
        this.fearAt = this.time;
        this.backoffFor = AI.creature.fear.seconds;
        return "backoff";
      }
    }
  }

  protected specialState() {
    return this.fighter.speed?.run ? "charge" : "attack";
  }

  /** The last one to hurt it, or (30 % of the time) the companion. */
  protected afterAttack(): string {
    const next = super.afterAttack();
    const comp = this.copts.companion?.();
    if (comp && comp.active && !comp.down && this.target !== comp && this.random() < AI.beast.switchToCompanion) this.forceTarget(comp, 4);
    return next;
  }

  private awayFromHome() {
    const h = this.leash?.home;
    if (!h) return 0;
    const me = this.agent.position;
    return Math.hypot(me.x - h.x, me.z - h.z);
  }

  private creatureStates(): Record<string, BrainState<CombatBrain>> {
    const sl = () => this.sleepClips;
    return {
      calm: {
        update: () => {
          const s = this.sensor;
          if (!s?.alerted || this.fsm.in("asleep") || this.fsm.in("stir")) return;
          // (a noise or a body beyond the leash: it stays put, watchful)
          if (this.canChase(s.lastKnown)) return "alert";
          s.calm("unaware", 0.4);
        },
      },
      idle: {
        parent: "calm",
        enter: () => {
          this.agent.stop();
          this.agent.face(null);
          const idle = this.copts.clips?.idle;
          if (idle) this.agent.act(idle, { loop: true, blend: 0.3 });
        },
        exit: () => {
          if (this.agent.acting === this.copts.clips?.idle) this.agent.act(null);
        },
      },
      asleep: {
        parent: "calm",
        enter: () => {
          this.agent.stop();
          const c = sl();
          if (c) this.agent.act(c.sleep, { loop: true, blend: 0.6 });
          this.events.emit({ type: "bark", kind: "sleep" });
        },
      },
      stir: {
        parent: "calm",
        enter: () => {
          const c = sl();
          if (c?.stir) this.agent.act(c.stir, { loop: true, blend: 0.8 });
          this.events.emit({ type: "bark", kind: "stir" });
        },
      },
      wake: {
        enter: () => {
          this.sensor?.alert(this.target?.pose ?? null);
          const c = sl();
          const len = c?.wake ? this.agent.act(c.wake, { blend: 0.2 }) : 0;
          this.timer = len || AI.beast.stand;
          this.events.emit({ type: "bark", kind: "wake" });
        },
        update: () => {
          const t = this.target ?? this.pickTarget();
          if (t) this.agent.face(() => t.pose);
          if (this.fsm.elapsed() >= this.timer) return "alert";
        },
      },
      return: {
        parent: "calm",
        enter: () => {
          this.releaseToken();
          this.target = null;
          this.forced = null;
          this.leashOut = null;
          this.sensor?.calm("unaware", 0);
          this.events.emit({ type: "bark", kind: "leash" });
        },
        update: () => {
          const h = this.leash?.home;
          if (!h) return "idle";
          if (this.awayFromHome() <= AI.beast.homeStop) return this.sleepClips ? "rest" : "idle";
          this.agent.moveTo(h, this.fighter.speed?.move ?? 2, 0.3);
          this.agent.face(null);
        },
      },
      rest: {
        parent: "calm",
        enter: () => {
          this.homeSince = this.time;
          this.agent.stop();
          const y = this.leash?.home.yaw;
          if (y !== undefined) this.agent.face(y);
        },
        update: () => {
          if (this.time - this.homeSince >= AI.beast.sleepAfter) {
            this.sensor?.calm("unaware", 0);
            return this.sleepClips ? "asleep" : "idle";
          }
        },
      },
      charge: {
        parent: "combat",
        enter: () => {
          this.timer = 1.2;
        },
        update: () => {
          const t = this.target;
          if (!t) return "circle";
          const reach = this.strikeDistance(this.nextDef(), t);
          if (this.dist(t) <= reach || this.fsm.elapsed() >= this.timer) return "attack";
          this.agent.moveTo(() => t.pose, this.fighter.speed?.run ?? 6, reach - 0.1, 0);
          this.agent.face(() => t.pose);
        },
      },
    };
  }

  dispose() {
    if (this.ownSensor) this.ownSensor.p.removeSensor(this.ownSensor.s);
    this.ownSensor = null;
    super.dispose();
  }
}
