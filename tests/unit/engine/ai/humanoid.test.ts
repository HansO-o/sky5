import { test } from "node:test";
import assert from "node:assert/strict";
import { PLAYER_WEAPONS } from "../../../../src/engine/combat/attacks";
import type { CombatEvent } from "../../../../src/engine/combat/CombatSystem";
import { dist, fight, STEP } from "../../helpers/ai";

/** `want` appears in `seq` in this order (other entries may come between). */
function inOrder(seq: readonly string[], want: readonly string[]) {
  let i = 0;
  for (const s of seq) if (s === want[i]) i++;
  return i === want.length;
}

test("engaged: alert → approach → attack (wind-up at 0.6×, then 1×) → recover (_Rec at 1.2×) → circle; the blow lands", () => {
  const f = fight();
  const e = f.enemy("s1", "soldier", { x: 0, y: 0, z: -8, yaw: 0 });
  assert.equal(e.brain.state, "alert", "without senses it starts in the fight");
  let windup: Extract<CombatEvent, { type: "windup" }> | null = null;
  f.combat.events.on((ev) => {
    if (ev.type === "windup" && ev.attacker === e.c && !windup) windup = ev;
  });
  const t = f.until(() => e.brain.state === "attack", 8);
  assert.ok(t < 8, `attacks within 8 s (states ${e.states.join(" ")})`);
  assert.ok(dist(e.agent.position, f.pl.p) <= 1.65, "struck from within its strike distance");
  assert.ok(windup, "the tell");
  const glint = e.events.find((ev) => ev.type === "glint");
  assert.ok(glint && glint.type === "glint", "the wind-up glints");
  assert.equal(glint.attack, e.c.swing?.attack.id);
  assert.ok(glint.seconds !== undefined && Math.abs(glint.seconds - e.c.swing!.attack.active[0] / 0.6) < 1e-6, `the glint knows the tell (${glint.seconds})`);
  assert.ok(Math.abs(glint.at.y - 1.45) < 0.01 && dist(glint.at, e.agent.position) < 0.6, "at the weapon's height, in front");
  const swing = e.c.swing!;
  assert.ok(swing, "a swing in progress");
  assert.ok(Math.abs(swing.rate - 0.6) < 1e-9, "the wind-up plays at 0.6×");
  assert.equal(e.agent.acting, swing.attack.clip, "the attack clip plays on the body");
  f.until(() => swing.time >= swing.attack.active[0] + 0.01, 3);
  assert.ok(Math.abs(swing.rate - 1) < 1e-9, "1× from the strike on");
  assert.ok(Math.abs(e.agent.played[e.agent.played.length - 1].speed - 1) < 1e-9, "the clip's rate follows");
  f.until(() => e.brain.state === "circle", 6);
  assert.ok(inOrder(e.states, ["alert", "approach", "attack", "recover", "circle"]), e.states.join(" "));
  const rec = e.agent.played.find((p) => p.clip.endsWith("_Rec"));
  assert.ok(rec && Math.abs(rec.speed - 1.2) < 1e-9, "the recovery at 1.2×");
  assert.ok(f.player.vitals.hp < 100, "the player was hit");
  assert.equal(f.combat.tokenOf(e.c), null, "the turn is given back after the sequence");
  assert.equal(e.agent.acting, null, "the body is back on its locomotion");
});

test("tokens: at most 2 attack the player at once; a third circles and gets its turn later", () => {
  const f = fight();
  const es = [-2, 0, 2].map((x, i) => f.enemy(`s${i}`, "soldier", { x, y: 0, z: -6 }));
  let max = 0;
  f.run(25, () => {
    max = Math.max(max, f.combat.tokenHolders(f.player).length);
  });
  assert.ok(max <= 2, `holders ${max}`);
  assert.equal(max, 2, "two at once at some point");
  for (const e of es) {
    assert.ok(e.states.includes("attack"), `${e.c.id} got a turn (${e.states.join(" ")})`);
    assert.ok(e.states.includes("circle"), `${e.c.id} circled while waiting`);
  }
});

