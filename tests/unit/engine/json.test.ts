import { test } from "node:test";
import assert from "node:assert/strict";
import { deepClone, deepEqual, withDefaults } from "../../../src/engine/core/json";

test("deepClone copies nested data and drops undefined properties", () => {
  const src = { a: 1, b: [1, { c: 2 }], d: { e: "x", f: undefined } };
  const c = deepClone(src);
  assert.deepEqual(c, { a: 1, b: [1, { c: 2 }], d: { e: "x" } });
  (c.b[1] as { c: number }).c = 9;
  assert.equal((src.b[1] as { c: number }).c, 2);
});

test("deepEqual compares structure, treating undefined properties as missing", () => {
  assert.ok(deepEqual({ a: [1, 2], b: { c: null } }, { b: { c: null }, a: [1, 2] }));
  assert.ok(deepEqual({ a: 1, b: undefined }, { a: 1 }));
  assert.ok(!deepEqual({ a: [1, 2] }, { a: [2, 1] }));
  assert.ok(!deepEqual({ a: 1 }, { a: "1" }));
  assert.ok(!deepEqual([], {}));
});

test("withDefaults fills missing keys and keeps unknown ones", () => {
  const defaults = { v: 1, n: 0, s: "a", list: [] as string[], nested: { on: false, k: 3 }, any: null as unknown };
  const out = withDefaults(defaults, { n: 5, extra: { x: 1 }, nested: { on: true }, any: [1] });
  assert.deepEqual(out, { v: 1, n: 5, s: "a", list: [], nested: { on: true, k: 3 }, any: [1], extra: { x: 1 } });
});

test("withDefaults rejects values of the wrong kind", () => {
  const defaults = { n: 1, s: "a", b: false, list: ["x"], o: { k: 1 } };
  const out = withDefaults(defaults, { n: "7", s: 3, b: "yes", list: "nope", o: [1, 2] });
  assert.deepEqual(out, defaults);
  assert.deepEqual(withDefaults(defaults, { n: Number.NaN }).n, 1);
  assert.deepEqual(withDefaults(defaults, { n: Infinity }).n, 1);
});

test("withDefaults on non-object input returns a fresh copy of the defaults", () => {
  const defaults = { o: { k: 1 } };
  for (const raw of [undefined, null, 3, "x", [1]]) {
    const out = withDefaults(defaults, raw);
    assert.deepEqual(out, defaults);
    assert.notEqual(out.o, defaults.o);
  }
});
