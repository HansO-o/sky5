import { Matrix, Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Frustum } from "@babylonjs/core/Maths/math.frustum";
import { Emitter } from "../engine/core/emitter";
import { AISystem } from "../engine/ai/AISystem";
import { AgentMover, type AgentBody } from "../engine/ai/AgentMover";
import type { Gait } from "../engine/ai/agent";
import { combatantOf, companionCombatant, companionFighter, fighterOf, type BrainClips, type BrainEvent, type CombatBrain } from "../engine/ai/CombatBrain";
import { Companion, type Leader } from "../engine/ai/Companion";
import { CreatureBrain, type Leash, type SleepClips } from "../engine/ai/CreatureBrain";
import { HumanoidBrain, type Post } from "../engine/ai/HumanoidBrain";
import { combatNoise, footstepNoise } from "../engine/ai/noise";
import type { SensorSpec } from "../engine/ai/Perception";
import type { XZ } from "../engine/ai/steering";
import type { Equipment } from "../engine/actors/Equipment";
import type { Creature, CreatureProfile } from "../engine/creatures/Creature";
import { ARCHETYPES, ARROW, COMPANIONS, type ArchetypeId } from "../engine/combat/attacks";
import type { Combatant } from "../engine/combat/CombatSystem";
import type { EncounterActor, EncounterParticipant, Mark } from "../engine/combat/Encounter";
import type { XYZ } from "../engine/combat/hit";
import type { Disposer } from "../engine/core/types";
import { CapsuleMover } from "../engine/physics/CapsuleMover";
import type { Physics } from "../engine/physics/Physics";
import { Ragdoll } from "../physics/ragdoll";
import { hud } from "../ui/hud";
import { OUTFITS, type Character, type CharacterSpec } from "../world/characters";
import { FACTION, type PrologueCombat } from "./combat";
import { ENEMY_LABELS } from "./combatHud";
import { loadCreature, SPIDER, spiderProfile } from "./creatures";
import { shootArrow } from "./fx/arrow";
import { glint, middleOf, prepareGlints } from "./fx/glint";
import { armNpc } from "./gear";
import type { PlayerController } from "./player";
import type { World } from "./World";

/**
 * The prologue's AI (design §3.6, §9), stage-owned like the combat (`stage.ensureAI()`): one
 * `AISystem` on the world's game time with static line of sight, the player as what sensors look
 * for (sneaking, moving, the light at the player), the player's footsteps, landings and potions
 * and every blow and swing on the noise bus, the HUD's stealth eye, and the spawners chapters use
 * for their fighters: `enemy()`, `creature()`, `companion()`. Every actor they make is an
 * `EncounterActor` (dispose it, or let its encounter do it).
 */
export class PrologueAI {
  readonly system: AISystem;
  /** every brain event of every actor this made (barks, glints, shots, deaths): chapters pick the words */
  readonly events = new Emitter<{ actor: AiActor; event: BrainEvent }>();
  /** the light at the player, 0..1 (§9: sight halves below 0.2); chapters set it for dark places */
  light: () => number = () => 1;
  /** drive the HUD's stealth eye: shown while sneaking or while anything is aware of the player (§9) */
  eye = true;
  private offs: (() => unknown)[] = [];
  private actors = new Set<AiActor>();
  private air = 0;
  private eyeShown: string | null = null;
  private frustum = { frame: -1, planes: Frustum.GetPlanes(Matrix.Identity()) };
  private disposed = false;

