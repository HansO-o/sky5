import { test } from "node:test";
import assert from "node:assert/strict";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { AISystem, RagdollBudget } from "../../../../src/engine/ai/AISystem";
import { Brain } from "../../../../src/engine/ai/Brain";
import { AgentMover } from "../../../../src/engine/ai/AgentMover";
import { HumanoidBrain } from "../../../../src/engine/ai/HumanoidBrain";
import { Companion } from "../../../../src/engine/ai/Companion";
import { combatantOf, companionCombatant, companionFighter, fighterOf, type CombatBrain } from "../../../../src/engine/ai/CombatBrain";
import { ARCHETYPES, COMPANIONS, PLAYER } from "../../../../src/engine/combat/attacks";
import { CombatSystem } from "../../../../src/engine/combat/CombatSystem";
import { Vitals } from "../../../../src/engine/combat/vitals";
import { CapsuleMover } from "../../../../src/engine/physics/CapsuleMover";
import { newPhysics } from "../../helpers/jolt";
import { dist, fight, seeded } from "../../helpers/ai";
import { ROOT_MOTION_FIXTURE } from "../../helpers/rootMotionFixture";
import { RootMotionLibrary } from "../../../../src/engine/anim/rootMotion";
import { CreatureBrain } from "../../../../src/engine/ai/CreatureBrain";

test("ragdoll budget: 2 live at once; a slot frees only when its ragdoll is frozen or gone", () => {
  const b = new RagdollBudget(2);
  const first = b.take();
  const second = b.take();
  assert.ok(first && second);
  assert.equal(b.take(), null, "at the limit");
  assert.equal(b.active, 2);
  first();
  first();
  assert.equal(b.active, 1, "a release counts once");
  const third = b.take();
  assert.ok(third, "the first was frozen");
  assert.equal(b.take(), null);
  b.clear();
  assert.equal(b.active, 0);
  second();
  assert.equal(b.active, 0, "a stale release after a clear is harmless");
});

test("the registry: brains are found by combatant, id or key; brains think time-sliced; dispose stops them", () => {
  const f = fight();
  const key = {};
  const e = f.enemy("s1", "soldier", { x: 0, y: 0, z: -6 }, { keys: [key, "盾兵"] });
  assert.equal(f.ai.brainOf(e.c), e.brain);
  assert.equal(f.ai.brainOf("s1"), e.brain);
  assert.equal(f.ai.brainOf(key), e.brain);
  assert.equal(f.ai.brainOf("盾兵"), e.brain);
  assert.equal(f.ai.brainOf("nobody"), undefined);
  assert.deepEqual(f.ai.brains, [e.brain]);

  // 30 brains at 10 Hz with at most 12 a frame: each still thinks ~10 times a second
  const ai = new AISystem({ maxPerFrame: 12 });
  const counts = new Array(30).fill(0);
  counts.forEach((_, i) => ai.add({ think: () => void counts[i]++ }));
  for (let i = 0; i < 60; i++) ai.update(1 / 60);
  for (const n of counts) assert.ok(n >= 9 && n <= 11, `thought ${n} times`);
  // a bare state machine is added the same way (engine-framework §2.19 `AISystem.add(brain)`)
  let ticks = 0;
  const fsm = new Brain<null>({ idle: { update: () => void ticks++ } }, "idle", null);
  const off = ai.add(fsm, { hz: 5 });
  for (let i = 0; i < 60; i++) ai.update(1 / 60);
  assert.ok(ticks >= 4 && ticks <= 6, `updated ${ticks} times at 5 Hz`);
  off();
  ai.maxBrainsPerFrame = 2;
  counts.fill(0);
  for (let i = 0; i < 60; i++) ai.update(1 / 60);
  assert.ok(counts.every((n) => n >= 3) && counts.reduce((a, b) => a + b, 0) <= 120, "the budget caps a frame; nobody starves");

  f.ai.dispose();
  const at = e.brain.state;
  f.run(1);
  assert.equal(e.brain.state, at, "disposed brains stop");
  assert.equal(f.ai.brains.length, 0);
});

