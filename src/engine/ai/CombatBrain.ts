/**
 * The fighting half of every AI brain (keep/exit design §3.6, §6.3, §7, §8), shared by
 * `HumanoidBrain`, `CreatureBrain` and `Companion`: a hierarchical state machine ticked at 10 Hz
 * whose "combat" family is
 *
 *   alert → approach → circle (waits for a token) → attack (wind-up at the attack's rate, then 1×)
 *   → recover (humans: the _Rec clip at 1.2×; creatures back off) → circle …
 *
 * with reactive `block`, `stagger` (directional hit clip, knockdown and getting up; creatures reel
 * procedurally), `shoot` (archers), and the terminal or external states `dead` (a death clip, or a
 * ragdoll while fewer than 2 are active), `surrender`, `down` (essential companions) and `scripted`
 * (a cutscene has the body: `suspend()` / `resume()`). Subclasses add the calm family (post and
 * suspicion; sleep, stir and wake; following). Everything it touches comes in through its
 * constructor: the combat system, its combatant, its agent, the AI system.
 */
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Emitter } from "../core/emitter";
import type { Disposer } from "../core/types";
import type { DisposerSink } from "../core/emitter";
import type { RootMotionCurve } from "../anim/rootMotion";
import { ARROW, BACKSTAB, COMPANION, GUARDS, STAGGER, type Archetype, type CompanionTuning } from "../combat/attacks";
import type { AttackHandle, Awareness, CombatantSpec, CombatEvent, Combatant, CombatSystem, HitResult } from "../combat/CombatSystem";
import { Vitals } from "../combat/vitals";
import type { XYZ } from "../combat/hit";
import type { AttackDef, SpecialDef } from "../combat/weapons";
import type { AgentControl } from "./agent";
import { Brain, type BrainState } from "./fsm";
import type { SightRay } from "./perception";
import { AI, between } from "./tuning";
import { yawOf, type XZ } from "./steering";

/** A ranged attack (the archer's arrow): flies at `speed`, drawn for `draw` s, glints at `glint` s. */
export type RangedDef = AttackDef & { speed: number; draw: number; glint: number };

/** How a brain fights: its attacks, guard and pacing (from an `Archetype` or a companion's tuning). */
export interface FighterSpec {
  kind: "humanoid" | "creature";
  /** the light combo, played in order as one sequence */
  light: readonly AttackDef[];
  heavy?: AttackDef | null;
  /** chance a sequence is the heavy, or every Nth sequence is */
  heavyChance?: number;
  heavyEvery?: number;
  /** a move from a distance or up close (lunge, kick, pounce) */
  special?: SpecialDef | null;
  /** shoots beyond `melee` m (switching to the light attacks within it) */
  ranged?: RangedDef | null;
  melee?: number;
  /** chance to raise the guard against a blow coming at it */
  block: number;
  /** seconds between attack sequences */
  interval: readonly [number, number];
  /** keeps on a ring this far from its target (default: humans 3–4.5 m, creatures 3–5 m) */
  ring?: readonly [number, number];
  shield?: boolean;
  /** movement (m/s): approach, and a charge (the wolf's run) */
  speed?: { move: number; run?: number };
}

/** A fighter from an archetype of the tuning tables (attacks.ts). */
export function fighterOf(a: Archetype): FighterSpec {
  return {
    kind: a.kind,
    light: a.light,
    heavy: a.heavy ?? null,
    heavyChance: a.heavyChance,
    heavyEvery: a.heavyEvery,
    special: a.special ?? null,
    ranged: a.ranged ?? null,
    melee: a.melee,
    // a passive shield (absorbLights) never raises a guard of its own
    block: a.block,
    interval: a.interval,
    ring: a.kite,
    shield: a.shield,
    speed: a.speed,
  };
}

/** A companion's fighting (§8 "Companions"). */
export function companionFighter(t: CompanionTuning): FighterSpec {
  return { kind: "humanoid", light: t.attack, block: t.block, interval: t.interval, shield: t.shield };
}

/** The parts of a `CombatantSpec` an archetype or a companion's tuning decides. */
export type FighterCombatant = Pick<CombatantSpec, "vitals" | "radius" | "chest" | "kind" | "guard" | "absorbLights" | "surrenderAt" | "staggerBy" | "essential" | "tokens" | "hitChance">;

/**
 * The combat side of an archetype (§8): fresh vitals (HP × `hpMul`, the adaptive difficulty's
 * enemy HP), body radius and chest height, the shield's guard and passive absorb, surrender and
 * stagger rules. Spread it into `CombatSystem.add({ id, faction, position, yaw, awareness, ...})`.
 */
export function combatantOf(a: Archetype, o: { hpMul?: number } = {}): FighterCombatant {
  return {
    vitals: new Vitals({ health: Math.max(1, Math.round(a.hp * (o.hpMul ?? 1))), poise: a.poise, stamina: 100 }),
    radius: a.radius,
    chest: a.kind === "creature" ? Math.max(0.3, 0.6 * (a.scale ?? 1)) : 1.2,
    kind: a.kind,
    guard: a.shield ? GUARDS.shield : GUARDS.weapon,
    absorbLights: a.absorbLights,
    surrenderAt: a.surrenderAt,
    staggerBy: a.staggerBy,
  };
}

/**
 * The combat side of a companion (§8 "Companions"): essential (down at 0 HP for 6 s, up at 50 %),
 * at most one enemy on it at once, its hit chance, its shield.
 */