  constructor(
    readonly world: World,
    readonly combat: PrologueCombat,
    readonly player: PlayerController,
  ) {
    const ph = world.physics;
    if (!ph) throw new Error("PrologueAI: no physics yet");
    this.system = new AISystem({ los: ph });
    const pc = player;
    const moving = () => pc.speed > 0.3;
    this.offs.push(
      this.system.perception.addTarget({
        id: "player",
        position: () => pc.position,
        sneaking: () => pc.sneaking,
        moving,
        light: () => this.light(),
        hidden: () => !pc.enabled || combat.player.vitals.dead,
      }),
      // footsteps (sneak 2 m, walk 8, run 12, sprint 16 for people; the wolf's own table)
      this.system.noise.source(() => {
        if (!pc.enabled) return null;
        const kind = footstepNoise({ speed: pc.speed, sneaking: pc.sneaking, sprinting: pc.sprinting, grounded: pc.onGround });
        return kind ? { kind, at: pc.position, source: "player" } : null;
      }),
      combat.system.events.on((e) => {
        const n = combatNoise(e);
        if (n) this.system.noise.emit(n);
      }),
      combat.controls.events.on((e) => {
        if (e.type === "potion") this.system.noise.emit({ kind: "potion", at: pc.position, source: "player", seconds: 1.3 });
      }),
      world.onUpdate((dt) => this.update(dt)),
    );
    // the wind-ups' glint shader, ahead of the first swing
    void prepareGlints(world).catch(() => {});
  }

  get noise() {
    return this.system.noise;
  }

  get perception() {
    return this.system.perception;
  }

  /** Per frame: a landing is a noise; the AI thinks; the stealth eye follows the meters. */
  private update(dt: number) {
    if (this.disposed) return;
    const pc = this.player;
    if (!pc.onGround) this.air += dt;
    else {
      if (this.air > 0.35 && pc.enabled) this.system.noise.emit({ kind: "land", at: pc.position, source: "player" });
      this.air = 0;
    }
    this.system.update(dt);
    this.updateEye();
  }

  private updateEye() {
    let key: string | null = null;
    let k = 0;
    if (this.eye && this.player.enabled && !this.combat.player.vitals.dead) {
      k = this.system.perception.awareness();
      if (this.player.sneaking || k > 0) key = k.toFixed(2);
    }
    if (key === this.eyeShown) return;
    this.eyeShown = key;
    hud.stealth(key === null ? null : k);
  }

  /** Whether the camera sees `p` (a body's feet): catch-ups happen only out of view. */
  visible(p: XYZ) {
    const cam = this.world.rig.camera;
    const scene = cam.getScene();
    const f = this.frustum;
    if (f.frame !== scene.getFrameId()) {
      f.frame = scene.getFrameId();
      f.planes = Frustum.GetPlanes(cam.getTransformationMatrix());
    }
    const at = tmp.set(p.x, p.y + 0.9, p.z);
    return Vector3.Distance(cam.globalPosition, at) < 70 && Frustum.IsPointInFrustum(at, f.planes);
  }

  /** The leader the companion follows: the player. */
  leader(): Leader {
    const pc = this.player;
    return {
      position: () => pc.position,
      grounded: () => pc.onGround,
      moving: () => pc.speed > 0.3,
      sneaking: () => pc.sneaking,
      combatant: this.combat.player,
    };
  }

  // ------------------------------------------------------------------------------------ spawners

