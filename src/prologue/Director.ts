import type { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { hud } from "../ui/hud";
import type { Character } from "../world/characters";

export class Cancelled extends Error {
  constructor() {
    super("cancelled");
  }
}

interface Wait {
  until?: number;
  pred?: () => boolean;
  resolve: () => void;
  reject: (e: Error) => void;
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
 */
export class Director {
  time = 0;
  private waits: Wait[] = [];
  private cancelled = false;

  update(dt: number) {
    this.time += dt;
    const ready = this.waits.filter((w) => (w.until !== undefined ? this.time >= w.until : w.pred!()));
    if (!ready.length) return;
    this.waits = this.waits.filter((w) => !ready.includes(w));
    for (const w of ready) w.resolve();
  }

  private add(w: Omit<Wait, "resolve" | "reject">) {
    if (this.cancelled) return Promise.reject(new Cancelled());
    return new Promise<void>((resolve, reject) => this.waits.push({ ...w, resolve, reject }));
  }

  sleep(seconds: number) {
    return this.add({ until: this.time + seconds });
  }

  until(pred: () => boolean, timeout = Infinity) {
    const end = this.time + timeout;
    return this.add({ pred: () => pred() || this.time >= end });
  }

  /** One line of dialogue with subtitles; resolves after the reading time (+ gap). */
  async say(name: string, text: string, o: SayOptions = {}) {
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

  cancelAll() {
    this.cancelled = true;
    const ws = this.waits;
    this.waits = [];
    for (const w of ws) w.reject(new Cancelled());
  }
}
