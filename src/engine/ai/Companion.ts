/**
 * The companion's brain (keep/exit design §3.6 "Companion", §7, §8): out of combat it follows the
 * player's breadcrumbs (2.5 m behind; 1.4 / 2.2 / 3.6 m/s by distance; stops within 4 m of a
 * player standing still), crouch-walks at 0.9 m/s while the player sneaks or in a stealth zone, and
 * catches up by appearing on the trail 6 m behind the player, out of view, when it falls more than
 * 25 m behind unseen or is stuck for 4 s. When alert enemies are near it fights (`CombatBrain`),
 * preferring enemies that are not on the player, with its special (Brun's roar, Ivo's shield
 * wall). It never gives the player away: it takes on only enemies that are alert (never a guard at
 * his post, a sleeping beast or one walking home on its leash) and near the player or itself, and
 * drops a fight the player has left behind to follow again (where the catch-up can bring it
 * along). It is essential: at 0 HP it kneels for 6 s and gets up at 50 % (the combat system's
 * `essential` with the `down` state here).
 */
import type { CompanionTuning } from "../combat/attacks";
import type { Awareness, Combatant } from "../combat/CombatSystem";
import type { XYZ } from "../combat/hit";
import { Breadcrumbs, FOLLOW, followSpeed, shouldCatchUp, type FollowTarget } from "./breadcrumbs";
import { CombatBrain, type CombatBrainOptions } from "./CombatBrain";
import type { BrainState } from "./Brain";

/** The player as the companion follows and protects them. */
export interface Leader {
  /** feet */
  position(): XYZ;
  grounded(): boolean;
  moving(): boolean;
  sneaking(): boolean;
  /** the player's combatant (whom the specials protect) */
  readonly combatant: Combatant | null;
}

export interface CompanionOptions extends CombatBrainOptions {
  leader: Leader;
  /** whether a point is in the camera's view (catch-up teleports happen only out of view; default: never in view) */
  visible?(p: XYZ): boolean;
  /** its special (§7) from its tuning (null: none) */
  special?: CompanionTuning["special"] | null;
  /** fights alert enemies within this of the player or itself (m; default 15) */
  engageRange?: number;
  /** drops a fight with an enemy further than this from the player (m; default 20: the player left) */
  leaveRange?: number;
}

/** The specials (§7). */
export const SPECIALS = {
  /** Brun: an enemy engaged with the player ≥ 8 s, or the player under 35 % HP → that enemy fights Brun for 6 s */
  roar: "roar",
  /** Ivo: the player under 30 % HP → he steps between the player and the nearest attacker and blocks for 4 s */
  shieldWall: "shieldWall",
} as const;

export class Companion extends CombatBrain {
  readonly trail = new Breadcrumbs();
  /** a stealth zone: crouch whatever the player does */
  stealth = false;
  /** stay here (null: follow) */
  holdAt: (XYZ & { yaw?: number }) | null = null;
  private leader: Leader;
  private copts: CompanionOptions;
  private specialAt = -Infinity;
  /** since when each enemy has held a turn on the player (brain time) */
  private onPlayer = new Map<Combatant, number>();
  /** the attacker the shield wall is against */
  private wallAgainst: Combatant | null = null;
  /** following: since when it has made no progress along the trail (see `trackProgress`) */
  private progress = { trying: false, crumb: -1, along: Infinity, since: 0 };
  /** the enemies fighting the player, worked out once per think */
  private engagedCache: { at: number; set: Set<Combatant> } | null = null;

  constructor(o: CompanionOptions) {
    super({ glint: false, ...o });
    this.copts = o;
    this.leader = o.leader;
    this.trail.reset(o.leader.position());
    this.start({ ...this.combatStates(), ...this.companionStates() }, "follow");
  }

  protected calmState() {
    return this.holdAt ? "wait" : "follow";
  }

  /** Never caught unawares (no backstab or sneak attack on it): it is the player's ally, not a mark. */
  protected calmAwareness(): Awareness {
    return "alert";
  }

  /** Stay at `at` (null: follow again). */
  hold(at: (XYZ & { yaw?: number }) | null) {
    this.holdAt = at ? { ...at } : null;
    if (this.fsm.in("calm")) this.fsm.go(this.calmState());
  }

  /** Put it at `p` (a checkpoint, a scripted catch-up); the trail starts over at the player. */
  place(p: XYZ, yaw?: number) {
    this.agent.teleport(p, yaw);
    this.trail.reset(this.leader.position());
    this.progress.trying = false;
  }

  /** Clean and calm again (an encounter's retry), the trail starting over at the player. */
  reset() {
    super.reset();
    this.trail.reset(this.leader.position());
    this.progress.trying = false;
    this.onPlayer.clear();
    this.wallAgainst = null;
  }

