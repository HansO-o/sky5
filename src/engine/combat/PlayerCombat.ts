import { Emitter } from "../core/emitter";
import type { Disposer } from "../core/types";
import { RootMotionCurve } from "../anim/rootMotion";
import { ARMED_CAMERA, GUARDS, PLAYER, PLAYER_WEAPONS, STAGGER } from "./attacks";
import type { AttackHandle, CombatEvent, Combatant, CombatSystem } from "./CombatSystem";
import { angleDiff, yawTo, type XYZ } from "./hit";
import type { AttackDef, WeaponDef } from "./weapons";

/** How long a knockback takes (s). */
const SHOVE_SECONDS = 0.3;

/** The input actions combat reads. */
export type CombatAction = "attack" | "block" | "heal" | "ready";

/** What the controller reads from the input system (injected: no platform singleton here). */
export interface CombatInput {
  down(a: CombatAction): boolean;
  pressed(a: CombatAction): boolean;
  /** the pointer is locked: mouse buttons only count then (the click that locks it is not an attack) */
  readonly locked: boolean;
  /** a gamepad is in use (its triggers count without a lock) */
  readonly usingPad?: boolean;
}

/** The player's body and controller, as combat drives them (a capsule player controller with scripted body clips). */
export interface CombatPlayer {
  readonly position: XYZ;
  /** the body's forward yaw */
  bodyYaw: number;
  /**
   * a facing the controller holds the body at instead of turning it toward the movement (null:
   * free). Combat sets it for each swing and while the guard is raised, so strafing or backing off
   * doesn't skew the strike, the root motion or the guard; a controller without it has `bodyYaw`
   * set every frame instead.
   */
  faceLock?: number | null;
  /**
   * multiplier on the movement speed: combat owns it while it does anything (0 reeling or dead,
   * 0.3 swinging, the block speed, 0.5 drinking), whether or not the body clips exist. Without it
   * the body clips' `move` fractions slow the player instead.
   */
  moveScale?: number;
  /** jumping is allowed (combat holds it off while it does anything) */
  canJump?: boolean;
  /** false during cutscenes */
  enabled: boolean;
  readonly bound: boolean;
  /** the body clip a script plays now (null: locomotion) */
  readonly scripted: string | null;
  playScripted(clip: string, o?: { loop?: boolean; speed?: number; blend?: number; camera?: boolean; hold?: boolean; move?: number }): Promise<{ completed: boolean }>;
  clearScripted(): void;
  startRootMotion?(curve: RootMotionCurve | null | undefined, o?: { speed?: number; target?: () => { x: number; z: number } | null }): boolean;
  stopRootMotion?(): void;
  readonly body: {
    hasClip(clip: string): boolean;
    play(clip: string, o?: { loop?: boolean; speed?: number; blend?: number; offset?: number }): unknown;
    /** a clip's length (s at rate 1): how long getting up takes */
    clipLength?(clip: string): number;
  };
}

/** The player's kit (an Equipment owner): what is carried, drawn or not, draw and sheathe. */
export interface CombatGear {
  readonly items: { readonly main: string | null; readonly off: string | null };
  readonly equipment: { readonly armed: boolean; readonly busy: "draw" | "sheathe" | null };
  draw(o?: { animate?: boolean }): Promise<boolean>;
  sheathe(o?: { animate?: boolean }): Promise<boolean>;
}

/** A camera rig with a third-person boom length (the shoulder offset and wall collision are the rig's). */
export interface ArmedRig {
  distance: number;
}

/** Something that can hold the camera in third person (the player controller). */
export interface PovHolder {
  holdThirdPerson(blend?: number): Disposer;
}

/**
 * The armed camera (§3.5): third person while a weapon is drawn, on a 2.6 m boom (the rig keeps
 * its 0.45 m shoulder offset and pulls the boom in with a static-only ray, so it never stops at a
 * body); sheathing gives back the previous point of view and boom length.
 */