  /**
   * A human enemy (design §5.4, §8): a body of its faction's look armed with its archetype's
   * weapon (drawn), on a capsule, registered with the combat system, thinking with a
   * `HumanoidBrain`. `senses` gives it eyes and ears (§9) and a calm post to start at; without
   * them it starts in the fight (an encounter's enemies coming through a door).
   */
  async enemy(o: EnemySpec): Promise<AiActor> {
    const w = this.world;
    const ph = this.physics();
    const a = ARCHETYPES[o.archetype];
    this.claim(o.id);
    const ch = w.factory.create({ name: `ai_${o.id}`, ...(o.look ?? lookOf(o.faction, o.archetype)) });
    w.addShadowCasters(ch.meshes);
    const items = o.items ?? itemsOf(o.archetype);
    let equipment: Equipment | null = null;
    try {
      if (items.main || items.off) equipment = await armNpc(w, ch, items, { drawn: true });
    } catch (e) {
      console.warn(`ai ${o.id}: arming failed`, e);
    }
    if (this.disposed || w.disposed) {
      equipment?.dispose();
      ch.dispose();
      throw new Error("PrologueAI disposed");
    }
    const parts = this.parts(new CapsuleMover(ph, new Vector3(o.at.x, o.at.y, o.at.z)), () => {
      equipment?.dispose();
      ch.dispose();
    });
    try {
      const agent = parts.agent(new AgentMover({ mover: parts.mover, body: characterBody(ch), bus: w, crowd: this.system.crowd, yaw: o.at.yaw ?? 0 }));
      let brain: HumanoidBrain | undefined;
      const c = parts.combatant(
        this.combat.system.add({
          id: o.id,
          label: o.label ?? ENEMY_LABELS[o.archetype],
          faction: o.faction,
          position: () => agent.position,
          yaw: () => agent.yaw,
          awareness: () => brain?.awareness ?? "alert",
          damageMul: o.damageMul,
          windupRate: o.windupRate,
          ...combatantOf(a),
        }),
      );
      const corpse = new Corpse(w);
      const senses = o.senses === undefined || o.senses === false ? null : o.senses === true ? {} : o.senses;
      brain = parts.brain(
        new HumanoidBrain({
          combat: this.combat.system,
          self: c,
          agent,
          fighter: fighterOf(a),
          ai: this.system,
          los: ph,
          rootMotion: w.rootMotion,
          perception: senses ? this.system.perception : null,
          sensor: senses,
          post: o.post ?? (senses ? { x: o.at.x, y: o.at.y, z: o.at.z, yaw: o.at.yaw } : null),
          aware: o.aware,
          group: o.group ?? null,
          keys: [ch, o.id, ...(o.keys ?? [])],
          ragdoll:
            o.ragdoll === false
              ? undefined
              : (hit, done) => {
                  const d = hit?.dir ?? { x: 0, z: 0 };
                  corpse.fall(new Ragdoll(ph, ch, new Vector3(d.x * 3.5, 0.6, d.z * 3.5), "spine_02"), done);
                  return true;
                },
        }),
      );
      return this.track({ id: o.id, kind: "humanoid", combatant: c, brain, agent, body: ch, equipment, dispose: () => corpse.dispose() }, true);
    } catch (e) {
      parts.fail();
      throw e;
    }
  }

  /**
   * A creature (design §6.3: spiders, the wolf) from its manifest asset: null when the build lacks
   * the asset or it fails to load (the chapter goes on without it). The capsule scales with it.
   */
  async creature(o: CreatureSpec): Promise<AiActor | null> {
    const w = this.world;
    const ph = this.physics();
    const a = ARCHETYPES[o.archetype];
    const scale = o.scale ?? a.scale ?? 1;
    const asset = o.asset ?? SPIDER.asset;
    this.claim(o.id);
    const cr = await loadCreature(w, asset, o.profile ?? spiderProfile(`ai_${o.id}`, scale), { cloneMaterials: !!o.tint });
    if (!cr) return null;
    if (this.disposed || w.disposed) {
      cr.dispose();
      return null;
    }
    if (o.tint) for (const m of cr.meshes) tint(m.material, o.tint);
    const cap = o.capsule ?? { radius: SPIDER.capsule.radius * scale, height: SPIDER.capsule.height * scale };
    const parts = this.parts(new CapsuleMover(ph, new Vector3(o.at.x, o.at.y, o.at.z), { radius: Math.max(0.2, cap.radius), height: Math.max(cap.radius * 2 + 0.1, cap.height) }), () => cr.dispose());
    try {
      const body: AgentBody = { root: cr.root, play: (clip, p) => cr.play(clip, p), hasClip: (clip) => cr.has(clip), clipLength: (clip) => cr.clipLength(clip) };
      const agent = parts.agent(new AgentMover({ mover: parts.mover, body, bus: w, crowd: this.system.crowd, yaw: o.at.yaw ?? 0, gait: o.gait ?? spiderGait(), separation: Math.max(0.45, a.radius) }));
      let brain: CreatureBrain | undefined;
      const c = parts.combatant(
        this.combat.system.add({
          id: o.id,
          label: o.label ?? ENEMY_LABELS[o.archetype],
          faction: FACTION.beast,
          position: () => agent.position,
          yaw: () => agent.yaw,
          awareness: () => brain?.awareness ?? "alert",
          ...combatantOf(a),
        }),
      );
      const senses = o.senses === undefined || o.senses === false ? null : o.senses === true ? {} : o.senses;
      brain = parts.brain(
        new CreatureBrain({
          combat: this.combat.system,
          self: c,
          agent,
          fighter: fighterOf(a),
          ai: this.system,
          los: ph,
          perception: senses ? this.system.perception : null,
          sensor: senses,
          asleep: o.asleep,
          sleep: o.sleep ?? null,
          leash: o.leash ?? null,
          fear: o.fear ?? null,
          companion: o.companion ?? null,
          aware: o.aware,
          aggro: o.aggro,
          group: o.group ?? null,
          keys: [cr, o.id],
          clips: { death: [SPIDER.clips.death], backstabDeath: SPIDER.clips.death, idle: SPIDER.clips.idle, ...o.clips },
        }),
      );
      return this.track({ id: o.id, kind: "creature", combatant: c, brain, agent, body: null, creature: cr, equipment: null, dispose: () => cr.dispose() }, true);
    } catch (e) {
      parts.fail();
      throw e;
    }
  }

