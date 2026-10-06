import { test } from "node:test";
import assert from "node:assert/strict";
import { Brain, type BrainState } from "../../../../src/engine/ai/Brain";
import { TimeSlicer } from "../../../../src/engine/ai/slicer";

/** A machine that logs enters, exits and updates. */
function logged(extra: (log: string[], ctx: { next: string | null }) => Record<string, BrainState<{ next: string | null }>> = () => ({})) {
  const log: string[] = [];
  const ctx = { next: null as string | null };
  const st = (name: string, parent?: string): BrainState<{ next: string | null }> => ({
    parent,
    enter: (_c, from) => log.push(`+${name}<${from}`),
    exit: (_c, to) => log.push(`-${name}>${to}`),
    update: (c) => {
      log.push(`u${name}`);
      if (c.next && name === "combat" && c.next === "calm") return c.next;
    },
  });
  const states = {
    calm: st("calm"),
    post: st("post", "calm"),
    suspicious: st("suspicious", "calm"),
    combat: st("combat"),
    approach: st("approach", "combat"),
    attack: st("attack", "combat"),
    ...extra(log, ctx),
  };
  const b = new Brain(states, "post", ctx);
  return { b, log, ctx };
}

test("hierarchy: entering a child enters its parent first; moving inside a family keeps the parent", () => {
  const { b, log } = logged();
  assert.deepEqual(log, ["+calm<null", "+post<null"]);
  assert.equal(b.state, "post");
  assert.ok(b.in("calm") && b.in("post") && !b.in("combat"));
  log.length = 0;
  b.go("suspicious");
  assert.deepEqual(log, ["-post>suspicious", "+suspicious<post"]);
  log.length = 0;
  b.go("attack");
  assert.deepEqual(log, ["-suspicious>attack", "-calm>attack", "+combat<suspicious", "+attack<suspicious"]);
  log.length = 0;
  // the same state again is nothing, unless restarted
  b.go("attack");
  assert.deepEqual(log, []);
  b.go("attack", { restart: true });
  assert.deepEqual(log, ["-attack>attack", "+attack<attack"]);
});

test("updates run from the root down; a parent's transition pre-empts the child", () => {
  const { b, log, ctx } = logged();
  b.go("approach");
  log.length = 0;
  b.update(0.1);
  assert.deepEqual(log, ["ucombat", "uapproach"]);
  ctx.next = "calm";
  log.length = 0;
  b.update(0.1);
  assert.deepEqual(log, ["ucombat", "-approach>calm", "-combat>calm", "+calm<approach"]);
  assert.equal(b.state, "calm");
});

test("time in state, suspend and resume", () => {
  const { b } = logged();
  b.update(0.5);
  assert.ok(Math.abs(b.elapsed() - 0.5) < 1e-9);
  b.go("suspicious");
  b.update(0.25);
  assert.ok(Math.abs(b.elapsed() - 0.25) < 1e-9);
  // the parent was entered before, at the start
  assert.ok(Math.abs(b.elapsed("calm") - 0.75) < 1e-9);
  assert.equal(b.elapsed("combat"), 0);
  b.suspend(undefined, "approach");
  assert.ok(b.suspended);
  assert.equal(b.state, "approach");
  b.update(1);
  // no updates while suspended (the clock still runs)
  assert.ok(Math.abs(b.elapsed() - 1) < 1e-9);
  const ends: (() => void)[] = [];
  b.resume("post");
  assert.ok(!b.suspended && b.state === "post");
  b.suspend({ add: (d) => ends.push(d) });
  assert.ok(b.suspended);
  ends.forEach((d) => d());
  assert.ok(!b.suspended);
});

test("a move asked for from an exit waits for the transition under way; loops are cut off", () => {
  const order: string[] = [];
  const b = new Brain(
    {
      a: { exit: () => (order.push("exit a"), b.go("c")) },
      b: { enter: () => order.push("enter b") },
      c: { enter: () => order.push("enter c") },
      ping: { enter: () => b.go("pong") },
      pong: { enter: () => b.go("ping") },
    },
    "a",
    {},
  );
  b.go("b");
  assert.deepEqual(order, ["exit a", "enter b", "enter c"]);
  assert.equal(b.state, "c");
  const warn = console.warn;
  console.warn = () => {};
  try {
    b.go("ping");
  } finally {
    console.warn = warn;
  }
  assert.ok(b.state === "ping" || b.state === "pong");
  // the next outside call works again
  b.go("b");
  assert.equal(b.state, "b");
});

test("time slicer: each item at its rate, phases spread, a budget per frame, round robin", () => {
  const s = new TimeSlicer<string>({ hz: 10 });
  const runs = new Map<string, number>();
  for (const id of ["a", "b", "c", "d", "e", "f"]) s.add(id);
  const perFrame: number[] = [];
  for (let i = 0; i < 600; i++) perFrame.push(s.update(1 / 60, (id) => void runs.set(id, (runs.get(id) ?? 0) + 1)));
  // 10 s at 10 Hz
  for (const n of runs.values()) assert.ok(n >= 98 && n <= 101, `runs ${n}`);
  // spread: never all six on one frame
  assert.ok(Math.max(...perFrame) < 6);

  // a budget of 2 per frame with 8 items due every frame: everybody still gets turns
  const b = new TimeSlicer<number>({ hz: 60, budget: 2 });
  const count = new Array(8).fill(0);
  for (let i = 0; i < 8; i++) b.add(i);
  for (let f = 0; f < 400; f++) {
    const ran = b.update(1 / 60, (i) => void count[i]++);
    assert.ok(ran <= 2);
  }
  const min = Math.min(...count), max = Math.max(...count);
  assert.ok(min >= 90 && max - min <= 2, `fair: ${count}`);

  // an item that wants more budget than is left waits, and the next frame starts with it
  const c = new TimeSlicer<string>({ hz: 60, budget: 3 });
  c.add("big");
  c.add("small");
  const seen: string[] = [];
  c.update(1 / 60, (id, _dt, left) => {
    if (id === "big" && left < 3) return null;
    seen.push(id);
    return id === "big" ? 3 : 1;
  });
  c.update(1 / 60, (id, _dt, left) => {
    if (id === "big" && left < 3) return null;
    seen.push(id);
    return id === "big" ? 3 : 1;
  });
  assert.ok(seen.includes("big"));
  // removal
  c.remove("big");
  assert.equal(c.size, 1);
});
