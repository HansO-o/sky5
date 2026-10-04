import type { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { hud } from "../ui/hud";
import { BarkGate, BARK } from "../engine/script/barks";
import { LineSkip } from "../engine/script/lineSkip";
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
  /** holding the activate button may end this line early (default: the scope's `skipLines`) */
  skip?: boolean;
}

export interface BarkOptions {
  /** the speaking actor: paces barks per actor (two soldiers sharing a label are separate speakers) */
  npc?: Character | null;
  /** a speaker key of your own instead of `npc` / the name */
  key?: unknown;
  /** seconds before the same speaker barks again (default 4) */
  cooldown?: number;
  /** seconds on screen (default: the reading time, shorter than a scripted line's) */
  duration?: number;
  /** may replace another speaker's bark that has only just appeared */
  force?: boolean;
  /** a talking clip for `npc` (barks leave the body alone unless asked: it may be fighting) */
  talk?: string;
}

/** Where lines go (the HUD's subtitle line). */
export interface DialogueSink {
  subtitle(who: string | null, text: string, force: boolean): void;
  clearSubtitle(): void;
}

export interface DirectorOptions {
  /** subtitles (default: the HUD) */
  dialogue?: DialogueSink;
  /** seconds a scripted line stays up (default 0.19 s per character + 0.8, at least 2.4) */
  readingTime?(text: string): number;
  /** the hold-to-skip button (activate) is down; without it lines can't be skipped */
  skipHeld?(): boolean;
}

/** A line being spoken (`say`). */
interface Line {
  skippable: boolean;
  skipped: boolean;
}

/** The default reading time of a scripted line. */
export const lineDuration = (text: string) => Math.max(2.4, text.length * 0.19 + 0.8);
/** A bark is read at a glance. */
const barkDuration = (text: string) => Math.max(1.8, text.length * 0.16 + 0.8);

/**
 * Coroutine-style cutscene scripting. Scripts are async functions that `await` world time
 * (which pauses with the game and honours the debug time scale) instead of wall-clock timers.
 * The Director is the clock; scripts run in a {@link ScriptScope} (one per chapter run), so
 * cancelling stops exactly that scope's scripts.
 *
 * It also owns the subtitle line: scripted lines (`say`), which the player can end early by
 * holding the activate button (design §3.7), and `bark`s, short non-blocking lines (combat calls,
 * nags) that never play over a scripted line and never hold anything up.
 */
export class Director {
  time = 0;
  private waits: Wait[] = [];
  private scopes = new Set<ScriptScope>();
  private closed = false;
  /** scripted lines being spoken, oldest first (the newest is on screen) */
  private lines: Line[] = [];
  private skip = new LineSkip();
  /** the line on screen whose hold-to-skip `skip` is timing */
  private skipLine: Line | null = null;
  private barks = new BarkGate();
  /** the bark on screen and when it goes */
  private barkShown: { until: number } | null = null;
  /** what put the current subtitle up (a line or a bark): only it takes it down */
  private owner: object | null = null;
  readonly dialogue: DialogueSink;
  readonly readingTime: (text: string) => number;

  constructor(private o: DirectorOptions = {}) {
    this.dialogue = o.dialogue ?? hud;
    this.readingTime = o.readingTime ?? lineDuration;
  }

  /** A scripted line is being spoken (interactables wait, barks are dropped). */
  get speaking() {
    return this.lines.length > 0;
  }

  update(dt: number) {
    this.time += dt;
    this.updateSkip(dt);
    const b = this.barkShown;
    if (b && this.time >= b.until) {
      this.barkShown = null;
      if (this.owner === b) {
        this.owner = null;
        this.dialogue.clearSubtitle();
      }
    }
    const ready = this.waits.filter((w) => (w.until !== undefined ? this.time >= w.until : w.pred!()));
    if (!ready.length) return;
    this.waits = this.waits.filter((w) => !ready.includes(w));
    for (const w of ready) w.resolve();
  }

  /** Hold-to-skip for the line on screen. */
  private updateSkip(dt: number) {
    const held = this.o.skipHeld?.() ?? false;
    const top = this.lines[this.lines.length - 1] ?? null;
    if (top !== this.skipLine) {
      this.skipLine = top;
      if (top?.skippable) this.skip.begin(held);
      else this.skip.end();
    }
    if (this.skip.update(dt, held) && top) top.skipped = true;
  }

