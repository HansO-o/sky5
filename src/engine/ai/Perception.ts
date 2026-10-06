/**
 * Perception and stealth (keep/exit design §9): what an NPC sees and hears of its targets (the
 * player), integrated into an awareness meter with thresholds (suspicious 0.5, alert 1.0), and a
 * beast's noise meter (the sleeping wolf: stir 0.5, wake 1.0). Sensors look 5 times a second in
 * round robin, with at most 4 line-of-sight rays per frame (`Perception`). The rates are pure
 * functions, unit-tested against §9's numbers.
 *
 * Engine-framework §2.19 names this module `ai/Perception.ts` with `canSee()` and
 * `createPerception(ph)`; both are here. Its noise channel is a {@link NoiseBus} (kinds, radii,
 * steady sources, one-shots) rather than a plain `Emitter`: the bus's `events` is that emitter.
 */
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Emitter } from "../core/emitter";
import type { Disposer } from "../core/types";
import type { XYZ } from "../combat/hit";
import { BEAST_HEARING, BEAST_ONESHOT, HEARING, NoiseBus } from "./noise";
import { TimeSlicer } from "./slicer";

/** Human perception (§9). Angles are the whole cone (degrees). */
export const PERCEPTION = {
  /** looks per second per sensor, and line-of-sight rays per frame for all of them */
  hz: 5,
  raysPerFrame: 4,
  /** eye height above the feet, and the target's chest the rays aim at (m) */
  eye: 1.6,
  chest: 1.2,
  /** sight range indoors and in the cave (m) */
  range: 15,
  fov: { unaware: 110, alert: 160 },
  /** light at the target below `below`: sight ×`mul` */
  dark: { below: 0.2, mul: 0.5 },
  /** sight multipliers: sneaking, moving */
  sneak: 0.35,
  moving: 1.3,
  /** hearing: (1 − d/r) × this per second, d on the ground plane (§9's radii are plain distances);
   * a height difference beyond `hearBand` (a storey) counts in full */
  hear: 0.9,
  hearBand: 2,
  /** the meter falls this much per second */
  decay: 0.15,
  /** thresholds: suspicious from 0.5, alert at 1.0; suspicion fades below `calm` */
  suspicious: 0.5,
  alert: 1,
  calm: 0.35,
} as const;

/** A beast's meter (§9 "Wolf", §6.3 E6): noise only. */
export const BEAST = {
  /** eye height of a beast (m: the wolf lying, a spider) */
  eye: 0.6,
  decay: 0.1,
  /** stir from 0.5, wake at 1.0; a stirred beast settles back below `settle` */
  stir: 0.5,
  wake: 1,
  settle: 0.3,
  /** the target this close wakes it at once (m): sneaking / otherwise */
  proximity: { sneaking: 2, other: 3 },
  /** noises of these kinds this close wake it at once (m): a weapon clash within 12 m */
  instant: { clash: 12 } as Readonly<Record<string, number>>,
} as const;

/** How aware a sensor is: a beast's "suspicious" is stirring, its "alert" is awake. */
export type AwarenessLevel = "unaware" | "suspicious" | "alert";

// ------------------------------------------------------------------------------------------- pure

/** Sight rate per second at distance `d` (§9): (1 − d/range) × light × sneaking × moving. */
export function sightRate(d: number, o: { range?: number; light?: number; sneaking?: boolean; moving?: boolean } = {}) {
  const range = o.range ?? PERCEPTION.range;
  if (d >= range) return 0;
  const light = (o.light ?? 1) < PERCEPTION.dark.below ? PERCEPTION.dark.mul : 1;
  return (1 - Math.max(0, d) / range) * light * (o.sneaking ? PERCEPTION.sneak : 1) * (o.moving ? PERCEPTION.moving : 1);
}

/** Hearing rate per second of a noise of radius `r` at distance `d` (§9): (1 − d/r) × 0.9. */
export function hearRate(d: number, r: number) {
  if (!(r > 0) || d >= r) return 0;
  return (1 - Math.max(0, d) / r) * PERCEPTION.hear;
}

/** A beast's rate per second for one noise (§9): w · clamp(1 − d/r, 0, 1). */
export function beastRate(d: number, r: number, w: number) {
  if (!(r > 0)) return 0;
  return w * Math.min(1, Math.max(0, 1 - d / r));
}

/**
 * The distance a noise at `n` is heard over by a listener standing at `feet` (§9): on the ground
 * plane, plus whatever height difference exceeds `band` m (a noise a floor up or down is that much
 * further; one at chest or ankle height is not).
 */
export function hearingDistance(feet: XYZ, n: XYZ, band: number = PERCEPTION.hearBand) {
  return Math.hypot(n.x - feet.x, n.z - feet.z, Math.max(0, Math.abs(n.y - feet.y) - band));
}