export class ArmedCamera {
  private saved: number | null = null;
  private hold: Disposer | null = null;

  constructor(
    private rig: ArmedRig,
    private pov: PovHolder | null = null,
    readonly distance: number = ARMED_CAMERA.distance,
  ) {}

  get armed() {
    return this.saved !== null;
  }

  set(armed: boolean) {
    if (armed === this.armed) return;
    if (armed) {
      this.saved = this.rig.distance;
      this.rig.distance = this.distance;
      this.hold ??= this.pov?.holdThirdPerson() ?? null;
    } else {
      if (this.rig.distance === this.distance) this.rig.distance = this.saved!;
      this.saved = null;
      this.hold?.();
      this.hold = null;
    }
  }

  dispose() {
    this.set(false);
  }
}

export type PlayerCombatState = "idle" | "attack" | "recover" | "block" | "potion" | "stagger" | "dead";

export type PlayerCombatEvent =
  | { type: "draw" }
  | { type: "sheathe" }
  | { type: "attack"; attack: AttackDef; heavy: boolean; chain: number }
  | { type: "block"; on: boolean }
  | { type: "potion"; left: number }
  | { type: "noPotion" }
  /** an attack was refused for want of stamina */
  | { type: "lowStamina" }
  | { type: "stagger"; seconds: number }
  | { type: "death" };

export interface PlayerCombatOptions {
  combat: CombatSystem;
  /** the player's combatant */
  self: Combatant;
  input: CombatInput;
  player: CombatPlayer;
  gear?: CombatGear | null;
  /** the potion count (the inventory) */
  potions: { get(): number; set(n: number): void };
  /** the camera's yaw: swings go where the player looks (default: the body's facing) */
  aim?: () => number;
  /** root-motion curves by clip (the sidecar) */
  rootMotion?: { get(clip: string): RootMotionCurve | undefined } | null;
  camera?: ArmedCamera | null;
  /** fight with fists when nothing is carried (default true) */
  fists?: boolean;
  /** the player's running speed, which movement fractions are of (default 3.9 m/s) */
  runSpeed?: number;
  /** after the death clip starts (the encounter resets) */
  onDeath?(): void;
}

/**
 * The player's side of a fight (§8): R draws and sheathes; a tap of attack is a light (chained
 * A → B → C when the next press comes from 40 % of the clip on, otherwise the recovery clip, which
 * block cancels after 0.15 s); holding it 0.3 s is a heavy; holding block raises the guard, facing
 * the nearest enemy near the aim (or the aim) whichever way the player moves, and a blow within
 * 0.18 s of the press is parried; Q drinks a potion. Swings slow movement to 30 %, face the nearest
 * enemy near the aim and ride the clip's root motion. Staggers (a knockdown ends getting up),
 * absorbed swings and death interrupt whatever is going on; the controller's movement and jumping
 * follow the state. Runs per frame on game time (`update(dt)`). Engine-framework §2.18 calls it
 * `MeleeController` (`MeleeController.ts` re-exports it under that name).
 */
export class PlayerCombat {
  readonly events = new Emitter<PlayerCombatEvent>();
  /** false: combat input is ignored (cutscenes) */
  enabled = true;
  private st: PlayerCombatState = "idle";
  /** seconds (clip seconds while attacking) in the state, and its length */
  private t = 0;
  private len = 0;
  private speed = 1;
  private def: AttackDef | null = null;
  /** the next light in the chain */
  private chainIdx = 0;
  /** the attack button is down and not yet a tap or a hold */
  private press: { held: number } | null = null;
  private intent: "light" | "heavy" | null = null;
  /** the body clip this controller started */
  private clip: string | null = null;
  private handle: AttackHandle | null = null;
  private recCancel = 0;
  private frozen = false;
  private aimYaw = 0;
  private potionCd = 0;
  /** the facing lock is this controller's */
  private faceHeld = false;
  /** the lock someone else had set when this controller took it (given back after) */
  private faceBefore: number | null = null;
  /** seconds of knockback left (the facing is held meanwhile) */
  private shoveLeft = 0;
  /** seconds since the block button was pressed (a guard raised later parries what is left of the window) */
  private sincePress = Infinity;
  /** the stagger is a knockdown: getting up follows */
  private knocked = false;
  /** the controller's `moveScale` / `canJump` are this controller's */
  private moveHeld = false;
  private jumpHeld = false;
  private offs: (() => unknown)[] = [];
  private disposed = false;

