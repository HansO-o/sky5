import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Frustum } from "@babylonjs/core/Maths/math.frustum";
import { assets } from "../../core/assets/AssetClient";
import { audio } from "../../core/audio";
import { objective } from "../../ui/compass";
import { hud } from "../../ui/hud";
import type { Equipment } from "../../engine/actors/Equipment";
import type { Interactables } from "../../engine/world/Interactables";
import { OUTFITS, type Character } from "../../world/characters";
import { faceTo, place3, setYaw, stand, stopWalk, walkPath } from "../actors";
import type { CompanionActor } from "../ai";
import { Cancelled } from "../Director";
import { RAIDED_HOUSES } from "../fx/townFires";
import type { Faction } from "../flags";
import { armNpc } from "../gear";
import { nag } from "../nag";
import type { PlayerController } from "../player";
import { cue } from "../keep/cues";
import { KeepE1 } from "../keep/e1";
import { fillLoadout, gearLootIds, lootId, rackTaken, routeGear } from "../keep/loot";
import type { ChestProp, RackProp, RackSlot } from "../keep/props";
import type { Underground } from "../keep/underground";
import type { World } from "../World";
import {
  fill,
  K0_NAGS,
  KEEP_BARKS,
  KEEP_BEATS,
  KEEP_PROMPTS,
  KEEP_TIMING,
  KEEP_TIPS,
  KEEP_TOASTS,
  line,
  lines,
  objectiveOf,
  scriptState,
  type KeepBeat,
  type KeepLineId,
  type ScriptLine,
} from "./keepScript";
import type { Chapter, ChapterContext } from "./types";

/** The keep chapter's checkpoints (design §11). Steps 0–4 are the first half (K0–K5). */
export const KEEP_STEPS = 8;
/** The last checkpoint the written beats reach: the stair foot (K5). */
const FIRST_HALF_END = 4;

/** Step 0: the forecourt before the gate (§11; the K0 marks of §4.1). */
const K0 = { player: { x: 60, y: 38.2, z: -648, yaw: 0 }, brun: { x: 56, z: -649 }, scribe: { x: 60.5, z: -650.8 } };
/** The forecourt's centre: the K0 leash is measured from here (§5.2). */
const FORECOURT = { x: 60, z: -650 };
/** Brun's wait by the west postern (looping Idle_Rail_Call), and the postern's outside step (§4.1). */
const POSTERN_WAIT = { x: 43.6, z: -657.5, yaw: -2.1 };
const POSTERN_OUT = { x: 46.4, y: 38.05, z: -659.0 };
/** The scribe at the main gate, facing the door (looping Interact). */
const GATE_WAIT = { x: 61.0, z: -652.6 };
/** Where the crenellation block lands, to the side of the steps (§4.1). */
const CRENELLATION = { x: 64.5, y: 38.3, z: -650.5 };
/** The K0 pass (§4.5, 32 m/s), then the circuit over the town until the doors shut. */
const K0_PASS: readonly [number, number, number][] = [
  [54, 150, -725],
  [56, 125, -708],
  [60, 64, -664],
  [78, 55, -628],
  [110, 70, -590],
  [170, 95, -560],
];
const K0_CIRCUIT = { center: { x: 72, z: -592 }, r: 80, above: [40, 60] as const, roar: [14, 18] as const };
/** Door middles on the ground floor (world x, z): the guard room's, the storeroom's, the stairwell's. */
const DOOR = { g2: { x: 53.7, z: -657.0 }, store: { x: 66.3, z: -658.3 }, stair: { x: 69.7, z: -661.1 } } as const;

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

/**
 * Where the guide stands instead of the anchors' mark: the rebel E1 retry mark (55.4, −656.6) is
 * 0.9 m in front of the player's face (§11's (53.6, −656.0) lies in the G1/G2 partition), so Brun
 * waits just behind, in G2 by the door the two came through.
 */
const COMPANION_AT: Record<string, [number, number]> = { cp_k2_reb: [52.9, -657.0] };

/**
 * The objective line a resumed step shows while it prepares (null: none yet). Step 0's comes with
 * the doors at 20 s, step 1's after the bonds shot, and step 4 is where the written half ends.
 */
const RESUME: Record<number, [KeepBeat, number] | null> = {
  0: null,
  1: null,
  2: ["K3", 0],
  3: ["K4", 1],
  4: null,
  5: ["K7", 0],
  6: ["K10", 0],
  7: ["K10", 0],
  8: ["K11", 0],
};

/** The NPC specs of the two guides (as the dragon chapter made them), and the gate guard (§1). */
const CAST: Record<"brun" | "scribe" | "gateguard", Parameters<World["npc"]>[1]> = {
  brun: { outfit: OUTFITS.rebel, hair: ["hair_simpleparted", "hair_beard"] },
  scribe: { outfit: OUTFITS.soldier, hair: ["hair_simpleparted"] },
  gateguard: { outfit: OUTFITS.soldier.filter((p) => p !== "outfit_ranger_Head_Hood"), hair: ["hair_buzzed"] },
};

const companionOf = (f: Faction): "brun" | "scribe" => (f === "rebel" ? "brun" : "scribe");
const beatOf = (id: KeepBeat) => KEEP_BEATS.find((b) => b.id === id)!;
const rand = (a: number, b: number) => a + Math.random() * (b - a);
const flat = (a: { x: number; z: number }, b: { x: number; z: number }) => Math.hypot(a.x - b.x, a.z - b.z);

/**
 * Chapter 6 (要塞), the first half (design §5.1 K0–K5, both routes): the two doors and the choice at
 * the gate, the way in with the guide, the bonds cut, the gear, the first fight (E1), the leader's
 * key ring and the storeroom, the stairs down with the tremor, ending at the stair foot (step 4),
 * where the stage shows its end card until the rest is written. Every step change is a checkpoint
 * (§11): `?debug&chapter=keep&from=<step>[&faction=imperial]` starts at one.
 *
 * Headless contract: `stage.chapter.{id, step, beat, faction}`, `debugChoose("brun" | "scribe")`,
 * `e1` (the fight: `encounter`, `leader`, `tutor`), `companion` (the guide's AI once it fights),
 * `inter` (the chapter's interactables: `use(id)`), `stage.underground`.
 */
export class KeepChapter implements Chapter {
  id = "keep" as const;
  label = "要塞";
  seamless = true;
  step = 0;
  player!: PlayerController;
  /** the side taken at the gate (decided at step 0; the flags keep it) */
  faction: Faction | null = null;
  /** where the story is (K0 … K5, "end"): for tests and logs */
  beat = "K0";
  /** the fight in the hall (E1), from K3 */
  e1: KeepE1 | null = null;
  /** the guide as a fighter and follower, from K3 */
  companion: CompanionActor | null = null;
  /** the chapter's interactables (prompts) */
  inter: Interactables | null = null;
  /** the choice made at the gate (from the E prompt, or `debugChoose`) */
  private choice: Faction | null = null;
  private committed = false;
  private atDoors = false;
  private doorsShut = false;
  private u: Underground | null = null;
  private alive = true;
  private started = false;
  /** the guide's weapons (Brun's father's axe; Ivo's sword and shield) */
  private kit: Equipment | null = null;
  /** the guide's torch (from step 6, or the skip's end state) */
  private torch: { dispose(): void } | null = null;
  private offs: (() => unknown)[] = [];
  private loading = false;
  /** a camera shot holds the player (the bonds): what gives control back */
  private shot: (() => void) | null = null;
  private eyeTmp = new Vector3();

  constructor(private ctx: ChapterContext) {}

  private get w() {
    return this.ctx.world;
  }

  private get d() {
    return this.ctx.director;
  }

  private get rebel() {
    return (this.faction ?? "rebel") === "rebel";
  }

  async prepare(resume: Record<string, unknown> | null, continued = false) {
    const { stage } = this.ctx;
    this.step = Math.max(0, Math.min(KEEP_STEPS, Math.floor(Number(resume?.step ?? 0)) || 0));
    const q = new URLSearchParams(location.search);
    // (the debug start's own parameters: `from` names another chapter's step when it started elsewhere)
    const debug = q.has("debug") && q.get("chapter") === this.id;
    if (debug && q.get("from") !== null) {
      const n = Number(q.get("from"));
      if (Number.isFinite(n)) this.step = Math.max(0, Math.min(KEEP_STEPS, Math.floor(n)));
    }
    const f = stage.flags;
    const debugFaction = debug ? q.get("faction") : null;
    if (this.step > 0 && !f.faction) stage.state.set("faction", debugFaction === "imperial" ? "imperial" : "rebel");
    this.faction = this.step > 0 ? (stage.flags.faction ?? null) : null;
    this.committed = this.step > 0;
    await stage.ensureTown();
    if (this.step === 0) await this.prepareGate(continued);
    else await this.prepareInside();
    stage.objective(this.objectiveLine());
  }

