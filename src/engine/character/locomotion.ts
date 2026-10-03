/**
 * Locomotion clip choice for a walking body. Playback rates are the actual speed over each clip's
 * **native** speed (how fast its feet travel at rate 1), so feet do not slide over the ground.
 */
export interface LocomotionClips {
  idle: string;
  walk: string;
  jog: string;
  sprint: string;
  crouchIdle: string;
  crouchMove: string;
  jumpStart: string;
  jumpLoop: string;
  jumpLand: string;
  /** speed thresholds (m/s): idle below `idle`, walk below `walk`, jog below `jog`, else sprint; crouching moves above `crouch` */
  below: { idle: number; walk: number; jog: number; crouch?: number };
  /** native speed of each moving clip (m/s at playback rate 1) */
  rate: { crouch: number; walk: number; jog: number; sprint: number };
  /**
   * lowest playback rate per moving clip (a clip that barely moves looks frozen otherwise); the
   * crouching idle plays at `minRate.crouch` (default 1)
   */
  minRate?: Partial<Record<"crouch" | "walk" | "jog" | "sprint", number>>;
}

export interface LocomotionPick {
  clip: string;
  /** playback rate (1 for the idles) */
  speed: number;
}

/** The clip and playback rate for a body moving at `speed` m/s on the ground. */
export function locomotionClip(speed: number, crouch: boolean, c: LocomotionClips): LocomotionPick {
  const sp = Math.max(0, speed);
  const moving = (kind: "crouch" | "walk" | "jog" | "sprint", clip: string): LocomotionPick => ({
    clip,
    speed: Math.max(c.minRate?.[kind] ?? 0, sp / c.rate[kind]),
  });
  if (crouch) return sp > (c.below.crouch ?? c.below.idle) ? moving("crouch", c.crouchMove) : { clip: c.crouchIdle, speed: c.minRate?.crouch ?? 1 };
  if (sp < c.below.idle) return { clip: c.idle, speed: 1 };
  if (sp < c.below.walk) return moving("walk", c.walk);
  if (sp < c.below.jog) return moving("jog", c.jog);
  return moving("sprint", c.sprint);
}
