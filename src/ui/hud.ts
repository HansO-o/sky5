import { settings } from "../core/settings";

// ------------------------------------------------------------------ pure rules (no DOM)
// When the vitals bars show, when the heartbeat plays, how the stealth eye reads, how long a tip
// stays and the once-only tip record. They live in this module (L1 boot-safe, engine-framework
// §1.2) so the HUD needs no import from the runtime layer; unit tests import them from here.

/** HUD timing and thresholds (design §3.7). */
export const HUD_RULES = {
  /** seconds the vitals stay after they were last full, unchanged and unarmed */
  vitalsLinger: 3,
  /** health fraction below which the heartbeat plays */
  lowHealth: 0.3,
  /** stealth meter value at which the eye starts to stir (the wolf's stir, a human's suspicion) */
  stir: 0.5,
} as const;

/** Gauges as fractions of their maxima (0..1). */
export interface VitalsView {
  hp: number;
  st: number;
}

/**
 * When the vitals bars show (design §3.7: "fades 3 s after full; shown when armed or changed"):
 * they show while a weapon is drawn, while a gauge is below full, and for `linger` seconds after
 * the last change. The first sample is not a change (full bars at a chapter start stay hidden).
 */
export class VitalsFade {
  private idle = Infinity;
  private last: VitalsView | null = null;
  private readonly linger: number;
  private readonly eps: number;

  constructor(o: { linger?: number; epsilon?: number } = {}) {
    this.linger = o.linger ?? HUD_RULES.vitalsLinger;
    this.eps = o.epsilon ?? 1e-3;
  }

  /** Advance by `dt` seconds with the gauges as they are now; returns whether the bars show. */
  update(dt: number, v: VitalsView, armed = false): boolean {
    const e = this.eps;
    const l = this.last;
    const changed = !!l && (Math.abs(v.hp - l.hp) > e || Math.abs(v.st - l.st) > e);
    const full = v.hp >= 1 - e && v.st >= 1 - e;
    this.last = { hp: v.hp, st: v.st };
    if (armed || changed || !full) this.idle = 0;
    else this.idle += Math.max(0, dt);
    return this.idle < this.linger;
  }

  /** Whether the bars show (as of the last update). */
  get visible() {
    return this.idle < this.linger;
  }

  /** Hidden, with no previous sample (a new chapter, the HUD cleared). */
  reset() {
    this.idle = Infinity;
    this.last = null;
  }
}

/** The heartbeat plays while alive and below `threshold` of full health. */
export function lowHealth(hpFrac: number, threshold: number = HUD_RULES.lowHealth) {
  return hpFrac > 0 && hpFrac < threshold;
}

export type StealthState = "calm" | "stir" | "alert";

/**
 * How the stealth eye reads a meter `k` (0 unseen … 1 detected): how far it opens (0..1) and its
 * state. `stir` is either the state itself (true/false) or the meter value at which stirring
 * starts (default 0.5). At 1 or more it is alert.
 */
export function stealthView(k: number, stir: boolean | number = HUD_RULES.stir): { open: number; state: StealthState } {
  const open = Math.max(0, Math.min(1, Number.isFinite(k) ? k : 0));
  const stirring = typeof stir === "boolean" ? stir : k >= stir;
  return { open, state: k >= 1 ? "alert" : stirring ? "stir" : "calm" };
}

/** Seconds a tip stays on screen: long enough to read (5–10 s). */
export function tipSeconds(text: string) {
  return Math.max(5, Math.min(10, 3 + text.length * 0.12));
}

/** Where tips already shown are recorded (the prologue keeps them in `flags.tips`). */
export interface TipStore {
  has(id: string): boolean;
  add(id: string): void;
}

/** A store that lasts as long as the page (when no story state keeps the record). */
export function memoryTips(): TipStore {
  const seen = new Set<string>();
  return { has: (id) => seen.has(id), add: (id) => void seen.add(id) };
}

