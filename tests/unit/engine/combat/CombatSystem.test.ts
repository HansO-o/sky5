import { test } from "node:test";
import assert from "node:assert/strict";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { CombatSystem, type CombatEvent, type CombatantSpec, type LineOfSight } from "../../../../src/engine/combat/CombatSystem";
import { Vitals } from "../../../../src/engine/combat/vitals";
import { ARCHETYPES, GUARDS, PLAYER_WEAPONS } from "../../../../src/engine/combat/attacks";
import type { AttackDef } from "../../../../src/engine/combat/weapons";
import { newPhysics } from "../../helpers/jolt";

const near = (a: number, b: number, eps = 1e-6) => Math.abs(a - b) < eps;
const LIGHT = PLAYER_WEAPONS.sword.light[0];
const HEAVY = PLAYER_WEAPONS.sword.heavy;
const STEP = 1 / 60;

type Pose = { x: number; y: number; z: number; yaw: number };

function setup(o: { los?: LineOfSight | null; random?: () => number } = {}) {
  const sys = new CombatSystem({ hostile: { player: ["enemy"] }, los: o.los, random: o.random ?? (() => 0.99) });
  const events: CombatEvent[] = [];
  sys.events.on((e) => events.push(e));
  const add = (id: string, faction: string, pose: Partial<Pose>, spec: Partial<CombatantSpec> & { hp?: number; poise?: number; st?: number } = {}) => {
    const p: Pose = { x: 0, y: 0, z: 0, yaw: 0, ...pose };
    const vitals = new Vitals({ health: spec.hp ?? 100, poise: spec.poise ?? 50, stamina: 100 });
    if (spec.st !== undefined) vitals.drain(100 - spec.st);
    const c = sys.add({ id, faction, vitals, position: () => p, yaw: () => p.yaw, ...spec });
    return { c, p, v: vitals };
  };
  const run = (seconds: number, dt = STEP) => {
    for (let t = 0; t < seconds - 1e-9; t += dt) sys.step(dt);
  };
  const hits = () => events.filter((e): e is Extract<CombatEvent, { type: "hit" }> => e.type === "hit").map((e) => e.hit);
  return { sys, events, add, run, hits };
}

/** the player at the origin facing -Z, an enemy 1.5 m in front facing it */
function duel(o: Parameters<typeof setup>[0] = {}, enemy: Parameters<ReturnType<typeof setup>["add"]>[3] = {}) {
  const s = setup(o);
  const pl = s.add("player", "player", {}, { canParry: true });
  const en = s.add("enemy", "enemy", { z: -1.5, yaw: Math.PI }, enemy);
  s.sys.focus = pl.c;
  return { ...s, pl, en };
}

test("a swing lands once, only inside its active window", () => {
  const { sys, pl, en, run, hits } = duel();
  const h = sys.attack(pl.c, LIGHT)!;
  assert.ok(h);
  run(0.1);
  assert.equal(en.v.hp, 100, "nothing before the window (0.13 s)");
  run(0.5);
  assert.equal(hits().length, 1);
  assert.equal(en.v.hp, 100 - 14);
  assert.ok(h.finished);
  assert.ok(sys.attack(pl.c, LIGHT), "free again after the clip");
});

test("a frame that spans the whole window still lands (no tunnelling in time)", async () => {
  const { sys, pl, en, hits } = duel();
  const h = sys.attack(pl.c, LIGHT)!;
  sys.step(0.5);
  assert.equal(hits().length, 1);
  assert.equal(en.v.hp, 86);
  assert.equal(await h.done, "hit");
});

test("a target darting across the arc between two steps is hit (swept)", () => {
  const { sys, pl, en, run, hits } = duel();
  en.p.x = -1.45;
  en.p.z = -1;
  sys.attack(pl.c, LIGHT);
  run(0.15);
  assert.equal(hits().length, 0, "outside the arc so far");
  en.p.x = 1.45;
  sys.step(STEP);
  assert.equal(hits().length, 1, "crossed the front in one step");
});

