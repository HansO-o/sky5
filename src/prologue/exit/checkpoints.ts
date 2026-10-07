import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { hud } from "../../ui/hud";
import { OUTFITS, type Character } from "../../world/characters";
import { place3 } from "../actors";
import type { Faction } from "../flags";
import { RAIDED_HOUSES } from "../fx/townFires";
import { fillLoadout } from "../keep/loot";
import type { Underground } from "../keep/underground";
import type { PlayerController } from "../player";
import type { PrologueStage } from "../PrologueStage";
import type { CaveWorld } from "./cave";
import { EXIT_CHECKPOINTS, EXIT_STEPS, exitSkipState, exitWorldState, type ExitWorldState } from "./rules";

/** The two guides as the earlier chapters made them (the same specs: `world.npc` finds them by name). */
export const EXIT_CAST: Record<"brun" | "scribe", Parameters<PrologueStage["world"]["npc"]>[1]> = {
  brun: { outfit: OUTFITS.rebel, hair: ["hair_simpleparted", "hair_beard"] },
  scribe: { outfit: OUTFITS.soldier, hair: ["hair_simpleparted"] },
};

/** The keep's last checkpoint (keep.ts `KEEP_STEPS`): the loadout the exit starts with is the one the keep ends with. */
const KEEP_END = 8;

/** The guide of a route: Brun for the rebels, the scribe (伊沃) for the imperials. */
export const guideOf = (f: Faction): "brun" | "scribe" => (f === "rebel" ? "brun" : "scribe");

/** What a step's placement made: the player, the guide's body (the chapter makes it the companion actor), its torch. */
export interface ExitPlacement {
  step: number;
  player: PlayerController;
  /** where the player stands and faces */
  at: Vector3;
  yaw: number;
  guide: Character;
  /** the guide's mark */
  guideAt: Vector3;
  /** the guide's lit torch (null from `cp_light` on) */
  torch: { dispose(): void } | null;
  /** the world state it was put in */
  state: ExitWorldState;
}

/** A step's two marks on the floor (§11; the anchors' facing where they give one). */
export function exitMarks(cave: CaveWorld, step: number) {
  const cp = EXIT_CHECKPOINTS[Math.max(0, Math.min(EXIT_STEPS, Math.floor(step) || 0))];
  const at = cave.floorAt(cp.player);
  const yaw = cave.a.anchors[cp.player]?.yaw ?? cp.yaw;
  return { at, yaw, guideAt: cave.floorAt(cp.companion) };
}

/**
 * The keep's end as the exit expects it under the ground (a resume in the exit starts without the
 * keep having run in this session; §11 keep.skip): the drain open, the drawbridge broken in the
 * river with its lever pulled.
 */
export function keepAftermath(u: Underground) {
  u.openDrain();
  u.props.bridge?.set("broken");
}

/** The torch `ch` carries already (`Underground.giveTorch`'s, kept through a seamless handover), or null. */
export function carriedTorch(ch: Character): { root: TransformNode; dispose(): void } | null {
  const socket = ch.root.getScene().getTransformNodeByName(`${ch.name}_torch_socket`);
  const torch = socket?.getChildren().find((n): n is TransformNode => "position" in n && !n.isDisposed()) ?? null;
  return torch ? { root: torch, dispose: () => torch.dispose() } : null;
}

/** The guide's lit torch (§7: from K9 to `cp_light`): the one it carries, else a new one in its left hand. */
export function ensureTorch(u: Underground, ch: Character): { dispose(): void } {
  const t = carriedTorch(ch) ?? u.giveTorch(ch);
  if (ch.hasClip("Idle_Torch_Loop")) ch.play("Idle_Torch_Loop", { blend: 0.3 });
  return t;
}

/** Douse the guide's torch (X2's den, `cp_light`, the skip): it goes, and its pool light with it. */
export function dropTorch(ch: Character | null | undefined) {
  if (ch) carriedTorch(ch)?.dispose();
}

/**
 * The world of an exit step as §11 has it (webs, cocoon, satchel, the nest, the town seen from the
 * platform): the parts the cave owns. The creatures are the chapter's encounters (`state.spiders`,
 * `state.wolf` say which to make).
 */
