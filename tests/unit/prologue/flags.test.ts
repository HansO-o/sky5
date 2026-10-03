import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_FLAGS, newFlags, normalizeFlags } from "../../../src/prologue/flags";
import { WorldState } from "../../../src/engine/state/WorldState";

test("saves from before flags existed load as the new-game flags", () => {
  assert.deepEqual(normalizeFlags(undefined), DEFAULT_FLAGS);
  assert.deepEqual(normalizeFlags(null), DEFAULT_FLAGS);
  assert.deepEqual(normalizeFlags("garbage"), DEFAULT_FLAGS);
  assert.deepEqual(newFlags(), DEFAULT_FLAGS);
  assert.notEqual(newFlags().inv, DEFAULT_FLAGS.inv);
});

test("a full set of flags round-trips unchanged", () => {
  const f = {
    v: 1 as const,
    faction: "imperial" as const,
    inv: { weapon: "sword" as const, shield: true, armour: 20 as const, potions: 3, keyring: true, letter: false, charm: true },
    looted: ["store_potion_1", "leader"],
    tips: ["block", "potion"],
    outcomes: { torture: "bluff" as const, beast: "asleep" as const },
    deaths: { e1: 2 },
  };
  assert.deepEqual(normalizeFlags(JSON.parse(JSON.stringify(f))), f);
});

test("values out of range fall back; unknown keys are kept", () => {
  const f = normalizeFlags({
    v: 7,
    faction: "pirates",
    inv: { weapon: "bow", armour: 12, potions: -4.5, shield: "yes" },
    looted: ["a", 3, "a", "b"],
    outcomes: { torture: "maybe", assistant: "spared", future: "x" },
    deaths: { e1: 2.7, e2: -1, e3: "x" },
    later: { added: true },
  });
  assert.equal(f.v, 1);
  assert.equal(f.faction, undefined);
  assert.ok(!("faction" in f));
  assert.deepEqual(f.inv, { ...DEFAULT_FLAGS.inv });
  assert.deepEqual(f.looted, ["a", "b"]);
  assert.deepEqual(f.outcomes, { assistant: "spared", future: "x" });
  assert.deepEqual(f.deaths, { e1: 2 });
  assert.deepEqual((f as unknown as { later: unknown }).later, { added: true });
});

test("potions are clamped to a whole, non-negative count", () => {
  assert.equal(normalizeFlags({ inv: { potions: 2.9 } }).inv.potions, 2);
  assert.equal(normalizeFlags({ inv: { potions: 1e9 } }).inv.potions, 99);
});

test("the stage's store: a quick save between checkpoints records the checkpoint's flags", async () => {
  const s = new WorldState(DEFAULT_FLAGS, { normalize: (raw) => normalizeFlags(raw) });
  s.set("faction", "rebel");
  s.flags.inv.potions = 1;
  s.checkpoint(); // keep step 1 autosave
  s.flags.inv.potions = 3;
  s.flags.looted.push("storeroom");
  const saved = JSON.parse(JSON.stringify(s.checkpointed.flags));
  assert.equal(saved.inv.potions, 1);
  assert.deepEqual(saved.looted, []);
  // and loading that save gives exactly the checkpoint back
  const t = new WorldState(DEFAULT_FLAGS, { normalize: (raw) => normalizeFlags(raw) });
  await t.restore({ v: 1, flags: saved, parts: {} });
  assert.deepEqual(t.flags, saved);
});
