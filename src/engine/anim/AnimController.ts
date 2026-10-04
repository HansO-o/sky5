import type { AnimationGroup } from "@babylonjs/core/Animations/animationGroup";
// AnimationGroup.start needs the scene's animatable support
import "@babylonjs/core/Animations/animatable";
import type { Observer } from "@babylonjs/core/Misc/observable";
import type { Scene } from "@babylonjs/core/scene";

/** How a clip starts (see {@link AnimController.play}). */
export interface PlayOptions {
  /** loop the clip (default true) */
  loop?: boolean;
  /** playback rate (default 1) */
  speed?: number;
  /** cross-fade from the clip playing now, in seconds (default 0.25; 0 cuts) */
  blend?: number;
  /** where to start, as a fraction of the clip (default: a random phase for loops, 0 for one-shots) */
  offset?: number;
}

export interface AnimControllerOptions {
  /** seconds since the last frame (default: the engine's frame time) */
  dt?: () => number;
  /** random source for loop phases (default Math.random) */
  random?: () => number;
}

/**
 * One body's clips with linear cross-fades by group weights. Clips are looked up by key through
 * `resolve` (which may create them lazily, e.g. by retargeting a shared clip onto this body), and
 * a group plays over its own `from..to` range (a clone normalised to a segment plays that segment).
 * Shared by `Character` and `Creature`.
 */
export class AnimController {
  /** the clip playing (or fading in) now */
  current: AnimationGroup | null = null;
  /** cross-fade in progress: its per-frame observer and the clip it is fading out */
  private fade: { obs: Observer<Scene>; out: AnimationGroup } | null = null;
  /** `ended()` waiters, settled when their clip ends or another one replaces it */
  private waiters = new Map<AnimationGroup, ((natural: boolean) => void)[]>();
  private disposed = false;

  constructor(
    readonly scene: Scene,
    private resolve: (key: string) => AnimationGroup | undefined,
    private o: AnimControllerOptions = {},
  ) {}

  private dt() {
    return this.o.dt ? this.o.dt() : this.scene.getEngine().getDeltaTime() / 1000;
  }

  /** The group for `key` (null when there is no such clip). */
  group(key: string): AnimationGroup | null {
    try {
      return this.resolve(key) ?? null;
    } catch {
      // a resolver may throw for an unknown clip
      return null;
    }
  }

  has(key: string) {
    return !!this.group(key);
  }

  /**
   * Play a clip, cross-fading from the current one. Loops start at a random phase, one-shots at
   * the start. Asking again for the clip that is playing only changes its rate; a finished
   * one-shot starts over. Throws for an unknown key.
   */
  play(key: string, { loop = true, speed = 1, blend = 0.25, offset }: PlayOptions = {}): AnimationGroup {
    const g = this.resolve(key);
    if (!g) throw new Error(`missing clip ${key}`);
    const at = offset ?? (loop ? (this.o.random ?? Math.random)() : 0);
    if (this.current === g && g.isStarted) {
      g.speedRatio = speed;
      return g;
    }
    const prev = this.current === g ? null : this.current;
    if (prev) this.settle(prev, false);
    this.current = g;
    // settle a cross-fade still in progress: the clip it was fading out stops unless it is wanted again
    if (this.fade && this.fade.out !== g) this.fade.out.stop();
    this.endFade();
    // X->Y->X within the blend: X is still playing (fading out), so pick it up where it is
    const g0 = g.isStarted ? g.weight : 0;
    if (g.isStarted) {
      g.loopAnimation = loop;
      g.speedRatio = speed;
      if (!loop) g.goToFrame(g.from + (g.to - g.from) * at);
    } else {
      g.start(loop, speed, g.from, g.to, false);
      const frame = g.from + (g.to - g.from) * at;
      if (frame !== g.from) {
        // Babylon measures a jump made before the first animation step from the animation's frame
        // then (0, not `from`): aim so a clip whose range starts later (a segment) lands on `frame` too
        const base = g.animatables[0]?.masterFrame ?? g.from;
        g.goToFrame(frame - g.from + base);
      }
    }
    this.watchEnd(g);
    if (prev && blend > 0) {
      // linear cross-fade by weights (from wherever an interrupted fade left them)
      const p0 = prev.weight;
      g.weight = g0;
      let t = 0;
      const obs = this.scene.onBeforeAnimationsObservable.add(() => {
        t += this.dt();
        const k = Math.min(1, t / blend);
        g.weight = g0 + (1 - g0) * k;
        prev.weight = p0 * (1 - k);
        if (k >= 1) {
          prev.stop();
          prev.weight = 1;
          this.endFade();
        }
      });
      this.fade = { obs, out: prev };
    } else {
      prev?.stop();
      g.weight = 1;
    }
    return g;
  }

  /**
   * Resolves when `g` ends: true when it ran to its end while still the current clip, false when
   * another clip replaced it or it was stopped (loops only ever resolve false).
   */
  ended(g: AnimationGroup): Promise<boolean> {
    if (this.disposed || this.current !== g || !g.isStarted) return Promise.resolve(false);
    return new Promise((resolve) => {
      const list = this.waiters.get(g) ?? [];
      list.push(resolve);
      this.waiters.set(g, list);
    });
  }

  /** Length of a clip's range in seconds at rate 1 (0 for an unknown key). */
  length(key: string) {
    const g = this.group(key);
    if (!g) return 0;
    const fps = g.targetedAnimations[0]?.animation.framePerSecond ?? 60;
    return (g.to - g.from) / fps;
  }

  /** Stop the current clip and any fade (e.g. before a ragdoll takes over). */
  stopAll() {
    const cur = this.current;
    const out = this.fade?.out;
    this.endFade();
    this.current = null;
    if (cur) this.settle(cur, false);
    out?.stop();
    cur?.stop();
  }

  dispose() {
    this.stopAll();
    this.disposed = true;
    for (const list of this.waiters.values()) for (const r of list) r(false);
    this.waiters.clear();
  }

  private watchEnd(g: AnimationGroup) {
    if (g.loopAnimation) return;
    // one end per start: a one-shot restarted later registers again
    g.onAnimationGroupEndObservable.addOnce(() => this.settle(g, this.current === g));
  }

  private settle(g: AnimationGroup, natural: boolean) {
    const list = this.waiters.get(g);
    if (!list) return;
    this.waiters.delete(g);
    for (const r of list) r(natural);
  }

  private endFade() {
    if (this.fade) this.scene.onBeforeAnimationsObservable.remove(this.fade.obs);
    this.fade = null;
  }
}