export async function applyExitWorld(stage: PrologueStage, cave: CaveWorld, s: ExitWorldState) {
  cave.webs.A?.set(s.webA === "cut");
  cave.webs.B?.set(s.webB === "cut");
  cave.cocoon?.set(s.cocoon === "searched");
  cave.satchel.set(s.satchel === "taken");
  cave.setNest(s.spiders !== "gone");
  // the stage's dragon waits for the platform's cue (§11 step 5: replay X4 from the dragon cue)
  stage.dragons?.hide();
  if (s.mood !== null) stage.world.env.setMood(s.mood);
  if (s.townFires) {
    await stage.ensureTownFx().catch((e) => console.warn("exit: town fires", e));
    stage.townFires?.ensure(RAIDED_HOUSES);
    if (stage.world.outdoorVisible) stage.townFires?.resume();
  }
}

/**
 * Put everything where exit step `step` (0–5) starts (§11): the keep's aftermath under the ground,
 * the kit (filled only when the flags have none: a debug start), the world state from the flags,
 * the player on the step's mark, the guide on its own (the other one gone) with its torch up to
 * `cp_light`, and the zones applied there. The chapter then makes the companion actor and the
 * step's encounters.
 */
export async function placeAtStep(stage: PrologueStage, cave: CaveWorld, step: number, faction: Faction): Promise<ExitPlacement> {
  const w = stage.world;
  const u = cave.u;
  keepAftermath(u);
  const state = exitWorldState(step, stage.flags);
  stage.state.update("inv", (inv) => {
    if (inv.weapon === "none") fillLoadout(inv, stage.flags.looted, faction, KEEP_END);
  });
  const { at, yaw, guideAt } = exitMarks(cave, state.step);
  const player = await stage.ensurePlayer(at.add(new Vector3(0, 0.02, 0)), yaw);
  player.enabled = true;
  player.canMove = true;
  player.bound = false;
  await stage.ensureGear().sync(stage.flags.inv, { dip: 0 });
  const name = guideOf(faction);
  w.removeNpc(name === "brun" ? "scribe" : "brun");
  const guide = w.npc(name, EXIT_CAST[name]);
  place3(w, guide, guideAt.x, guideAt.z, guideAt.y, at);
  const torch = state.torch ? ensureTorch(u, guide) : (dropTorch(guide), null);
  // the zone first (the platform's outdoor world), then the world in it
  u.check();
  await applyExitWorld(stage, cave, state);
  u.check();
  return { step: state.step, player, at, yaw, guide, guideAt, torch, state };
}

/**
 * `exit.skip()`'s world (§11), synchronously: the den's outcome "skipped" unless decided, the webs
 * gone, the nest quiet, the guide's torch out, the dragon hidden, the stealth eye off, the town's
 * fires burning under mood 1, the player and the guide on the platform with the outdoor world
 * around them. The chapter disposes its creatures and encounters first; PrologueStage shows the
 * end card after.
 */
export function applyExitSkip(stage: PrologueStage, cave: CaveWorld, faction: Faction) {
  const w = stage.world;
  const { world, beast } = exitSkipState(stage.flags);
  stage.state.update("outcomes", (o) => {
    o.beast ??= beast;
  });
  keepAftermath(cave.u);
  cave.webs.A?.set(true);
  cave.webs.B?.set(true);
  cave.cocoon?.set(world.cocoon === "searched");
  cave.satchel.set(world.satchel === "taken");
  cave.setNest(false);
  stage.dragons?.hide();
  if (stage.ai) stage.ai.resetEye();
  hud.stealth(null);
  stage.combatHud?.boss(null);
  w.env.setMood(1);
  const { at, yaw, guideAt } = exitMarks(cave, EXIT_STEPS);
  stage.player?.teleport(at.add(new Vector3(0, 0.02, 0)), yaw);
  const guide = w.npcs.get(guideOf(faction));
  dropTorch(guide);
  if (guide) place3(w, guide, guideAt.x, guideAt.z, guideAt.y, at);
  // the deck's zone: the outdoor world, its profile and wind
  cave.u.check();
  // (the fires pause and resume with the outdoor world: shown now, they burn)
  const fires = () => {
    stage.townFires?.ensure(RAIDED_HOUSES);
    if (w.outdoorVisible) stage.townFires?.resume();
  };
  if (stage.townFires) fires();
  else void stage.ensureTownFx().then(fires, (e) => console.warn("exit: town fires", e));
}
