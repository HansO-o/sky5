import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { objective } from "../../ui/compass";
import { OUTFITS, type Character } from "../../world/characters";
import { place3, stand } from "../actors";
import { RAIDED_HOUSES } from "../fx/townFires";
import type { Faction } from "../flags";
import type { PlayerController } from "../player";
import type { Underground } from "../keep/underground";
import type { World } from "../World";
import { KEEP_BEATS, objectiveOf, scriptState, type KeepBeat } from "./keepScript";
import type { Chapter, ChapterContext } from "./types";

/** The keep chapter's checkpoints (design §11). Steps 0–4 are the first half (K0–K5). */
export const KEEP_STEPS = 8;

/** Step 0: the forecourt before the gate (§11; the K0 marks of §4.1). */
const K0 = { player: { x: 60, y: 38.2, z: -648, yaw: 0 }, brun: { x: 56, z: -649 }, scribe: { x: 60.5, z: -650.8 } };

/** The keep anchors' checkpoint for a step and route (steps 1–6), or the cave's (7, 8). */
const CP: Record<number, { keep?: (f: Faction) => string; cave?: [string, string] }> = {
  1: { keep: (f) => (f === "rebel" ? "cp_k1_reb" : "cp_k1_imp") },
  2: { keep: (f) => (f === "rebel" ? "cp_k2_reb" : "cp_k2_imp") },
  3: { keep: () => "cp_k3" },
  4: { keep: () => "cp_k4" },
  5: { keep: () => "cp_k5" },
  6: { keep: () => "cp_k6" },
  7: { cave: ["cp_gallery", "comp_gallery"] },
  8: { cave: ["lever_stance", "comp_lever"] },
};

/** The beat a resumed step plays next and which of its objective lines comes first (§5.1). */
const RESUME: Record<number, [KeepBeat, number]> = {
  0: ["K0", 0],
  1: ["K2", 0],
  2: ["K3", 0],
  3: ["K4", 1],
  4: ["K6", 0],
  5: ["K7", 0],
  6: ["K10", 0],
  7: ["K10", 0],
  8: ["K11", 0],
};

/** The NPC specs of the two guides (as the dragon chapter made them). */
const CAST: Record<"brun" | "scribe", Parameters<World["npc"]>[1]> = {
  brun: { outfit: OUTFITS.rebel, hair: ["hair_simpleparted", "hair_beard"] },
  scribe: { outfit: OUTFITS.soldier, hair: ["hair_simpleparted"] },
};

const companionOf = (f: Faction): "brun" | "scribe" => (f === "rebel" ? "brun" : "scribe");

/**
 * Chapter 6 (要塞), first stage of its implementation: the world and the checkpoints. `prepare`
 * puts the world, the player and the guide in the state of any §11 checkpoint (steps 0–8; the
 * story's first half is 0–4), and `run` shows that step's objective and waits; the beats (K0–K12)
 * come with the chapter's script. `?debug&chapter=keep&from=<step>[&faction=imperial]` starts at a
 * checkpoint. Headless contract: `stage.chapter.{id, step}`, `stage.underground`.
 */
export class KeepChapter implements Chapter {
  id = "keep" as const;
  label = "要塞";
  seamless = true;
  step = 0;
  player!: PlayerController;
  /** the side taken at the gate (decided at step 0; the flags keep it) */
  faction: Faction | null = null;
  private u: Underground | null = null;
  private alive = true;
  private started = false;

  constructor(private ctx: ChapterContext) {}

  private get w() {
    return this.ctx.world;
  }

  async prepare(resume: Record<string, unknown> | null, continued = false) {
    const { stage } = this.ctx;
    this.step = Math.max(0, Math.min(KEEP_STEPS, Math.floor(Number(resume?.step ?? 0)) || 0));
    const q = new URLSearchParams(location.search);
    if (q.has("debug") && q.get("from") !== null) {
      const n = Number(q.get("from"));
      if (Number.isFinite(n)) this.step = Math.max(0, Math.min(KEEP_STEPS, Math.floor(n)));
    }
    const f = stage.flags;
    const debugFaction = q.has("debug") ? q.get("faction") : null;
    if (this.step > 0 && !f.faction) stage.state.set("faction", debugFaction === "imperial" ? "imperial" : "rebel");
    this.faction = stage.flags.faction ?? null;
    await stage.ensureTown();
    if (this.step === 0) await this.prepareGate(continued);
    else await this.prepareInside();
    const [beat, i] = RESUME[this.step];
    const b = KEEP_BEATS.find((x) => x.id === beat)!;
    const lines = objectiveOf(b, this.faction ?? "rebel", scriptState(stage.flags));
    stage.objective(lines[i] ?? lines[0] ?? null);
  }

