import { test } from "node:test";
import assert from "node:assert/strict";
import { WorldState, type Saveable } from "../../../src/engine/state/WorldState";

interface F {
  v: 1;
  side?: "a" | "b";
  count: number;
  seen: string[];
}
const DEFAULTS: F = { v: 1, count: 0, seen: [] };

test("starts from (a copy of) the defaults", () => {
  const s = new WorldState<F>(DEFAULTS);
  assert.deepEqual(s.flags, DEFAULTS);
  s.flags.seen.push("x");
  assert.deepEqual(DEFAULTS.seen, []);
});

test("set notifies only on change; update always notifies", () => {
  const s = new WorldState<F>(DEFAULTS);
  const heard: number[] = [];
  const off = s.on("count", (v) => heard.push(v));
  s.set("count", 0);
  s.set("count", 2);
  s.set("count", 2);
  s.update("count", (v) => v + 1);
  s.update("seen", (v) => void v.push("k"));
  assert.deepEqual(heard, [2, 3]);
  assert.deepEqual(s.get("seen"), ["k"]);
  off();
  s.set("count", 9);
  assert.deepEqual(heard, [2, 3]);
});

test("a throwing listener does not stop the others", () => {
  const s = new WorldState<F>(DEFAULTS);
  const heard: number[] = [];
  const err = console.error;
  console.error = () => {};
  try {
    s.on("count", () => {
      throw new Error("boom");
    });
    s.on("count", (v) => heard.push(v));
    s.set("count", 1);
  } finally {
    console.error = err;
  }
  assert.deepEqual(heard, [1]);
});

test("snapshot is a deep copy; restore puts it back and notifies changed flags", async () => {
  const s = new WorldState<F>(DEFAULTS);
  s.set("side", "a");
  s.update("seen", (v) => void v.push("x"));
  const snap = s.snapshot();
  s.flags.seen.push("y");
  assert.deepEqual(snap.flags.seen, ["x"]);
  s.set("count", 4);
  const heard: string[] = [];
  s.on("count", (v) => heard.push(`count=${v}`));
  s.on("side", (v) => heard.push(`side=${v}`));
  await s.restore(snap);
  assert.deepEqual(s.flags, { v: 1, side: "a", count: 0, seen: ["x"] });
  assert.deepEqual(heard, ["count=0"]);
});

test("restore(undefined) and data from an older save fall back to the defaults", async () => {
  const s = new WorldState<F>(DEFAULTS);
  s.set("count", 3);
  await s.restore(undefined);
  assert.deepEqual(s.flags, DEFAULTS);
  await s.restore({ v: 1, flags: { count: "lots" } as unknown as F, parts: {} });
  assert.deepEqual(s.flags, DEFAULTS);
});

test("a custom normalize sees the raw flags", async () => {
  const s = new WorldState<F>(DEFAULTS, { normalize: (raw, d) => ({ ...d, count: (raw as F | undefined)?.count === 7 ? 70 : 0 }) });
  await s.restore({ v: 1, flags: { ...DEFAULTS, count: 7 }, parts: {} });
  assert.equal(s.get("count"), 70);
});

test("checkpoint and rollback: saves between checkpoints record the checkpoint", async () => {
  const s = new WorldState<F>(DEFAULTS);
  s.set("count", 1);
  s.checkpoint();
  s.set("count", 5);
  s.update("seen", (v) => void v.push("loot"));
  assert.equal(s.checkpointed.flags.count, 1);
  assert.deepEqual(s.checkpointed.flags.seen, []);
  // the copy handed out cannot change the checkpoint
  s.checkpointed.flags.seen.push("hack");
  assert.deepEqual(s.checkpointed.flags.seen, []);
  await s.rollback();
  assert.deepEqual(s.flags, { v: 1, count: 1, seen: [] });
  s.reset();
  assert.deepEqual(s.flags, DEFAULTS);
  assert.deepEqual(s.checkpointed.flags, DEFAULTS);
});

test("saveables round-trip; unknown parts survive; late registration loads its part", async () => {
  let data = { hp: 10 };
  const loaded: [unknown, number][] = [];
  const sv: Saveable<{ hp: number }> = {
    key: "vitals",
    version: 2,
    save: () => data,
    load: (d, v) => {
      loaded.push([d, v]);
      data = d;
    },
  };
  const s = new WorldState<F>(DEFAULTS);
  const off = s.register(sv);
  assert.throws(() => s.register(sv));
  const snap = s.snapshot();
  assert.deepEqual(snap.parts, { vitals: { v: 2, d: { hp: 10 } } });
  data = { hp: 1 };
  await s.restore({ ...snap, parts: { ...snap.parts, future: { v: 9, d: { z: 1 } } } });
  assert.deepEqual(loaded, [[{ hp: 10 }, 2]]);
  assert.deepEqual(s.snapshot().parts.future, { v: 9, d: { z: 1 } });
  off();
  // restored while nobody owns the key: kept, then handed to whoever registers it
  await s.restore({ v: 1, flags: DEFAULTS, parts: { vitals: { v: 1, d: { hp: 7 } } } });
  assert.deepEqual(s.snapshot().parts, { vitals: { v: 1, d: { hp: 7 } } });
  s.register(sv);
  await Promise.resolve();
  assert.deepEqual(loaded.at(-1), [{ hp: 7 }, 1]);
  assert.deepEqual(s.snapshot().parts, { vitals: { v: 2, d: { hp: 7 } } });
});
