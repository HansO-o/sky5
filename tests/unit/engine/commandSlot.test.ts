import { test } from "node:test";
import assert from "node:assert/strict";
import { CommandSlot } from "../../../src/engine/anim/commandSlot";

type Mode = "idle" | "pass" | "circuit" | "hidden";

test("each command pre-empts the last", () => {
  const s = new CommandSlot<Mode>("idle");
  assert.equal(s.mode, "idle");
  const a = s.begin("circuit", "c1");
  assert.ok(s.live(a));
  const b = s.begin("pass");
  assert.ok(!s.live(a));
  assert.ok(s.live(b));
  assert.equal(s.mode, "pass");
});

test("the same behaviour with the same parameters is already running; other parameters are not", () => {
  const s = new CommandSlot<Mode>("idle");
  s.begin("circuit", "c1");
  assert.ok(s.running("circuit", "c1"));
  assert.ok(!s.running("circuit", "c2"));
  assert.ok(!s.running("pass", "c1"));
  // a command without parameters (a one-off pass) never counts as running already
  s.begin("pass");
  assert.ok(!s.running("pass", null));
});

test("settle: a command that finished by itself moves on; a pre-empted one changes nothing", () => {
  const s = new CommandSlot<Mode>("idle");
  const p = s.begin("pass");
  assert.ok(s.settle(p, "idle"));
  assert.equal(s.mode, "idle");
  const p2 = s.begin("pass");
  const c = s.begin("circuit", "c1");
  // the first pass resolving late (its flight was cut short by the circuit) must not resume anything
  assert.ok(!s.settle(p2, "idle"));
  assert.equal(s.mode, "circuit");
  assert.ok(s.live(c));
  assert.ok(s.running("circuit", "c1"));
});
