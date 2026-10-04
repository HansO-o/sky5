import { test } from "node:test";
import assert from "node:assert/strict";
import { lowHealth, memoryTips, stealthView, TipBook, TipQueue, tipSeconds, VitalsFade } from "../../../src/ui/hud";

const full = { hp: 1, st: 1 };

test("vitals stay hidden while full and sheathed, from the first sample on", () => {
  const f = new VitalsFade();
  assert.equal(f.update(0.016, full), false);
  assert.equal(f.update(5, full), false);
});

test("vitals show while armed or below full, and fade 3 s after the last change", () => {
  const f = new VitalsFade();
  f.update(0, full);
  assert.equal(f.update(0.1, full, true), true, "armed");
  // sheathed while full: 3 more seconds
  assert.equal(f.update(2.9, full), true);
  assert.equal(f.update(0.2, full), false);
  // a sprint drains stamina: shown while below full ...
  assert.equal(f.update(0.1, { hp: 1, st: 0.6 }), true);
  assert.equal(f.update(10, { hp: 1, st: 0.6 }), true);
  // ... and while it refills, then 3 s after it is full again
  assert.equal(f.update(0.1, full), true);
  assert.equal(f.update(2.8, full), true);
  assert.equal(f.update(0.3, full), false);
  f.reset();
  assert.equal(f.visible, false);
  assert.equal(f.update(0, { hp: 0.5, st: 1 }), true);
});

test("the heartbeat plays below 30 % health, not when dead", () => {
  assert.ok(lowHealth(0.29));
  assert.ok(!lowHealth(0.3));
  assert.ok(!lowHealth(0));
  assert.ok(lowHealth(0.4, 0.5));
});

test("the stealth eye opens with the meter, stirs from 0.5, is alert at 1", () => {
  assert.deepEqual(stealthView(0), { open: 0, state: "calm" });
  assert.deepEqual(stealthView(0.3), { open: 0.3, state: "calm" });
  assert.deepEqual(stealthView(0.5), { open: 0.5, state: "stir" });
  assert.deepEqual(stealthView(1.4), { open: 1, state: "alert" });
  assert.deepEqual(stealthView(0.2, true), { open: 0.2, state: "stir" });
  assert.deepEqual(stealthView(0.8, false), { open: 0.8, state: "calm" });
  assert.deepEqual(stealthView(0.7, 0.75), { open: 0.7, state: "calm" });
  assert.deepEqual(stealthView(Number.NaN), { open: 0, state: "calm" });
});

test("tips stay long enough to read", () => {
  assert.equal(tipSeconds("按 Q 饮用治疗药水"), 5);
  assert.equal(tipSeconds("x".repeat(500)), 10);
});

test("a tip shows once, recorded in its store; a rolled-back store gets the id back", () => {
  const flags = { tips: [] as string[] };
  const book = new TipBook({ has: (id) => flags.tips.includes(id), add: (id) => void flags.tips.push(id) });
  assert.ok(book.claim("combat.block"));
  assert.ok(!book.claim("combat.block"));
  assert.deepEqual(flags.tips, ["combat.block"]);
  // a retried fight rolls the flags back to before the tip
  flags.tips = [];
  assert.ok(!book.claim("combat.block"));
  assert.deepEqual(flags.tips, ["combat.block"]);
  // a loaded save (a new store) shows what its own record hasn't
  const saved: string[] = [];
  book.store = { has: (id) => saved.includes(id), add: (id) => void saved.push(id) };
  book.forget();
  assert.ok(book.claim("combat.block"));
  const mem = new TipBook(memoryTips());
  assert.ok(mem.claim("a"));
  assert.ok(!mem.claim("a"));
});

test("tips run on game time: one at a time, a gap between, nothing passes while the game stands still", () => {
  const q = new TipQueue({ gap: 0.5, seconds: (t) => (t === "a" ? 5 : 6) });
  assert.equal(q.push("a"), "a", "shows straight away");
  assert.equal(q.push("b"), undefined, "waits its turn");
  assert.equal(q.current, "a");
  assert.equal(q.update(4.9), undefined);
  // the pause menu: no game time passes (the stage doesn't tick), however long it stays open
  assert.equal(q.current, "a");
  assert.equal(q.update(0.1), null, "a goes after its 5 s");
  assert.equal(q.current, null);
  assert.equal(q.update(0.4), undefined);
  assert.equal(q.update(0.1), "b", "after the gap");
  assert.equal(q.update(5.9), undefined);
  assert.equal(q.update(0.1), null);
  assert.equal(q.update(1), undefined, "the queue is empty");
  assert.equal(q.size, 0);
  assert.equal(q.push("c"), "c", "idle again: the next shows at once");
  q.clear();
  assert.equal(q.current, null);
  assert.equal(q.update(10), undefined);
  // the default timing is the reading time
  const d = new TipQueue();
  d.push("按住 右键 格挡");
  assert.equal(d.update(tipSeconds("按住 右键 格挡") - 0.01), undefined);
  assert.equal(d.update(0.02), null);
});
