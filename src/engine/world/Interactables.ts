import { Emitter } from "../core/emitter";
import type { Disposer } from "../core/types";

type XYZ = { readonly x: number; readonly y: number; readonly z: number };

/** Defaults (design §3.7): 2.0 m, 35° of the view, a 1.5 s hold. */
export const INTERACT = {
  radius: 2.0,
  /** half-angle of the view cone, degrees */
  cone: 35,
  /** largest height difference between the player's feet and the target (m): not through floors */
  height: 2.2,
  /** seconds a hold-to-use target needs the button held */
  hold: 1.5,
  /** closer than this (m, horizontal) the view angle no longer matters (standing over it) */
  near: 0.5,
  /** a new target must be this much better (score, ~metres) to replace the current one */
  stick: 0.25,
} as const;

/** What a candidate needs for picking (an {@link InteractableDef} resolved for this frame). */
export interface InteractCandidate {
  pos: XYZ;
  /** metres (horizontal) */
  radius: number;
  /** half-angle, degrees */
  cone: number;
  /** metres */
  height: number;
}

/** The player's feet and view direction (forward = (−sin yaw, −cos yaw), the camera's yaw). */
export interface InteractView {
  pos: XYZ;
  yaw: number;
}

/**
 * How good a target `c` is from `view` (lower is better), or null when it can't be used from
 * there: farther than its radius (horizontally), more than its height above or below the feet, or
 * outside its view cone. The score is the distance plus up to 0.5 for the angle off the view, so
 * the nearest target wins and the one looked at wins a near tie.
 */
export function interactScore(c: InteractCandidate, view: InteractView): number | null {
  const dx = c.pos.x - view.pos.x;
  const dz = c.pos.z - view.pos.z;
  const d = Math.hypot(dx, dz);
  if (d > c.radius || Math.abs(c.pos.y - view.pos.y) > c.height) return null;
  if (d <= INTERACT.near) return d;
  const fx = -Math.sin(view.yaw);
  const fz = -Math.cos(view.yaw);
  const cos = Math.max(-1, Math.min(1, (dx * fx + dz * fz) / d));
  const ang = (Math.acos(cos) * 180) / Math.PI;
  if (ang > c.cone) return null;
  return d + 0.5 * (ang / Math.max(1e-6, c.cone));
}

/**
 * The index of the candidate to use from `view` (see {@link interactScore}), or -1. `current` (an
 * index) is kept unless another is better by more than `stick`, so the prompt doesn't flicker
 * between two targets at about the same distance.
 */
export function pickInteractable(cands: readonly InteractCandidate[], view: InteractView, current = -1, stick: number = INTERACT.stick): number {
  let best = -1;
  let bestScore = Infinity;
  let curScore: number | null = null;
  cands.forEach((c, i) => {
    const s = interactScore(c, view);
    if (s === null) return;
    if (i === current) curScore = s;
    if (s < bestScore) {
      best = i;
      bestScore = s;
    }
  });
  if (curScore !== null && curScore <= bestScore + stick) return current;
  return best;
}

export interface InteractableDef {
  /** unique within its `Interactables` (adding the same id replaces the old one) */
  id: string;
  /** where it is; a function for something that moves (an NPC's feet) */
  pos: XYZ | (() => XYZ);
  /** what using it does, shown after the key ("Open chest" → "E Open chest") */
  label: string | (() => string);
  /** metres from the player, horizontally (default 2.0) */
  radius?: number;
  /** half-angle of the view cone, degrees (default 35) */
  cone?: number;
  /** largest height difference to the player's feet (default 2.2 m) */
  height?: number;
  /** usable now (default true); a function is read every frame */
  enabled?: boolean | (() => boolean);
  /** hold the button instead of pressing it: true for the default 1.5 s, or seconds */
  hold?: boolean | number;
  /** the player's body clip while holding (default: the `holdClip` option; null: none) */
  clip?: string | null;
  /** removed once used (default true); otherwise it can't be used again until `use` settles */
  once?: boolean;
  /** checked with the host's line of sight (default true; false for something inside its own collider) */
  sight?: boolean;
  /** what happens; a returned promise keeps it busy until it settles */
  use(): unknown;
}

/** A registered interactable. */
export interface Interactable {
  readonly id: string;
  readonly def: InteractableDef;
  /** overrides `def.enabled` while set (null: back to the definition) */
  enabled: boolean | null;
  /** replaces the label */
  label: string | (() => string);
  /** still registered */
  readonly live: boolean;
  remove(): void;
}

