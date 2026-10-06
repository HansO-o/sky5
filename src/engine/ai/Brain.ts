/**
 * A small hierarchical state machine (engine-framework §2.19 `Brain`, `BrainState`). States are
 * named; a state may have a `parent`, so a family of states shares the parent's update (checked
 * first: a parent can leave the whole family, e.g. "combat" giving up when no enemy is left) and
 * its enter/exit (run once when the family is entered or left, not on moves inside it). Pure: no
 * Babylon, no clock of its own (`update(dt)` advances it).
 *
 * The `ai/` modules against engine-framework §1.1/§2.19: `Brain.ts` (this), `AISystem.ts` (`add`
 * takes a `Brain` or a fighting brain), `Perception.ts` (`canSee`, `createPerception`; the noise
 * channel is a `NoiseBus`), `AgentMover.ts` (on a `CapsuleMover` with direct steering instead of a
 * `NavAgent`, design §0 #12). The brains themselves (`CombatBrain`, `HumanoidBrain`,
 * `CreatureBrain`, `Companion`) are the flagship's states, built on this machine rather than on
 * §2.19's shared `states.ts`, which ships once a second game needs them; `noise`, `steering`,
 * `agent`, `breadcrumbs`, `lunge`, `slicer` and `tuning` are their helpers.
 */
import type { DisposerSink } from "../core/emitter";
import { Emitter } from "../core/emitter";

export interface BrainState<C> {
  /** the enclosing state: its update runs first, its enter/exit only when the family is entered or left */
  parent?: string;
  /** entered (from the leaf state that was current; null for the initial state) */
  enter?(c: C, from: string | null): void;
  /** each update while this state (or a child) is current: a state name to move there, or nothing */
  update?(c: C, dt: number): string | null | void;
  /** left (toward the leaf state that will be current) */
  exit?(c: C, to: string): void;
}

export interface BrainTransition {
  from: string | null;
  to: string;
}

/** Transitions one update may chain (a state whose enter or update moves on at once) before it stops. */
const MAX_CHAIN = 8;

/**
 * The state machine: `state` is the current leaf; `in(s)` asks whether `s` is it or one of its
 * ancestors. `go(s)` moves at once (exit up to the common ancestor, enter down to `s`), also from
 * inside an update or an event handler. `suspend()` stops updates (a cutscene has the actor) until
 * `resume()`.
 */
export class Brain<C> {
  readonly onChange = new Emitter<BrainTransition>();
  private cur: string | null = null;
  /** game seconds updated so far */
  private clock = 0;
  private enteredAt = new Map<string, number>();
  private paths = new Map<string, readonly string[]>();
  private suspendedFlag = false;
  /** counts suspends and resumes (a scope's resume hook acts only for its own suspend) */
  private suspensions = 0;
  private disposed = false;
  /** transitions so far in this update or outside call (a runaway loop of moves is cut off) */
  private chain = 0;
  /** nesting of go() calls and whether an update is running (a fresh outside call resets `chain`) */
  private depth = 0;
  private updating = false;
  /** states are being exited: a move asked for meanwhile waits until this transition is done */
  private exiting = false;
  private pending: string | null = null;

  constructor(
    private states: Record<string, BrainState<C>>,
    initial: string,
    readonly ctx: C,
  ) {
    for (const s of Object.keys(states)) this.path(s);
    this.go(initial);
  }

  /** The current (leaf) state. */
  get state(): string {
    return this.cur!;
  }

  /** Seconds since `s` (default: the current state) was entered; 0 when it is not current. */
  elapsed(s: string = this.cur!) {
    if (!this.in(s)) return 0;
    return this.clock - (this.enteredAt.get(s) ?? this.clock);
  }

  /** Whether `s` is the current state or one of its ancestors. */
  in(s: string) {
    return !!this.cur && this.path(this.cur).includes(s);
  }

  get suspended() {
    return this.suspendedFlag;
  }

  /** States from the root down to `s`. */
  path(s: string): readonly string[] {
    const known = this.paths.get(s);
    if (known) return known;
    const out: string[] = [];
    const seen = new Set<string>();
    for (let k: string | undefined = s; k !== undefined; k = this.states[k]?.parent) {
      if (!this.states[k]) throw new Error(`brain: no state ${k}`);
      if (seen.has(k)) throw new Error(`brain: parent cycle at ${k}`);
      seen.add(k);
      out.unshift(k);
    }
    this.paths.set(s, out);
    return out;
  }

  /**
   * Move to `to` now. Moving to the current state does nothing unless `restart` (exit and enter it
   * again, e.g. the next swing of a combo).
   */
  go(to: string, o: { restart?: boolean } = {}) {
    if (this.disposed) return;
    const target = this.path(to);
    const from = this.cur;
    if (this.exiting) {
      // asked from an exit: done once the transition under way has finished
      this.pending = to;
      return;
    }
    if (from === to && !o.restart) return;
    if (!this.updating && this.depth === 0) this.chain = 0;
    if (++this.chain > MAX_CHAIN) {
      console.warn(`brain: transition loop ${from} -> ${to}`);
      return;
    }
    this.depth++;
    try {
      this.move(from, to, target);
    } finally {
      this.exiting = false;
      this.depth--;
    }
    const next = this.pending;
    this.pending = null;
    if (next && next !== this.cur) this.go(next);
  }

  private move(from: string | null, to: string, target: readonly string[]) {
    const src = from ? this.path(from) : [];
    // the deepest state both paths share stays entered (a restart leaves and enters the leaf)
    let common = 0;
    while (common < src.length && common < target.length && src[common] === target[common]) common++;
    if (from === to) common = target.length - 1;
    this.exiting = true;
    for (let i = src.length - 1; i >= common; i--) {
      this.states[src[i]].exit?.(this.ctx, to);
      if (this.disposed) return;
    }
    this.exiting = false;
    this.cur = to;
    for (let i = common; i < target.length; i++) this.enteredAt.set(target[i], this.clock);
    this.onChange.emit({ from, to });
    for (let i = common; i < target.length; i++) {
      this.states[target[i]].enter?.(this.ctx, from);
      if (this.cur !== to || this.disposed) return;
    }
  }

  /**
   * Advance by `dt`: each state from the root down to the current one updates in turn; the first
   * that names another state moves there (and the rest of this update is skipped). A move made by
   * an update's own side effects (an event it caused) counts the same.
   */
  update(dt: number) {
    if (this.disposed) return;
    this.clock += dt;
    this.chain = 0;
    if (this.suspendedFlag || !this.cur) return;
    const at = this.cur;
    this.updating = true;
    try {
      for (const s of this.path(at)) {
        const next = this.states[s].update?.(this.ctx, dt);
        if (this.cur !== at || this.disposed) return;
        if (next && next !== at) {
          this.go(next);
          return;
        }
        if (next === at) return;
      }
    } finally {
      this.updating = false;
    }
  }

  /**
   * Stop updating (a cutscene has the actor) until `resume()`, or until `scope` ends. `state`: go
   * there first (e.g. "scripted", whose enter lets go of the body).
   */
  suspend(scope?: DisposerSink, state?: string) {
    if (state) this.go(state);
    this.suspendedFlag = true;
    // only this suspension: a scope ending after a resume (and a newer suspend) leaves it be
    const n = ++this.suspensions;
    scope?.add(() => {
      if (this.suspensions === n) this.resume();
    });
  }

  /** Update again (from `state`, when given). */
  resume(state?: string) {
    this.suspensions++;
    this.suspendedFlag = false;
    if (state) this.go(state);
  }

  dispose() {
    this.disposed = true;
    this.onChange.clear();
  }
}
