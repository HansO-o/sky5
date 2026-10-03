import type { Disposer } from "../core/types";

type XYZ = { readonly x: number; readonly y: number; readonly z: number };

/** An axis-aligned box in world metres. */
export interface Aabb {
  min: readonly [number, number, number];
  max: readonly [number, number, number];
}

/** An ambience bed: an audio asset id and its gain (beds are loudness-normalised, so each sets its own level). */
export interface BedSpec {
  id: string;
  gain?: number;
}

/** What a zone sets while the probe is in it. */
export interface ZoneEffects {
  /** lighting profile set on entry (e.g. "hall", "cave") */
  profile?: string;
  /** seconds the lighting blend takes (default 1.5) */
  blend?: number;
  /** visibility sets shown while this zone, or a zone listing it as a neighbour, is current */
  show?: readonly string[];
  /** ambience beds playing while this zone is current */
  beds?: readonly (string | BedSpec)[];
  /** music state on entry: a value is passed on, null stops the music, undefined leaves it alone */
  music?: string | null;
}

export interface ZoneDef extends ZoneEffects {
  id: string;
  /** the zone is the union of these boxes */
  boxes: readonly Aabb[];
  /** zones whose visibility sets stay shown while this one is current (not implied the other way) */
  neighbours?: readonly string[];
  /** where zones overlap the higher wins (default 0; then the one defined first) */
  priority?: number;
}

/** What the zones drive. Everything is injected: this module imports no platform singleton. */
export interface ZoneHost {
  /** the point tested against the boxes (e.g. the player's feet); null skips the check */
  probe(): XYZ | null;
  profile?(name: string, seconds: number): void;
  show?(set: string, on: boolean): void;
  /** `gain` is the bed's own gain when it gives one */
  startBed?(id: string, gain: number | undefined): void;
  stopBed?(id: string): void;
  music?(state: string | null): void;
  /** after every zone change (null: outside every zone) */
  entered?(zone: ZoneDef | null, from: ZoneDef | null): void;
}

export interface ZonesOptions {
  /** checks per second (default 4) */
  hz?: number;
  /** metres the current zone's boxes grow by before the probe counts as having left it (default 0.5) */
  margin?: number;
  /** what applies outside every zone */
  outside?: ZoneEffects;
  /** a frame bus to run `update` on (e.g. the world's onUpdate); dispose() unregisters */
  bus?: { onUpdate(fn: (dt: number) => void): () => unknown };
}

export function inAabb(b: Aabb, p: XYZ, margin = 0) {
  return (
    p.x >= b.min[0] - margin && p.x <= b.max[0] + margin &&
    p.y >= b.min[1] - margin && p.y <= b.max[1] + margin &&
    p.z >= b.min[2] - margin && p.z <= b.max[2] + margin
  );
}

const inZone = (z: ZoneDef, p: XYZ, margin = 0) => z.boxes.some((b) => inAabb(b, p, margin));

/**
 * The zone the probe is in: the highest-priority zone containing it (the first defined on ties).
 * The `current` zone is kept while the probe is within `margin` of it, unless a zone of higher
 * priority contains the probe (hysteresis at shared walls).
 */
export function zoneAt(defs: readonly ZoneDef[], p: XYZ, current: ZoneDef | null = null, margin = 0): ZoneDef | null {
  let best: ZoneDef | null = null;
  for (const z of defs) if (inZone(z, p) && (!best || (z.priority ?? 0) > (best.priority ?? 0))) best = z;
  if (current && defs.includes(current) && inZone(current, p, margin) && (!best || (best.priority ?? 0) <= (current.priority ?? 0))) return current;
  return best;
}

/** The visibility sets shown while `zone` is current: its own and its neighbours' (outside: `outside.show`). */
export function shownSets(defs: readonly ZoneDef[], zone: ZoneDef | null, outside?: ZoneEffects): Set<string> {
  if (!zone) return new Set(outside?.show ?? []);
  const out = new Set(zone.show ?? []);
  for (const id of zone.neighbours ?? []) for (const s of defs.find((d) => d.id === id)?.show ?? []) out.add(s);
  return out;
}

