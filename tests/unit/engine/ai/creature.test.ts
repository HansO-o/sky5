import { test } from "node:test";
import assert from "node:assert/strict";
import type { NoiseKind } from "../../../../src/engine/ai/noise";
import { PLAYER_WEAPONS } from "../../../../src/engine/combat/attacks";
import { dist, fight } from "../../helpers/ai";

const SLEEP = { sleep: "wolf_lie", stir: "wolf_head_up", wake: "wolf_stand" };
const BED = { x: 0, y: 0, z: -6, yaw: Math.PI };

/** The sleeping wolf on its bed, the player 6 m away making `noise` while it moves. */
function den() {
  const f = fight();
  let kind: NoiseKind | null = null;
  f.ai.noise.source(() => (kind ? { kind, at: f.pl.p, source: "player" } : null));
  const w = f.creature("wolf", "wolf", { ...BED }, { perceive: true, asleep: true, sleep: SLEEP, leash: { home: BED, radius: 18 } });
  const noise = (k: NoiseKind | null) => {
    kind = k;
    f.pl.moving = !!k;
    f.pl.sneaking = k === "sneak";
  };
  return { ...f, w, noise };
}

test("the wolf: sneaking never wakes it; walking at 6 m stirs it; it settles again; running wakes it in about 2 s", () => {
  const { w, noise, run, until } = den();
  assert.equal(w.brain.state, "asleep");
  assert.equal(w.agent.acting, "wolf_lie");
  assert.equal(w.c.spec.awareness?.(), "asleep", "a sneak attack does double damage");
  noise("sneak");
  run(20);
  assert.equal(w.brain.state, "asleep", "sneaking at 6 m");
  noise("walk");
  const stir = until(() => w.brain.state === "stir", 12);
  assert.ok(stir > 3 && stir < 8, `stirs after ${stir.toFixed(1)} s of walking`);
  assert.equal(w.agent.acting, "wolf_head_up");
  assert.ok(w.events.some((e) => e.type === "bark" && e.kind === "stir"));
  noise(null);
  const settle = until(() => w.brain.state === "asleep", 8);
  assert.ok(settle < 8, "back asleep once it is quiet");
  noise("run");
  const wake = until(() => w.brain.state === "wake", 5);
  assert.ok(wake > 1 && wake < 3, `wakes after ${wake.toFixed(1)} s of running`);
  assert.equal(w.agent.acting, "wolf_stand", "stands up first");
  assert.ok(w.events.some((e) => e.type === "bark" && e.kind === "wake"));
  until(() => w.brain.fighting, 3);
  assert.ok(w.brain.fighting);
});

test("the wolf wakes at once: a blow, the player too close, a clash nearby", () => {
  {
    const { w, combat, player, run } = den();
    combat.strike(player, w.c, { ...PLAYER_WEAPONS.sword.light[0], poiseDamage: 0 });
    run(0.05);
    assert.ok(w.brain.state === "wake" || w.brain.fighting, w.brain.state);
    assert.ok(w.c.vitals.hp <= 140 - 28, "asleep: double damage");
  }
  {
    const { w, pl, run } = den();
    pl.p = { x: 0, y: 0, z: -3.5 };
    pl.sneaking = true;
    run(0.5);
    assert.equal(w.brain.state, "asleep", "sneaking 2.5 m away");
    pl.p = { x: 0, y: 0, z: -4.2 };
    pl.sneaking = false;
    run(0.5);
    assert.equal(w.brain.state, "wake", "within 3 m, not sneaking");
  }
  {
    const { w, ai, run } = den();
    ai.noise.emit({ kind: "clash", at: { x: 8, y: 1, z: -6 } });
    run(0.5);
    assert.equal(w.brain.state, "wake", "a clash 8 m away");
  }
});

