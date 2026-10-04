import { test } from "node:test";
import assert from "node:assert/strict";
import { CombatSystem } from "../../../../src/engine/combat/CombatSystem";
import { ArmedCamera, PlayerCombat, type CombatAction, type CombatPlayer, type PlayerCombatEvent } from "../../../../src/engine/combat/PlayerCombat";
import { Vitals } from "../../../../src/engine/combat/vitals";
import { ARCHETYPES } from "../../../../src/engine/combat/attacks";
import { RootMotionCurve } from "../../../../src/engine/anim/rootMotion";

const DT = 1 / 60;

class FakeInput {
  held = new Set<CombatAction>();
  edges = new Set<CombatAction>();
  locked = true;
  usingPad = false;
  down(a: CombatAction) {
    return this.held.has(a);
  }
  pressed(a: CombatAction) {
    return this.edges.has(a);
  }
  press(a: CombatAction) {
    this.held.add(a);
    this.edges.add(a);
  }
  release(a: CombatAction) {
    this.held.delete(a);
  }
}

class FakePlayer implements CombatPlayer {
  position = { x: 0, y: 0, z: 0 };
  bodyYaw = 0;
  enabled = true;
  bound = false;
  scripted: string | null = null;
  plays: { clip: string; move?: number; speed?: number; hold?: boolean }[] = [];
  frozen: string[] = [];
  motion = 0;
  curves: RootMotionCurve[] = [];
  playScripted(clip: string, o: { move?: number; speed?: number; hold?: boolean } = {}) {
    this.scripted = clip;
    this.plays.push({ clip, ...o });
    return new Promise<{ completed: boolean }>(() => {});
  }
  clearScripted() {
    this.scripted = null;
  }
  startRootMotion(curve?: RootMotionCurve | null) {
    this.motion++;
    if (curve) this.curves.push(curve);
    return true;
  }
  stopRootMotion() {}
  /** the body clips there are (null: all) */
  has: Set<string> | null = null;
  body = {
    hasClip: (clip: string) => !this.has || this.has.has(clip),
    play: (clip: string, o?: { speed?: number }) => {
      if (o?.speed === 0) this.frozen.push(clip);
    },
    clipLength: () => 2,
  };
  get clips() {
    return this.plays.map((p) => p.clip);
  }
  /** what the controller does with the body each frame before combat runs */
  turn() {}
}

/**
 * A controller with a facing lock, a speed multiplier and jumping (the PlayerController's
 * `faceLock`, `moveScale`, `canJump`). `walkYaw`: the player is moving that way, and the body turns
 * toward the movement unless locked (PlayerController.turnBody).
 */
class LockingPlayer extends FakePlayer {
  faceLock: number | null = null;
  moveScale = 1;
  canJump = true;
  walkYaw: number | null = null;
  turn() {
    if (this.faceLock !== null) this.bodyYaw = this.faceLock;
    else if (this.walkYaw !== null) this.bodyYaw = this.walkYaw;
  }
}

function rig(o: { main?: string | null; off?: string | null; armed?: boolean; potions?: number; locking?: boolean; aim?: () => number } = {}) {
  const sys = new CombatSystem({ hostile: { player: ["enemy"] }, random: () => 0.99 });
  const player = o.locking ? new LockingPlayer() : new FakePlayer();
  const input = new FakeInput();
  const vitals = new Vitals({ health: 100 });
  const self = sys.add({ id: "player", faction: "player", vitals, position: () => player.position, yaw: () => player.bodyYaw, tokens: 2, canParry: true });
  sys.focus = self;
  const enemyPos = { x: 0, y: 0, z: -1.5 };
  const enemy = sys.add({ id: "enemy", faction: "enemy", vitals: new Vitals({ health: 200, poise: 500 }), position: () => enemyPos, yaw: () => Math.PI });
  const gearState = { armed: o.armed ?? true, busy: null as "draw" | "sheathe" | null };
  const calls: string[] = [];
  const gear = {
    items: { main: o.main === undefined ? "sword" : o.main, off: o.off ?? null },
    equipment: gearState,
    draw: async () => {
      calls.push("draw");
      gearState.armed = true;
      return true;
    },
    sheathe: async () => {
      calls.push("sheathe");
      gearState.armed = false;
      return true;
    },
  };
  let potions = o.potions ?? 2;
  let died = 0;
  const camRig = { distance: 3.2 };
  let holds = 0;
  const camera = new ArmedCamera(camRig, { holdThirdPerson: () => (holds++, () => holds--) });
  const pc = new PlayerCombat({ combat: sys, self, input, player, gear, potions: { get: () => potions, set: (n) => (potions = n) }, camera, aim: o.aim, onDeath: () => died++ });
  const events: PlayerCombatEvent[] = [];
  pc.events.on((e) => events.push(e));
  const frame = (n = 1) => {
    for (let i = 0; i < n; i++) {
      player.turn();
      pc.update(DT);
      sys.step(DT);
      input.edges.clear();
    }
  };
  const seconds = (s: number) => frame(Math.round(s / DT));
  /** a tap: down one frame, up the next */
  const tap = (a: CombatAction = "attack") => {
    input.press(a);
    frame();
    input.release(a);
    frame();
  };
  return { sys, pc, player, input, vitals, self, enemy, enemyPos, gear, gearState, calls, frame, seconds, tap, events, camRig, potions: () => potions, died: () => died, holds: () => holds };
}