test("block against a blow coming at it; staggers and knockdowns run their time, then back to the fight", () => {
  const f = fight({ random: () => 0 });
  const e = f.enemy("cap", "guardCaptain", { x: 0, y: 0, z: -1.5, yaw: Math.PI });
  // (before its first think, while it is still taking in the alert)
  const swing = f.combat.attack(f.player, PLAYER_WEAPONS.sword.light[0], { target: e.c });
  assert.ok(swing);
  assert.equal(e.brain.state, "block", "the guard goes up at the wind-up");
  assert.ok(e.c.blocking);
  f.run(0.5);
  const hit = f.combatEvents.find((ev) => ev.type === "hit" && ev.hit.target === e.c);
  assert.ok(hit && hit.type === "hit" && hit.hit.outcome === "blocked", "the blow met the guard");
  f.until(() => e.brain.state !== "block", 3);
  assert.ok(["circle", "approach", "attack"].includes(e.brain.state), e.brain.state);
  assert.equal(e.c.blocking, false, "guard down after");

  f.combat.stagger(e.c, 0.9, { clip: "Hit_Chest", from: f.pl.p });
  assert.equal(e.brain.state, "stagger");
  assert.equal(e.agent.acting, "Hit_Chest");
  f.run(0.8);
  assert.equal(e.brain.state, "stagger", "still reeling at 0.8 s");
  f.run(0.25);
  assert.notEqual(e.brain.state, "stagger", "back at 0.9 s");

  f.combat.stagger(e.c, 1.6, { clip: "Hit_Knockback", knockdown: true });
  f.run(1.65);
  assert.equal(e.brain.state, "stagger", "getting up after the knockdown");
  assert.equal(e.agent.acting, "LayToIdle");
  f.until(() => e.brain.state !== "stagger", 3);
  assert.ok(e.brain.fighting);
});

test("dead: a ragdoll for at most 2 live at once, a death clip for the rest; the body stops for good", () => {
  const f = fight();
  let ragdolls = 0;
  const frozen: (() => void)[] = [];
  const es = [0, 1, 2].map((i) => f.enemy(`s${i}`, "soldier", { x: i * 2, y: 0, z: -6 }, { ragdoll: (_hit, done) => (ragdolls++, frozen.push(done), true) }));
  f.run(0.5);
  f.combat.debugKillAll(f.player);
  for (const e of es) assert.equal(e.brain.state, "dead");
  assert.equal(ragdolls, 2);
  assert.equal(f.ai.ragdolls.active, 2);
  const died = es.map((e) => e.events.find((ev) => ev.type === "died"));
  assert.equal(died.filter((d) => d && d.type === "died" && d.ragdoll).length, 2);
  const clip = es.find((e, i) => died[i]?.type === "died" && !(died[i] as { ragdoll: boolean }).ragdoll)!;
  assert.match(clip.agent.acting ?? "", /^Death0[12]$/);
  for (const e of es) assert.ok(e.agent.released);
  const at = { ...es[0].agent.position };
  f.run(2);
  assert.deepEqual(es[0].agent.position, at);
  assert.equal(f.combat.tokenHolders(f.player).length, 0);
  // the slots stay taken however long the ragdolls lie live: they free up when frozen, or with the brain
  f.run(10);
  assert.equal(f.ai.ragdolls.active, 2);
  frozen[0]();
  assert.equal(f.ai.ragdolls.active, 1, "frozen: a slot is free");
  const ragdolled = es.filter((_, i) => died[i]?.type === "died" && (died[i] as { ragdoll: boolean }).ragdoll);
  ragdolled[1].brain.dispose();
  assert.equal(f.ai.ragdolls.active, 0, "a disposed brain lets go of its slot");
  frozen[1]();
  assert.equal(f.ai.ragdolls.active, 0);
  // a ragdoll the content declines gives the slot straight back
  const f2 = fight();
  const e2 = f2.enemy("x", "soldier", { x: 0, y: 0, z: -6 }, { ragdoll: () => false });
  f2.run(0.3);
  f2.combat.debugKillAll(f2.player);
  assert.equal(e2.brain.state, "dead");
  assert.equal(f2.ai.ragdolls.active, 0);
  assert.match(e2.agent.acting ?? "", /^Death0[12]$/);
});