/**
 * Once-only tips: `claim(id)` is true the first time an id is asked for (and records it), false
 * after that, also across saves when the store is the story state. The book also remembers what
 * it showed this session: a store rolled back to an older state (a fight retried after a death)
 * gets the id back instead of showing the tip again.
 */
export class TipBook {
  private session = new Set<string>();

  constructor(public store: TipStore = memoryTips()) {}

  claim(id: string): boolean {
    const shown = this.session.has(id);
    this.session.add(id);
    if (this.store.has(id)) return false;
    this.store.add(id);
    return !shown;
  }

  /** Forget this session's record (a new game: only the store counts). */
  forget() {
    this.session.clear();
  }
}

/** A change for the tip overlay: show this text, hide (null), or nothing to do (undefined). */
export type TipChange = string | null | undefined;

/**
 * The tips waiting to be read, timed on game time (`update(dt)`), so a tip that came up just before
 * the pause menu opened is still there, with its time left, when the game resumes (a once-only tip
 * must not run out unseen). Each tip stays `tipSeconds(text)`, then the line is empty for `gap`
 * seconds before the next.
 */
export class TipQueue {
  private queue: string[] = [];
  private phase: "idle" | "show" | "gap" = "idle";
  private t = 0;
  private readonly gap: number;
  private readonly seconds: (text: string) => number;

  constructor(o: { gap?: number; seconds?: (text: string) => number } = {}) {
    this.gap = o.gap ?? 0.7;
    this.seconds = o.seconds ?? tipSeconds;
  }

  /** Queue a tip; returns its text when it shows straight away (nothing else showing). */
  push(text: string): TipChange {
    this.queue.push(text);
    if (this.phase !== "idle") return undefined;
    this.phase = "show";
    this.t = 0;
    return text;
  }

  /** Advance by `dt` seconds of game time. */
  update(dt: number): TipChange {
    if (this.phase === "idle") return undefined;
    this.t += Math.max(0, dt);
    if (this.phase === "show") {
      if (this.t + 1e-9 < this.seconds(this.queue[0])) return undefined;
      this.phase = "gap";
      this.t = 0;
      return null;
    }
    if (this.t + 1e-9 < this.gap) return undefined;
    this.queue.shift();
    this.t = 0;
    if (!this.queue.length) {
      this.phase = "idle";
      return undefined;
    }
    this.phase = "show";
    return this.queue[0];
  }

  /** The tip on screen now, or null. */
  get current(): string | null {
    return this.phase === "show" ? this.queue[0] : null;
  }

  /** Tips queued or showing. */
  get size() {
    return this.queue.length;
  }

  /** Drop every tip (the HUD is cleared). */
  clear() {
    this.queue = [];
    this.phase = "idle";
    this.t = 0;
  }
}

// ------------------------------------------------------------------ DOM overlays

function el<K extends keyof HTMLElementTagNameMap>(tag: K, id: string): HTMLElementTagNameMap[K] {
  let e = document.getElementById(id) as HTMLElementTagNameMap[K] | null;
  if (!e) {
    e = document.createElement(tag);
    e.id = id;
    document.getElementById("ui")!.appendChild(e);
  }
  return e;
}

/** An overlay built from markup the first time it is asked for. */
function built(id: string, html: string) {
  const e = el("div", id);
  if (!e.firstChild) e.innerHTML = html;
  return e;
}

const clamp01 = (v: number) => Math.max(0, Math.min(1, Number.isFinite(v) ? v : 0));
/** A gauge's fill as a CSS variable (only written when it moved by a visible amount). */
function setFill(bar: Element | null, k: number) {
  const s = (bar as HTMLElement | null)?.style;
  if (!s) return;
  const v = clamp01(k).toFixed(3);
  if (s.getPropertyValue("--k") !== v) s.setProperty("--k", v);
}
const BAR = `<div class="hbar"><b></b><i></i></div>`;
/** an eye in brackets: the lids open with `--open`; the line below is the closed eye */
const EYE = `<svg viewBox="0 0 64 32" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M7 8H3v16h4M57 8h4v16h-4"/><path d="M12 16q20 11 40 0"/><g class="open"><path d="M12 16q20-13 40 0q-20 13-40 0z"/><circle cx="32" cy="16" r="4.5" fill="currentColor" stroke="none"/></g></svg>`;