const bedsOf = (e: ZoneEffects) => new Map((e.beds ?? []).map((b) => (typeof b === "string" ? [b, undefined] : [b.id, b.gain])));

/**
 * Axis-aligned zones (keep floors, cave sections) checked a few times a second against a probe. On a
 * zone change it sets the lighting profile, shows the zone's and its neighbours' visibility sets and
 * hides the rest, swaps the ambience beds and sets the music state, each only when it changes.
 */
export class Zones {
  private defs: ZoneDef[] = [];
  private cur: ZoneDef | null = null;
  private applied = false;
  private shownNow = new Set<string>();
  private beds = new Map<string, number | undefined>();
  private music: string | null | undefined = undefined;
  private profile: string | undefined = undefined;
  private acc = 0;
  private off: (() => unknown) | null = null;
  private disposed = false;

  constructor(
    private host: ZoneHost,
    defs: readonly ZoneDef[] = [],
    private o: ZonesOptions = {},
  ) {
    for (const d of defs) this.define(d);
    if (o.bus) this.off = o.bus.onUpdate((dt) => this.update(dt));
  }

  /** Add a zone (replacing one with the same id); the disposer removes it again. */
  define(def: ZoneDef): Disposer {
    const old = this.defs.findIndex((d) => d.id === def.id);
    if (old >= 0) this.defs[old] = def;
    else this.defs.push(def);
    return () => {
      const i = this.defs.indexOf(def);
      if (i >= 0) this.defs.splice(i, 1);
    };
  }

  get zones(): readonly ZoneDef[] {
    return this.defs;
  }

  /** The zone the probe was in at the last check (null: outside every zone). */
  get current() {
    return this.cur;
  }

  /** The visibility sets shown now. */
  get shown(): ReadonlySet<string> {
    return this.shownNow;
  }

  /** Call every frame; checks at `hz`. */
  update(dt: number) {
    if (this.disposed) return;
    this.acc += dt;
    const period = 1 / (this.o.hz ?? 4);
    if (this.acc < period) return;
    this.acc %= period;
    this.check();
  }

  /** Check now (e.g. right after a teleport). The first check applies everything. */
  check() {
    if (this.disposed) return;
    const p = this.host.probe();
    if (!p) return;
    const z = zoneAt(this.defs, p, this.cur, this.o.margin ?? 0.5);
    if (this.applied && z === this.cur) return;
    this.enter(z);
  }

  /** Apply everything again at the next check (after something else changed the profile, beds or music). */
  reset() {
    this.applied = false;
    this.profile = undefined;
    this.music = undefined;
  }

  private enter(z: ZoneDef | null) {
    const host = this.host;
    const from = this.cur;
    const first = !this.applied;
    this.cur = z;
    this.applied = true;
    const fx: ZoneEffects = z ?? this.o.outside ?? {};
    if (fx.profile !== undefined && fx.profile !== this.profile) {
      this.profile = fx.profile;
      host.profile?.(fx.profile, fx.blend ?? 1.5);
    }
    const want = shownSets(this.defs, z, this.o.outside);
    const managed = new Set<string>(this.o.outside?.show ?? []);
    for (const d of this.defs) for (const s of d.show ?? []) managed.add(s);
    for (const s of managed) {
      const on = want.has(s);
      if (first || on !== this.shownNow.has(s)) host.show?.(s, on);
      if (on) this.shownNow.add(s);
      else this.shownNow.delete(s);
    }
    const beds = bedsOf(fx);
    for (const id of [...this.beds.keys()])
      if (!beds.has(id)) {
        host.stopBed?.(id);
        this.beds.delete(id);
      }
    for (const [id, gain] of beds)
      if (!this.beds.has(id)) {
        host.startBed?.(id, gain);
        this.beds.set(id, gain);
      }
    if (fx.music !== undefined && fx.music !== this.music) {
      this.music = fx.music;
      host.music?.(fx.music);
    }
    host.entered?.(z, from);
  }

  /** Stop checking and stop the beds the zones started (profile, sets and music stay as they are). */
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.off?.();
    this.off = null;
    for (const id of this.beds.keys()) this.host.stopBed?.(id);
    this.beds.clear();
  }
}
