import { OUTFITS, type Character, type Part } from "../world/characters";
import { ALL_HAIR, applyAppearance, RACES, type Appearance } from "../world/appearance";
import type { World } from "./World";

/** (Re)create the player's body for an appearance; returns the body and its height scale. */
export async function createPlayerBody(world: World, a: Appearance): Promise<{ body: Character; heightScale: number }> {
  if (a.sex === "f") await world.ensureFemale();
  const old = world.npcs.get("player");
  const pos = old?.root.position.clone();
  const rot = old?.root.rotationQuaternion?.clone();
  world.removeNpc("player");
  const body = world.npc("player", { sex: a.sex, outfit: OUTFITS.peasant, hair: ALL_HAIR as Part[] });
  if (pos) body.root.position.copyFrom(pos);
  if (rot) body.root.rotationQuaternion = rot;
  const { heightScale } = applyAppearance(body, a);
  return { body, heightScale };
}

export const raceName = (a: Appearance) => RACES.find((r) => r.id === a.race)?.name ?? "";

/** Where the scribe promises to send the remains (flavour line in the roll call). */
export function homeland(a: Appearance) {
  return { nord: "北方的冰原", imperial: "帝国的故乡", redsand: "南方的赤沙之地", woodelf: "古老的林地", rockborn: "群山深处" }[a.race];
}
