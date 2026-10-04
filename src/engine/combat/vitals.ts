import { Emitter } from "../core/emitter";

/** One gauge: its value, its cap, and how it refills (per second, after `regenDelay` s without a drain). */
export interface Vital {
  value: number;
  max: number;
  regen: number;
  regenDelay: number;
}

export interface VitalsOptions {
  /** hit points (also the max) */
  health: number;
  /** out-of-combat regeneration (HP/s; default 0: none) */
  healthRegen?: number;
  /** seconds without damage before it starts (default 6) */
  healthDelay?: number;
  /** stamina (default 100) */
  stamina?: number;
  /** stamina/s once `staminaDelay` has passed since the last spend (default 24) */
  staminaRegen?: number;
  /** default 0.8 s */
  staminaDelay?: number;
  /** stamina/s while blocking (default 12) */
  blockRegen?: number;
  /** poise (default 50): poise damage at or past it staggers */
  poise?: number;
  /** poise refills fully this long after the last poise damage (default 2 s) */
  poiseDelay?: number;
  /** multiplier on damage taken (armour; default 1) */
  armourMul?: number;
}

/** A blow as the vitals see it: damage before armour, poise damage. */
export interface DamageInput {
  damage: number;
  /** poise damage (default 0) */
  poise?: number;
  /** apply `armourMul` (default true) */
  armour?: boolean;
}

export interface DamageResult {
  /** HP actually taken (after armour, capped at what was left) */
  damage: number;
  /** poise broke */
  staggered: boolean;
  /** this blow took the last HP */
  killed: boolean;
}

/** What an encounter restores on a retry. */
export interface VitalsState {
  hp: number;
  maxHp: number;
  st: number;
  poise: number;
}

/** What the gauges are doing this update. */
export interface VitalsUpdate {
  /** in combat: no health regeneration */
  combat?: boolean;
  /** blocking: stamina refills at the block rate */
  blocking?: boolean;
}

/**
 * Health, stamina and poise of one combatant, with their refill rules (design §8): stamina comes
 * back 0.8 s after the last spend (slower while blocking), poise refills 2 s after the last hit,
 * health only regenerates out of combat. Damage goes through the armour multiplier. Runs on game
 * time (`update(dt)`).
 */
export class Vitals {
  readonly health: Vital;
  readonly stamina: Vital;
  readonly poise: Vital;
  armourMul: number;
  /** stamina/s while blocking */
  blockRegen: number;
  /** any gauge changed (HUD bars) */
  readonly onChange = new Emitter<Vitals>();
  /** a blow landed (after armour) */
  readonly onDamage = new Emitter<DamageResult>();
  /** HP reached 0 (once until revived) */
  readonly onDeath = new Emitter<void>();
  /** seconds since the last damage / stamina spend / poise damage */
  private since = { health: Infinity, stamina: Infinity, poise: Infinity };
  private heals: { left: number; rate: number }[] = [];
  private dots: { left: number; rate: number }[] = [];
  private deadFlag = false;

  constructor(o: VitalsOptions) {
    this.health = { value: o.health, max: o.health, regen: o.healthRegen ?? 0, regenDelay: o.healthDelay ?? 6 };
    const st = o.stamina ?? 100;
    this.stamina = { value: st, max: st, regen: o.staminaRegen ?? 24, regenDelay: o.staminaDelay ?? 0.8 };
    const po = o.poise ?? 50;
    this.poise = { value: po, max: po, regen: Infinity, regenDelay: o.poiseDelay ?? 2 };
    this.blockRegen = o.blockRegen ?? 12;
    this.armourMul = o.armourMul ?? 1;
  }

  get hp() {
    return this.health.value;
  }
  /** Set HP directly (clamped); 0 kills. */
  set hp(v: number) {
    this.health.value = clamp(v, 0, this.health.max);
    if (this.health.value > 0) this.deadFlag = false;
    this.changed();
    this.checkDeath();
  }
  get maxHp() {
    return this.health.max;
  }
  get st() {
    return this.stamina.value;
  }
  get maxSt() {
    return this.stamina.max;
  }
  get hpFrac() {
    return this.health.max > 0 ? this.health.value / this.health.max : 0;
  }
  get stFrac() {
    return this.stamina.max > 0 ? this.stamina.value / this.stamina.max : 0;
  }
  get dead() {
    return this.health.value <= 0;
  }
  /** Seconds since the last damage taken. */
  get sinceDamage() {
    return this.since.health;
  }

  /** Take a blow: armour, then HP; poise damage at or past the remaining poise staggers (and refills it). */
  apply(d: DamageInput): DamageResult {
    if (this.dead) return { damage: 0, staggered: false, killed: false };
    const raw = Math.max(0, d.damage) * (d.armour === false ? 1 : this.armourMul);
    const dmg = Math.min(this.health.value, raw);
    this.health.value -= dmg;
    if (raw > 0) this.since.health = 0;
    let staggered = false;
    const pd = Math.max(0, d.poise ?? 0);
    if (pd > 0) {
      this.since.poise = 0;
      this.poise.value -= pd;
      if (this.poise.value <= 0) {
        staggered = true;
        // a broken guard of poise comes back whole: no stagger lock from the next blow
        this.poise.value = this.poise.max;
      }
    }
    const killed = this.health.value <= 0;
    const r = { damage: dmg, staggered: staggered && !killed, killed };
    this.changed();
    this.onDamage.emit(r);
    this.checkDeath();
    return r;
  }