/** Whether `p` is inside the horizontal cone of `fovDeg` (whole angle) looking along `yaw` from `eye`. */
export function inCone(eye: { x: number; z: number }, yaw: number, p: { x: number; z: number }, fovDeg: number) {
  const dx = p.x - eye.x, dz = p.z - eye.z;
  const len = Math.hypot(dx, dz);
  if (len < 1e-6) return true;
  // forward = (−sin yaw, −cos yaw)
  const cos = (-Math.sin(yaw) * dx - Math.cos(yaw) * dz) / len;
  return cos >= Math.cos(((fovDeg / 2) * Math.PI) / 180) - 1e-9;
}

/** The level a meter reads as, from the level it had (alert stays; suspicion fades below `calm`). */
export function levelOf(meter: number, prev: AwarenessLevel, kind: "human" | "beast" = "human"): AwarenessLevel {
  const t = kind === "beast" ? { up: BEAST.stir, alert: BEAST.wake, down: BEAST.settle } : { up: PERCEPTION.suspicious, alert: PERCEPTION.alert, down: PERCEPTION.calm };
  if (prev === "alert" || meter >= t.alert - 1e-9) return "alert";
  if (meter >= t.up || (prev === "suspicious" && meter >= t.down)) return "suspicious";
  return "unaware";
}

// ------------------------------------------------------------------------------------------ sensors

/** Something sensors look for (the player). */
export interface PerceptionTarget {
  id: string;
  /** feet */
  position(): XYZ;
  /** chest height above the feet that rays aim at (default 1.2) */
  chest?: number;
  sneaking(): boolean;
  moving(): boolean;
  /** light at the target, 0..1 (default 1) */
  light?(): number;
  /** not perceivable now (a cutscene, dead) */
  hidden?(): boolean;
}

export interface SensorSpec {
  id: string;
  /** "human" (sight and hearing, §9) or "beast" (noise only, the wolf's meter) */
  kind?: "human" | "beast";
  /** feet */
  position(): XYZ;
  /** facing (forward = (−sin, −cos)) */
  yaw(): number;
  /** eye height (default: humans 1.6, beasts 0.6) */
  eye?: number;
  /** sees (default: humans yes, beasts no); changeable later (`sensor.sight`) */
  sight?: boolean;
  /** hears (default yes) */
  hearing?: boolean;
  /** sight range (m; default 15) */
  range?: number;
  /** cone (whole angle, degrees) while unaware / once suspicious or alert (default 110 / 160) */
  fov?: { unaware: number; alert: number };
  /** a target this close alerts at once (m; beasts default 2 sneaking / 3 otherwise; humans none) */
  proximity?: { sneaking: number; other: number } | null;
  /** noise kinds that alert at once within the given radius (beasts default: clash 12 m) */
  instant?: Readonly<Record<string, number>> | null;
  /** meter loss per second (default 0.15 humans, 0.10 beasts) */
  decay?: number;
}

export interface SensorChange {
  sensor: Sensor;
  level: AwarenessLevel;
  prev: AwarenessLevel;
}

/** One NPC's senses and awareness meter (made by `Perception.addSensor`). */
export class Sensor {
  /** awareness 0..1 */
  meter = 0;
  level: AwarenessLevel = "unaware";
  /** looks at all (false: blind and deaf, the meter holds) */
  enabled = true;
  /** sees (`spec.sight`; a seated jailer only hears until alerted) */
  sight: boolean;
  hearing: boolean;
  /** the last noise it noticed and the last place it saw a target (null: none yet) */
  lastNoise: XYZ | null = null;
  lastSeen: XYZ | null = null;
  /** a target was in sight at the last look */
  seeing = false;
  /** the target it noticed last (by id) */
  noticed: string | null = null;
  /** where it believes the threat is (sight, then noise, then an ally's shout) */
  lastKnown: XYZ | null = null;
  /** @internal bus time of its last look (it hears what sounded since), and the last noise it heard */
  heardTo: number | null = null;
  heardSeq = -1;
  readonly changes = new Emitter<SensorChange>();
  readonly kind: "human" | "beast";

  constructor(readonly spec: SensorSpec) {
    this.kind = spec.kind ?? "human";
    this.sight = spec.sight ?? this.kind === "human";
    this.hearing = spec.hearing ?? true;
  }

  get alerted() {
    return this.level === "alert";
  }

  /** Alert at once (shouted at by an ally, hit, woken): `at` is where the threat is. */
  alert(at?: XYZ | null, by?: string | null) {
    this.meter = 1;
    if (at) this.lastKnown = { x: at.x, y: at.y, z: at.z };
    if (by) this.noticed = by;
    this.set("alert");
  }

  /** Back to `level` (default unaware) with the meter at `meter` (a search given up, the beast asleep again). */
  calm(level: AwarenessLevel = "unaware", meter = 0) {
    this.meter = Math.min(1, Math.max(0, meter));
    this.seeing = false;
    this.set(level);
  }