test("on Jolt capsules: two soldiers and Brun fight it out on a floor; nobody stays stuck, the fight resolves", async () => {
  const ph = await newPhysics();
  const rnd = seeded(3);
  ph.addBox(new Vector3(0, -0.5, 0), new Vector3(30, 0.5, 30));
  // walls 18 m out (the fight may drift while they circle)
  for (const [x, z, hx, hz] of [[0, -18, 18, 0.3], [0, 18, 18, 0.3], [-18, 0, 0.3, 18], [18, 0, 0.3, 18]]) ph.addBox(new Vector3(x, 1, z), new Vector3(hx, 1, hz));
  const updaters = new Set<(dt: number) => void>();
  const bus = { onUpdate: (fn: (dt: number) => void) => (updaters.add(fn), () => updaters.delete(fn)) };
  const combat = new CombatSystem({ hostile: { player: ["enemy"] }, los: ph, clock: ph, random: (() => {
    let a = 3;
    return () => ((a = (a * 16807) % 2147483647) / 2147483647);
  })() });
  const ai = new AISystem({ los: ph });
  // the player stands still at the origin
  const pl = { x: 0, y: 0, z: 0 };
  const player = combat.add({ id: "player", faction: "player", vitals: new Vitals({ health: 100000, poise: 1e6 }), position: () => pl, yaw: () => Math.PI, tokens: PLAYER.tokens, radius: PLAYER.radius });
  combat.focus = player;
  const brains: CombatBrain[] = [];
  const agents: AgentMover[] = [];
  function mover(at: { x: number; z: number }, yaw: number) {
    const a = new AgentMover({ mover: new CapsuleMover(ph, new Vector3(at.x, 0.05, at.z)), bus, crowd: ai.crowd, yaw });
    agents.push(a);
    return a;
  }
  for (const [i, x] of [-3, 3].entries()) {
    const agent = mover({ x, z: -10 }, 0);
    const a = ARCHETYPES.soldier;
    let brain: HumanoidBrain | undefined;
    const c = combat.add({ id: `s${i}`, faction: "enemy", position: () => agent.position, yaw: () => agent.yaw, awareness: () => brain?.awareness ?? "alert", ...combatantOf(a) });
    brain = new HumanoidBrain({ combat, self: c, agent, fighter: fighterOf(a), ai, los: ph, random: rnd });
    brains.push(brain);
  }
  {
    const agent = mover({ x: 1.5, z: 2 }, Math.PI);
    const t = COMPANIONS.brun;
    let brain: Companion | undefined;
    const c = combat.add({ id: "brun", faction: "player", position: () => agent.position, yaw: () => agent.yaw, awareness: () => brain?.awareness ?? "alert", ...companionCombatant(t) });
    brain = new Companion({
      combat,
      self: c,
      agent,
      fighter: companionFighter(t),
      ai,
      los: ph,
      special: t.special,
      random: rnd,
      leader: { position: () => pl, grounded: () => true, moving: () => false, sneaking: () => false, combatant: player },
    });
    brains.push(brain);
  }
  const dt = 1 / 60;
  let worstStuck = 0;
  let t = 0;
  const enemies = brains.slice(0, 2);
  for (; t < 120 && enemies.some((b) => !b.self.defeated); t += dt) {
    ph.update(dt);
    for (const fn of updaters) fn(dt);
    ai.update(dt);
    for (const a of agents) if (!a.released) worstStuck = Math.max(worstStuck, a.stuckFor);
  }
  assert.ok(enemies.every((b) => b.self.defeated), `Brun won within 120 s (t ${t.toFixed(1)}, hp ${enemies.map((b) => b.self.vitals.hp).join("/")})`);
  assert.ok(player.vitals.hp < 100000, "the soldiers got their turns at the player");
  assert.ok(worstStuck < 2, `nobody stuck (worst ${worstStuck.toFixed(2)} s)`);
  for (const a of agents.slice(0, 2)) assert.ok(a.released, "the dead let go of their capsules");
  const brun = agents[2];
  assert.ok(brun.position.y > -0.2 && brun.position.y < 0.3, "on the floor");
  assert.ok(dist(brun.position, pl) < 30);
  ai.dispose();
  for (const a of agents) a.dispose();
  combat.dispose();
  ph.dispose();
});