test("taps chain Light A → B → C when the next press comes from 40 % of the clip; then the recovery", () => {
  const r = rig();
  r.tap();
  assert.equal(r.pc.state, "attack");
  assert.deepEqual(r.player.clips, ["Sword_Light_A"]);
  assert.equal(r.player.plays[0].move, 0.3, "movement ×0.3 while swinging");
  // 50 % into A (0.37 s clip): buffered
  r.seconds(0.15);
  r.tap();
  r.seconds(0.2);
  assert.deepEqual(r.player.clips, ["Sword_Light_A", "Sword_Light_B"]);
  r.seconds(0.2);
  r.tap();
  r.seconds(0.2);
  assert.deepEqual(r.player.clips, ["Sword_Light_A", "Sword_Light_B", "Sword_Light_C"]);
  r.seconds(1);
  assert.deepEqual(r.player.clips.slice(3), ["SwordLight_C_Rec"], "C always ends in its recovery");
  r.seconds(1);
  assert.equal(r.pc.state, "idle");
  assert.equal(r.player.scripted, null);
  assert.equal(r.enemy.vitals.hp, 200 - 14 - 14 - 21, "each swing landed once");
});

test("a press before 40 % is not buffered: the swing ends in its recovery", () => {
  const r = rig();
  r.tap();
  r.frame(2);
  r.tap();
  r.seconds(0.6);
  assert.deepEqual(r.player.clips, ["Sword_Light_A", "Sword_Light_A_Rec"]);
});

test("holding attack 0.3 s is a heavy (24 stamina); without the stamina it is refused", () => {
  const r = rig();
  r.input.press("attack");
  r.seconds(0.25);
  assert.equal(r.pc.state, "idle", "not yet a heavy");
  r.seconds(0.1);
  assert.equal(r.player.clips[0], "Sword_Heavy_A");
  assert.ok(Math.abs(r.player.plays[0].speed! - 0.85) < 1e-9, "at 0.85×");
  assert.ok(Math.abs(r.vitals.st - 76) < 1e-6);
  r.input.release("attack");
  r.seconds(2);
  const t = rig();
  t.vitals.drain(85);
  t.input.press("attack");
  t.seconds(0.4);
  assert.equal(t.player.clips.length, 0);
  assert.ok(t.events.some((e) => e.type === "lowStamina"));
});

test("block: held raises the guard (frozen block pose at 0.4 s), released lowers it; a shield loops its own clip", () => {
  const r = rig();
  r.input.press("block");
  r.frame();
  assert.equal(r.pc.state, "block");
  assert.ok(r.self.blocking);
  assert.deepEqual(r.player.clips, ["Sword_Block"]);
  assert.ok(Math.abs(r.player.plays[0].move! - 1.6 / 3.9) < 1e-9, "1.6 m/s while blocking");
  r.seconds(0.5);
  assert.deepEqual(r.player.frozen, ["Sword_Block"]);
  assert.ok(r.self.guardUp);
  r.input.release("block");
  r.frame();
  assert.equal(r.pc.state, "idle");
  assert.ok(!r.self.blocking);
  assert.equal(r.player.scripted, null);
  const s = rig({ off: "shield" });
  s.input.press("block");
  s.frame();
  assert.deepEqual(s.player.clips, ["Idle_Shield_Loop"]);
});

