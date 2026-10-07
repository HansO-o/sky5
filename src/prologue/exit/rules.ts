// The exit chapter's rules as pure data and small state machines (design §6.1, §6.3, §8, §9, §11,
// §12): cutting the web walls, the spider ambush's schedule, the wolf's meter as the dialogue reads
// it, the platform's timeline, and the world state of every checkpoint and of the skip. No Babylon:
// the runtime (cave.ts, webs.ts, creatures.ts, checkpoints.ts) and exit.ts drive these, and
// tests/unit/prologue/exitRules.test.ts checks them against the design's numbers.

import type { PrologueFlags } from "../flags";
import { EXIT_TIMING } from "../chapters/exitScript";

/**
 * Ids the exit records in `flags.looted` (what is gone for good: never put back on a resume). The
 * web walls and the cocoon are not loot, but "taken away for good" is the same rule (§11 "web A as
 * per flags").
 */
export const EXIT_IDS = {
  webA: "exit.web_A",
  webB: "exit.web_B",
  cocoon: "exit.cocoon",
  satchel: "exit.satchel",
} as const;

// ------------------------------------------------------------------------------------------------
// web walls (§6.1 X1)

/** 3 blows of any attack, or 1 heavy; the cut cards dissolve over `dissolve` s (their collider goes at once). */
export const WEB = {
  hits: 3,
  dissolve: 0.9,
  /** X1: web A not cut after this long: the companion cuts it (§12) */
  companionAfter: 60,
  /** a blow counts from this far beyond the attack's reach (m): the web is a wall, not a body with a radius */
  pad: 0.35,
  /** the blow's feet within this height of the web's floor (m) */
  height: 1.5,
} as const;

/** Blows on one web wall: `hit()` until it gives. */
export class WebCut {
  hits = 0;
  cut = false;

  /** Count one blow (`heavy`: a held heavy); true when this blow cut the web. */
  hit(heavy: boolean) {
    if (this.cut) return false;
    this.hits++;
    if (heavy || this.hits >= WEB.hits) this.cut = true;
    return this.cut;
  }

  /** Cut by other means (the companion, a script, a checkpoint). */
  give() {
    this.cut = true;
  }
}

/** A swing as the web reads it: the attacker's feet and facing, the attack's reach and half-arc (degrees). */
export interface SwingPose {
  x: number;
  y: number;
  z: number;
  /** forward = (−sin yaw, −cos yaw) */
  yaw: number;
}

/** What `webInSwing` needs of a web wall (`webs.<id>` of the anchors). */
export interface WebShape {
  centre: readonly [number, number, number];
  floor: number;
  box: { half: readonly [number, number, number]; axes: readonly [readonly [number, number, number], readonly [number, number, number], readonly [number, number, number]] };
}

/**
 * Whether a swing from `a` reaches the web wall: some point across its width (sampled every
 * ≤ 0.5 m along `box.axes[2]`) lies within reach (+ `WEB.pad`) and within ±`arcDeg` of the facing,
 * with the feet near the web's floor.
 */
export function webInSwing(a: SwingPose, s: { reach: number; arc: number }, w: WebShape) {
  if (Math.abs(a.y - w.floor) > WEB.height) return false;
  const t = w.box.axes[2];
  const th = Math.hypot(t[0], t[2]) || 1;
  const tx = t[0] / th, tz = t[2] / th;
  const half = w.box.half[2];
  const n = Math.max(2, Math.ceil((half * 2) / 0.5));
  const fx = -Math.sin(a.yaw), fz = -Math.cos(a.yaw);
  const R = s.reach + WEB.pad;
  const cosArc = Math.cos((Math.min(180, Math.max(0, s.arc)) * Math.PI) / 180);
  for (let i = 0; i <= n; i++) {
    const u = -half + (2 * half * i) / n;
    const dx = w.centre[0] + tx * u - a.x, dz = w.centre[2] + tz * u - a.z;
    const d = Math.hypot(dx, dz);
    if (d > R) continue;
    if (d < 0.3) return true;
    if ((dx * fx + dz * fz) / d >= cosArc - 1e-9) return true;
  }
  return false;
}