export function companionCombatant(t: CompanionTuning): FighterCombatant {
  return {
    vitals: new Vitals({ health: t.hp, poise: t.poise, stamina: 100 }),
    radius: COMPANION.radius,
    chest: 1.2,
    kind: "humanoid",
    guard: t.shield ? GUARDS.shield : GUARDS.weapon,
    essential: true,
    tokens: COMPANION.tokens,
    hitChance: t.hitChance,
  };
}

/** Clips a brain plays (defaults for UAL humanoids; creatures pass their own). */
export interface BrainClips {
  /** reacting to an alert (null: none) */
  alert: string | null;
  /** the guard: with a weapon (held at `blockFreeze` s) and with a shield */
  block: string;
  blockFreeze: number;
  shieldBlock: string;
  /** getting up after a knockdown */
  rise: string;
  /** deaths (one at random), and the backstab's */
  death: readonly string[];
  backstabDeath: string;
  /** given up (loops) */
  surrender: string;
  /** an essential companion on its knees (loops) */
  down: string;
  /** the archer's draw (loops while drawing) and release */
  draw: string;
  shoot: string;
}

export const HUMANOID_CLIPS: BrainClips = {
  alert: "Surprise",
  block: "Sword_Block",
  blockFreeze: 0.4,
  shieldBlock: "Idle_Shield_Loop",
  rise: STAGGER.knockdown.rise,
  death: STAGGER.deaths,
  backstabDeath: BACKSTAB.clip,
  surrender: "Crying",
  down: "Fixing_Kneeling",
  draw: "Bow_Aim_Neutral",
  shoot: "Bow_Shoot",
};

/** Things a brain says or shows; content picks the words and effects. */
export type BarkKind = "alert" | "suspicious" | "calm" | "special" | "surrender" | "stir" | "wake" | "leash" | "sleep" | "down";

export type BrainEvent =
  | { type: "state"; from: string | null; to: string }
  | { type: "bark"; kind: BarkKind }
  /** an archer's draw glints (`at` the bow) */
  | { type: "glint"; at: XYZ }
  /** a projectile left the bow: it arrives in `seconds` */
  | { type: "shoot"; from: XYZ; to: XYZ; seconds: number }
  | { type: "died"; hit: HitResult | null; ragdoll: boolean }
  /** the companion reappeared behind the player (catch-up) */
  | { type: "caughtUp"; at: XYZ };

/** What the brain asks of its AI system (implemented by `AISystem`). */
export interface BrainSystem {
  add(b: { think(dt: number): void }, o?: { hz?: number }): Disposer;
  register(b: CombatBrain): Disposer;
  /** alert the brain's allies (its group, and its faction within `radius`) */
  alertAllies(from: CombatBrain, at: XYZ | null, radius: number): number;
  /** a ragdoll may start now (at most 2 at once) */
  ragdollSlot(): boolean;
  /** every brain it knows */
  readonly brains: readonly CombatBrain[];
  brainOf(key: unknown): CombatBrain | undefined;
}

export interface CombatBrainOptions {
  combat: CombatSystem;
  self: Combatant;
  agent: AgentControl;
  fighter: FighterSpec;
  /** the AI system it thinks on (registry, alerts, ragdoll budget); without one call `think(dt)` yourself */
  ai?: BrainSystem | null;
  /** brain rate (Hz; default 10) */
  hz?: number;
  random?: () => number;
  /** root-motion curves by clip (attacks ride them) */
  rootMotion?: { get(clip: string): RootMotionCurve | undefined } | null;
  /** static line of sight (archers check the shot) */
  los?: SightRay | null;
  clips?: Partial<BrainClips>;
  /** an alert group: one alert alerts the whole group, however far (an encounter's enemies) */
  group?: string | null;
  /** extra keys `AISystem.brainOf` / `suspend` know it by (its Character, a name) */
  keys?: readonly unknown[];
  /** score bias for a target (negative: preferred), e.g. a captain that prefers the companion */
  preferTarget?(c: Combatant): number;
  /** may it fight this one at all */
  canTarget?(c: Combatant): boolean;
  /** make a ragdoll of the body; true when it did (only asked while the budget has room) */
  ragdoll?(hit: HitResult | null): boolean;
  /** how aware it reads to the combat system while a script has it (default "alert": no backstab mid-scene) */
  scriptedAwareness?: Awareness;
  /** give up on targets further than this (m; default 30) */
  giveUp?: number;
}

/** A stagger as the combat system reported it. */
interface StaggerInfo {
  seconds: number;
  clip: string | null;
  push: { x: number; z: number } | null;
  from: XYZ | null;
  knockdown: boolean;
}

/** An arrow in flight. */
interface Flight {
  target: Combatant;
  aim: XYZ;
  arrive: number;
  def: AttackDef;
}

const dist = (a: XZ, b: XZ) => Math.hypot(a.x - b.x, a.z - b.z);