  /** Step 0: the forecourt; the town burns, the dragon circles; the underground loads behind it. */
  private async prepareGate(continued: boolean) {
    const { stage } = this.ctx;
    const w = this.w;
    const brun = w.npc("brun", CAST.brun);
    const scribe = w.npc("scribe", CAST.scribe);
    if (!continued) {
      stand(w, brun, K0.brun.x, K0.brun.z, K0.player);
      stand(w, scribe, K0.scribe.x, K0.scribe.z, K0.player);
    }
    const p = K0.player;
    this.player = await stage.ensurePlayer(new Vector3(p.x, w.heightAt(p.x, p.z) + 0.05, p.z), p.yaw);
    this.player.enabled = true;
    this.player.canMove = true;
    this.player.firstPerson = true;
    this.player.bound = false;
    stage.gate?.set(0);
    stage.postern?.set(0);
    // the doors open only once the interior is in (K1 waits for it); K0 itself needs nothing new
    void stage.ensureUnderground().then(
      (u) => (this.u = u),
      (e) => console.warn("keep: underground", e),
    );
    if (!continued) {
      // a start at the forecourt: the town as the raid left it
      const [dragons] = await Promise.all([stage.ensureDragons(), stage.ensureTownFx()]);
      stage.townFires?.ensure(RAIDED_HOUSES);
      w.env.setMood(1);
      dragons.circuit({ x: 72, z: -592 }, 80, w.heightAt(72, -592) + 40, w.heightAt(72, -592) + 60, [14, 18]);
    }
  }

  /** Steps 1–8: inside (the keep or the gallery), at the checkpoint, the world in its state (§11). */
  private async prepareInside() {
    const { stage } = this.ctx;
    const w = this.w;
    const u = (this.u = await stage.ensureUnderground());
    const faction = this.faction ?? "rebel";
    const step = this.step;
    stage.dragons?.hide();
    // the guide with the player; the other one went his own way
    const comp = companionOf(faction);
    const other = comp === "brun" ? "scribe" : "brun";
    w.removeNpc(other);
    const guide = w.npc(comp, CAST[comp]);
    // where the player and the guide stand
    const cp = CP[step];
    let at: Vector3, yaw: number, cAt: Vector3;
    if (cp.keep) {
      const a = u.anchor(cp.keep(faction));
      at = a.pos;
      yaw = a.yaw;
      const c = a.def.companion ?? [a.def.world[0] - 1, a.def.world[1], a.def.world[2]];
      cAt = new Vector3(c[0], at.y, c[2]);
    } else {
      const a = u.caveAnchor(cp.cave![0]);
      at = a.pos;
      yaw = a.yaw;
      cAt = u.caveAnchor(cp.cave![1]).pos;
    }
    const floor = u.floor(at.x, at.z, at.y) ?? at.y;
    this.player = await stage.ensurePlayer(new Vector3(at.x, floor + 0.02, at.z), yaw);
    place3(w, guide, cAt.x, cAt.z, cAt.y, at);
    // the doors and blockers of the step
    this.setWorld(u, faction, step);
    // the kit: bound at step 1, geared from step 2 (filled if missing)
    const pl = this.player;
    pl.enabled = true;
    pl.canMove = true;
    pl.firstPerson = true;
    pl.bound = step === 1;
    if (step >= 2) {
      stage.state.update("inv", (inv) => {
        if (inv.weapon === "none") inv.weapon = "sword";
        if (faction === "imperial") inv.shield = true;
        if (inv.armour === 0) inv.armour = faction === "rebel" ? 15 : 20;
        if (step >= 3) {
          inv.keyring = true;
          inv.potions = Math.max(inv.potions, 1);
        }
        if (step >= 4) inv.potions = Math.max(inv.potions, 3);
      });
    }
    const gear = stage.ensureGear();
    await gear.sync(stage.flags.inv, { dip: 0 });
    // the profile, sets and beds of where the player now stands
    u.check();
  }

  /** Doors, blockers and props as they stand at `step` (§11's world-state column). */
  private setWorld(u: Underground, faction: Faction, step: number) {
    const { stage } = this.ctx;
    stage.gate?.set(0);
    stage.postern?.set(0);
    const inside = step >= 1;
    // the way in is shut behind the player: the beam on the postern, the bar on the gate
    const rebel = faction === "rebel";
    u.setBlocker("blocker_postern", inside && rebel);
    u.props.beam(inside && rebel);
    u.setBlocker("blocker_gate", inside && !rebel);
    u.props.gateBar(inside && !rebel);
    const d = u.doors;
    d.g2_door?.set(rebel && step >= 1 ? 1 : 0);
    if (d.store_door) {
      d.store_door.locked = step < 3;
      d.store_door.set(step >= 4 ? 1 : 0);
    }
    d.stair_door?.set(step >= 4 ? 1 : 0);
    d.torture_door?.set(step >= 5 ? 1 : 0);
    d.cell_gate?.set(1);
    if (step >= 6) u.openDrain();
    // the gear is taken from step 2 on: the route's chest stands open, its weapons are off the rack
    if (step >= 2) {
      const chest = u.props.chest(rebel ? "use_chest_reb" : "use_locker_imp");
      chest?.set(true);
      const rack = u.props.rack(rebel ? "use_weaponstand_reb" : "use_weaponstand_imp");
      rack?.take("sword");
      if (!rebel) rack?.take("shield");
    }
    if (step >= 4) u.props.shelf?.setLeft(0);
    if (step >= 5 && u.props.cage) u.props.cage.door.set(1);
  }