  /** The step's objective line (null: none yet). */
  private objectiveLine(): string | null {
    const r = RESUME[this.step];
    if (!r) return null;
    const ls = objectiveOf(beatOf(r[0]), this.faction ?? "rebel", scriptState(this.ctx.stage.flags));
    return ls[r[1]] ?? ls[0] ?? null;
  }

  /** The objective line `i` of a beat on this route. */
  private obj(id: KeepBeat, i = 0) {
    const ls = objectiveOf(beatOf(id), this.faction ?? "rebel", scriptState(this.ctx.stage.flags));
    return ls[i] ?? ls[ls.length - 1];
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
    if (continued && stage.player) {
      // picked up mid-shot from the dragon chapter: the player stays where it left them, facing
      // where they looked (a skipped dragon chapter has put them on the K0 marks already)
      this.player = stage.player;
    } else {
      const p = K0.player;
      this.player = await stage.ensurePlayer(new Vector3(p.x, w.heightAt(p.x, p.z) + 0.05, p.z), p.yaw);
    }
    this.player.enabled = true;
    this.player.canMove = true;
    this.player.firstPerson = true;
    // still a prisoner: the rope cuffs show until the bonds are cut inside (K1); the gear also
    // starts loading the combat clips (the latch, the bonds, the chest) behind the forecourt
    stage.ensureGear();
    this.player.bound = true;
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
      const g = w.heightAt(K0_CIRCUIT.center.x, K0_CIRCUIT.center.z);
      dragons.circuit(K0_CIRCUIT.center, K0_CIRCUIT.r, g + K0_CIRCUIT.above[0], g + K0_CIRCUIT.above[1], K0_CIRCUIT.roar);
    }
  }

  /** Steps 1–8: inside (the keep or the gallery), at the checkpoint, the world in its state (§11). */
  private async prepareInside() {
    const { stage } = this.ctx;
    const w = this.w;
    const u = (this.u = await stage.ensureUnderground());
    const faction = this.faction ?? "rebel";
    const step = this.step;
    this.doorsShut = true;
    stage.dragons?.hide();
    // the guide with the player; the other one went his own way
    const comp = companionOf(faction);
    const other = comp === "brun" ? "scribe" : "brun";
    w.removeNpc(other);
    w.removeNpc("gateguard");
    const guide = w.npc(comp, CAST[comp]);
    // where the player and the guide stand
    const cp = CP[step];
    let at: Vector3, yaw: number, cAt: Vector3;
    if (cp.keep) {
      const a = u.anchor(cp.keep(faction));
      at = a.pos;
      yaw = a.yaw;
      const o = COMPANION_AT[cp.keep(faction)];
      const c = o ? [o[0], 0, o[1]] : (a.def.companion ?? [a.def.world[0] - 1, a.def.world[1], a.def.world[2]]);
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
    // from the drain on (step 6) the guide carries a wall torch (§11)
    if (step >= 6) this.torchFor(u, guide);
    // inside, the town's wind and panic are behind the walls (§10.5 K1–K2); no music until a fight
    this.quietOutside();
    audio.stopMusic(3);
    // the kit: bound at step 1, geared from step 2 (filled if missing)
    const pl = this.player;
    pl.enabled = true;
    pl.canMove = true;
    pl.firstPerson = true;
    const gear = stage.ensureGear();
    pl.bound = step === 1;
    // (what the player chose to leave at a stand stays left: keep/loot.ts fillLoadout)
    const looted = stage.flags.looted;
    stage.state.update("inv", (inv) => void fillLoadout(inv, looted, faction, step));
    await gear.sync(stage.flags.inv, { dip: 0 });
    // the doors, blockers and gear spots of the step (after the loadout: the stands lose what it holds)
    this.setWorld(u, faction, step);
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
    // the gear is taken from step 2 on: the route's chest stands open (its armour is worn), and the
    // stand has lost what the flags say was taken (the loot ids, else the loadout; §3.8, §12), which
    // the flags then record, so a later resume reads the same state from `looted` alone
    if (step >= 2) {
      const f = stage.flags;
      const g = routeGear(faction);
      u.props.chest(g.chest)?.set(f.inv.armour > 0 || f.looted.includes(lootId(g.chest)));
      const rack = u.props.rack(g.rack);
      const taken = rack ? rackTaken(g.rack, rack.slots, f.inv, f.looted, rebel) : [];
      for (const id of taken) rack!.take(id);
      const ids = gearLootIds(faction, taken, f.inv, f.looted);
      if (ids.length) stage.state.update("looted", (l) => void l.push(...ids));
    }
    // the barracks footlocker stands open once its letter is taken; the storeroom shelf is bare from step 4
    if (stage.flags.looted.includes(lootId("use_footlocker"))) u.props.chest("use_footlocker")?.set(true);
    if (step >= 4 || stage.flags.looted.includes(lootId("use_store_potions"))) u.props.shelf?.setLeft(0);
    if (step >= 5 && u.props.cage) u.props.cage.door.set(1);
  }

  // ==================================================================================== run

  async run() {
    this.started = true;
    const { stage } = this.ctx;
    const d = this.d;
    // a chapter fades itself in (a skip, or a failed chapter passed over, leaves the screen black;
    // after a seamless handover this does nothing)
    void hud.fade(false, 1.2);
    // at the gate the town still burns round the player (§10.5 K0); inside, the walls keep it out.
    // After the dragon chapter both beds are still running (they are the stage's until K1), and
    // these do nothing: the ambience carries on through the cut instead of starting over
    if (this.step === 0) {
      void audio.startBed("wind", "audio/wind", 0.25, 3).catch(() => {});
      void audio.startBed("panic", "audio/panic", 0.45, 3).catch(() => {});
    }
    const text = this.objectiveLine();
    if (text) objective.set(text, this.resumeTarget(), false);
    if (this.step === 0) {
      await this.k0();
      await this.k1Enter();
    }
    if (this.step === 1) {
      await this.k1Bonds();
      await this.k2();
    }
    if (this.step === 2) {
      await this.k3();
      await this.k4Body();
    }
    if (this.step === 3) {
      await this.k4Store();
      await this.k5();
    }
    // the stair foot (step 4): the written half ends here and the stage shows its end card
    this.beat = "end";
    if (stage.flags.faction) await d.sleep(1.2);
  }

  /** Where a resumed step's objective points (null: no marker). */
  private resumeTarget(): (() => { x: number; y: number; z: number } | null) | null {
    const u = this.u ?? this.ctx.stage.underground;
    if (!u) return null;
    if (this.step === 2) return null;
    if (this.step === 3) return this.doorMark(DOOR.store);
    return null;
  }

  /** A door middle on the ground floor, at eye height, as an objective target. */
  private doorMark(p: { x: number; z: number }) {
    const v = this.gf(p.x, p.z).addInPlaceFromFloats(0, 1.2, 0);
    return () => v;
  }

  /** A point on the keep's ground floor (world x, z). */
  private gf(x: number, z: number) {
    const u = this.u ?? this.ctx.stage.underground;
    return new Vector3(x, (u ? u.origin.y : 37.73) + 0.4, z);
  }

  /** A point on the terrain (world x, z). */
  private ground(x: number, z: number) {
    return new Vector3(x, this.w.heightAt(x, z), z);
  }

  // ------------------------------------------------------------------ K0 the two doors

  /**
   * K0 (§5.2): the dragon's pass and the falling crenellation, the argument, the guides run to their
   * doors and call out, and the player commits with an E prompt on either of them. No timer and no
   * auto-commit; wandering off brings fireballs and, further, a fade back to the start.
   */
  private async k0() {
    const { stage } = this.ctx;
    const d = this.d;
    const w = this.w;
    this.beat = "K0";
    // every line at the gate matters: no hold-to-skip until the choice is made
    d.skipLines = false;
    const brun = w.npc("brun", CAST.brun);
    const scribe = w.npc("scribe", CAST.scribe);
    for (const c of [brun, scribe]) {
      // (a walk the dragon chapter left running would carry him off)
      stopWalk(c);
      faceTo(c, this.player.position);
      this.playIf(c, "Crouch_Idle_Loop");
    }
    void w.ensureCombat().catch(() => {});
    this.detach(this.k0Dragon());
    this.offs.push(this.awayGuard());
    // the two prompts, live once the guides stand at their doors
    const inter = this.interactables();
    let open = false;
    const head = (c: Character) => () => c.root.position;
    inter.add({ id: "follow_brun", pos: head(brun), label: KEEP_PROMPTS.followBrun, radius: 3, enabled: () => open && !this.choice, use: () => this.choose("rebel") });
    inter.add({ id: "follow_scribe", pos: head(scribe), label: KEEP_PROMPTS.followScribe, radius: 3, enabled: () => open && !this.choice, use: () => this.choose("imperial") });
    const t0 = d.time;
    const at = (t: number) => d.until(() => d.time - t0 >= t || !!this.choice);
    this.detach(
      (async () => {
        await at(1);
        if (!this.choice) this.crenellation();
        await at(3);
        if (!this.choice) {
          const dr = stage.dragons?.dragon;
          if (dr) {
            void dr.roar("roar_b", 2.2, 1).catch(() => {});
            w.rig.lookToward(() => dr.root.position, 0.8);
          }
          w.rig.shake(0.025, 1.8);
        }
        await at(KEEP_TIMING.argument.at);
        for (const l of lines("K0", "both", { on: "main" })) {
          if (this.choice) return;
          await this.sayLine(l);
        }
        await at(KEEP_TIMING.nag.from);
        if (this.choice) return;
        this.toDoors();
        objective.set(this.obj("K0"), this.choiceTarget());
        open = true;
        // two nudges toward the doors: Brun's, then the scribe's
        w.rig.lookToward(() => brun.root.position.add(new Vector3(0, 1.4, 0)), 1.0);
        await d.sleep(1.0);
        if (!this.choice) w.rig.lookToward(() => scribe.root.position.add(new Vector3(0, 1.4, 0)), 1.0);
        // the nags (barks, alternating), then the objective as a toast now and then
        const N = KEEP_TIMING.nag;
        for (let i = 0; i < N.max && !this.choice; i++) {
          await d.sleep(N.every);
          if (this.choice) return;
          const l = K0_NAGS[i % K0_NAGS.length];
          d.bark(l.who, this.text(l), { npc: this.speaker(l.who) });
        }
        while (!this.choice) {
          await d.sleep(N.toastEvery);
          if (!this.choice) hud.toast(this.obj("K0"), 4000);
        }
      })(),
    );
    await d.until(() => !!this.choice);
    open = false;
    // (a line under way finishes first)
    await d.until(() => !d.speaking);
    await this.commit(this.choice!);
    d.skipLines = true;
  }

  /** Between the two guides (each by his door), whichever way the player turns. */
  private choiceTarget() {
    const w = this.w;
    const at = new Vector3();
    return () => {
      const b = w.npcs.get("brun"), s = w.npcs.get("scribe");
      if (!b || !s) return null;
      return at.copyFrom(b.root.position).addInPlace(s.root.position).scaleInPlace(0.5).addInPlaceFromFloats(0, 1.6, 0);
    };
  }

  /** The player picks a side (the E prompt; tests: `debugChoose`). */
  private choose(f: Faction) {
    if (this.choice || this.step > 0) return;
    this.choice = f;
  }

  /** Tests and `?debug`: commit at the gate as if the E prompt on that guide had been used. */
  debugChoose(who: "brun" | "scribe" | Faction) {
    this.choose(who === "brun" || who === "rebel" ? "rebel" : "imperial");
  }

  /** The dragon's pass over the keep (§4.5), then laps of the town until the doors shut. */
  private async k0Dragon() {
    const { stage } = this.ctx;
    const w = this.w;
    const dragons = await this.d.wait(stage.ensureDragons());
    const dr = dragons.dragon;
    const pts = K0_PASS.map(([x, y, z]) => new Vector3(x, y, z));
    const g = w.heightAt(K0_CIRCUIT.center.x, K0_CIRCUIT.center.z);
    const then = () => {
      if (!this.doorsShut && this.alive) dragons.circuit(K0_CIRCUIT.center, K0_CIRCUIT.r, g + K0_CIRCUIT.above[0], g + K0_CIRCUIT.above[1], K0_CIRCUIT.roar);
    };
    // it comes in from behind the keep: put it at the start of the run unless the player is
    // watching it (then it joins the run where it dives over the keep)
    if (!this.seen(dr.root.position)) {
      dragons.place(pts[0]);
      void dragons.pass(pts.slice(1), 32, { then });
    } else void dragons.pass(pts.slice(2), 32, { then });
    cue("wings", dr.root.position, { volume: 1.2, ref: 40 });
  }

  /** A crenellation block breaks off the keep's front and lands beside the steps (§5.2 t 1.0). */
  private crenellation() {
    const { stage } = this.ctx;
    const deb = stage.debris;
    if (!deb) return;
    const top = this.w.heightAt(CRENELLATION.x, -662) + 14.6;
    const fall = Math.sqrt((2 * (top - CRENELLATION.y)) / 9.81);
    const from = new Vector3(CRENELLATION.x, top, -653.4);
    deb.spawn(
      [{ center: from, half: new Vector3(0.42, 0.28, 0.34), velocity: new Vector3(0, 0, (CRENELLATION.z - from.z) / fall), spin: new Vector3(rand(-2, 2), rand(-1, 1), rand(-2, 2)) }],
      { material: stage.town?.breach.meshes[0]?.material ?? undefined, mass: 80, name: "crenellation" },
    );
    this.detach(this.d.sleep(fall - 0.05).then(() => cue("rockfall", CRENELLATION, { ref: 12 })));
  }

  /** The guides run to their doors (§5.2 t 20): Brun to the postern, the scribe to the gate. */
  private toDoors() {
    if (this.atDoors) return;
    this.atDoors = true;
    const w = this.w;
    const brun = w.npcs.get("brun"), scribe = w.npcs.get("scribe");
    const g = (x: number, z: number) => this.ground(x, z);
    if (brun) {
      // round the south-west turret (x 45.4…48.6, z −654.6…−651.4)
      const path = [g(49.5, -649.4), g(44.2, -650.4), g(43.3, -654.0), g(POSTERN_WAIT.x, POSTERN_WAIT.z)].filter((p, i, a) => i === a.length - 1 || flat(p, brun.root.position) > 0.5);
      void walkPath(w, brun, path, { speed: 5.2, clip: "Sprint_Loop", ground: true }).then((arrived) => {
        if (!arrived) return;
        setYaw(brun, POSTERN_WAIT.yaw);
        this.playIf(brun, "Idle_Rail_Call");
      });
    }
    if (scribe) {
      void walkPath(w, scribe, [g(GATE_WAIT.x, GATE_WAIT.z)], { speed: 2.2, ground: true }).then((arrived) => {
        if (!arrived) return;
        faceTo(scribe, { x: GATE_WAIT.x, z: GATE_WAIT.z - 4 });
        this.playIf(scribe, "Interact");
      });
    }
  }

  /**
   * The forecourt's leash (§5.2): beyond 35 m of its centre fireballs land 6–10 m ahead of the player
   * and the nearer guide calls them back; beyond 60 m the smoke drives them back to the start.
   */
  private awayGuard() {
    const { stage } = this.ctx;
    const w = this.w;
    const pl = this.player;
    const back = line("K0-P1");
    let cool = 0;
    let busy = false;
    return w.onUpdate((dt) => {
      if (busy || !this.alive || this.doorsShut || !pl.enabled) return;
      cool -= dt;
      const p = pl.position;
      const dx = p.x - FORECOURT.x, dz = p.z - FORECOURT.z;
      const dist = Math.hypot(dx, dz);
      if (dist > KEEP_TIMING.away.back) {
        busy = true;
        void this.pushBack().finally(() => (busy = false));
        return;
      }
      if (dist <= KEEP_TIMING.away.warn || cool > 0) return;
      cool = 3.5;
      const k = rand(6, 10) / (dist || 1);
      const x = p.x + dx * k, z = p.z + dz * k;
      const from = new Vector3(x + rand(-30, 30), w.heightAt(x, z) + 90, z + rand(-30, 30));
      void stage.townFx?.fireball(from, x, z, 45, { linger: 6 });
      // the nearer guide calls out
      const b = w.npcs.get("brun"), s = w.npcs.get("scribe");
      const brunNearer = !!b && (!s || flat(b.root.position, p) <= flat(s.root.position, p));
      const who = brunNearer ? back.who : (back.alt ?? back.who);
      this.d.bark(who, this.text(back), { npc: brunNearer ? b : s, cooldown: 6 });
    });
  }

  /** Faded out and put back on the forecourt with a toast (§5.2, > 60 m). */
  private async pushBack() {
    await hud.fade(true, 0.6);
    if (!this.alive) return;
    const p = K0.player;
    this.player.teleport(new Vector3(p.x, this.w.heightAt(p.x, p.z) + 0.05, p.z), p.yaw);
    this.w.rig.yaw = p.yaw;
    this.w.rig.pitch = -0.05;
    hud.toast(KEEP_TOASTS.pushedBack, 3500);
    await hud.fade(false, 0.8);
  }

  /**
   * The choice is made (§5.2 commit): the flags take it, the commit lines play, and the guide not
   * chosen goes through his own door (the scribe the gate on the rebel route, Brun the postern on
   * the imperial one) and is gone once out of sight or after 10 s.
   */
  private async commit(f: Faction) {
    const { stage } = this.ctx;
    stage.state.set("faction", f);
    this.faction = f;
    this.committed = true;
    stage.snapshotFlags();
    this.inter?.remove("follow_brun");
    this.inter?.remove("follow_scribe");
    this.toDoors();
    this.beat = "K0c";
    const commit = lines("K0", f, { on: "commit" });
    if (f === "rebel") {
      await this.sayLine(commit[0]);
      await this.sayLine(commit[1]);
      this.detach(this.unchosenLeaves("scribe"));
      await this.sayLine(commit[2]);
    } else {
      await this.sayLine(commit[0]);
      this.detach(this.unchosenLeaves("brun"));
      await this.sayLine(commit[1]);
    }
  }

  /** The guide not chosen goes in through his own door and is removed out of sight (≤ 10 s). */
  private async unchosenLeaves(who: "brun" | "scribe") {
    const { stage } = this.ctx;
    const d = this.d;
    const w = this.w;
    const c = w.npcs.get(who);
    if (!c) return;
    const t0 = d.time;
    const gone = () => !w.npcs.has(who) || d.time - t0 > 10 || !this.seen(c.root.position.add(new Vector3(0, 1, 0)));
    const u = stage.underground;
    if (who === "scribe") {
      await d.wait(walkPath(w, c, [this.ground(60.4, -652.9)], { speed: 3.0, ground: true }));
      // through the gate only onto the loaded hall (a leaf opened a crack, then shut)
      const gate = stage.gate;
      if (u && gate && w.npcs.has(who)) {
        cue("lock", c.root.position);
        await d.wait(gate.l.swingTo(0.7, 0.8));
        await d.wait(walkPath(w, c, [this.gf(59.6, -654.4), this.gf(59.6, -657.2)], { speed: 2.6 }));
        void gate.l.swingTo(0, 0.8).then(() => cue("gateSlam", { x: 59, y: 39, z: -653.7 }, { volume: 0.7 }));
      }
    } else {
      await d.wait(walkPath(w, c, [this.ground(POSTERN_OUT.x - 0.6, POSTERN_OUT.z + 0.2)], { speed: 3.0, ground: true }));
      const postern = stage.postern;
      if (u && postern && w.npcs.has(who)) {
        this.playIf(c, "Push_Enter", { loop: false });
        await d.sleep(0.4);
        cue("door", c.root.position, { ref: 8 });
        await d.wait(postern.swingTo(0.6, 0.5));
        await d.wait(walkPath(w, c, [this.gf(48.6, -659.0), this.gf(50.2, -659.4)], { speed: 2.6 }));
        void postern.swingTo(0, 0.6).then(() => cue("door", POSTERN_OUT, { volume: 0.7 }));
      }
    }
    await d.until(gone);
    w.removeNpc(who);
  }

  // ------------------------------------------------------------------ K1 into the keep

  /**
   * K1 (§5.1): the player follows the guide to his door; the door opens only once the underground
   * is in (until then the loading hint and the guide's "门闩卡住了" at a stuck latch); inside the way
   * is shut behind them (the beam outside the postern, the bar on the gate), the town goes quiet,
   * and the imperial route meets the gate guard and learns the scribe's name. Ends at step 1 (bound,
   * on the bond marks' side of the room), saved before the bonds shot.
   */
  private async k1Enter() {
    const { stage } = this.ctx;
    const d = this.d;
    const w = this.w;
    const pl = this.player;
    const rebel = this.rebel;
    this.beat = "K1";
    const guide = this.guide();
    const door = rebel ? new Vector3(POSTERN_OUT.x, POSTERN_OUT.y + 1.3, POSTERN_OUT.z) : new Vector3(60, w.heightAt(60, -652.4) + 1.5, -652.4);
    objective.set(this.obj("K1", 0), () => door);
    const near = () => flat(pl.position, door) < 4.2;
    const call = line(rebel ? "K0-N1" : "K0-N2");
    const stopNag = nag(w, call.who, [this.text(call)], near, 10, () => flat(pl.position, door));
    try {
      await d.until(near);
    } finally {
      stopNag();
    }
    if (rebel) {
      // Brun at the postern's outside step, facing it
      if (guide) {
        await d.wait(walkPath(w, guide, [this.ground(POSTERN_OUT.x - 0.7, POSTERN_OUT.z)], { speed: 2.2, ground: true }));
        setYaw(guide, -Math.PI / 2);
      }
      await this.say("K1-R1");
    }
    const u = await this.latch();
    if (rebel) {
      // shouldered open
      if (guide) this.playIf(guide, "Push_Exit", { loop: false });
      await d.sleep(0.35);
      cue("door", POSTERN_OUT, { ref: 8 });
      if (stage.postern) await d.wait(stage.postern.open(0.7));
      await this.say("K1-R2");
      const bond = u.anchor("mark_bond_brun").pos;
      if (guide) void walkPath(w, guide, [new Vector3(47.4, this.gf(0, 0).y, -659.0), this.gf(49.2, -659.0), this.gf(bond.x, bond.z)], { speed: 2.4 }).then((ok) => ok && faceTo(guide, pl.position));
      const inside = this.gf(49.6, -659.0).addInPlaceFromFloats(0, 1.2, 0);
      objective.retarget(() => inside);
      // (in, and clear of the leaf's sweep)
      await d.until(() => u.roomAt(pl.position) === "G2" && flat(pl.position, { x: 48.14, z: -659.7 }) > 1.7);
      // the door shuts behind them, and a beam comes down outside it
      if (stage.postern) await d.wait(stage.postern.close(0.6));
      cue("door", POSTERN_OUT, { volume: 0.8 });
      await d.sleep(0.5);
      cue("beam", POSTERN_OUT, { ref: 10 });
      w.rig.shake(0.012, 0.6);
      u.setBlocker("blocker_postern", true);
      u.props.beam(true);
      this.shutOut();
      await this.say("K1-R3");
    } else {
      await this.say("K1-I1");
      cue("lock", { x: 60, y: 39, z: -653.6 });
      await d.sleep(0.3);
      cue("doorHeavy", { x: 60, y: 39.5, z: -653.6 }, { ref: 10 });
      if (stage.gate) await d.wait(stage.gate.open(1.4));
      await this.say("K1-I2");
      const bond = u.anchor("mark_bond_ivo").pos;
      if (guide) void walkPath(w, guide, [this.gf(60.4, -654.8), this.gf(bond.x, bond.z)], { speed: 2.4 }).then((ok) => ok && faceTo(guide, pl.position));
      const inside = this.gf(60, -656.4).addInPlaceFromFloats(0, 1.2, 0);
      objective.retarget(() => inside);
      // (in, and clear of the leaves' sweep: they reach z −655.7 open)
      await d.until(() => u.roomAt(pl.position) === "G1" && pl.position.z < -656.0);
      // the gate shuts and is barred
      if (stage.gate) await d.wait(stage.gate.close(1.2));
      cue("gateSlam", { x: 60, y: 39.5, z: -653.8 }, { ref: 10 });
      u.setBlocker("blocker_gate", true);
      u.props.gateBar(true);
      this.shutOut();
      // the gate guard comes out of the hall, and is sent on to the guard room
      const guard = w.npc("gateguard", CAST.gateguard);
      place3(w, guard, 63.8, -660.6, this.gf(0, 0).y, pl.position);
      void walkPath(w, guard, [this.gf(62.2, -658.4)], { speed: 2.4 }).then((ok) => ok && faceTo(guard, pl.position));
      objective.retarget(null);
      await this.say("K1-I3", { npc: guard });
      await this.say("K1-I4");
      await this.say("K1-I5", { npc: guard });
      this.detach(this.guardLeaves(guard));
      await this.say("K1-I6");
      await this.say("K1-I7");
    }
    // inside and bound: the checkpoint is made before the bonds shot (§5.2)
    await this.setStep(1);
  }

  /**
   * The doors open only on a loaded interior (§5.1 K1): until `ensureUnderground()` resolves, the
   * loading hint shows and the guide works the latch, saying "门闩卡住了" every few seconds.
   */
  private async latch(): Promise<Underground> {
    const { stage } = this.ctx;
    const d = this.d;
    if (stage.underground) return (this.u = stage.underground);
    const p = stage.ensureUnderground();
    let ready = false;
    p.then(
      () => (ready = true),
      () => (ready = true),
    );
    const guide = this.guide();
    const l = lines("K1", this.faction ?? "rebel", { on: "latch" })[0];
    this.beat = "K1latch";
    hud.loading(true);
    this.loading = true;
    if (guide) this.playIf(guide, "Push_Loop");
    this.detach(
      (async () => {
        while (!ready) {
          if (l) d.bark(l.who, this.text(l), { npc: guide, cooldown: 3.5 });
          await d.sleep(4);
        }
      })(),
    );
    try {
      this.u = await d.wait(p);
    } finally {
      hud.loading(false);
      this.loading = false;
    }
    if (guide) this.playIf(guide, "Idle_Loop");
    this.beat = "K1";
    return this.u;
  }

  /** The gate guard goes off to the guard room (the door opens and shuts behind him) and is removed. */
  private async guardLeaves(guard: Character) {
    const d = this.d;
    const w = this.w;
    const u = this.u!;
    await d.wait(walkPath(w, guard, [this.gf(57.6, -657.4), this.gf(55.0, -657.0)], { speed: 2.4 }));
    const door = u.doors.g2_door;
    cue("door", this.gf(DOOR.g2.x, DOOR.g2.z), { volume: 0.7 });
    if (door) await d.wait(door.open(0.7));
    await d.wait(walkPath(w, guard, [this.gf(53.0, -657.0), this.gf(51.2, -658.0)], { speed: 2.4 }));
    if (door) await d.wait(door.close(0.7));
    cue("door", this.gf(DOOR.g2.x, DOOR.g2.z), { volume: 0.6 });
    w.removeNpc("gateguard");
  }

  /** The doors are shut behind the player: the town goes quiet and the dragon is gone (§4.5, §10.5). */
  private shutOut() {
    this.doorsShut = true;
    this.quietOutside();
    audio.stopMusic(3);
    this.ctx.stage.dragons?.hide();
  }

  // ------------------------------------------------------------------ K1 the bonds shot

  /**
   * The bonds shot (§5.2, the only locked camera here, ≤ 8 s): a two-shot from the anchors' camera,
   * the guide works at the rope (Bandage_Loop ×3), the player stands tired; the cuffs come off with
   * the rope's snap, control comes back, and the guide's second line plays while the player moves.
   */
  private async k1Bonds() {
    const d = this.d;
    const w = this.w;
    const pl = this.player;
    const u = this.u ?? (this.u = await d.wait(this.ctx.stage.ensureUnderground()));
    const rebel = this.rebel;
    this.beat = "K1b";
    const guide = this.guide();
    const pA = u.anchor(rebel ? "mark_bond_player_reb" : "mark_bond_player_imp");
    const cA = u.anchor(rebel ? "mark_bond_brun" : "mark_bond_ivo");
    const cam = u.anchor(rebel ? "cam_bonds_reb" : "cam_bonds_imp");
    const dy = u.origin.y - 37.73;
    const la = cam.def.lookAt ?? [cA.pos.x, cA.def.world[1] + 1.1, cA.pos.z];
    const look = new Vector3(la[0], la[1] + dy, la[2]);
    // both on their marks, facing each other
    pl.enabled = false;
    const floor = u.floor(pA.pos.x, pA.pos.z, pA.pos.y) ?? pA.pos.y;
    pl.teleport(new Vector3(pA.pos.x, floor + 0.02, pA.pos.z), pA.yaw);
    if (guide) place3(w, guide, cA.pos.x, cA.pos.z, cA.pos.y, pA.pos);
    const pov = pl.holdThirdPerson(0);
    w.rig.cut(cam.pos, look);
    this.shot = () => {
      pov();
      pl.clearScripted();
      pl.enabled = true;
      w.rig.follow(pl);
    };
    void pl.playScripted("Idle_Tired_Loop", { loop: true, camera: false });
    if (guide) this.playIf(guide, "Bandage_Loop");
    const first = this.say(rebel ? "K1-R4" : "K1-I8");
    // three passes of the knife (Bandage_Loop is 0.667 s), then the rope gives
    await d.sleep(3 * 0.667 + 0.3);
    cue("rope", pl.position.add(new Vector3(0, 1, 0)));
    pl.bound = false;
    await first;
    if (guide) this.playIf(guide, "Idle_Loop");
    // control back, looking at the guide
    const end = this.shot;
    this.shot = null;
    end?.();
    w.rig.yaw = pA.yaw;
    w.rig.pitch = -0.05;
    objective.set(this.obj("K1", 1), null);
    await this.say(rebel ? "K1-R5" : "K1-I9");
  }

  // ------------------------------------------------------------------ K2 the gear

  /**
   * K2 (§5.1): the route's chest (the armour) and weapon stand (a sword or an axe; the imperial
   * stand's kite shield), Brun's father's axe, the armour going on behind a short dip, and the 45 s
   * fallback (the guide tosses a sword over and the armour goes on). Ends at step 2, the E1 retry point.
   */
  private async k2() {
    const { stage } = this.ctx;
    const d = this.d;
    const u = this.u!;
    const rebel = this.rebel;
    const f = this.faction ?? "rebel";
    this.beat = "K2";
    const g = routeGear(f);
    const chest = u.props.chest(g.chest);
    const rack = u.props.rack(g.rack);
    const at = (rebel ? chest?.use : rack?.use) ?? this.gf(rebel ? 49 : 65.5, rebel ? -655.5 : -656.8);
    const mark = at.add(new Vector3(0, 1.0, 0));
    objective.set(this.obj("K2"), () => mark);
    this.gearPrompts(chest, rack);
    const done = () => stage.flags.inv.weapon !== "none" && stage.flags.inv.armour > 0;
    const talk = (async () => {
      if (rebel) {
        await this.say("K2-R1");
        if (rack) await this.brunTakesAxe(rack);
        await this.say("K2-R3");
      } else {
        await this.say("K2-I1");
        await this.say("K2-I2");
      }
    })();
    this.detach(talk);
    const t0 = d.time;
    await d.until(() => done() || d.time - t0 >= 45);
    if (!done()) await this.gearFallback(chest, rack);
    // (the guide finishes what he was saying, and the armour's line)
    await d.until(() => !d.speaking && !this.dressing);
    await this.setStep(2);
  }

  /** The armour is going on (its dip and its line): K2 waits for it. */
  private dressing = false;

  /** The gear prompts: open the chest, put on the armour, take a weapon (one) and the shield. */
  private gearPrompts(chest: ChestProp | null, rack: RackProp | null) {
    const { stage } = this.ctx;
    const inter = this.interactables();
    const f = this.faction ?? "rebel";
    const g = routeGear(f);
    const pl = this.player;
    if (chest && stage.flags.inv.armour === 0) {
      const armour = () => {
        inter.add({
          id: "armour",
          pos: chest.use,
          label: KEEP_PROMPTS.armour,
          use: () => this.wearArmour(chest),
        });
      };
      if (chest.opened || stage.flags.looted.includes(lootId(g.chest))) {
        chest.set(true);
        chest.content ??= this.u!.props.armour();
        armour();
      } else
        inter.add({
          id: "chest",
          pos: chest.use,
          label: KEEP_PROMPTS.chest,
          use: async () => {
            if (pl.body.hasClip("Chest_Open")) void pl.playScripted("Chest_Open");
            cue("chest", chest.root.position);
            stage.state.update("looted", (l) => void (l.includes(lootId(g.chest)) || l.push(lootId(g.chest))));
            await this.d.wait(chest.open(0.9));
            chest.content = this.u!.props.armour();
            armour();
          },
        });
    }
    if (rack) {
      const open = rack.slots.filter((s) => s.id !== "father_axe" && !s.taken && (s.kind === "shield" ? !stage.flags.inv.shield : stage.flags.inv.weapon === "none"));
      const at = this.rackPrompts(rack, open);
      for (const s of open)
        inter.add({
          id: `rack_${s.id}`,
          pos: at.get(s) ?? s.pos,
          label: s.kind === "sword" ? KEEP_PROMPTS.sword : s.kind === "axe" ? KEEP_PROMPTS.axe : KEEP_PROMPTS.shield,
          use: () => this.takeFromRack(rack, s),
        });
    }
  }

  /**
   * Where each slot's prompt sits: the stand's weapons stand a hand's width apart, so their prompts
   * are spread along its front (in the slots' order, 0.9 m end to end) for the player to pick one by
   * looking at it.
   */
  private rackPrompts(rack: RackProp, slots: readonly RackSlot[]) {
    const out = new Map<RackSlot, Vector3>();
    const r = rack.root.position;
    const yaw = rack.root.rotation.y;
    const fwd = new Vector3(-Math.sin(yaw), 0, -Math.cos(yaw));
    const side = new Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
    const sorted = [...slots].sort((a, b) => Vector3.Dot(a.pos.subtract(r), side) - Vector3.Dot(b.pos.subtract(r), side));
    const n = sorted.length;
    sorted.forEach((s, i) => {
      const off = n === 1 ? 0 : -0.45 + (0.9 * i) / (n - 1);
      out.set(s, r.add(fwd.scale(0.5)).addInPlace(side.scale(off)));
    });
    return out;
  }

  /** Take one thing off the route's stand: a weapon (the other weapons' prompts go) or the shield. */
  private takeFromRack(rack: RackProp, s: RackSlot) {
    const { stage } = this.ctx;
    const g = routeGear(this.faction ?? "rebel");
    rack.take(s.id);
    stage.state.update("looted", (l) => void (l.includes(lootId(g.rack, s.id)) || l.push(lootId(g.rack, s.id))));
    stage.state.update("inv", (inv) => {
      if (s.kind === "shield") inv.shield = true;
      else inv.weapon = s.kind;
    });
    if (s.kind !== "shield") for (const o of rack.slots) if (o.kind !== "shield") this.inter?.remove(`rack_${o.id}`);
    cue("pickup", s.pos);
    void stage.ensureGear().sync(stage.flags.inv);
    if (s.kind !== "shield") hud.tip(KEEP_TIPS.ready.id, KEEP_TIPS.ready.text);
  }

  /** The armour goes on (a short black dip while the body is rebuilt), then the guide's line. */
  private async wearArmour(chest: ChestProp) {
    const { stage } = this.ctx;
    const g = routeGear(this.faction ?? "rebel");
    this.dressing = true;
    try {
      chest.take();
      cue("pickup", chest.root.position);
      stage.state.update("inv", (inv) => void (inv.armour = g.armour));
      await this.d.wait(stage.ensureGear().sync(stage.flags.inv));
      const l = lines("K2", this.faction ?? "rebel", { on: "armour" })[0];
      if (l) await this.sayLine(l);
    } finally {
      this.dressing = false;
    }
  }

  /** Brun takes his father's axe off the rebel stand (K2-R2); it is his weapon from here. */
  private async brunTakesAxe(rack: RackProp) {
    const { stage } = this.ctx;
    const d = this.d;
    const w = this.w;
    const brun = this.guide();
    if (!brun) return;
    const id = lootId(routeGear("rebel").rack, "father_axe");
    if (rack.has("father_axe")) {
      const front = rack.use;
      await d.wait(walkPath(w, brun, [new Vector3(front.x + 0.25, this.gf(0, 0).y, front.z + 0.3)], { speed: 1.8 }));
      faceTo(brun, rack.root.position);
      this.playIf(brun, brun.hasClip("PickUp_Table") ? "PickUp_Table" : "Interact", { loop: false });
      await d.sleep(0.45);
      rack.take("father_axe");
      cue("pickup", rack.root.position, { volume: 0.7 });
    }
    stage.state.update("looted", (l) => void (l.includes(id) || l.push(id)));
    this.kit ??= await d.wait(armNpc(w, brun, { main: "axe" }, { drawn: false }));
    this.playIf(brun, "Idle_Loop");
    faceTo(brun, this.player.position);
    await this.say("K2-R2");
  }

  /** 45 s without the gear (§12): the guide tosses a sword over (it is equipped) and the armour goes on. */
  private async gearFallback(chest: ChestProp | null, rack: RackProp | null) {
    const { stage } = this.ctx;
    const f = this.faction ?? "rebel";
    const g = routeGear(f);
    const guide = this.guide();
    this.beat = "K2fallback";
    const l = line("K2-F");
    if (guide) this.playIf(guide, "Interact", { loop: false });
    await this.sayLine(l, { who: f === "rebel" ? l.who : (l.alt ?? l.who) });
    const inv = stage.flags.inv;
    if (inv.weapon === "none") {
      const s = rack?.slots.find((x) => x.kind === "sword" && x.id !== "father_axe" && !x.taken);
      if (rack && s) {
        rack.take(s.id);
        stage.state.update("looted", (l) => void (l.includes(lootId(g.rack, s.id)) || l.push(lootId(g.rack, s.id))));
      }
      stage.state.update("inv", (v) => void (v.weapon = "sword"));
      for (const o of rack?.slots ?? []) if (o.kind !== "shield") this.inter?.remove(`rack_${o.id}`);
      hud.tip(KEEP_TIPS.ready.id, KEEP_TIPS.ready.text);
    }
    if (stage.flags.inv.armour === 0) {
      this.inter?.remove("chest");
      this.inter?.remove("armour");
      if (chest) {
        chest.set(true);
        chest.take();
      }
      stage.state.update("looted", (l) => void (l.includes(lootId(g.chest)) || l.push(lootId(g.chest))));
      stage.state.update("inv", (v) => void (v.armour = g.armour));
    }
    cue("pickup", this.player.position);
    await this.d.wait(stage.ensureGear().sync(stage.flags.inv));
    this.beat = "K2";
  }

  // ------------------------------------------------------------------ K3 the first fight

  /**
   * K3, E1 (§5.4): the rebel route hears the barracks stir and two imperials come out of it; the
   * imperial route hears the gate guard die in the guard room and two Frostsworn come through its
   * door. The guide fights beside the player; the tutorial opening, retries on death and the
   * adaptive difficulty are the encounter's (keep/e1.ts). The after lines close it.
   */
  private async k3() {
    const { stage } = this.ctx;
    const d = this.d;
    const u = this.u!;
    const rebel = this.rebel;
    this.beat = "K3";
    const ai = await d.wait(stage.ensureAI());
    const comp = await this.ensureCompanion();
    const combat = await d.wait(stage.ensureCombat());
    const e1 = (this.e1 = new KeepE1({ world: this.w, u, ai, combat, companion: comp, faction: this.faction ?? "rebel", scope: d, door: rebel ? null : u.doors.g2_door }));
    const label = (a: { combatant: { spec: { label?: string } } } | null) => a?.combatant.spec.label;
    if (rebel) {
      await d.sleep(1.0);
      // a shout from the barracks; 1.5 s later the two come out of its doorway
      const r0 = this.say("K3-R0", { npc: null });
      await d.sleep(1.5);
      void e1.start();
      await r0;
      // Brun takes the door frame on the hall side
      comp.brain.hold({ x: 55.2, y: this.gf(0, 0).y, z: -656.3, yaw: Math.PI / 2 });
      await this.say("K3-R1", { npc: comp.body });
      comp.brain.hold(null);
    } else {
      // (the armour's line has played; the scream comes a few seconds after it)
      await d.sleep(3.0);
      await this.say("K3-I0", { npc: null });
      void e1.start();
      await this.say("K3-I1", { npc: comp.body });
    }
    objective.set(this.obj("K3"), this.enemyTarget(e1));
    // their battle cries as they come in (the fight does not wait for them)
    this.detach(
      (async () => {
        await d.until(() => e1.engaged || e1.encounter.state === "cleared");
        if (e1.encounter.state === "cleared") return;
        const [a, b] = rebel ? (["K3-R2", "K3-R3"] as const) : (["K3-I2", "K3-I3"] as const);
        await this.say(a, { npc: e1.leader?.body ?? null, who: label(e1.leader) });
        await this.say(b, { npc: e1.tutor?.body ?? null, who: label(e1.tutor) });
      })(),
    );
    // the route's lesson, if the fight has not taught it by itself
    this.detach(d.sleep(14).then(() => e1.encounter.state === "active" && e1.lesson()));
    await d.wait(e1.cleared);
    objective.retarget(null);
    await d.sleep(1.2);
    await d.until(() => !d.speaking);
    for (const l of lines("K3", this.faction ?? "rebel", { on: "after" })) {
      // (Ivo bars the guard-room door with his last line: k4Body)
      if (l.id === "K3-I6") continue;
      await this.sayLine(l, { npc: comp.body });
    }
  }

  /** E1's nearest enemy still standing (the compass marker), null once there is none. */
  private enemyTarget(e1: KeepE1) {
    const out = new Vector3();
    return () => {
      const p = this.player.position;
      let best: { x: number; y: number; z: number } | null = null;
      let bd = Infinity;
      for (const a of e1.encounter.actors) {
        if (a.disposed || a.combatant.defeated) continue;
        const q = a.agent.position;
        const dd = flat(q, p);
        if (dd < bd) {
          bd = dd;
          best = q;
        }
      }
      return best ? out.set(best.x, best.y + 1.4, best.z) : null;
    };
  }

  // ------------------------------------------------------------------ K4 the key ring, the storeroom

  /**
   * K4 (§5.1): search the leader's body (the key ring and a potion); after 30 s the guide opens the
   * storeroom himself (Brun kicks it in, Ivo finds a spare key). On the imperial route Ivo first
   * shuts the guard-room door behind them (K3-I6). Ends at step 3.
   */
  private async k4Body() {
    const { stage } = this.ctx;
    const d = this.d;
    const rebel = this.rebel;
    this.beat = "K4";
    this.footlockerPrompt();
    if (!rebel) this.detach(this.ivoBarsDoor());
    const lead = this.e1?.leader ?? null;
    let searched = false;
    const corpse = new Vector3();
    const where = () => {
      const pelvis = lead?.body?.bone("pelvis");
      if (pelvis && !pelvis.isDisposed()) return corpse.copyFrom(pelvis.getAbsolutePosition());
      const a = lead?.agent.position;
      return a ? corpse.set(a.x, a.y + 0.2, a.z) : corpse.copyFrom(this.gf(60, -660));
    };
    const loot = () => {
      if (searched) return;
      searched = true;
      stage.state.update("inv", (inv) => {
        inv.keyring = true;
        inv.potions += 1;
      });
      stage.state.update("looted", (l) => void (l.includes(lootId("keep_e1_lead")) || l.push(lootId("keep_e1_lead"))));
      cue("pickup", where());
    };
    if (lead && !lead.disposed) {
      const mark = new Vector3();
      objective.set(this.obj("K4", 0), () => mark.copyFrom(where()).addInPlaceFromFloats(0, 0.6, 0));
      this.interactables().add({ id: "search_leader", pos: where, label: KEEP_PROMPTS.search, height: 2.4, use: loot });
    } else loot();
    const t0 = d.time;
    await d.until(() => searched || d.time - t0 >= 30);
    // the body out of reach (a ragdoll in a corner): the guide opens the storeroom his own way
    if (!searched) await this.storeFallback();
    await this.setStep(3);
  }

  /** Ivo shuts the guard-room door after the fight ("卫兵房的门我顶上了", K3-I6; §11 step 3). */
  private async ivoBarsDoor() {
    const d = this.d;
    const w = this.w;
    const u = this.u!;
    const comp = this.companion;
    const door = u.doors.g2_door;
    const body = comp?.body;
    if (!comp || !body || !door) return;
    comp.brain.suspend();
    try {
      await d.wait(walkPath(w, body, [this.gf(55.0, -657.0)], { speed: 2.2 }));
      faceTo(body, DOOR.g2);
      this.playIf(body, "Push_Exit", { loop: false });
      await d.sleep(0.3);
      await d.wait(door.close(0.6));
      cue("doorHeavy", this.gf(DOOR.g2.x, DOOR.g2.z), { volume: 0.8 });
      this.playIf(body, "Idle_Loop");
      await this.say("K3-I6", { npc: body });
    } finally {
      if (!comp.disposed) comp.brain.resume();
    }
  }

  /** The guide opens the storeroom without the key ring (§12 K4 fallback; K4-RF / K4-IF). */
  private async storeFallback() {
    const d = this.d;
    const w = this.w;
    const u = this.u!;
    const door = u.doors.store_door;
    const comp = this.companion;
    const body = comp?.body ?? this.guide();
    const rebel = this.rebel;
    this.beat = "K4fallback";
    if (comp) comp.brain.suspend();
    try {
      if (body) {
        await d.wait(walkPath(w, body, [this.gf(64.6, -658.3)], { speed: 2.6 }));
        faceTo(body, DOOR.store);
      }
      const l = lines("K4", this.faction ?? "rebel", { on: "fallback" })[0];
      if (l) await this.sayLine(l, { npc: body ?? null });
      if (body) this.playIf(body, rebel ? "Kick" : "Interact", { loop: false });
      await d.sleep(rebel ? 0.45 : 0.8);
      if (door) {
        door.locked = false;
        cue(rebel ? "doorHeavy" : "lock", this.gf(DOOR.store.x, DOOR.store.z), { ref: 8 });
        await d.wait(door.open(rebel ? 0.35 : 1.1));
      }
      if (body) this.playIf(body, "Idle_Loop");
    } finally {
      if (comp && !comp.disposed) comp.brain.resume();
      this.beat = "K4";
    }
  }

  /** The barracks footlocker (optional, §5.1 K4): the letter, and the guide's line about it. */
  private footlockerPrompt() {
    const { stage } = this.ctx;
    const u = this.u!;
    const box = u.props.chest("use_footlocker");
    if (!box || stage.flags.inv.letter || stage.flags.looted.includes(lootId("use_footlocker"))) return;
    this.interactables().add({
      id: "footlocker",
      pos: box.use,
      label: KEEP_PROMPTS.chest,
      use: async () => {
        const pl = this.player;
        if (pl.body.hasClip("Chest_Open")) void pl.playScripted("Chest_Open");
        cue("chest", box.root.position);
        await this.d.wait(box.open(0.9));
        stage.state.update("inv", (inv) => void (inv.letter = true));
        stage.state.update("looted", (l) => void (l.includes(lootId("use_footlocker")) || l.push(lootId("use_footlocker"))));
        cue("pickup", box.root.position, { volume: 0.6 });
        const l = lines("K4", this.faction ?? "rebel", { on: "footlocker" })[0];
        if (l) {
          await this.d.until(() => !this.d.speaking);
          await this.sayLine(l, { npc: this.companion?.body ?? this.guide() });
        }
      },
    });
  }

  /**
   * K4 from step 3: the key ring opens the storeroom as the player comes to its door (or it stands
   * open already); the potions on its shelf (and the potion tip); the guide's lines. "下到地牢" then
   * points down the stairs (K5).
   */
  private async k4Store() {
    const { stage } = this.ctx;
    const d = this.d;
    const u = this.u!;
    const pl = this.player;
    const rebel = this.rebel;
    this.beat = "K4s";
    this.footlockerPrompt();
    await this.ensureCompanion();
    const door = u.doors.store_door;
    objective.set(this.obj("K4", 1), this.doorMark(DOOR.store));
    if (door && !door.isOpen) {
      await d.until(() => door.isOpen || (stage.flags.inv.keyring && flat(pl.position, DOOR.store) < 1.9 && Math.abs(pl.position.y - this.gf(0, 0).y) < 1.2));
      if (!door.isOpen) {
        cue("lock", this.gf(DOOR.store.x, DOOR.store.z), { ref: 6 });
        door.locked = false;
        await d.sleep(0.25);
        void door.open(1.1);
      }
    }
    // the potions on the shelf
    const shelf = u.props.shelf;
    let took = false;
    const said = { enter: false, after: false };
    const after = async () => {
      if (said.after) return;
      said.after = true;
      await d.until(() => !d.speaking);
      await this.say(rebel ? "K4-R2" : "K4-I2", { npc: this.companion?.body ?? this.guide() });
    };
    if (shelf && shelf.left > 0) {
      this.interactables().add({
        id: "shelf",
        pos: shelf.use,
        label: KEEP_PROMPTS.search,
        use: () => {
          const n = shelf.take();
          took = true;
          stage.state.update("inv", (inv) => void (inv.potions += n));
          stage.state.update("looted", (l) => void (l.includes(lootId("use_store_potions")) || l.push(lootId("use_store_potions"))));
          cue("pickup", shelf.root.position);
          hud.tip(KEEP_TIPS.potion.id, KEEP_TIPS.potion.text);
          this.detach(after());
        },
      });
    }
    // the guide's word on the potions once the player is in the storeroom
    this.detach(
      (async () => {
        await d.until(() => u.roomAt(pl.position) === "G4");
        if (!took) {
          said.enter = true;
          await d.until(() => !d.speaking);
          await this.say(rebel ? "K4-R1" : "K4-I1", { npc: this.companion?.body ?? this.guide() });
        }
      })(),
    );
    objective.set(this.obj("K4", 2), this.stairsTarget());
    // (the line about what lies below plays at the stair door if the shelf was passed by)
    this.detach(
      (async () => {
        await d.until(() => flat(pl.position, DOOR.stair) < 2.2);
        if (!took) await after();
      })(),
    );
  }

  /** "下到地牢": the stair door, then the mid landing, then the stair foot (whichever is next). */
  private stairsTarget() {
    const u = this.u!;
    const pl = this.player;
    const door = this.gf(DOOR.stair.x, DOOR.stair.z).addInPlaceFromFloats(0, 1.2, 0);
    const mid = u.anchor("mark_tremor").pos.add(new Vector3(0, 1.2, 0));
    const foot = u.anchor("cp_k4").pos.add(new Vector3(0, 1.2, 0));
    return () => {
      const room = u.roomAt(pl.position);
      if (room === "G5" || room === "B1") return pl.position.y > mid.y - 0.6 && room === "G5" && pl.position.x > 69 ? mid : foot;
      if (room === "G5t") return mid;
      return door;
    };
  }

  // ------------------------------------------------------------------ K5 the stairs

  /**
   * K5 (§5.1): the stair door opens as the player comes to it; on the mid landing the keep shakes
   * (the dragon has come down on its roof) and the guide says so; the stair foot is step 4.
   */
  private async k5() {
    const d = this.d;
    const w = this.w;
    const u = this.u!;
    const pl = this.player;
    const rebel = this.rebel;
    this.beat = "K5";
    const door = u.doors.stair_door;
    if (door && !door.isOpen) {
      await d.until(() => door.isOpen || (flat(pl.position, DOOR.stair) < 2.0 && pl.position.y > this.gf(0, 0).y - 0.6));
      if (!door.isOpen) {
        cue("door", this.gf(DOOR.stair.x, DOOR.stair.z), { ref: 6 });
        void door.open(1.0);
      }
    }
    const mid = u.anchor("mark_tremor").pos;
    const foot = u.anchor("cp_k4").pos;
    await d.until(() => (flat(pl.position, mid) < 1.9 && Math.abs(pl.position.y - mid.y) < 1.3) || pl.position.y < mid.y - 0.8);
    // the tremor: the dragon on the roof
    cue("rumble", pl.position, { ref: 10 });
    w.rig.shake(0.02, 1.5);
    this.detach(this.say(rebel ? "K5-R1" : "K5-I1", { npc: this.companion?.body ?? this.guide() }));
    await d.until(() => u.roomAt(pl.position) === "B1" || (flat(pl.position, foot) < 1.6 && Math.abs(pl.position.y - foot.y) < 1.0));
    // the bodies upstairs are out of sight now
    this.e1?.dispose();
    this.e1 = null;
    await this.setStep(FIRST_HALF_END);
    await d.until(() => !d.speaking);
  }

  // ------------------------------------------------------------------ helpers

  /** The guide's body (Brun, or the scribe), or null. */
  private guide(): Character | null {
    return this.w.npcs.get(companionOf(this.faction ?? "rebel")) ?? null;
  }

  /**
   * The guide as a fighter and follower (design §3.6): armed (Brun's father's axe, Ivo's sword and
   * kite shield, drawn), on a capsule where its body stands, following the player's breadcrumbs.
   */
  private async ensureCompanion(): Promise<CompanionActor> {
    const { stage } = this.ctx;
    const d = this.d;
    if (this.companion && !this.companion.disposed) return this.companion;
    const ai = await d.wait(stage.ensureAI());
    const who = companionOf(this.faction ?? "rebel");
    const body = this.w.npcs.get(who) ?? this.w.npc(who, CAST[who]);
    stopWalk(body);
    if (this.kit) this.kit.setArmed(true);
    else this.kit = await d.wait(armNpc(this.w, body, who === "brun" ? { main: "axe" } : { main: "sword", off: "shield" }, { drawn: true }));
    const p = body.root.position;
    const q = body.root.rotationQuaternion;
    // (characters face +Z: the game's yaw is the body's turn less π)
    const yaw = q ? 2 * Math.atan2(q.y, q.w) - Math.PI : 0;
    this.companion = ai.companion({ who, body, at: { x: p.x, y: p.y + 0.05, z: p.z, yaw }, label: who === "brun" ? KEEP_BARKS.brun.who : KEEP_BARKS.ivo.who });
    return this.companion;
  }

  /** The chapter's interactables (made on first use, disposed with the chapter). */
  private interactables() {
    this.inter ??= this.ctx.stage.createInteractables();
    return this.inter;
  }

  /** The step changes: a checkpoint (the flags snapshotted, an autosave). */
  private async setStep(n: number) {
    this.step = n;
    try {
      await this.ctx.stage.checkpoint();
    } catch (e) {
      console.warn("keep: checkpoint", e);
    }
  }

  /** A line's text with the player's name filled in. */
  private text(l: ScriptLine) {
    return fill(l.text, { name: this.ctx.stage.appearance?.name });
  }

  /** Who speaks under a label (the guides, the gate guard), or null (off-screen, or not here). */
  private speaker(who: string): Character | null {
    const w = this.w;
    if (who === KEEP_BARKS.brun.who) return w.npcs.get("brun") ?? null;
    if (who === KEEP_BARKS.ivo.who || who === line("K0-02").who) return w.npcs.get("scribe") ?? null;
    if (who === line("K1-I3").who) return w.npcs.get("gateguard") ?? null;
    return null;
  }

  /** A scripted line by id (see `sayLine`). */
  private say(id: KeepLineId, o: { npc?: Character | null; who?: string } = {}) {
    return this.sayLine(line(id), o);
  }

  /** A scripted line: the speaker (by label unless given) turns to the player while it plays. */
  private async sayLine(l: ScriptLine, o: { npc?: Character | null; who?: string } = {}) {
    if (!l) return;
    const who = o.who ?? l.who;
    const npc = o.npc !== undefined ? o.npc : this.speaker(who);
    const eye = this.eyeTmp;
    await this.d.say(who, this.text(l), { npc, look: npc ? () => this.player.eye(eye) : null, duration: l.dur, gap: l.gap });
  }

  /** Play a clip when the body has it (combat clips arrive with the keep's segment). */
  private playIf(c: Character, clip: string, o: { loop?: boolean; blend?: number } = {}) {
    if (!c.hasClip(clip)) return false;
    c.play(clip, { loop: o.loop ?? true, blend: o.blend ?? 0.3 });
    return true;
  }

  /** Run a script branch under the chapter's scope (a skip ends it quietly). */
  private detach(p: Promise<unknown>) {
    void p.catch((e) => {
      if (!(e instanceof Cancelled)) console.error("keep", e);
    });
  }

  private frustum: { frame: number; planes: ReturnType<typeof Frustum.GetPlanes> } | null = null;

  /** Whether the camera sees a point (within 400 m). */
  private seen(p: Vector3) {
    const cam = this.w.rig.camera;
    const frame = cam.getScene().getFrameId();
    let f = this.frustum;
    if (!f || f.frame !== frame) f = this.frustum = { frame, planes: Frustum.GetPlanes(cam.getTransformationMatrix()) };
    return Vector3.Distance(cam.globalPosition, p) < 400 && Frustum.IsPointInFrustum(p, f.planes);
  }

  /** A lit torch in the guide's hand (it goes with the guide, into the next chapter too). */
  private torchFor(u: Underground, ch: Character) {
    this.torch?.dispose();
    this.torch = u.giveTorch(ch);
    if (ch.hasClip("Idle_Torch_Loop")) ch.play("Idle_Torch_Loop", { blend: 0.3 });
  }

  /** The town's beds the dragon chapter left running (the wind outlasts it, §10.5) fade out. */
  private quietOutside() {
    audio.stopBed("wind", 3);
    audio.stopBed("panic", 3);
  }

  save() {
    return { step: this.step };
  }

  /** The choice at the gate is the player's to make: no skipping past it (§0 #2). */
  canSkip() {
    return this.step > 0 || this.committed;
  }

  /** The chapter's own fighters, prompts and holds go (a skip, the chapter's end). */
  private release() {
    for (const off of this.offs) off();
    this.offs = [];
    this.e1?.dispose();
    this.e1 = null;
    this.companion?.dispose();
    this.companion = null;
    this.inter?.dispose();
    this.inter = null;
    if (this.loading) hud.loading(false);
    this.loading = false;
    const shot = this.shot;
    this.shot = null;
    shot?.();
    this.w.removeNpc("gateguard");
    this.d.skipLines = true;
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
    this.release();
    stage.dragons?.hide();
    if (!stage.flags.faction) stage.state.set("faction", this.choice ?? this.facing() ?? "rebel");
    const faction = stage.flags.faction ?? "rebel";
    this.faction = faction;
    const looted = stage.flags.looted;
    stage.state.update("inv", (inv) => void fillLoadout(inv, looted, faction, KEEP_STEPS));
    stage.state.update("outcomes", (o) => {
      o.torture ??= faction === "rebel" ? "killed" : "bluff";
    });
    w.removeNpc(companionOf(faction) === "brun" ? "scribe" : "brun");
    if (this.player) {
      this.player.bound = false;
      this.player.enabled = true;
      this.player.canMove = true;
      this.player.clearScripted();
      w.rig.follow(this.player);
    }
    // the filled kit on the body (a skip from the gate, where nobody has handed the player gear yet,
    // makes it: the next chapter starts from a body that matches the flags)
    if (stage.player) void stage.ensureGear().sync(stage.flags.inv, { dip: 0 }).catch((e) => console.warn("keep: gear", e));
    const u = this.u ?? stage.underground;
    if (!u) {
      // the interior never came in: leave the player before the gate
      const p = K0.player;
      this.player?.teleport(new Vector3(p.x, w.heightAt(p.x, p.z) + 0.05, p.z), p.yaw);
      return;
    }
    this.step = KEEP_STEPS;
    this.setWorld(u, faction, KEEP_STEPS);
    // the doors shut behind, both ways in barred; the lever pulled, the bridge down in the river
    u.doors.torture_door?.set(0);
    u.doors.g2_door?.set(0);
    u.setBlocker("blocker_postern", true);
    u.setBlocker("blocker_gate", true);
    u.props.bridge?.set("broken");
    // the town's beds stop; the cave's come with its zone (u.check below); the walk-on music (§10.5 X0)
    this.quietOutside();
    if (assets.has("audio/music_explore")) void audio.playMusic("audio/music_explore", { fade: 3 }).catch(() => {});
    else audio.stopMusic(3);
    const c = w.npcs.get(companionOf(faction));
    if (c) stopWalk(c);
    let at: Vector3, yaw: number, cAt: Vector3 | null;
    if (u.cave) {
      // the gallery's far bank (gal_s_cp), the guide beside the player (comp_s)
      const s = u.caveAnchor("gal_s_cp");
      at = s.pos;
      yaw = 0.2;
      cAt = u.caveAnchor("comp_s").pos;
      w.env.setInterior("cave", 0.5);
    } else {
      // no gallery in this build: the furthest the keep goes, by the drain in the guard room J
      const a = u.anchor("cp_k6");
      at = a.pos;
      yaw = a.yaw;
      const o = a.def.companion;
      cAt = o ? new Vector3(o[0], at.y, o[2]) : null;
    }
    this.player?.teleport(new Vector3(at.x, at.y + 0.02, at.z), yaw);
    w.rig.yaw = yaw;
    if (c) {
      if (cAt) place3(w, c, cAt.x, cAt.z, cAt.y, at);
      this.torchFor(u, c);
    }
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

  /**
   * Ends what is the chapter's own: its fighters (the E1 enemies, the guide's capsule and kit), its
   * prompts and holds. The underground, the dragon and the fires stay with the stage; the guide's
   * body stays in the world.
   */
  dispose() {
    this.alive = false;
    this.release();
    this.kit?.dispose();
    this.kit = null;
    void this.started;
  }
}
