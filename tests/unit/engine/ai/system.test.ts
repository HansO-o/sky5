import { test } from "node:test";
import assert from "node:assert/strict";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { AISystem, RagdollBudget } from "../../../../src/engine/ai/AISystem";
import { AgentMover } from "../../../../src/engine/ai/AgentMover";
import { HumanoidBrain } from "../../../../src/engine/ai/HumanoidBrain";
import { Companion } from "../../../../src/engine/ai/Companion";
import { combatantOf, companionCombatant, companionFighter, fighterOf, type CombatBrain } from "../../../../src/engine/ai/CombatBrain";
import { ARCHETYPES, COMPANIONS, PLAYER } from "../../../../src/engine/combat/attacks";
import { CombatSystem } from "../../../../src/engine/combat/CombatSystem";
import { Vitals } from "../../../../src/engine/combat/vitals";
import { CapsuleMover } from "../../../../src/engine/physics/CapsuleMover";
import { newPhysics } from "../../helpers/jolt";
import { dist, fight } from "../../helpers/ai";

test("ragdoll budget: 2 at once; a slot frees once a body has had its time to settle", () => {
  const b = new RagdollBudget(2, 6);
  assert.ok(b.take());
  b.update(1);
  assert.ok(b.take());
  assert.equal(b.take(), false);
  b.update(5.01);
  assert.ok(b.take(), "the first settled");
  assert.equal(b.take(), false);
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
  ph.addBox(new Vector3(0, -0.5, 0), new Vector3(30, 0.5, 30));
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
    brain = new HumanoidBrain({ combat, self: c, agent, fighter: fighterOf(a), ai, los: ph });
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