test("parry through the controller: block pressed just before the enemy's strike", () => {
  const r = rig();
  const parried: string[] = [];
  r.sys.events.on((e) => e.type === "hit" && parried.push(e.hit.outcome));
  // the soldier's light strikes 0.4 s after it starts
  r.sys.attack(r.enemy, ARCHETYPES.soldier.light[0]);
  r.seconds(0.3);
  r.input.press("block");
  r.seconds(0.3);
  assert.deepEqual(parried, ["parried"]);
  assert.equal(r.vitals.hp, 100);
  assert.ok(r.enemy.staggered);
});

test("the recovery cancels into block after 0.15 s", () => {
  const r = rig();
  r.tap();
  r.seconds(0.4);
  assert.equal(r.pc.state, "recover");
  r.input.press("block");
  r.frame();
  assert.equal(r.pc.state, "recover", "not in its first 0.15 s");
  r.seconds(0.15);
  assert.equal(r.pc.state, "block");
});

test("potions: Q drinks one (+50 over 1.5 s), 3 s cooldown, none left says so", () => {
  const r = rig({ potions: 1 });
  r.vitals.apply({ damage: 60 });
  r.tap("heal");
  assert.equal(r.pc.state, "potion");
  assert.equal(r.potions(), 0);
  assert.deepEqual(r.player.clips, ["Consume"]);
  assert.equal(r.player.plays[0].move, 0.5);
  r.seconds(1.6);
  assert.ok(Math.abs(r.vitals.hp - 90) < 0.5, `healed (${r.vitals.hp})`);
  r.tap("heal");
  assert.ok(!r.events.some((e) => e.type === "noPotion"), "still cooling down");
  r.seconds(2);
  r.tap("heal");
  assert.ok(r.events.some((e) => e.type === "noPotion"));
  r.tap();
  assert.equal(r.pc.state, "attack", "attacks work again after the potion");
});

test("a stagger interrupts the swing; death plays out and calls back; reset makes it ready", () => {
  const r = rig();
  r.tap();
  r.sys.stagger(r.self, 0.5, { clip: "Hit_Stomach" });
  assert.equal(r.pc.state, "stagger");
  assert.equal(r.player.clips.at(-1), "Hit_Stomach");
  r.tap();
  assert.equal(r.pc.state, "stagger", "no input while reeling");
  r.seconds(0.6);
  assert.equal(r.pc.state, "idle");
  r.vitals.kill();
  assert.equal(r.pc.state, "dead");
  assert.equal(r.died(), 1);
  assert.ok(["Death01", "Death02"].includes(r.player.clips.at(-1)!));
  r.tap();
  assert.equal(r.pc.state, "dead");
  r.vitals.revive(1);
  r.pc.reset();
  assert.equal(r.pc.state, "idle");
  assert.equal(r.player.scripted, null);
});

test("draw and sheathe: R toggles, the first attack press draws a carried weapon; the armed camera follows", () => {
  const r = rig({ armed: false });
  r.frame();
  assert.equal(r.camRig.distance, 3.2);
  r.tap();
  assert.deepEqual(r.calls, ["draw"]);
  assert.equal(r.player.clips.length, 0, "no swing from the drawing press");
  r.frame();
  assert.equal(r.camRig.distance, 2.6, "the 2.6 m armed boom");
  assert.equal(r.holds(), 1, "held in third person");
  r.tap("ready");
  assert.deepEqual(r.calls, ["draw", "sheathe"]);
  r.frame();
  assert.equal(r.camRig.distance, 3.2, "back to the boom it had");
  assert.equal(r.holds(), 0);
});

test("no combat input while unlocked, bound, disabled or under someone else's clip", () => {
  const r = rig();
  r.input.locked = false;
  r.tap();
  assert.equal(r.pc.state, "idle", "the click that locks the pointer is not an attack");
  r.input.locked = true;
  r.player.scripted = "Chest_Open";
  r.tap();
  assert.equal(r.pc.state, "idle");
  r.player.scripted = null;
  r.player.bound = true;
  r.tap();
  assert.equal(r.pc.state, "idle");
  r.player.bound = false;
  r.tap();
  assert.equal(r.pc.state, "attack");
  r.pc.enabled = false;
  r.frame();
  assert.equal(r.pc.state, "idle", "a cutscene takes over");
  assert.equal(r.player.scripted, null);
  r.pc.dispose();
});

