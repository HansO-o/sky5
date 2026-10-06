import { test } from "node:test";
import assert from "node:assert/strict";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { BEAST_HEARING, NoiseBus, combatNoise, footstepNoise } from "../../../../src/engine/ai/noise";
import { BEAST, PERCEPTION, Perception, beastRate, createPerception, hearRate, hearingDistance, inCone, levelOf, sightRate, type PerceptionTarget } from "../../../../src/engine/ai/Perception";

const near = (a: number, b: number, eps = 1e-6) => Math.abs(a - b) <= eps;

test("rates (§9): sight, hearing, the beast's meter", () => {
  assert.ok(near(sightRate(7.5), 0.5));
  assert.ok(near(sightRate(7.5, { sneaking: true }), 0.5 * 0.35));
  assert.ok(near(sightRate(7.5, { moving: true }), 0.5 * 1.3));
  assert.ok(near(sightRate(7.5, { light: 0.1 }), 0.25));
  assert.ok(near(sightRate(7.5, { light: 0.2 }), 0.5));
  assert.equal(sightRate(15), 0);
  assert.equal(sightRate(20), 0);
  assert.ok(near(hearRate(4, 8), 0.45));
  assert.equal(hearRate(9, 8), 0);
  // the wolf on the den path (§9 "Check"): walking past at 6 m gains about +0.1/s net
  const walk = BEAST_HEARING.walk;
  assert.ok(near(beastRate(6, walk.r, walk.w) - BEAST.decay, 0.1));
  // running at the closest approach (5.5 m) wakes it in about 2 s
  const run = BEAST_HEARING.run;
  const t = 1 / (beastRate(5.5, run.r, run.w) - BEAST.decay);
  assert.ok(t > 1.8 && t < 2.2, `${t}`);
  // sneaking never wakes it there
  assert.equal(beastRate(5.5, BEAST_HEARING.sneak.r, BEAST_HEARING.sneak.w), 0);
  // the satchel (2.1 m) over a pick-up of about 1.1 s adds about 0.27
  const pick = BEAST_HEARING.pickup;
  assert.ok(Math.abs(beastRate(2.1, pick.r, pick.w) * 1.15 - 0.27) < 0.02);
});

test("cones, levels and footsteps", () => {
  // looking along −Z (yaw 0)
  assert.ok(inCone({ x: 0, z: 0 }, 0, { x: 0, z: -5 }, 110));
  assert.ok(inCone({ x: 0, z: 0 }, 0, { x: 3, z: -3 }, 110));
  assert.ok(!inCone({ x: 0, z: 0 }, 0, { x: 5, z: -1 }, 110));
  assert.ok(inCone({ x: 0, z: 0 }, 0, { x: 5, z: -1 }, 160));
  assert.ok(!inCone({ x: 0, z: 0 }, 0, { x: 0, z: 5 }, 160));
  assert.equal(levelOf(0.4, "unaware"), "unaware");
  assert.equal(levelOf(0.5, "unaware"), "suspicious");
  assert.equal(levelOf(0.4, "suspicious"), "suspicious");
  assert.equal(levelOf(0.3, "suspicious"), "unaware");
  assert.equal(levelOf(1, "suspicious"), "alert");
  assert.equal(levelOf(0, "alert"), "alert");
  assert.equal(levelOf(0.35, "suspicious", "beast"), "suspicious");
  assert.equal(levelOf(0.25, "suspicious", "beast"), "unaware");
  assert.equal(footstepNoise({ speed: 0.1, sneaking: false, grounded: true }), null);
  assert.equal(footstepNoise({ speed: 1.4, sneaking: true, grounded: true }), "sneak");
  assert.equal(footstepNoise({ speed: 1.9, sneaking: false, grounded: true }), "walk");
  assert.equal(footstepNoise({ speed: 3.9, sneaking: false, grounded: true }), "run");
  assert.equal(footstepNoise({ speed: 6.2, sneaking: false, grounded: true }), "sprint");
  assert.equal(footstepNoise({ speed: 3.9, sneaking: false, sprinting: true, grounded: true }), "sprint");
  assert.equal(footstepNoise({ speed: 3.9, sneaking: false, grounded: false }), null);
});