test("one target per swing: the nearer of two; each target at most once", () => {
  const s = setup();
  const pl = s.add("player", "player", {});
  const far = s.add("far", "enemy", { z: -1.9 });
  const close = s.add("close", "enemy", { z: -1.2 });
  s.sys.attack(pl.c, LIGHT);
  s.run(0.5);
  assert.equal(s.hits().length, 1);
  assert.equal(close.v.hp, 86);
  assert.equal(far.v.hp, 100);
  // a cleaving swing may hit both, each once
  s.sys.attack(pl.c, { ...LIGHT, maxTargets: 2 });
  s.run(0.5);
  assert.equal(close.v.hp, 72);
  assert.equal(far.v.hp, 86);
});

test("friends, the dead and those out of sight are not hit", async () => {
  const s = setup({ los: { rayCastStatic: () => 0.5 } });
  const pl = s.add("player", "player", {});
  const ally = s.add("ally", "player", { z: -1.2 });
  const en = s.add("enemy", "enemy", { z: -1.5 });
  s.sys.attack(pl.c, LIGHT);
  s.run(0.5);
  assert.equal(ally.v.hp, 100);
  assert.equal(en.v.hp, 100, "a wall at 0.5 m");

  // the same with Jolt: a wall between them blocks, no wall lands
  const ph = await newPhysics();
  const t = setup({ los: ph });
  const a = t.add("player", "player", {});
  const b = t.add("enemy", "enemy", { z: -1.8 });
  const wall = ph.addBox(new Vector3(0, 1, -1), new Vector3(1, 1, 0.05));
  t.sys.attack(a.c, LIGHT);
  t.run(0.5);
  assert.equal(b.v.hp, 100, "the wall stops the blow");
  ph.removeBody(wall);
  t.sys.attack(a.c, LIGHT);
  t.run(0.5);
  assert.equal(b.v.hp, 86, "clear line of sight");
  ph.dispose();
});

test("parry: block pressed within 0.18 s before the hit — no damage, attacker reels 1.1 s, riposte ×1.5", () => {
  const { sys, pl, en, run, hits, events } = duel();
  // the enemy's light: wind-up 0.6× to 0.24 s of clip = 0.4 s
  const atk = ARCHETYPES.soldier.light[0];
  const h = sys.attack(en.c, atk)!;
  run(0.3);
  sys.block(pl.c, true);
  run(0.3);
  const hit = hits()[0];
  assert.equal(hit.outcome, "parried");
  assert.equal(pl.v.hp, 100);
  assert.equal(pl.v.st, 100, "no stamina either");
  assert.ok(h.finished);
  assert.ok(en.c.staggered, "the attacker reels");
  const st = events.find((e) => e.type === "stagger" && e.target === en.c);
  assert.ok(st && st.type === "stagger" && st.clip === "Hit_Head" && near(st.seconds, 1.1));
  assert.ok(events.some((e) => e.type === "hitStop" && near(e.seconds, 0.09)), "90 ms hit-stop");
  assert.ok(pl.c.riposte > 0);
  sys.block(pl.c, false);
  sys.attack(pl.c, LIGHT);
  run(0.4);
  assert.equal(en.v.hp, 100 - 21, "the riposte deals ×1.5");
});

test("block: raised after 0.12 s, takes 30 % for 80 % in stamina; a shield 10 % for 50 %", () => {
  const { sys, pl, en, run, hits } = duel();
  sys.block(pl.c, true);
  run(0.5);
  assert.ok(pl.c.guardUp);
  sys.attack(en.c, ARCHETYPES.soldier.light[0]);
  run(0.42);
  assert.equal(hits()[0].outcome, "blocked");
  assert.ok(near(pl.v.hp, 100 - 3), `10 × 0.3 (${pl.v.hp})`);
  assert.ok(pl.v.st < 93, `cost 8 (${pl.v.st})`);
  pl.c.guard = GUARDS.shield;
  const before = pl.v.hp;
  run(2);
  sys.attack(en.c, ARCHETYPES.soldier.light[0]);
  run(0.6);
  assert.ok(near(before - pl.v.hp, 1), "10 × 0.1 with a shield");
});

