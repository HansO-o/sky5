import type { Combatant } from "../../engine/combat/CombatSystem";
import { Emitter } from "../../engine/core/emitter";
import type { World } from "../World";
import type { CaveWorld } from "./cave";
import type { CaveSpider } from "./creatures";
import { AmbushSchedule, ambushDue, type AmbushCue } from "./rules";

/** The ambush's three spiders as the encounter holds them now (fresh ones after a retry). */
export interface AmbushCast {
  n: CaveSpider | null;
  s: CaveSpider | null;
  giant: CaveSpider | null;
}

/**
 * The spider chamber's ambush (design §6.1 "X1 ambush timeline", §12) on the world: it watches
 * for its trigger (the player within 6 m of `spider_c`, or 8 s after web A fell), then runs
 * `AmbushSchedule`: the small spiders come out of `burrow_n` (1.0 s) and `burrow_s` (4.0 s), the
 * giant drops down the chimney (phase B: both small ones dead, or 20 s), and web B gives way
 * after 120 s if nobody cut it. `cues` carries every cue to the chapter, which says the lines and
 * starts the music (skitter at 0, the bark at 0.6, the music at 4, phaseB). `reset()` for a retry
 * (the encounter's `onRetry`), then it waits for its trigger again.
 */
export class SpiderAmbush {
  readonly cues = new Emitter<AmbushCue>();
  readonly schedule = new AmbushSchedule();
  /** game seconds since web A fell (null: standing) */
  private sinceWebA: number | null = null;
  private armed = false;
  /** the chamber's centre and the chimney's mouth */
  private centre: { x: number; z: number };
  private mouth: { x: number; y: number; z: number };
  private offs: (() => unknown)[] = [];
  private disposed = false;

  constructor(
    private o: {
      world: World;
      cave: CaveWorld;
      /** the encounter's spiders now */
      cast: () => AmbushCast;
      /** the player's feet (null: no check) */
      player: () => { x: number; y: number; z: number } | null;
      /** whom they go for (default: the player's combatant as each spider picks) */
      target?: () => Combatant | null;
    },
  ) {
    this.centre = o.cave.anchor("spider_c").pos;
    this.mouth = o.cave.anchor("chimney_mouth").pos;
    const webA = o.cave.webs.A;
    if (webA?.cut) this.sinceWebA = 0;
    if (webA) this.offs.push(webA.events.on((e) => e.type === "cut" && this.sinceWebA === null && (this.sinceWebA = 0)));
    this.offs.push(o.world.onUpdate((dt) => this.update(dt)));
  }

  /** Watch for the trigger from now on (the encounter is armed). */
  arm() {
    this.armed = true;
  }

  /** Started (the trigger fired). */
  get started() {
    return this.schedule.started;
  }

  /** Trigger it now (a script, a resume into the fight). */
  start() {
    if (this.disposed || this.schedule.started) return;
    this.armed = true;
    this.run(this.schedule.start());
  }

  /** Back to waiting for the trigger (a retry: the encounter respawned the spiders hidden). */
  reset() {
    this.schedule.reset();
  }

  private update(dt: number) {
    if (this.disposed) return;
    if (this.sinceWebA !== null) this.sinceWebA += dt;
    if (!this.armed) return;
    if (!this.schedule.started) {
      const p = this.o.player();
      if (!p) return;
      const c = this.centre;
      if (ambushDue({ distToCentre: Math.hypot(p.x - c.x, p.z - c.z), sinceWebA: this.sinceWebA })) this.start();
      return;
    }
    const cast = this.o.cast();
    const smallAlive = [cast.n, cast.s].filter((sp) => sp && !sp.hidden && !sp.dead).length;
    this.run(this.schedule.update(dt, { smallAlive, webBCut: !!this.o.cave.webs.B?.cut }));
  }

  private run(cues: AmbushCue[]) {
    const cast = this.o.cast();
    const target = this.o.target?.() ?? null;
    for (const c of cues) {
      if (c === "smallN") cast.n?.emerge(target);
      else if (c === "smallS") cast.s?.emerge(target);
      else if (c === "phaseB" && cast.giant) void cast.giant.drop(this.mouth, { target });
      else if (c === "webB") this.o.cave.webs.B?.cutNow("script");
      this.cues.emit(c);
    }
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    for (const o of this.offs) o();
    this.offs = [];
    this.cues.clear();
  }
}