  /**
   * A short line that doesn't hold anything up (a combat call, a nag): shown for its reading time
   * unless a scripted line is being spoken (then it is dropped, not queued), the same speaker
   * barked less than `cooldown` (4 s) ago, or another bark has only just appeared. Returns whether
   * it plays. The player is never stopped.
   */
  bark(name: string, text: string, o: BarkOptions = {}): boolean {
    if (this.closed || !text) return false;
    const key = o.key ?? o.npc ?? name;
    if (!this.barks.allow(key, this.time, { cooldown: o.cooldown ?? BARK.cooldown, force: o.force, blocked: this.speaking })) return false;
    const shown = { until: this.time + (o.duration ?? barkDuration(text)) };
    this.barkShown = shown;
    this.owner = shown;
    this.dialogue.subtitle(name, text, true);
    if (o.npc && o.talk) o.npc.play(o.talk, { blend: 0.3 });
    return true;
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

  /** @internal a scripted line goes up (it owns the subtitle until it ends or another line replaces it) */
  beginLine(name: string, text: string, skippable: boolean): Line {
    const line: Line = { skippable, skipped: false };
    this.lines.push(line);
    // a line takes over from a bark
    this.barkShown = null;
    this.owner = line;
    this.dialogue.subtitle(name, text, true);
    return line;
  }

  /** @internal the line is over: `clear` takes the subtitle down (if it is still this line's) */
  endLine(line: Line, clear: boolean) {
    const i = this.lines.indexOf(line);
    if (i >= 0) this.lines.splice(i, 1);
    if (clear && this.owner === line) {
      this.owner = null;
      this.dialogue.clearSubtitle();
    }
  }

  /** Forget every speaker's bark pacing (a new chapter: its cast starts fresh, the last one's actors are let go). */
  resetBarks() {
    this.barks.reset();
  }

  /** Cancel every scope, including any created later (the stage is going away). */
  cancelAll() {
    this.closed = true;
    for (const s of [...this.scopes]) s.cancel();
    this.lines = [];
    this.barkShown = null;
    this.owner = null;
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
  /**
   * Holding the activate button ends a line early (design §3.7). A chapter turns it off where
   * every line matters (the keep's choice at the gate); `say(..., { skip })` decides per line.
   */
  skipLines = true;
  private pending = new Set<() => void>();

  constructor(private readonly clock: Director) {}

  get time() {
    return this.clock.time;
  }

  /** A scripted line is being spoken (by any scope). */
  get speaking() {
    return this.clock.speaking;
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

  /**
   * One line of dialogue with subtitles; resolves after the reading time (+ gap), or as soon as the
   * player has held the activate button long enough to skip it (the gap is then cut short too).
   */
  async say(name: string, text: string, o: SayOptions = {}) {
    if (this.cancelled) throw new Cancelled();
    const dur = o.duration ?? this.clock.readingTime(text);
    const line = this.clock.beginLine(name, text, o.skip ?? this.skipLines);
    const npc = o.npc;
    // everything after beginLine is inside the try: a speaker or look target that throws (an NPC
    // gone missing) must still end the line, or `speaking` would stay true for good (interactables
    // blocked, barks dropped in every later chapter)
    try {
      if (npc) {
        if (o.talk) npc.play(o.talk, { blend: 0.3 });
        const look = o.look;
        npc.lookAt(typeof look === "function" ? look() : (look ?? null));
      }
      await this.until(() => line.skipped, dur);
    } finally {
      // (a cancelled line leaves the subtitle to whoever cancelled it: the stage clears it; a line
      // that failed takes its subtitle down)
      this.clock.endLine(line, !this.cancelled);
    }
    if (npc && o.talk && o.idle) npc.play(o.idle, { blend: 0.4 });
    if (o.gap) await this.sleep(line.skipped ? Math.min(o.gap, 0.15) : o.gap);
  }

  /** A non-blocking line (see {@link Director.bark}); nothing once this scope is cancelled. */
  bark(name: string, text: string, o: BarkOptions = {}): boolean {
    return !this.cancelled && this.clock.bark(name, text, o);
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