export abstract class CombatBrain {
  readonly events = new Emitter<BrainEvent>();
  readonly combat: CombatSystem;
  readonly self: Combatant;
  readonly agent: AgentControl;
  readonly fighter: FighterSpec;
  readonly group: string | null;
  readonly keys: readonly unknown[];
  /** whom it is fighting */
  target: Combatant | null = null;
  /** brain seconds */
  time = 0;
  fsm!: Brain<CombatBrain>;
  protected o: CombatBrainOptions;
  protected ai: BrainSystem | null;
  protected random: () => number;
  protected clips: BrainClips;
  protected offs: (() => unknown)[] = [];
  // fighting bookkeeping
  protected forced: { c: Combatant; until: number } | null = null;
  protected lastHitBy: { c: Combatant; at: number } | null = null;
  protected nextAttackAt = 0;
  protected specialReadyAt = 0;
  protected sequences = 0;
  protected combo: AttackDef[] = [];
  protected comboIdx = 0;
  protected lastDef: AttackDef | null = null;
  protected swing: AttackHandle | null = null;
  protected stagger: StaggerInfo | null = null;
  protected blockAgainst: Combatant | null = null;
  protected deathHit: HitResult | null = null;
  protected retargetAt = 0;
  protected tokenAt = 0;
  /** when circling next asks for a turn */
  protected askAt = 0;
  protected timer = 0;
  protected circleDir: 1 | -1 = 1;
  protected circleR = 3.5;
  /** how long the next back-off lasts (s; default the 1.5 m step at the back-off speed) */
  protected backoffFor: number | null = null;
  protected flipAt = 0;
  protected frozen = false;
  protected rising = false;
  protected flights: Flight[] = [];
  protected shot = { glint: false, loosed: false };
  protected untilHit = false;
  /** the alert under way came from an ally's shout (no shout of its own) */
  protected relayed = false;
  /** where it is going back to after a scene (set by `resume`) */
  protected resumeTo: string | null = null;
  protected disposed = false;

  constructor(o: CombatBrainOptions) {
    this.o = o;
    this.combat = o.combat;
    this.self = o.self;
    this.agent = o.agent;
    this.fighter = o.fighter;
    this.ai = o.ai ?? null;
    this.random = o.random ?? Math.random;
    this.clips = { ...HUMANOID_CLIPS, ...o.clips };
    this.group = o.group ?? null;
    this.keys = o.keys ?? [];
    this.circleR = (this.ring[0] + this.ring[1]) / 2;
    this.offs.push(this.combat.events.on((e) => this.onCombat(e)));
  }

  /** Subclasses: build the machine (their states plus `combatStates()`) and join the AI system. */
  protected start(states: Record<string, BrainState<CombatBrain>>, initial: string) {
    this.fsm = new Brain<CombatBrain>(states, initial, this);
    this.offs.push(this.fsm.onChange.on((c) => this.events.emit({ type: "state", from: c.from, to: c.to })));
    if (this.ai) this.offs.push(this.ai.add(this, { hz: this.o.hz ?? AI.hz }), this.ai.register(this));
  }

  /** The current state. */
  get state() {
    return this.fsm.state;
  }

  /** How aware it is, as the combat system asks (backstabs, sleeping beasts). */
  get awareness(): Awareness {
    if (!this.fsm) return "unaware";
    if (this.fsm.in("scripted")) return this.o.scriptedAwareness ?? "alert";
    if (this.fsm.in("combat") || this.fsm.in("dead") || this.fsm.in("surrender") || this.fsm.in("down")) return "alert";
    return this.calmAwareness();
  }

  /** Awareness while calm (subclasses: the sensor's level, asleep…). */
  protected calmAwareness(): Awareness {
    return "unaware";
  }

  /** The state to go to when there is nobody left to fight. */
  protected abstract calmState(): string;

  /** Whether it is in a fight now. */
  get fighting() {
    return this.fsm.in("combat");
  }

  /** One brain tick (the AI system calls it 10 times a second). */
  think(dt: number) {
    if (this.disposed) return;
    this.time += dt;
    this.updateFlights();
    this.fsm.update(dt);
  }

  // ---------------------------------------------------------------- outside control

  /** Into the fight now (an encounter starting, a scripted ambush), against `target` if given. */
  engage(target?: Combatant | null) {
    if (this.disposed || !this.self.active || this.fsm.in("scripted") || this.fsm.in("down")) return;
    if (target) {
      this.target = target;
      this.retargetAt = this.time + AI.target.every;
    }
    if (!this.fsm.in("combat")) this.fsm.go("alert");
  }

  /**
   * Alerted by an ally's shout or a scripted alarm (`at`: where the threat is). `relayed`: it heard
   * an ally's shout, so it does not shout on itself (an alert reaches the faction within 15 m of
   * whoever noticed, or the group, never a chain of guards across the map).
   */
  alert(at: XYZ | null = null, by: Combatant | null = null, o: { relayed?: boolean } = {}) {
    if (this.disposed || !this.self.active) return;
    // (nested: the sensor learning of it calls back in here)
    const outer = this.relayed;
    this.relayed = outer || !!o.relayed;
    try {
      this.onAlerted(at);
      this.engage(by);
    } finally {
      this.relayed = outer;
    }
  }

  /** Subclasses: the sensor learns too. */
  protected onAlerted(_at: XYZ | null) {}

  /**
   * Fight `c` (and only it) for `seconds` (Brun's roar pulls an enemy onto himself; E1's captain is
   * kept on the companion).
   */
  forceTarget(c: Combatant, seconds: number) {
    this.forced = { c, until: this.time + seconds };
    if (this.target !== c) {
      this.releaseToken();
      this.target = c;
    }
    this.retargetAt = this.time + AI.target.every;
  }

