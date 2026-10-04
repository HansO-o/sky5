/**
 * Noises the AI hears (keep/exit design §9): what makes them, how far each kind carries for people
 * and for beasts, and the bus they go through. Pure (no Babylon): positions are plain {x, y, z}.
 */
import { Emitter } from "../core/emitter";
import type { Disposer } from "../core/types";
import type { CombatEvent } from "../combat/CombatSystem";
import type { XYZ } from "../combat/hit";

/** The kinds of noise in the tables below (content may add its own with explicit radii). */
export type NoiseKind = "sneak" | "walk" | "run" | "sprint" | "land" | "clash" | "swing" | "potion" | "pickup" | "bone" | (string & {});

/** How far people hear each kind (m; §9 "Hearing"). Kinds not listed are not heard by people. */
export const HEARING: Readonly<Record<string, number>> = { sneak: 2, walk: 8, run: 12, sprint: 16, land: 8, clash: 20 };

/** A beast's hearing (§9 "Wolf"): radius (m) and weight of each kind; the companion makes none. */
export const BEAST_HEARING: Readonly<Record<string, { r: number; w: number }>> = {
  sneak: { r: 3, w: 0.25 },
  walk: { r: 9, w: 0.6 },
  run: { r: 14, w: 1.0 },
  sprint: { r: 20, w: 1.6 },
  swing: { r: 20, w: 1.5 },
  clash: { r: 20, w: 1.5 },
  potion: { r: 4, w: 0.3 },
  pickup: { r: 4, w: 0.5 },
};

/** One-shot additions to a beast's meter (§9: a bone step adds 0.35 once), heard within `r` m. */
export const BEAST_ONESHOT: Readonly<Record<string, { r: number; add: number }>> = { bone: { r: 10, add: 0.35 } };

/** A noise: where, what kind, and for how long it sounds. */
export interface Noise {
  kind: NoiseKind;
  at: XYZ;
  /** who made it (the player, an actor id) */
  source?: string;
  /** seconds it lasts (default 0.25: a moment) */
  seconds?: number;
  /** override the kind's radius (m) for people */
  radius?: number;
}

/** A noise on the bus, with when it started (bus time). */
export interface HeardNoise extends Required<Omit<Noise, "radius" | "source">> {
  source: string | null;
  radius: number | null;
  /** bus time it started */
  t: number;
}

/** How long momentary noises are kept for sensors that have not looked yet (s). */
const KEEP = 2;

/**
 * The noises of a scene: momentary ones (`emit`: a landing, a clash, a drink) are kept briefly so
 * every sensor, whenever its next look comes, gets the part of them that fell in its window; steady
 * ones (`source`: the player's footsteps) are asked for their current noise at each look.
 */
export class NoiseBus {
  /** every momentary noise as it is emitted */
  readonly events = new Emitter<HeardNoise>();
  /** bus seconds (advanced by `update`) */
  time = 0;
  private recent: HeardNoise[] = [];
  private sources = new Set<() => Noise | null>();

  /** A momentary noise, from now for `seconds`. */
  emit(n: Noise) {
    const h: HeardNoise = { kind: n.kind, at: { x: n.at.x, y: n.at.y, z: n.at.z }, seconds: n.seconds ?? 0.25, source: n.source ?? null, radius: n.radius ?? null, t: this.time };
    this.recent.push(h);
    this.events.emit(h);
  }

  /** A steady noise source asked at every look (null: silent now). */
  source(fn: () => Noise | null): Disposer {
    this.sources.add(fn);
    return () => {
      this.sources.delete(fn);
    };
  }

  update(dt: number) {
    this.time += Math.max(0, dt);
    const old = this.time - KEEP;
    if (this.recent.length && this.recent[0].t + this.recent[0].seconds < old) this.recent = this.recent.filter((n) => n.t + n.seconds >= old);
  }

  /**
   * Every noise sounding in the last `window` seconds with how many of those seconds it sounded:
   * the momentary ones by their overlap, the steady sources for the whole window.
   */
  heard(window: number, fn: (n: HeardNoise, seconds: number) => void) {
    const t1 = this.time, t0 = t1 - Math.max(0, window);
    for (const n of this.recent) {
      const s = Math.min(t1, n.t + n.seconds) - Math.max(t0, n.t);
      // (a noise of zero length emitted this instant still counts as heard, for an instant)
      if (s > 0 || (n.seconds === 0 && n.t >= t0)) fn(n, Math.max(0, s));
    }
    for (const src of this.sources) {
      let n: Noise | null = null;
      try {
        n = src();
      } catch (e) {
        console.error("noise source", e);
      }
      if (n) fn({ kind: n.kind, at: n.at, seconds: window, source: n.source ?? null, radius: n.radius ?? null, t: t0 }, window);
    }
  }

  clear() {
    this.recent = [];
  }

  dispose() {
    this.clear();
    this.sources.clear();
    this.events.clear();
  }
}

/** What a walking body is doing, for the noise its feet make. */
export interface Footing {
  /** horizontal speed (m/s) */
  speed: number;
  sneaking: boolean;
  sprinting?: boolean;
  /** on the ground (no footsteps in the air) */
  grounded: boolean;
}

/** Speed bands of the player's gaits (m/s): sneak 1.4, walk 1.9, run 3.9, sprint 6.2. */
export const FOOTING = { still: 0.3, run: 2.6, sprint: 5 } as const;

/** The footstep noise of a body moving as `f` (null: silent). */
export function footstepNoise(f: Footing): NoiseKind | null {
  if (!f.grounded || f.speed < FOOTING.still) return null;
  if (f.sneaking) return "sneak";
  if (f.sprinting || f.speed >= FOOTING.sprint) return "sprint";
  return f.speed >= FOOTING.run ? "run" : "walk";
}

/**
 * The noise a combat event makes (null: none): blows that land or meet a guard are a clash, a swing
 * that opens is a swing (beasts hear it), a backstab is silent.
 */
export function combatNoise(e: CombatEvent): Noise | null {
  if (e.type === "hit") {
    const h = e.hit;
    if (h.outcome === "backstab" || h.attack.ranged) return null;
    return { kind: "clash", at: h.point, source: h.attacker.id, seconds: 0.3 };
  }
  if (e.type === "swing") {
    if (e.attack.ranged) return null;
    const p = e.attacker.pose;
    return { kind: "swing", at: { x: p.x, y: p.y + 1.2, z: p.z }, source: e.attacker.id, seconds: 0.3 };
  }
  return null;
}