test("noise bus: momentary noises by overlap with the span asked about, steady sources for all of it", () => {
  const bus = new NoiseBus();
  bus.emit({ kind: "land", at: { x: 0, y: 0, z: 0 }, seconds: 0.5 });
  bus.emit({ kind: "bone", at: { x: 0, y: 0, z: 0 }, seconds: 0 });
  bus.update(0.2);
  let total = 0;
  const started: string[] = [];
  const seen = bus.heard(-1, (n, s, st) => {
    total += s;
    if (st) started.push(n.kind);
  });
  assert.ok(near(total, 0.2));
  assert.deepEqual(started.sort(), ["bone", "land"]);
  // the next span starts where the last one ended: the one-shots are not new any more
  bus.update(0.4);
  total = 0;
  started.length = 0;
  bus.heard(0.2, (_n, s, st) => {
    total += s;
    if (st) started.push(_n.kind);
  }, seen);
  assert.ok(near(total, 0.3));
  assert.deepEqual(started, []);
  const off = bus.source(() => ({ kind: "walk", at: { x: 1, y: 0, z: 1 } }));
  bus.update(3);
  const kinds: string[] = [];
  bus.heard(bus.time - 0.2, (n, s) => kinds.push(`${n.kind} ${s.toFixed(1)}`));
  assert.deepEqual(kinds, ["walk 0.2"]);
  off();
  kinds.length = 0;
  bus.heard(bus.time - 0.2, (n) => kinds.push(n.kind));
  assert.deepEqual(kinds, []);
});

/** A player walking about, a sensor at the origin looking along −Z, and an optional wall. */
function scene(o: { wall?: boolean; kind?: "human" | "beast"; sight?: boolean } = {}) {
  const noise = new NoiseBus();
  const los = {
    rays: 0,
    rayCastStatic(from: Vector3, dir: Vector3, max: number) {
      this.rays++;
      // a wall across z = −4 when `wall`
      if (!o.wall || dir.z >= 0) return Infinity;
      const t = (-4 - from.z) / dir.z;
      return t > 0 && t < max ? t : Infinity;
    },
  };
  const per = new Perception({ noise, los });
  const player = { x: 0, y: 0, z: -8, sneaking: false, moving: false, light: 1 };
  const target: PerceptionTarget = {
    id: "player",
    position: () => player,
    sneaking: () => player.sneaking,
    moving: () => player.moving,
    light: () => player.light,
  };
  per.addTarget(target);
  const s = per.addSensor({ id: "guard", kind: o.kind ?? "human", sight: o.sight, position: () => ({ x: 0, y: 0, z: 0 }), yaw: () => 0 });
  const run = (seconds: number, dt = 1 / 60) => {
    for (let t = 0; t < seconds - 1e-9; t += dt) {
      noise.update(dt);
      per.update(dt);
    }
  };
  return { noise, per, s, player, run, los };
}

test("a guard notices a player standing in front: suspicious, then alert; a wall hides them", () => {
  const a = scene();
  // 8 m ahead: sight (1 − 8.4/15) ≈ 0.44 − 0.15 decay ≈ 0.29/s net
  a.run(1);
  assert.equal(a.s.level, "unaware");
  a.run(1.5);
  assert.equal(a.s.level, "suspicious");
  a.run(2);
  assert.equal(a.s.level, "alert");
  assert.deepEqual(a.s.lastSeen, { x: 0, y: 0, z: -8 });
  // alert holds
  a.player.z = 30;
  a.run(3);
  assert.equal(a.s.level, "alert");

  const w = scene({ wall: true });
  w.run(5);
  assert.equal(w.s.level, "unaware");
  assert.ok(w.los.rays > 0);

  // behind the guard: never seen; sneaking in the dark in front at 8 m: never either
  const b = scene();
  b.player.z = 8;
  b.run(5);
  assert.equal(b.s.meter, 0);
  const d = scene();
  d.player.sneaking = true;
  d.player.light = 0.1;
  d.run(8);
  assert.equal(d.s.level, "unaware");
});

