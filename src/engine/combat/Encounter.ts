import { Emitter } from "../core/emitter";
import type { TimeScale } from "../core/timeScale";
import { inAabb, type Aabb } from "../world/zones";
import { ADAPTIVE } from "./attacks";
import type { Combatant, CombatSystem } from "./CombatSystem";
import type { VitalsState } from "./vitals";

/** A place (and facing) to put an actor back at on a retry. */
export interface Mark {
  x: number;
  y: number;
  z: number;
  yaw?: number;
}

/** The difficulty an encounter runs at (from how often the player died in it). */
export interface Difficulty {
  /** 0 normal, 1 after 2 deaths, 2 after 3 */
  tier: 0 | 1 | 2;
  /** multiplier on enemy damage */
  enemyDamage: number;
  /** enemy wind-up rate (null: the attacks' own) */
  windupRate: number | null;
  /** multiplier on enemy HP */
  enemyHp: number;
  /** multiplier on the companion's damage */
  companionDamage: number;
}

/**
 * Adaptive difficulty (§3.5): from 2 deaths enemies deal ×0.75 and wind up at 0.5×; from 3 they
 * also have ×0.85 HP and the companion deals ×1.5.
 */
export function difficultyFor(deaths: number): Difficulty {
  const d: Difficulty = { tier: 0, enemyDamage: 1, windupRate: null, enemyHp: 1, companionDamage: 1 };
  const [t1, t2] = ADAPTIVE;
  if (deaths >= t1.deaths) {
    d.tier = 1;
    d.enemyDamage = t1.enemyDamage;
    d.windupRate = t1.windupRate;
  }
  if (deaths >= t2.deaths) {
    d.tier = 2;
    d.enemyHp = t2.enemyHp;
    d.companionDamage = t2.companionDamage;
  }
  return d;
}

/** One enemy as an encounter owns it. */
export interface EncounterActor {
  /** registered with the combat system by whoever made it */
  readonly combatant: Combatant;
  /** gave up in some way the combatant doesn't know (counts as defeated) */
  readonly surrendered?: boolean;
  /** remove it (body, brain, mover); the encounter unregisters the combatant first */
  dispose(): void;
}

export interface EncounterSpawn<A extends EncounterActor = EncounterActor> {
  id: string;
  /**
   * a fresh actor, every spawn and respawn (the difficulty is already decided). Spawns never
   * overlap: a retry's waits until the previous batch has landed and been removed, so the same
   * combatant id can be registered on every attempt.
   */
  make(o: { attempt: number; difficulty: Difficulty }): A | Promise<A>;
}

export interface EncounterSpec<A extends EncounterActor = EncounterActor> {
  /** the key of `flags.deaths` */
  id: string;
  /** the fight's area (the union of these boxes) */
  arena: readonly Aabb[];
  spawns: readonly EncounterSpawn<A>[];
  /** music started with the fight (an audio id; null stops the music) */
  music?: string | null;
  /** music once it is won (default null: stop) */
  musicAfter?: string | null;
  /**
   * Where a retry puts the actors. The player's vitals go back to the encounter-start snapshot
   * (§3.5); `minHp` opts into a floor: at least this fraction of max HP even when the fight began
   * lower (default 0: exactly the snapshot; `DEATH.retryMinHp` is the suggested floor for a fight
   * that may begin with the player nearly dead and out of potions).
   */
  retry: { player: Mark; companion?: Mark; minHp?: number };
  /** after the first spawn */
  onStart?(e: Encounter<A>): void | Promise<void>;
  /** every enemy dead or surrendered */
  onClear?(e: Encounter<A>): void;
  /** after a retry's respawn (re-arm tutorials, re-place props) */
  onRetry?(e: Encounter<A>): void | Promise<void>;
}

/** The fighter whose state a retry restores (the player, the companion). */
export interface EncounterParticipant {
  combatant?: Combatant | null;
  teleport(m: Mark): void;
  /** back to ready (the player's combat controller, the companion's brain) */
  reset?(): void;
}