  /**
   * The companion (design §3.6, §7): an existing NPC body (Brun, or the scribe as 伊沃) on a
   * capsule, following the player's breadcrumbs, fighting with its special, essential. Disposing
   * it gives the body back to the world (which still owns it); `equipment` (its kit from
   * `armNpc`, e.g. Brun's axe drawn) goes with the actor.
   */
  companion(o: CompanionSpec): CompanionActor {
    const w = this.world;
    const ph = this.physics();
    const t = COMPANIONS[o.who === "scribe" ? "ivo" : o.who];
    const ch = o.body;
    const id = o.id ?? t.id;
    this.claim(id);
    // (the body is the world's: a failure leaves it where it is)
    const parts = this.parts(new CapsuleMover(ph, new Vector3(o.at.x, o.at.y, o.at.z)), () => {});
    try {
      const agent = parts.agent(new AgentMover({ mover: parts.mover, body: characterBody(ch), bus: w, crowd: this.system.crowd, yaw: o.at.yaw ?? 0 }));
      let brain: Companion | undefined;
      const c = parts.combatant(
        this.combat.system.add({
          id,
          label: o.label,
          faction: FACTION.player,
          position: () => agent.position,
          yaw: () => agent.yaw,
          awareness: () => brain?.awareness ?? "alert",
          ...companionCombatant(t),
        }),
      );
      const b = parts.brain(
        new Companion({
          combat: this.combat.system,
          self: c,
          agent,
          fighter: companionFighter(t),
          ai: this.system,
          los: ph,
          rootMotion: w.rootMotion,
          leader: this.leader(),
          visible: (p) => this.visible(p),
          special: t.special,
          keys: [ch, o.who, ...(o.keys ?? [])],
        }),
      );
      brain = b;
      const base = this.track({ id: c.id, kind: "companion", combatant: c, brain: b, agent, body: ch, equipment: o.equipment ?? null, dispose: () => {} }, false);
      const actor: CompanionActor = Object.assign(base, {
        brain: b,
        teleport: (m: Mark) => b.place({ x: m.x, y: m.y, z: m.z }, m.yaw),
        reset: () => b.reset(),
      });
      return actor;
    } catch (e) {
      parts.fail();
      throw e;
    }
  }

  /** The actors made here and not yet disposed. */
  get all(): readonly AiActor[] {
    return [...this.actors];
  }

