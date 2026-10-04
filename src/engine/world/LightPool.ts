import { PointLight } from "@babylonjs/core/Lights/pointLight";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { Scene } from "@babylonjs/core/scene";
import type { Disposer } from "../core/types";

type XYZ = { readonly x: number; readonly y: number; readonly z: number };

/** Something that wants to be lit by a pool light (a fire, a brazier, a carried torch). */
export interface LightSource {
  /** where the light sits: a point read live (mutate it to move the light) or a function */
  at: Vector3 | (() => Vector3);
  /** linear RGB (default white) */
  color?: readonly [number, number, number];
  /** default 1 */
  intensity?: number;
  /** metres (default 10) */
  range?: number;
  /** relative flicker amplitude, 0..1 (a fire is about 0.3; default 0) */
  flicker?: number;
  /** ranks before distance: a higher priority always wins a slot over a lower one (default 0) */
  priority?: number;
  /**
   * competes for a slot only within this distance of the eye (default: the pool's `maxDistance`,
   * 18 m); a big fire seen from afar can reach farther
   */
  reach?: number;
}

/** A source added to the pool. */
export interface LightClaim {
  readonly id: number;
  /** the slot lighting it now, -1 when none does */
  readonly slot: number;
  /** false once stopped */
  readonly active: boolean;
  /** live intensity; 0 gives up its slot (a doused torch), raising it competes again */
  intensity: number;
  /** remove the source: its slot fades out and is reassigned */
  stop(): void;
}

/** What slot assignment needs to know about a source. */
export interface PoolCandidate {
  id: number;
  x: number;
  y: number;
  z: number;
  priority?: number;
  /** its own maximum distance (default `PickOptions.maxDistance`) */
  reach?: number;
}

export interface PickOptions {
  /** sources farther than this from the eye are never lit (metres) */
  maxDistance: number;
  /** how far behind the eye plane a source still counts as in front (its light reaches the view) */
  behind: number;
  /** metres of advantage a source lit now has over the others (no swapping between equals) */
  hysteresis: number;
}

/**
 * The `n` sources to light, best first: higher priority first, then the ones in front of the eye
 * (within `behind` metres of its plane), then the nearest (a lit source counts `hysteresis` metres
 * nearer); ties by id. Only sources within `maxDistance` (or their own `reach`) qualify.
 */
export function pickSources(cands: readonly PoolCandidate[], eye: XYZ, forward: XYZ, n: number, lit: ReadonlySet<number>, o: PickOptions): number[] {
  if (n <= 0) return [];
  const scored: { id: number; pri: number; front: boolean; d: number }[] = [];
  for (const c of cands) {
    const dx = c.x - eye.x, dy = c.y - eye.y, dz = c.z - eye.z;
    const d2 = dx * dx + dy * dy + dz * dz;
    const max = c.reach ?? o.maxDistance;
    if (d2 > max * max) continue;
    const front = dx * forward.x + dy * forward.y + dz * forward.z >= -o.behind;
    scored.push({ id: c.id, pri: c.priority ?? 0, front, d: Math.sqrt(d2) - (lit.has(c.id) ? o.hysteresis : 0) });
  }
  scored.sort((a, b) => b.pri - a.pri || Number(b.front) - Number(a.front) || a.d - b.d || a.id - b.id);
  return scored.slice(0, n).map((s) => s.id);
}

/**
 * Put the chosen sources into slots: a chosen source keeps the slot it already has (no needless
 * crossfade), the others take the free usable slots in rank order. Unusable slots get null.
 */
export function placeInSlots(chosen: readonly number[], current: readonly (number | null)[], usable: readonly boolean[]): (number | null)[] {
  const want = new Set(chosen);
  const out: (number | null)[] = current.map((id, i) => (usable[i] && id !== null && want.has(id) ? id : null));
  const placed = new Set(out.filter((id): id is number => id !== null));
  let free = 0;
  for (const id of chosen) {
    if (placed.has(id)) continue;
    while (free < out.length && (!usable[free] || out[free] !== null)) free++;
    if (free >= out.length) break;
    out[free] = id;
    placed.add(id);
  }
  return out;
}

/** Flicker multiplier around 1, within ±`amount` (two incommensurate sines, phase per source). */
export function flickerAt(t: number, amount: number, phase: number) {
  return 1 + amount * (0.6 * Math.sin(t * 13 + phase) + 0.4 * Math.sin(t * 29 + phase * 1.7));
}