  constructor(private o: PlayerCombatOptions) {
    this.offs.push(
      o.combat.events.on((e) => this.onCombat(e)),
      o.self.vitals.onDeath.on(() => this.die()),
    );
  }

  get state() {
    return this.st;
  }

  /** The weapon in use (null: nothing to fight with). */
  get weapon(): WeaponDef | null {
    const main = this.o.gear?.items.main ?? null;
    if (main === "sword" || main === "axe") return PLAYER_WEAPONS[main];
    if (main) return PLAYER_WEAPONS.sword;
    return this.o.fists === false ? null : PLAYER_WEAPONS.fists;
  }

  private get shield() {
    return this.o.gear?.items.off === "shield";
  }

  private get armed() {
    return this.o.gear?.equipment.armed ?? false;
  }

  /** Seconds before another potion can be drunk. */
  get potionCooldown() {
    return this.potionCd;
  }

  update(dt: number) {
    if (this.disposed) return;
    this.potionCd = Math.max(0, this.potionCd - dt);
    const { player: p, self, input: inp } = this.o;
    const mouse = inp.locked || !!inp.usingPad;
    // the press is what times a parry, whatever is going on when it comes
    this.sincePress += dt;
    if (mouse && inp.pressed("block")) this.sincePress = 0;
    if (this.shoveLeft > 0) {
      this.shoveLeft -= dt;
      // (a swing or a guard holds its own facing)
      if (this.shoveLeft <= 0 && this.st !== "attack" && this.st !== "block") this.unlockFace();
    }
    this.o.camera?.set(this.armed);
    self.guard = this.shield ? GUARDS.shield : GUARDS.weapon;
    if (this.st === "dead") return;
    // someone else's body clip (a chest, a lever, a cutscene), or no control: stand down
    const foreign = p.scripted !== null && p.scripted !== this.clip;
    const standDown = !this.enabled || !p.enabled || p.bound || foreign;
    if (this.st === "stagger" && !standDown) {
      this.t -= dt;
      if (this.t > 0) return;
      if (this.knocked) this.rise();
      else this.toIdle();
      return;
    }
    if (standDown) {
      if (this.st !== "idle") this.abort(!foreign);
      this.press = null;
      this.intent = null;
      return;
    }
    if (this.o.gear?.equipment.busy) {
      this.press = null;
      return;
    }
    const atkDown = mouse && inp.down("attack");
    const blkDown = mouse && inp.down("block");
    if (this.st === "idle" && inp.pressed("ready")) {
      this.toggleArms();
      return;
    }
    if (inp.pressed("heal")) this.drink();
    // a tap is a light, a hold a heavy
    if (mouse && inp.pressed("attack") && this.canBuffer()) this.press = { held: 0 };
    if (this.press) {
      if (atkDown) {
        this.press.held += dt;
        if (this.press.held >= PLAYER.heavyHold) {
          this.intent = "heavy";
          this.press = null;
        }
      } else {
        this.intent = "light";
        this.press = null;
      }
    }
    switch (this.st) {
      case "idle":
        if (blkDown && this.canBlock()) this.startBlock();
        else if (this.intent) this.begin(this.take()!, 0);
        break;
      case "attack":
        this.t += dt * this.speed;
        // (a controller with a facing lock holds it itself, root-motion turns included)
        if (p.faceLock === undefined) p.bodyYaw = this.aimYaw;
        if (this.t >= this.len) {
          const w = this.weapon;
          if (this.intent === "heavy" || (this.intent === "light" && w && this.chainIdx < w.light.length)) this.begin(this.take()!, this.chainIdx);
          // still deciding between a tap and a hold: hold the last pose a moment
          else if (!this.press) this.recover();
        }
        break;
      case "recover": {
        this.t += dt;
        const free = this.t >= this.recCancel;
        if (free && blkDown && this.canBlock()) this.startBlock();
        else if (free && this.intent) this.begin(this.take()!, 0);
        else if (this.t >= this.len) this.toIdle();
        break;
      }
      case "block":
        this.t += dt;
        if (!blkDown || !this.canBlock()) {
          this.stopBlock();
          break;
        }
        this.faceGuard();
        if (!this.frozen && !this.shield && this.t >= PLAYER.block.freezeAt) {
          // the guard pose: the clip held at its raised frame
          this.frozen = true;
          if (this.clip && p.body.hasClip(this.clip)) p.body.play(this.clip, { loop: false, speed: 0 });
        }
        break;
      case "potion":
        this.t += dt;
        if (this.t >= this.len) this.toIdle();
        break;
    }
  }