test("surrender: the assistant gives up at 30 % HP, kneels and makes no more attacks", () => {
  const f = fight();
  const e = f.enemy("asst", "assistant", { x: 0, y: 0, z: -1.5, yaw: Math.PI });
  f.run(0.3);
  f.combat.strike(f.player, e.c, { ...PLAYER_WEAPONS.sword.light[0], damage: 29, poiseDamage: 0 });
  assert.equal(e.brain.state, "surrender");
  assert.equal(e.agent.acting, "Crying");
  assert.ok(e.c.surrendered && e.c.defeated);
  const before = f.combatEvents.length;
  f.run(5);
  assert.ok(!f.combatEvents.slice(before).some((ev) => ev.type === "windup" && ev.attacker === e.c), "no attack after giving up");
  assert.equal(f.combat.tokenOf(e.c), null);
  assert.ok(e.events.some((ev) => ev.type === "bark" && ev.kind === "surrender"));
});

test("scripted: ai.suspend hands the body to a script until resume, a scope's end, or (untilHit) the first blow", () => {
  const f = fight();
  const e = f.enemy("interrog", "interrogator", { x: 0, y: 0, z: -6, yaw: Math.PI }, { aware: false });
  assert.equal(e.brain.state, "post");
  assert.ok(f.ai.suspend("interrog"));
  assert.equal(e.brain.state, "scripted");
  assert.ok(e.agent.suspended);
  assert.equal(e.c.spec.awareness?.(), "alert", "no backstab on a scripted actor");
  f.run(2);
  assert.equal(e.brain.state, "scripted", "it waits");
  assert.ok(f.ai.resume(e.c));
  assert.equal(e.brain.state, "post");
  assert.equal(e.agent.suspended, false);

  const fns: (() => void)[] = [];
  f.ai.suspend(e.c, { scope: { add: (fn: () => void) => void fns.push(fn) } });
  assert.equal(e.brain.state, "scripted");
  for (const fn of fns) fn();
  assert.equal(e.brain.state, "post", "the scope ended");

  f.ai.suspend("interrog", { untilHit: true });
  f.run(1);
  assert.equal(e.brain.state, "scripted");
  f.combat.strike(f.player, e.c, { ...PLAYER_WEAPONS.sword.light[0], poiseDamage: 0 });
  assert.ok(e.brain.fighting, `the first blow gives it back, fighting (${e.brain.state})`);
  assert.equal(f.ai.suspend("nobody"), false);
});

test("perception: footsteps make an unaware guard suspicious; it investigates, gives up, goes back to its post; sight alerts it", () => {
  const f = fight();
  f.pl.p = { x: 0, y: 0, z: -7 };
  f.ai.noise.source(() => (f.pl.moving ? { kind: "walk", at: f.pl.p, source: "player" } : null));
  // the guard looks away from the player (−Z); the player is 3 m behind it
  const e = f.enemy("g", "soldier", { x: 0, y: 0, z: -10, yaw: 0 }, { perceive: true });
  assert.equal(e.brain.state, "post");
  assert.equal(e.c.spec.awareness?.(), "unaware");
  f.pl.moving = true;
  const t = f.until(() => e.brain.state === "suspicious", 4);
  assert.ok(t < 4, "heard");
  assert.equal(e.c.spec.awareness?.(), "suspicious");
  f.pl.moving = false;
  f.pl.hidden = true;
  f.until(() => dist(e.agent.position, { x: 0, z: -10 }) > 0.5, 3);
  assert.ok(dist(e.agent.position, { x: 0, z: -10 }) > 0.5, "walks toward the noise");
  const gaveUp = f.until(() => e.brain.state === "post", 20);
  assert.ok(gaveUp < 9, `gave up after arriving and looking around (${gaveUp.toFixed(1)} s), not by the 12 s timeout`);
  assert.ok(e.events.some((ev) => ev.type === "bark" && ev.kind === "calm"));
  f.until(() => dist(e.agent.position, { x: 0, z: -10 }) < 0.7, 10);
  assert.ok(dist(e.agent.position, { x: 0, z: -10 }) < 0.7, "back at its post");

  // in front of it, in plain sight
  f.pl.hidden = false;
  f.pl.p = { x: 0, y: 0, z: -15 };
  f.until(() => e.brain.fighting, 6);
  assert.ok(e.brain.fighting, e.brain.state);
  assert.ok(inOrder(e.states, ["post", "suspicious", "post", "alert"]), e.states.join(" "));
  assert.ok(e.events.some((ev) => ev.type === "bark" && ev.kind === "alert"));
});