/** Everything an encounter drives (injected: this module imports no platform singleton). */
export interface EncounterHost {
  combat: CombatSystem;
  player: EncounterParticipant;
  companion?: EncounterParticipant | null;
  /** death slow motion (0.35× for 1 s of real time) */
  time?: TimeScale | null;
  /** the screen to black (true) or back; resolves when done */
  fade?(on: boolean, seconds: number): Promise<void>;
  /** wait this many seconds of game time (default: wall-clock time) */
  sleep?(seconds: number): Promise<void>;
  /** deaths per encounter id (the flags) */
  deaths: { get(id: string): number; set(id: string, n: number): void };
  /** make the story state as it is now the checkpoint (stage.snapshotFlags) */
  snapshot?(): void;
  /** back to that checkpoint (stage.restoreFlags: the potions come back) */
  restore?(): void | Promise<void>;
  music?(id: string | null): void;
}

export type EncounterState = "idle" | "active" | "resetting" | "cleared" | "disposed";

export type EncounterEvent =
  /** `start()` was called (the enemies are still being made): from now on a death retries this fight */
  | { type: "begin" }
  /** the enemies are in, the music is on */
  | { type: "start" }
  | { type: "death"; deaths: number }
  | { type: "retry"; attempt: number }
  | { type: "clear" };

/**
 * Death sequence timing (§3.5). `retryMinHp`: a floor on the HP (fraction of max) a retry gives the
 * player back, for chapters that opt in with `retry.minHp` (a fight begun nearly dead with no
 * potions stays winnable); by default a retry restores exactly the start snapshot.
 */
export const DEATH = { slow: 0.35, slowSeconds: 1, fade: 1.5, retryMinHp: 0.6 } as const;

/**
 * One fight (§3.5): spawns its enemies, knows when they are all defeated (surrender counts), and
 * when the player dies runs the retry — slow motion, fade out, the story state and the player's
 * vitals put back to how they were when it started, the death counted, the enemies made afresh at
 * the adapted difficulty, both actors back on their retry marks, fade in. The chapter is never
 * re-prepared.
 */
export class Encounter<A extends EncounterActor = EncounterActor> {
  readonly events = new Emitter<EncounterEvent>();
  private st: EncounterState = "idle";
  private list: { id: string; actor: A }[] = [];
  private startState: { player: VitalsState | null; companion: VitalsState | null } | null = null;
  private attempt = 0;
  /** enemies are being made: not won yet, whatever the (empty) list says */
  private spawning = 0;
  /** the latest spawn (an older one still loading is dropped when it lands) */
  private spawnGen = 0;
  /** the spawn in progress (the next one waits for it) */
  private spawnBusy: Promise<void> = Promise.resolve();
  /** the death slow motion in force */
  private slowHold: (() => void) | null = null;
  /** the screen was faded out by the death sequence (a dispose fades it back) */
  private faded = false;

  constructor(
    readonly spec: EncounterSpec<A>,
    private host: EncounterHost,
  ) {}

  get id() {
    return this.spec.id;
  }

  get state() {
    return this.st;
  }

  /** The enemies now (fresh objects after every retry). */
  get actors(): readonly A[] {
    return this.list.map((e) => e.actor);
  }

  /** The enemy spawned as `id`. */
  actor(id: string): A | undefined {
    return this.list.find((e) => e.id === id)?.actor;
  }

  /** Player deaths in this encounter so far. */
  get deaths() {
    return this.host.deaths.get(this.spec.id);
  }

  get difficulty() {
    return difficultyFor(this.deaths);
  }

  /** Every enemy is dead or has surrendered. */
  get allDefeated() {
    return this.list.every((e) => e.actor.combatant.defeated || !!e.actor.surrendered);
  }

  /** Whether `p` is inside the arena. */
  contains(p: { x: number; y: number; z: number }, margin = 0) {
    return this.spec.arena.some((b) => inAabb(b, p, margin));
  }

  /**
   * Begin: the story state becomes the checkpoint a retry goes back to, the player's vitals are
   * noted, the enemies spawn, the music starts.
   */
  async start() {
    if (this.st !== "idle") return;
    this.st = "active";
    const h = this.host;
    h.snapshot?.();
    const comp = h.companion?.combatant ?? null;
    this.startState = {
      player: h.player.combatant?.vitals.snapshot() ?? null,
      companion: comp?.vitals.snapshot() ?? null,
    };
    this.applyCompanion();
    this.events.emit({ type: "begin" });
    await this.spawn();
    if (this.disposedNow()) return;
    if (this.spec.music !== undefined) h.music?.(this.spec.music);
    this.events.emit({ type: "start" });
    await this.spec.onStart?.(this);
  }

