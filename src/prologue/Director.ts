import type { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { hud } from "../ui/hud";
import type { Character } from "../world/characters";

export class Cancelled extends Error {
  constructor() {
    super("cancelled");
  }
}

interface Wait {
  scope: ScriptScope;
  until?: number;
  pred?: () => boolean;
  resolve: () => void;
}

export interface SayOptions {
  /** character that speaks (talk animation + look-at) */
  npc?: Character | null;
  /** where the speaker looks */
  look?: Vector3 | (() => Vector3) | null;
  /** talking clip to play while speaking, then return to `idle` */
  talk?: string;
  idle?: string;
  /** extra seconds after the line */
  gap?: number;
  /** override the reading-time based duration */
  duration?: number;
}

/**
 * Coroutine-style cutscene scripting. Scripts are async functions that `await` world time
 * (which pauses with the game and honours the debug time scale) instead of wall-clock timers.
 * The Director is the clock; scripts run in a {@link ScriptScope} (one per chapter run), so
 * cancelling stops exactly that scope's scripts.
 */
export class Director {
  time = 0;
  private waits: Wait[] = [];
  private scopes = new Set<ScriptScope>();
  private closed = false;

  update(dt: number) {
    this.time += dt;
    const ready = this.waits.filter((w) => (w.until !== undefined ? this.time >= w.until : w.pred!()));
    if (!ready.length) return;
    this.waits = this.waits.filter((w) => !ready.includes(w));
    for (const w of ready) w.resolve();
  }

  /** A new script scope on this clock (born cancelled once the Director is closed). */
  scope() {
    const s = new ScriptScope(this);
    if (this.closed) s.cancel();
    else this.scopes.add(s);
    return s;
  }

  /** @internal queue a world-time wait for a scope */
  add(w: Wait) {
    this.waits.push(w);
  }

  /** @internal forget a cancelled scope and its waits */
  drop(s: ScriptScope) {
    this.waits = this.waits.filter((w) => w.scope !== s);
    this.scopes.delete(s);
  }

  /** Cancel every scope, including any created later (the stage is going away). */
  cancelAll() {
    this.closed = true;
    for (const s of [...this.scopes]) s.cancel();
  }
}

/**
 * The scripting API of one chapter run. Every wait it hands out rejects with {@link Cancelled}
 * once the scope is cancelled, and a cancelled scope never starts another, so the script of a
 * skipped chapter cannot run on into the next one. Promises from outside the Director (flights,
 * camera glides, fades) must be awaited through `wait()` for the same guarantee.
 */
export class ScriptScope {
  cancelled = false;
  private pending = new Set<() => void>();

  constructor(private readonly clock: Director) {}

  get time() {
    return this.clock.time;
  }

  sleep(seconds: number) {
    return this.tick({ until: this.time + seconds });
  }

  until(pred: () => boolean, timeout = Infinity) {
    const end = this.time + timeout;
    return this.tick({ pred: () => pred() || this.time >= end });
  }

  /** Await any other promise under this scope: settles like `p`, or rejects when the scope is cancelled first. */
  wait<T>(p: PromiseLike<T>): Promise<T> {
    if (this.cancelled) return Promise.reject(new Cancelled());
    return new Promise<T>((resolve, reject) => {
      const cancel = () => reject(new Cancelled());
      this.pending.add(cancel);
      // cancelled while `p` was settling (e.g. a skip resolves the flight it stops): still reject
      const settle = (f: () => void) => {
        this.pending.delete(cancel);
        if (this.cancelled) cancel();
        else f();
      };
      p.then(
        (v) => settle(() => resolve(v)),
        (e) => settle(() => reject(e)),
      );
    });
  }

  private tick(w: { until?: number; pred?: () => boolean }) {
    if (this.cancelled) return Promise.reject(new Cancelled());
    return this.wait(new Promise<void>((resolve) => this.clock.add({ ...w, scope: this, resolve })));
  }

  /** One line of dialogue with subtitles; resolves after the reading time (+ gap). */
  async say(name: string, text: string, o: SayOptions = {}) {
    if (this.cancelled) throw new Cancelled();
    const dur = o.duration ?? Math.max(2.4, text.length * 0.19 + 0.8);
    hud.subtitle(name, text, true);
    const npc = o.npc;
    if (npc) {
      if (o.talk) npc.play(o.talk, { blend: 0.3 });
      const look = o.look;
      npc.lookAt(typeof look === "function" ? look() : (look ?? null));
    }
    await this.sleep(dur);
    hud.clearSubtitle();
    if (npc && o.talk && o.idle) npc.play(o.idle, { blend: 0.4 });
    if (o.gap) await this.sleep(o.gap);
  }

  /** Run several script branches concurrently. */
  all(...ps: Promise<unknown>[]) {
    return Promise.all(ps);
  }

  /** Reject every pending wait and refuse new ones, for good (skip, chapter end, stage dispose). */
  cancel() {
    if (this.cancelled) return;
    this.cancelled = true;
    this.clock.drop(this);
    const ps = [...this.pending];
    this.pending.clear();
    for (const c of ps) c();
  }
}
