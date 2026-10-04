import { assets } from "../core/assets/AssetClient";
import { audio } from "../core/audio";
import { hud, lowHealth } from "../ui/hud";
import type { CombatEvent, Combatant } from "../engine/combat/CombatSystem";
import type { PlayerCombatEvent } from "../engine/combat/PlayerCombat";
import type { DamageResult } from "../engine/combat/vitals";
import type { ArchetypeId } from "../engine/combat/attacks";
import type { Disposer } from "../engine/core/types";

/** The combat tips of the teaching ladder that come from the fighting itself (design §7, §8). */
export const COMBAT_TIPS = {
  /** the first wind-up aimed at the player (with 0.4× slow motion for 0.5 s) */
  block: { id: "combat.block", text: "按住 右键 格挡" },
  /** the first draw */
  draw: { id: "combat.draw", text: "左键 轻击（连按连招）· 按住左键 重击" },
  /** the first block */
  parry: { id: "combat.parry", text: "在对方出手的一瞬间格挡＝招架，可令其踉跄" },
  /** stamina below 25 */
  stamina: { id: "combat.stamina", text: "耐力不足时无法重击，格挡也更容易被破" },
} as const;

/**
 * The names the target bar shows for the combat archetypes (design §8's table). A chapter passes
 * one as the combatant's `label` (`system.add({ ..., label: ENEMY_LABELS.soldier })`); `name()`
 * overrides it for one combatant (奥斯维克 once he has been introduced).
 */
export const ENEMY_LABELS: Record<ArchetypeId, string> = {
  shieldSoldier: "帝国盾兵",
  guardCaptain: "帝国守卫长",
  soldier: "帝国士兵",
  axeman: "霜誓军斧手",
  axeLeader: "霜誓军头目",
  interrogator: "审讯官",
  assistant: "审讯助手",
  jailer: "狱卒",
  archer: "弓手",
  smallSpider: "小洞蛛",
  giantSpider: "洞穴巨蛛",
  wolf: "巨狼",
};

/** The target bar's name for a combatant nobody named (no `label`, no `name()`), by faction. */
export const FACTION_LABELS: Record<string, string> = {
  imperial: "帝国士兵",
  rebel: "霜誓军",
  beast: "野兽",
};

/** The first wind-up at the player slows time this much for this long (real seconds). */
const FIRST_WINDUP = { scale: 0.4, seconds: 0.5 };
/** seconds the target bar stays after the last blow between the player and the target */
const TARGET_LINGER = 8;
/** seconds a dead target's or boss's empty bar stays */
const DEAD_LINGER = 1.4;
/** the heartbeat loop (design §10.4: no source picked yet, so it ships silent until the id exists) */
const HEARTBEAT = "audio/sfx_heartbeat";

/** What the binder reads from the prologue's combat (`PrologueCombat` fits). */
export interface CombatHudSource {
  readonly system: { readonly events: { on(fn: (e: CombatEvent) => void): Disposer } };
  readonly player: Combatant;
  readonly controls: { readonly events: { on(fn: (e: PlayerCombatEvent) => void): Disposer } };
}

export interface CombatHudOptions {
  combat: CombatHudSource;
  /** a weapon is drawn (the vitals stay up) */
  armed(): boolean;
  /** per-frame updates on game time (the world's onUpdate) */
  bus: { onUpdate(fn: (dt: number) => void): () => unknown };
  /** game-time slow motion for the first wind-up (the stage's TimeScale) */
  time?: { hold(scale: number, seconds: number): Disposer };
  /** the combat tips (default true) */
  tips?: boolean;
  /**
   * the target bar's name for a combatant with neither a `name()` nor a spec `label` (default: by
   * faction, `FACTION_LABELS`); null: no bar for it
   */
  fallbackName?(c: Combatant): string | null;
}

/**
 * The combat HUD of the prologue (design §3.7), driven by the player's combat:
 * - vitals: the player's health and stamina bars (shown while armed or changing, 3 s fade);
 * - damage: the red edge on every blow (and venom), the heartbeat below 30 % health;
 * - target: the health of the enemy the player is fighting, under its name: `name()`, else the
 *   spec's `label` (`ENEMY_LABELS`), else its faction's (`FACTION_LABELS`);
 * - boss: a tracked combatant's bar (`boss(c, "洞穴巨蛛")`) until it dies;
 * - death: 你倒下了…… while the player is dead (the encounter's retry gets them up again);
 * - tips: block (first wind-up at the player, with a moment of slow motion), draw, parry, stamina.
 * Made with the combat by `PrologueStage.ensureCombat()` (`stage.combatHud`).
 */
export class CombatHud {
  private names = new Map<unknown, string>();
  private target: { c: Combatant; t: number } | null = null;
  private bossOf: { c: Combatant; name: string; deadFor: number } | null = null;
  private dead = false;
  private beating = false;
  private offs: (() => unknown)[] = [];
  private disposed = false;

  constructor(private o: CombatHudOptions) {
    const c = o.combat;
    this.offs.push(
      o.bus.onUpdate((dt) => this.update(dt)),
      c.system.events.on((e) => this.onCombat(e)),
      c.controls.events.on((e) => this.onControls(e)),
      c.player.vitals.onDamage.on((d) => this.onDamage(d)),
    );
  }

