/**
 * A human enemy's brain (keep/exit design §3.6, §9): the fighting family of `CombatBrain` under a
 * calm family that is
 *
 *   post (stands, sits or works at its place; walks back to it) → suspicious (turns toward and
 *   walks to the last noise, looks around, gives up) → alert (barks; the shout alerts allies of the
 *   faction within 15 m, or its whole group) → the fight
 *
 * driven by its perception sensor (sight cone 110°/160°, 15 m, hearing, thresholds 0.5 / 1.0). A
 * blow it takes, an ally's shout or `engage()` alert it at once. Archers shoot beyond 4 m and draw
 * a knife within it; a fighter with a `ring` (the interrogator's 2–3 m) kites at that distance.
 */
import type { Awareness } from "../combat/CombatSystem";
import type { XYZ } from "../combat/hit";
import { CombatBrain, type CombatBrainOptions } from "./CombatBrain";
import type { BrainState } from "./Brain";
import { PERCEPTION, type Perception, type Sensor, type SensorSpec } from "./Perception";
import { AI } from "./tuning";

/** Where a calm humanoid belongs, and what it does there. */
export interface Post {
  x: number;
  y?: number;
  z: number;
  /** facing while there */
  yaw?: number;
  /** clip it loops there (Sitting_Idle_Loop, Fixing_Kneeling…; default the gait's idle) */
  clip?: string;
}

export interface HumanoidBrainOptions extends CombatBrainOptions {
  /**
   * its senses: a perception to add a sensor to (with spec overrides, e.g. `{ sight: false }` for
   * the seated jailer who only hears until alerted), or a ready sensor; none: it only fights when
   * engaged, hit or shouted at
   */
  perception?: Perception | null;
  sensor?: Partial<Omit<SensorSpec, "position" | "yaw">> | Sensor | null;
  /** where it stands while calm (default: where it starts, facing its start yaw) */
  post?: Post | null;
  /** start in the fight (default true without a sensor, false with one) */
  aware?: boolean;
}

export class HumanoidBrain extends CombatBrain {
  /** its senses (null: none) */
  readonly sensor: Sensor | null;
  post: Post;
  private ownSensor: { p: Perception; s: Sensor } | null = null;
  private investigate: XYZ | null = null;
  /** brain-state seconds when it reached the noise (null: not yet), and the facing it looks around from */
  private arrived: number | null = null;
  private lookBase = 0;

  constructor(o: HumanoidBrainOptions) {
    super(o);
    const a = o.agent;
    this.post = o.post ?? { x: a.position.x, y: a.position.y, z: a.position.z, yaw: a.yaw };
    let sensor: Sensor | null = null;
    if (o.sensor && "meter" in o.sensor) sensor = o.sensor;
    else if (o.perception && o.sensor !== null) {
      const spec = (o.sensor ?? {}) as Partial<SensorSpec>;
      sensor = o.perception.addSensor({ id: o.self.id, kind: "human", ...spec, position: () => a.position, yaw: () => a.yaw });
      this.ownSensor = { p: o.perception, s: sensor };
    }
    this.sensor = sensor;
    if (sensor)
      this.offs.push(
        sensor.changes.on((c) => {
          if (this.disposed || !this.fsm) return;
          if (c.level === "alert") this.alert(sensor.lastKnown);
          else if (c.level === "suspicious" && this.fsm.state === "post") this.fsm.go("suspicious");
        }),
      );
    const aware = o.aware ?? !sensor;
    this.start({ ...this.combatStates(), ...this.calmStates() }, aware ? "alert" : "post");
  }

  protected calmState() {
    this.sensor?.calm();
    return "post";
  }

  protected calmAwareness(): Awareness {
    const l = this.sensor?.level;
    return l === "suspicious" ? "suspicious" : l === "alert" ? "alert" : "unaware";
  }

  protected onAlerted(at: XYZ | null) {
    const s = this.sensor;
    if (s && !s.alerted) s.alert(at);
  }

  protected senses(on: boolean) {
    const s = this.sensor;
    if (!s) return;
    s.enabled = on;
    if (on) s.calm();
  }

  private calmStates(): Record<string, BrainState<CombatBrain>> {
    return {
      calm: {
        update: () => {
          if (this.sensor?.alerted) return "alert";
        },
      },
      post: {
        parent: "calm",
        enter: () => {
          this.investigate = null;
          this.agent.face(null);
        },
        update: () => {
          const p = this.post;
          const me = this.agent.position;
          const d = Math.hypot(p.x - me.x, p.z - me.z);
          if (d > AI.post.tolerance) {
            if (p.clip && this.agent.acting === p.clip) this.agent.act(null);
            this.agent.moveTo(p, AI.post.speed, 0.1);
            this.agent.face(null);
            return;
          }
          this.agent.stop();
          if (p.yaw !== undefined) this.agent.face(p.yaw);
          if (p.clip && this.agent.acting !== p.clip) this.agent.act(p.clip, { loop: true, blend: 0.4 });
        },
        exit: () => {
          const p = this.post;
          if (p.clip && this.agent.acting === p.clip) this.agent.act(null);
        },
      },
      suspicious: {
        parent: "calm",
        enter: () => {
          this.events.emit({ type: "bark", kind: "suspicious" });
          this.agent.stop();
          const s = this.sensor;
          // the freshest clue: a glimpse, else the last noise
          this.investigate = s?.lastKnown ?? s?.lastNoise ?? null;
          this.arrived = null;
          if (this.investigate) this.agent.face(this.investigate);
        },
        update: () => {
          const s = this.sensor;
          const e = this.fsm.elapsed();
          // a fresher clue (another noise, a glimpse): that is where to look now
          if (s?.lastKnown && s.lastKnown !== this.investigate && s.meter >= PERCEPTION.suspicious) {
            this.investigate = s.lastKnown;
            this.arrived = null;
          }
          // first it turns toward the noise
          if (e < 0.6) return;
          const at = this.investigate;
          if (this.arrived === null) {
            const me = this.agent.position;
            // (arrived a little short of the stop distance: steering eases in and stops 2 cm short)
            if (at && Math.hypot(at.x - me.x, at.z - me.z) > AI.investigate.stop + 0.15 && this.agent.stuckFor < 2) {
              this.agent.moveTo(at, AI.investigate.speed, AI.investigate.stop);
              this.agent.face(null);
            } else {
              this.agent.stop();
              this.arrived = e;
              this.lookBase = this.agent.yaw;
            }
          }
          if (this.arrived !== null) {
            // looks left, right, ahead
            const k = Math.floor((e - this.arrived) / 1.2) % 3;
            this.agent.face(this.lookBase + [0.8, -0.8, 0][k]);
          }
          const looked = this.arrived !== null && e - this.arrived > AI.investigate.look;
          if ((looked && (!s || s.level === "unaware")) || e > AI.investigate.giveUp) {
            this.events.emit({ type: "bark", kind: "calm" });
            s?.calm();
            return "post";
          }
        },
        exit: () => {
          this.arrived = null;
          this.agent.face(null);
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
