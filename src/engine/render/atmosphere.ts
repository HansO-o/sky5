/**
 * Lighting profiles as data: the handful of scene values an interior, a cave or the open air sets (sun
 * and sky-fill intensity, image-based light, fog, exposure) and the maths to blend between them. The
 * environment writes the blended values into the scene; nothing here touches Babylon, and no value
 * here changes a shader (they are all uniforms), so a blend never recompiles anything.
 */

export type RGB = [number, number, number];

export interface Atmosphere {
  /** scene.environmentIntensity (image-based light) */
  env: number;
  /** fog colour (also the clear colour) */
  fog: RGB;
  /** EXP2 fog density */
  density: number;
  /** image-processing exposure */
  exposure: number;
  /** sun (directional light) intensity */
  sun: number;
  /** sky fill (hemispheric light) intensity */
  fill: number;
}

export const clamp01 = (k: number) => (k < 0 ? 0 : k > 1 ? 1 : k);
/** Smooth 0..1 ease (zero slope at both ends). */
export const smoothstep = (k: number) => {
  const t = clamp01(k);
  return t * t * (3 - 2 * t);
};

export function cloneAtmosphere(a: Atmosphere): Atmosphere {
  return { env: a.env, fog: [a.fog[0], a.fog[1], a.fog[2]], density: a.density, exposure: a.exposure, sun: a.sun, fill: a.fill };
}

/** `a` → `b` by `k` (0..1, clamped), into `out` (a new object by default). */
export function lerpAtmosphere(a: Atmosphere, b: Atmosphere, k: number, out: Atmosphere = cloneAtmosphere(a)): Atmosphere {
  const t = clamp01(k);
  // (exact at both ends)
  const l = (x: number, y: number) => x * (1 - t) + y * t;
  out.env = l(a.env, b.env);
  out.fog[0] = l(a.fog[0], b.fog[0]);
  out.fog[1] = l(a.fog[1], b.fog[1]);
  out.fog[2] = l(a.fog[2], b.fog[2]);
  out.density = l(a.density, b.density);
  out.exposure = l(a.exposure, b.exposure);
  out.sun = l(a.sun, b.sun);
  out.fill = l(a.fill, b.fill);
  return out;
}

/**
 * How far out of a tunnel the viewer is, by distance to the mouth: 0 while `span` metres or more
 * from `anchor`, 1 at it (linear; ease it with {@link smoothstep}).
 */
export function climbOut(distance: number, span: number) {
  return span <= 0 ? (distance <= 0 ? 1 : 0) : clamp01(1 - distance / span);
}

/**
 * A blend from the values shown now to a target over some seconds (smoothstep eased). The target
 * may be a function, evaluated on every step: then the blend keeps following it once it is done
 * (the outdoor values as the fire mood changes, a tunnel mouth that brightens as the viewer nears it).
 */
export class AtmosphereBlend {
  private from: Atmosphere;
  private target: () => Atmosphere;
  private t = 0;
  private seconds = 0;
  readonly current: Atmosphere;

  constructor(initial: Atmosphere) {
    this.current = cloneAtmosphere(initial);
    this.from = cloneAtmosphere(initial);
    const fixed = cloneAtmosphere(initial);
    this.target = () => fixed;
  }

  /**
   * Blend from the current values to `target` over `seconds` (0: at once). `start` overrides some of
   * the starting values (e.g. an exposure flare stepping out of a cave).
   */
  to(target: Atmosphere | (() => Atmosphere), seconds: number, start?: Partial<Atmosphere>) {
    const from = cloneAtmosphere(this.current);
    for (const k of ["env", "density", "exposure", "sun", "fill"] as const) if (start?.[k] !== undefined) from[k] = start[k];
    if (start?.fog) from.fog = [start.fog[0], start.fog[1], start.fog[2]];
    this.from = from;
    if (typeof target === "function") this.target = target;
    else {
      const fixed = cloneAtmosphere(target);
      this.target = () => fixed;
    }
    this.seconds = Math.max(0, seconds);
    this.t = 0;
  }

  /** Whether a blend is still under way. */
  get blending() {
    return this.t < this.seconds;
  }

  /** Advance by `dt` seconds; returns the values to show (the shared `current` object). */
  step(dt: number): Atmosphere {
    this.t = Math.min(this.seconds, this.t + Math.max(0, dt));
    const k = this.seconds > 0 ? smoothstep(this.t / this.seconds) : 1;
    return lerpAtmosphere(this.from, this.target(), k, this.current);
  }
}