test("guard breaks: a heavy breaks a raised guard (50 % through); running out of stamina does too", () => {
  const { sys, pl, en, run, hits, events } = duel();
  sys.block(en.c, true);
  run(0.5);
  sys.attack(pl.c, HEAVY);
  run(1);
  const h = hits()[0];
  assert.equal(h.outcome, "guardBreak");
  assert.ok(near(en.v.hp, 100 - 15), `half of 30 (${en.v.hp})`);
  assert.ok(events.some((e) => e.type === "stagger" && e.target === en.c && e.clip === "Hit_Chest" && near(e.seconds, 1.07)), "a weapon guard: no shield clip");
  assert.ok(!en.c.blocking, "the guard is down");
  // with a shield: the shield break
  const sh = duel({}, { guard: GUARDS.shield });
  sh.sys.block(sh.en.c, true);
  sh.run(0.5);
  sh.sys.attack(sh.pl.c, HEAVY);
  sh.run(1);
  assert.ok(sh.events.some((e) => e.type === "stagger" && e.target === sh.en.c && e.clip === "Idle_Shield_Break" && near(e.seconds, 1.07)));
  // a creature's guard (none in §8, but the rule holds): reels without a clip
  const cr = duel({}, { kind: "creature" });
  cr.sys.block(cr.en.c, true);
  cr.run(0.5);
  cr.sys.attack(cr.pl.c, HEAVY);
  cr.run(1);
  assert.ok(cr.events.some((e) => e.type === "stagger" && e.target === cr.en.c && e.reason === "guardBreak" && e.clip === null));

  // no stamina left (blocking refills 12/s meanwhile: not enough for the 11.2 a light costs)
  const t = duel({}, { st: 0 });
  t.sys.block(t.en.c, true);
  t.run(0.5);
  t.sys.attack(t.pl.c, LIGHT);
  t.run(0.4);
  assert.equal(t.hits()[0].outcome, "guardBreak");
  assert.ok(t.events.some((e) => e.type === "stagger" && e.target === t.en.c && e.clip === "Hit_Chest"));
  assert.ok(t.en.v.hp < 100 - 14 * 0.3, "the uncovered part gets through");
});

test("unparryable blows hit until the guard is up", () => {
  const { sys, pl, en, run, hits } = duel();
  const kick: AttackDef = ARCHETYPES.interrogator.special!;
  sys.attack(en.c, kick);
  // strike at 0.42 s of clip at 0.6× = 0.7 s: press 0.05 s before
  run(0.65);
  sys.block(pl.c, true);
  run(0.3);
  const h = hits()[0];
  assert.equal(h.outcome, "hit");
  assert.ok(h.push && near(Math.hypot(h.push.x, h.push.z), 1.5), "1.5 m knockback");
  assert.ok(pl.v.hp < 100);
});

test("sneak attacks: an unaware humanoid from behind dies; asleep or suspicious takes ×2", () => {
  const s = setup();
  const pl = s.add("player", "player", {});
  let aw: "unaware" | "alert" | "asleep" | "suspicious" = "unaware";
  // facing away from the player (forward = -Z)
  const en = s.add("enemy", "enemy", { z: -1.2, yaw: 0 }, { awareness: () => aw });
  s.sys.attack(pl.c, LIGHT);
  s.run(0.5);
  assert.equal(s.hits()[0].outcome, "backstab");
  assert.ok(en.c.dead);
  const t = setup();
  const p2 = t.add("player", "player", {});
  const wolf = t.add("wolf", "enemy", { z: -1.2, yaw: 0 }, { kind: "creature", hp: 140, awareness: () => aw });
  aw = "asleep";
  t.sys.attack(p2.c, LIGHT);
  t.run(0.5);
  assert.equal(wolf.v.hp, 140 - 28, "asleep: ×2, and it lives");
  // facing the player, unaware: no backstab
  aw = "unaware";
  const u = setup();
  const p3 = u.add("player", "player", {});
  const front = u.add("enemy", "enemy", { z: -1.2, yaw: Math.PI }, { awareness: () => aw });
  u.sys.attack(p3.c, LIGHT);
  u.run(0.5);
  assert.equal(front.v.hp, 86);
});

test("a shield soldier absorbs lights; heavies break its guard", () => {
  const { sys, pl, en, run, hits } = duel({ random: () => 0 }, { absorbLights: 0.45 });
  sys.attack(pl.c, LIGHT);
  run(0.5);
  assert.equal(hits()[0].outcome, "absorbed");
  assert.equal(en.v.hp, 100);
  sys.attack(pl.c, HEAVY);
  run(1);
  assert.equal(hits()[1].outcome, "guardBreak");
  assert.equal(en.v.hp, 85);
});