  /** Hand an actor to a script (design §3.6 `ai.suspend(ch)`) until `resume`, or until `scope` ends. */
  suspend(key: unknown, o: { untilHit?: boolean; scope?: { add(fn: () => void): unknown } } = {}) {
    return this.system.suspend(key, o);
  }

  resume(key: unknown, state?: string) {
    return this.system.resume(key, state);
  }

  private physics(): Physics {
    const ph = this.world.physics;
    if (!ph || this.disposed) throw new Error("PrologueAI: no physics");
    return ph;
  }

  /** A combatant id must be free before anything is made for it (a re-spawn after a skip, a resume). */
  private claim(id: string) {
    if (this.combat.system.get(id)) throw new Error(`PrologueAI: "${id}" is already registered (dispose the old actor first)`);
  }

  /**
   * What a spawner has made so far, undone if a later step throws: the brain, the combatant, the
   * agent (or the bare capsule before there is one), then `owned` (the body, its equipment).
   */
  private parts(mover: CapsuleMover, owned: () => void) {
    let agent: AgentMover | null = null;
    let combatant: Combatant | null = null;
    let brain: CombatBrain | null = null;
    return {
      mover,
      agent: <A extends AgentMover>(a: A) => ((agent = a), a),
      combatant: (c: Combatant) => ((combatant = c), c),
      brain: <B extends CombatBrain>(b: B) => ((brain = b), b),
      fail: () => {
        for (const step of [
          () => brain?.dispose(),
          () => combatant && this.combat.system.remove(combatant),
          () => (agent ? agent.dispose() : mover.dispose()),
          owned,
        ]) {
          try {
            step();
          } catch (e) {
            console.error("PrologueAI: cleanup", e);
          }
        }
      },
    };
  }

  /** Wire an actor's events and its disposal (`ownsBody`: its body goes with it). */
  private track<A extends AiActor>(a: Omit<A, "disposed">, ownsBody: boolean): A {
    const actor = a as A;
    let done = false;
    const extra = a.dispose;
    const offEvents = actor.brain.events.on((event) => this.events.emit({ actor, event }));
    const off: Disposer = () => {
      if (done) return;
      done = true;
      this.actors.delete(actor);
      offEvents();
      actor.brain.dispose();
      this.combat.system.remove(actor.combatant);
      actor.agent.dispose();
      try {
        extra();
      } catch (e) {
        console.error(`ai ${actor.id}: dispose`, e);
      }
      actor.equipment?.dispose();
      if (ownsBody) actor.body?.dispose();
    };
    Object.defineProperty(actor, "disposed", { get: () => done });
    actor.dispose = off;
    this.actors.add(actor);
    actor.brain.events.on((e) => {
      if (this.disposed || this.world.disposed) return;
      // an archer's arrow is seen flying (the brain decides whether it lands); it stays stuck where
      // it arrived for 1.5 s of game time
      if (e.type === "shoot") {
        void shootArrow(this.world, new Vector3(e.from.x, e.from.y, e.from.z), () => new Vector3(e.to.x, e.to.y, e.to.z), ARROW.speed)
          .then(({ mesh }) => afterGameTime(this.world, 1.5, () => mesh.isDisposed() || mesh.dispose()))
          .catch(() => {});
      }
      // a wind-up's glint at the weapon (the bow, the brain's guess without one)
      if (e.type === "glint") {
        const at = new Vector3(e.at.x, e.at.y, e.at.z);
        const weapon = actor.equipment?.item("main") ?? null;
        glint(this.world, () => (actor.disposed ? null : (middleOf(weapon) ?? at)), { seconds: e.seconds });
      }
    });
    return actor;
  }

  dispose() {
    if (this.disposed) return;
    for (const a of [...this.actors]) a.dispose();
    this.disposed = true;
    for (const off of this.offs) off();
    this.offs = [];
    this.system.dispose();
    this.events.clear();
    if (this.eyeShown !== null) hud.stealth(null);
    this.eyeShown = null;
  }
}

const tmp = new Vector3();