test("fists when nothing is carried; swings face the enemy near the aim", () => {
  const r = rig({ main: null, armed: false });
  r.enemyPos.x = 0.8;
  r.tap();
  assert.deepEqual(r.player.clips, ["Punch_Jab"]);
  assert.ok(Math.abs(r.player.bodyYaw - Math.atan2(-0.8, 1.5)) < 1e-6, "turned to the enemy");
});

test("knockback that doesn't stagger still pushes the player (the interrogator's kick)", () => {
  const r = rig();
  const hits: { outcome: string; staggered: boolean }[] = [];
  r.sys.events.on((e) => e.type === "hit" && hits.push({ outcome: e.hit.outcome, staggered: e.hit.staggered }));
  // the kick: 12 damage, 20 poise (the player has 50), 1.5 m knockback
  r.sys.attack(r.enemy, ARCHETYPES.interrogator.special!);
  r.seconds(1);
  assert.deepEqual(hits, [{ outcome: "hit", staggered: false }]);
  assert.equal(r.pc.state, "idle", "no stagger");
  assert.equal(r.player.curves.length, 1, "a knockback curve");
  // the enemy is in front (−Z): pushed straight back, 1.5 m along the body's backward axis
  const d = r.player.curves[0].delta(0, r.player.curves[0].duration);
  assert.ok(Math.abs(d.z + 1.5) < 1e-6 && Math.abs(d.x) < 1e-6, `backward 1.5 m (${d.x}, ${d.z})`);
});

test("a swing holds the body's facing through the controller's lock; it is released after", () => {
  const r = rig({ locking: true });
  const p = r.player as LockingPlayer;
  r.enemyPos.x = 0.8;
  r.tap();
  const yaw = Math.atan2(-0.8, 1.5);
  assert.ok(p.faceLock !== null && Math.abs(p.faceLock - yaw) < 1e-6, "locked toward the enemy");
  // the controller holds it; combat no longer re-sets bodyYaw each frame
  p.bodyYaw = 2;
  r.pc.update(DT);
  assert.equal(p.bodyYaw, 2);
  r.seconds(2);
  assert.equal(r.pc.state, "idle");
  assert.equal(p.faceLock, null, "free again");
  // a knockback holds it too, for its length
  r.sys.attack(r.enemy, ARCHETYPES.interrogator.special!);
  r.seconds(0.75);
  assert.notEqual(p.faceLock, null, "held while pushed");
  r.seconds(0.6);
  assert.equal(p.faceLock, null);
  // a lock someone else set is left alone
  p.faceLock = 1;
  r.input.press("block");
  r.frame();
  r.input.release("block");
  r.frame();
  assert.equal(p.faceLock, 1);
});

/** Every hit outcome the system reports (on `target` only, when given). */
function outcomes(sys: CombatSystem, target?: { id: string }) {
  const out: string[] = [];
  sys.events.on((e) => e.type === "hit" && (!target || e.hit.target.id === target.id) && out.push(e.hit.outcome));
  return out;
}

test("the guard faces the aim while the player backs off or strafes: a blow from the aimed direction is blocked", () => {
  for (const walkYaw of [Math.PI, -Math.PI / 2, Math.PI / 2]) {
    // the camera looks at the enemy (−Z); the player walks backward or sideways with the block held
    const r = rig({ locking: true, aim: () => 0 });
    const p = r.player as LockingPlayer;
    const hits = outcomes(r.sys);
    p.walkYaw = walkYaw;
    r.frame(10);
    assert.ok(Math.abs(p.bodyYaw - walkYaw) < 1e-9, "unarmoured movement turns the body");
    r.input.press("block");
    r.seconds(0.5);
    assert.equal(r.pc.state, "block");
    assert.ok(p.faceLock !== null && Math.abs(p.faceLock) < 1e-9, `the guard faces the enemy (${p.faceLock})`);
    assert.ok(Math.abs(p.bodyYaw) < 1e-9, "and so does the body, whatever the movement");
    r.sys.attack(r.enemy, ARCHETYPES.soldier.light[0]);
    r.seconds(0.6);
    assert.deepEqual(hits, ["blocked"], `walking at ${walkYaw.toFixed(2)}`);
    assert.ok(Math.abs(r.vitals.hp - 97) < 1e-6, `10 × 0.3 (${r.vitals.hp})`);
    r.input.release("block");
    r.frame();
    assert.equal(p.faceLock, null, "free again once lowered");
    r.frame();
    assert.ok(Math.abs(p.bodyYaw - walkYaw) < 1e-9, "the body follows the movement again");
  }
});

