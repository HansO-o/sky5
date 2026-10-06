import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial";
import { CreateBox } from "@babylonjs/core/Meshes/Builders/boxBuilder";
import { CreateGround } from "@babylonjs/core/Meshes/Builders/groundBuilder";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import type { Scene } from "@babylonjs/core/scene";
import { assets } from "../core/assets/AssetClient";
import type { SegmentId } from "../core/assets/manifest";
import type { Quality } from "../core/settings";
import type { Game, Stage } from "../game/Game";
import { TimeScale } from "../engine/core/timeScale";
import type { Encounter } from "../engine/combat/Encounter";
import { Physics } from "../engine/physics/Physics";
import { WorldState } from "../engine/state/WorldState";
import { hud } from "../ui/hud";
import { defaultAppearance } from "../world/appearance";
import { OUTFITS } from "../world/characters";
import { PrologueAI, type AiActor, type CompanionActor } from "../prologue/ai";
import { PrologueCombat } from "../prologue/combat";
import { CombatHud } from "../prologue/combatHud";
import { SPIDER } from "../prologue/creatures";
import { DEFAULT_FLAGS, normalizeFlags, type PrologueFlags } from "../prologue/flags";
import { armNpc, PlayerGear } from "../prologue/gear";
import { PlayerController } from "../prologue/player";
import { createPlayerBody } from "../prologue/playerBody";
import { World } from "../prologue/World";

/** Arena layout (m): a walled square floor, two pillars to hide behind, where everyone starts. */
const ARENA = {
  half: 18,
  wall: { height: 1.2, thickness: 0.5 },
  pillars: [
    { x: -5, z: -2 },
    { x: 5, z: -2 },
  ],
  player: { x: 0, y: 0.05, z: 8, yaw: 0 },
  companion: { x: 2, y: 0.05, z: 10, yaw: 0 },
  /** the two soldiers stand with their backs to the player (sneak up on them, or walk in and fight) */
  enemies: [
    { id: "s1", archetype: "soldier", at: { x: -3, y: 0.05, z: -10, yaw: 0 } },
    { id: "s2", archetype: "shieldSoldier", at: { x: 3, y: 0.05, z: -10, yaw: 0 } },
  ],
  spider: { x: 0, y: 0.05, z: -14, yaw: 0 },
  /** seconds between a cleared round and the next */
  between: 4,
} as const;

/**
 * `?debug&arena`: the combat and AI sandbox (keep/exit design §14 P1.7 and P2's "arena e2e";
 * engine-framework §7's demo at v2): a flat walled floor, the player with a sword in rebel leather,
 * two imperial soldiers unaware at their posts (sneak up for a backstab, or walk in and fight), a
 * small cave spider when the build ships one, and Brun as the companion. The fight is an
 * encounter: dying retries it (adaptive difficulty after 2 deaths); clearing it starts the next
 * round. Nothing is saved.
 *
 * Headless hooks (`window.__game.stage`): `player`, `world`, `combat`, `ai`, `companion`,
 * `encounter`, `round`, `chapter` ({ id: "arena", step: round }), `flags`; `engage()` sets every
 * enemy on the player, `killAll()`, `restart()` starts a fresh round.
 */
export class ArenaStage implements Stage {
  readonly world: World;
  segment: SegmentId = "keep";
  gameplay = true;
  readonly canSave = false;
  readonly state = new WorldState<PrologueFlags>(DEFAULT_FLAGS, { normalize: (raw) => normalizeFlags(raw) });
  readonly time = new TimeScale();
  physics: Physics | null = null;
  player: PlayerController | null = null;
  gear: PlayerGear | null = null;
  combat: PrologueCombat | null = null;
  combatHud: CombatHud | null = null;
  ai: PrologueAI | null = null;
  companion: CompanionActor | null = null;
  encounter: Encounter<AiActor> | null = null;
  round = 0;
  private paused = false;
  private disposed = false;
  private next: (() => unknown) | null = null;

  constructor(game: Game) {
    this.world = new World(game.engine);
  }

  get scene() {
    return this.world.scene;
  }

  get flags(): PrologueFlags {
    return this.state.flags;
  }