test("the passive shield meets the player's blows only: the companion's lights and heavies land", () => {
  const { sys, add, run, hits } = duel({ random: () => 0 }, { absorbLights: 0.45 });
  // Brun beside the player (the player's side), facing the shield soldier too
  const brun = add("brun", "player", { x: 0.5 });
  const companionHits = () => hits().filter((h) => h.attacker === brun.c);
  sys.attack(brun.c, LIGHT);
  run(0.5);
  assert.deepEqual(companionHits().map((h) => h.outcome), ["hit"], "not absorbed");
  sys.attack(brun.c, HEAVY);
  run(1);
  assert.deepEqual(companionHits().map((h) => h.outcome), ["hit", "hit"], "no passive guard break either");
});

test("parry from the press: pressAge eats into the window; presses in quick succession can't parry", () => {
  const atk = ARCHETYPES.soldier.light[0];
  // raised 0.1 s before the strike from a press made 0.15 s earlier: past the window (and not up yet)
  const a = duel();
  a.sys.attack(a.en.c, atk);
  a.run(0.3);
  a.sys.block(a.pl.c, true, { pressAge: 0.15 });
  a.run(0.3);
  assert.equal(a.hits()[0].outcome, "hit");
  // a press 0.35 s after one that didn't parry (and 0.1 s before the strike): locked out
  const b = duel();
  b.sys.block(b.pl.c, true);
  b.run(0.05);
  b.sys.block(b.pl.c, false);
  b.sys.attack(b.en.c, atk);
  b.run(0.3);
  b.sys.block(b.pl.c, true);
  b.run(0.3);
  assert.equal(b.hits()[0].outcome, "hit", "no parry inside the 0.4 s lockout");
  // after the lockout: parried; and a parry clears it, so the next press can parry at once
  b.sys.block(b.pl.c, false);
  b.run(2);
  b.sys.attack(b.en.c, atk);
  b.run(0.3);
  b.sys.block(b.pl.c, true);
  b.run(0.3);
  assert.equal(b.hits()[1].outcome, "parried");
  b.sys.block(b.pl.c, false);
  b.run(1.2);
  // (0.2 s after the last press would still be locked out without the parry)
  const c = duel();
  c.sys.attack(c.en.c, atk);
  c.run(0.3);
  c.sys.block(c.pl.c, true);
  c.run(0.15);
  assert.equal(c.hits()[0].outcome, "parried");
  c.sys.block(c.pl.c, false);
  c.run(1.15);
  c.sys.attack(c.en.c, atk);
  c.run(0.3);
  c.sys.block(c.pl.c, true);
  c.run(0.3);
  assert.equal(c.hits()[1].outcome, "parried", "a successful parry leaves no lockout");
  // an AI (no parry) is never locked out of blocking
  const d = duel();
  d.sys.block(d.en.c, true);
  d.sys.block(d.en.c, false);
  d.sys.block(d.en.c, true);
  d.run(0.5);
  assert.ok(d.en.c.guardUp);
});

test("poise: broken poise staggers; a giant spider only reels from heavies", () => {
  const { sys, pl, en, run, events } = duel({}, { poise: 20 });
  sys.attack(pl.c, LIGHT);
  run(0.5);
  sys.attack(pl.c, LIGHT);
  run(0.5);
  assert.ok(events.some((e) => e.type === "stagger" && e.target === en.c && e.reason === "poise"));
  const g = duel({}, { poise: 10, staggerBy: "heavy", kind: "creature" });
  g.sys.attack(g.pl.c, LIGHT);
  g.run(0.5);
  assert.ok(!g.events.some((e) => e.type === "stagger"), "a light breaks its poise but it doesn't reel");
  g.sys.attack(g.pl.c, HEAVY);
  g.run(1);
  assert.ok(g.events.some((e) => e.type === "stagger" && e.target === g.en.c && e.clip === null), "creatures reel without a clip");
});