// ------------------------------------------------------------------------------------------------
// the spider ambush (§6.1 "X1 ambush timeline", §6.3 E5, §12)

export const AMBUSH = {
  /** the trigger: within this of `spider_c`, or this long after web A fell */
  radius: 6,
  afterWebA: 8,
  /** seconds from the trigger */
  bark: EXIT_TIMING.ambush.bark,
  smallN: 1,
  smallS: 4,
  music: 4,
  /** phase B: both small spiders dead, or this long after the trigger */
  giantAfter: 20,
  /** the giant's drop on its silk (s) */
  drop: 1.6,
  /** web B dissolves by itself this long after the fight began, if nobody cut it (§12 X1) */
  webB: 120,
} as const;

/**
 * What the ambush does, in order: the skitter sound (trigger), the companion's bark, the small
 * spider of `burrow_n`, the one of `burrow_s` with the spider music, phase B (the giant drops), and
 * web B giving way (the soft-lock fallback).
 */
export type AmbushCue = "skitter" | "bark" | "smallN" | "smallS" | "music" | "phaseB" | "webB";

/** Whether the ambush starts now: the player within 6 m of the chamber's centre, or 8 s after web A fell. */
export function ambushDue(o: { distToCentre: number; sinceWebA: number | null }) {
  return o.distToCentre <= AMBUSH.radius || (o.sinceWebA !== null && o.sinceWebA >= AMBUSH.afterWebA);
}

const TIMED: readonly [number, AmbushCue][] = [
  [AMBUSH.bark, "bark"],
  [AMBUSH.smallN, "smallN"],
  [AMBUSH.smallS, "smallS"],
  [AMBUSH.music, "music"],
];

/**
 * The ambush clock (game seconds from the trigger). `start()` once the trigger fires, then
 * `update(dt, …)` every frame: each returns the cues due, in time order, each cue once. A retry
 * (`reset()` then `start()`) plays it again from the top.
 */
export class AmbushSchedule {
  private t: number | null = null;
  private fired = new Set<AmbushCue>();

  /** Seconds since the trigger (null: not triggered). */
  get time() {
    return this.t;
  }

  get started() {
    return this.t !== null;
  }

  has(c: AmbushCue) {
    return this.fired.has(c);
  }

  /** The trigger: the clock starts at 0 (the skitter). */
  start(): AmbushCue[] {
    if (this.t !== null) return [];
    this.t = 0;
    this.fired.add("skitter");
    return ["skitter"];
  }

  /**
   * Advance by `dt`. `smallAlive`: small spiders out and still alive (once both are out, 0 starts
   * phase B); `webBCut`: web B is down already (no fallback).
   */
  update(dt: number, o: { smallAlive: number; webBCut: boolean }): AmbushCue[] {
    if (this.t === null) return [];
    this.t += Math.max(0, dt);
    const out: AmbushCue[] = [];
    const fire = (c: AmbushCue) => {
      if (this.fired.has(c)) return;
      this.fired.add(c);
      out.push(c);
    };
    for (const [at, c] of TIMED) if (this.t >= at) fire(c);
    const bothOut = this.fired.has("smallN") && this.fired.has("smallS");
    if ((bothOut && o.smallAlive <= 0) || this.t >= AMBUSH.giantAfter) fire("phaseB");
    if (this.t >= AMBUSH.webB && !o.webBCut) fire("webB");
    return out;
  }

  reset() {
    this.t = null;
    this.fired.clear();
  }
}

// ------------------------------------------------------------------------------------------------
// the wolf (§6.3 E6, §9 "Wolf", the X2 lines)

export const WOLF = {
  /** the stir line from meter 0.5, the calm line back under 0.2, awake at 1.0 */
  stir: EXIT_TIMING.wolf.stir,
  calm: EXIT_TIMING.wolf.calm,
  wake: EXIT_TIMING.wolf.wake,
  /** the flee hint this long after waking; the satchel line within this of the satchel */
  fleeHint: EXIT_TIMING.wolf.fleeHint,
  satchel: EXIT_TIMING.wolf.satchel,
  /** the leash: no target further than this from the bed, nor past `climb_s23` */
  leash: 18,
} as const;

