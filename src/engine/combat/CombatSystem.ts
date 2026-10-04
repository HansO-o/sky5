/**
 * Combat between registered combatants (keep/exit design §3.5, §8).
 *
 * Mapping to engine-framework §2.18 (for the framework migration). The keep/exit chapters hit with
 * a swept sector per swing (reach + radius, ±arc, |Δy|) rather than blade capsules against
 * hurtboxes, so the shapes differ; names follow §2.18 where they mean the same thing:
 * - `Combatant.team` / `CombatantSpec.team` = `faction` (both accepted); `CombatSystem.update(dt)` = `step(dt)`.
 * - `AttackDef.poiseDamage` as in §2.18. Timing is absolute clip seconds: `active: [from, to]` and
 *   `length`, where §2.18 has relative `windup` / `active` / `recovery` (windup = active[0],
 *   recovery = length − active[1]).
 * - `add(spec): Combatant` (§2.18: `add(c): Disposer`): the system builds the combatant from its
 *   spec; `remove(c)` is the disposer.
 * - `Vitals.spend(amount, { full })`, also callable as §2.18's `spend("stamina", amount)`;
 *   `Vitals.onDeath` is an `Emitter<void>`, and the blow that killed is on `CombatSystem.events`
 *   (`death.hit`) and `onHit` (§2.18: `Emitter<Hit>`).
 * - The player's controller is `PlayerCombat` (design §3.5), also exported as §2.18's
 *   `MeleeController` from `MeleeController.ts`; the migration renames the file.
 * - `HitResult` is §2.18's `Hit` (`outcome` in place of `blocked`; no hurtbox `zone`).
 */
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Emitter } from "../core/emitter";
import { BACKSTAB, COMPANION, GUARD, GUARDS, HIT_STOP, SHAKE, STAGGER } from "./attacks";
import {
  advanceClip,
  behind,
  blockedBlow,
  clipSeconds,
  defenceFor,
  hitReaction,
  lerpPose,
  lerpXYZ,
  sweptStrike,
  windowOverlap,
  withinArc,
  type Pose,
  type XYZ,
} from "./hit";
import type { Vitals, VitalsState } from "./vitals";
import type { AttackDef, GuardDef } from "./weapons";

const DEG = Math.PI / 180;

/** What a combatant knows of its surroundings (sneak attacks read it). */
export type Awareness = "unaware" | "suspicious" | "alert" | "asleep";

/** A static-only ray (Physics.rayCastStatic): line of sight for blows. */
export interface LineOfSight {
  rayCastStatic(from: Vector3, dir: Vector3, maxDist: number): number;
}

export interface CombatantSpec {
  id: string;
  /** the name a HUD shows for it (the target bar); content's words, e.g. the archetype's name */
  label?: string;
  /** see `CombatSystem.setHostile` (one of `faction` / `team` is required) */
  faction?: string;
  /** the same as `faction` (engine-framework §2.18's name) */
  team?: string;
  vitals: Vitals;
  /** feet position, read every combat step */
  position(): XYZ;
  /** forward yaw (forward = (−sin, −cos)) */
  yaw(): number;
  /** body radius for strikes (m; default 0.35) */
  radius?: number;
  /** chest height above the feet for line of sight (m; default 1.2) */
  chest?: number;
  /** humanoids can be backstabbed; creatures take double damage asleep (default humanoid) */
  kind?: "humanoid" | "creature";
  awareness?(): Awareness;
  /** how its raised guard takes blows (default: the weapon guard) */
  guard?: GuardDef;
  /**
   * a guard raised just before a blow parries it (§8: the player only; default false): the blow
   * lands within 0.18 s of the button press (see `CombatSystem.block`). Without it a raised guard
   * blocks once it is up (0.12 s), however late it was raised.
   */
  canParry?: boolean;
  /** multiplier on the damage it deals (its own: tutorials, scripts; see `Combatant.difficultyMul`) */
  damageMul?: number;
  /** wind-up rate of its attacks, overriding the attacks' own (adaptive difficulty: 0.5) */
  windupRate?: number;
  /** fraction of its swings that can connect (companions; default 1) */
  hitChance?: number;
  /** at most this many attackers hold a token on it (player 2, companion 1; default unlimited) */
  tokens?: number;
  /**
   * a passive shield: it takes this fraction of the focus's (the player's) lights outright, and a
   * heavy from the front always breaks it for half the damage (attacks.ts `Archetype.absorbLights`)
   */
  absorbLights?: number;
  /** "heavy": only heavies and parries stagger it */
  staggerBy?: "any" | "heavy";
  /** poise broken: how long it reels and the clip (default directional, 0.9 s; creatures 0.6 s) */
  stagger?: { seconds: number; clip?: string };
  /** at 0 HP it goes down for `seconds` and gets up with `rise` of its HP (true: 6 s, 50 %) */
  essential?: boolean | { seconds: number; rise: number };
  /** gives up when a blow leaves it at or below this fraction of its HP (the assistant: 0.3) */
  surrenderAt?: number;
  /** every event about it (hit reactions, staggers, deaths) */
  react?(e: CombatEvent): void;
}

