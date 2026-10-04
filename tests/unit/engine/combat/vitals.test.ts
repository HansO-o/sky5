import { test } from "node:test";
import assert from "node:assert/strict";
import { Vitals } from "../../../../src/engine/combat/vitals";
import { TimeScale } from "../../../../src/engine/core/timeScale";
import { Emitter } from "../../../../src/engine/core/emitter";

const near = (a: number, b: number, eps = 1e-6) => Math.abs(a - b) < eps;
const tick = (v: Vitals, seconds: number, o: { combat?: boolean; blocking?: boolean } = {}) => {
  for (let i = 0; i < Math.round(seconds * 60); i++) v.update(1 / 60, o);
};

test("damage goes through armour; poise breaks, staggers and refills", () => {
  const v = new Vitals({ health: 100, poise: 50, armourMul: 0.85 });
  const r = v.apply({ damage: 10, poise: 30 });
  assert.ok(near(r.damage, 8.5) && !r.staggered && !r.killed);
  assert.ok(near(v.hp, 91.5));
  assert.equal(v.poise.value, 20);
  const s = v.apply({ damage: 10, poise: 30 });
  assert.ok(s.staggered, "poise 20 − 30 breaks");
  assert.equal(v.poise.value, 50, "a broken poise comes back whole");
  v.apply({ damage: 0, poise: 20 });
  tick(v, 1.9);
  assert.equal(v.poise.value, 30, "not before 2 s");
  tick(v, 0.2);
  assert.equal(v.poise.value, 50, "refilled 2 s after the last hit");
});

test("stamina: spend, the 0.8 s delay, 24/s, 12/s while blocking; heavies need all of it", () => {
  const v = new Vitals({ health: 100 });
  assert.ok(v.spend(30));
  assert.equal(v.st, 70);
  tick(v, 0.75);
  assert.equal(v.st, 70, "nothing within 0.8 s");
  tick(v, 1.05);
  assert.ok(near(v.st, 70 + 24 * 1, 0.5), `24/s after the delay (${v.st})`);
  v.drain(100);
  assert.equal(v.st, 0);
  assert.ok(!v.spend(8), "an empty gauge spends nothing");
  tick(v, 1, { blocking: true });
  assert.ok(near(v.st, 12, 0.3), `12/s while blocking (${v.st})`);
  assert.ok(!v.spend(24, { full: true }), "a heavy needs all 24");
  const before = v.st;
  assert.ok(v.spend(8), "a light only needs some");
  assert.ok(near(v.st, before - 8));
  assert.ok(near(v.drain(10), 10 - (before - 8)), "drain reports what there was none for");
  assert.equal(v.st, 0);
});

test("health regenerates only out of combat, 6 s after the last damage", () => {
  const v = new Vitals({ health: 100, healthRegen: 4, healthDelay: 6 });
  v.apply({ damage: 40 });
  tick(v, 5.9);
  assert.ok(near(v.hp, 60), "not before 6 s");
  tick(v, 1.1);
  assert.ok(v.hp > 63 && v.hp < 65, `4/s after (${v.hp})`);
  const hp = v.hp;
  tick(v, 2, { combat: true });
  assert.equal(v.hp, hp, "none in combat");
});

test("potions heal over time, venom hurts over time, death is announced once", () => {
  const v = new Vitals({ health: 100 });
  v.apply({ damage: 80 });
  v.healOver(50, 1.5);
  tick(v, 0.75);
  assert.ok(near(v.hp, 45, 0.5), `half way (${v.hp})`);
  tick(v, 1);
  assert.ok(near(v.hp, 70, 0.5), `all of it (${v.hp})`);
  let deaths = 0;
  v.onDeath.on(() => deaths++);
  v.addDot(2, 4);
  tick(v, 4.5);
  assert.ok(near(v.hp, 62, 0.5), `venom 2/s × 4 s, no armour (${v.hp})`);
  v.apply({ damage: 500 });
  v.apply({ damage: 5 });
  v.kill();
  assert.equal(deaths, 1);
  assert.ok(v.dead);
  v.revive(0.5);
  assert.equal(v.hp, 50);
  v.kill();
  assert.equal(deaths, 2, "announced again after a revive");
});

test("snapshot and restore (encounter retries), max HP changes", () => {
  const v = new Vitals({ health: 100 });
  const s = v.snapshot();
  v.apply({ damage: 100 });
  v.drain(60);
  assert.ok(v.dead);
  v.restore(s);
  assert.equal(v.hp, 100);
  assert.equal(v.st, 100);
  assert.ok(!v.dead);
  v.setMaxHp(85, { fill: true });
  assert.equal(v.hp, 85);
  v.setMaxHp(115);
  assert.equal(v.hp, 115, "the fraction is kept");
});

test("time scale: the strongest slow-down wins and requests run out on real time", () => {
  const t = new TimeScale();
  assert.equal(t.step(1 / 60), 1);
  t.hold(0.35, 1);
  t.hitStop(0.08);
  assert.equal(t.value, 0.05);
  let v = 0;
  for (let i = 0; i < 4; i++) v = t.step(1 / 60);
  assert.equal(v, 0.05, "frozen for the hit-stop's frames");
  for (let i = 0; i < 2; i++) v = t.step(1 / 60);
  assert.equal(t.value, 0.35, "the slow motion outlasts the hit-stop");
  for (let i = 0; i < 60; i++) t.step(1 / 60);
  assert.equal(t.value, 1);
  const off = t.hold(0.5);
  assert.equal(t.value, 0.5);
  off();
  assert.equal(t.value, 1);
});

test("emitter: listeners in order, a throwing one doesn't stop the rest, once()", async () => {
  const e = new Emitter<number>();
  const seen: number[] = [];
  const err = console.error;
  console.error = () => {};
  try {
    e.on(() => {
      throw new Error("boom");
    });
    const off = e.on((v) => seen.push(v));
    const p = e.once();
    e.emit(1);
    off();
    e.emit(2);
    assert.deepEqual(seen, [1]);
    assert.equal(await p, 1);
  } finally {
    console.error = err;
  }
});