/** What the interactables drive. Everything is injected: this module imports no platform singleton. */
export interface InteractHost {
  /** the player's feet and view yaw; null: nobody can interact now (no player, a cutscene) */
  view(): InteractView | null;
  /** the use button went down this frame */
  pressed(): boolean;
  /** the use button is down */
  held(): boolean;
  /** nothing may be used now (a scripted line is being spoken, the player is busy) */
  blocked?(): boolean;
  /** the prompt (null hides it); `progress` 0..1 while a hold is under way */
  show(text: string | null, progress?: number): void;
  /** start the hold's body clip (a name) or end it (null) */
  hold?(clip: string | null): void;
  /** the label of the use button ("E"; the pad's "A") */
  key?(): string;
  /** the player can see the target (e.g. a static ray: not through bars or walls) */
  sight?(from: InteractView, to: XYZ): boolean;
}

export interface InteractablesOptions {
  radius?: number;
  cone?: number;
  height?: number;
  /** seconds for `hold: true` (default 1.5) */
  holdSeconds?: number;
  /** the body clip for a hold when the target names none (the prologue: "Fixing_Kneeling") */
  holdClip?: string | null;
  /** a frame bus to run `update` on (the world's onUpdate); dispose() unregisters */
  bus?: { onUpdate(fn: (dt: number) => void): () => unknown };
}

interface Item extends Interactable {
  busy: boolean;
  live: boolean;
}

const read = <T>(v: T | (() => T)): T => (typeof v === "function" ? (v as () => T)() : v);

/**
 * Things the player uses with the activate button (design §3.7): each frame the nearest usable
 * target within its radius and view cone is picked and prompted ("E Open chest"); a press uses it.
 * Hold targets need the button held (1.5 s, with a body clip such as kneeling); letting go,
 * walking off, a block starting or the target being disabled cancels the hold; a hold needs a
 * fresh press (a button still down from an earlier use doesn't start one). Nothing can be used
 * while `blocked` (a line of dialogue is being spoken), and the prompt is hidden then.
 */
export class Interactables {
  /** a target was used (before its `use()` runs) */
  readonly onUse = new Emitter<Interactable>();
  private items = new Map<string, Item>();
  private cur: Item | null = null;
  private holding: { item: Item; t: number; seconds: number; clip: string | null } | null = null;
  private shown: { text: string | null; progress: number | undefined } = { text: null, progress: undefined };
  private off: (() => unknown) | null = null;
  private disposed = false;

  constructor(
    private host: InteractHost,
    private o: InteractablesOptions = {},
  ) {
    if (o.bus) this.off = o.bus.onUpdate((dt) => this.update(dt));
  }

  /** Register a target (an existing one with the same id is replaced). */
  add(def: InteractableDef): Interactable {
    this.items.get(def.id)?.remove();
    const item: Item = {
      id: def.id,
      def,
      enabled: null,
      label: def.label,
      live: true,
      busy: false,
      remove: () => {
        if (!item.live) return;
        item.live = false;
        if (this.items.get(def.id) === item) this.items.delete(def.id);
        if (this.holding?.item === item) this.stopHold();
        if (this.cur === item) this.cur = null;
      },
    };
    this.items.set(def.id, item);
    return item;
  }

  /** Remove a target by id. */
  remove(id: string) {
    this.items.get(id)?.remove();
  }

  get(id: string): Interactable | null {
    return this.items.get(id) ?? null;
  }

  /** The target prompted now (null: none). */
  get current(): Interactable | null {
    return this.cur;
  }

  /** A hold is under way (its fraction done), or null. */
  get holdProgress(): number | null {
    const h = this.holding;
    return h ? Math.min(1, h.t / h.seconds) : null;
  }

  /** Use a target now as if the player had (a fallback, a test): false when it isn't registered or is busy. */
  use(id: string): boolean {
    const item = this.items.get(id);
    if (!item || item.busy) return false;
    if (this.holding?.item === item) this.stopHold();
    this.fire(item);
    return true;
  }

  /** Remove every target and hide the prompt. */
  clear() {
    for (const it of [...this.items.values()]) it.remove();
    this.cur = null;
    this.prompt(null);
  }