  /** Drink a potion (Q): +50 HP over 1.5 s, 3 s cooldown. False when it can't now. */
  drink() {
    if (this.disposed || (this.st !== "idle" && !(this.st === "recover" && this.t >= this.recCancel))) return false;
    if (this.potionCd > 0 || this.o.self.vitals.dead) return false;
    const n = this.o.potions.get();
    if (n <= 0) {
      this.events.emit({ type: "noPotion" });
      return false;
    }
    this.o.potions.set(n - 1);
    const pt = PLAYER.potion;
    this.o.self.vitals.healOver(pt.heal, pt.seconds);
    this.potionCd = pt.cooldown;
    this.halt();
    this.play(pt.clip, { move: pt.move, hold: false });
    this.enter("potion");
    this.t = 0;
    this.len = pt.length;
    this.events.emit({ type: "potion", left: n - 1 });
    return true;
  }

  /** Back to ready after an encounter retry (the vitals are restored by the encounter). */
  reset() {
    this.halt();
    this.unlockFace(true);
    this.release();
    this.knocked = false;
    this.enter("idle");
    this.press = null;
    this.intent = null;
    this.chainIdx = 0;
    this.potionCd = 0;
    this.sincePress = Infinity;
  }

  // ------------------------------------------------------------------ actions

  private canBuffer() {
    switch (this.st) {
      case "idle":
      case "recover":
        return true;
      case "attack":
        return this.len > 0 && this.t / this.len >= PLAYER.chain.buffer;
      default:
        return false;
    }
  }

  private take() {
    const i = this.intent;
    this.intent = null;
    return i;
  }

  private canBlock() {
    return !this.o.self.staggered && (this.armed || (!this.o.gear?.items.main && this.weapon !== null));
  }

  private toggleArms() {
    const g = this.o.gear;
    if (!g) return;
    if (g.equipment.armed) {
      this.events.emit({ type: "sheathe" });
      void g.sheathe();
    } else if (g.items.main || g.items.off) {
      this.events.emit({ type: "draw" });
      void g.draw();
    }
  }