interface Source {
  id: number;
  at: Vector3 | (() => Vector3);
  color: Color3;
  intensity: number;
  range: number;
  flicker: number;
  priority: number;
  reach: number | undefined;
  phase: number;
  alive: boolean;
  /** where it was last seen (a stopped source fades out there) */
  pos: Vector3;
  slot: number;
}

interface Slot {
  light: PointLight;
  /** the source the light shows now (fading in, lit, or fading out) */
  shown: Source | null;
  /** the source the slot should show; the light fades out and back in when they differ */
  target: Source | null;
  /** 0..1 fade weight of `shown` */
  w: number;
  /** a source this slot is reserved for (a companion's torch) */
  locked: Source | null;
}

export interface LightPoolOptions {
  /** fixed point lights the pool owns (default 3) */
  slots?: number;
  /** seconds between assignments (default 0.25) */
  interval?: number;
  /** seconds a slot takes to move to another source: out, then in (default 0.3) */
  fade?: number;
  /** see {@link PickOptions} (defaults 18 m, 2 m, 1.5 m) */
  maxDistance?: number;
  behind?: number;
  hysteresis?: number;
  /** light name prefix (default "pool") */
  name?: string;
}

/**
 * A fixed set of point lights shared by every light-giving effect. The lights exist from boot and
 * are never added, removed or disabled (only their intensity, colour, range and position change), so
 * the scene's light set never changes and no material ever recompiles because of a fire or a torch.
 * Every `interval` the slots go to the nearest in-front sources within `maxDistance` of the eye,
 * moving with a crossfade; a slot can be locked to one source (the companion's torch).
 */
export class LightPool {
  readonly lights: readonly PointLight[];
  private slotList: Slot[];
  private sources = new Map<number, Source>();
  private activeSlots: number;
  private timer = 0;
  private dirty = true;
  private t = 0;
  private nextId = 1;
  private o: Required<Omit<LightPoolOptions, "slots" | "name">>;
  private disposed = false;

  constructor(scene: Scene, opts: LightPoolOptions = {}) {
    const n = Math.max(0, Math.floor(opts.slots ?? 3));
    this.o = { interval: opts.interval ?? 0.25, fade: opts.fade ?? 0.3, maxDistance: opts.maxDistance ?? 18, behind: opts.behind ?? 2, hysteresis: opts.hysteresis ?? 1.5 };
    const lights: PointLight[] = [];
    for (let i = 0; i < n; i++) {
      const l = new PointLight(`${opts.name ?? "pool"}${i}`, new Vector3(0, -1000, 0), scene);
      // no specular highlights (and the same for every slot, always)
      l.specular = Color3.Black();
      l.intensity = 0;
      l.range = 10;
      lights.push(l);
    }
    this.lights = lights;
    this.slotList = lights.map((light) => ({ light, shown: null, target: null, w: 0, locked: null }));
    this.activeSlots = n;
  }

  /** Slots in use (the lights beyond them stay dark): quality "low" uses 2. */
  get slots() {
    return this.activeSlots;
  }

  setSlots(n: number) {
    const k = Math.max(0, Math.min(this.lights.length, Math.floor(n)));
    if (k === this.activeSlots) return;
    this.activeSlots = k;
    this.dirty = true;
  }

  /** Light this source when it is among the nearest in front of the eye. */
  add(src: LightSource): LightClaim {
    const id = this.nextId++;
    const c = src.color ?? [1, 1, 1];
    const s: Source = {
      id,
      at: src.at,
      color: new Color3(c[0], c[1], c[2]),
      intensity: src.intensity ?? 1,
      range: src.range ?? 10,
      flicker: src.flicker ?? 0,
      priority: src.priority ?? 0,
      reach: src.reach,
      phase: (id * 2.399963) % (Math.PI * 2),
      alive: !this.disposed,
      pos: new Vector3(),
      slot: -1,
    };
    s.pos.copyFrom(this.where(s));
    if (s.alive) this.sources.set(id, s);
    this.dirty = true;
    const pool = this;
    return {
      id,
      get slot() {
        return s.slot;
      },
      get active() {
        return s.alive;
      },
      get intensity() {
        return s.intensity;
      },
      set intensity(v: number) {
        if ((v > 0) !== (s.intensity > 0)) pool.dirty = true;
        s.intensity = v;
      },
      stop: () => this.remove(s),
    };
  }

