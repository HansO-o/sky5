/**
 * A creature's brain (keep/exit design §3.6 "CreatureBrain", §6.3 E5/E6): the fighting family of
 * `CombatBrain` with creature parameters (approach at its own speed, circle 3–5 m for 1.5–3 s,
 * bite or lunge, back off 1.5 m with the walk played backwards, a procedural reel instead of hit
 * clips, a death clip and the corpse stays), plus:
 * - sleep: `asleep → stir → wake` on its beast sensor's noise meter (stir 0.5, wake 1.0; any blow,
 *   the player too close or a clash nearby wakes it at once), standing up before it fights;
 * - a leash: a target beyond it sends it home (a snarl), where it rests and falls asleep again
 *   after 20 s (`events` "leash", "sleep"); a noise beyond it never wakes it (asleep it stirs: a
 *   warning), and without senses it turns on a foe that comes within its aggro radius again;
 * - fear: within 2 m of a torch small spiders back off for 1 s;
 * - a charge before its special (the wolf runs at 7 m/s for up to 1.2 s, then pounces); a creature
 *   without a run leaps at its foe instead (the spiders' jump from 3–5 m: `CombatBrain.attackMotion`);
 * - aggro: whoever hurt it last, switching to the companion 30 % of the time.
 */
import type { Awareness, Combatant } from "../combat/CombatSystem";
import type { XYZ } from "../combat/hit";
import { CombatBrain, type BrainClips, type CombatBrainOptions, type StaggerInfo } from "./CombatBrain";
import type { BrainState } from "./Brain";
import { BEAST, type Perception, type Sensor, type SensorSpec } from "./Perception";
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
  /**
   * while calm and awake without senses, it turns on a foe within this (m) that its leash lets it
   * chase (default: leashed creatures without a sensor `AI.creature.aggro`, others never)
   */
  aggro?: number | null;
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
  private aggro: number;
  private copts: CreatureBrainOptions;
  /** `sleep()` under way: the reset puts it to sleep whatever it was built as */
  private toSleep = false;

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
    this.aggro = o.aggro ?? (this.leash && !sensor ? AI.creature.aggro : 0);
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

  /** A beast built asleep goes back to sleep on `reset()` (a retry, a checkpoint: §11 "wolf asleep, meter 0"). */
  protected resetState() {
    return this.sleepClips && (this.toSleep || this.copts.asleep) ? "asleep" : super.resetState();
  }

  /**
   * Back to sleep now with its meter at 0, on its bed when it has a leash (`home`: default true):
   * a checkpoint's "a leashed wolf is back asleep" (§11) without despawning it. False when it can't
   * (no sleep clips, dead).
   */
  sleep(o: { home?: boolean } = {}): boolean {
    if (this.disposed || !this.sleepClips || !this.fsm || this.fsm.in("dead")) return false;
    const h = this.leash?.home;
    if (h && o.home !== false) this.agent.teleport(h, h.yaw);
    this.toSleep = true;
    try {
      this.reset();
    } finally {
      this.toSleep = false;
    }
    return this.fsm.in("asleep");
  }

  /**
   * A blow that breaks its poise while it sleeps, stirs or stands up: it reels where it lies (the
   * procedural push and rock) and stands up first, the wake segment and its howl, before it fights
   * (§6.3 E6), rather than skipping straight to a stagger.
   */
  protected staggered(s: StaggerInfo) {
    if (this.fsm.in("asleep") || this.fsm.in("stir") || this.fsm.in("wake")) {
      this.reel(s);
      if (!this.fsm.in("wake")) this.fsm.go("wake");
      return;
    }
    super.staggered(s);
  }

  protected calmAwareness(): Awareness {
    return this.fsm.in("asleep") || this.fsm.in("stir") ? "asleep" : "unaware";
  }

  protected onAlerted(at: XYZ | null) {
    const s = this.sensor;
    if (s && !s.alerted) s.alert(at);
  }

  protected get senseOrgan() {
    return this.sensor;
  }

  protected senses(on: boolean) {
    const s = this.sensor;
    if (!s) return;
    s.enabled = on;
    if (on) s.calm();
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

  alert(at: XYZ | null = null, by: Combatant | null = null, o: { relayed?: boolean } = {}) {
    if (at && !this.canChase(at)) {
      this.beyondLeash();
      return;
    }
    super.alert(at, by, o);
  }

  /**
   * Its sensor went off at something beyond the leash: no chase, and the sensor drops back below
   * alert (which would otherwise stick, so nothing could wake it again and the stealth eye would
   * read "seen" for good). Asleep or stirring it stays stirred, a warning; awake it settles.
   */
  private beyondLeash() {
    const s = this.sensor;
    if (!s?.alerted || !this.fsm || this.fsm.in("combat") || this.fsm.in("wake")) return;
    if (this.fsm.in("asleep") || this.fsm.in("stir")) s.calm("suspicious", BEAST.stir);
    else s.calm("unaware", 0.4);
  }

  /** The nearest foe within `r` m that the leash lets it chase. */
  private foeWithin(r: number): Combatant | null {
    const me = this.agent.position;
    let best: Combatant | null = null;
    let bd = r;
    for (const c of this.combat.enemiesOf(this.self)) {
      if (!this.canFight(c) || Math.abs(c.pose.y - me.y) > 3 || !this.canChase(c.pose)) continue;
      const d = this.dist(c);
      if (d <= bd) {
        bd = d;
        best = c;
      }
    }
    return best;
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
          const asleep = this.fsm.in("asleep") || this.fsm.in("stir");
          // no senses: a foe close by (inside the leash) is enough
          if (!s && this.aggro > 0 && !asleep) {
            const c = this.foeWithin(this.aggro);
            if (c) {
              this.target = c;
              this.retargetAt = this.time + AI.target.every;
              return "alert";
            }
          }
          if (!s?.alerted) return;
          if (this.canChase(s.lastKnown)) return asleep ? "wake" : "alert";
          // (a noise or a body beyond the leash: it stays put, watchful)
          this.beyondLeash();
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