  private begin(kind: "light" | "heavy", chain: number) {
    const w = this.weapon;
    if (!w) return;
    const g = this.o.gear;
    // a weapon on the back: the first press draws it
    if (g && (g.items.main || g.items.off) && !g.equipment.armed) {
      this.toIdle();
      this.toggleArms();
      return;
    }
    const def = kind === "heavy" ? w.heavy : w.light[Math.min(chain, w.light.length - 1)];
    const { self, combat, player: p } = this.o;
    if (!self.vitals.spend(def.stamina, { full: kind === "heavy" })) {
      this.events.emit({ type: "lowStamina" });
      if (this.st === "attack") this.recover();
      return;
    }
    const lock = this.softLock();
    const pos = p.position;
    this.aimYaw = lock ? yawTo(pos.x, pos.z, lock.pose.x, lock.pose.z) : (this.o.aim?.() ?? p.bodyYaw);
    p.bodyYaw = this.aimYaw;
    this.lockFace(this.aimYaw);
    const speed = def.speed ?? 1;
    const h = combat.attack(self, def, { force: true, target: lock, speed });
    if (!h) {
      // staggered meanwhile: the stamina is gone, the swing isn't
      this.toIdle();
      return;
    }
    this.handle = h;
    this.def = def;
    this.speed = speed;
    this.play(def.clip, { speed, blend: def.blend ?? 0.1, hold: true, move: PLAYER.chain.move });
    p.stopRootMotion?.();
    const curve = this.o.rootMotion?.get(def.clip);
    if (curve) p.startRootMotion?.(curve, { speed, target: lock ? () => lock.pose : () => null });
    this.enter("attack");
    this.t = 0;
    this.len = def.length;
    this.chainIdx = kind === "heavy" ? w.light.length : chain + 1;
    this.events.emit({ type: "attack", attack: def, heavy: kind === "heavy", chain });
  }

  /** The swing's follow-through clip (or straight back to idle without one). */
  private recover() {
    const rec = this.def?.recover;
    this.chainIdx = 0;
    this.unlockFace();
    if (!rec) {
      this.toIdle();
      return;
    }
    const speed = rec.speed ?? this.speed;
    this.play(rec.clip, { speed, blend: rec.blend ?? 0.1, hold: false, move: PLAYER.chain.move });
    this.enter("recover");
    this.t = 0;
    this.len = rec.length / Math.max(0.05, speed);
    this.recCancel = rec.cancel;
  }

  private startBlock() {
    const { self, combat } = this.o;
    self.swing?.cancel();
    this.o.player.stopRootMotion?.();
    // the parry window runs from the press, not from now
    combat.block(self, true, { pressAge: this.sincePress });
    if (!self.blocking) return;
    this.faceGuard();
    const shield = this.shield;
    const clip = shield ? PLAYER.block.shieldClip : PLAYER.block.clip;
    this.play(clip, { loop: shield, hold: true, blend: 0.1, move: this.blockMove });
    this.enter("block");
    this.t = 0;
    this.frozen = false;
    this.events.emit({ type: "block", on: true });
  }

  /** Movement while blocking, as a fraction of the run speed (1.6 m/s). */
  private get blockMove() {
    return PLAYER.block.speed / (this.o.runSpeed ?? 3.9);
  }

  /**
   * The guard faces the nearest enemy near the aim, or where the player looks, every frame, held
   * through the controller's facing lock so the body doesn't turn toward the movement (backing off
   * or strafing with the guard up). Not during a knockback, whose curve is in the body's frame.
   */
  private faceGuard() {
    if (this.shoveLeft > 0) return;
    const p = this.o.player;
    const lock = this.softLock();
    const pos = p.position;
    const yaw = lock ? yawTo(pos.x, pos.z, lock.pose.x, lock.pose.z) : (this.o.aim?.() ?? p.bodyYaw);
    p.bodyYaw = yaw;
    this.lockFace(yaw);
  }

  private stopBlock() {
    this.o.combat.block(this.o.self, false);
    this.toIdle();
    this.events.emit({ type: "block", on: false });
  }