export type WolfCue = "stir" | "calm" | "wake";

/**
 * The wolf's noise meter as the dialogue reads it: "stir" once it reaches 0.5, "calm" when it is
 * back under 0.2 after a stir, "wake" when it wakes (the meter at 1.0, or its brain woke it: a
 * blow, the player too close, a clash). Back asleep (`sleep()`: leashed, a checkpoint) it can stir
 * and wake again.
 */
export class WolfWatch {
  state: "asleep" | "stirred" | "awake" = "asleep";

  update(meter: number, awake: boolean): WolfCue | null {
    if (this.state === "awake") return null;
    if (awake || meter >= WOLF.wake - 1e-9) {
      this.state = "awake";
      return "wake";
    }
    if (this.state === "asleep" && meter >= WOLF.stir) {
      this.state = "stirred";
      return "stir";
    }
    if (this.state === "stirred" && meter < WOLF.calm) {
      this.state = "asleep";
      return "calm";
    }
    return null;
  }

  sleep() {
    this.state = "asleep";
  }
}

type Beast = NonNullable<PrologueFlags["outcomes"]["beast"]>;

/**
 * How the den went (`outcomes.beast`, the end card's 巨狼 entry): killed; woke and the player got
 * away past its leash (fled); never woke (asleep); still undecided (woke, neither killed nor shaken
 * off) gives undefined.
 */
export function beastOutcome(o: { killed: boolean; woke: boolean; leashed: boolean }): Beast | undefined {
  if (o.killed) return "killed";
  if (!o.woke) return "asleep";
  if (o.leashed) return "fled";
  return undefined;
}

// ------------------------------------------------------------------------------------------------
// the platform (§6.1 "X4 platform timeline")

/**
 * The platform's beats (s from arriving): look at the square, the fires, mood 1, the wind, X4-1 (0);
 * the bell (2.5); the dragon's pass (4); its wings behind the player, the companion presses to the
 * rock (7); overhead, the shake, X4-2 (≈ 11.5); control back (12.5); the roar over the tower, X4-3
 * (≈ 19); the Lament reprise (21); the closing lines (23 → ≈ 68).
 */
export const PLATFORM = [
  { t: 0, cue: "arrive" },
  { t: 2.5, cue: "bell" },
  { t: 4, cue: "dragon" },
  { t: 7, cue: "wings" },
  { t: EXIT_TIMING.platform.overhead, cue: "overhead" },
  { t: 12.5, cue: "move" },
  { t: EXIT_TIMING.platform.roar, cue: "roar" },
  { t: 21, cue: "music" },
  { t: EXIT_TIMING.platform.closing, cue: "closing" },
] as const;

export type PlatformCue = (typeof PLATFORM)[number]["cue"];

/** Where a resume at step 5 replays the platform from (§11: "replay X4 from the dragon cue"). */
export const PLATFORM_RESUME = 4;

/** The player can't walk from the arrival until this (look stays free; §6.1). */
export const PLATFORM_LOCK = 12.5;

/** The platform's cues in (from, to] (a `from` below 0 includes the arrival at 0). */
export function platformCues(from: number, to: number): PlatformCue[] {
  return PLATFORM.filter((c) => c.t > from && c.t <= to).map((c) => c.cue);
}

// ------------------------------------------------------------------------------------------------
// checkpoints (§11 "exit") and the skip

/** The exit's last checkpoint: the platform. */
export const EXIT_STEPS = 5;

/** Where each step puts the player (anchor and facing) and the companion (anchor), §11. */
export const EXIT_CHECKPOINTS = [
  { step: 0, player: "gal_s_cp", companion: "comp_s", yaw: 0.2 },
  { step: 1, player: "cp_spider", companion: "comp_spider", yaw: 1.57 },
  { step: 2, player: "cp_spider_done", companion: "comp_spider_done", yaw: 1.57 },
  { step: 3, player: "cp_den", companion: "comp_den", yaw: 2.45 },
  { step: 4, player: "cp_climb", companion: "comp_climb", yaw: 2.7 },
  { step: 5, player: "platform", companion: "comp_platform", yaw: -1.68 },
] as const;

