import { deepClone, deepEqual, withDefaults } from "../core/json";
import type { Disposer } from "../core/types";

/** A system with its own persistent data, saved and restored next to the flags. */
export interface Saveable<T = unknown> {
  readonly key: string;
  readonly version: number;
  save(): T;
  load(d: T, fromVersion: number): void | Promise<void>;
}

/** Everything a save needs to put the world state back: the flags and each Saveable's part. */
export interface WorldSnapshot<F extends object = Record<string, unknown>> {
  v: 1;
  flags: F;
  parts: Record<string, { v: number; d: unknown }>;
}

export interface WorldStateOptions<F extends object> {
  /**
   * Turns raw flags (an older save, a newer one, a hand-edited one) into valid flags. The default
   * lays them over the defaults with {@link withDefaults}.
   */
  normalize?(raw: unknown, defaults: F): F;
}

/**
 * Typed persistent story state: flags (plain data) plus registered {@link Saveable}s.
 *
 * Flags are live: `flags` is the current object and may be mutated in place; `set`/`update` do the
 * same and also notify `on` listeners. A **checkpoint** keeps a copy of the state as it was at the
 * last checkpoint (`checkpoint()`), which is what a save made between checkpoints records and what
 * `rollback()` returns to (e.g. an encounter retried after the player died).
 */
export class WorldState<F extends object> {
  private live: F;
  private saved: WorldSnapshot<F>;
  private listeners = new Map<keyof F, Set<(v: never) => void>>();
  private saveables = new Map<string, Saveable>();
  /** restored parts no registered Saveable claims (yet): kept as they are and written back */
  private foreign: WorldSnapshot<F>["parts"] = {};

  constructor(
    readonly defaults: F,
    private readonly o: WorldStateOptions<F> = {},
  ) {
    this.live = this.normalize(undefined);
    this.saved = this.snapshot();
  }

  private normalize(raw: unknown): F {
    return this.o.normalize ? this.o.normalize(raw, deepClone(this.defaults)) : withDefaults(this.defaults, raw);
  }

  /** The live flags. Mutating nested values directly is allowed but notifies nobody. */
  get flags(): F {
    return this.live;
  }

  get<K extends keyof F>(k: K): F[K] {
    return this.live[k];
  }

  /** Replace one flag; listeners hear about it only if the value changed. */
  set<K extends keyof F>(k: K, v: F[K]) {
    if (deepEqual(this.live[k], v)) return;
    this.live[k] = v;
    this.emit(k);
  }

  /** Change one flag in place (or return a replacement); always notifies its listeners. */
  update<K extends keyof F>(k: K, fn: (v: F[K]) => F[K] | void) {
    const r = fn(this.live[k]);
    if (r !== undefined) this.live[k] = r;
    this.emit(k);
  }

  /** Listen to one flag (set, update, restore, rollback, reset). */
  on<K extends keyof F>(k: K, fn: (v: F[K]) => void): Disposer {
    let set = this.listeners.get(k);
    if (!set) this.listeners.set(k, (set = new Set()));
    const f = fn as (v: never) => void;
    set.add(f);
    return () => void set.delete(f);
  }

  private emit(k: keyof F) {
    const set = this.listeners.get(k);
    if (!set) return;
    for (const fn of [...set]) {
      try {
        (fn as (v: F[keyof F]) => void)(this.live[k]);
      } catch (e) {
        console.error(`flag listener ${String(k)}`, e);
      }
    }
  }

  /** Replace all flags at once, notifying the listeners of every flag that changed. */
  private replace(next: F) {
    const old = this.live;
    this.live = next;
    for (const k of this.listeners.keys()) if (!deepEqual(old[k], next[k])) this.emit(k);
  }

  /**
   * Add a Saveable (one per key). A part for its key restored before it was registered is loaded
   * into it now. The returned disposer unregisters it.
   */
  register(s: Saveable): Disposer {
    if (this.saveables.has(s.key)) throw new Error(`saveable ${s.key} registered twice`);
    this.saveables.set(s.key, s);
    const part = this.foreign[s.key];
    if (part) {
      delete this.foreign[s.key];
      void Promise.resolve(s.load(deepClone(part.d), part.v)).catch((e) => console.error(`saveable ${s.key}: load failed`, e));
    }
    return () => {
      if (this.saveables.get(s.key) === s) this.saveables.delete(s.key);
    };
  }

  /** A deep copy of the current state. */
  snapshot(): WorldSnapshot<F> {
    const parts: WorldSnapshot<F>["parts"] = deepClone(this.foreign);
    for (const [k, s] of this.saveables) parts[k] = { v: s.version, d: deepClone(s.save()) };
    return { v: 1, flags: deepClone(this.live), parts };
  }

  /**
   * Put a snapshot back (`undefined`: the defaults). The flags are in place when this returns; the
   * promise settles once every registered Saveable has loaded its part. Parts for keys nobody has
   * registered are kept verbatim (and saved again), so newer data survives an older build.
   */
  restore(s: WorldSnapshot<F> | undefined): Promise<void> {
    this.replace(this.normalize(s?.flags));
    this.foreign = {};
    const loads: Promise<void>[] = [];
    for (const [k, part] of Object.entries(s?.parts ?? {})) {
      const sv = this.saveables.get(k);
      if (!sv) this.foreign[k] = deepClone(part);
      else loads.push(Promise.resolve(sv.load(deepClone(part.d), part.v)));
    }
    return Promise.all(loads).then(() => {});
  }

  /** Back to the defaults (a new game). Also becomes the checkpoint. */
  reset() {
    this.replace(this.normalize(undefined));
    this.foreign = {};
    this.checkpoint();
  }

  /** Remember the current state as the checkpoint. */
  checkpoint() {
    this.saved = this.snapshot();
  }

  /** The state at the last checkpoint (a copy). */
  get checkpointed(): WorldSnapshot<F> {
    return deepClone(this.saved);
  }

  /** Return to the last checkpoint (flags synchronously; see `restore`). */
  rollback(): Promise<void> {
    return this.restore(deepClone(this.saved));
  }
}