  /**
   * Foes already fighting the player rank behind the others (§3.6: prefers enemies not on the
   * player). "Fighting the player" is the enemy brain's target, which holds between swings
   * (tokens come and go with every sequence and would flip its choice back and forth).
   */
  protected targetBias(c: Combatant) {
    const p = this.leader.combatant;
    return p && this.engaged(p).has(c) ? 3 : 0;
  }

  /**
   * Whom it may fight (§7: the companion never gives the player away): an enemy that is alert
   * (not a guard unaware at his post, a sleeping or stirring beast, or one leashed home), not in a
   * scene, within `engageRange` of the player or itself; kept while within `leaveRange` of the
   * player. A forced target (its special, a script) need not be alert, but is dropped all the
   * same once the player has left it behind.
   */
  protected canFight(c: Combatant, o: { current?: boolean; forced?: boolean } = {}) {
    if (!super.canFight(c, o)) return false;
    const lp = this.leader.position();
    const toPlayer = Math.hypot(c.pose.x - lp.x, c.pose.z - lp.z);
    if (toPlayer > (this.copts.leaveRange ?? 20)) return false;
    if (o.forced) return true;
    if ((c.spec.awareness?.() ?? "alert") !== "alert") return false;
    if (this.ai?.brainOf(c)?.suspended) return false;
    if (o.current) return true;
    const range = this.copts.engageRange ?? 15;
    return toPlayer <= range || this.dist(c) <= range;
  }

  /** Someone to fight: time to. */
  private threatened() {
    return this.pickTarget() !== null;
  }

  /**
   * Fights only whom it may (a blow from a beast the player has left behind does not hold it
   * back). A script that wants it on someone regardless uses `forceTarget(c, seconds)`.
   */
  engage(target?: Combatant | null) {
    if (target && this.forced?.c !== target && !this.canFight(target)) return;
    super.engage(target);
  }

  think(dt: number) {
    if (this.disposed) return;
    const lp = this.leader.position();
    this.trail.drop(lp, this.leader.grounded());
    super.think(dt);
  }

  /** The special, when its moment has come (checked every combat update). */
  protected combatCheck(): string | void {
    const sp = this.copts.special;
    const player = this.leader.combatant;
    if (!sp || !player) return;
    // who has been fighting the player, since when (tokens come and go between swings; the fight
    // is the brain's target; without an AI system, the token holders)
    const engaged = this.engaged(player);
    for (const c of [...this.onPlayer.keys()]) if (!engaged.has(c)) this.onPlayer.delete(c);
    for (const c of engaged) if (!this.onPlayer.has(c)) this.onPlayer.set(c, this.time);
    if (this.time < this.specialAt || player.vitals.dead) return;
    const low = player.vitals.hpFrac < sp.hpBelow;
    if (sp.name === SPECIALS.roar) {
      let pick: Combatant | null = null;
      let longest = 0;
      for (const [c, since] of this.onPlayer) {
        const held = this.time - since;
        if (held > longest) {
          longest = held;
          pick = c;
        }
      }
      if (!pick || !(low || (sp.engagedFor !== undefined && longest >= sp.engagedFor))) return;
      const brain = this.ai?.brainOf(pick);
      if (!brain) return;
      this.specialAt = this.time + sp.cooldown;
      this.combat.releaseToken(pick);
      brain.forceTarget(this.self, sp.seconds);
      this.onPlayer.delete(pick);
      this.forceTarget(pick, sp.seconds);
      this.events.emit({ type: "bark", kind: "special" });
      return;
    }
    if (sp.name === SPECIALS.shieldWall && low && this.fsm.state !== "guard") {
      const attacker = this.nearestTo(player);
      if (!attacker) return;
      this.specialAt = this.time + sp.cooldown;
      this.wallAgainst = attacker;
      this.events.emit({ type: "bark", kind: "special" });
      return "guard";
    }
  }

  /** Enemies fighting the player now (once per think). */
  private engaged(player: Combatant) {
    const k = this.engagedCache;
    if (k && k.at === this.time) return k.set;
    const set = this.engagedWith(player);
    this.engagedCache = { at: this.time, set };
    return set;
  }

  /** Enemies fighting `c` now. */
  private engagedWith(c: Combatant) {
    const out = new Set<Combatant>(this.combat.tokenHolders(c));
    for (const b of this.ai?.brains ?? []) {
      if (b.target === c && b.fighting && b.self.active && this.combat.isHostile(b.self, this.self)) out.add(b.self);
    }
    return out;
  }

  private nearestTo(c: Combatant) {
    let best: Combatant | null = null;
    let bd = Infinity;
    for (const e of this.combat.enemiesOf(this.self)) {
      if (e.down) continue;
      const d = Math.hypot(e.pose.x - c.pose.x, e.pose.z - c.pose.z);
      if (d < bd) {
        bd = d;
        best = e;
      }
    }
    return best;
  }