test("a shout alerts the faction within 15 m and the whole group, not the rest", () => {
  const f = fight();
  const a = f.enemy("a", "soldier", { x: 0, y: 0, z: -5 }, { aware: false, group: "g1" });
  const near = f.enemy("near", "soldier", { x: 10, y: 0, z: -5 }, { aware: false });
  const far = f.enemy("far", "soldier", { x: 25, y: 0, z: -5 }, { aware: false });
  const grouped = f.enemy("grouped", "soldier", { x: 40, y: 0, z: -5 }, { aware: false, group: "g1" });
  const other = f.enemy("other", "soldier", { x: 5, y: 0, z: -5 }, { aware: false, faction: "neutral" });
  a.brain.engage(f.player);
  assert.ok(a.brain.fighting);
  assert.ok(near.brain.fighting, "within 15 m");
  assert.ok(grouped.brain.fighting, "its group");
  assert.equal(far.brain.state, "post", "25 m away");
  assert.equal(other.brain.state, "post", "another faction");
  f.run(STEP);
});

test("a first blow that staggers a calm guard alerts its neighbours too", () => {
  const f = fight();
  const a = f.enemy("a", "soldier", { x: 0, y: 0, z: -1.5, yaw: Math.PI }, { aware: false });
  const b = f.enemy("b", "soldier", { x: 6, y: 0, z: -3 }, { aware: false });
  f.combat.strike(f.player, a.c, { ...PLAYER_WEAPONS.sword.heavy, damage: 5, poiseDamage: 100 });
  assert.equal(a.brain.state, "stagger");
  assert.ok(b.brain.fighting, b.brain.state);
});

test("archer: shoots from range (draw 1.2 s, glint at 0.6 s, the arrow flies at 35 m/s); a knife within 4 m", () => {
  const f = fight();
  const e = f.enemy("arch", "archer", { x: 0, y: 0, z: -12, yaw: 0 });
  f.until(() => e.brain.state === "shoot", 3);
  assert.equal(e.brain.state, "shoot");
  assert.equal(e.agent.acting, "Bow_Aim_Neutral");
  const t0 = f.until(() => e.events.some((ev) => ev.type === "glint"), 2);
  assert.ok(t0 > 0.5 && t0 < 0.7, `glint at ${t0}`);
  f.until(() => e.events.some((ev) => ev.type === "shoot"), 1);
  const shot = e.events.find((ev) => ev.type === "shoot");
  assert.ok(shot && shot.type === "shoot" && Math.abs(shot.seconds - 12 / 35) < 0.05);
  f.run(0.6);
  assert.equal(f.player.vitals.hp, 90, "the arrow landed");
  // a player who steps aside is missed
  f.until(() => e.brain.state === "shoot" && e.events.filter((ev) => ev.type === "shoot").length === 1, 8);
  f.until(() => e.events.filter((ev) => ev.type === "shoot").length === 2, 3);
  f.pl.p = { x: 3, y: 0, z: 0 };
  f.run(0.6);
  assert.equal(f.player.vitals.hp, 90, "out of the way");
  // up close: the knife
  f.pl.p = { x: 0, y: 0, z: -9.5 };
  f.until(() => e.c.swing?.attack.id === "knife", 10);
  assert.equal(e.c.swing?.attack.id, "knife");
});

test("an arrow already in the air when its archer dies still lands (the flight is seen; arrows are unparryable, not cancelled)", () => {
  const f = fight();
  const e = f.enemy("arch", "archer", { x: 0, y: 0, z: -20, yaw: 0 });
  f.until(() => e.events.some((ev) => ev.type === "shoot"), 4);
  assert.ok(e.events.some((ev) => ev.type === "shoot"));
  f.combat.debugKillAll(f.player);
  assert.equal(e.brain.state, "dead");
  f.run(0.8);
  assert.equal(f.player.vitals.hp, 90, "the arrow landed");
});
