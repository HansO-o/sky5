// The creature rigs as the pipeline shipped and measured them (design Appendix "Pipeline outputs",
// Creatures): sizes, colours, ground speeds, clip names and the locomotion built on them. Pure data
// (no Babylon): exit/creatures.ts spawns with these, tests/unit/prologue/exitWorld checks them.

import type { Gait } from "../../engine/ai/agent";

/**
 * The creature rigs as the pipeline measured them (design Appendix "Creatures"; `SPIDER.walkSpeed`
 * 2.6 in creatures.ts was a guess: the walk clip covers 1.305 m/s at scale 1).
 */
export const SPIDER_RIG = {
  /** `creatures/spider`'s clips (one asset for both sizes; `SPIDER.clips` in creatures.ts names the same) */
  clips: { idle: "Spider_Idle", walk: "Spider_Walk", attack: "Spider_Attack", death: "Spider_Death", jump: "Spider_Jump" },
  /** Spider_Walk's ground speed at rate 1, scale 1 (m/s) */
  walk: 1.305,
  /** body height at scale 1 (Spider_Idle frame 0, m) */
  height: 0.845,
  /** the pipeline's `extras.variants`: the small ones brown at 0.55, the giant black at 1 */
  small: { scale: 0.55, body: [0.15, 0.075, 0.03] as [number, number, number], capsule: { radius: 0.38, height: 0.86 } },
  giant: { scale: 1, body: [0.03, 0.027, 0.026] as [number, number, number], capsule: { radius: 0.75, height: 1.6 } },
} as const;

export const WOLF_RIG = {
  asset: "creatures/wolf",
  clips: { idle: "Idle", walk: "Walk", run: "Run", death: "Death", lieDown: "LieDown", sleep: "Sleep", standUp: "StandUp" },
  /** ground speeds at rate 1 (m/s) */
  walk: 1.03,
  run: 5.54,
  /** the spine joint that breathes (±2° at 0.25 Hz while it sleeps, §6.3) */
  spine: "Bone.005",
  breathe: { deg: 2, hz: 0.25 },
  /** the stand-up takes 1.55 s; the howl comes as it is up (§6.3: stand up → howl → fight) */
  howlAfter: 1.3,
  capsule: { radius: 0.45, height: 1.4 },
} as const;

/** A spider's locomotion at `scale`: the walk at its measured speed, backwards when backing off. */
export function caveSpiderGait(scale: number): Gait {
  const walk = { clip: SPIDER_RIG.clips.walk, native: SPIDER_RIG.walk * scale };
  return { idle: SPIDER_RIG.clips.idle, forward: [{ ...walk, below: Infinity }], back: { ...walk, reverse: true }, still: 0.12, minRate: 0.3 };
}

/** The wolf's locomotion: walk, then run (the AI's 3.5 and 7 m/s are Run at 0.63 and 1.26). */
export function wolfGait(): Gait {
  const c = WOLF_RIG.clips;
  return {
    idle: c.idle,
    forward: [
      { clip: c.walk, native: WOLF_RIG.walk, below: 2.4 },
      { clip: c.run, native: WOLF_RIG.run, below: Infinity },
    ],
    back: { clip: c.walk, native: WOLF_RIG.walk, reverse: true },
    still: 0.12,
    minRate: 0.4,
  };
}