  private companionStates(): Record<string, BrainState<CombatBrain>> {
    return {
      calm: {
        update: () => {
          if (this.threatened()) return "alert";
        },
      },
      follow: { parent: "calm", update: () => this.follow() },
      wait: {
        parent: "calm",
        update: () => {
          const h = this.holdAt;
          if (!h) return "follow";
          const me = this.agent.position;
          if (Math.hypot(h.x - me.x, h.z - me.z) > 0.4) {
            this.agent.moveTo(h, FOLLOW.walk, 0.1);
            this.agent.face(null);
          } else {
            this.agent.stop();
            if (h.yaw !== undefined) this.agent.face(h.yaw);
            else this.agent.face(() => this.leader.position());
          }
          this.agent.crouch = this.stealth || this.leader.sneaking();
        },
      },
      guard: {
        parent: "combat",
        enter: () => {
          const sp = this.copts.special;
          const a = this.wallAgainst;
          this.timer = sp?.seconds ?? 4;
          if (a) {
            this.ai?.brainOf(a)?.forceTarget(this.self, this.timer);
            this.combat.releaseToken(a);
          }
          this.agent.act(this.fighter.shield ? this.clips.shieldBlock : this.clips.block, { loop: !!this.fighter.shield, blend: 0.1, hold: true });
          this.frozen = false;
        },
        update: () => {
          const a = this.wallAgainst;
          const p = this.leader.position();
          if (a && a.active) {
            // between the player and the attacker, 1.2 m out from the player
            const dx = a.pose.x - p.x, dz = a.pose.z - p.z;
            const l = Math.hypot(dx, dz) || 1;
            this.agent.moveTo({ x: p.x + (dx / l) * 1.2, z: p.z + (dz / l) * 1.2 }, FOLLOW.walk, 0.15);
            this.agent.face(() => a.pose);
          } else this.agent.stop();
          if (!this.self.blocking) this.combat.block(this.self, true);
          if (!this.fighter.shield && !this.frozen && this.fsm.elapsed() >= this.clips.blockFreeze) {
            this.frozen = true;
            this.agent.setActRate(0);
          }
          if (this.fsm.elapsed() >= this.timer) return "approach";
        },
        exit: () => {
          this.combat.block(this.self, false);
          this.wallAgainst = null;
          this.agent.act(null);
        },
      },
    };
  }

  /** Walk the trail, crouch with the player, catch up when far behind. */
  private follow() {
    const L = this.leader;
    const lp = L.position();
    const me = this.agent.position;
    const sneak = this.stealth || L.sneaking();
    this.agent.crouch = sneak;
    const straight = Math.hypot(lp.x - me.x, lp.z - me.z);
    const t = this.trail.next(me, lp);
    const speed = followSpeed(t?.along ?? straight, { leaderMoving: L.moving(), stealth: sneak });
    this.trackProgress(t, !!t && !t.arrived && speed > 0);
    if (shouldCatchUp(straight, this.copts.visible?.(me) ?? false, Math.max(this.agent.stuckFor, this.noProgressFor))) {
      if (this.catchUp(lp)) return;
    }
    if (!t || t.arrived || speed <= 0) {
      this.agent.stop();
      if (straight < 10) this.agent.face(() => this.leader.position());
      return;
    }
    // along the trail at full speed (the next crumb is always ahead), easing in at the end
    const end = t.along - FOLLOW.behind < 1.5;
    this.agent.moveTo(t.point, speed, 0, end ? 0.6 : 0);
    this.agent.face(null);
  }

  /**
   * Stuck is "trying to follow and getting nowhere": no crumb further along (2 crumbs, 1 m) and no
   * metre closer to the player for `FOLLOW.catchUp.stuck` s. (Sliding along a wall is movement but
   * not progress; keeping pace with a walking player is progress.)
   */
  private trackProgress(t: FollowTarget | null, trying: boolean) {
    const p = this.progress;
    if (!t || !trying) {
      p.trying = false;
      return;
    }
    if (!p.trying || t.progress >= p.crumb + 2 || t.along <= p.along - 1) {
      p.trying = true;
      p.crumb = t.progress;
      p.along = t.along;
      p.since = this.time;
    }
  }

  /** Seconds it has been trying to follow without getting anywhere. */
  get noProgressFor() {
    return this.progress.trying ? this.time - this.progress.since : 0;
  }

  /** Appear on the trail 6–14 m behind the player, out of view. True when it did. */
  private catchUp(lp: XYZ) {
    const c = FOLLOW.catchUp;
    const spots = this.trail.behindLeader(lp, c.behind, c.maxBehind);
    const spot = spots.find((p) => !(this.copts.visible?.(p) ?? false));
    if (!spot) return false;
    this.agent.teleport({ x: spot.x, y: spot.y + 0.05, z: spot.z });
    this.agent.face(() => this.leader.position());
    this.progress.trying = false;
    this.events.emit({ type: "caughtUp", at: { x: spot.x, y: spot.y, z: spot.z } });
    return true;
  }
}
