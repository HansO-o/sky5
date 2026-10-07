import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Quaternion, Vector3 } from "@babylonjs/core/Maths/math.vector";
import { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { CreateCylinder } from "@babylonjs/core/Meshes/Builders/cylinderBuilder";
import { CreateSphere } from "@babylonjs/core/Meshes/Builders/sphereBuilder";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import type { Scene } from "@babylonjs/core/scene";
import { assets } from "../../core/assets/AssetClient";
import { audio } from "../../core/audio";
import { CreatureBrain, type Leash } from "../../engine/ai/CreatureBrain";
import type { Combatant } from "../../engine/combat/CombatSystem";
import type { EncounterActor, Mark } from "../../engine/combat/Encounter";
import { Emitter } from "../../engine/core/emitter";
import { Creature, type CreatureProfile } from "../../engine/creatures/Creature";
import { applyLightBudget } from "../../engine/render/lightBudget";
import { precompile } from "../../engine/render/precompile";
import type { AiActor, CreatureSpec } from "../ai";
import { FACTION } from "../combat";
import { ENEMY_LABELS } from "../combatHud";
import { loadCreature, SPIDER } from "../creatures";
import type { PrologueStage } from "../PrologueStage";
import type { World } from "../World";
import type { CaveWorld } from "./cave";
import { AMBUSH, beastOutcome, WOLF, WolfWatch } from "./rules";
import { caveSpiderGait, SPIDER_RIG, wolfGait, WOLF_RIG } from "./rigs";

export { caveSpiderGait, SPIDER_RIG, wolfGait, WOLF_RIG };

// ------------------------------------------------------------------------------------------------
// sounds and timers

function sfx(ids: readonly string[], at: { x: number; y: number; z: number }, volume: number, rate = 1) {
  const ok = ids.filter((id) => assets.has(id));
  const id = ok[Math.floor(Math.random() * ok.length)];
  if (id) void audio.playOneShot(id, volume, at, "sfx", rate, 4);
}

const HISS = ["audio/spider_hiss", "audio/spider_hiss_2", "audio/spider_hiss_3"];
const BITE = ["audio/spider_attack", "audio/spider_attack_2"];
const GROWL = ["audio/wolf_growl", "audio/wolf_growl_2"];

/** Run `fn` after `seconds` of game time (cancelled with the returned disposer). */
function after(world: World, seconds: number, fn: () => void) {
  let left = seconds;
  const off = world.onUpdate((dt) => {
    left -= dt;
    if (left > 0) return;
    off();
    fn();
  });
  return () => void off();
}

/** A looping sound that follows `pos` (null without audio, or a build without the cue). */
async function loopAt(world: World, id: string, pos: () => Vector3, volume: number) {
  if (!assets.has(id)) return null;
  try {
    const h = await world.loopEmitter(id, pos, volume);
    return h ? { stop: h.stop, gain: h.gain as GainNode | undefined } : null;
  } catch (e) {
    console.warn(`exit: ${id}`, e);
    return null;
  }
}

function setGain(g: GainNode | undefined, v: number, tc = 0.15) {
  const ctx = audio.ctx;
  if (g && ctx) g.gain.setTargetAtTime(v, ctx.currentTime, tc);
}

// ------------------------------------------------------------------------------------------------
// stand-ins (a build without the creature assets still plays: a shape that fights the same way)

const standInMats = new WeakMap<Scene, Map<string, PBRMaterial>>();

function standInMat(scene: Scene, name: string, rgb: [number, number, number], emissive?: [number, number, number]) {
  let m = standInMats.get(scene);
  if (!m) standInMats.set(scene, (m = new Map()));
  let mat = m.get(name);
  if (!mat || mat.getScene() !== scene || !scene.materials.includes(mat)) {
    mat = new PBRMaterial(`exit_standin_${name}`, scene);
    mat.albedoColor = new Color3(...rgb);
    mat.roughness = 0.6;
    mat.metallic = 0;
    if (emissive) mat.emissiveColor = new Color3(...emissive);
    applyLightBudget([mat]);
    m.set(name, mat);
  }
  return mat;
}

/** A procedural body facing +Z with its feet at the origin (meshes under one node): the stand-in's model. */
function standIn(scene: Scene, profile: CreatureProfile, parts: (add: (m: Mesh, mat: PBRMaterial) => void) => void) {
  const root = new TransformNode(`${profile.name}_standin`, scene);
  parts((m, mat) => {
    m.parent = root;
    m.material = mat;
    m.isPickable = false;
  });
  return new Creature(scene, { rootNodes: [root], animationGroups: [] }, profile);
}

/** A spider-shaped stand-in (2.6 m leg span at scale 1, 0.85 m tall). */
function standInSpider(scene: Scene, profile: CreatureProfile) {
  return standIn(scene, profile, (add) => {
    const body = standInMat(scene, "spider_body", [0.05, 0.045, 0.04]);
    const eyes = standInMat(scene, "spider_eyes", [0.25, 0.012, 0.01], [0.55, 0.035, 0.02]);
    const thorax = CreateSphere(`${profile.name}_thorax`, { diameterX: 0.8, diameterY: 0.45, diameterZ: 0.85, segments: 8 }, scene);
    thorax.position.set(0, 0.5, 0.25);
    add(thorax, body);
    const abdomen = CreateSphere(`${profile.name}_abdomen`, { diameterX: 0.95, diameterY: 0.7, diameterZ: 1.15, segments: 8 }, scene);
    abdomen.position.set(0, 0.55, -0.62);
    add(abdomen, body);
    for (const sx of [-1, 1]) {
      const eye = CreateSphere(`${profile.name}_eye${sx}`, { diameter: 0.09, segments: 4 }, scene);
      eye.position.set(sx * 0.12, 0.62, 0.66);
      add(eye, eyes);
      for (let i = 0; i < 4; i++) {
        const leg = CreateCylinder(`${profile.name}_leg${sx}${i}`, { height: 1.25, diameterTop: 0.08, diameterBottom: 0.03, tessellation: 5 }, scene);
        leg.position.set(sx * 0.68, 0.32, 0.55 - i * 0.32);
        leg.rotation.set(0, (i - 1.5) * 0.25 * sx, sx * 1.05);
        add(leg, body);
      }
    }
  });
}

/** A wolf-shaped stand-in (1.7 m to the ears, 2.5 m long). */
function standInWolf(scene: Scene, profile: CreatureProfile) {
  return standIn(scene, profile, (add) => {
    const fur = standInMat(scene, "wolf_fur", [0.28, 0.27, 0.25]);
    const torso = CreateSphere(`${profile.name}_torso`, { diameterX: 0.55, diameterY: 0.7, diameterZ: 1.7, segments: 8 }, scene);
    torso.position.set(0, 0.95, 0);
    add(torso, fur);
    const head = CreateSphere(`${profile.name}_head`, { diameterX: 0.38, diameterY: 0.4, diameterZ: 0.7, segments: 8 }, scene);
    head.position.set(0, 1.3, 1.0);
    add(head, fur);
    const tail = CreateCylinder(`${profile.name}_tail`, { height: 0.8, diameterTop: 0.12, diameterBottom: 0.05, tessellation: 5 }, scene);
    tail.position.set(0, 0.9, -1.15);
    tail.rotation.x = -1.0;
    add(tail, fur);
    for (const sx of [-1, 1])
      for (const sz of [-1, 1]) {
        const leg = CreateCylinder(`${profile.name}_leg${sx}${sz}`, { height: 0.8, diameter: 0.11, tessellation: 5 }, scene);
        leg.position.set(sx * 0.17, 0.4, sz * 0.55);
        add(leg, fur);
      }
  });
}

/** The creature `asset` in `profile`, own materials; its stand-in when the build lacks it or it fails to load. */
async function creatureBody(world: World, asset: string, profile: CreatureProfile, standInOf: (s: Scene, p: CreatureProfile) => Creature): Promise<Creature> {
  const cr = await loadCreature(world, asset, profile, { cloneMaterials: true });
  if (cr) return cr;
  const s = standInOf(world.scene, profile);
  world.addShadowCasters(s.meshes);
  s.setEnabled(false);
  await precompile(s.meshes, { shadows: world.env.shadows });
  s.setEnabled(true);
  return s;
}

/** Colour a spider's body (not its glowing eyes: the pipeline's variants tint only `spider_body`). */
function tintSpider(cr: Creature, rgb: readonly [number, number, number]) {
  const mats = new Set(cr.meshes.map((m) => m.material).filter((m): m is NonNullable<typeof m> => !!m));
  const body = [...mats].filter((m) => /spider_body/.test(m.name));
  for (const m of body.length ? body : [...mats].filter((m) => !/eyes/.test(m.name))) {
    const lit = m as unknown as { albedoColor?: Color3; diffuseColor?: Color3 };
    lit.albedoColor?.set(rgb[0], rgb[1], rgb[2]);
    lit.diffuseColor?.set(rgb[0], rgb[1], rgb[2]);
  }
}

// ------------------------------------------------------------------------------------------------
// spiders (E5)

export interface CaveSpiderSpawn {
  /** the combatant id (fresh per spawn: an encounter's retry spawns again under the same id) */
  id: string;
  /** where it comes out (a burrow) or lands (`spider_c`): feet and facing */
  at: Mark;
  /** parked out of sight and out of the fight until `emerge()` / `drop()` (default true) */
  hidden?: boolean;
  /** the companion (whom it may turn on) and its torch (the small ones back off from it, §6.3) */
  companion?: () => Combatant | null;
  torch?: () => { x: number; z: number } | null;
  /** keep to (default: the chamber, `spider_c`, 12 m, inside `volumes.spider_arena`) */
  leash?: Leash | null;
  group?: string;
}

/** How far under its spot a hidden creature is parked (out of sight, its capsule out of the way). */
const PARK = 4;

/**
 * A spider of the chamber's ambush (design §6.3 E5): an AI actor (`ai.creature`) that an encounter
 * owns (`EncounterActor`). Spawned hidden (parked under the floor, out of the fight), it comes out
 * of its burrow with `emerge()` (the small ones) or down the chimney on its silk with `drop()` (the
 * giant: 1.6 s, the camera shake, the boss bar 洞穴巨蛛). Its bite and death sounds, and a skitter
 * that follows it while it moves.
 */
export class CaveSpider implements EncounterActor {
  private parked: boolean;
  private skitter: { stop(): void; gain: GainNode | undefined } | null = null;
  private silk: Mesh | null = null;
  private offs: (() => unknown)[] = [];
  private disposed = false;

  constructor(
    private stage: PrologueStage,
    readonly actor: AiActor,
    readonly kind: "small" | "giant",
    private at: Mark,
    hidden: boolean,
    silk: Mesh | null,
  ) {
    this.silk = silk;
    this.parked = false;
    const sys = stage.combat?.system;
    if (sys)
      this.offs.push(
        sys.events.on((e) => {
          if (e.type === "windup" && e.attacker === actor.combatant) sfx(BITE, e.attacker.pose, kind === "giant" ? 0.9 : 0.7, kind === "giant" ? 0.85 : 1.15);
          else if (e.type === "death" && e.target === actor.combatant) {
            sfx(["audio/spider_death"], e.target.pose, kind === "giant" ? 1 : 0.8, kind === "giant" ? 0.8 : 1.1);
            this.skitter?.stop();
            this.skitter = null;
          }
        }),
      );
    this.offs.push(stage.world.onUpdate(() => this.update()));
    if (hidden) this.park();
  }

  get combatant() {
    return this.actor.combatant;
  }

  get creature(): Creature | null {
    return this.actor.creature ?? null;
  }

  /** Still in its burrow or up the chimney. */
  get hidden() {
    return this.parked;
  }

  get dead() {
    return this.actor.combatant.dead;
  }

  /** Out of sight and out of the fight (not hostile, not thinking), under its spot. */
  private park() {
    const cr = this.creature;
    this.parked = true;
    this.actor.brain.suspend();
    this.actor.combatant.faction = FACTION.neutral;
    if (cr) {
      cr.setEnabled(false);
      cr.root.position.set(this.at.x, this.at.y - PARK, this.at.z);
    }
  }

  /** Into the fight where it stands now (hostile, thinking, after `target` when given). */
  private release(target?: Combatant | null) {
    this.parked = false;
    this.actor.combatant.faction = FACTION.beast;
    this.actor.brain.resume("alert");
    this.actor.brain.engage(target ?? this.stage.combat?.player ?? null);
    void loopAt(this.stage.world, "audio/spider_skitter", () => this.creature?.root.position ?? Vector3.Zero(), 0).then((h) => {
      if (!h) return;
      if (this.disposed || this.dead) h.stop();
      else this.skitter = h;
    });
  }

  /** A small spider scuttles out of its burrow at its spot and goes for `target` (default the player). */
  emerge(target?: Combatant | null) {
    if (!this.parked || this.disposed) return;
    const cr = this.creature;
    if (cr) {
      cr.root.position.set(this.at.x, this.at.y, this.at.z);
      cr.setYaw(this.at.yaw ?? 0);
      cr.setEnabled(true);
    }
    sfx(HISS, this.at, 0.55, 1.25);
    this.release(target);
  }

  /**
   * The giant comes down the chimney on its silk (§6.1 phase B): from `mouth` (the chimney's
   * opening in the ceiling) to its spot over `seconds` (1.6), fast then braking, swaying; a hiss as
   * it drops; landed, the shake (0.015, 0.4), the boss bar, and it goes for `target`. Resolves on
   * landing.
   */
  async drop(mouth: { x: number; y: number; z: number }, o: { seconds?: number; target?: Combatant | null } = {}) {
    if (!this.parked || this.disposed) return;
    const cr = this.creature;
    const w = this.stage.world;
    const seconds = o.seconds ?? AMBUSH.drop;
    const scale = cr?.profile.scale ?? 1;
    const floor = this.at.y;
    const top = Math.max(floor + 1, mouth.y - SPIDER_RIG.height * scale * 0.6);
    // it lands facing whom it drops on
    const foe = (o.target ?? this.stage.combat?.player)?.pose;
    const yaw = foe ? Math.atan2(-(foe.x - this.at.x), -(foe.z - this.at.z)) : (this.at.yaw ?? 0);
    sfx(HISS, { x: this.at.x, y: mouth.y - 1, z: this.at.z }, 1, 0.8);
    if (cr) {
      cr.root.position.set(this.at.x, top, this.at.z);
      cr.setYaw(yaw);
      cr.setEnabled(true);
    }
    const silk = this.silk;
    silk?.setEnabled(!!cr);
    const silkTo = (bottom: number) => {
      if (!silk || !cr) return;
      const t = mouth.y + 0.6;
      const len = Math.max(0.01, t - bottom);
      silk.position.set(cr.root.position.x, (t + bottom) / 2, cr.root.position.z);
      silk.scaling.set(1, len, 1);
    };
    await new Promise<void>((resolve) => {
      let t = 0;
      const off = w.onUpdate((dt) => {
        t += dt;
        const u = Math.min(1, t / seconds);
        const k = 1 - Math.pow(1 - u, 2.2);
        if (cr && !this.disposed) {
          cr.root.position.y = top + (floor - top) * k;
          // (a slow spin on the thread)
          cr.setYaw(yaw + Math.sin(t * 2.3) * 0.35 * (1 - u));
          silkTo(cr.root.position.y + SPIDER_RIG.height * scale * 0.75);
        }
        if (u < 1 && !this.disposed && !w.disposed) return;
        off();
        resolve();
      });
    });
    if (this.disposed) return;
    if (cr) {
      cr.root.position.y = floor;
      cr.setYaw(yaw);
    }
    w.rig.shake(0.015, 0.4);
    this.stage.combatHud?.boss(this.actor.combatant, ENEMY_LABELS.giantSpider);
    this.release(o.target);
    // the thread draws back up into the dark
    if (silk && cr) {
      const from = cr.root.position.y + SPIDER_RIG.height * scale * 0.75;
      let t = 0;
      const off = w.onUpdate((dt) => {
        t += dt;
        const u = Math.min(1, t / 0.6);
        silkTo(from + (mouth.y + 0.55 - from) * u);
        if (u < 1 && !this.disposed) return;
        off();
        silk.setEnabled(false);
      });
      this.offs.push(off);
    }
  }

  private update() {
    if (this.disposed || this.parked || !this.skitter) return;
    // the legs' patter with its pace
    const v = this.actor.agent.speed;
    setGain(this.skitter.gain, Math.min(1, v / 2.5) * (this.kind === "giant" ? 0.9 : 0.6));
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    for (const o of this.offs) o();
    this.offs = [];
    this.skitter?.stop();
    this.skitter = null;
    this.silk?.dispose(false, true);
    this.silk = null;
    if (this.stage.combatHud && this.kind === "giant") this.stage.combatHud.boss(null);
    this.actor.dispose();
  }
}

/** The chamber as a spider's leash (§6.3: "webs and leash keep them in"). */
function chamberLeash(cave: CaveWorld): Leash {
  const c = cave.anchor("spider_c").pos;
  return { home: { x: c.x, y: c.y, z: c.z }, radius: 12, inside: (p) => cave.inSpiderArena({ x: p.x, y: c.y + 1, z: p.z }, 0.5) };
}

/** The ARCHETYPES' small or giant spider with the rig's speed, size and colour. */
async function spawnSpider(stage: PrologueStage, cave: CaveWorld, kind: "small" | "giant", o: CaveSpiderSpawn): Promise<CaveSpider> {
  const ai = await stage.ensureAI();
  const w = stage.world;
  const rig = SPIDER_RIG[kind];
  const body = await creatureBody(w, SPIDER.asset, { name: `ai_${o.id}`, scale: rig.scale }, standInSpider);
  tintSpider(body, rig.body);
  // the giant's silk, made (and compiled) now so the drop doesn't hitch
  let silk: Mesh | null = null;
  if (kind === "giant") {
    silk = CreateCylinder(`${o.id}_silk`, { height: 1, diameter: 0.035, tessellation: 5 }, w.scene);
    const m = new StandardMaterial(`${o.id}_silk_mat`, w.scene);
    m.disableLighting = true;
    m.emissiveColor = new Color3(0.55, 0.57, 0.6);
    m.alpha = 0.8;
    applyLightBudget([m]);
    silk.material = m;
    silk.isPickable = false;
    silk.setEnabled(false);
    await precompile([silk]);
  }
  const spec: CreatureSpec = {
    id: o.id,
    archetype: kind === "giant" ? "giantSpider" : "smallSpider",
    at: o.at,
    label: ENEMY_LABELS[kind === "giant" ? "giantSpider" : "smallSpider"],
    body,
    scale: rig.scale,
    gait: caveSpiderGait(rig.scale),
    capsule: rig.capsule,
    // (its fight starts when it comes out: no ears, never asleep)
    aware: true,
    leash: o.leash === undefined ? chamberLeash(cave) : (o.leash ?? undefined),
    companion: o.companion,
    fear: kind === "small" ? o.torch : undefined,
    group: o.group ?? "exit_spiders",
  };
  let actor: AiActor | null;
  try {
    actor = await ai.creature(spec);
  } catch (e) {
    body.dispose();
    silk?.dispose(false, true);
    throw e;
  }
  if (!actor) {
    silk?.dispose(false, true);
    throw new Error(`exit: spider ${o.id} could not be made`);
  }
  return new CaveSpider(stage, actor, kind, o.at, o.hidden ?? true, silk);
}

/** A small cave spider (小洞蛛: scale 0.55, brown), hidden in its burrow until `emerge()`. */
export function spawnSmallSpider(stage: PrologueStage, cave: CaveWorld, o: CaveSpiderSpawn) {
  return spawnSpider(stage, cave, "small", o);
}

/** The giant cave spider (洞穴巨蛛: scale 1, black), up the chimney until `drop()`. */
export function spawnGiantSpider(stage: PrologueStage, cave: CaveWorld, o: CaveSpiderSpawn) {
  return spawnSpider(stage, cave, "giant", o);
}

// ------------------------------------------------------------------------------------------------
// the wolf (E6)

export type WolfEvent =
  /** the meter reached 0.5 (the stir line), fell back under 0.2 (the calm line), it woke (the wake line) */
  | { type: "stir" }
  | { type: "calm" }
  | { type: "wake" }
  /** its target got beyond the leash: it snarls and goes home (the "leashed" line) */
  | { type: "leash" }
  /** back asleep on its bed (20 s after the leash) */
  | { type: "asleep" }
  | { type: "death" };

export interface CaveWolfSpawn {
  /** default "wolf" */
  id?: string;
  /** its bed (default anchor `wolf_bed`, facing `cp_den`) */
  bed?: Mark;
  /** the companion (whom it turns on 30 % of the time) */
  companion?: () => Combatant | null;
}

/**
 * The great wolf of the den (巨狼, design §6.3 E6, §9): asleep on `wolf_bed` with its spine
 * breathing and its breath audible; its beast meter (noise only) stirs it at 0.5 (a growl, the
 * head up) and wakes it at 1.0, as does any blow, the player too close or a clash nearby: it stands
 * up, howls and fights (the boss bar 巨狼). Leashed 18 m from its bed and below `climb_s23`: beyond,
 * it snarls, goes home and sleeps again after 20 s. `events` carries what the dialogue reads
 * (stir, calm, wake, leash, asleep, death), `outcome` what the den came to (`outcomes.beast`).
 */
export class CaveWolf implements EncounterActor {
  readonly events = new Emitter<WolfEvent>();
  /** the meter's edges as the lines read them (stir 0.5, calm under 0.2, wake) */
  readonly watch = new WolfWatch();
  /** it has been awake at some point, and been shaken off by its leash at some point */
  woke = false;
  leashed = false;
  private breath: { stop(): void; gain: GainNode | undefined } | null = null;
  private breathing = false;
  private breathAmp = 1;
  private t = 0;
  private offs: (() => unknown)[] = [];
  private disposed = false;

  constructor(
    private stage: PrologueStage,
    readonly actor: AiActor,
  ) {
    const w = stage.world;
    const brain = this.brain;
    this.offs.push(
      actor.brain.events.on((e) => {
        if (e.type === "bark") this.bark(e.kind);
        else if (e.type === "died") this.died();
      }),
      w.onUpdate((dt) => this.update(dt)),
    );
    // the spine's breath while it lies (it eases out as it stands up)
    const cr = actor.creature;
    const spine = cr?.bone(WOLF_RIG.spine) ?? null;
    if (cr && spine) {
      const q = new Quaternion();
      const axis = new Vector3(1, 0, 0);
      this.offs.push(
        cr.procedural.set(spine, (base, out) => {
          const a = ((WOLF_RIG.breathe.deg * Math.PI) / 180) * this.breathAmp * Math.sin(this.t * Math.PI * 2 * WOLF_RIG.breathe.hz);
          Quaternion.RotationAxisToRef(axis, a, q);
          base.multiplyToRef(q, out);
        }),
      );
    }
    if (brain && this.asleep) this.breathe(true);
  }

  get combatant() {
    return this.actor.combatant;
  }

  get brain(): CreatureBrain | null {
    return this.actor.brain instanceof CreatureBrain ? this.actor.brain : null;
  }

  /** Its noise meter, 0..1 (§9 "Wolf"). */
  get meter() {
    return this.brain?.sensor?.meter ?? 0;
  }

  /** Lying on its bed (asleep or stirring). */
  get asleep() {
    return (this.actor.combatant.spec.awareness?.() ?? "alert") === "asleep";
  }

  get dead() {
    return this.actor.combatant.dead;
  }

  /** What the den came to so far (`outcomes.beast`): killed, fled, asleep, or undefined (still on). */
  get outcome() {
    return beastOutcome({ killed: this.dead, woke: this.woke, leashed: this.leashed });
  }

  /**
   * Back on its bed asleep with its meter at 0 (a checkpoint, §11: "a leashed wolf is back
   * asleep"); false when it can't (dead).
   */
  sleep(): boolean {
    const b = this.brain;
    if (!b || this.disposed || !b.sleep()) return false;
    this.watch.sleep();
    this.stage.combatHud?.boss(null);
    this.breathe(true);
    return true;
  }

  private bark(kind: string) {
    const pos = this.actor.combatant.pose;
    if (kind === "stir") sfx(GROWL, pos, 0.6);
    else if (kind === "wake") {
      this.woke = true;
      this.breathe(false);
      sfx(GROWL, pos, 0.9, 0.9);
      this.offs.push(after(this.stage.world, WOLF_RIG.howlAfter, () => !this.disposed && !this.dead && sfx(["audio/wolf_howl"], this.actor.combatant.pose, 1)));
      this.stage.combatHud?.boss(this.actor.combatant, ENEMY_LABELS.wolf);
    } else if (kind === "leash") {
      this.leashed = true;
      sfx(["audio/wolf_snarl"], pos, 0.9);
      this.stage.combatHud?.boss(null);
      this.events.emit({ type: "leash" });
    } else if (kind === "sleep" && this.woke) {
      this.watch.sleep();
      this.breathe(true);
      this.events.emit({ type: "asleep" });
    }
  }

  private died() {
    this.breathe(false);
    sfx(["audio/wolf_death"], this.actor.combatant.pose, 1);
    this.events.emit({ type: "death" });
  }

  private update(dt: number) {
    if (this.disposed) return;
    this.t += dt;
    this.breathAmp += ((this.asleep ? 1 : 0) - this.breathAmp) * Math.min(1, dt * 2);
    if (this.dead) return;
    const cue = this.watch.update(this.meter, !this.asleep);
    if (cue) {
      if (cue === "wake") this.woke = true;
      this.events.emit({ type: cue });
    }
  }

  /** Its breathing loop on (asleep) or off (awake, dead). */
  private breathe(on: boolean) {
    if (on === this.breathing || this.disposed) return;
    this.breathing = on;
    if (!on) {
      this.breath?.stop();
      this.breath = null;
      return;
    }
    const root = this.actor.creature?.root;
    const at = () => (root ? root.position : new Vector3(this.actor.combatant.pose.x, this.actor.combatant.pose.y, this.actor.combatant.pose.z));
    void loopAt(this.stage.world, "audio/wolf_breath", at, 0.6).then((h) => {
      if (!h) return;
      if (!this.breathing || this.disposed) h.stop();
      else this.breath = h;
    });
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    for (const o of this.offs) o();
    this.offs = [];
    this.breath?.stop();
    this.breath = null;
    this.events.clear();
    this.actor.dispose();
  }
}

/**
 * The den's wolf (see {@link CaveWolf}), asleep on its bed (anchor `wolf_bed`) with its leash: 18 m
 * from the bed and not past `climb_s23`. Its stand-in when the build lacks `creatures/wolf`.
 */
export async function spawnWolf(stage: PrologueStage, cave: CaveWorld, o: CaveWolfSpawn = {}): Promise<CaveWolf> {
  const ai = await stage.ensureAI();
  const w = stage.world;
  const id = o.id ?? "wolf";
  const bedA = cave.anchor("wolf_bed");
  const bed: Mark = o.bed ?? { x: bedA.pos.x, y: bedA.pos.y, z: bedA.pos.z, yaw: bedA.yaw };
  const body = await creatureBody(w, WOLF_RIG.asset, { name: `ai_${id}`, scale: 1, bones: { spine: WOLF_RIG.spine, head: "Head" } }, standInWolf);
  const c = WOLF_RIG.clips;
  let actor: AiActor | null;
  try {
    actor = await ai.creature({
      id,
      archetype: "wolf",
      at: bed,
      label: ENEMY_LABELS.wolf,
      asset: WOLF_RIG.asset,
      body,
      scale: 1,
      gait: wolfGait(),
      capsule: WOLF_RIG.capsule,
      clips: { death: [c.death], backstabDeath: c.death, idle: c.idle },
      senses: true,
      asleep: true,
      sleep: { sleep: c.sleep, stir: c.idle, wake: c.standUp },
      leash: { home: { x: bed.x, y: bed.y, z: bed.z, yaw: bed.yaw }, radius: WOLF.leash, inside: cave.leash },
      companion: o.companion,
      group: "exit_wolf",
    });
  } catch (e) {
    body.dispose();
    throw e;
  }
  if (!actor) throw new Error("exit: the wolf could not be made");
  return new CaveWolf(stage, actor);
}