  /** What headless tests read as `stage.chapter`. */
  get chapter() {
    return { id: "arena", label: "竞技场", step: this.round };
  }

  get timeScale() {
    return this.time.value;
  }

  snapshotFlags() {
    this.state.checkpoint();
  }

  restoreFlags() {
    return this.state.rollback();
  }

  async init() {
    const w = this.world;
    await w.initBare();
    const ph = await Physics.create();
    if (this.disposed) {
      ph.dispose();
      throw new Error("arena disposed while loading");
    }
    this.physics = ph;
    w.physics = ph;
    this.buildFloor(ph);
    this.state.update("inv", (inv) => {
      inv.weapon = "sword";
      inv.armour = 15;
      inv.potions = 3;
    });
    this.state.checkpoint();

    const a = defaultAppearance();
    const { body, heightScale } = await createPlayerBody(w, a);
    const p = ARENA.player;
    const pc = new PlayerController(ph, w.rig, body, new Vector3(p.x, p.y, p.z), p.yaw);
    this.player = pc;
    pc.setEyeHeight(1.62 * heightScale);
    w.rig.follow(pc);
    this.gear = new PlayerGear(w, pc, () => a);
    await w.ensureCombat().catch(() => {});
    await this.gear.sync(this.flags.inv, { dip: 0 });
    if (this.disposed) throw new Error("arena disposed while loading");
    this.combat = new PrologueCombat(this, pc, this.gear);
    this.combatHud = new CombatHud({ combat: this.combat, armed: () => pc.armed, bus: w, time: this.time });
    this.ai = new PrologueAI(w, this.combat, pc);
    const brun = w.npc("brun", { outfit: [...OUTFITS.rebel], hair: ["hair_simpleparted", "hair_beard"] });
    // Brun fights with his axe drawn (the chapters' companion-arming path); the kit goes with the actor
    const kit = await armNpc(w, brun, { main: "axe" }, { drawn: true }).catch((e) => {
      console.warn("arena: arming Brun failed", e);
      return null;
    });
    if (this.disposed) {
      kit?.dispose();
      throw new Error("arena disposed while loading");
    }
    this.companion = this.ai.companion({ who: "brun", body: brun, at: { ...ARENA.companion }, equipment: kit });
    await this.startRound();
    await Promise.race([this.scene.whenReadyAsync().catch(() => {}), new Promise((r) => setTimeout(r, 15000))]);
    return this;
  }

  /** The floor, a low wall around it and two pillars, with their colliders. */
  private buildFloor(ph: Physics) {
    const scene = this.scene;
    const h = ARENA.half;
    const ground = CreateGround("arena_floor", { width: h * 2, height: h * 2, subdivisions: 2 }, scene);
    ground.material = flat("arena_floor", new Color3(0.32, 0.29, 0.25), scene);
    ground.receiveShadows = true;
    ground.isPickable = false;
    ph.addBox(new Vector3(0, -0.5, 0), new Vector3(h + 2, 0.5, h + 2), undefined, { tag: "arena_floor" });
    const stone = flat("arena_stone", new Color3(0.45, 0.44, 0.42), scene);
    const blocks: Mesh[] = [];
    const block = (name: string, c: Vector3, half: Vector3) => {
      const m = CreateBox(name, { width: half.x * 2, height: half.y * 2, depth: half.z * 2 }, scene);
      m.position.copyFrom(c);
      m.material = stone;
      m.isPickable = false;
      blocks.push(m);
      ph.addBox(c, half, undefined, { tag: "arena_wall" });
    };
    const { height: wh, thickness: t } = ARENA.wall;
    block("arena_wall_n", new Vector3(0, wh / 2, -h), new Vector3(h, wh / 2, t / 2));
    block("arena_wall_s", new Vector3(0, wh / 2, h), new Vector3(h, wh / 2, t / 2));
    block("arena_wall_w", new Vector3(-h, wh / 2, 0), new Vector3(t / 2, wh / 2, h));
    block("arena_wall_e", new Vector3(h, wh / 2, 0), new Vector3(t / 2, wh / 2, h));
    for (const [i, p] of ARENA.pillars.entries()) block(`arena_pillar_${i}`, new Vector3(p.x, 1.5, p.z), new Vector3(0.5, 1.5, 0.5));
    this.world.addShadowCasters(blocks);
  }