test("attack tokens: at most the target's limit; released, or revoked by a lower limit", () => {
  const s = setup();
  const pl = s.add("player", "player", {}, { tokens: 2 });
  const [a, b, c] = ["a", "b", "c"].map((id, i) => s.add(id, "enemy", { x: i, z: -3 }).c);
  assert.ok(s.sys.requestToken(a, pl.c));
  assert.ok(s.sys.requestToken(b, pl.c));
  assert.ok(!s.sys.requestToken(c, pl.c), "a third waits");
  assert.ok(s.sys.requestToken(a, pl.c), "a holder asking again keeps it");
  s.sys.releaseToken(a);
  assert.ok(s.sys.requestToken(c, pl.c));
  s.sys.setTokenLimit(pl.c, 1);
  assert.deepEqual(s.sys.tokenHolders(pl.c), [b], "the latest holder loses its token");
  b.vitals.kill();
  s.run(STEP);
  assert.deepEqual(s.sys.tokenHolders(pl.c), [], "the dead hold none");
});

test("an essential companion goes down for 6 s and gets up at half health", () => {
  const s = setup();
  const comp = s.add("brun", "player", {}, { essential: true, hp: 200 });
  const en = s.add("enemy", "enemy", { z: -1.5, yaw: Math.PI });
  comp.v.apply({ damage: 199 });
  s.sys.attack(en.c, ARCHETYPES.soldier.light[0]);
  s.run(1);
  assert.ok(comp.c.down && !comp.c.dead);
  assert.ok(s.events.some((e) => e.type === "down"));
  assert.ok(!s.events.some((e) => e.type === "death"));
  s.run(6.1);
  assert.ok(!comp.c.down);
  assert.equal(comp.v.hp, 100);
  assert.ok(s.events.some((e) => e.type === "up"));
});

test("surrender at 30 %: defeated, no more attacks, still hittable", () => {
  const { sys, pl, en, run } = duel({}, { hp: 40, surrenderAt: 0.3 });
  sys.attack(pl.c, { ...LIGHT, damage: 30 });
  run(0.5);
  assert.ok(en.c.surrendered && en.c.defeated && !en.c.dead);
  assert.equal(sys.attack(en.c, ARCHETYPES.soldier.light[0]), null);
  sys.attack(pl.c, LIGHT);
  run(0.5);
  assert.ok(en.c.dead, "killing him later is still possible");
});

test("wind-ups: the tell, the rate change at the strike, adaptive 0.5× and hit-stop", () => {
  const { sys, pl, en, run, events } = duel();
  const rates: number[] = [];
  sys.attack(en.c, ARCHETYPES.soldier.light[0], { onRate: (r) => rates.push(r) });
  const w = events.find((e) => e.type === "windup");
  assert.ok(w && w.type === "windup" && near(w.tell, 0.4), "0.24 s of clip at 0.6×");
  run(1.2);
  assert.deepEqual(rates, [0.6, 1]);
  assert.ok(events.some((e) => e.type === "hitStop" && near(e.seconds, 0.05)), "50 ms on a light");
  assert.ok(events.some((e) => e.type === "shake"));
  en.c.windupRate = 0.5;
  sys.attack(en.c, ARCHETYPES.soldier.light[0]);
  const w2 = events.filter((e) => e.type === "windup")[1];
  assert.ok(w2 && w2.type === "windup" && near(w2.tell, 0.48));
  run(2);
  sys.attack(pl.c, HEAVY);
  run(1.2);
  assert.ok(events.some((e) => e.type === "hitStop" && near(e.seconds, 0.08)), "80 ms on a heavy");
});

test("death: announced once; the dead neither attack nor are hit", () => {
  const { sys, pl, en, run } = duel({}, { hp: 10 });
  let deaths = 0;
  sys.onDeath.on(() => deaths++);
  sys.attack(pl.c, LIGHT);
  run(0.5);
  assert.ok(en.c.dead);
  assert.equal(deaths, 1);
  assert.equal(sys.attack(en.c, LIGHT), null);
  sys.attack(pl.c, LIGHT);
  run(0.5);
  assert.equal(deaths, 1);
  sys.dispose();
});