/**
 * §11's checkpoint positions and §4.3's anchors the exit's world stands on, for a build whose
 * `cave/anchors` lacks one (world; y is the floor). The shipped anchors win (they are re-measured).
 */
export const EXIT_MARKS: Readonly<Record<string, readonly [number, number, number]>> = {
  gal_s_cp: [47.5, 27.05, -738.5],
  comp_s: [49.2, 27.1, -739.0],
  cp_spider: [31.5, 27.7, -749.0],
  comp_spider: [33.0, 27.7, -748.5],
  cp_spider_done: [12, 27.7, -749.5],
  comp_spider_done: [13.5, 27.7, -749.0],
  cp_den: [-16.5, 31.55, -729],
  comp_den: [-15.5, 31.4, -730.2],
  cp_climb: [-28, 33.6, -709],
  comp_climb: [-27.0, 33.4, -711.0],
  platform: [-15.0, 56.05, -670.5],
  comp_platform: [-17.6, 56.05, -672.0],
  spider_c: [18, 27.55, -750],
  chimney_mouth: [18, 34.8, -750.5],
  burrow_n: [15, 28.42, -745.5],
  burrow_s: [21, 28.52, -755],
  cocoon: [22, 28.45, -754],
  wolf_bed: [-22, 32.85, -718],
  satchel: [-20.5, 33.47, -716.5],
  climb_s23: [-33, 35.48, -699],
  climb_mid: [-46, 40.73, -681],
  cp_light: [-25, 51.28, -684],
  bend: [-21, 54.08, -680],
};

/** The world as a step (or the skip) leaves it (§11's state column). */
export interface ExitWorldState {
  step: number;
  webA: "intact" | "cut";
  webB: "intact" | "cut";
  /** the courier's cocoon (optional search) */
  cocoon: "closed" | "searched";
  /** the hunter's satchel by the wolf (optional) */
  satchel: "there" | "taken";
  /** E5: the ambush still ahead (0), armed at its retry mark (1), over (2+) */
  spiders: "waiting" | "armed" | "gone";
  /** E6: on its bed asleep with its meter at 0 (a leashed wolf too), or gone (killed; past the den) */
  wolf: "asleep" | "gone";
  /** the companion carries the lit torch (from K9 to `cp_light`) */
  torch: boolean;
  /** the town seen from the platform: outdoor world, its fires burning, fire mood (null: leave as is) */
  outdoor: boolean;
  townFires: boolean;
  mood: number | null;
}

type StepFlags = Pick<PrologueFlags, "looted" | "outcomes" | "inv">;

/** The world state of exit step `step` (clamped to 0–5) under these flags (§11). */
export function exitWorldState(step: number, f: StepFlags): ExitWorldState {
  const s = Math.max(0, Math.min(EXIT_STEPS, Math.floor(step) || 0));
  const taken = (id: string) => f.looted.includes(id);
  const killed = f.outcomes.beast === "killed";
  return {
    step: s,
    webA: s >= 2 || taken(EXIT_IDS.webA) ? "cut" : "intact",
    webB: s >= 2 || taken(EXIT_IDS.webB) ? "cut" : "intact",
    cocoon: taken(EXIT_IDS.cocoon) ? "searched" : "closed",
    satchel: taken(EXIT_IDS.satchel) || f.inv.charm ? "taken" : "there",
    spiders: s === 0 ? "waiting" : s === 1 ? "armed" : "gone",
    wolf: s >= EXIT_STEPS || killed ? "gone" : "asleep",
    torch: s < EXIT_STEPS,
    outdoor: s >= EXIT_STEPS,
    townFires: s >= EXIT_STEPS,
    mood: s >= EXIT_STEPS ? 1 : null,
  };
}

/**
 * `exit.skip()` (§11): the world of the platform with the creatures, the webs and the torch gone,
 * and the den's outcome "skipped" unless it was decided.
 */
export function exitSkipState(f: StepFlags): { world: ExitWorldState; beast: Beast } {
  const world = { ...exitWorldState(EXIT_STEPS, f), webA: "cut", webB: "cut", wolf: "gone", spiders: "gone", torch: false } satisfies ExitWorldState;
  return { world, beast: f.outcomes.beast ?? "skipped" };
}