  /** Reserve `slot` (default 0) for this source until it stops or `unlock`. */
  lock(claim: LightClaim, slot = 0): Disposer {
    const s = this.sources.get(claim.id);
    const sl = this.slotList[slot];
    if (!s || !sl) return () => {};
    for (const other of this.slotList) if (other.locked === s) other.locked = null;
    sl.locked = s;
    this.dirty = true;
    return () => {
      if (sl.locked === s) this.unlock(slot);
    };
  }

  unlock(slot = 0) {
    const sl = this.slotList[slot];
    if (!sl?.locked) return;
    sl.locked = null;
    this.dirty = true;
  }

  /** The source a slot shows (its claim id), for tests and debug overlays. */
  shown(slot: number): number | null {
    return this.slotList[slot]?.shown?.id ?? null;
  }

  private where(s: Source) {
    return typeof s.at === "function" ? s.at() : s.at;
  }

  private remove(s: Source) {
    if (!s.alive) return;
    s.alive = false;
    s.slot = -1;
    s.pos.copyFrom(this.where(s));
    this.sources.delete(s.id);
    for (const sl of this.slotList) {
      if (sl.locked === s) sl.locked = null;
      if (sl.target === s) sl.target = null;
    }
    this.dirty = true;
  }

  private assign(eye: XYZ, forward: XYZ) {
    const slots = this.slotList;
    const locked = new Set<Source>();
    slots.forEach((sl, i) => {
      if (sl.locked && i < this.activeSlots) locked.add(sl.locked);
    });
    const usable = slots.map((sl, i) => i < this.activeSlots && !sl.locked);
    const cands: PoolCandidate[] = [];
    for (const s of this.sources.values()) {
      if (locked.has(s) || s.intensity <= 0) continue;
      s.pos.copyFrom(this.where(s));
      cands.push({ id: s.id, x: s.pos.x, y: s.pos.y, z: s.pos.z, priority: s.priority, reach: s.reach });
    }
    const lit = new Set<number>();
    for (const sl of slots) {
      if (sl.target) lit.add(sl.target.id);
      if (sl.shown) lit.add(sl.shown.id);
    }
    const n = usable.filter(Boolean).length;
    const chosen = pickSources(cands, eye, forward, n, lit, this.o);
    const placed = placeInSlots(
      chosen,
      slots.map((sl) => sl.target?.id ?? null),
      usable,
    );
    slots.forEach((sl, i) => {
      if (i >= this.activeSlots) sl.target = null;
      else if (sl.locked) sl.target = sl.locked.alive && sl.locked.intensity > 0 ? sl.locked : null;
      else sl.target = placed[i] === null ? null : (this.sources.get(placed[i]!) ?? null);
    });
    for (const s of this.sources.values()) s.slot = -1;
    slots.forEach((sl, i) => {
      if (sl.target) sl.target.slot = i;
    });
  }

  /** Advance fades and flicker; reassign every `interval` (or at once after a change). */
  update(dt: number, eye: XYZ, forward: XYZ) {
    if (this.disposed) return;
    this.t += dt;
    this.timer -= dt;
    if (this.dirty || this.timer <= 0) {
      this.timer = this.o.interval;
      this.dirty = false;
      this.assign(eye, forward);
    }
    const half = this.o.fade / 2;
    const step = half > 0 ? dt / half : 1;
    for (const sl of this.slotList) {
      if (sl.shown !== sl.target) {
        sl.w = sl.shown ? sl.w - step : 0;
        if (sl.w <= 0) {
          sl.w = 0;
          sl.shown = sl.target;
          if (sl.shown) {
            sl.light.diffuse.copyFrom(sl.shown.color);
            sl.light.range = sl.shown.range;
          }
        }
      } else if (sl.shown) sl.w = Math.min(1, sl.w + step);
      const s = sl.shown;
      if (!s || sl.w <= 0) {
        sl.light.intensity = 0;
        continue;
      }
      if (s.alive) s.pos.copyFrom(this.where(s));
      sl.light.position.copyFrom(s.pos);
      const k = sl.w * sl.w * (3 - 2 * sl.w);
      sl.light.intensity = Math.max(0, s.intensity * flickerAt(this.t, s.flicker, s.phase) * k);
    }
  }

  /** Stop every source (the lights stay, dark: the light set never changes). */
  clear() {
    for (const s of [...this.sources.values()]) this.remove(s);
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.clear();
    for (const l of this.lights) l.dispose();
  }
}