  /**
   * A cutscene has the body (design §3.6 `ai.suspend`): it stops fighting, lets go of the body and
   * waits. `untilHit`: the first blow it takes gives control back (E2's interrogator); `scope`:
   * resumed when the scope ends.
   */
  suspend(o: { untilHit?: boolean; scope?: DisposerSink } = {}) {
    if (this.disposed || this.fsm.in("dead")) return;
    this.untilHit = !!o.untilHit;
    if (!this.fsm.in("scripted")) this.resumeTo = this.fsm.in("combat") ? "approach" : null;
    this.fsm.go("scripted");
    o.scope?.add(() => this.resume());
  }

  /** Control back after a scene: into `state` (default: the fight it was in, else its calm state). */
  resume(state?: string) {
    if (this.disposed || !this.fsm.in("scripted")) return;
    this.untilHit = false;
    this.fsm.go(state ?? this.resumeTo ?? this.calmState());
  }

  get suspended() {
    return this.fsm.in("scripted");
  }

  // ---------------------------------------------------------------- combat events

  protected onCombat(e: CombatEvent) {
    if (this.disposed || !this.fsm) return;
    const me = this.self;
    switch (e.type) {
      case "windup":
        if (e.attacker !== me && this.combat.isHostile(e.attacker, me)) this.incoming(e.attacker, e.target);
        break;
      case "hit":
        if (e.hit.target === me && e.hit.attacker !== me) this.hitBy(e.hit);
        break;
      case "stagger":
        if (e.target === me && !this.fsm.in("dead") && !this.fsm.in("scripted")) {
          const calm = !this.fsm.in("combat");
          this.stagger = { seconds: e.seconds, clip: e.clip, push: e.push, from: e.from, knockdown: e.knockdown };
          this.fsm.go("stagger", { restart: true });
          // a first blow that staggers skips the alert state: its senses and allies still learn of it
          if (calm && this.fsm.in("combat")) {
            this.onAlerted(e.from);
            this.ai?.alertAllies(this, e.from, AI.alert.radius);
          }
        }
        break;
      case "death":
        if (e.target === me) {
          this.deathHit = e.hit;
          this.fsm.go("dead");
        }
        break;
      case "down":
        if (e.target === me) this.fsm.go("down");
        break;
      case "up":
        if (e.target === me && this.fsm.in("down")) this.fsm.go(this.afterDown());
        break;
      case "surrender":
        if (e.target === me) this.fsm.go("surrender");
        break;
    }
  }

  /** After getting up (essential): straight back into the fight, or calm. */
  protected afterDown() {
    return this.combat.enemiesOf(this.self).length ? "approach" : this.calmState();
  }

  /** Took a blow from `h.attacker`: remember it, and fight back. */
  protected hitBy(h: HitResult) {
    this.lastHitBy = { c: h.attacker, at: this.time };
    if (!this.self.active || this.fsm.in("dead")) return;
    if (this.fsm.in("scripted")) {
      if (!this.untilHit) return;
      this.resume("alert");
    }
    if (!this.fsm.in("combat") && this.combat.isHostile(h.attacker, this.self)) {
      this.onAlerted(h.attacker.pose);
      this.engage(h.attacker);
    }
  }

  /** A blow is coming (a wind-up started): maybe raise the guard. */
  protected incoming(attacker: Combatant, aimed: Combatant | null) {
    if (this.fighter.block <= 0 || !this.self.active || this.self.staggered) return;
    if (!(this.fsm.state === "approach" || this.fsm.state === "circle" || this.fsm.state === "alert" || (this.fsm.state === "recover" && this.recoverCancellable()))) return;
    const me = this.self.pose, a = attacker.pose;
    if (aimed && aimed !== this.self) return;
    if (!aimed) {
      // nobody in particular: only a swing in reach and pointed this way
      const d = dist(me, a);
      const reach = (attacker.swing?.attack.reach ?? 2) + this.self.radius + 0.5;
      const f = { x: -Math.sin(a.yaw), z: -Math.cos(a.yaw) };
      if (d > reach || (d > 1e-3 && ((me.x - a.x) * f.x + (me.z - a.z) * f.z) / d < 0.5)) return;
    }
    if (this.random() >= this.fighter.block) return;
    this.blockAgainst = attacker;
    this.fsm.go("block");
  }

  // ---------------------------------------------------------------- targets and tokens

  /** Its fighting distance to `c` (centre to centre, on the ground plane). */
  protected dist(c: Combatant) {
    return dist(this.agent.position, c.pose);
  }

  /** Choose whom to fight: the nearest, kept unless another is clearly nearer, the last attacker preferred, foes already crowded passed over. */
  protected pickTarget(): Combatant | null {
    const f = this.forced;
    if (f) {
      if (this.time < f.until && this.combat.has(f.c) && f.c.active && !f.c.down) return f.c;
      this.forced = null;
    }
    const me = this.self;
    let best: Combatant | null = null;
    let bestScore = Infinity;
    const giveUp = this.o.giveUp ?? 30;
    for (const c of this.combat.enemiesOf(me)) {
      if (c.down || (this.o.canTarget && !this.o.canTarget(c))) continue;
      const d = this.dist(c);
      if (d > giveUp || Math.abs(c.pose.y - this.agent.position.y) > 6) continue;
      let s = d + (this.o.preferTarget?.(c) ?? 0) + this.targetBias(c);
      if (c === this.target) s -= AI.target.sticky;
      if (this.combat.tokenOf(me) !== c && this.combat.tokenHolders(c).length >= c.tokenLimit) s += AI.target.fullTokens;
      if (this.lastHitBy?.c === c && this.time - this.lastHitBy.at < AI.target.lastHitFor) s -= AI.target.lastHit;
      if (s < bestScore) {
        bestScore = s;
        best = c;
      }
    }
    return best;
  }