  /** The nearest enemy within reach of the aim (null: swing where the player looks). */
  private softLock(): Combatant | null {
    const { combat, self, player: p } = this.o;
    const pos = p.position;
    const aim = this.o.aim?.() ?? p.bodyYaw;
    const arc = (PLAYER.aim.arc * Math.PI) / 180;
    let best: Combatant | null = null, bd = Infinity;
    for (const c of combat.enemiesOf(self)) {
      if (c.down) continue;
      const q = c.pose;
      const d = Math.hypot(q.x - pos.x, q.z - pos.z);
      if (d > PLAYER.aim.range + c.radius || Math.abs(q.y - pos.y) > 1.2) continue;
      if (d > 0.3 && Math.abs(angleDiff(yawTo(pos.x, pos.z, q.x, q.z), aim)) > arc) continue;
      if (d < bd) {
        bd = d;
        best = c;
      }
    }
    return best;
  }

  // ------------------------------------------------------------------ interruptions

  private onCombat(e: CombatEvent) {
    const self = this.o.self;
    if (e.type === "stagger" && e.target === self) this.reel(e.seconds, e.clip, e.push, e.knockdown);
    else if (e.type === "hit") {
      const h = e.hit;
      if (h.attacker === self && h.outcome === "absorbed" && this.st === "attack") this.recover();
      // knockback that didn't stagger (the interrogator's kick): pushed back, the swing goes on
      // (a stagger carries its own push, see `reel`)
      else if (h.target === self && h.push && !h.staggered && !h.killed && this.st !== "dead") this.shove(h.push);
    }
  }

  /**
   * Reel for `seconds`: the reaction clip is held (its last frame, when it is shorter) until the
   * stagger ends; a knockdown then gets up (`rise`). No movement meanwhile.
   */
  private reel(seconds: number, clip: string | null, push: { x: number; z: number } | null, knockdown = false) {
    if (this.st === "dead") return;
    this.halt();
    this.release();
    this.press = null;
    this.intent = null;
    this.chainIdx = 0;
    this.play(clip ?? PLAYER.stagger.clip, { hold: true, blend: 0.08, move: 0 });
    this.enter("stagger");
    this.t = seconds;
    this.knocked = knockdown;
    if (push) this.shove(push);
    this.events.emit({ type: "stagger", seconds });
  }

  /** Get up after a knockdown (`LayToIdle`); still reeling until the clip ends. Without the clip: up at once. */
  private rise() {
    this.knocked = false;
    const clip = STAGGER.knockdown.rise;
    const body = this.o.player.body;
    if (!body.hasClip(clip)) {
      this.toIdle();
      return;
    }
    const r = PLAYER.rise;
    this.play(clip, { hold: true, blend: 0.15, speed: r.speed, move: 0 });
    const len = body.clipLength?.(clip);
    this.t = (len && len > 0 ? len : r.seconds) / r.speed;
  }

  /**
   * Knockback: a short made-up root-motion curve along the push. The curve is in the body's frame,
   * so the facing is held while it runs (the body would otherwise turn toward the push and bend it).
   */
  private shove(push: { x: number; z: number }) {
    const p = this.o.player;
    if (!p.startRootMotion) return;
    const s = Math.sin(p.bodyYaw), c = Math.cos(p.bodyYaw);
    // world → model space (x = the body's left, z = its forward)
    const fwd = -s * push.x - c * push.z, left = -c * push.x + s * push.z;
    if (!p.startRootMotion(new RootMotionCurve([
      [0, 0, 0, 0, 0],
      [SHOVE_SECONDS, left, 0, fwd, 0],
    ]))) return;
    this.lockFace(p.bodyYaw);
    this.shoveLeft = SHOVE_SECONDS + 0.2;
  }

  private die() {
    if (this.st === "dead" || this.disposed) return;
    this.halt();
    this.release();
    this.press = null;
    this.intent = null;
    this.knocked = false;
    this.enter("dead");
    const clips = PLAYER.deaths;
    this.play(clips[Math.floor(Math.random() * clips.length)], { hold: true, blend: 0.2, move: 0 });
    this.events.emit({ type: "death" });
    this.o.onDeath?.();
  }

  // ------------------------------------------------------------------ helpers

