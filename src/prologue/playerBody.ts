import { OUTFITS, type Character, type Part } from "../world/characters";
import { ALL_HAIR, applyAppearance, RACES, type Appearance } from "../world/appearance";
import type { World } from "./World";

/** The garrison's leathers without the hood (the imperial route's armour; a hood would hide the player's hair). */
export const GARRISON_OUTFIT: Part[] = OUTFITS.soldier.filter((p) => p !== "outfit_ranger_Head_Hood");

/** What the player wears for an armour rating (`flags.inv.armour`): 15 rebel leathers, 20 garrison leathers. */
export function outfitForArmour(armour: number): Part[] {
  return armour >= 20 ? GARRISON_OUTFIT : armour >= 15 ? OUTFITS.rebel : OUTFITS.peasant;
}

/**
 * (Re)create the player's body for an appearance in an outfit (default the prisoner's rags);
 * returns the body and its height scale. The old body is replaced where it stood.
 */
export async function createPlayerBody(world: World, a: Appearance, outfit: readonly Part[] = OUTFITS.peasant): Promise<{ body: Character; heightScale: number }> {
  if (a.sex === "f") await world.ensureFemale();
  const old = world.npcs.get("player");
  const pos = old?.root.position.clone();
  const rot = old?.root.rotationQuaternion?.clone();
  world.removeNpc("player");
  const body = world.npc("player", { sex: a.sex, outfit: [...outfit], hair: ALL_HAIR as Part[] });
  if (pos) body.root.position.copyFrom(pos);
  if (rot) body.root.rotationQuaternion = rot;
  const { heightScale } = applyAppearance(body, a);
  return { body, heightScale };
}

export const raceName = (a: Appearance) => RACES.find((r) => r.id === a.race)?.name ?? "";

/** Where the player comes from (the scribe's line when he adds the name in the roll call). */
export function homeland(a: Appearance) {
  return { nord: "北方的冰原", imperial: "帝国的故乡", redsand: "南方的赤沙之地", woodelf: "古老的林地", rockborn: "群山深处" }[a.race];
}