export type HitOutcome = "hit" | "blocked" | "parried" | "guardBreak" | "absorbed" | "backstab";

export interface HitResult {
  attacker: Combatant;
  target: Combatant;
  attack: AttackDef;
  outcome: HitOutcome;
  /** HP taken (after armour) */
  damage: number;
  /** poise broke (or the guard did): the target reels */
  staggered: boolean;
  killed: boolean;
  /** where it landed (the target's chest) */
  point: XYZ;
  /** horizontal unit vector from the attacker to the target */
  dir: { x: number; z: number };
  /**
   * knockback the target should be moved by (m, world). With a stagger it is also on the `stagger`
   * event; without one only here. The target's controller applies it (PlayerCombat for the player,
   * the brain for an AI).
   */
  push: { x: number; z: number } | null;
  knockdown: boolean;
  /** a sneak attack (backstab, asleep, suspicious) */
  sneak: boolean;
  /** dealt within the riposte after a parry */
  riposte: boolean;
}

export type CombatEvent =
  /** an attack started: the tell (glint, grunt) runs `tell` seconds before the strike */
  | { type: "windup"; attacker: Combatant; attack: AttackDef; target: Combatant | null; tell: number }
  /** the strike window opened (swing sound) */
  | { type: "swing"; attacker: Combatant; attack: AttackDef }
  | { type: "hit"; hit: HitResult }
  /** the swing ended without a hit */
  | { type: "miss"; attacker: Combatant; attack: AttackDef }
  | { type: "block"; target: Combatant; on: boolean }
  | { type: "stagger"; target: Combatant; seconds: number; clip: string | null; from: XYZ | null; push: { x: number; z: number } | null; knockdown: boolean; reason: "poise" | "parried" | "guardBreak" | "knockdown" | "script" }
  | { type: "death"; target: Combatant; hit: HitResult | null }
  /** an essential combatant went down / got up */
  | { type: "down"; target: Combatant }
  | { type: "up"; target: Combatant }
  | { type: "surrender"; target: Combatant }
  /** feedback for blows involving the focus (the player) */
  | { type: "hitStop"; seconds: number }
  | { type: "shake"; amplitude: number; seconds: number };

export type SwingResult = "hit" | "miss" | "interrupted";

/** A swing in progress (what `attack()` returns). */
export interface AttackHandle {
  readonly attack: AttackDef;
  readonly attacker: Combatant;
  /** clip time now (s) */
  readonly time: number;
  /** the clip's playback rate now: the wind-up rate before the strike, the strike rate after */
  readonly rate: number;
  /** who it hit so far */
  readonly hits: readonly Combatant[];
  readonly finished: boolean;
  readonly done: Promise<SwingResult>;
  cancel(): void;
}

export interface AttackOptions {
  /** what it is aimed at (the tell event, token bookkeeping); every hostile in the strike can be hit */
  target?: Combatant | null;
  /** clip rate from the strike on (default the attack's `speed`) */
  speed?: number;
  /** clip rate up to the strike (default the combatant's, then the attack's) */
  windupRate?: number;
  /** replace a swing in progress (the player's chain); otherwise `attack()` refuses while one runs */
  force?: boolean;
  /** called whenever the clip's rate should change (the wind-up ends) */
  onRate?(rate: number): void;
  /** override the combatant's hit chance for this swing */
  hitChance?: number;
}

class Swing implements AttackHandle {
  t = 0;
  hitList: Combatant[] = [];
  opened = false;
  /** hit as many targets as it may */
  spent = false;
  finished = false;
  readonly done: Promise<SwingResult>;
  private resolveDone!: (r: SwingResult) => void;

  constructor(
    readonly attacker: Combatant,
    readonly attack: AttackDef,
    readonly speed: number,
    readonly windupRate: number,
    readonly target: Combatant | null,
    /** the hit-chance roll failed: it connects with nothing */
    readonly whiff: boolean,
    readonly onRate: ((r: number) => void) | undefined,
  ) {
    this.done = new Promise((r) => (this.resolveDone = r));
  }

  get time() {
    return this.t;
  }
  get rate() {
    return this.t < this.attack.active[0] ? this.windupRate : this.speed;
  }
  get hits(): readonly Combatant[] {
    return this.hitList;
  }

  finish(r: SwingResult) {
    if (this.finished) return;
    this.finished = true;
    if (this.attacker.swingNow === this) this.attacker.swingNow = null;
    this.resolveDone(r);
  }

  cancel() {
    this.finish("interrupted");
  }
}

/**
 * One fighter registered with a {@link CombatSystem}: its vitals, faction, body and the combat
 * state the system keeps for it (swing, guard, stagger, riposte, down). Settings are mutable
 * (adaptive difficulty changes `damageMul`, `windupRate`; a bluff that turns into a fight changes
 * `faction`).
 */