  /**
   * Make the enemies (again): the old ones go first. A spawn still loading (the player died before
   * the first batch landed) is waited for and its batch dropped before this one makes anything, so
   * two batches never hold the same combatant ids at once.
   */
  async spawn() {
    const gen = ++this.spawnGen;
    this.spawning++;
    const before = this.spawnBusy;
    let done!: () => void;
    this.spawnBusy = new Promise<void>((r) => (done = r));
    let made: { id: string; actor: A }[] = [];
    try {
      await before;
      // disposed meanwhile, or a newer spawn already replaces this one: make nothing
      if (this.disposedNow() || gen !== this.spawnGen) return;
      this.despawn();
      const difficulty = this.difficulty;
      const attempt = this.attempt;
      // an enemy that fails to appear (a model that didn't load) is left out: the fight stays winnable
      const settled = await Promise.allSettled(this.spec.spawns.map(async (s) => ({ id: s.id, actor: await s.make({ attempt, difficulty }) })));
      for (const [i, r] of settled.entries()) {
        if (r.status === "fulfilled") made.push(r.value);
        else console.error(`encounter ${this.spec.id}: spawn ${this.spec.spawns[i].id} failed`, r.reason);
      }
      // disposed meanwhile, or a newer spawn (a retry while this one loaded) replaces it
      if (this.disposedNow() || gen !== this.spawnGen) {
        for (const m of made) this.drop(m.actor);
        made = [];
        return;
      }
      this.despawn();
      this.list = made;
      for (const m of made) this.applyDifficulty(m.actor.combatant, difficulty);
    } finally {
      this.spawning--;
      done();
    }
  }

  /** Remove every enemy. */
  despawn() {
    for (const e of this.list) this.drop(e.actor);
    this.list = [];
  }

  private drop(a: A) {
    this.host.combat.remove(a.combatant);
    try {
      a.dispose();
    } catch (e) {
      console.error("encounter despawn", e);
    }
  }

  /**
   * The difficulty goes on the encounter's own fields (`difficultyMul`, `difficultyWindup`), so the
   * content's `damageMul` / `windupRate` (a tutorial's) are left alone.
   */
  private applyDifficulty(c: Combatant, d: Difficulty) {
    c.difficultyMul = d.enemyDamage;
    c.difficultyWindup = d.windupRate;
    // a fresh actor: its HP is the base the difficulty scales
    if (d.enemyHp !== 1) c.vitals.setMaxHp(c.vitals.maxHp * d.enemyHp, { fill: true });
  }

  /** The companion's damage at this difficulty (its own `damageMul` is the chapter's). */
  private applyCompanion(on = true) {
    const comp = this.host.companion?.combatant;
    if (comp) comp.difficultyMul = on ? this.difficulty.companionDamage : 1;
  }

  /**
   * Put the fight back to its start: enemies made afresh (at the current difficulty), both actors
   * on their retry marks, the player's and the companion's vitals restored to the start snapshot
   * (the player's HP floored at `retry.minHp` when set) and their combat state cleared (a companion
   * that was down is up).
   */
  async reset() {
    if (this.st === "disposed") return;
    const h = this.host;
    this.attempt++;
    await this.spawn();
    if (this.disposedNow()) return;
    this.applyCompanion();
    h.player.teleport(this.spec.retry.player);
    if (h.companion && this.spec.retry.companion) h.companion.teleport(this.spec.retry.companion);
    this.restoreFighters();
    this.events.emit({ type: "retry", attempt: this.attempt });
    await this.spec.onRetry?.(this);
  }