  async run() {
    this.started = true;
    const { director: d, stage } = this.ctx;
    const u = this.u;
    const [beat, i] = RESUME[this.step];
    const b = KEEP_BEATS.find((x) => x.id === beat)!;
    const lines = objectiveOf(b, this.faction ?? "rebel", scriptState(stage.flags));
    const text = lines[i] ?? lines[0];
    if (text) objective.set(text, this.target(u), false);
    // the beats come with the chapter's script; until then the checkpoint waits here
    await d.until(() => !this.alive);
  }

  /** Where the step's objective points (null: no marker). */
  private target(u: Underground | null): (() => { x: number; y: number; z: number } | null) | null {
    if (!u || this.step === 0) return null;
    const rebel = (this.faction ?? "rebel") === "rebel";
    const name =
      this.step === 1 ? (rebel ? "use_chest_reb" : "use_locker_imp")
      : this.step === 3 ? null
      : this.step === 4 ? "mark_interrog"
      : null;
    if (this.step === 3) {
      const h = u.keep.doors.store_door.hinge.local;
      const p = u.keepPoint(h).add(new Vector3(0, 1.4, 0));
      return () => p;
    }
    if (!name) return null;
    const p = u.anchor(name).pos.add(new Vector3(0, 1.2, 0));
    return () => p;
  }

  save() {
    return { step: this.step };
  }

  /** The choice at the gate (step 0) is the player's to make. */
  canSkip() {
    return this.step > 0;
  }

  /**
   * The chapter's end state (§11 keep.skip): the side taken (the NPC the player faces, else the
   * rebels), the kit filled, the keep's people gone, the doors shut and barred, the drain open, the
   * player and the guide on the gallery's far bank (`gal_s_cp`, `comp_s`) under the cave profile.
   */
  skip() {
    const { stage } = this.ctx;
    const w = this.w;
    this.alive = false;
    stage.dragons?.hide();
    if (!stage.flags.faction) stage.state.set("faction", this.facing() ?? "rebel");
    const faction = stage.flags.faction ?? "rebel";
    this.faction = faction;
    stage.state.update("inv", (inv) => {
      inv.weapon = inv.weapon === "none" ? "sword" : inv.weapon;
      if (faction === "imperial") inv.shield = true;
      inv.armour = faction === "rebel" ? 15 : 20;
      inv.potions = Math.max(inv.potions, 3);
      inv.keyring = true;
    });
    stage.state.update("outcomes", (o) => {
      o.torture ??= faction === "rebel" ? "killed" : "bluff";
    });
    w.removeNpc(companionOf(faction) === "brun" ? "scribe" : "brun");
    if (this.player) this.player.bound = false;
    void stage.gear?.sync(stage.flags.inv, { dip: 0 });
    const u = this.u ?? stage.underground;
    if (!u) {
      // the interior never came in: leave the player before the gate
      const p = K0.player;
      this.player?.teleport(new Vector3(p.x, w.heightAt(p.x, p.z) + 0.05, p.z), p.yaw);
      return;
    }
    this.step = KEEP_STEPS;
    this.setWorld(u, faction, KEEP_STEPS);
    u.doors.torture_door?.set(0);
    u.doors.g2_door?.set(0);
    if (!u.cave) return;
    const s = u.caveAnchor("gal_s_cp");
    this.player?.teleport(new Vector3(s.pos.x, s.pos.y + 0.02, s.pos.z), 0.2);
    const c = w.npcs.get(companionOf(faction));
    if (c) {
      const cs = u.caveAnchor("comp_s").pos;
      place3(w, c, cs.x, cs.z, cs.y, s.pos);
    }
    w.env.setInterior("cave", 0.5);
    u.check();
  }

  /** The guide the player looks toward (step 0's choice when skipped), or null. */
  private facing(): Faction | null {
    const pl = this.player;
    if (!pl) return null;
    const yaw = this.w.rig.yaw;
    const fx = -Math.sin(yaw), fz = -Math.cos(yaw);
    let best: Faction | null = null, bestDot = 0.5;
    for (const [k, f] of [["brun", "rebel"], ["scribe", "imperial"]] as const) {
      const c: Character | undefined = this.w.npcs.get(k);
      if (!c) continue;
      const dx = c.root.position.x - pl.position.x, dz = c.root.position.z - pl.position.z;
      const d = Math.hypot(dx, dz) || 1;
      const dot = (dx * fx + dz * fz) / d;
      if (dot > bestDot) {
        bestDot = dot;
        best = f;
      }
    }
    return best;
  }

  /** Ends what is the chapter's own; the underground, the dragon and the fires stay with the stage. */
  dispose() {
    this.alive = false;
    void this.started;
  }
}