  /** The name the target bar shows for a combatant (or its id), over its spec's `label`. */
  name(c: Combatant | string, label: string) {
    this.names.set(typeof c === "string" ? c : c.id, label);
  }

  /** The name the bars show for `c` (see `name`), or null for none. */
  nameOf(c: Combatant): string | null {
    const n = this.names.get(c.id) ?? c.spec.label;
    if (n) return n;
    return this.o.fallbackName ? this.o.fallbackName(c) : (FACTION_LABELS[c.faction] ?? null);
  }

  /** Track `c` on the boss bar under `name` (null: hide it). The bar empties and goes when it dies. */
  boss(c: Combatant | null, name?: string) {
    if (!c) {
      this.bossOf = null;
      hud.boss(null);
      return;
    }
    const label = name ?? this.nameOf(c) ?? "";
    this.bossOf = { c, name: label, deadFor: 0 };
    if (name) this.name(c, name);
  }

  /** Forget the target and boss (a fight ended, a chapter moved on). */
  clear() {
    this.target = null;
    this.bossOf = null;
    hud.target(null);
    hud.boss(null);
  }

  private update(dt: number) {
    if (this.disposed) return;
    const me = this.o.combat.player;
    const v = me.vitals;
    hud.vitals({ hp: v.hpFrac, st: v.stFrac }, { armed: this.o.armed(), dt });
    // the heartbeat's sound, once the build ships one
    const low = lowHealth(v.hpFrac);
    if (low !== this.beating) {
      this.beating = low;
      if (low && assets.has(HEARTBEAT)) void audio.startBed("heartbeat", HEARTBEAT, 0.6, 0.3, "sfx").catch(() => {});
      else if (!low) audio.stopBed("heartbeat", 0.6);
    }
    if (this.dead && !v.dead) {
      // got up again (an encounter's retry, a script)
      this.dead = false;
      hud.death(false);
    }
    if (this.o.tips !== false && this.o.armed() && v.st < 25 && !v.dead) hud.tip(COMBAT_TIPS.stamina.id, COMBAT_TIPS.stamina.text);
    this.updateBoss(dt);
    this.updateTarget(dt);
  }

  private updateBoss(dt: number) {
    const b = this.bossOf;
    if (!b) return;
    if (b.c.vitals.dead) b.deadFor += dt;
    if (b.deadFor > DEAD_LINGER || this.dead) {
      if (b.deadFor > DEAD_LINGER) this.bossOf = null;
      hud.boss(null);
      return;
    }
    hud.boss(b.name, b.c.vitals.hpFrac);
  }

  private updateTarget(dt: number) {
    const t = this.target;
    if (!t) return;
    t.t += dt;
    const c = t.c;
    const name = this.nameOf(c);
    const linger = c.vitals.dead ? DEAD_LINGER : TARGET_LINGER;
    // (the boss has its own bar)
    if (t.t > linger || this.dead || !name || this.bossOf?.c === c) {
      if (t.t > linger) this.target = null;
      hud.target(null);
      return;
    }
    hud.target(name, c.vitals.hpFrac);
  }

  private onCombat(e: CombatEvent) {
    const me = this.o.combat.player;
    if (e.type === "hit") {
      const h = e.hit;
      if (h.attacker === me && h.target !== me) this.aim(h.target);
      else if (h.target === me && h.attacker !== me && (!this.target || this.target.c.defeated)) this.aim(h.attacker);
    } else if (e.type === "windup" && e.target === me && e.attacker !== me && this.o.tips !== false) {
      // the first blow coming at the player: a moment to see it, and how to answer it
      if (hud.tip(COMBAT_TIPS.block.id, COMBAT_TIPS.block.text)) this.o.time?.hold(FIRST_WINDUP.scale, FIRST_WINDUP.seconds);
    } else if (e.type === "death" && this.target?.c === e.target) {
      this.target.t = 0;
    }
  }

  private aim(c: Combatant) {
    if (this.target?.c === c) this.target.t = 0;
    else this.target = { c, t: 0 };
  }

  private onControls(e: PlayerCombatEvent) {
    const tips = this.o.tips !== false;
    if (e.type === "draw" && tips) hud.tip(COMBAT_TIPS.draw.id, COMBAT_TIPS.draw.text);
    else if (e.type === "block" && e.on && tips) hud.tip(COMBAT_TIPS.parry.id, COMBAT_TIPS.parry.text);
    else if (e.type === "death") {
      this.dead = true;
      hud.death(true);
      hud.target(null);
      hud.boss(null);
    }
  }

  private onDamage(d: DamageResult) {
    if (d.damage > 0) hud.damage(Math.min(1, 0.35 + d.damage / 25));
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    for (const off of this.offs) off();
    this.offs = [];
    if (this.beating) audio.stopBed("heartbeat", 0.3);
    this.beating = false;
    if (this.dead) hud.death(false);
    hud.vitals(null);
    this.clear();
  }
}
