import { deepClone, isPlainObject, withDefaults } from "../engine/core/json";

export type Faction = "rebel" | "imperial";

/** The prologue's persistent story state (saved as `PrologueSave.flags`, next to the appearance). */
export interface PrologueFlags {
  v: 1;
  /** the side the player took at the keep gate (set in keep step 0) */
  faction?: Faction;
  inv: {
    weapon: "none" | "sword" | "axe";
    shield: boolean;
    /** armour rating (0, 15 rebel leather, 20 garrison leather) */
    armour: 0 | 15 | 20;
    potions: number;
    keyring: boolean;
    letter: boolean;
    charm: boolean;
  };
  /** ids of loot already taken (never respawned) */
  looted: string[];
  /** ids of tips already shown */
  tips: string[];
  outcomes: {
    torture?: "killed" | "bluff" | "fought";
    assistant?: "spared" | "killed";
    backstab?: "silent" | "fight";
    beast?: "asleep" | "killed" | "fled" | "skipped";
  };
  /** player deaths per encounter id (adaptive difficulty) */
  deaths: Record<string, number>;
}

export const DEFAULT_FLAGS: PrologueFlags = {
  v: 1,
  inv: { weapon: "none", shield: false, armour: 0, potions: 0, keyring: false, letter: false, charm: false },
  looted: [],
  tips: [],
  outcomes: {},
  deaths: {},
};

const oneOf = <T extends string | number>(v: unknown, allowed: readonly T[]): T | undefined => (allowed.includes(v as T) ? (v as T) : undefined);
const strings = (v: string[]) => [...new Set(v.filter((s): s is string => typeof s === "string"))];

/**
 * Valid flags from whatever a save holds: saves from before flags existed (`undefined`), older or
 * newer versions, or damaged data. Unknown keys are kept (forward compatibility); known keys with
 * values out of range fall back to their defaults.
 */
export function normalizeFlags(raw: unknown): PrologueFlags {
  const f = withDefaults(DEFAULT_FLAGS, raw);
  f.v = 1;
  const faction = oneOf(f.faction, ["rebel", "imperial"] as const);
  if (faction) f.faction = faction;
  else delete f.faction;
  const inv = f.inv;
  inv.weapon = oneOf(inv.weapon, ["none", "sword", "axe"] as const) ?? "none";
  inv.armour = oneOf(inv.armour, [0, 15, 20] as const) ?? 0;
  inv.potions = Math.max(0, Math.min(99, Math.floor(inv.potions)));
  f.looted = strings(f.looted);
  f.tips = strings(f.tips);
  const o = f.outcomes as Record<string, unknown>;
  const allowed: Record<string, readonly string[]> = {
    torture: ["killed", "bluff", "fought"],
    assistant: ["spared", "killed"],
    backstab: ["silent", "fight"],
    beast: ["asleep", "killed", "fled", "skipped"],
  };
  for (const [k, vals] of Object.entries(allowed)) if (k in o && !oneOf(o[k], vals)) delete o[k];
  const deaths: Record<string, number> = {};
  if (isPlainObject(f.deaths)) for (const [k, n] of Object.entries(f.deaths)) if (typeof n === "number" && Number.isFinite(n) && n > 0) deaths[k] = Math.floor(n);
  f.deaths = deaths;
  return f;
}

/** A fresh copy of the new-game flags. */
export const newFlags = () => deepClone(DEFAULT_FLAGS);
