import type { Disposer } from "./types";

/** Something that ends listeners with it (a scope, a chapter): `add` runs the disposer at its end. */
export interface DisposerSink {
  add(d: Disposer): void;
}

/**
 * A typed event source. Listeners run in subscription order; one that throws is logged and the
 * rest still run (an event never breaks its emitter's caller).
 */
export class Emitter<T> {
  private fns = new Set<(v: T) => void>();

  /** Listen until the returned disposer is called (or `scope` ends). */
  on(fn: (v: T) => void, scope?: DisposerSink): Disposer {
    // the same function twice is two subscriptions
    const f = (v: T) => fn(v);
    this.fns.add(f);
    const off = () => {
      this.fns.delete(f);
    };
    scope?.add(off);
    return off;
  }

  /** The next value emitted (none once `scope` has ended: the promise then stays pending). */
  once(scope?: DisposerSink): Promise<T> {
    return new Promise((resolve) => {
      const off = this.on((v) => {
        off();
        resolve(v);
      }, scope);
    });
  }

  emit(v: T) {
    for (const f of [...this.fns]) {
      try {
        f(v);
      } catch (e) {
        console.error("emitter listener", e);
      }
    }
  }

  /** Drop every listener. */
  clear() {
    this.fns.clear();
  }

  /** How many listeners there are. */
  get size() {
    return this.fns.size;
  }
}