/** Run `fn` after `seconds` of game time (it pauses and slows with the world). */
function afterGameTime(world: World, seconds: number, fn: () => unknown) {
  let left = seconds;
  const off = world.onUpdate((dt) => {
    left -= dt;
    if (left > 0) return;
    off();
    fn();
  });
}

/**
 * A ragdoll and its slot of the 2 at once: once the bodies come to rest (or after `maxSeconds`) it
 * is frozen (the bones keep their pose, the bodies and the bone drive go) and the slot is released.
 */
class Corpse {
  private ragdoll: Ragdoll | null = null;
  private release: Disposer | null = null;
  private off: (() => unknown) | null = null;

  constructor(
    private world: World,
    private o: { minSeconds?: number; maxSeconds?: number } = {},
  ) {}

  fall(r: Ragdoll, release: Disposer) {
    this.ragdoll = r;
    this.release = release;
    let t = 0;
    let next = this.o.minSeconds ?? 1.2;
    const max = this.o.maxSeconds ?? 8;
    this.off = this.world.onUpdate((dt) => {
      t += dt;
      if (t < next) return;
      next = t + 0.25;
      if (t >= max || r.settled()) this.freeze();
    });
  }

  private freeze() {
    this.off?.();
    this.off = null;
    try {
      this.ragdoll?.freeze();
    } catch (e) {
      console.error("ragdoll freeze", e);
    }
    this.release?.();
    this.release = null;
  }

  dispose() {
    this.off?.();
    this.off = null;
    this.ragdoll?.dispose();
    this.ragdoll = null;
    this.release?.();
    this.release = null;
  }
}

/** One fighter as the spawners make it: an `EncounterActor` (dispose it, or let its encounter). */
export interface AiActor extends EncounterActor {
  readonly id: string;
  readonly kind: "humanoid" | "creature" | "companion";
  readonly combatant: Combatant;
  readonly brain: CombatBrain;
  readonly agent: AgentMover;
  /** the humanoid body (null for creatures) */
  readonly body: Character | null;
  readonly creature?: Creature;
  readonly equipment: Equipment | null;
  readonly disposed: boolean;
  dispose(): void;
}

/** The companion: also the encounter's retry participant (`encounter(spec, { companion })`). */
export interface CompanionActor extends AiActor, EncounterParticipant {
  readonly brain: Companion;
  readonly combatant: Combatant;
  teleport(m: Mark): void;
  reset(): void;
}

export interface EnemySpec {
  /** the combatant id (unique among those registered) */
  id: string;
  archetype: ArchetypeId;
  faction: "imperial" | "rebel";
  /** feet and facing */
  at: Mark;
  /** the target bar's name (default `ENEMY_LABELS[archetype]`) */
  label?: string;
  /** what it looks like (default by faction and archetype) */
  look?: Omit<CharacterSpec, "name">;
  /** what it holds (default by archetype: sword / axe, a kite shield) */
  items?: { main?: "sword" | "axe" | null; off?: "shield" | null };
  /**
   * eyes and ears (§9; true: the defaults, or sensor overrides such as `{ sight: false }` for the
   * seated jailer who only hears until alerted); none (default): it starts in the fight
   */
  senses?: boolean | Partial<Omit<SensorSpec, "position" | "yaw">>;
  /** its calm place and what it does there (default where it starts, with senses) */
  post?: Post | null;
  /** start in the fight anyway (default: without senses) */
  aware?: boolean;
  /** one alert alerts the whole group, however far (an encounter's enemies) */
  group?: string;
  /** the content's damage multiplier (E1's tutorial opponent 0.8) and wind-up rate (0.5) */
  damageMul?: number;
  windupRate?: number;
  /** a ragdoll at death while the budget (2) allows (default true) */
  ragdoll?: boolean;
  /** extra keys `ai.suspend(key)` finds it by */
  keys?: unknown[];
}