export class Combatant {
  readonly id: string;
  faction: string;
  readonly vitals: Vitals;
  radius: number;
  chest: number;
  kind: "humanoid" | "creature";
  guard: GuardDef;
  /** its raised guard can parry (the player) */
  canParry: boolean;
  /** multiplier on the damage it deals, owned by content (tutorials, scripts) */
  damageMul: number;
  /** a second multiplier on its damage, owned by the encounter (adaptive difficulty); 1 normally */
  difficultyMul = 1;
  windupRate: number | undefined;
  /** the encounter's wind-up rate cap (adaptive difficulty: 0.5); the slower of it and the swing's own wins */
  difficultyWindup: number | null = null;
  hitChance: number;
  tokenLimit: number;
  absorbLights: number;
  staggerBy: "any" | "heavy";
  staggerSpec: { seconds: number; clip?: string } | null;
  essential: { seconds: number; rise: number } | null;
  surrenderAt: number;
  /** gave up: counts as defeated, makes no attacks, can still be hit */
  surrendered = false;
  /** @internal */ swingNow: Swing | null = null;
  /** @internal */ blockHeld = false;
  /** @internal seconds since the guard went up */ blockAge = 0;
  /** @internal seconds since the press that can parry with this guard (Infinity: it can't) */
  parryAge = Infinity;
  /** @internal seconds left in which a new press can't parry (after a press that didn't) */
  parryLock = 0;
  /** @internal */ staggerLeft = 0;
  /** @internal */ riposteLeft = 0;
  /** @internal */ downLeft = 0;
  /** @internal */ deathHandled = false;
  /** @internal pose at the previous step and now */
  prev: Pose = { x: 0, y: 0, z: 0, yaw: 0 };
  /** @internal */ cur: Pose = { x: 0, y: 0, z: 0, yaw: 0 };

  constructor(readonly spec: CombatantSpec) {
    this.id = spec.id;
    const faction = spec.faction ?? spec.team;
    if (!faction) throw new Error(`combatant ${spec.id}: no faction`);
    this.faction = faction;
    this.vitals = spec.vitals;
    this.radius = spec.radius ?? 0.35;
    this.chest = spec.chest ?? 1.2;
    this.kind = spec.kind ?? "humanoid";
    this.guard = spec.guard ?? GUARDS.weapon;
    this.canParry = spec.canParry ?? false;
    this.damageMul = spec.damageMul ?? 1;
    this.windupRate = spec.windupRate;
    this.hitChance = spec.hitChance ?? 1;
    this.tokenLimit = spec.tokens ?? Infinity;
    this.absorbLights = spec.absorbLights ?? 0;
    this.staggerBy = spec.staggerBy ?? "any";
    this.staggerSpec = spec.stagger ?? null;
    const e = spec.essential;
    this.essential = e === true ? { seconds: COMPANION.down.seconds, rise: COMPANION.down.rise } : e ? e : null;
    this.surrenderAt = spec.surrenderAt ?? 0;
    this.readPose(this.cur);
    this.prev = { ...this.cur };
  }

  /** @internal */
  readPose(out: Pose) {
    const p = this.spec.position();
    out.x = p.x;
    out.y = p.y;
    out.z = p.z;
    out.yaw = this.spec.yaw();
    return out;
  }

  /** The same as `faction` (engine-framework §2.18's name). */
  get team() {
    return this.faction;
  }
  set team(v: string) {
    this.faction = v;
  }

  /** Out of the fight for good (an essential combatant that is down is not dead). */
  get dead() {
    return this.vitals.dead && !this.essential;
  }
  /** An essential combatant on its knees (not targetable, no attacks). */
  get down() {
    return this.downLeft > 0 || (!!this.essential && this.vitals.dead);
  }
  /** Dead or surrendered (an encounter is won when every enemy is). */
  get defeated() {
    return this.dead || this.surrendered;
  }
  /** Can attack, block and be fought. */
  get active() {
    return !this.vitals.dead && !this.surrendered;
  }
  get staggered() {
    return this.staggerLeft > 0;
  }
  /** The block is held (the guard may not be up yet). */
  get blocking() {
    return this.blockHeld;
  }
  /** The guard is up (held for at least the raise time). */
  get guardUp() {
    return this.blockHeld && this.blockAge >= GUARD.raise;
  }
  /** The swing in progress (null when none). */
  get swing(): AttackHandle | null {
    return this.swingNow;
  }
  /** Seconds of riposte left after a parry. */
  get riposte() {
    return this.riposteLeft;
  }
  /** Where it is now (as of the last combat step). */
  get pose(): Readonly<Pose> {
    return this.cur;
  }
}

export interface CombatSystemOptions {
  /** factions hostile to each faction (hostility is made mutual) */
  hostile?: Record<string, readonly string[]>;
  /** line of sight for blows (the physics' static ray); null: always in sight */
  los?: LineOfSight | null;
  /** a fixed-step clock to run on (`physics.onStep`); without one, call `step(dt)` on game time */
  clock?: { onStep(fn: (dt: number) => void): () => unknown };
  random?: () => number;
  /** a hostile this close (m) that is alert means "in combat" (no health regeneration; default 20) */
  engageRange?: number;
}