test("the leash: a target beyond 18 m sends it home; it rests there and sleeps again after 20 s", () => {
  const { w, pl, run, until, combat, player } = den();
  combat.strike(player, w.c, { ...PLAYER_WEAPONS.sword.light[0], poiseDamage: 0 });
  until(() => w.brain.fighting, 3);
  pl.p = { x: 0, y: 0, z: 2 };
  run(2);
  assert.ok(w.brain.fighting);
  assert.ok(dist(w.agent.position, BED) > 1, "it chased");
  pl.p = { x: 21, y: 0, z: -6 };
  const back = until(() => w.brain.state === "return", 4);
  assert.ok(back >= 1.4 && back < 4, `goes home after ${back.toFixed(1)} s`);
  assert.ok(w.events.some((e) => e.type === "bark" && e.kind === "leash"));
  until(() => w.brain.state === "rest", 10);
  assert.equal(w.brain.state, "rest");
  assert.ok(dist(w.agent.position, BED) <= 0.9);
  run(19);
  assert.equal(w.brain.state, "rest");
  run(1.5);
  assert.equal(w.brain.state, "asleep");
  assert.equal(w.agent.acting, "wolf_lie");
});

test("a spider: approach at its speed → bite → back off 1.5 m (walk clip backwards) → circle 3–5 m for 1.5–3 s → again", () => {
  const f = fight();
  const s = f.creature("sp", "smallSpider", { x: 0, y: 0, z: -10 });
  assert.equal(s.brain.state, "alert");
  f.until(() => s.brain.state === "attack", 6);
  assert.equal(s.brain.state, "attack");
  assert.equal(s.agent.acting, s.c.swing?.attack.clip);
  f.until(() => s.brain.state === "backoff", 3);
  const from = { ...s.agent.position };
  f.until(() => s.brain.state === "circle", 3);
  const back = dist(s.agent.position, from);
  assert.ok(back > 1.2 && back < 1.8, `backed off ${back.toFixed(2)} m`);
  assert.equal(s.agent.acting, null, "back on its locomotion");
  const circling = f.until(() => s.brain.state !== "circle", 6);
  assert.ok(circling >= 1.4, `circled ${circling.toFixed(1)} s`);
  f.until(() => s.states.filter((x) => x === "attack").length >= 2, 8);
  assert.ok(s.states.filter((x) => x === "attack").length >= 2, s.states.join(" "));
});

test("small spiders back off for 1 s from within 2 m of the companion's torch", () => {
  const f = fight();
  // the companion with the torch walks in beside it as it approaches (still out of lunge range)
  let lit = false;
  const s = f.creature("sp", "smallSpider", { x: 0, y: 0, z: -10 }, { fear: () => (lit ? { x: s.agent.position.x + 1, z: s.agent.position.z } : null) });
  f.run(0.3);
  assert.equal(s.brain.state, "approach");
  lit = true;
  f.until(() => s.brain.state === "backoff", 1);
  assert.equal(s.brain.state, "backoff");
  assert.ok(!s.states.includes("attack"), "the fear, not a strike's back-off");
  const t = f.until(() => s.brain.state !== "backoff", 2);
  assert.ok(t > 0.9 && t < 1.2, `backed off ${t.toFixed(2)} s (${s.states.join(" ")})`);
});

test("a noise beyond the leash never wakes it, nor jams its senses: it stirs, settles, and still wakes up close", () => {
  const f = fight();
  let kind: NoiseKind | null = null;
  f.ai.noise.source(() => (kind ? { kind, at: f.pl.p, source: "player" } : null));
  // the den ends at z = 0 (the climb starts there)
  const w = f.creature("wolf", "wolf", { ...BED }, { perceive: true, asleep: true, sleep: SLEEP, leash: { home: BED, radius: 18, inside: (p) => p.z < 0 } });
  // sprinting 10 m from the bed, up the climb
  f.pl.p = { x: 0, y: 0, z: 4 };
  kind = "sprint";
  f.pl.moving = true;
  let woke = false;
  f.run(8, () => void (woke ||= w.brain.state === "wake" || w.brain.fighting));
  assert.equal(woke, false, "never woke");
  assert.equal(w.brain.state, "stir", "a warning");
  assert.notEqual(w.brain.sensor!.level, "alert");
  assert.ok(f.ai.perception.awareness() < 1, `the stealth eye is not stuck on "seen" (${f.ai.perception.awareness()})`);
  kind = null;
  f.pl.moving = false;
  f.until(() => w.brain.state === "asleep", 10);
  assert.equal(w.brain.state, "asleep", "settles again");
  assert.ok(f.ai.perception.awareness() < 0.35);
  // running right past it: proximity still wakes it
  f.pl.p = { x: 1.5, y: 0, z: -6 };
  kind = "run";
  f.pl.moving = true;
  const t = f.until(() => w.brain.state === "wake", 2);
  assert.ok(t < 1, `woke after ${t.toFixed(2)} s`);
});

