import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { assets } from "../core/assets/AssetClient";
import { audio } from "../core/audio";
import { input } from "../core/input";
import { hud } from "../ui/hud";
import { PLAYER } from "../engine/combat/attacks";
import { CombatSystem, type CombatEvent, type Combatant } from "../engine/combat/CombatSystem";
import { Encounter, type EncounterActor, type EncounterParticipant, type EncounterSpec, type Mark } from "../engine/combat/Encounter";
import { ArmedCamera, PlayerCombat, type PlayerCombatEvent } from "../engine/combat/PlayerCombat";
import { Vitals } from "../engine/combat/vitals";
import type { TimeScale } from "../engine/core/timeScale";
import type { XYZ } from "../engine/combat/hit";
import type { PrologueFlags } from "./flags";
import type { PlayerGear } from "./gear";
import type { PlayerController } from "./player";
import type { World } from "./World";

/** Factions: the player's side (with the companion), the two armies, the beasts, and bystanders. */
export const FACTION = { player: "player", imperial: "imperial", rebel: "rebel", beast: "beast", neutral: "neutral" } as const;

/** Combat sound cues (audio ids, design §10.4); a cue the build doesn't ship is skipped. */
const SFX = {
  swing: ["audio/sfx_swing_1", "audio/sfx_swing_2", "audio/sfx_swing_3"],
  swingHeavy: ["audio/sfx_swing_heavy"],
  flesh: ["audio/sfx_hit_flesh_1", "audio/sfx_hit_flesh_2", "audio/sfx_hit_flesh_3"],
  axe: ["audio/sfx_hit_axe"],
  block: ["audio/sfx_block_1", "audio/sfx_block_2", "audio/sfx_block_3"],
  shield: ["audio/sfx_shield_hit"],
  parry: ["audio/sfx_parry"],
  draw: ["audio/sfx_draw"],
  pain: ["audio/vo_pain_1", "audio/vo_pain_2", "audio/vo_pain_3", "audio/vo_pain_4"],
  death: ["audio/vo_death_1", "audio/vo_death_2", "audio/vo_death_3"],
  grunt: ["audio/vo_attack_1", "audio/vo_attack_2", "audio/vo_attack_3", "audio/vo_attack_4", "audio/vo_attack_5"],
  fall: ["audio/sfx_bodyfall"],
} as const;

/** The damage multiplier of an armour rating (0 none, 15 rebel leather, 20 garrison leather). */
export function armourMul(rating: PrologueFlags["inv"]["armour"]) {
  return rating === 15 ? PLAYER.armour.rebel : rating === 20 ? PLAYER.armour.imperial : 1;
}

/** The player's max HP for an inventory (the charm adds 15). */
export function playerMaxHp(inv: PrologueFlags["inv"]) {
  return PLAYER.hp + (inv.charm ? PLAYER.charmHp : 0);
}

/** What the combat wiring needs from the stage (the PrologueStage fits). */
export interface CombatStage {
  world: World;
  readonly flags: PrologueFlags;
  state: { update<K extends keyof PrologueFlags>(k: K, fn: (v: PrologueFlags[K]) => PrologueFlags[K] | void): void };
  /** the stage's game-time multiplier (hit-stop, the death slow motion) */
  readonly time: TimeScale;
  snapshotFlags(): void;
  restoreFlags(): Promise<void>;
}

/**
 * The prologue's combat (stage-owned, made by `stage.ensureCombat()`, kept with the player): the
 * combat system on the physics' fixed steps with static line of sight, the player's combatant
 * (stats from §8, armour and the charm from the inventory), the player's controls, feedback
 * (hit-stop on the stage clock, camera shake, sounds), and encounters wired to the story state.
 */
export class PrologueCombat {
  readonly system: CombatSystem;
  /** the player's combatant (its vitals are the HUD's bars) */
  readonly player: Combatant;
  readonly controls: PlayerCombat;
  /** the fight a death retries (the latest one started and not yet won) */
  active: Encounter<EncounterActor> | null = null;
  private encounters = new Set<Encounter<EncounterActor>>();
  private offs: (() => unknown)[] = [];
  private disposed = false;