test("the guard follows the camera when no enemy is near the aim", () => {
  let aim = 0.3;
  const r = rig({ locking: true, aim: () => aim });
  const p = r.player as LockingPlayer;
  r.enemyPos.z = -10;
  p.walkYaw = Math.PI;
  r.frame();
  r.input.press("block");
  r.frame();
  assert.ok(Math.abs(p.bodyYaw - 0.3) < 1e-9);
  aim = -0.8;
  r.frame();
  assert.ok(Math.abs(p.faceLock! + 0.8) < 1e-9 && Math.abs(p.bodyYaw + 0.8) < 1e-9, "turning with the camera");
  // a controller without a facing lock gets its body turned every frame instead
  const f = rig({ aim: () => aim });
  f.enemyPos.z = -10;
  f.frame();
  f.player.bodyYaw = 2;
  f.input.press("block");
  f.frame();
  assert.ok(Math.abs(f.player.bodyYaw + 0.8) < 1e-9);
});

test("parry counts from the button press: a block held through a stagger doesn't parry when it comes back up", () => {
  const r = rig();
  const hits = outcomes(r.sys);
  r.input.press("block");
  r.seconds(0.5);
  r.sys.stagger(r.self, 0.5, { clip: "Hit_Stomach" });
  r.frame();
  assert.equal(r.pc.state, "stagger");
  // the soldier's light strikes 0.4 s after it starts: ≈ 0.14 s after the guard is back up (inside
  // the parry window if it counted from the raise)
  r.seconds(0.25);
  r.sys.attack(r.enemy, ARCHETYPES.soldier.light[0]);
  r.seconds(0.6);
  assert.equal(r.pc.state, "block", "the held button raised the guard again");
  assert.deepEqual(hits, ["blocked"], "blocked (the guard was up), not parried");
  assert.ok(!r.enemy.staggered);
});

test("parry counts from the button press: a press during the recovery parries what is left of its window", () => {
  // pressed at the start of the recovery (it can't cancel for 0.15 s): the guard rises ≈ 0.12 s
  // after the press, and the strike lands 0.1 s after that, 0.22 s after the press: too late
  const late = rig();
  const hits = outcomes(late.sys, late.self);
  late.tap();
  late.seconds(0.22);
  assert.equal(late.pc.state, "attack");
  late.sys.attack(late.enemy, ARCHETYPES.soldier.light[0]);
  late.seconds(0.18);
  assert.equal(late.pc.state, "recover");
  late.input.press("block");
  late.seconds(0.1);
  assert.equal(late.pc.state, "recover", "the press is waiting for the cancel");
  late.seconds(0.3);
  assert.equal(late.pc.state, "block");
  assert.deepEqual(hits, ["hit"], "not parried (and the guard wasn't up yet)");
  // pressed in the recovery 0.1 s before the strike, when it can cancel: parried
  const ok = rig();
  const h2 = outcomes(ok.sys, ok.self);
  ok.tap();
  ok.seconds(0.22);
  ok.sys.attack(ok.enemy, ARCHETYPES.soldier.light[0]);
  ok.seconds(0.3);
  assert.equal(ok.pc.state, "recover");
  ok.input.press("block");
  ok.seconds(0.3);
  assert.deepEqual(h2, ["parried"]);
});

test("tapping block doesn't keep the parry window open: a press 0.25 s after one that didn't parry can't parry", () => {
  const r = rig();
  const hits = outcomes(r.sys);
  r.sys.attack(r.enemy, ARCHETYPES.soldier.light[0]);
  // strike at ≈ 0.4 s: tap at 0.05 s (no blow in its window), press again at 0.3 s
  r.seconds(0.05);
  r.tap("block");
  r.seconds(0.2);
  r.input.press("block");
  r.seconds(0.4);
  assert.deepEqual(hits, ["hit"], "locked out: no parry, and the guard wasn't up yet");
  // once the lockout has passed, a press parries again
  r.input.release("block");
  r.seconds(2);
  r.sys.attack(r.enemy, ARCHETYPES.soldier.light[0]);
  r.seconds(0.3);
  r.input.press("block");
  r.seconds(0.3);
  assert.deepEqual(hits, ["hit", "parried"]);
});