test("leashed without senses (the giant spider): home after the leash, then it turns on a foe that comes close again", () => {
  const f = fight();
  const HOME = { x: 0, y: 0, z: -20, yaw: 0 };
  const s = f.creature("giant", "giantSpider", { ...HOME }, { leash: { home: HOME, radius: 8 } });
  f.pl.p = { x: 0, y: 0, z: -15 };
  f.until(() => s.brain.state === "attack", 8);
  assert.equal(s.brain.state, "attack");
  // the player leaves its chamber
  f.pl.p = { x: 0, y: 0, z: 0 };
  f.until(() => s.brain.state === "return", 5);
  assert.equal(s.brain.state, "return");
  f.until(() => s.brain.state === "idle", 15);
  assert.equal(s.brain.state, "idle");
  // standing at the chamber's edge, out of reach of its aggro: it stays home
  f.pl.p = { x: 0, y: 0, z: -11 };
  f.run(3);
  assert.equal(s.brain.state, "idle");
  // walking in: it turns on the player again
  f.pl.p = { x: 0, y: 0, z: -15 };
  const t = f.until(() => s.brain.fighting, 2);
  assert.ok(t < 0.5, `re-engaged after ${t.toFixed(2)} s`);
  assert.equal(s.brain.target, f.player);
});

test("a blow that staggers the sleeping wolf jolts it awake: it reels where it lies and stands up (wake bark) before it fights", () => {
  const { w, combat, player, run, until } = den();
  // a heavy sneak attack (×2): its poise breaks
  combat.strike(player, w.c, { ...PLAYER_WEAPONS.sword.heavy, poiseDamage: 100 });
  assert.equal(w.brain.state, "wake", w.states.join(" "));
  assert.ok(!w.states.includes("stagger"), "no stagger before it stands up");
  assert.equal(w.agent.acting, "wolf_stand", "the stand-up segment plays");
  assert.ok(w.events.some((e) => e.type === "bark" && e.kind === "wake"), "the howl's cue");
  run(0.1);
  assert.ok(dist(w.agent.position, BED) > 0.05, "it reels: pushed away from the blow");
  until(() => w.brain.fighting, 3);
  assert.ok(w.brain.fighting);
  assert.equal(w.brain.target, player, "on whoever hurt it");
});

test("reset() and sleep(): a beast built asleep goes back to sleep with its meter at 0; sleep() puts a leashed one back on its bed", () => {
  const { w, combat, player, pl, run, until } = den();
  combat.strike(player, w.c, { ...PLAYER_WEAPONS.sword.light[0], poiseDamage: 0 });
  until(() => w.brain.fighting, 3);
  pl.p = { x: 0, y: 0, z: 1 };
  run(1.5);
  assert.ok(w.brain.fighting);
  // a checkpoint resume: everything back as it was (the content puts it on its bed)
  w.agent.teleport(BED, BED.yaw);
  w.brain.reset();
  assert.equal(w.brain.state, "asleep");
  assert.equal(w.agent.acting, "wolf_lie");
  assert.equal(w.brain.sensor!.meter, 0);
  assert.equal(w.brain.sensor!.level, "unaware");
  assert.equal(w.c.spec.awareness?.(), "asleep");
  assert.equal(w.brain.target, null);
  pl.p = { x: 0, y: 0, z: 0 };
  run(2);
  assert.equal(w.brain.state, "asleep", "and it stays asleep while all is quiet");

  // awake and away from its bed: sleep() brings it home asleep
  combat.strike(player, w.c, { ...PLAYER_WEAPONS.sword.light[0], poiseDamage: 0 });
  until(() => w.brain.fighting, 3);
  run(2);
  assert.ok(dist(w.agent.position, BED) > 1);
  assert.equal(w.brain.sleep(), true);
  assert.equal(w.brain.state, "asleep");
  assert.ok(dist(w.agent.position, BED) < 1e-6, "on its bed");
  assert.equal(w.brain.sensor!.meter, 0);

  // a creature without sleep clips can't
  const f = fight();
  const s = f.creature("sp", "smallSpider", { x: 0, y: 0, z: -10 });
  assert.equal(s.brain.sleep(), false);
  s.brain.reset();
  assert.equal(s.brain.state, "idle");
});