  /** Down at once (a backstab, a scripted death). */
  kill() {
    if (this.dead) return;
    this.health.value = 0;
    this.since.health = 0;
    this.changed();
    this.checkDeath();
  }

  heal(amount: number) {
    if (this.dead || amount <= 0) return;
    this.health.value = Math.min(this.health.max, this.health.value + amount);
    this.changed();
  }

  /** Restore `amount` HP spread over `seconds` (a potion). */
  healOver(amount: number, seconds: number) {
    if (seconds <= 0) return this.heal(amount);
    this.heals.push({ left: seconds, rate: amount / seconds });
  }

  /** Damage over time, ignoring armour and poise (venom). */
  addDot(perSecond: number, seconds: number) {
    if (perSecond > 0 && seconds > 0) this.dots.push({ left: seconds, rate: perSecond });
  }

  /** Whether `amount` stamina is there to spend. */
  canSpend(amount: number) {
    return this.stamina.value >= amount;
  }

  /**
   * Spend stamina. `full` (a heavy): only when all of it is there. Otherwise any stamina left is
   * enough and the gauge stops at 0. False (nothing spent) when it can't. Also callable as
   * engine-framework §2.18's `spend("stamina", amount)`.
   */
  spend(amount: number, o?: { full?: boolean }): boolean;
  spend(stat: "stamina", amount: number, o?: { full?: boolean }): boolean;
  spend(a: number | "stamina", b?: number | { full?: boolean }, c?: { full?: boolean }) {
    const amount = typeof a === "number" ? a : typeof b === "number" ? b : 0;
    const o = (typeof a === "number" ? (typeof b === "object" ? b : undefined) : c) ?? {};
    if (o.full ? this.stamina.value < amount : this.stamina.value <= 0) return false;
    this.drain(amount);
    return true;
  }

  /** Take stamina without a check (a blocked blow); returns how much of `amount` there was none for. */
  drain(amount: number) {
    if (amount <= 0) return 0;
    const took = Math.min(this.stamina.value, amount);
    this.stamina.value -= took;
    this.since.stamina = 0;
    this.changed();
    return amount - took;
  }

  /**
   * A new HP cap (adaptive difficulty, a charm). `fill`: full health; otherwise the fraction of
   * health is kept.
   */
  setMaxHp(max: number, o: { fill?: boolean } = {}) {
    const frac = this.hpFrac;
    this.health.max = Math.max(1, max);
    this.health.value = o.fill ? this.health.max : Math.min(this.health.max, frac * this.health.max);
    this.changed();
  }

  /** Back up with a fraction of max HP (an essential companion getting up, a retry). */
  revive(frac = 1) {
    this.health.value = Math.max(1, this.health.max * clamp(frac, 0, 1));
    this.deadFlag = false;
    this.heals = [];
    this.dots = [];
    this.since.health = Infinity;
    this.changed();
  }

  /** Refill everything (a retry, a checkpoint). */
  fill() {
    this.restore({ hp: this.health.max, maxHp: this.health.max, st: this.stamina.max, poise: this.poise.max });
  }

  snapshot(): VitalsState {
    return { hp: this.health.value, maxHp: this.health.max, st: this.stamina.value, poise: this.poise.value };
  }

  /** Put the gauges back (an encounter retry): over-time heals and venom end. */
  restore(s: VitalsState) {
    this.health.max = Math.max(1, s.maxHp);
    this.health.value = clamp(s.hp, 0, this.health.max);
    this.stamina.value = clamp(s.st, 0, this.stamina.max);
    this.poise.value = clamp(s.poise, 0, this.poise.max);
    this.heals = [];
    this.dots = [];
    this.since = { health: Infinity, stamina: Infinity, poise: Infinity };
    this.deadFlag = this.health.value <= 0;
    this.changed();
  }

  /** Advance the refills, heals and venom by `dt` seconds of game time. */
  update(dt: number, o: VitalsUpdate = {}) {
    if (dt <= 0) return;
    let changed = false;
    this.since.health += dt;
    this.since.stamina += dt;
    this.since.poise += dt;
    if (!this.dead) {
      // potions and venom
      for (const list of [this.heals, this.dots])
        for (let i = list.length - 1; i >= 0; i--) {
          const e = list[i];
          const step = Math.min(dt, e.left);
          e.left -= step;
          const amt = e.rate * step;
          if (list === this.heals) this.health.value = Math.min(this.health.max, this.health.value + amt);
          else {
            this.health.value = Math.max(0, this.health.value - amt);
            this.since.health = 0;
          }
          changed = true;
          if (e.left <= 0) list.splice(i, 1);
        }
      const h = this.health;
      if (!o.combat && h.regen > 0 && h.value < h.max && this.since.health >= h.regenDelay) {
        h.value = Math.min(h.max, h.value + h.regen * dt);
        changed = true;
      }
      const s = this.stamina;
      if (s.value < s.max) {
        const rate = o.blocking ? this.blockRegen : this.since.stamina >= s.regenDelay ? s.regen : 0;
        if (rate > 0) {
          s.value = Math.min(s.max, s.value + rate * dt);
          changed = true;
        }
      }
      const p = this.poise;
      if (p.value < p.max && this.since.poise >= p.regenDelay) {
        p.value = p.max;
        changed = true;
      }
    }
    if (changed) this.changed();
    this.checkDeath();
  }

  private changed() {
    this.onChange.emit(this);
  }

  private checkDeath() {
    if (this.health.value > 0 || this.deadFlag) return;
    this.deadFlag = true;
    this.heals = [];
    this.dots = [];
    this.onDeath.emit();
  }
}

function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v));
}