  /** @internal add `amount` to the meter (clamped) and update the level */
  add(amount: number) {
    if (this.level === "alert") {
      this.meter = 1;
      return;
    }
    this.meter = Math.min(1, Math.max(0, this.meter + amount));
    this.set(levelOf(this.meter, this.level, this.kind));
  }

  private set(level: AwarenessLevel) {
    const prev = this.level;
    if (prev === level) return;
    this.level = level;
    this.changes.emit({ sensor: this, level, prev });
  }
}

/** Static line of sight (`Physics.rayCastStatic`): the distance to the first static hit. */
export interface SightRay {
  rayCastStatic(from: Vector3, dir: Vector3, maxDist: number): number;
}

export interface PerceptionOptions {
  noise: NoiseBus;
  /** static line of sight; null: everything in range and cone is visible */
  los?: SightRay | null;
  hz?: number;
  raysPerFrame?: number;
}

/**
 * Every sensor of a scene and the targets they look for. `update(dt)` runs on game time: each
 * sensor looks `hz` (5) times a second, in round robin, and the frame's line-of-sight rays are
 * capped (4): a sensor that needs a ray when none is left looks on the next frame instead.
 */
export class Perception {
  readonly noise: NoiseBus;
  /** every level change of every sensor */
  readonly changes = new Emitter<SensorChange>();
  private los: SightRay | null;
  private sensors = new Set<Sensor>();
  private targets = new Set<PerceptionTarget>();
  private slicer: TimeSlicer<Sensor>;
  private offs = new Map<Sensor, Disposer[]>();
  private from = new Vector3();
  private dir = new Vector3();
  /** rays cast so far (debug, tests) */
  rays = 0;

  constructor(o: PerceptionOptions) {
    this.noise = o.noise;
    this.los = o.los ?? null;
    this.slicer = new TimeSlicer<Sensor>({ hz: o.hz ?? PERCEPTION.hz, budget: o.raysPerFrame ?? PERCEPTION.raysPerFrame, maxDt: 0.6 });
  }

  addTarget(t: PerceptionTarget): Disposer {
    this.targets.add(t);
    return () => {
      this.targets.delete(t);
    };
  }

  addSensor(spec: SensorSpec): Sensor {
    const s = new Sensor(spec);
    // it hears from now on (not the noises of before it was there)
    s.heardTo = this.noise.time;
    s.heardSeq = this.noise.seq;
    this.sensors.add(s);
    this.offs.set(s, [this.slicer.add(s), s.changes.on((c) => this.changes.emit(c))]);
    return s;
  }

  removeSensor(s: Sensor) {
    if (!this.sensors.delete(s)) return;
    for (const off of this.offs.get(s) ?? []) off();
    this.offs.delete(s);
  }

  get all(): readonly Sensor[] {
    return [...this.sensors];
  }

  /** The highest awareness of any enabled sensor that is not yet alert (the HUD eye), 0..1; 1 when one is alert. */
  awareness() {
    let k = 0;
    for (const s of this.sensors) if (s.enabled) k = Math.max(k, s.alerted ? 1 : s.meter);
    return k;
  }

  /** Advance `dt` seconds of game time (the noise bus is advanced by its owner). */
  update(dt: number) {
    this.slicer.update(dt, (s, sdt, left) => this.look(s, sdt, left));
  }