test("on Jolt capsules: the axeman's lunge rides Sword_Dash_RM at full speed and lands; a spider's leap lands; neither runs into the player", async () => {
  const ph = await newPhysics();
  ph.addBox(new Vector3(0, -0.5, 0), new Vector3(30, 0.5, 30));
  const updaters = new Set<(dt: number) => void>();
  const bus = { onUpdate: (fn: (dt: number) => void) => (updaters.add(fn), () => updaters.delete(fn)) };
  const combat = new CombatSystem({ hostile: { player: ["enemy", "beast"] }, los: ph, clock: ph, random: seeded(5) });
  const ai = new AISystem({ los: ph });
  // the player stands still on a capsule of its own at the origin, facing −Z
  const plMover = new CapsuleMover(ph, new Vector3(0, 0.05, 0), { radius: PLAYER.radius });
  const player = combat.add({ id: "player", faction: "player", vitals: new Vitals({ health: 1000, poise: 1e6 }), position: () => plMover.position, yaw: () => 0, tokens: PLAYER.tokens, radius: PLAYER.radius });
  combat.focus = player;
  const lib = RootMotionLibrary.parse(ROOT_MOTION_FIXTURE);
  const hits: string[] = [];
  combat.events.on((e) => {
    if (e.type === "hit" && e.hit.target === player && e.hit.outcome === "hit") hits.push(e.hit.attack.id);
  });
  const dt = 1 / 60;
  const step = (seconds: number, until?: () => boolean) => {
    for (let t = 0; t < seconds; t += dt) {
      ph.update(dt);
      for (const fn of updaters) fn(dt);
      ai.update(dt);
      if (until?.()) return;
    }
  };
  // the axeman 4.6 m out, facing the player
  const agent = new AgentMover({ mover: new CapsuleMover(ph, new Vector3(0, 0.05, -4.6)), bus, crowd: ai.crowd, yaw: Math.PI });
  const a = ARCHETYPES.axeman;
  let brain: HumanoidBrain | undefined;
  const c = combat.add({ id: "axe", faction: "enemy", position: () => agent.position, yaw: () => agent.yaw, awareness: () => brain?.awareness ?? "alert", ...combatantOf(a) });
  brain = new HumanoidBrain({ combat, self: c, agent, fighter: fighterOf(a), ai, los: ph, random: seeded(2), rootMotion: lib });
  step(1, () => c.swing?.attack.id === "axe_lunge");
  assert.equal(c.swing?.attack.id, "axe_lunge");
  let fastest = 0;
  const swing = c.swing!;
  step(2, () => {
    fastest = Math.max(fastest, agent.speed);
    return swing.finished;
  });
  assert.deepEqual(hits, ["axe_lunge"], "the lunge landed");
  assert.ok(fastest > 8, `rode the dash uncapped (peak ${fastest.toFixed(1)} m/s)`);
  assert.ok(dist(agent.position, plMover.position) >= 0.8, `stopped short of the player (${dist(agent.position, plMover.position).toFixed(2)} m)`);
  brain.dispose();
  combat.remove(c);
  agent.dispose();

  // a small spider 4.5 m out: it leaps
  const sa = new AgentMover({ mover: new CapsuleMover(ph, new Vector3(4.5, 0.05, 0), { radius: 0.44, height: 0.95 }), bus, crowd: ai.crowd, yaw: -Math.PI / 2, gait: null, separation: 0.45 });
  const sp = ARCHETYPES.smallSpider;
  let sb: CreatureBrain | undefined;
  const sc = combat.add({ id: "spider", faction: "beast", position: () => sa.position, yaw: () => sa.yaw, awareness: () => sb?.awareness ?? "alert", ...combatantOf(sp) });
  sb = new CreatureBrain({ combat, self: sc, agent: sa, fighter: fighterOf(sp), ai, los: ph, random: seeded(4) });
  step(1, () => sc.swing?.attack.id === "spider_lunge");
  assert.equal(sc.swing?.attack.id, "spider_lunge");
  const leap = sc.swing!;
  step(2, () => leap.finished);
  assert.deepEqual(hits, ["axe_lunge", "spider_lunge"], "the leap landed");
  assert.ok(dist(sa.position, plMover.position) >= 0.85, "in front of the player, not on it");
  ai.dispose();
  sa.dispose();
  plMover.dispose();
  combat.dispose();
  ph.dispose();
});