/** A body that jumped this far in one step was teleported: no sweep across the gap. */
const TELEPORT = 3;

/**
 * Melee and ranged blows between registered combatants (design §3.5, §8): faction hostility,
 * swept strikes inside each attack's active window (reach + radius, ±arc, |Δy| < 1.2, static line
 * of sight, at most `maxTargets` (1) per swing and each target once), guards with parry, block,
 * stamina and heavy guard breaks, shields that absorb lights, poise staggers, sneak attacks,
 * ripostes, essential combatants that go down instead of dying, attack tokens, and feedback events
 * (hit-stop 50/80/90 ms and camera shake for blows involving the `focus`). Runs on fixed steps of
 * game time.
 */
export class CombatSystem {
  readonly events = new Emitter<CombatEvent>();
  readonly onHit = new Emitter<HitResult>();
  readonly onDeath = new Emitter<Combatant>();
  /** the player: hit-stop and shake are emitted for blows it deals or takes */
  focus: Combatant | null = null;
  /** game seconds stepped */
  time = 0;
  private list: Combatant[] = [];
  private hostility = new Map<string, Set<string>>();
  /** attacker → the target it holds a token on */
  private tokens = new Map<Combatant, Combatant>();
  private los: LineOfSight | null;
  private random: () => number;
  private engageRange: number;
  private offClock: (() => unknown) | null = null;
  private disposed = false;
  private tmpFrom = new Vector3();
  private tmpDir = new Vector3();

  constructor(o: CombatSystemOptions = {}) {
    this.los = o.los ?? null;
    this.random = o.random ?? Math.random;
    this.engageRange = o.engageRange ?? 20;
    for (const [a, list] of Object.entries(o.hostile ?? {})) for (const b of list) this.setHostile(a, b);
    if (o.clock) this.offClock = o.clock.onStep((dt) => this.step(dt));
  }

  // ------------------------------------------------------------------ registry

  add(spec: CombatantSpec): Combatant {
    if (this.get(spec.id)) throw new Error(`combatant ${spec.id} already registered`);
    const c = new Combatant(spec);
    this.list.push(c);
    return c;
  }

  /** Unregister (idempotent): its swing ends, its tokens are released. */
  remove(c: Combatant) {
    const i = this.list.indexOf(c);
    if (i < 0) return;
    this.list.splice(i, 1);
    c.swingNow?.cancel();
    c.blockHeld = false;
    this.tokens.delete(c);
    for (const [a, t] of [...this.tokens]) if (t === c) this.tokens.delete(a);
    if (this.focus === c) this.focus = null;
  }

  get(id: string) {
    return this.list.find((c) => c.id === id);
  }

  get combatants(): readonly Combatant[] {
    return this.list;
  }

  has(c: Combatant) {
    return this.list.includes(c);
  }

  /** Make two factions hostile to each other (or not). */
  setHostile(a: string, b: string, on = true) {
    for (const [x, y] of [
      [a, b],
      [b, a],
    ]) {
      let s = this.hostility.get(x);
      if (!s) this.hostility.set(x, (s = new Set()));
      if (on) s.add(y);
      else s.delete(y);
    }
  }

  isHostile(a: Combatant | string, b: Combatant | string) {
    const fa = typeof a === "string" ? a : a.faction, fb = typeof b === "string" ? b : b.faction;
    return fa !== fb && !!this.hostility.get(fa)?.has(fb);
  }

  /** Hostiles of `c` that can be fought (alive, not down; surrendered ones too when `surrendered`). */
  enemiesOf(c: Combatant, o: { surrendered?: boolean } = {}) {
    return this.list.filter((t) => t !== c && this.isHostile(c, t) && !t.vitals.dead && (o.surrendered || !t.surrendered));
  }

  /** Whether an alert hostile is within the engage range (no health regeneration then). */
  engaged(c: Combatant) {
    const r2 = this.engageRange * this.engageRange;
    return this.list.some((t) => {
      if (t === c || !t.active || !this.isHostile(c, t)) return false;
      const aw = t.spec.awareness?.() ?? "alert";
      if (aw !== "alert") return false;
      const dx = t.cur.x - c.cur.x, dz = t.cur.z - c.cur.z;
      return dx * dx + dz * dz < r2 && Math.abs(t.cur.y - c.cur.y) < 4;
    });
  }

  // ------------------------------------------------------------------ actions

  /**
   * Start an attack: the clip time advances on combat steps (wind-up rate, then strike rate) and
   * the strike lands on whatever hostile is in it during the active window. Null when it can't
   * (dead, down, surrendered, staggered, or busy without `force`).
   */
  attack(c: Combatant, def: AttackDef, o: AttackOptions = {}): AttackHandle | null {
    if (this.disposed || !this.has(c) || !c.active || c.down || c.staggered) return null;
    if (c.swingNow && !c.swingNow.finished) {
      if (!o.force) return null;
      c.swingNow.cancel();
    }
    if (c.blockHeld) this.block(c, false);
    const speed = o.speed ?? def.speed ?? 1;
    let windup = o.windupRate ?? c.windupRate ?? def.windupRate ?? speed;
    if (c.difficultyWindup !== null) windup = Math.min(windup, c.difficultyWindup);
    const chance = o.hitChance ?? c.hitChance;
    const s = new Swing(c, def, speed, windup, o.target ?? null, chance < 1 && this.random() >= chance, o.onRate);
    c.swingNow = s;
    this.emit({ type: "windup", attacker: c, attack: def, target: s.target, tell: clipSeconds(0, def.active[0], def.active[0], windup, speed) }, c, s.target);
    o.onRate?.(s.rate);
    return s;
  }