  /** Subclasses: a check on every combat update (a leash, a fear, a special); a state name to leave for. */
  protected combatCheck(): string | void {}

  /** The state a special starts from (creatures that run in first: "charge"). */
  protected specialState() {
    return "attack";
  }

  /** Subclasses' extra target bias (the companion's preference for foes not on the player). */
  protected targetBias(_c: Combatant) {
    return 0;
  }

  /** Hold a token to attack the target (≤ 2 on the player, ≤ 1 on the companion). */
  protected token(): boolean {
    const t = this.target;
    return !!t && this.combat.requestToken(this.self, t);
  }

  protected releaseToken() {
    this.combat.releaseToken(this.self);
  }

  // ---------------------------------------------------------------- attacks

  /** The ring it keeps while waiting for its turn. */
  protected get ring(): readonly [number, number] {
    return this.fighter.ring ?? (this.fighter.kind === "creature" ? AI.creature.circle : AI.circle.ring);
  }

  /** How close it must be for `def` to land on `t`. */
  protected strikeDistance(def: AttackDef, t: Combatant) {
    const reachable = def.reach + t.radius - (this.fighter.kind === "creature" ? AI.creature.inset : 0.2);
    return this.fighter.kind === "creature" ? Math.max(0.8, reachable) : Math.max(0.8, Math.min(AI.approach.close, reachable));
  }

  /** Plan the next sequence: the special when in range and ready, a heavy now and then, else the light combo. */
  protected planAttack(d: number) {
    const f = this.fighter;
    const sp = f.special;
    if (sp && this.time >= this.specialReadyAt && d >= sp.range[0] && d <= sp.range[1]) {
      this.combo = [sp];
      this.specialReadyAt = this.time + sp.cooldown;
    } else if (f.heavy && ((f.heavyEvery && (this.sequences + 1) % f.heavyEvery === 0) || (f.heavyChance && this.random() < f.heavyChance))) {
      this.combo = [f.heavy];
    } else this.combo = [...f.light];
    this.comboIdx = 0;
  }

  /** A special is in range and ready now (the lunge from 4–6 m, the kick up close). */
  protected specialReady(d: number) {
    const sp = this.fighter.special;
    return !!sp && this.time >= this.specialReadyAt && this.time >= this.nextAttackAt && d >= sp.range[0] && d <= sp.range[1];
  }

  /** The attack that comes next (for the distance it needs). */
  protected nextDef(): AttackDef {
    return this.combo[this.comboIdx] ?? this.fighter.light[0];
  }

  private startSwing() {
    const def = this.nextDef();
    const t = this.target;
    this.lastDef = def;
    this.agent.stop();
    if (t) this.agent.face(() => t.pose);
    // (the system reports the wind-up rate from inside attack(), before the handle exists: the clip
    // and its root motion start below with that rate; later changes come through here)
    let handle: AttackHandle | null = null;
    const h = this.combat.attack(this.self, def, {
      target: t,
      onRate: (r) => {
        if (!handle) return;
        this.agent.setActRate(r);
        this.rideRootMotion(def, r, handle.time);
      },
    });
    handle = h;
    this.swing = h;
    if (!h) return;
    this.agent.act(def.clip, { speed: h.rate, blend: def.blend ?? 0.1, hold: true });
    this.rideRootMotion(def, h.rate, 0);
  }

  private rideRootMotion(def: AttackDef, rate: number, from: number) {
    const curve = this.o.rootMotion?.get(def.clip);
    if (!curve) return;
    const t = this.target;
    this.agent.rootMotion(curve, { speed: rate, from, target: t ? () => t.pose : undefined });
  }

  /** The recovery is far enough along to be cut short by a block. */
  protected recoverCancellable() {
    const rec = this.lastDef?.recover;
    if (!rec) return true;
    return this.fsm.elapsed("recover") * (rec.speed ?? AI.recoverRate) >= rec.cancel;
  }

  /** A sequence is over: the turn goes back, the next comes after the interval. */
  protected afterAttack(): string {
    this.releaseToken();
    this.combo = [];
    this.comboIdx = 0;
    this.sequences++;
    this.nextAttackAt = this.time + between(this.fighter.interval, this.random);
    return this.fighter.kind === "creature" ? "backoff" : "circle";
  }

  // ---------------------------------------------------------------- ranged

  private canShoot(t: Combatant) {
    const los = this.o.los;
    if (!los) return true;
    const a = this.agent.position;
    const b = t.pose;
    const from = { x: a.x, y: a.y + 1.5, z: a.z };
    const to = { x: b.x, y: b.y + t.chest, z: b.z };
    const dx = to.x - from.x, dy = to.y - from.y, dz = to.z - from.z;
    const d = Math.hypot(dx, dy, dz);
    if (d < 1e-3) return true;
    return sightClear(los, from, { x: dx / d, y: dy / d, z: dz / d }, d);
  }

