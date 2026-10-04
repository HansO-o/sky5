/**
 * "Let go first": a button that was busy elsewhere (it closed the pause menu, confirmed a modal
 * dialog, was already down when gameplay started) must be released before gameplay reads it again.
 * Without this, the E that picks 继续 in the pause menu would also use whatever interactable is
 * prompted on the first frame back (the key's press edge is still in this frame's input), and a
 * held key would go on to skip the line on screen.
 *
 * Pure: the owner calls `close()` when the button stops being gameplay's, and `update(down)` once
 * per gameplay frame, before anything reads the button, then gates its reads with `open`.
 */
export class ReleaseGate {
  private closed = false;
  private openNow = true;

  /** The button stops counting until it has been seen up (a frame in which it is up still doesn't count). */
  close() {
    this.closed = true;
    this.openNow = false;
  }

  /**
   * Once per frame with the button's state; returns whether gameplay may read it this frame. The
   * frame in which the release is seen stays closed too: a key tapped and let go between two frames
   * leaves its press edge in that frame.
   */
  update(down: boolean): boolean {
    if (this.closed) {
      if (!down) this.closed = false;
      this.openNow = false;
    } else this.openNow = true;
    return this.openNow;
  }

  /** Whether reads count this frame (as of the last `update`). */
  get open() {
    return this.openNow;
  }
}