  /**
   * Raise or lower the guard: it is up 0.12 s after it is raised. For a combatant that `canParry`,
   * blows landing within 0.18 s of the button press are parried: `pressAge` is how long ago the
   * press was (default 0: now), so a block held through a stagger or a recovery and raised when it
   * ends doesn't get a fresh window. A press within 0.4 s of an earlier one that didn't parry
   * (`GUARD.parryLockout`) can't parry, so tapping block doesn't keep the window open.
   */
  block(c: Combatant, on: boolean, o: { pressAge?: number } = {}) {
    if (on === c.blockHeld) return;
    if (on && (!c.active || c.down || c.staggered || (c.swingNow && !c.swingNow.finished))) return;
    c.blockHeld = on;
    c.blockAge = 0;
    if (on) {
      const age = Math.max(0, o.pressAge ?? 0);
      c.parryAge = c.canParry && age <= GUARD.parry && c.parryLock <= 0 ? age : Infinity;
      // every press starts the lockout (a parry ends it)
      if (c.canParry) c.parryLock = Math.max(c.parryLock, GUARD.parryLockout - age);
    }
    this.emit({ type: "block", target: c, on }, c);
  }

  /** Make `c` reel for `seconds` (its swing ends, its guard drops). */
  stagger(c: Combatant, seconds: number, o: { clip?: string | null; from?: XYZ | null; push?: { x: number; z: number } | null; knockdown?: boolean; reason?: "poise" | "parried" | "guardBreak" | "knockdown" | "script" } = {}) {
    if (!c.active || c.down) return;
    c.staggerLeft = Math.max(c.staggerLeft, seconds);
    c.swingNow?.cancel();
    c.blockHeld = false;
    this.emit({ type: "stagger", target: c, seconds, clip: o.clip ?? null, from: o.from ?? null, push: o.push ?? null, knockdown: !!o.knockdown, reason: o.reason ?? "script" }, c);
  }

  /**
   * Back to a clean fighting state (an encounter retry, a revive): the swing, guard, stagger,
   * riposte, down timer, surrender and tokens end. `vitals` restores the gauges first (a snapshot
   * of them, or a fraction of max HP to revive with). An essential combatant that was down gets up
   * (an `up` event); one that is still at 0 HP after this goes down or dies again on the next step.
   */
  resetState(c: Combatant, vitals?: VitalsState | number | null) {
    const wasDown = c.down;
    if (typeof vitals === "number") c.vitals.revive(vitals);
    else if (vitals) c.vitals.restore(vitals);
    c.swingNow?.cancel();
    c.swingNow = null;
    c.blockHeld = false;
    c.blockAge = 0;
    c.parryAge = Infinity;
    c.parryLock = 0;
    c.staggerLeft = 0;
    c.riposteLeft = 0;
    c.downLeft = 0;
    c.surrendered = false;
    c.deathHandled = false;
    this.tokens.delete(c);
    c.readPose(c.cur);
    Object.assign(c.prev, c.cur);
    if (wasDown && !c.vitals.dead && this.has(c)) this.emit({ type: "up", target: c }, c);
  }

  /** Give up: no more attacks or tokens; it still counts as an enemy that can be hit (and killed). */
  surrender(c: Combatant) {
    if (c.surrendered || c.vitals.dead) return;
    c.surrendered = true;
    c.swingNow?.cancel();
    c.blockHeld = false;
    this.tokens.delete(c);
    this.emit({ type: "surrender", target: c }, c);
  }

  /**
   * A blow resolved at once, without the swept test: an arrow that arrived, a scripted hit. Null
   * when the target can't be hit.
   */
  strike(attacker: Combatant, target: Combatant, def: AttackDef): HitResult | null {
    if (this.disposed || target.vitals.dead || target.down) return null;
    return this.resolve(attacker, target, def);
  }

  // ------------------------------------------------------------------ tokens

  /**
   * Ask for a token to attack `target` (≤ its limit at once). True when `attacker` holds one on it
   * now (a token on another target is given up).
   */
  requestToken(attacker: Combatant, target: Combatant) {
    if (!attacker.active || attacker.down || target.vitals.dead) return false;
    if (this.tokens.get(attacker) === target) return true;
    if (this.tokenHolders(target).length >= target.tokenLimit) return false;
    this.tokens.set(attacker, target);
    return true;
  }

  releaseToken(attacker: Combatant) {
    this.tokens.delete(attacker);
  }