  /** Per frame (game time): pick, prompt, and use on a press (or a completed hold). */
  update(dt: number) {
    if (this.disposed) return;
    const h = this.host;
    const view = h.view();
    const blocked = !view || !!h.blocked?.();
    const hold = this.holding;
    if (hold) {
      const it = hold.item;
      if (blocked || !h.held() || !this.usable(it) || !this.inReach(it, view!, 1.25)) {
        this.stopHold();
      } else {
        hold.t += dt;
        if (hold.t + 1e-9 >= hold.seconds) {
          this.stopHold();
          this.fire(it);
        } else {
          this.prompt(this.text(it), hold.t / hold.seconds);
          return;
        }
      }
    }
    if (blocked) {
      this.cur = null;
      this.prompt(null);
      return;
    }
    const list = [...this.items.values()].filter((it) => this.usable(it));
    const cands = list.map((it) => this.candidate(it));
    let pick: Item | null = null;
    // the best one in sight (a target behind bars or a wall gives way to the next best)
    while (list.length) {
      const i = pickInteractable(cands, view, this.cur ? list.indexOf(this.cur) : -1);
      if (i < 0) break;
      const it = list[i];
      if (!h.sight || it.def.sight === false || h.sight(view, cands[i].pos)) {
        pick = it;
        break;
      }
      list.splice(i, 1);
      cands.splice(i, 1);
    }
    this.cur = pick;
    if (!pick) {
      this.prompt(null);
      return;
    }
    if (h.pressed()) {
      const secs = this.holdSeconds(pick);
      if (secs > 0) {
        const clip = pick.def.clip === undefined ? (this.o.holdClip ?? null) : pick.def.clip;
        this.holding = { item: pick, t: 0, seconds: secs, clip };
        if (clip) h.hold?.(clip);
        this.prompt(this.text(pick), 0);
        return;
      }
      this.fire(pick);
      return;
    }
    this.prompt(this.text(pick));
  }

  /** Remove everything, end a hold, hide the prompt and stop updating. */
  dispose() {
    if (this.disposed) return;
    this.clear();
    this.stopHold();
    this.prompt(null);
    this.disposed = true;
    this.off?.();
    this.off = null;
    this.onUse.clear();
  }

  // ------------------------------------------------------------------ internals

  private usable(it: Item) {
    if (!it.live || it.busy) return false;
    if (it.enabled !== null) return it.enabled;
    return it.def.enabled === undefined ? true : !!read(it.def.enabled);
  }

  private candidate(it: Item): InteractCandidate {
    const d = it.def;
    const o = this.o;
    return {
      pos: read(d.pos),
      radius: d.radius ?? o.radius ?? INTERACT.radius,
      cone: d.cone ?? o.cone ?? INTERACT.cone,
      height: d.height ?? o.height ?? INTERACT.height,
    };
  }

  /** Still within reach of a hold under way (`slack`× the radius; the view no longer matters). */
  private inReach(it: Item, view: InteractView, slack: number) {
    const c = this.candidate(it);
    return interactScore({ ...c, radius: c.radius * slack, cone: 180 }, view) !== null;
  }

  private holdSeconds(it: Item) {
    const hold = it.def.hold;
    if (!hold) return 0;
    return hold === true ? (this.o.holdSeconds ?? INTERACT.hold) : Math.max(0, hold);
  }

  private text(it: Item) {
    const key = this.host.key?.() ?? "E";
    return `${key} ${read(it.label)}`;
  }

  private prompt(text: string | null, progress?: number) {
    const s = this.shown;
    if (s.text === text && s.progress === progress) return;
    s.text = text;
    s.progress = progress;
    this.host.show(text, progress);
  }

  private stopHold() {
    const h = this.holding;
    if (!h) return;
    this.holding = null;
    if (h.clip) this.host.hold?.(null);
  }

  private fire(it: Item) {
    if (!it.live) return;
    const once = it.def.once ?? true;
    if (once) it.remove();
    else it.busy = true;
    if (this.cur === it) this.cur = null;
    this.prompt(null);
    this.onUse.emit(it);
    let r: unknown;
    try {
      r = it.def.use();
    } catch (e) {
      console.error(`interactable ${it.id}`, e);
    }
    if (once) return;
    if (r && typeof (r as PromiseLike<unknown>).then === "function") {
      (r as PromiseLike<unknown>).then(
        () => void (it.busy = false),
        (e) => {
          // a cancelled script (a skipped chapter) is not an error worth reporting
          if (!(e instanceof Error && e.message === "cancelled")) console.error(`interactable ${it.id}`, e);
          it.busy = false;
        },
      );
    } else it.busy = false;
  }
}

/** Register several targets at once; the disposer removes them all. */
export function addAll(set: Interactables, defs: readonly InteractableDef[]): Disposer {
  const items = defs.map((d) => set.add(d));
  return () => items.forEach((i) => i.remove());
}