  private loose() {
    const t = this.target;
    const r = this.fighter.ranged;
    if (!t || !r) return;
    const a = this.agent.position;
    const from = { x: a.x, y: a.y + 1.5, z: a.z };
    const aim = { x: t.pose.x, y: t.pose.y + t.chest, z: t.pose.z };
    const seconds = Math.hypot(aim.x - from.x, aim.y - from.y, aim.z - from.z) / r.speed;
    this.flights.push({ target: t, aim, arrive: this.time + seconds, def: r });
    this.events.emit({ type: "shoot", from, to: aim, seconds });
  }

  /** Arrows that arrived: a hit when the target is still near where it was aimed and in sight. */
  private updateFlights() {
    if (!this.flights.length) return;
    const now = this.time;
    const tol = AI.ranged.tolerance;
    this.flights = this.flights.filter((f) => {
      if (now < f.arrive) return true;
      const t = f.target;
      if (!this.combat.has(t) || t.vitals.dead) return false;
      const p = t.pose;
      const near = Math.hypot(p.x - f.aim.x, p.y + t.chest - f.aim.y, p.z - f.aim.z) <= tol;
      if (near && this.canShoot(t)) this.combat.strike(this.self, t, f.def);
      return false;
    });
  }

  // ---------------------------------------------------------------- the states