  /**
   * Play a body clip. `move` is the movement fraction while it plays: on a controller with a
   * `moveScale` the state sets the speed (`enter`), and the clip only stops movement where it is 0.
   */
  private play(clip: string, o: { loop?: boolean; speed?: number; blend?: number; hold?: boolean; move: number }) {
    this.clip = clip;
    const p = this.o.player;
    // without the combat clip set the actions still happen, unseen
    if (!p.body.hasClip(clip)) return;
    const move = p.moveScale === undefined ? o.move : o.move > 0 ? 1 : 0;
    void p.playScripted(clip, { camera: false, ...o, move });
  }

  /** Movement while in a state (a fraction of the normal speed). */
  private moveFor(st: PlayerCombatState) {
    switch (st) {
      case "idle":
        return 1;
      case "attack":
      case "recover":
        return PLAYER.chain.move;
      case "block":
        return this.blockMove;
      case "potion":
        return PLAYER.potion.move;
      case "stagger":
      case "dead":
        return 0;
    }
  }

  /**
   * Into a state: the controller's movement and jumping follow it (only what this controller
   * changed is given back), so a missing or short clip never frees the player early.
   */
  private enter(st: PlayerCombatState) {
    this.st = st;
    const p = this.o.player;
    if (p.moveScale !== undefined) {
      const m = this.moveFor(st);
      if (m !== 1 || this.moveHeld) {
        p.moveScale = m;
        this.moveHeld = m !== 1;
      }
    }
    if (p.canJump !== undefined) {
      if (st !== "idle" && p.canJump && !this.jumpHeld) {
        p.canJump = false;
        this.jumpHeld = true;
      } else if (st === "idle" && this.jumpHeld) {
        p.canJump = true;
        this.jumpHeld = false;
      }
    }
  }

  /** Stop the swing, the guard and the root motion (the body clip stays). */
  private halt() {
    const { self, combat, player: p } = this.o;
    if (this.handle && !this.handle.finished) this.handle.cancel();
    this.handle = null;
    if (self.blocking) combat.block(self, false);
    p.stopRootMotion?.();
    this.unlockFace();
  }

  /** Hold the body at `yaw` (a swing, a knockback) on a controller that has a facing lock. */
  private lockFace(yaw: number) {
    const p = this.o.player;
    if (p.faceLock === undefined) return;
    if (!this.faceHeld) this.faceBefore = p.faceLock;
    p.faceLock = yaw;
    this.faceHeld = true;
  }

  /**
   * The body turns freely again (it keeps the facing it had), or back to a lock someone else had
   * set; only a lock this controller set, and not while a knockback runs unless `force`.
   */
  private unlockFace(force = false) {
    if (!this.faceHeld || (!force && this.shoveLeft > 0)) return;
    this.faceHeld = false;
    this.shoveLeft = 0;
    this.o.player.faceLock = this.faceBefore;
    this.faceBefore = null;
  }

  /** Give the body back to locomotion if this controller has it. */
  private release() {
    const p = this.o.player;
    if (this.clip && p.scripted === this.clip) p.clearScripted();
    this.clip = null;
  }

  private toIdle() {
    if (this.handle?.finished) this.handle = null;
    this.unlockFace();
    if (this.o.self.blocking) this.o.combat.block(this.o.self, false);
    this.release();
    this.enter("idle");
    this.frozen = false;
  }

  /** Drop the current action (a cutscene took over). `clear`: also give the body back. */
  private abort(clear: boolean) {
    this.halt();
    if (clear) this.release();
    else this.clip = null;
    this.knocked = false;
    this.enter("idle");
    this.chainIdx = 0;
  }

  dispose() {
    if (this.disposed) return;
    this.abort(true);
    this.unlockFace(true);
    this.disposed = true;
    for (const off of this.offs) off();
    this.offs = [];
    this.o.camera?.dispose();
    this.events.clear();
  }
}