  /** A fresh round: the enemies at their posts (an encounter: death retries it, clearing it starts the next). */
  async startRound() {
    const combat = this.combat, ai = this.ai;
    if (!combat || !ai || this.disposed) return;
    this.next?.();
    this.next = null;
    this.encounter?.dispose();
    this.round++;
    // a sandbox: every round starts at normal difficulty
    this.state.update("deaths", (d) => void delete d.arena);
    const spider = assets.has(SPIDER.asset);
    const e = combat.encounter<AiActor>(
      {
        id: "arena",
        arena: [{ min: [-ARENA.half, -2, -ARENA.half], max: [ARENA.half, 8, ARENA.half] }],
        spawns: [
          ...ARENA.enemies.map((s) => ({
            id: s.id,
            make: () => ai.enemy({ id: `arena_${s.id}`, archetype: s.archetype, faction: "imperial", at: { ...s.at }, senses: true, group: "arena" }),
          })),
          ...(spider
            ? [
                {
                  id: "spider",
                  make: async () => {
                    const a = await ai.creature({ id: "arena_spider", archetype: "smallSpider", at: { ...ARENA.spider }, senses: true, group: "arena", tint: [0.35, 0.22, 0.12], companion: () => this.companion?.combatant ?? null });
                    if (!a) throw new Error(`${SPIDER.asset} did not load`);
                    return a;
                  },
                },
              ]
            : []),
        ],
        retry: { player: { ...ARENA.player }, companion: { ...ARENA.companion }, minHp: 0.6 },
        onClear: () => {
          hud.toast("本轮胜利", 2500);
          let t = 0;
          this.next = this.world.onUpdate((dt) => {
            t += dt;
            if (t >= ARENA.between) void this.startRound();
          });
        },
      },
      { companion: this.companion },
    );
    this.encounter = e;
    await e.start();
  }

  /** Every enemy turns on the player now (headless tests skip the sneaking). */
  engage() {
    const player = this.combat?.player;
    for (const a of this.encounter?.actors ?? []) if (player && a.combatant.active) a.brain.engage(player);
  }

  /** Every enemy of the player dies. */
  killAll() {
    this.combat?.debugKillAll();
  }

  /** A fresh round now (the player and Brun back on their marks, healed). */
  async restart() {
    const pc = this.player, combat = this.combat;
    if (!pc || !combat) return;
    pc.teleport(new Vector3(ARENA.player.x, ARENA.player.y, ARENA.player.z), ARENA.player.yaw);
    combat.system.resetState(combat.player, 1);
    combat.controls.reset();
    if (this.companion) {
      this.companion.teleport({ ...ARENA.companion });
      combat.system.resetState(this.companion.combatant, 1);
      this.companion.reset();
    }
    await this.startRound();
  }

  begin() {
    hud.toast("竞技场：R 拔剑 · 左键 攻击 · 右键 格挡 · C 潜行 · Q 治疗", 6000);
  }

  update(dt: number) {
    if (this.paused || this.disposed) return;
    hud.tick(dt);
    // hit-stop and slow motion run through the stage clock, as in the prologue
    dt *= this.time.step(dt);
    this.player?.update(dt);
    this.world.update(dt);
  }

  applyQuality(q: Quality) {
    this.world.applyQuality(q);
  }

  setPaused(p: boolean) {
    this.paused = p;
  }

  saveState() {
    return { label: "竞技场", state: {} };
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.next?.();
    this.next = null;
    this.encounter?.dispose();
    this.encounter = null;
    this.companion?.dispose();
    this.companion = null;
    this.ai?.dispose();
    this.ai = null;
    this.combatHud?.dispose();
    this.combatHud = null;
    this.combat?.dispose();
    this.combat = null;
    this.gear?.dispose();
    this.gear = null;
    this.player?.dispose();
    this.player = null;
    this.world.dispose();
    this.physics?.dispose();
    this.physics = null;
    hud.reset();
  }
}

/** A plain rough material. */
function flat(name: string, color: Color3, scene: Scene) {
  const m = new PBRMaterial(name, scene);
  m.albedoColor = color;
  m.metallic = 0;
  m.roughness = 0.95;
  return m;
}
