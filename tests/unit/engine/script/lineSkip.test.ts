import { test } from "node:test";
import assert from "node:assert/strict";
import { LineSkip } from "../../../../src/engine/script/lineSkip";

/** Steps `s` until it skips; returns the line's age at the skip (or null after `max` seconds). */
function runUntilSkip(s: LineSkip, held: (t: number) => boolean, max = 5, dt = 0.01) {
  for (let t = dt; t <= max + 1e-9; t += dt) if (s.update(dt, held(t))) return t;
  return null;
}
const near = (a: number | null, b: number, eps = 0.011) => assert.ok(a !== null && Math.abs(a - b) < eps, `${a} != ${b}`);

test("a hold of 0.35 s ends the line, but never before it has played 0.3 s", () => {
  const s = new LineSkip();
  s.begin(false);
  // held from the start: the 0.35 s hold is the later condition
  near(runUntilSkip(s, () => true), 0.35);
  // pressed at 0.1: skip at 0.45
  s.begin(false);
  near(runUntilSkip(s, (t) => t > 0.1), 0.45);
  // a hold that would complete early still waits for the line's 0.3 s
  const k = new LineSkip({ hold: 0.1, minAge: 0.3 });
  k.begin(false);
  near(runUntilSkip(k, () => true), 0.3);
});

test("releasing the button starts the hold over", () => {
  const s = new LineSkip();
  s.begin(false);
  // held 0.3 s, released at 0.3..0.4, held again: 0.35 s more
  near(runUntilSkip(s, (t) => t < 0.3 || t > 0.4), 0.75);
});

test("a hold that began before the line needs a release first", () => {
  const s = new LineSkip();
  // the press that used a chest is still down when the chest's line starts
  s.begin(true);
  assert.equal(runUntilSkip(s, () => true, 3), null);
  assert.equal(s.progress, 0);
  // released at 1.0, held again
  s.begin(true);
  near(runUntilSkip(s, (t) => t < 1 || t > 1.1), 1.45);
});

test("keeping the button down after a skip fast-forwards the next lines", () => {
  const s = new LineSkip();
  s.begin(false);
  near(runUntilSkip(s, () => true), 0.35);
  // the next line starts with the button still down: it counts
  s.begin(true);
  near(runUntilSkip(s, () => true), 0.35);
  // released in between: the chain is over, a fresh press is needed as usual
  s.update(0.01, false);
  s.begin(true);
  assert.equal(runUntilSkip(s, () => true, 2), null);
});

test("one skip per line, nothing without a line", () => {
  const s = new LineSkip();
  assert.equal(runUntilSkip(s, () => true, 1), null);
  s.begin(false);
  near(runUntilSkip(s, () => true), 0.35);
  assert.equal(runUntilSkip(s, () => true, 1), null);
  s.begin(false);
  s.end();
  assert.equal(runUntilSkip(s, () => true, 1), null);
});

test("progress reports the hold", () => {
  const s = new LineSkip();
  s.begin(false);
  s.update(0.175, true);
  assert.ok(Math.abs(s.progress - 0.5) < 1e-9);
  s.update(0.01, false);
  assert.equal(s.progress, 0);
});
