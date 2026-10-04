/** Hold-to-skip timing for dialogue lines (design §3.7): hold ≥ 0.35 s, once the line has played ≥ 0.3 s. */
export const LINE_SKIP = { hold: 0.35, minAge: 0.3 } as const;

/**
 * Hold-to-skip for the line on screen (pure; the Director feeds it the skip button each frame).
 *
 * - A line ends once the button has been held for `hold` seconds and the line has played for at
 *   least `minAge` seconds.
 * - A hold that began before the line did (the press that used a chest, a hold on an interactable)
 *   does not count: the button must be released first. The exception is a hold that has just
 *   skipped the previous line: keeping it down fast-forwards line after line.
 */
export class LineSkip {
  private readonly hold: number;
  private readonly minAge: number;
  private age = 0;
  private held = 0;
  private eligible = false;
  private done = true;
  /** the last line ended by a skip while the button stayed down */
  private chain = false;

  constructor(o: { hold?: number; minAge?: number } = {}) {
    this.hold = o.hold ?? LINE_SKIP.hold;
    this.minAge = o.minAge ?? LINE_SKIP.minAge;
  }

  /** A new line is on screen; `held`: the button is down right now. */
  begin(held: boolean) {
    this.age = 0;
    this.held = 0;
    this.eligible = !held || this.chain;
    this.chain = false;
    this.done = false;
  }

  /** No line any more (the line ended on its own or was cancelled). */
  end() {
    this.done = true;
  }

  /** Advance by `dt` seconds of game time; true (once per line) when the line should end now. */
  update(dt: number, held: boolean): boolean {
    if (!held) {
      // released: the next hold counts, and no chain carries into a later line
      this.held = 0;
      this.eligible = true;
      this.chain = false;
    }
    if (this.done) return false;
    this.age += dt;
    if (!held || !this.eligible) return false;
    this.held += dt;
    if (this.held + 1e-9 < this.hold || this.age + 1e-9 < this.minAge) return false;
    this.done = true;
    this.chain = true;
    return true;
  }

  /** How far the current hold is toward a skip (0..1; 0 while it can't count). */
  get progress() {
    return this.done || !this.eligible ? 0 : Math.min(1, this.held / this.hold);
  }
}
