import { test } from "node:test";
import assert from "node:assert/strict";
import { BarkGate } from "../../../../src/engine/script/barks";

test("a speaker barks at most once per cooldown", () => {
  const g = new BarkGate({ gap: 0 });
  assert.ok(g.allow("布伦", 0));
  assert.ok(!g.allow("布伦", 3.9));
  assert.ok(g.allow("布伦", 4));
  // a cooldown of its own
  assert.ok(!g.allow("布伦", 10, { cooldown: 7 }));
  assert.ok(g.allow("布伦", 11, { cooldown: 7 }));
});

test("barks are dropped while a scripted line is spoken, and that doesn't count as a bark", () => {
  const g = new BarkGate();
  assert.ok(!g.allow("伊沃", 0, { blocked: true }));
  assert.ok(!g.allow("伊沃", 0, { blocked: true, force: true }));
  assert.ok(g.allow("伊沃", 0.1));
});

test("another speaker waits out the gap unless forced", () => {
  const g = new BarkGate({ gap: 1.2 });
  assert.ok(g.allow("帝国兵", 0));
  assert.ok(!g.allow("布伦", 1));
  assert.ok(g.allow("布伦", 1, { force: true }));
  assert.ok(g.allow("伊沃", 2.3));
});

test("speakers are keyed by identity: two soldiers with one label are paced apart", () => {
  const g = new BarkGate({ gap: 0 });
  const a = {}, b = {};
  assert.ok(g.allow(a, 0));
  assert.ok(g.allow(b, 0.5));
  assert.ok(!g.allow(a, 1));
  g.reset();
  assert.ok(g.allow(a, 1));
});

test("names and actors are paced apart from each other; reset forgets both kinds", () => {
  const g = new BarkGate({ gap: 0 });
  const actor = { name: "帝国兵" };
  const fn = () => undefined;
  assert.ok(g.allow("帝国兵", 0));
  assert.ok(g.allow(actor, 0), "an actor is not its label");
  assert.ok(g.allow(fn, 0));
  assert.ok(!g.allow("帝国兵", 1) && !g.allow(actor, 1) && !g.allow(fn, 1));
  g.reset();
  assert.ok(g.allow("帝国兵", 1) && g.allow(actor, 1) && g.allow(fn, 1));
});