  constructor(
    private stage: CombatStage,
    private pc: PlayerController,
    gear: PlayerGear,
  ) {
    const world = stage.world;
    const physics = world.physics;
    if (!physics) throw new Error("PrologueCombat: no physics yet");
    this.system = new CombatSystem({ hostile: { [FACTION.player]: [FACTION.imperial, FACTION.rebel, FACTION.beast] }, los: physics, clock: physics });
    const inv = stage.flags.inv;
    const vitals = new Vitals({
      health: playerMaxHp(inv),
      healthRegen: PLAYER.regen,
      healthDelay: PLAYER.regenDelay,
      stamina: PLAYER.stamina,
      staminaRegen: PLAYER.staminaRegen,
      staminaDelay: PLAYER.staminaDelay,
      blockRegen: PLAYER.blockRegen,
      poise: PLAYER.poise,
      poiseDelay: PLAYER.poiseDelay,
      armourMul: armourMul(inv.armour),
    });
    this.player = this.system.add({
      id: "player",
      faction: FACTION.player,
      vitals,
      position: () => pc.position,
      yaw: () => pc.bodyYaw,
      radius: PLAYER.radius,
      // only the player parries (§8: enemies and companions block)
      canParry: true,
      tokens: PLAYER.tokens,
      stagger: PLAYER.stagger,
    });
    this.system.focus = this.player;
    this.controls = new PlayerCombat({
      combat: this.system,
      self: this.player,
      input,
      player: pc,
      gear,
      potions: {
        get: () => stage.flags.inv.potions,
        set: (n) => stage.state.update("inv", (v) => void (v.potions = Math.max(0, n))),
      },
      aim: () => world.rig.yaw,
      rootMotion: world.rootMotion,
      camera: new ArmedCamera(world.rig, pc),
      onDeath: () => void this.playerDied(),
    });
    this.offs.push(
      world.onUpdate((dt) => this.update(dt)),
      this.system.events.on((e) => this.feedback(e)),
      this.controls.events.on((e) => this.controlFeedback(e)),
    );
  }

  /** Per frame (game time): the controls, the inventory's armour and charm, the encounters. */
  private update(dt: number) {
    if (this.disposed) return;
    const inv = this.stage.flags.inv;
    const v = this.player.vitals;
    v.armourMul = armourMul(inv.armour);
    const max = playerMaxHp(inv);
    if (v.maxHp !== max && !v.dead) v.setMaxHp(max);
    this.controls.update(dt);
    for (const e of [...this.encounters]) {
      if (e.state === "disposed") {
        this.encounters.delete(e);
        if (this.active === e) this.active = null;
      } else e.update();
    }
  }

  /**
   * A fight wired to the stage: retries roll the story flags back to its start (potions come
   * back), deaths are counted in `flags.deaths`, the screen fades through black, the player (and
   * the companion, when given) go to the retry marks. The chapter starts it (`start()`), and
   * disposes it (or it is disposed with the combat).
   */
  encounter<A extends EncounterActor>(spec: EncounterSpec<A>, o: { companion?: EncounterParticipant | null } = {}): Encounter<A> {
    const st = this.stage;
    const world = st.world;
    const e = new Encounter<A>(spec, {
      combat: this.system,
      player: {
        combatant: this.player,
        teleport: (m: Mark) => this.pc.teleport(new Vector3(m.x, m.y, m.z), m.yaw),
        reset: () => this.controls.reset(),
      },
      companion: o.companion ?? null,
      time: st.time,
      fade: (on, s) => hud.fade(on, s),
      sleep: (s) =>
        new Promise<void>((resolve) => {
          let t = 0;
          const off = world.onUpdate((dt) => {
            t += dt;
            if (t >= s || world.disposed) {
              off();
              resolve();
            }
          });
        }),
      deaths: {
        get: (id) => st.flags.deaths[id] ?? 0,
        set: (id, n) => st.state.update("deaths", (d) => void (d[id] = n)),
      },
      snapshot: () => st.snapshotFlags(),
      restore: () => st.restoreFlags(),
      music: (id) => (id ? void audio.playMusic(id, { fade: 2 }).catch(() => {}) : audio.stopMusic(2)),
    });
    const any = e as unknown as Encounter<EncounterActor>;
    this.encounters.add(any);
    // the fight a death retries from the moment it begins (its enemies may still be loading)
    e.events.on((ev) => {
      if (ev.type === "begin") this.active = any;
      else if (ev.type === "clear" && this.active === any) this.active = null;
    });
    return e;
  }