export interface CreatureSpec {
  id: string;
  archetype: Extract<ArchetypeId, "smallSpider" | "giantSpider" | "wolf">;
  at: Mark;
  label?: string;
  /** manifest asset (default the spider) and its profile (default the spider's at the archetype's scale) */
  asset?: string;
  profile?: CreatureProfile;
  scale?: number;
  /** a body colour (own materials): small spiders brown, the giant black */
  tint?: [number, number, number];
  gait?: Gait;
  capsule?: { radius: number; height: number };
  clips?: Partial<BrainClips> & { idle?: string };
  /** a beast's ears (§9 "Wolf"), with overrides */
  senses?: boolean | Partial<Omit<SensorSpec, "position" | "yaw">>;
  asleep?: boolean;
  sleep?: SleepClips;
  leash?: Leash;
  /** what it shies away from (the companion's torch) */
  fear?: () => (XZ & { r?: number }) | null;
  /** the companion, which it turns on 30 % of the time */
  companion?: () => Combatant | null;
  aware?: boolean;
  /** without senses, turns on a foe this close inside its leash (m; default: leashed 6, else never) */
  aggro?: number | null;
  group?: string;
}

export interface CompanionSpec {
  who: "brun" | "scribe";
  /** its body (the world's NPC: `world.npc("brun")`) */
  body: Character;
  at: Mark;
  /** combatant id (default "brun" / "ivo") */
  id?: string;
  label?: string;
  keys?: unknown[];
  /** its kit (`armNpc(world, body, { main: "axe" }, { drawn: true })`): disposed with the actor */
  equipment?: Equipment | null;
}

/** A Character as an agent's body. */
function characterBody(ch: Character): AgentBody {
  return { root: ch.root, play: (clip, o) => ch.play(clip, o), hasClip: (clip) => ch.hasClip(clip), clipLength: (clip) => ch.clipLength(clip), lookAt: (p) => ch.lookAt(p) };
}

/** The default look of an enemy (design §1): imperials in the soldier kit, rebels in the ranger kit. */
export function lookOf(faction: "imperial" | "rebel", archetype: ArchetypeId): Omit<CharacterSpec, "name"> {
  if (archetype === "interrogator") return { outfit: [...OUTFITS.peasant.filter((p) => p !== "outfit_peasant_Feet"), "outfit_ranger_Arms_Bracer", "outfit_ranger_Feet_Boots"], hair: ["hair_buzzed", "hair_beard"] };
  if (archetype === "assistant") return { outfit: [...OUTFITS.peasant], hair: ["hair_simpleparted"] };
  if (faction === "imperial") return { outfit: [...OUTFITS.soldier], hair: [] };
  return archetype === "axeLeader" ? { outfit: [...OUTFITS.rebelLeader], hair: [] } : { outfit: [...OUTFITS.rebel], hair: ["hair_long", "hair_beard"] };
}

/** The default kit of an archetype (§8): its weapon if a model exists, and a kite shield. */
export function itemsOf(archetype: ArchetypeId): { main: "sword" | "axe" | null; off: "shield" | null } {
  const a = ARCHETYPES[archetype];
  return { main: a.weapon === "sword" || a.weapon === "axe" ? a.weapon : null, off: a.shield ? "shield" : null };
}

/** A spider's locomotion (§6.3): the walk clip at v / 2.6, backwards when backing off. */
export function spiderGait(): Gait {
  const walk = { clip: SPIDER.clips.walk, native: SPIDER.walkSpeed };
  return { idle: SPIDER.clips.idle, forward: [{ ...walk, below: Infinity }], back: { ...walk, reverse: true }, still: 0.12, minRate: 0.3 };
}

/** Tint a creature's (cloned) material. */
function tint(mat: unknown, rgb: [number, number, number]) {
  const m = mat as { albedoColor?: { set(r: number, g: number, b: number): void }; diffuseColor?: { set(r: number, g: number, b: number): void } } | null;
  m?.albedoColor?.set(...rgb);
  m?.diffuseColor?.set(...rgb);
}