/** what the gameplay overlays remember between calls */
const state = {
  vitals: new VitalsFade(),
  objective: null as string | null,
  /** seconds (game time) the new objective stays lit */
  objectiveNew: 0,
  tips: new TipBook(),
  tipQueue: new TipQueue(),
};
/** seconds a new objective stays lit */
const OBJECTIVE_NEW = 2.5;

/** Lightweight DOM overlays shared by all scenes. */
export const hud = {
  /** `force` shows the line even with subtitles off (lines without voice-over). */
  subtitle(who: string | null, text: string, force = false) {
    const s = el("div", "subtitle");
    if ((!settings.value.subtitles && !force) || !text) {
      s.style.opacity = "0";
      return;
    }
    s.innerHTML = "";
    if (who) {
      const w = document.createElement("span");
      w.className = "who";
      w.textContent = who + "：";
      s.appendChild(w);
    }
    s.appendChild(document.createTextNode(text));
    s.style.opacity = "1";
  },
  clearSubtitle() {
    el("div", "subtitle").style.opacity = "0";
  },
  /** Small corner indicator; never a full-screen loading screen. */
  loading(on: boolean, text = "加载中") {
    const h = el("div", "loadhint");
    if (!h.firstChild) h.innerHTML = "<i></i><span></span>";
    h.querySelector("span")!.textContent = text;
    h.classList.toggle("on", on);
  },
  fade(on: boolean, seconds = 1.2) {
    const f = el("div", "fade");
    f.style.transitionDuration = `${seconds}s`;
    f.classList.toggle("on", on);
    return new Promise<void>((r) => setTimeout(r, seconds * 1000));
  },
  /** Brief white-out (a shockwave, a blow to the head). */
  flash(strength = 0.8, seconds = 1.6) {
    const f = document.createElement("div");
    f.style.cssText = `position:fixed;inset:0;background:#fff;opacity:${strength};pointer-events:none;transition:opacity ${seconds}s ease-out;z-index:5`;
    document.getElementById("ui")!.appendChild(f);
    requestAnimationFrame(() => requestAnimationFrame(() => (f.style.opacity = "0")));
    setTimeout(() => f.remove(), seconds * 1000 + 100);
  },
  toast(text: string, ms = 4000) {
    const t = el("div", "toast");
    t.textContent = text;
    t.classList.add("on");
    clearTimeout((t as unknown as { _t: number })._t);
    (t as unknown as { _t: number })._t = window.setTimeout(() => t.classList.remove("on"), ms);
  },
  prompt(text: string | null) {
    const p = el("div", "prompt");
    p.textContent = text ?? "";
    p.classList.toggle("hidden", !text);
  },
  crosshair(on: boolean) {
    el("div", "crosshair").classList.toggle("hidden", !on);
  },
  downloadStatus(text: string) {
    el("div", "dlstatus").textContent = text;
  },

  // ------------------------------------------------------------------ gameplay (design §3.7)

  /**
   * The interaction prompt ("E 打开箱子"), in its own element just below the screen centre, so it
   * never clobbers `prompt`. A leading key token is drawn as a key cap. `progress` (0..1) shows a
   * hold under way. null hides it.
   */
  use(text: string | null, progress?: number) {
    const u = built("use", `<span class="txt"></span><span class="hold"><i></i></span>`);
    if (!text) {
      u.classList.remove("on", "holding");
      return;
    }
    if (u.dataset.text !== text) {
      u.dataset.text = text;
      const t = u.querySelector(".txt")!;
      t.textContent = "";
      const m = /^(\S{1,12})\s+(.+)$/.exec(text);
      // "E 打开箱子": the key as a cap (not a label that merely starts with a word)
      if (m && !/[\u3000-\u9fff\uff00-\uffef]/.test(m[1])) {
        const k = document.createElement("kbd");
        k.textContent = m[1];
        t.append(k, document.createTextNode(" " + m[2]));
      } else t.textContent = text;
    }
    u.classList.toggle("holding", progress !== undefined);
    if (progress !== undefined) (u.querySelector(".hold i") as HTMLElement).style.width = `${(clamp01(progress) * 100).toFixed(1)}%`;
    u.classList.add("on");
  },

  /**
   * Health and stamina bars (fractions 0..1), bottom centre and right. Call it every frame with the
   * frame's game time `dt`: the bars show while `armed`, while a gauge is below full and for 3 s
   * after the last change, then fade (`show` overrides that). Below 30 % health the screen edge
   * pulses (the heartbeat). null hides the bars and stops the heartbeat.
   */
  vitals(v: VitalsView | null, o: { armed?: boolean; dt?: number; show?: boolean } = {}) {
    const box = built("vitals", BAR.replace("hbar", "hbar hp") + BAR.replace("hbar", "hbar st"));
    const vig = vignette();
    if (!v) {
      state.vitals.reset();
      box.classList.remove("on", "low");
      vig.classList.remove("low");
      return;
    }
    const shown = state.vitals.update(o.dt ?? 0, v, !!o.armed);
    const on = o.show ?? shown;
    setFill(box.querySelector(".hp"), v.hp);
    setFill(box.querySelector(".st"), v.st);
    const low = lowHealth(v.hp);
    box.classList.toggle("on", on || low);
    box.classList.toggle("low", low);
    vig.classList.toggle("low", low);
  },

  /** The health of what the player is fighting (top centre, under the boss bar); null hides it. */
  target(name: string | null, frac = 1) {
    const t = built("target", `<span class="name"></span>${BAR}`);
    if (!name) return void t.classList.remove("on");
    const n = t.querySelector(".name")!;
    if (n.textContent !== name) n.textContent = name;
    setFill(t.querySelector(".hbar"), frac);
    t.classList.add("on");
  },

  /** A boss's name and health (top centre, wide: 洞穴巨蛛, 巨狼); null hides it. */
  boss(name: string | null, frac = 1) {
    const b = built("boss", `<span class="name"></span>${BAR}`);
    if (!name) return void b.classList.remove("on");
    const n = b.querySelector(".name")!;
    if (n.textContent !== name) n.textContent = name;
    setFill(b.querySelector(".hbar"), frac);
    b.classList.add("on");
  },

  /**
   * The current objective, a persistent line in the top-right corner (null clears it). A new text
   * lights up for a moment (game time, see `tick`); `toast` also announces it the usual way (top
   * left). The prologue's chapters set it through `stage.objective(...)`, which the stage re-applies
   * when a loaded game begins (`reset()` runs as the replaced stage goes, after the new one has
   * prepared its chapter).
   */
  objective(text: string | null, o: { toast?: boolean | number } = {}) {
    const ob = built("objective", `<span></span>`);
    if (o.toast && text) hud.toast(text, typeof o.toast === "number" ? o.toast : 5000);
    if (text === state.objective) return;
    state.objective = text;
    state.objectiveNew = 0;
    if (!text) return void ob.classList.remove("on", "new");
    ob.firstElementChild!.textContent = text;
    ob.classList.add("on", "new");
    state.objectiveNew = OBJECTIVE_NEW;
  },

  /** The objective on the line now (null: none). */
  get currentObjective(): string | null {
    return state.objective;
  },

  /**
   * A one-time tutorial tip (left edge, a few seconds): shown the first time `id` is asked for and
   * never again, also across saves once the stage keeps the record (`setTipStore`). Tips asked for
   * while one shows wait their turn. Returns whether it will show.
   */
  tip(id: string, text: string) {
    if (!state.tips.claim(id)) return false;
    showTip(state.tipQueue.push(text));
    return true;
  },

  /**
   * Advance the HUD's timers by `dt` seconds of game time (the stage calls it every frame it runs,
   * so nothing times out under the pause menu): tips and the new objective's highlight.
   */
  tick(dt: number) {
    showTip(state.tipQueue.update(dt));
    if (state.objectiveNew > 0) {
      state.objectiveNew -= Math.max(0, dt);
      if (state.objectiveNew <= 0) document.getElementById("objective")?.classList.remove("new");
    }
  },

  /**
   * Where `tip` records what was shown (the prologue: `flags.tips`); null: this page only. A new
   * store starts a new record (a new game or a loaded save shows what its own record hasn't).
   */
  setTipStore(store: TipStore | null) {
    state.tips.store = store ?? memoryTips();
    state.tips.forget();
  },

  /**
   * The stealth eye above the crosshair: `k` 0..1 how close something is to noticing the player
   * (the eye opens with it), `stir` the stirring state or the value it starts at (default 0.5); at
   * 1 it is alert. null hides it.
   */
  stealth(k: number | null, stir?: boolean | number) {
    const s = built("stealth", EYE);
    if (k === null) return void s.classList.remove("on", "stir", "alert");
    const v = stealthView(k, stir);
    s.style.setProperty("--open", v.open.toFixed(2));
    s.classList.toggle("stir", v.state === "stir");
    s.classList.toggle("alert", v.state === "alert");
    s.classList.add("on");
  },

  /** The player was hurt: a red flash at the screen edges (`strength` 0..1). */
  damage(strength = 1) {
    const hit = vignette().querySelector<HTMLElement>(".hit")!;
    const a = Math.max(0.15, Math.min(1, strength));
    if (typeof hit.animate === "function") hit.animate([{ opacity: a }, { opacity: 0 }], { duration: 650 + a * 350, easing: "ease-out" });
  },

  /** The death screen: 你倒下了…… over a red-black edge, above the fade (false hides it). */
  death(on = true, text = "你倒下了……") {
    const d = built("death", `<span></span>`);
    if (on && !d.classList.contains("on")) {
      d.firstElementChild!.textContent = text;
      // above the fade to black (made earlier) and anything else on the HUD; the moved element's
      // style is settled before it turns on, so it fades in
      const ui = document.getElementById("ui")!;
      if (ui.lastElementChild !== d) {
        ui.appendChild(d);
        void d.offsetWidth;
      }
    }
    d.classList.toggle("on", on);
  },

  /**
   * Clear every gameplay overlay: subtitle, prompts, vitals, bars, objective, tips, stealth eye,
   * vignette, death screen (a stage ends, the game returns to the menu). Loading, fade and toasts
   * are left alone. A stage replaced by a loaded game calls this after the new stage has prepared
   * its chapter: HUD state wanted from the first frame is set in `run()` or re-applied when the
   * stage begins (the prologue's `stage.objective`), not left from `prepare()`.
   */
  reset() {
    hud.clearSubtitle();
    hud.prompt(null);
    state.vitals.reset();
    state.objective = null;
    state.objectiveNew = 0;
    state.tipQueue.clear();
    // (only overlays that were ever shown exist)
    for (const id of ["use", "vitals", "target", "boss", "objective", "tip", "stealth", "vignette", "death"])
      document.getElementById(id)?.classList.remove("on", "low", "new", "holding", "stir", "alert");
  },
};

/** The red screen edge: `.hit` flashes on damage, `.beat` pulses (the heartbeat) while `.low`. */
function vignette() {
  return built("vignette", `<i class="hit"></i><i class="beat"></i>`);
}

/** Apply a tip change: show a text, hide the tip (null), or leave it (undefined). */
function showTip(change: TipChange) {
  if (change === undefined) return;
  const t = built("tip", `<p></p>`);
  if (change === null) return void t.classList.remove("on");
  t.firstElementChild!.textContent = change;
  t.classList.add("on");
}