  /** The target `attacker` holds a token on (null when none). */
  tokenOf(attacker: Combatant) {
    return this.tokens.get(attacker) ?? null;
  }

  tokenHolders(target: Combatant) {
    const out: Combatant[] = [];
    for (const [a, t] of this.tokens) if (t === target) out.push(a);
    return out;
  }

  /** Change how many may attack `target` at once; holders past the new limit lose theirs (latest first). */
  setTokenLimit(target: Combatant, n: number) {
    target.tokenLimit = n;
    const holders = this.tokenHolders(target);
    for (let i = holders.length - 1; i >= n; i--) this.tokens.delete(holders[i]);
  }

  // ------------------------------------------------------------------ stepping

  /** The same as `step` (engine-framework §2.18's name). */
  update(dt: number) {
    this.step(dt);
  }

  /** Advance `dt` seconds of game time (called by the clock when one was given). */
  step(dt: number) {
    if (this.disposed || dt <= 0) return;
    this.time += dt;
    for (const c of this.list) {
      c.readPose(c.cur);
      // teleported: no sweep across the gap
      if (Math.hypot(c.cur.x - c.prev.x, c.cur.z - c.prev.z) > TELEPORT || Math.abs(c.cur.y - c.prev.y) > TELEPORT) Object.assign(c.prev, c.cur);
      if (c.blockHeld) {
        c.blockAge += dt;
        c.parryAge += dt;
      }
      if (c.parryLock > 0) c.parryLock = Math.max(0, c.parryLock - dt);
      if (c.staggerLeft > 0) c.staggerLeft = Math.max(0, c.staggerLeft - dt);
      if (c.riposteLeft > 0) c.riposteLeft = Math.max(0, c.riposteLeft - dt);
    }
    for (const c of [...this.list]) if (this.has(c)) this.stepSwing(c, dt);
    for (const c of [...this.list]) {
      if (!this.has(c)) continue;
      c.vitals.update(dt, { combat: this.engaged(c), blocking: c.blockHeld });
      if (c.downLeft > 0) {
        c.downLeft -= dt;
        if (c.downLeft <= 0) {
          c.downLeft = 0;
          c.vitals.revive(c.essential?.rise ?? 0.5);
          c.deathHandled = false;
          this.emit({ type: "up", target: c }, c);
        }
      }
      // revived from outside (a retry restored its vitals)
      if (c.deathHandled && !c.vitals.dead) c.deathHandled = false;
      this.checkDeath(c, null);
    }
    for (const c of this.list) Object.assign(c.prev, c.cur);
  }

  private stepSwing(c: Combatant, dt: number) {
    const s = c.swingNow;
    if (!s || s.finished) return;
    const def = s.attack;
    const [w0, w1] = def.active;
    const t0 = s.t;
    const rate0 = s.rate;
    const t1 = advanceClip(t0, dt, w0, s.windupRate, s.speed);
    s.t = t1;
    if (s.rate !== rate0) s.onRate?.(s.rate);
    if (!s.opened && t1 >= w0) {
      s.opened = true;
      this.emit({ type: "swing", attacker: c, attack: def }, c);
    }
    const ov = !s.whiff && !s.spent && !def.ranged ? windowOverlap(t0, t1, w0, w1) : null;
    if (ov) this.sweep(c, s, t0, ov, dt);
    if (s.t >= def.length && !s.finished) {
      if (!s.hitList.length) this.emit({ type: "miss", attacker: c, attack: def }, c);
      s.finish(s.hitList.length ? "hit" : "miss");
    }
  }

  /** The strike test over the part `ov` (clip times) of this step. */
  private sweep(c: Combatant, s: Swing, t0: number, ov: [number, number], dt: number) {
    const def = s.attack;
    const strike = def.active[0];
    const ua = Math.min(1, clipSeconds(t0, ov[0], strike, s.windupRate, s.speed) / dt);
    const ub = Math.min(1, clipSeconds(t0, ov[1], strike, s.windupRate, s.speed) / dt);
    const a0 = lerpPose(c.prev, c.cur, ua), a1 = lerpPose(c.prev, c.cur, ub);
    const found: { t: Combatant; u: number; d: number }[] = [];
    for (const t of this.list) {
      if (t === c || !this.isHostile(c, t) || t.vitals.dead || t.down || s.hitList.includes(t)) continue;
      const p0 = lerpXYZ(t.prev, t.cur, ua), p1 = lerpXYZ(t.prev, t.cur, ub);
      const u = sweptStrike(a0, a1, p0, p1, { reach: def.reach, radius: t.radius, arc: def.arc * DEG });
      if (u < 0) continue;
      const at = ua + u * (ub - ua);
      const ap = lerpPose(c.prev, c.cur, at), tp = lerpXYZ(t.prev, t.cur, at);
      if (!this.sight(ap, c.chest, tp, t.chest)) continue;
      found.push({ t, u: at, d: Math.hypot(tp.x - ap.x, tp.z - ap.z) });
    }
    if (!found.length) return;
    found.sort((p, q) => p.u - q.u || p.d - q.d);
    const max = def.maxTargets ?? 1;
    for (const f of found) {
      if (s.hitList.length >= max || s.finished) break;
      s.hitList.push(f.t);
      this.resolve(c, f.t, def);
    }
    if (s.hitList.length >= max) s.spent = true;
  }

