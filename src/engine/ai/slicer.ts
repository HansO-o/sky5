import type { Disposer } from "../core/types";

interface Entry<T> {
  item: T;
  /** seconds between runs */
  period: number;
  /** seconds since its last run */
  acc: number;
}

/** What one run reports: the budget it spent, or null when it needs more than is left this frame. */
export type SliceRun<T> = (item: T, dt: number, left: number) => number | null | void;

/**
 * Time slicing for many periodic jobs (brains at 10 Hz, perception at 5 Hz): every item runs at
 * its own rate with the seconds since its last run, items are spread over frames (each starts at a
 * different phase), and a per-frame budget caps the work (brains per frame, line-of-sight rays per
 * frame). Items that are due when the budget runs out wait for the next frame, which starts with
 * them (round robin), so nobody starves. Pure: the owner calls `update(dt)`.
 */
export class TimeSlicer<T> {
  private list: Entry<T>[] = [];
  /** where the next frame starts looking (round robin) */
  private cursor = 0;
  private added = 0;

  constructor(private o: { hz: number; budget?: number; maxDt?: number }) {}

  /** Run `item` `hz` times a second (default: the slicer's). */
  add(item: T, o: { hz?: number } = {}): Disposer {
    const period = 1 / Math.max(1e-3, o.hz ?? this.o.hz);
    // spread the phases (golden-ratio steps) so items added together don't all run on one frame
    const e: Entry<T> = { item, period, acc: period * ((this.added++ * 0.618034) % 1) };
    this.list.push(e);
    return () => this.remove(item);
  }

  remove(item: T) {
    const i = this.list.findIndex((e) => e.item === item);
    if (i < 0) return;
    this.list.splice(i, 1);
    if (this.cursor > i) this.cursor--;
    if (this.cursor >= this.list.length) this.cursor = 0;
  }

  has(item: T) {
    return this.list.some((e) => e.item === item);
  }

  get size() {
    return this.list.length;
  }

  get items(): T[] {
    return this.list.map((e) => e.item);
  }

  /** Per-frame budget (Infinity: none). */
  get budget() {
    return this.o.budget ?? Infinity;
  }
  set budget(n: number) {
    this.o.budget = n;
  }

  /**
   * Advance `dt` seconds and run the items that are due, in round-robin order, while the budget
   * lasts. `run` gets the seconds since the item's last run (capped at `maxDt`, default 0.5) and the
   * budget left; it returns what it spent (default 1), or null to wait for a frame with more
   * budget. Returns how many items ran.
   */
  update(dt: number, run: SliceRun<T>): number {
    const n = this.list.length;
    if (!n) return 0;
    for (const e of this.list) e.acc += Math.max(0, dt);
    let left = this.budget;
    let ran = 0;
    const start = this.cursor % n;
    // a snapshot: items added or removed by a run take effect next frame
    const order = [...this.list.slice(start), ...this.list.slice(0, start)];
    let next = -1;
    for (const e of order) {
      // (a little slack: six 1/60 s frames make 0.1 s even with rounding)
      if (e.acc < e.period - 1e-4) continue;
      if (left <= 0) {
        if (next < 0) next = this.list.indexOf(e);
        continue;
      }
      if (!this.list.includes(e)) continue;
      const cost = run(e.item, Math.min(e.acc, this.o.maxDt ?? 0.5), left);
      if (cost === null) {
        // waits for a frame with more budget, and that frame starts with it
        if (next < 0) next = this.list.indexOf(e);
        continue;
      }
      // it was given all the time since its last run
      e.acc = 0;
      left -= cost ?? 1;
      ran++;
    }
    if (next >= 0) this.cursor = next;
    else if (this.list.length) this.cursor = (start + 1) % this.list.length;
    return ran;
  }

  clear() {
    this.list = [];
    this.cursor = 0;
  }
}