test("hearing: footsteps raise suspicion with the last noise remembered; it fades again", () => {
  const a = scene({ sight: false });
  a.player.z = 3;
  // running 3 m away (behind): (1 − 3/12) × 0.9 = 0.675/s
  const off = a.noise.source(() => ({ kind: "run", at: a.player }));
  a.run(1.5);
  assert.equal(a.s.level, "suspicious");
  assert.deepEqual(a.s.lastNoise, { x: 0, y: 0, z: 3 });
  off();
  a.run(4);
  assert.equal(a.s.level, "unaware");
  // a clash 10 m away carries (radius 20)
  a.noise.emit({ kind: "clash", at: { x: 10, y: 1, z: 0 }, seconds: 2 });
  a.run(2);
  assert.ok(a.s.meter > 0.5);
});

test("hearing is measured on the ground plane: §9's radii are plain distances (a storey up is further)", () => {
  const feet = { x: 0, y: 0, z: 0 };
  assert.equal(hearingDistance(feet, { x: 1.9, y: 0, z: 0 }), 1.9);
  assert.equal(hearingDistance(feet, { x: 0, y: 1.2, z: -1.9 }), 1.9, "a clash at chest height");
  assert.ok(near(hearingDistance(feet, { x: 3, y: 6, z: 0 }), 5), "a floor up: the height beyond 2 m counts");
  // a guard hears a sneak-move 1.9 m away (its eye 1.6 m up does not shrink the 2 m radius), not 2.1 m
  for (const [z, heard] of [[1.9, true], [2.1, false]] as const) {
    const a = scene({ sight: false });
    a.player.z = z;
    a.noise.source(() => ({ kind: "sneak", at: a.player }));
    a.run(1);
    assert.equal(a.s.lastNoise !== null, heard, `a sneak-move at ${z} m`);
  }
  // the wolf hears a sneak-move out to 3 m (on the ground: its eye height does not count)
  const meterAfter = (z: number, noisy: boolean) => {
    const w = scene({ kind: "beast" });
    w.player.z = z;
    w.player.sneaking = true;
    w.s.meter = 0.2;
    if (noisy) w.noise.source(() => ({ kind: "sneak", at: w.player }));
    w.run(2);
    assert.equal(w.s.level, "unaware", "sneaking never wakes it");
    return w.s.meter;
  };
  assert.ok(meterAfter(-2.8, true) - meterAfter(-2.8, false) > 0.02, "heard at 2.8 m");
  assert.equal(meterAfter(-3.2, true), meterAfter(-3.2, false), "not at 3.2 m");
});

test("beast sensor: noise only; stir and settle; too close or a clash nearby wakes it at once; a bone step adds 0.35 once", () => {
  const w = scene({ kind: "beast" });
  w.player.z = -6;
  // in plain view at 6 m: beasts don't look
  w.run(3);
  assert.equal(w.s.meter, 0);
  const off = w.noise.source(() => ({ kind: "walk", at: w.player }));
  w.run(6);
  assert.equal(w.s.level, "suspicious");
  off();
  w.run(5);
  assert.equal(w.s.level, "unaware");
  w.s.calm();
  w.noise.emit({ kind: "bone", at: { x: 0, y: 0, z: -3 }, seconds: 0 });
  w.run(0.5);
  assert.ok(near(w.s.meter, 0.35 - 0.1 * 0.5, 0.03), `${w.s.meter}`);
  w.s.calm();
  // within 3 m walking (2 m sneaking): awake
  w.player.z = -2.5;
  w.player.sneaking = true;
  w.run(0.5);
  assert.equal(w.s.level, "unaware");
  w.player.sneaking = false;
  w.run(0.5);
  assert.equal(w.s.level, "alert");
  const c = scene({ kind: "beast" });
  c.player.z = -30;
  c.noise.emit({ kind: "clash", at: { x: 0, y: 1, z: -11 } });
  c.run(0.4);
  assert.equal(c.s.level, "alert");
});