  /** The combat family and the external states every brain has. */
  protected combatStates(): Record<string, BrainState<CombatBrain>> {
    const S = (s: BrainState<CombatBrain>) => s;
    return {
      combat: S({
        enter: () => {
          this.retargetAt = 0;
          this.tokenAt = 0;
          this.agent.crouch = false;
        },
        update: () => {
          if (this.time >= this.retargetAt) {
            this.retargetAt = this.time + AI.target.every;
            const t = this.pickTarget();
            if (t !== this.target) {
              this.releaseToken();
              this.target = t;
            }
          }
          const t = this.target;
          if (!t || !t.active || t.down || !this.combat.has(t)) {
            this.target = null;
            const next = this.pickTarget();
            if (next) this.target = next;
            else return this.calmState();
          }
          // holders far from their target let others have the turn (2 Hz)
          if (this.time >= this.tokenAt) {
            this.tokenAt = this.time + AI.tokens.every;
            const held = this.combat.tokenOf(this.self);
            if (held && (held !== this.target || this.dist(held) > this.ring[1] + 3)) this.releaseToken();
          }
          return this.combatCheck();
        },
        exit: () => {
          this.releaseToken();
          this.agent.face(null);
          this.agent.stop();
          this.agent.stopRootMotion();
          // a swing's held last pose, a guard: the body goes back to its locomotion (the state
          // entered next plays its own clip, if any)
          if (this.agent.acting) this.agent.act(null);
        },
      }),
      alert: S({
        parent: "combat",
        enter: (_b, from) => {
          this.agent.stop();
          this.timer = from === null || from === "scripted" ? 0 : between(AI.alert.react, this.random);
          this.events.emit({ type: "bark", kind: "alert" });
          const t = this.target ?? this.pickTarget();
          if (!this.relayed) this.ai?.alertAllies(this, t ? t.pose : null, AI.alert.radius);
          if (this.timer > 0 && this.clips.alert && (from === "post" || from === "suspicious")) this.agent.act(this.clips.alert, { blend: 0.1 });
        },
        update: () => {
          const t = this.target;
          if (t) this.agent.face(() => t.pose);
          if (this.fsm.elapsed() >= this.timer) return "approach";
        },
        exit: () => {
          if (this.clips.alert && this.agent.acting === this.clips.alert) this.agent.act(null);
        },
      }),
      approach: S({ parent: "combat", update: () => this.approach() }),
      circle: S({
        parent: "combat",
        enter: () => {
          this.circleDir = this.random() < 0.5 ? 1 : -1;
          this.flipAt = this.time + between(AI.circle.flip, this.random);
          const t = this.target;
          const [r0, r1] = this.ring;
          this.circleR = t ? Math.min(r1, Math.max(r0, this.dist(t))) : (r0 + r1) / 2;
          this.timer = this.fighter.kind === "creature" ? between(AI.creature.circleFor, this.random) : 0;
        },
        update: () => this.circleUpdate(),
      }),
      attack: S({
        parent: "combat",
        enter: () => this.startSwing(),
        update: () => {
          const s = this.swing;
          if (!s) return this.afterAttack();
          // tracks the target through the wind-up, then commits
          if (s.time >= s.attack.active[0]) this.agent.face(this.agent.yaw);
          if (!s.finished) return;
          if (this.comboIdx + 1 < this.combo.length && this.target && !this.target.vitals.dead) {
            this.comboIdx++;
            this.fsm.go("attack", { restart: true });
            return;
          }
          return "recover";
        },
        exit: () => {
          if (this.swing && !this.swing.finished) this.swing.cancel();
          this.swing = null;
          this.agent.stopRootMotion();
        },
      }),
      recover: S({
        parent: "combat",
        enter: () => {
          const def = this.lastDef;
          const rec = def?.recover;
          this.timer = 0.15;
          if (!rec) {
            // no recovery clip (jab, kick, a creature's bite): the swing's held pose ends here
            if (def && this.agent.acting === def.clip) this.agent.act(null);
            return;
          }
          const rate = rec.speed ?? def?.speed ?? 1;
          const len = this.agent.act(rec.clip, { speed: rate, blend: rec.blend ?? 0.1 });
          this.timer = (len || rec.length) / Math.max(0.05, rate);
          const curve = this.o.rootMotion?.get(rec.clip);
          const t = this.target;
          if (curve) this.agent.rootMotion(curve, { speed: rate, target: t ? () => t.pose : undefined });
        },
        update: () => {
          if (this.fsm.elapsed() >= this.timer) return this.afterAttack();
        },
        exit: () => this.agent.stopRootMotion(),
      }),
      backoff: S({
        parent: "combat",
        enter: () => {
          this.timer = this.backoffFor ?? AI.creature.backoff / AI.creature.backoffSpeed;
          this.backoffFor = null;
        },
        update: () => {
          const t = this.target;
          if (!t) return "circle";
          const p = this.agent.position;
          this.agent.moveDir(p.x - t.pose.x, p.z - t.pose.z, AI.creature.backoffSpeed);
          this.agent.face(() => t.pose);
          if (this.fsm.elapsed() >= this.timer) return "circle";
        },
      }),
      block: S({
        parent: "combat",
        enter: () => {
          this.agent.stop();
          this.frozen = false;
          const shield = !!this.fighter.shield;
          this.agent.act(shield ? this.clips.shieldBlock : this.clips.block, { loop: shield, blend: 0.08, hold: true });
          this.combat.block(this.self, true);
          const a = this.blockAgainst;
          if (a) this.agent.face(() => a.pose);
        },
        update: () => {
          if (!this.fighter.shield && !this.frozen && this.fsm.elapsed() >= this.clips.blockFreeze) {
            this.frozen = true;
            this.agent.setActRate(0);
          }
          const s = this.blockAgainst?.swing;
          const t = this.fsm.elapsed();
          if (((!s || s.finished) && t > 0.3) || t > 2) return this.target && this.dist(this.target) > this.ring[1] + 0.5 ? "approach" : "circle";
        },
        exit: () => {
          this.combat.block(this.self, false);
          this.blockAgainst = null;
          this.agent.act(null);
        },
      }),
      stagger: S({
        parent: "combat",
        enter: () => this.enterStagger(),
        update: () => {
          if (this.fsm.elapsed() < this.timer) return;
          const s = this.stagger;
          if (s?.knockdown && !this.rising && this.agent.hasClip(this.clips.rise)) {
            this.rising = true;
            const len = this.agent.act(this.clips.rise, { speed: 1.2, blend: 0.15 });
            this.timer += len / 1.2;
            return;
          }
          return "approach";
        },
        exit: () => {
          this.rising = false;
          this.stagger = null;
          if (this.agent.acting) this.agent.act(null);
        },
      }),
      shoot: S({
        parent: "combat",
        enter: () => {
          this.agent.stop();
          this.shot = { glint: false, loosed: false };
          const t = this.target;
          if (t) this.agent.face(() => t.pose);
          this.agent.act(this.clips.draw, { loop: true, blend: 0.2 });
          this.timer = this.fighter.ranged?.draw ?? ARROW.draw;
        },
        update: () => {
          const t = this.target;
          const r = this.fighter.ranged;
          if (!t || !r) return "approach";
          const e = this.fsm.elapsed();
          if (!this.shot.loosed) {
            // came too close: the knife
            if (this.dist(t) < (this.fighter.melee ?? 4) - 0.5) return "approach";
            if (!this.shot.glint && e >= r.glint) {
              this.shot.glint = true;
              const p = this.agent.position;
              this.events.emit({ type: "glint", at: { x: p.x, y: p.y + 1.5, z: p.z } });
            }
            if (e >= this.timer) {
              this.shot.loosed = true;
              this.agent.act(this.clips.shoot, { blend: 0.05 });
              this.agent.face(this.agent.yaw);
              this.loose();
              this.nextAttackAt = this.time + between(this.fighter.interval, this.random);
            }
            return;
          }
          if (e >= this.timer + 0.6) return "approach";
        },
        exit: () => {
          if (this.agent.acting === this.clips.draw) this.agent.act(null);
        },
      }),
      dead: S({ enter: () => this.die() }),
      surrender: S({
        enter: () => {
          this.releaseToken();
          this.combat.block(this.self, false);
          this.agent.stop();
          this.agent.stopRootMotion();
          this.agent.face(null);
          this.agent.act(this.clips.surrender, { loop: true, blend: 0.3 });
          this.events.emit({ type: "bark", kind: "surrender" });
        },
      }),
      down: S({
        enter: () => {
          this.releaseToken();
          this.agent.stop();
          this.agent.stopRootMotion();
          this.agent.act(this.clips.down, { loop: true, blend: 0.25 });
          this.events.emit({ type: "bark", kind: "down" });
        },
        exit: () => {
          if (this.agent.acting === this.clips.down) this.agent.act(null);
        },
      }),
      scripted: S({
        enter: () => {
          this.releaseToken();
          this.swing?.cancel();
          this.combat.block(this.self, false);
          this.agent.stop();
          this.agent.stopRootMotion();
          this.agent.act(null);
          this.agent.suspended = true;
        },
        exit: () => {
          this.agent.suspended = false;
        },
      }),
    };
  }