  /**
   * The player and the companion as they began (vitals, with the player's HP floor) and in a clean
   * fighting state: no swing, guard, stagger, riposte, or down timer left from the last attempt;
   * then their controllers are reset.
   */
  private restoreFighters() {
    const h = this.host;
    const s = this.startState;
    const pc = h.player.combatant;
    if (pc) h.combat.resetState(pc, this.playerRetryVitals(pc, s?.player ?? null));
    const cc = h.companion?.combatant;
    if (cc) h.combat.resetState(cc, s?.companion ?? (cc.vitals.dead ? 1 : null));
    h.player.reset?.();
    h.companion?.reset?.();
  }

  /** `restoreFighters` that never throws (the fallbacks that must leave the player alive). */
  private recover() {
    try {
      this.restoreFighters();
    } catch (e) {
      console.error(`encounter ${this.spec.id}: recovery`, e);
    }
  }

  /** The player's vitals for a retry: the start snapshot (with HP at least `retry.minHp` of max, when set). */
  private playerRetryVitals(pc: Combatant, start: VitalsState | null): VitalsState {
    const v = start ?? { ...pc.vitals.snapshot(), hp: pc.vitals.maxHp, st: pc.vitals.maxSt };
    // (never back at 0 HP, whatever the snapshot says)
    const floor = Math.max(1, v.maxHp * (this.spec.retry.minHp ?? 0));
    return { ...v, hp: Math.min(v.maxHp, Math.max(v.hp, floor)) };
  }

  /**
   * The player died: 1 s of 0.35× slow motion, a 1.5 s fade, the story state rolled back to the
   * encounter's start, the death counted (and kept in that checkpoint), the reset, the fade back.
   * Ignored unless the fight is on.
   */
  async playerDied() {
    if (this.st !== "active") return;
    this.st = "resetting";
    const h = this.host;
    try {
      this.slowHold = h.time?.hold(DEATH.slow, DEATH.slowSeconds) ?? null;
      await this.wait(DEATH.slow * DEATH.slowSeconds);
      if (this.disposedNow()) return;
      this.faded = true;
      await h.fade?.(true, DEATH.fade);
      if (this.disposedNow()) return;
      await h.restore?.();
      if (this.disposedNow()) return;
      const n = this.deaths + 1;
      h.deaths.set(this.spec.id, n);
      h.snapshot?.();
      this.events.emit({ type: "death", deaths: n });
      await this.reset();
      if (this.disposedNow()) return;
    } catch (e) {
      // never leave the player dead behind a black screen: up again where the retry got to
      console.error(`encounter ${this.spec.id}: retry failed`, e);
      if (this.disposedNow()) return;
      this.recover();
    }
    this.st = "active";
    this.faded = false;
    await h.fade?.(false, DEATH.fade);
  }

  /** Check for the win (call every frame or after deaths): `onClear` runs once. */
  update() {
    if (this.st !== "active" || this.spawning > 0 || !this.allDefeated) return;
    this.st = "cleared";
    this.applyCompanion(false);
    for (const e of this.list) this.host.combat.releaseToken(e.actor.combatant);
    if (this.spec.music !== undefined) this.host.music?.(this.spec.musicAfter ?? null);
    this.events.emit({ type: "clear" });
    this.spec.onClear?.(this);
  }

  /**
   * Remove the enemies and stop (idempotent). A retry under way (the player dead, the screen going
   * black) is finished on the spot instead of left half done: the player and the companion get
   * their start vitals back and their controls reset, the slow motion ends and the screen fades
   * back in; they stay where they are (a chapter skip moves them anyway).
   */
  dispose() {
    if (this.st === "disposed") return;
    // (dead in a fight that never got to its retry counts too)
    const midRetry = this.st === "resetting" || (this.st === "active" && !!this.host.player.combatant?.vitals.dead);
    this.st = "disposed";
    this.despawn();
    this.applyCompanion(false);
    this.slowHold?.();
    this.slowHold = null;
    if (midRetry) {
      this.recover();
      if (this.faded) void Promise.resolve(this.host.fade?.(false, DEATH.fade)).catch(() => {});
    }
    this.faded = false;
    this.events.clear();
  }

  private disposedNow() {
    return this.st === "disposed";
  }

  private wait(seconds: number) {
    if (this.host.sleep) return this.host.sleep(seconds);
    return new Promise<void>((r) => setTimeout(r, (seconds * 1000) / Math.max(0.05, this.host.time?.value ?? 1)));
  }
}
