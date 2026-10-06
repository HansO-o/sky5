// A headless fight for brain tests: a real CombatSystem and AISystem, kinematic agents on a flat
// floor (no physics), and a "player" whose pose the test moves.
import { CombatSystem, type CombatEvent, type Combatant, type CombatantSpec } from "../../../src/engine/combat/CombatSystem";
import { ARCHETYPES, COMPANIONS, PLAYER, type ArchetypeId } from "../../../src/engine/combat/attacks";
import { Vitals } from "../../../src/engine/combat/vitals";
import { KinematicAgent } from "../../../src/engine/ai/agent";
import { AISystem } from "../../../src/engine/ai/AISystem";
import { combatantOf, companionCombatant, companionFighter, fighterOf, type BrainEvent, type CombatBrain } from "../../../src/engine/ai/CombatBrain";
import { HumanoidBrain, type HumanoidBrainOptions } from "../../../src/engine/ai/HumanoidBrain";
import { CreatureBrain, type CreatureBrainOptions } from "../../../src/engine/ai/CreatureBrain";
import { Companion, type CompanionOptions } from "../../../src/engine/ai/Companion";
import type { XYZ } from "../../../src/engine/combat/hit";

export const STEP = 1 / 60;

/** A small deterministic generator (mulberry32). */
export function seeded(seed = 1) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface Actor<B extends CombatBrain = CombatBrain> {
  c: Combatant;
  agent: KinematicAgent;
  brain: B;
  /** brain events so far */
  events: BrainEvent[];
  /** states entered so far, in order */
  states: string[];
}

export interface PlayerPose {
  p: XYZ;
  yaw: number;
  sneaking: boolean;
  moving: boolean;
  grounded: boolean;
  hidden: boolean;
}

/**
 * The fight: `player` (faction "player") vs `enemy` and `beast` factions. `random` feeds both the
 * combat system and the brains (default: a seeded generator).
 */
export function fight(o: { random?: () => number; playerHp?: number } = {}) {
  const random = o.random ?? seeded(7);
  const combat = new CombatSystem({ hostile: { player: ["enemy", "beast"] }, random });
  const ai = new AISystem();
  const actors: Actor[] = [];
  const agents = new Set<KinematicAgent>();
  const combatEvents: CombatEvent[] = [];
  combat.events.on((e) => combatEvents.push(e));
  const pl: PlayerPose = { p: { x: 0, y: 0, z: 0 }, yaw: 0, sneaking: false, moving: false, grounded: true, hidden: false };
  const player = combat.add({
    id: "player",
    faction: "player",
    vitals: new Vitals({ health: o.playerHp ?? 100, poise: PLAYER.poise }),
    position: () => pl.p,
    yaw: () => pl.yaw,
    canParry: true,
    tokens: PLAYER.tokens,
    radius: PLAYER.radius,
  });
  combat.focus = player;
  ai.perception.addTarget({ id: "player", position: () => pl.p, sneaking: () => pl.sneaking, moving: () => pl.moving, hidden: () => pl.hidden });

  function track<B extends CombatBrain>(c: Combatant, agent: KinematicAgent, brain: B): Actor<B> {
    const a: Actor<B> = { c, agent, brain, events: [], states: [brain.state] };
    brain.events.on((e) => {
      a.events.push(e);
      if (e.type === "state") a.states.push(e.to);
    });
    actors.push(a as unknown as Actor);
    return a;
  }

  function body(at: XYZ & { yaw?: number }) {
    const agent = new KinematicAgent(at, at.yaw ?? 0, { crowd: ai.crowd });
    agents.add(agent);
    return agent;
  }

  function spec(id: string, faction: string, agent: KinematicAgent, brain: () => CombatBrain | undefined, extra: Partial<CombatantSpec>): CombatantSpec {
    return {
      id,
      faction,
      position: () => agent.position,
      yaw: () => agent.yaw,
      awareness: () => brain()?.awareness ?? "alert",
      vitals: new Vitals({ health: 100 }),
      ...extra,
    };
  }

  /** A humanoid enemy of `archetype` at `at`. */
  function enemy(id: string, archetype: ArchetypeId, at: XYZ & { yaw?: number }, opts: Partial<HumanoidBrainOptions> & { faction?: string; perceive?: boolean } = {}) {
    const a = ARCHETYPES[archetype];
    const agent = body(at);
    let brain: HumanoidBrain | undefined;
    const c = combat.add(spec(id, opts.faction ?? "enemy", agent, () => brain, combatantOf(a)));
    brain = new HumanoidBrain({ combat, self: c, agent, fighter: fighterOf(a), ai, random, perception: opts.perceive ? ai.perception : null, ...opts });
    return track(c, agent, brain);
  }

  /** A creature of `archetype` at `at`. */
  function creature(id: string, archetype: ArchetypeId, at: XYZ & { yaw?: number }, opts: Partial<CreatureBrainOptions> & { perceive?: boolean } = {}) {
    const a = ARCHETYPES[archetype];
    const agent = body(at);
    let brain: CreatureBrain | undefined;
    const c = combat.add(spec(id, "beast", agent, () => brain, combatantOf(a)));
    brain = new CreatureBrain({ combat, self: c, agent, fighter: fighterOf(a), ai, random, perception: opts.perceive ? ai.perception : null, ...opts });
    return track(c, agent, brain);
  }

  /** The companion (Brun or Ivo) following the player. */
  function companion(who: "brun" | "ivo", at: XYZ & { yaw?: number }, opts: Partial<CompanionOptions> = {}) {
    const t = COMPANIONS[who];
    const agent = body(at);
    let brain: Companion | undefined;
    const c = combat.add(spec(who, "player", agent, () => brain, companionCombatant(t)));
    brain = new Companion({
      combat,
      self: c,
      agent,
      fighter: companionFighter(t),
      ai,
      random,
      special: t.special,
      leader: { position: () => pl.p, grounded: () => pl.grounded, moving: () => pl.moving, sneaking: () => pl.sneaking, combatant: player },
      ...opts,
    });
    return track(c, agent, brain);
  }

  /** Run `seconds` of frames: agents move, combat steps, the AI thinks; `each` after every frame. */
  function run(seconds: number, each?: (t: number) => boolean | void) {
    const n = Math.round(seconds / STEP);
    for (let i = 0; i < n; i++) {
      for (const a of agents) a.step(STEP);
      combat.step(STEP);
      ai.update(STEP);
      if (each?.((i + 1) * STEP)) return (i + 1) * STEP;
    }
    return seconds;
  }

  /** Run until `cond` holds (or `max` seconds pass); returns the seconds it took (Infinity: never). */
  function until(cond: () => boolean, max = 10) {
    const t = run(max, () => cond());
    return cond() ? t : Infinity;
  }

  /** Move the player along (dx, dz) at `speed` for `seconds` (moving and footsteps follow). */
  function walk(dx: number, dz: number, speed: number, seconds: number, each?: (t: number) => boolean | void) {
    const l = Math.hypot(dx, dz) || 1;
    pl.moving = true;
    const t = run(seconds, (t) => {
      pl.p.x += (dx / l) * speed * STEP;
      pl.p.z += (dz / l) * speed * STEP;
      return each?.(t);
    });
    pl.moving = false;
    return t;
  }

  return { combat, ai, player, pl, actors, combatEvents, enemy, creature, companion, run, until, walk, random };
}

export const dist = (a: { x: number; z: number }, b: { x: number; z: number }) => Math.hypot(a.x - b.x, a.z - b.z);
