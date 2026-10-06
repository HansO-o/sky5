import { test } from "node:test";
import assert from "node:assert/strict";
import { fillLoadout, gearLootIds, lootId, rackRecorded, rackTaken } from "../../../src/prologue/keep/loot";

const REB = [
  { id: "father_axe", kind: "axe" as const },
  { id: "sword", kind: "sword" as const },
  { id: "axe", kind: "axe" as const },
];
const IMP = [
  { id: "sword", kind: "sword" as const },
  { id: "shield", kind: "shield" as const },
];

test("a rebel who took the axe: the axe and Brun's father's axe are gone, the sword stays", () => {
  assert.deepEqual(rackTaken("use_weaponstand_reb", REB, { weapon: "axe", shield: false }, [], true), ["father_axe", "axe"]);
});

test("a rebel who took the sword: the sword and Brun's father's axe are gone", () => {
  assert.deepEqual(rackTaken("use_weaponstand_reb", REB, { weapon: "sword", shield: false }, [], true), ["father_axe", "sword"]);
});

test("the imperial stand: the sword, and the shield only if the player carries it", () => {
  assert.deepEqual(rackTaken("use_weaponstand_imp", IMP, { weapon: "sword", shield: true }, [], false), ["sword", "shield"]);
  assert.deepEqual(rackTaken("use_weaponstand_imp", IMP, { weapon: "sword", shield: false }, [], false), ["sword"]);
  assert.deepEqual(rackTaken("use_weaponstand_imp", IMP, { weapon: "none", shield: false }, [], false), []);
});

test("recorded loot ids win over the inventory, and only this stand's count", () => {
  const looted = [lootId("use_weaponstand_reb", "sword"), lootId("use_weaponstand_imp", "shield"), lootId("use_chest_reb")];
  // (Brun's father's axe is gone on the rebel route past K2-R2, recorded or not)
  assert.deepEqual(rackTaken("use_weaponstand_reb", REB, { weapon: "axe", shield: false }, looted, true), ["father_axe", "sword"]);
  assert.deepEqual(rackTaken("use_weaponstand_reb", REB, { weapon: "axe", shield: false }, looted, false), ["sword"]);
  assert.deepEqual(rackTaken("use_weaponstand_imp", IMP, { weapon: "sword", shield: false }, looted, false), ["shield"]);
  assert.equal(lootId("use_chest_reb"), "use_chest_reb");
  assert.equal(lootId("use_weaponstand_reb", "father_axe"), "use_weaponstand_reb#father_axe");
});

const inv = (o: Partial<{ weapon: "none" | "sword" | "axe"; shield: boolean; armour: 0 | 15 | 20; potions: number; keyring: boolean }> = {}) => ({
  weapon: "none" as "none" | "sword" | "axe",
  shield: false,
  armour: 0 as 0 | 15 | 20,
  potions: 0,
  keyring: false,
  ...o,
});

test("fillLoadout: the §11 kit from step 2, the imperial shield only while the stand is unrecorded", () => {
  assert.deepEqual(fillLoadout(inv(), [], "imperial", 1), inv(), "nothing before K2");
  assert.deepEqual(fillLoadout(inv(), [], "imperial", 2), inv({ weapon: "sword", shield: true, armour: 20 }));
  assert.deepEqual(fillLoadout(inv(), [], "rebel", 3), inv({ weapon: "sword", armour: 15, keyring: true, potions: 1 }));
  assert.deepEqual(fillLoadout(inv({ weapon: "axe", potions: 5 }), [], "rebel", 4), inv({ weapon: "axe", armour: 15, keyring: true, potions: 5 }));
  // the player took the sword and left the shield: never forced back on
  const left = [lootId("use_weaponstand_imp", "sword")];
  assert.equal(rackRecorded("use_weaponstand_imp", left), true);
  assert.deepEqual(fillLoadout(inv({ weapon: "sword", armour: 20 }), left, "imperial", 2), inv({ weapon: "sword", armour: 20 }));
});

test("a filled checkpoint records what it shows, and a resume from the record shows the same", () => {
  // a debug start at step 2 on the imperial route: the fill, the stand's taken slots, their ids
  const a = fillLoadout(inv(), [], "imperial", 2);
  const taken = rackTaken("use_weaponstand_imp", IMP, a, [], false);
  assert.deepEqual(taken, ["sword", "shield"]);
  const ids = gearLootIds("imperial", taken, a, []);
  assert.deepEqual(ids, ["use_weaponstand_imp#sword", "use_weaponstand_imp#shield", "use_locker_imp"]);
  // resumed from that save: the fill adds nothing, the stand loses the same slots, nothing new to record
  const b = fillLoadout({ ...a }, ids, "imperial", 3);
  assert.equal(b.shield, true);
  assert.deepEqual(rackTaken("use_weaponstand_imp", IMP, b, ids, false), taken);
  assert.deepEqual(gearLootIds("imperial", taken, b, ids), []);
  // the rebel route: the father's axe is recorded with the player's pick
  const r = fillLoadout(inv(), [], "rebel", 2);
  const rt = rackTaken("use_weaponstand_reb", REB, r, [], true);
  assert.deepEqual(gearLootIds("rebel", rt, r, []), ["use_weaponstand_reb#father_axe", "use_weaponstand_reb#sword", "use_chest_reb"]);
  // a save that recorded only the player's sword still has the father's axe gone
  assert.deepEqual(rackTaken("use_weaponstand_reb", REB, r, ["use_weaponstand_reb#sword"], true), ["father_axe", "sword"]);
});
