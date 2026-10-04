/**
 * Engine-framework §1.1 / §2.18 name the player's melee controller `MeleeController`; the keep/exit
 * design (§3.5) calls it `PlayerCombat`. Both names import the same class until the framework
 * migration renames `PlayerCombat.ts` to this file (the content imports `PlayerCombat` today).
 */
export {
  PlayerCombat as MeleeController,
  ArmedCamera,
  type PlayerCombatOptions as MeleeControllerOptions,
  type PlayerCombatEvent as MeleeControllerEvent,
  type PlayerCombatState as MeleeControllerState,
  type CombatAction,
  type CombatInput,
  type CombatPlayer,
  type CombatGear,
} from "./PlayerCombat";