  /** One look of `s` over the last `dt` seconds; null when it needs more rays than are left. */
  private look(s: Sensor, dt: number, left: number): number | null {
    if (!s.enabled) {
      // blind and deaf: what sounds meanwhile is never heard (switched on again, it hears from then)
      s.heardTo = this.noise.time;
      s.heardSeq = this.noise.seq;
      return 0;
    }
    const spec = s.spec;
    const feet = spec.position();
    const beast = s.kind === "beast";
    const eyeY = feet.y + (spec.eye ?? (beast ? BEAST.eye : PERCEPTION.eye));
    const yaw = spec.yaw();
    const range = spec.range ?? PERCEPTION.range;
    const fov = (spec.fov ?? PERCEPTION.fov)[s.level === "unaware" ? "unaware" : "alert"];
    const prox = spec.proximity !== undefined ? spec.proximity : beast ? BEAST.proximity : null;
    // who is in range and in the cone (each needs a ray), decided before anything is cast
    const looks: { t: PerceptionTarget; p: XYZ; d: number }[] = [];
    let wake: XYZ | null = null;
    let wakeBy: string | null = null;
    for (const t of this.targets) {
      if (t.hidden?.()) continue;
      const p = t.position();
      const dx = p.x - feet.x, dz = p.z - feet.z;
      const flat = Math.hypot(dx, dz);
      if (prox && Math.abs(p.y - feet.y) < 2 && flat <= (t.sneaking() ? prox.sneaking : prox.other)) {
        wake = p;
        wakeBy = t.id;
      }
      if (!s.sight) continue;
      const cy = p.y + (t.chest ?? PERCEPTION.chest);
      const d = Math.hypot(dx, cy - eyeY, dz);
      if (d < range && inCone({ x: feet.x, z: feet.z }, yaw, p, fov)) looks.push({ t, p, d });
    }
    if (looks.length > left && left < this.slicer.budget) return null;
    let sight = 0;
    s.seeing = false;
    for (const { t, p, d } of looks) {
      if (!this.visible(feet.x, eyeY, feet.z, p.x, p.y + (t.chest ?? PERCEPTION.chest), p.z, d)) continue;
      s.seeing = true;
      s.lastSeen = { x: p.x, y: p.y, z: p.z };
      s.lastKnown = s.lastSeen;
      s.noticed = t.id;
      sight += sightRate(d, { range, light: t.light?.(), sneaking: t.sneaking(), moving: t.moving() });
    }
    let heard = 0;
    let loudest = 0;
    if (s.hearing) {
      const instant = spec.instant !== undefined ? spec.instant : beast ? BEAST.instant : null;
      const now = this.noise.time;
      const since = s.heardTo ?? now - dt;
      s.heardTo = now;
      s.heardSeq = this.noise.heard(since, (n, secs, fresh) => {
        const d = hearingDistance(feet, n.at);
        let gain = 0;
        if (beast) {
          const one = BEAST_ONESHOT[n.kind];
          // (once: in the look whose span it started in)
          if (one) gain = d <= one.r && fresh ? one.add : 0;
          else {
            const b = BEAST_HEARING[n.kind];
            if (b) gain = beastRate(d, n.radius ?? b.r, b.w) * secs;
          }
        } else {
          const r = n.radius ?? HEARING[n.kind];
          if (r) gain = hearRate(d, r) * secs;
        }
        if (instant?.[n.kind] !== undefined && d <= instant[n.kind]) {
          wake = n.at;
          wakeBy = n.source;
        }
        if (gain > 0) {
          heard += gain;
          if (gain >= loudest) {
            loudest = gain;
            s.lastNoise = { x: n.at.x, y: n.at.y, z: n.at.z };
            if (!s.seeing) s.lastKnown = s.lastNoise;
          }
        }
      }, s.heardSeq);
    }
    if (wake) {
      s.alert(wake, wakeBy);
      return looks.length;
    }
    const decay = spec.decay ?? (beast ? BEAST.decay : PERCEPTION.decay);
    s.add(sight * dt + heard - decay * dt);
    return looks.length;
  }

  /**
   * Whether an eye at `eye` looking along `forward` (horizontal) sees `target` within `maxDist` m
   * and a cone of `fovDeg` (whole angle), unblocked by static geometry (engine-framework §2.19).
   */
  canSee(eye: XYZ, target: XYZ, forward: { x: number; z: number }, maxDist: number, fovDeg: number) {
    const dx = target.x - eye.x, dy = target.y - eye.y, dz = target.z - eye.z;
    const d = Math.hypot(dx, dy, dz);
    if (d > maxDist) return false;
    const flat = Math.hypot(dx, dz), fl = Math.hypot(forward.x, forward.z);
    if (flat > 1e-6 && fl > 1e-6 && (dx * forward.x + dz * forward.z) / (flat * fl) < Math.cos(((fovDeg / 2) * Math.PI) / 180) - 1e-9) return false;
    return this.visible(eye.x, eye.y, eye.z, target.x, target.y, target.z, d);
  }

  private visible(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, d: number) {
    if (!this.los) return true;
    this.rays++;
    const from = this.from.set(x0, y0, z0);
    const dir = this.dir.set(x1 - x0, y1 - y0, z1 - z0);
    if (d < 1e-3) return true;
    dir.scaleInPlace(1 / d);
    return this.los.rayCastStatic(from, dir, d) >= d - 0.05;
  }

  /** Alert every enabled sensor (a scripted alarm) toward `at`. */
  alertAll(at: XYZ | null) {
    for (const s of this.sensors) if (s.enabled) s.alert(at);
  }

  dispose() {
    for (const s of [...this.sensors]) this.removeSensor(s);
    this.targets.clear();
    this.slicer.clear();
    this.changes.clear();
  }
}

/**
 * A perception over static line of sight (`Physics` fits `SightRay`) with its own noise bus unless
 * one is given (engine-framework §2.19 `createPerception(ph)`).
 */
export function createPerception(los: SightRay | null, o: { noise?: NoiseBus; hz?: number; raysPerFrame?: number } = {}): Perception {
  return new Perception({ noise: o.noise ?? new NoiseBus(), los, hz: o.hz, raysPerFrame: o.raysPerFrame });
}
