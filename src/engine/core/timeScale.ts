import type { Disposer } from "./types";

interface Hold {
  scale: number;
  /** real seconds left (Infinity: until released) */
  left: number;
}

/**
 * The game-time multiplier: overlapping requests (a hit-stop, a slow-motion beat) each ask for a
 * scale, and the strongest slow-down wins. It runs on unscaled frame time (a hit-stop at 0.05 must
 * still end after its 80 real milliseconds), so the owner calls `step(realDt)` once per frame and
 * multiplies the frame's game time by the result.
 */
export class TimeScale {
  private holds = new Set<Hold>();
  /** the scale without any request (1) */
  base = 1;

  /** The scale now: the smallest asked for, or `base`. */
  get value() {
    let v = this.base;
    for (const h of this.holds) v = Math.min(v, h.scale);
    return v;
  }

  /** Whether anything is slowing time now. */
  get active() {
    return this.holds.size > 0;
  }

  /**
   * Run game time at `scale` for `seconds` of real time (default: until the disposer is called).
   * The disposer ends it early. The owner `clear()`s every hold between scenes (the prologue stage
   * does between chapters), so a hold a cancelled script left behind cannot outlive it.
   */
  hold(scale: number, seconds = Infinity): Disposer {
    const h: Hold = { scale: Math.max(0, scale), left: seconds };
    if (!(seconds > 0)) return () => {};
    this.holds.add(h);
    return () => {
      this.holds.delete(h);
    };
  }

  /** A hit-stop: near-frozen game time (default 0.05×) for `seconds` real seconds. */
  hitStop(seconds: number, scale = 0.05): Disposer {
    return this.hold(scale, seconds);
  }

  /**
   * Advance by one frame of real time: returns the scale this frame runs at (the requests as they
   * stand at the frame's start), then lets the requests age.
   */
  step(realDt: number) {
    const v = this.value;
    if (realDt > 0)
      for (const h of [...this.holds]) {
        h.left -= realDt;
        if (h.left <= 0) this.holds.delete(h);
      }
    return v;
  }

  /** Drop every request (a chapter skip, the stage going away). */
  clear() {
    this.holds.clear();
  }
}