  /** Static line of sight between two chests. */
  private sight(a: XYZ, ah: number, b: XYZ, bh: number) {
    if (!this.los) return true;
    const from = this.tmpFrom.set(a.x, a.y + ah, a.z);
    const dir = this.tmpDir.set(b.x - a.x, b.y + bh - (a.y + ah), b.z - a.z);
    const d = dir.length();
    if (d < 1e-3) return true;
    dir.scaleInPlace(1 / d);
    return this.los.rayCastStatic(from, dir, d) >= d - 0.05;
  }

  // ------------------------------------------------------------------ resolution

  private resolve(a: Combatant, t: Combatant, def: AttackDef): HitResult {
    const ap = a.cur, tp = t.cur;
    let dx = tp.x - ap.x, dz = tp.z - ap.z;
    const len = Math.hypot(dx, dz);
    if (len > 1e-6) {
      dx /= len;
      dz /= len;
    } else {
      dx = -Math.sin(ap.yaw);
      dz = -Math.cos(ap.yaw);
    }
    const dir = { x: dx, z: dz };
    const point = { x: tp.x, y: tp.y + t.chest, z: tp.z };
    const inFront = withinArc(tp, ap, t.guard.arc * DEG);
    const staggered = t.staggered;
    let raw = def.damage * a.damageMul * a.difficultyMul;
    let riposte = false;
    if (a.riposteLeft > 0 && !def.ranged) {
      raw *= GUARD.riposte.mul;
      a.riposteLeft = 0;
      riposte = true;
    }
    const aw = t.spec.awareness?.() ?? "alert";
    let sneak = false;
    let outcome: HitOutcome = "hit";
    let damage = raw;
    let poise = def.poiseDamage;
    let knockdown = !!def.knockdown;
    // the guard break and the stamina break stagger with their own clip
    let breakSpec: { seconds: number; clip: string } | null = null;

    if (t.kind === "humanoid" && aw === "unaware" && !def.ranged && behind(tp, ap, BACKSTAB.arc * DEG)) {
      outcome = "backstab";
      sneak = true;
    } else {
      if (aw === "asleep") {
        damage = raw *= BACKSTAB.asleep;
        sneak = true;
      } else if (aw === "suspicious") {
        damage = raw *= BACKSTAB.suspicious;
        sneak = true;
      }
      // the passive shield meets the player's blows only (no focus: everyone's)
      if (t.absorbLights > 0 && (!this.focus || a === this.focus) && inFront && !staggered && !def.ranged && t.active) {
        if (def.guardBreak) {
          outcome = "guardBreak";
          damage = raw * GUARD.heavyBreak.through;
          poise = 0;
          breakSpec = GUARD.heavyBreak;
        } else if (!def.heavy && this.random() < t.absorbLights) {
          outcome = "absorbed";
          damage = 0;
          poise = 0;
          knockdown = false;
        }
      }
      if (outcome === "hit") {
        const d = defenceFor({ blocking: t.blockHeld, blockAge: t.blockAge, parryAge: t.parryAge, inFront, staggered, canParry: t.canParry, unparryable: def.unparryable || def.ranged, guardBreak: def.guardBreak, parryWindow: GUARD.parry, raise: GUARD.raise });
        if (d === "parry") {
          outcome = "parried";
          damage = 0;
          poise = 0;
          knockdown = false;
        } else if (d === "guardBreak") {
          outcome = "guardBreak";
          damage = raw * GUARD.heavyBreak.through;
          poise = 0;
          breakSpec = GUARD.heavyBreak;
        } else if (d === "block") {
          const g = def.ranged ? t.guard.ranged : t.guard;
          const b = blockedBlow(raw, g, t.vitals.st);
          t.vitals.drain(b.cost);
          damage = b.damage;
          poise = 0;
          if (t.guard.shield) knockdown = false;
          outcome = b.broken ? "guardBreak" : "blocked";
          if (b.broken) breakSpec = GUARD.staminaBreak;
        }
      }
    }

    let r: { damage: number; staggered: boolean; killed: boolean };
    if (outcome === "backstab") {
      const before = t.vitals.hp;
      t.vitals.kill();
      r = { damage: before, staggered: false, killed: true };
    } else if (outcome === "parried" || outcome === "absorbed") r = { damage: 0, staggered: false, killed: false };
    else r = t.vitals.apply({ damage, poise });

    const push = def.knockback && !r.killed && outcome !== "parried" && outcome !== "absorbed" ? { x: dir.x * def.knockback, z: dir.z * def.knockback } : null;
    const hit: HitResult = {
      attacker: a,
      target: t,
      attack: def,
      outcome,
      damage: r.damage,
      staggered: false,
      killed: r.killed,
      point,
      dir,
      push,
      knockdown: knockdown && !r.killed,
      sneak,
      riposte,
    };

    // reactions
    if (outcome === "parried") {
      t.riposteLeft = GUARD.riposte.seconds;
      t.parryLock = 0;
      // creatures reel procedurally (no clip), as for a broken poise
      this.stagger(a, GUARD.parryStagger.seconds, { clip: a.kind === "creature" ? null : GUARD.parryStagger.clip, from: tp, reason: "parried" });
    } else if (!r.killed && t.surrenderAt > 0 && !t.surrendered && t.vitals.hpFrac <= t.surrenderAt) {
      this.surrender(t);
    } else if (!r.killed) {
      if (breakSpec) {
        hit.staggered = true;
        this.stagger(t, breakSpec.seconds, { clip: breakClip(t, breakSpec), from: ap, push, reason: "guardBreak" });
      } else if (hit.knockdown) {
        hit.staggered = true;
        this.stagger(t, STAGGER.knockdown.seconds, { clip: STAGGER.knockdown.clip, from: ap, push, knockdown: true, reason: "knockdown" });
      } else if (r.staggered && (t.staggerBy !== "heavy" || def.heavy)) {
        hit.staggered = true;
        const spec = t.staggerSpec;
        const seconds = spec?.seconds ?? (t.kind === "creature" ? STAGGER.creature.seconds : STAGGER.humanoid.seconds);
        const clip = spec?.clip ?? (t.kind === "creature" ? null : hitReaction(tp, ap, { heavy: def.heavy }));
        this.stagger(t, seconds, { clip, from: ap, push, reason: "poise" });
      }
      if (outcome === "hit" && def.dot) t.vitals.addDot(def.dot.perSecond, def.dot.seconds);
    }

    this.feedback(hit);
    this.emit({ type: "hit", hit }, a, t);
    this.onHit.emit(hit);
    this.checkDeath(t, hit);
    return hit;
  }