  /** Close in: shoot from afar (archers), lunge from the special's range, strike with a turn, or hold on the ring. */
  protected approach(): string | void {
    const t = this.target;
    if (!t) return;
    const d = this.dist(t);
    const f = this.fighter;
    if (f.ranged && d > (f.melee ?? 4) && this.time >= this.nextAttackAt && this.canShoot(t)) return "shoot";
    if (f.ranged && d > (f.melee ?? 4)) {
      // waiting to shoot again: hold position, watching
      this.agent.stop();
      this.agent.face(() => t.pose);
      return;
    }
    const ready = this.time >= this.nextAttackAt;
    if (ready && this.specialReady(d) && this.token()) {
      this.planAttack(d);
      return this.specialState();
    }
    if (ready && this.token()) {
      if (!this.combo.length) this.planAttack(Infinity);
      const reach = this.strikeDistance(this.nextDef(), t);
      if (d <= reach) return "attack";
      const speed = f.kind === "creature" ? (f.speed?.move ?? 3) : d > AI.approach.jogUntil ? AI.approach.jog : AI.approach.walk;
      this.agent.moveTo(() => t.pose, speed, reach - 0.15);
      this.agent.face(d < 6 ? () => t.pose : null);
      return;
    }
    const [, r1] = this.ring;
    if (d <= r1 + 0.5) return "circle";
    const speed = f.kind === "creature" ? (f.speed?.move ?? 3) : AI.approach.jog;
    this.agent.moveTo(() => t.pose, speed, (this.ring[0] + r1) / 2);
    this.agent.face(d < 6 ? () => t.pose : null);
  }

  /** Strafe on the ring, asking for a turn twice a second once the interval has passed. */
  protected circleUpdate(): string | void {
    const t = this.target;
    if (!t) return;
    const d = this.dist(t);
    const [r0, r1] = this.ring;
    if (d > r1 + 1.5) return "approach";
    if (this.time >= this.flipAt) {
      this.circleDir = this.circleDir === 1 ? -1 : 1;
      this.flipAt = this.time + between(AI.circle.flip, this.random);
    }
    // a foe that closed in pushes the ring out again (never inside r0)
    this.circleR = Math.min(r1, Math.max(r0, this.circleR));
    const speed = this.fighter.kind === "creature" ? Math.min(this.fighter.speed?.move ?? 3, 2) : AI.circle.speed;
    this.agent.circle(() => t.pose, this.circleR, this.circleDir, speed);
    this.agent.face(() => t.pose);
    if (this.fighter.ranged && d > (this.fighter.melee ?? 4)) return "approach";
    const ready = this.time >= this.nextAttackAt && this.fsm.elapsed() >= this.timer;
    if (!ready || this.time < this.askAt) return;
    this.askAt = this.time + AI.tokens.every;
    if (this.specialReady(d) && this.token()) {
      this.planAttack(d);
      return this.specialState();
    }
    if (this.token()) return "approach";
  }

  protected enterStagger() {
    const s = this.stagger;
    this.timer = s?.seconds ?? STAGGER.humanoid.seconds;
    this.rising = false;
    this.agent.stop();
    this.agent.stopRootMotion();
    if (!s) return;
    let push = s.push;
    if (this.fighter.kind === "creature") {
      // creatures reel procedurally: pushed 0.6 m away from the blow and rocked for 0.3 s
      if (!push && s.from) {
        const p = this.agent.position;
        const dx = p.x - s.from.x, dz = p.z - s.from.z;
        const l = Math.hypot(dx, dz) || 1;
        push = { x: (dx / l) * STAGGER.creature.push, z: (dz / l) * STAGGER.creature.push };
      }
      this.agent.wobble(STAGGER.creature.wobble);
      if (s.clip) this.agent.act(s.clip, { hold: true, blend: 0.08 });
    } else if (s.clip) this.agent.act(s.clip, { hold: true, blend: 0.08 });
    if (push) this.agent.shove(push.x, push.z, 0.3);
  }

  /** Dead: a ragdoll while the budget allows (never for a backstab), else a death clip; the capsule goes. */
  protected die() {
    const hit = this.deathHit;
    this.releaseToken();
    this.flights = [];
    this.combat.block(this.self, false);
    this.agent.stop();
    this.agent.stopRootMotion();
    this.agent.face(null);
    let ragdoll = false;
    if (this.o.ragdoll && hit?.outcome !== "backstab" && (this.ai?.ragdollSlot() ?? true)) {
      try {
        ragdoll = this.o.ragdoll(hit);
      } catch (e) {
        console.error("ragdoll", e);
      }
    }
    if (!ragdoll) {
      const clip = hit?.outcome === "backstab" ? this.clips.backstabDeath : this.clips.death[Math.floor(this.random() * this.clips.death.length)];
      this.agent.act(clip, { hold: true, blend: 0.12 });
    } else this.agent.act(null);
    this.agent.release();
    this.events.emit({ type: "died", hit, ragdoll });
  }

  /** Stop thinking and listening (the agent and combatant are the owner's). */
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.releaseToken();
    for (const off of this.offs) off();
    this.offs = [];
    this.fsm?.dispose();
    this.events.clear();
  }
}

const rayFrom = new Vector3();
const rayDir = new Vector3();

/** A static ray is clear for `d` m. */
function sightClear(los: SightRay, from: XYZ, dir: XYZ, d: number) {
  return los.rayCastStatic(rayFrom.set(from.x, from.y, from.z), rayDir.set(dir.x, dir.y, dir.z), d) >= d - 0.05;
}

/** The yaw from `a` toward `b`. */
export function yawFrom(a: XZ, b: XZ) {
  return yawOf(b.x - a.x, b.z - a.z);
}