test("perception: 5 looks a second per sensor, at most 4 rays a frame", () => {
  const noise = new NoiseBus();
  let rays = 0;
  let frameRays = 0;
  const per = new Perception({ noise, los: { rayCastStatic: () => (rays++, frameRays++, Infinity) } });
  per.addTarget({ id: "p", position: () => ({ x: 0, y: 0, z: -5 }), sneaking: () => false, moving: () => false });
  // twelve guards in a row all looking at the player
  for (let i = 0; i < 12; i++) per.addSensor({ id: `g${i}`, position: () => ({ x: (i - 6) * 0.3, y: 0, z: 0 }), yaw: () => 0 });
  let maxFrame = 0;
  for (let f = 0; f < 120; f++) {
    frameRays = 0;
    noise.update(1 / 60);
    per.update(1 / 60);
    maxFrame = Math.max(maxFrame, frameRays);
  }
  assert.ok(maxFrame <= PERCEPTION.raysPerFrame, `rays in a frame ${maxFrame}`);
  // 2 s × 5 Hz × 12 sensors = 120 looks wanted; the budget allows 4 × 120 frames
  assert.ok(rays >= 100 && rays <= 125, `rays ${rays}`);
  assert.ok(per.awareness() > 0);
});

test("combat noise: blows clash, swings swing, backstabs are silent", () => {
  const c = (id: string) => ({ id, pose: { x: 1, y: 0, z: 2, yaw: 0 } }) as never;
  const hit = (outcome: string) => ({ type: "hit", hit: { outcome, attacker: c("a"), target: c("t"), attack: { ranged: false }, point: { x: 1, y: 1.2, z: 2 } } }) as never;
  assert.equal(combatNoise(hit("blocked"))?.kind, "clash");
  assert.equal(combatNoise(hit("hit"))?.kind, "clash");
  assert.equal(combatNoise(hit("backstab")), null);
  assert.equal(combatNoise({ type: "swing", attacker: c("a"), attack: { ranged: false } } as never)?.kind, "swing");
  assert.equal(combatNoise({ type: "miss" } as never), null);
});

test("a sensor switched off hears nothing meanwhile: switched on again it starts from then, not with the whole span at once", () => {
  const a = scene({ sight: false });
  a.player.z = 3;
  // running 3 m behind it the whole time: 0.675/s while it listens
  a.noise.source(() => ({ kind: "run", at: a.player }));
  a.s.enabled = false;
  a.run(10);
  assert.equal(a.s.meter, 0);
  a.s.enabled = true;
  a.s.calm();
  a.run(0.25);
  assert.ok(a.s.meter < 0.2, `one look's worth, not 10 s of it (${a.s.meter.toFixed(2)})`);
  assert.equal(a.s.level, "unaware");
  // and it does hear from then on
  a.run(1.2);
  assert.equal(a.s.level, "suspicious");
});

test("canSee and createPerception (engine-framework §2.19): range, cone, static occlusion", () => {
  const wall = {
    rayCastStatic(from: Vector3, dir: Vector3, max: number) {
      // a wall across x = 3
      if (dir.x <= 0) return Infinity;
      const t = (3 - from.x) / dir.x;
      return t > 0 && t < max ? t : Infinity;
    },
  };
  const per = createPerception(wall);
  assert.ok(per.noise instanceof NoiseBus, "its own noise bus");
  const eye = { x: 0, y: 1.6, z: 0 };
  const fwd = { x: 0, z: -1 };
  assert.ok(per.canSee(eye, { x: 0, y: 1.2, z: -10 }, fwd, 15, 110));
  assert.ok(!per.canSee(eye, { x: 0, y: 1.2, z: -20 }, fwd, 15, 110), "too far");
  assert.ok(!per.canSee(eye, { x: 0, y: 1.2, z: 5 }, fwd, 15, 110), "behind");
  assert.ok(per.canSee(eye, { x: -4, y: 1.2, z: -4 }, fwd, 15, 110), "45° off, inside 110°");
  assert.ok(!per.canSee(eye, { x: 4, y: 1.2, z: -4 }, fwd, 15, 110), "past the wall");
  const bus = new NoiseBus();
  assert.equal(createPerception(null, { noise: bus }).noise, bus);
});
