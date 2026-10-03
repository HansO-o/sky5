/**
 * One active command at a time for an actor driven by long-running behaviours (a flying creature's
 * circuit, a scripted pass): every `begin` pre-empts the previous command, whose loops see
 * `live(token)` turn false at their next check and end. Pure bookkeeping, no timers.
 */
export class CommandSlot<M extends string> {
  private token = 0;
  private current: M;
  private spec: string | null = null;

  constructor(initial: M) {
    this.current = initial;
  }

  get mode(): M {
    return this.current;
  }

  /** Whether this exact command (mode + parameters) is the one running: issuing it again changes nothing. */
  running(mode: M, spec: string | null): boolean {
    return spec !== null && this.current === mode && this.spec === spec;
  }

  /** Start a command; returns its token. */
  begin(mode: M, spec: string | null = null): number {
    this.current = mode;
    this.spec = spec;
    return ++this.token;
  }

  /** The command with this token has not been pre-empted. */
  live(token: number): boolean {
    return token === this.token;
  }

  /**
   * A command that finished by itself moves on to `mode` (e.g. a completed flight leaves the actor
   * idle); false, and nothing changes, if it had been pre-empted.
   */
  settle(token: number, mode: M): boolean {
    if (token !== this.token) return false;
    this.current = mode;
    this.spec = null;
    return true;
  }
}