test("only a combatant that can parry parries: an AI guard raised on the player's wind-up blocks the light", () => {
  const { sys, pl, en, run, hits, events } = duel();
  assert.ok(pl.c.canParry && !en.c.canParry, "the player parries; enemies don't by default");
  // the AI reacts to the player's wind-up event by raising its guard
  sys.events.on((e) => {
    if (e.type === "windup" && e.attacker === pl.c) sys.block(en.c, true);
  });
  sys.attack(pl.c, LIGHT);
  run(0.5);
  const h = hits()[0];
  assert.equal(h.outcome, "blocked", "raised 0.13 s before the strike: up (0.12 s), not a parry");
  assert.ok(near(en.v.hp, 100 - 14 * 0.3), `30 % through (${en.v.hp})`);
  assert.ok(!pl.c.staggered, "the player doesn't reel");
  assert.ok(!events.some((e) => e.type === "stagger" && e.target === pl.c));
  assert.equal(en.c.riposte, 0, "no riposte for the blocker");
  // raised later than the raise time before the strike: the blow lands
  const t = duel();
  t.sys.attack(t.pl.c, LIGHT);
  t.run(0.05);
  t.sys.block(t.en.c, true);
  t.run(0.5);
  assert.equal(t.hits()[0].outcome, "hit");
  // the same press by a combatant allowed to parry is a parry
  const u = duel({}, { canParry: true });
  u.sys.events.on((e) => {
    if (e.type === "windup" && e.attacker === u.pl.c) u.sys.block(u.en.c, true);
  });
  u.sys.attack(u.pl.c, LIGHT);
  u.run(0.5);
  assert.equal(u.hits()[0].outcome, "parried");
});

test("a parried creature reels without a humanoid clip", () => {
  const { sys, pl, en, run, events } = duel({}, { kind: "creature" });
  sys.attack(en.c, ARCHETYPES.smallSpider.light[0]);
  // the bite strikes at 0.4 s of clip at 0.7× ≈ 0.57 s
  run(0.45);
  sys.block(pl.c, true);
  run(0.4);
  const st = events.find((e) => e.type === "stagger" && e.target === en.c);
  assert.ok(st && st.type === "stagger" && st.reason === "parried" && st.clip === null);
});

test("resetState: a downed essential companion is up with its restored HP and stays so", () => {
  const s = setup();
  const comp = s.add("brun", "player", {}, { essential: true, hp: 200 });
  const en = s.add("enemy", "enemy", { z: -1.5, yaw: Math.PI });
  const start = comp.v.snapshot();
  comp.v.kill();
  s.run(STEP);
  assert.ok(comp.c.down);
  // a riposte left over too
  comp.c.riposteLeft = 1;
  s.sys.resetState(comp.c, start);
  assert.ok(!comp.c.down && !comp.c.staggered && comp.c.riposte === 0);
  assert.equal(comp.v.hp, 200);
  assert.ok(s.events.some((e) => e.type === "up" && e.target === comp.c));
  assert.ok(s.sys.requestToken(en.c, comp.c), "targetable again");
  s.run(7);
  assert.equal(comp.v.hp, 200, "no late get-up at 50 % overwriting it");
  // a number revives at that fraction
  const pl = s.add("player", "player", {});
  pl.v.kill();
  s.run(STEP);
  s.sys.resetState(pl.c, 1);
  assert.ok(pl.c.active && pl.v.hp === 100);
  assert.ok(s.sys.attack(pl.c, LIGHT), "can attack again");
});

test("difficulty and content multipliers are separate; team is faction; update is step", () => {
  const s = setup();
  const pl = s.add("player", "player", {});
  const en = s.sys.add({ id: "enemy", team: "enemy", vitals: new Vitals({ health: 100 }), position: () => ({ x: 0, y: 0, z: -1.5 }), yaw: () => Math.PI, damageMul: 0.8 });
  assert.equal(en.faction, "enemy");
  assert.equal(en.team, "enemy");
  en.difficultyMul = 0.75;
  en.difficultyWindup = 0.5;
  const w = s.sys.attack(en, ARCHETYPES.soldier.light[0])!;
  assert.equal(w.rate, 0.5, "the slower wind-up wins");
  for (let i = 0; i < 60; i++) s.sys.update(STEP);
  assert.ok(near(pl.v.hp, 100 - 10 * 0.8 * 0.75), `10 × 0.8 × 0.75 (${pl.v.hp})`);
  assert.throws(() => s.sys.add({ id: "x", vitals: new Vitals({ health: 1 }), position: () => ({ x: 0, y: 0, z: 0 }), yaw: () => 0 }));
});