  /**
   * The player fell: the active fight retries (a fight disposed mid-retry gets the player up
   * itself); outside one, get up where it happened.
   */
  private async playerDied() {
    const e = this.active;
    if (e && e.state === "active") return e.playerDied();
    await hud.fade(true, 1.5);
    // (disposed meanwhile, or a script got the player up already)
    if (this.disposed || !this.player.vitals.dead) return void hud.fade(false, 1.5);
    this.system.resetState(this.player, 1);
    this.controls.reset();
    void hud.fade(false, 1.5);
  }

  /** Kill every enemy of the player (tests, `?debug`). */
  debugKillAll() {
    this.system.debugKillAll(this.player);
  }

  // ------------------------------------------------------------------ feedback

  private feedback(e: CombatEvent) {
    const w = this.stage.world;
    switch (e.type) {
      case "hitStop":
        this.stage.time.hitStop(e.seconds);
        break;
      case "shake":
        w.rig.shake(e.amplitude, e.seconds);
        break;
      case "windup":
        // the grunt of a human wind-up (the glint is the AI's)
        if (e.attacker !== this.player && e.attacker.kind === "humanoid") sound(SFX.grunt, chest(e.attacker.pose), 0.7);
        break;
      case "swing":
        sound(e.attack.heavy ? SFX.swingHeavy : SFX.swing, chest(e.attacker.pose), 0.6, 0.9 + Math.random() * 0.2);
        break;
      case "hit": {
        const h = e.hit;
        const at = h.point;
        if (h.outcome === "parried") sound(SFX.parry, at, 1);
        else if (h.outcome === "blocked" || h.outcome === "absorbed") sound(h.target.guard.shield || h.outcome === "absorbed" ? SFX.shield : SFX.block, at, 0.9);
        else {
          if (h.outcome === "guardBreak") sound(h.target.guard.shield ? SFX.shield : SFX.block, at, 1);
          sound(h.attack.id.startsWith("axe") ? SFX.axe : SFX.flesh, at, 0.9);
          if (!h.killed && h.damage > 0 && h.target.kind === "humanoid") sound(SFX.pain, at, 0.8, 0.95 + Math.random() * 0.1);
        }
        break;
      }
      case "death":
        if (e.target.kind === "humanoid") sound(SFX.death, chest(e.target.pose), 0.9);
        sound(SFX.fall, e.target.pose, 0.8);
        break;
    }
  }

  private controlFeedback(e: PlayerCombatEvent) {
    if (e.type === "draw") sound(SFX.draw, chest(this.player.pose), 0.7);
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    for (const off of this.offs) off();
    this.offs = [];
    for (const e of this.encounters) e.dispose();
    this.encounters.clear();
    this.active = null;
    this.controls.dispose();
    this.system.dispose();
  }
}

const chest = (p: XYZ) => ({ x: p.x, y: p.y + 1.3, z: p.z });

/** One of `ids` at `pos`, if the build ships it. */
function sound(ids: readonly string[], pos: XYZ, volume: number, rate = 1) {
  const id = ids[Math.floor(Math.random() * ids.length)];
  if (!id || !assets.has(id)) return;
  void audio.playOneShot(id, volume, pos, "sfx", rate, 4);
}