test("movement follows the combat state, with or without the body clips; the clips don't slow it twice", () => {
  const r = rig({ locking: true, potions: 1 });
  const p = r.player as LockingPlayer;
  p.has = new Set();
  // a swing: 30 %
  r.tap();
  assert.equal(r.pc.state, "attack");
  assert.equal(p.moveScale, 0.3);
  assert.equal(p.canJump, false);
  r.seconds(2);
  assert.equal(r.pc.state, "idle");
  assert.equal(p.moveScale, 1);
  assert.equal(p.canJump, true);
  // the block speed
  r.input.press("block");
  r.frame();
  assert.ok(Math.abs(p.moveScale - 1.6 / 3.9) < 1e-9);
  r.input.release("block");
  r.frame();
  assert.equal(p.moveScale, 1);
  // a potion: 50 %
  r.vitals.apply({ damage: 40 });
  r.tap("heal");
  assert.equal(p.moveScale, 0.5);
  r.seconds(1.5);
  assert.equal(p.moveScale, 1);
  // reeling: no movement for the whole stagger (no clip to hold it)
  r.sys.stagger(r.self, 0.8, { clip: "Hit_Chest" });
  assert.equal(p.moveScale, 0, "at once, mid-step");
  r.seconds(0.7);
  assert.equal(p.moveScale, 0);
  r.seconds(0.2);
  assert.equal(p.moveScale, 1);
  // dead: no movement until the retry resets
  r.vitals.kill();
  assert.equal(p.moveScale, 0);
  assert.equal(p.canJump, false);
  r.seconds(3);
  assert.equal(p.moveScale, 0, "through the slow motion and the fade");
  r.vitals.revive(1);
  r.pc.reset();
  assert.equal(p.moveScale, 1);
  assert.equal(p.canJump, true);
  // with the clips: they play at full movement and the state slows the player
  const q = rig({ locking: true });
  q.tap();
  assert.equal(q.player.plays[0].move, 1);
  assert.equal((q.player as LockingPlayer).moveScale, 0.3);
  q.sys.stagger(q.self, 0.5, { clip: "Hit_Chest" });
  assert.equal(q.player.plays.at(-1)!.move, 0);
  q.pc.dispose();
  assert.equal((q.player as LockingPlayer).moveScale, 1, "given back on dispose");
});

test("a reaction clip is held for the whole stagger; a knockdown gets up (LayToIdle) before control returns", () => {
  const r = rig({ locking: true });
  r.sys.stagger(r.self, 0.8, { clip: "Hit_Chest" });
  assert.deepEqual(r.player.plays.at(-1), { clip: "Hit_Chest", camera: false, hold: true, blend: 0.08, move: 0 });
  r.seconds(0.7);
  assert.equal(r.player.scripted, "Hit_Chest");
  r.seconds(0.2);
  assert.equal(r.pc.state, "idle");
  assert.equal(r.player.scripted, null);
  // knocked down for 1.6 s, then up over the clip (2 s here) at 1.2×
  r.sys.stagger(r.self, 1.6, { clip: "Hit_Knockback", knockdown: true });
  r.seconds(1.65);
  assert.equal(r.player.scripted, "LayToIdle");
  assert.equal(r.pc.state, "stagger", "still down while getting up");
  assert.equal((r.player as LockingPlayer).moveScale, 0);
  r.tap();
  assert.equal(r.pc.state, "stagger", "no input meanwhile");
  r.seconds(2 / 1.2);
  assert.equal(r.pc.state, "idle");
  assert.equal(r.player.scripted, null);
  assert.equal((r.player as LockingPlayer).moveScale, 1);
  // without the rise clip: up as soon as the stagger ends
  const n = rig();
  n.player.has = new Set(["Hit_Knockback"]);
  n.sys.stagger(n.self, 1.6, { clip: "Hit_Knockback", knockdown: true });
  n.seconds(1.65);
  assert.equal(n.pc.state, "idle");
});

test("a cutscene that disables combat while the player reels gives the movement back", () => {
  const r = rig({ locking: true });
  r.sys.stagger(r.self, 1, { clip: "Hit_Chest" });
  assert.equal((r.player as LockingPlayer).moveScale, 0);
  r.pc.enabled = false;
  r.frame();
  assert.equal(r.pc.state, "idle");
  assert.equal((r.player as LockingPlayer).moveScale, 1);
});
