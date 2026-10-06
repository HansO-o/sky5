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
  let torch: { x: number; z: number } | null = null;
  const s = f.creature("sp", "smallSpider", { x: 0, y: 0, z: -5 }, { fear: () => torch });
  f.run(0.3);
  torch = { x: s.agent.position.x + 1, z: s.agent.position.z };
  f.until(() => s.brain.state === "backoff", 1);
  assert.equal(s.brain.state, "backoff");
  const t = f.until(() => s.brain.state !== "backoff", 2);
  assert.ok(t > 0.9 && t < 1.2, `backed off ${t.toFixed(2)} s`);
});
