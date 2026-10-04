/** Bark pacing defaults (design §3.7, §5.3: "at least 4 s apart per speaker"). */
export const BARK = {
  /** seconds between two barks of the same speaker */
  cooldown: 4,
  /** seconds a bark keeps the subtitle line before another speaker's bark may replace it */
  gap: 1.2,
} as const;

export interface BarkAsk {
  /** seconds since this speaker's last bark before it may bark again (default `BARK.cooldown`) */
  cooldown?: number;
  /** ignore the gap after another speaker's bark (the speaker's own cooldown still applies) */
  force?: boolean;
  /** a scripted line is being spoken: barks are dropped, not queued */
  blocked?: boolean;
}

/**
 * Decides whether a bark may play (pure; times are any monotonic clock, e.g. the Director's game
 * time). Barks never wait: one that may not play now is dropped.
 * - Never while a scripted line (`say`) is running.
 * - Never within `cooldown` of the same speaker's last bark. Speakers are keys of any kind: a name,
 *   or the actor object so two soldiers sharing a label are paced apart.
 * - Not within `gap` of any other bark (unless `force`), so lines don't flicker over each other.
 */
export class BarkGate {
  /** names and other primitive keys */
  private last = new Map<unknown, number>();
  /** actor keys: held weakly, so a disposed enemy (every retry spawns new ones) is let go */
  private lastObj = new WeakMap<object, number>();
  private lastAny = -Infinity;
  private readonly gap: number;
  private readonly cooldown: number;

  constructor(o: { gap?: number; cooldown?: number } = {}) {
    this.gap = o.gap ?? BARK.gap;
    this.cooldown = o.cooldown ?? BARK.cooldown;
  }

  /** Whether `speaker` may bark at `now`; when it may, the bark is recorded. */
  allow(speaker: unknown, now: number, o: BarkAsk = {}): boolean {
    if (o.blocked) return false;
    const obj = isObject(speaker);
    const prev = obj ? this.lastObj.get(speaker) : this.last.get(speaker);
    if (prev !== undefined && now - prev < (o.cooldown ?? this.cooldown)) return false;
    if (!o.force && now - this.lastAny < this.gap) return false;
    if (obj) this.lastObj.set(speaker, now);
    else this.last.set(speaker, now);
    this.lastAny = now;
    return true;
  }

  /** Forget every speaker (a new chapter, a retried fight). */
  reset() {
    this.last.clear();
    this.lastObj = new WeakMap();
    this.lastAny = -Infinity;
  }
}

function isObject(v: unknown): v is object {
  return (typeof v === "object" && v !== null) || typeof v === "function";
}
