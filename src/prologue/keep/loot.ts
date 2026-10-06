// What the keep's gear spots have lost (design §3.8, §12: "flags.looted prevents duplicate loot").
// Pure data rules (no Babylon), shared by the checkpoints' world state and the chapter's beats.
//
// Contract with the beats (J2): taking something from a stand records `lootId(stand, slot)`, opening a
// chest records `lootId(chest)`; Brun taking his father's axe (K2-R2) records
// `lootId("use_weaponstand_reb", "father_axe")`. A checkpoint (keep.ts setWorld) records whatever its
// filled-in loadout implies, so the flags and the props always agree once a step has been prepared.

import type { Faction } from "../flags";

/** The kinds of item a weapon stand holds (as `ItemId`). */
export type RackKind = "sword" | "axe" | "shield";

/**
 * The `flags.looted` id of something taken from a prop: `"<anchor>#<slot>"` for a rack's slot
 * (`use_weaponstand_reb#axe`), the anchor alone for a container emptied as a whole (`use_chest_reb`).
 */
export const lootId = (anchor: string, slot?: string) => (slot ? `${anchor}#${slot}` : anchor);

/** The route's weapon stand and armour chest (the K2 gear, §4.2). */
export const routeGear = (f: Faction) =>
  f === "rebel" ? { rack: "use_weaponstand_reb", chest: "use_chest_reb", armour: 15 as const } : { rack: "use_weaponstand_imp", chest: "use_locker_imp", armour: 20 as const };

/** Whether `looted` records any slot of the stand `anchor` (the player has made their pick there). */
export const rackRecorded = (anchor: string, looted: readonly string[]) => looted.some((l) => l.startsWith(`${anchor}#`));

/**
 * The slots of the weapon stand `anchor` that are gone, by slot id. `afterK2R`: the rebel route past
 * K2-R2, where Brun has taken his father's axe (always gone, recorded or not). When `looted` records
 * any of this stand's slots, those are gone (and only those, besides the father's axe). Otherwise (a
 * save from before the chapter recorded them, or a checkpoint whose loadout was filled in) the
 * inventory says: the slot of the player's weapon kind and the shield if the player carries one.
 */
export function rackTaken(
  anchor: string,
  slots: readonly { id: string; kind: RackKind }[],
  inv: { weapon: "none" | "sword" | "axe"; shield: boolean },
  looted: readonly string[],
  afterK2R: boolean,
): string[] {
  const prefix = `${anchor}#`;
  const out: string[] = [];
  if (afterK2R && slots.some((s) => s.id === "father_axe")) out.push("father_axe");
  if (rackRecorded(anchor, looted)) {
    const recorded = new Set(looted.filter((l) => l.startsWith(prefix)).map((l) => l.slice(prefix.length)));
    for (const s of slots) if (recorded.has(s.id) && !out.includes(s.id)) out.push(s.id);
    return out;
  }
  if (inv.weapon !== "none") {
    const s = slots.find((x) => x.kind === inv.weapon && x.id !== "father_axe" && !out.includes(x.id));
    if (s) out.push(s.id);
  }
  if (inv.shield) {
    const s = slots.find((x) => x.kind === "shield" && !out.includes(x.id));
    if (s) out.push(s.id);
  }
  return out;
}

type Inv = { weapon: "none" | "sword" | "axe"; shield: boolean; armour: 0 | 15 | 20; potions: number; keyring: boolean };

/**
 * Fill in the loadout a checkpoint from step 2 on starts with (§11: geared after K2; the key ring from
 * step 3; potions from the storeroom at step 4), where the flags lack it (a debug start, a save from
 * before the chapter recorded its loot). Never adds what the player chose to leave: the imperial
 * shield is forced only while nothing of that stand is recorded. Mutates and returns `inv`.
 */
export function fillLoadout<T extends Inv>(inv: T, looted: readonly string[], faction: Faction, step: number): T {
  if (step < 2) return inv;
  const g = routeGear(faction);
  if (inv.weapon === "none") inv.weapon = "sword";
  if (faction === "imperial" && !rackRecorded(g.rack, looted)) inv.shield = true;
  if (inv.armour === 0) inv.armour = g.armour;
  if (step >= 3) {
    inv.keyring = true;
    inv.potions = Math.max(inv.potions, 1);
  }
  if (step >= 4) inv.potions = Math.max(inv.potions, 3);
  return inv;
}

/**
 * The loot ids a prepared checkpoint's gear spots stand for, from step 2 on: the stand's taken slots
 * (as `rackTaken` decided them) and the route's chest once its armour is worn. Recording them makes a
 * later resume read the same state from `looted` alone.
 */
export function gearLootIds(faction: Faction, taken: readonly string[], inv: { armour: number }, looted: readonly string[]): string[] {
  const g = routeGear(faction);
  const ids = taken.map((s) => lootId(g.rack, s));
  if (inv.armour > 0 || looted.includes(lootId(g.chest))) ids.push(lootId(g.chest));
  return ids.filter((id) => !looted.includes(id));
}