  /** Hit-stop and shake for blows the focus deals or takes. */
  private feedback(h: HitResult) {
    const f = this.focus;
    if (!f || (h.attacker !== f && h.target !== f)) return;
    const heavy = !!h.attack.heavy;
    if (h.outcome === "parried") this.emit({ type: "hitStop", seconds: HIT_STOP.parry });
    else if (h.outcome === "hit" || h.outcome === "guardBreak" || h.outcome === "backstab") this.emit({ type: "hitStop", seconds: h.attack.hitStop ?? (heavy ? HIT_STOP.heavy : HIT_STOP.light) });
    let shake: readonly [number, number] | null = null;
    if (h.target === f && h.outcome === "guardBreak") shake = SHAKE.guardBreak;
    else if (h.target === f && h.damage > 0) shake = heavy ? SHAKE.takenHeavy : SHAKE.taken;
    else if (h.attacker === f && heavy && (h.outcome === "hit" || h.outcome === "guardBreak")) shake = SHAKE.dealtHeavy;
    if (shake) this.emit({ type: "shake", amplitude: shake[0], seconds: shake[1] });
  }

  private checkDeath(c: Combatant, hit: HitResult | null) {
    if (!c.vitals.dead || c.deathHandled) return;
    c.deathHandled = true;
    c.swingNow?.cancel();
    c.blockHeld = false;
    c.staggerLeft = 0;
    this.tokens.delete(c);
    for (const [a, t] of [...this.tokens]) if (t === c) this.tokens.delete(a);
    if (c.essential) {
      c.downLeft = c.essential.seconds;
      this.emit({ type: "down", target: c }, c);
      return;
    }
    this.emit({ type: "death", target: c, hit }, c);
    this.onDeath.emit(c);
  }

  private emit(e: CombatEvent, ...about: (Combatant | null)[]) {
    for (const c of about) if (c) safe(() => c.spec.react?.(e));
    this.events.emit(e);
  }

  // ------------------------------------------------------------------ debug and teardown

  /** Kill every combatant hostile to `of` (default: the focus) — tests and `?debug`. */
  debugKillAll(of: Combatant | string | null = this.focus) {
    if (!of) return;
    for (const c of [...this.list]) if (this.isHostile(of, c) && !c.vitals.dead) {
      c.vitals.kill();
      this.checkDeath(c, null);
    }
  }

  /** Stop stepping and drop every combatant (their vitals stay with their owners). */
  dispose() {
    if (this.disposed) return;
    for (const c of [...this.list]) this.remove(c);
    this.disposed = true;
    this.offClock?.();
    this.offClock = null;
    this.events.clear();
    this.onHit.clear();
    this.onDeath.clear();
  }
}

/** The reel of a broken guard: none for creatures; the shield break only with a shield. */
function breakClip(t: Combatant, spec: { clip: string }) {
  if (t.kind === "creature") return null;
  if (spec === GUARD.heavyBreak && !t.guard.shield) return GUARD.heavyBreak.weaponClip;
  return spec.clip;
}

function safe(fn: () => void) {
  try {
    fn();
  } catch (e) {
    console.error("combat react", e);
  }
}
