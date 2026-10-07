import { test } from "node:test";
import assert from "node:assert/strict";
import {
  AMBUSH,
  AmbushSchedule,
  ambushDue,
  beastOutcome,
  EXIT_CHECKPOINTS,
  EXIT_IDS,
  EXIT_MARKS,
  EXIT_STEPS,
  exitSkipState,
  exitWorldState,
  PLATFORM,
  PLATFORM_LOCK,
  PLATFORM_RESUME,
  platformCues,
  WEB,
  WebCut,
  webInSwing,
  WOLF,
  WolfWatch,
  type WebShape,
} from "../../../src/prologue/exit/rules";
import { DEFAULT_FLAGS, newFlags } from "../../../src/prologue/flags";
import { EXIT_TIMING } from "../../../src/prologue/chapters/exitScript";

// ---------------------------------------------------------------------------------------- webs

test("a web wall gives on the third blow of any attack", () => {
  const w = new WebCut();
  assert.equal(w.hit(false), false);
  assert.equal(w.hit(false), false);
  assert.equal(w.hit(false), true);
  assert.equal(w.cut, true);
  assert.equal(w.hits, 3);
  // (a cut web counts nothing more)
  assert.equal(w.hit(true), false);
  assert.equal(w.hits, 3);
  assert.equal(WEB.hits, 3);
});

test("one heavy cuts a web at once, after light blows too", () => {
  const a = new WebCut();
  assert.equal(a.hit(true), true);
  assert.equal(a.hits, 1);
  const b = new WebCut();
  b.hit(false);
  assert.equal(b.hit(true), true);
  const c = new WebCut();
  c.give();
  assert.equal(c.cut, true);
  assert.equal(c.hit(false), false);
});

// web A as cave/anchors ships it: the wall across the chamber's east door, facing west
const WEB_A: WebShape = {
  centre: [27.01, 30.003, -749.65],
  floor: 27.58,
  box: { half: [0.3, 2.58, 2.75], axes: [[-0.998, 0, -0.067], [0, 1, 0], [0.067, 0, -0.998]] },
};
const sword = { reach: 1.8, arc: 55 };
/** facing west (−X) is yaw π/2: forward = (−sin, −cos) */
const WEST = Math.PI / 2;

test("a swing reaches the web from the east bank facing it, at its middle and near its sides", () => {
  assert.equal(webInSwing({ x: 28.6, y: 27.6, z: -749.6, yaw: WEST }, sword, WEB_A), true);
  // toward one side of the 5.5 m wide wall
  assert.equal(webInSwing({ x: 28.4, y: 27.6, z: -747.6, yaw: WEST }, sword, WEB_A), true);
  // from the chamber's side too (facing east)
  assert.equal(webInSwing({ x: 25.6, y: 27.6, z: -749.6, yaw: -WEST }, sword, WEB_A), true);
});

test("a swing misses the web facing away, out of reach, past its edge or on another level", () => {
  assert.equal(webInSwing({ x: 28.6, y: 27.6, z: -749.6, yaw: -WEST }, sword, WEB_A), false);
  // 3 m off: beyond the sword's 1.8 m (+0.35)
  assert.equal(webInSwing({ x: 30.0, y: 27.6, z: -749.6, yaw: WEST }, sword, WEB_A), false);
  // 2 m past the wall's north end
  assert.equal(webInSwing({ x: 27.5, y: 27.6, z: -744.6, yaw: WEST }, sword, WEB_A), false);
  // standing 3 m above its floor
  assert.equal(webInSwing({ x: 28.6, y: 30.6, z: -749.6, yaw: WEST }, sword, WEB_A), false);
  // fists (1.1 m) need to be closer than a sword
  assert.equal(webInSwing({ x: 28.9, y: 27.6, z: -749.6, yaw: WEST }, { reach: 1.1, arc: 40 }, WEB_A), false);
  assert.equal(webInSwing({ x: 28.2, y: 27.6, z: -749.6, yaw: WEST }, { reach: 1.1, arc: 40 }, WEB_A), true);
});

// ------------------------------------------------------------------------------------- ambush

test("the ambush starts within 6 m of the chamber's centre, or 8 s after web A fell", () => {
  assert.equal(ambushDue({ distToCentre: 6, sinceWebA: null }), true);
  assert.equal(ambushDue({ distToCentre: 6.1, sinceWebA: null }), false);
  assert.equal(ambushDue({ distToCentre: 12, sinceWebA: 7.9 }), false);
  assert.equal(ambushDue({ distToCentre: 12, sinceWebA: 8 }), true);
});

test("the ambush timeline: skitter 0, bark 0.6, burrow_n 1.0, burrow_s and the music 4.0 (§6.1)", () => {
  const a = new AmbushSchedule();
  assert.deepEqual(a.update(1, { smallAlive: 0, webBCut: false }), [], "nothing before the trigger");
  assert.deepEqual(a.start(), ["skitter"]);
  assert.deepEqual(a.start(), [], "the trigger fires once");
  const at = (t: number, alive = 1) => a.update(t - (a.time ?? 0), { smallAlive: alive, webBCut: false });
  assert.deepEqual(at(0.5), []);
  assert.deepEqual(at(0.6), ["bark"]);
  assert.deepEqual(at(0.99), []);
  assert.deepEqual(at(1.0), ["smallN"]);
  // (one small spider out and already dead: no phase B until both have been out)
  assert.deepEqual(at(3.9, 0), []);
  assert.deepEqual(at(4.0, 2), ["smallS", "music"]);
  assert.equal(AMBUSH.bark, EXIT_TIMING.ambush.bark);
});

test("phase B: when both small spiders are dead, else 20 s after the trigger", () => {
  const a = new AmbushSchedule();
  a.start();
  a.update(4, { smallAlive: 2, webBCut: false });
  assert.deepEqual(a.update(5, { smallAlive: 1, webBCut: false }), []);
  assert.deepEqual(a.update(0.1, { smallAlive: 0, webBCut: false }), ["phaseB"]);
  assert.deepEqual(a.update(30, { smallAlive: 0, webBCut: false }), [], "once");
  const b = new AmbushSchedule();
  b.start();
  assert.deepEqual(b.update(19.9, { smallAlive: 2, webBCut: false }), ["bark", "smallN", "smallS", "music"]);
  assert.deepEqual(b.update(0.1, { smallAlive: 2, webBCut: false }), ["phaseB"]);
});

test("web B gives way 120 s into the fight unless it was cut (§12 X1)", () => {
  const a = new AmbushSchedule();
  a.start();
  assert.ok(!a.update(119, { smallAlive: 0, webBCut: false }).includes("webB"));
  assert.deepEqual(a.update(1, { smallAlive: 0, webBCut: false }), ["webB"]);
  const b = new AmbushSchedule();
  b.start();
  assert.ok(!b.update(130, { smallAlive: 0, webBCut: true }).includes("webB"));
});

test("a retry plays the ambush again from its trigger", () => {
  const a = new AmbushSchedule();
  a.start();
  a.update(25, { smallAlive: 0, webBCut: false });
  assert.ok(a.has("phaseB"));
  a.reset();
  assert.equal(a.started, false);
  assert.equal(a.has("phaseB"), false);
  assert.deepEqual(a.start(), ["skitter"]);
  assert.deepEqual(a.update(1, { smallAlive: 1, webBCut: false }), ["bark", "smallN"]);
});

// ---------------------------------------------------------------------------------------- wolf

test("the wolf's lines: stir at 0.5, calm back under 0.2, wake at 1.0 or when its brain wakes it", () => {
  const w = new WolfWatch();
  assert.equal(w.update(0.3, false), null);
  assert.equal(w.update(0.5, false), "stir");
  assert.equal(w.update(0.6, false), null, "the stir is said once");
  assert.equal(w.update(0.3, false), null, "settling, not yet calm");
  assert.equal(w.update(0.19, false), "calm");
  assert.equal(w.update(0.55, false), "stir", "it can stir again");
  assert.equal(w.update(1.0, false), "wake");
  assert.equal(w.update(0, false), null, "awake stays awake until it sleeps");
  w.sleep();
  assert.equal(w.update(0.1, true), "wake", "a blow, the player too close, a clash");
  assert.deepEqual([WOLF.stir, WOLF.calm, WOLF.wake, WOLF.leash], [0.5, 0.2, 1, 18]);
});

test("the den's outcome for the end card", () => {
  assert.equal(beastOutcome({ killed: false, woke: false, leashed: false }), "asleep");
  assert.equal(beastOutcome({ killed: true, woke: true, leashed: true }), "killed");
  assert.equal(beastOutcome({ killed: false, woke: true, leashed: true }), "fled");
  assert.equal(beastOutcome({ killed: false, woke: true, leashed: false }), undefined);
});

// ------------------------------------------------------------------------------------ platform

test("the platform's timeline in order, and its replay from the dragon cue (§6.1, §11)", () => {
  const ts = PLATFORM.map((c) => c.t);
  assert.deepEqual([...ts].sort((a, b) => a - b), ts);
  assert.deepEqual(platformCues(-1, 0), ["arrive"]);
  assert.deepEqual(platformCues(0, PLATFORM_LOCK), ["bell", "dragon", "wings", "overhead", "move"]);
  assert.deepEqual(platformCues(PLATFORM_LOCK, 30), ["roar", "music", "closing"]);
  assert.equal(platformCues(PLATFORM_RESUME - 1e-6, PLATFORM_RESUME)[0], "dragon");
  assert.equal(PLATFORM.find((c) => c.cue === "overhead")!.t, EXIT_TIMING.platform.overhead);
  assert.equal(PLATFORM.find((c) => c.cue === "closing")!.t, EXIT_TIMING.platform.closing);
});

// --------------------------------------------------------------------------------- checkpoints

test("§11's checkpoint marks: an anchor and a position for each step's player and companion", () => {
  assert.equal(EXIT_CHECKPOINTS.length, EXIT_STEPS + 1);
  EXIT_CHECKPOINTS.forEach((c, i) => {
    assert.equal(c.step, i);
    assert.ok(EXIT_MARKS[c.player], c.player);
    assert.ok(EXIT_MARKS[c.companion], c.companion);
  });
  assert.deepEqual(
    EXIT_CHECKPOINTS.map((c) => c.yaw),
    [0.2, 1.57, 1.57, 2.45, 2.7, -1.68],
  );
});

const flags = (o: { looted?: string[]; beast?: "asleep" | "killed" | "fled" | "skipped"; charm?: boolean } = {}) => {
  const f = newFlags();
  f.looted = o.looted ?? [];
  if (o.beast) f.outcomes.beast = o.beast;
  f.inv.charm = !!o.charm;
  return f;
};

test("step 0: webs intact, the ambush ahead, the wolf asleep, the torch lit, underground", () => {
  const s = exitWorldState(0, flags());
  assert.deepEqual(
    { webA: s.webA, webB: s.webB, spiders: s.spiders, wolf: s.wolf, torch: s.torch, outdoor: s.outdoor, townFires: s.townFires, mood: s.mood, cocoon: s.cocoon, satchel: s.satchel },
    { webA: "intact", webB: "intact", spiders: "waiting", wolf: "asleep", torch: true, outdoor: false, townFires: false, mood: null, cocoon: "closed", satchel: "there" },
  );
});

test("step 1: web A as the flags say, E5 armed", () => {
  assert.equal(exitWorldState(1, flags()).webA, "intact");
  const s = exitWorldState(1, flags({ looted: [EXIT_IDS.webA] }));
  assert.equal(s.webA, "cut");
  assert.equal(s.webB, "intact");
  assert.equal(s.spiders, "armed");
});

test("step 2: the spiders and both webs gone", () => {
  const s = exitWorldState(2, flags());
  assert.equal(s.webA, "cut");
  assert.equal(s.webB, "cut");
  assert.equal(s.spiders, "gone");
  assert.equal(s.wolf, "asleep");
});

test("steps 3 and 4: the wolf asleep (a leashed one back asleep), gone if killed", () => {
  assert.equal(exitWorldState(3, flags()).wolf, "asleep");
  assert.equal(exitWorldState(3, flags({ beast: "killed" })).wolf, "gone");
  assert.equal(exitWorldState(4, flags({ beast: "fled" })).wolf, "asleep");
  assert.equal(exitWorldState(4, flags({ beast: "killed" })).wolf, "gone");
  assert.equal(exitWorldState(4, flags()).torch, true);
});

test("step 5: on the platform: the outdoor world, the town's fires, mood 1, no torch, no wolf", () => {
  const s = exitWorldState(5, flags({ beast: "asleep" }));
  assert.deepEqual({ outdoor: s.outdoor, townFires: s.townFires, mood: s.mood, torch: s.torch, wolf: s.wolf }, { outdoor: true, townFires: true, mood: 1, torch: false, wolf: "gone" });
});

test("searched and taken things stay so at every step; steps out of range clamp", () => {
  for (let step = 0; step <= EXIT_STEPS; step++) {
    const s = exitWorldState(step, flags({ looted: [EXIT_IDS.cocoon, EXIT_IDS.satchel] }));
    assert.equal(s.cocoon, "searched");
    assert.equal(s.satchel, "taken");
  }
  assert.equal(exitWorldState(3, flags({ charm: true })).satchel, "taken", "the charm came out of it");
  assert.equal(exitWorldState(-2, flags()).step, 0);
  assert.equal(exitWorldState(9, flags()).step, 5);
  assert.equal(exitWorldState(Number.NaN, flags()).step, 0);
});

test("exit.skip(): the platform's world with everything gone; the den 'skipped' unless decided", () => {
  const a = exitSkipState(flags());
  assert.equal(a.beast, "skipped");
  assert.deepEqual({ webA: a.world.webA, webB: a.world.webB, wolf: a.world.wolf, spiders: a.world.spiders, torch: a.world.torch, outdoor: a.world.outdoor }, { webA: "cut", webB: "cut", wolf: "gone", spiders: "gone", torch: false, outdoor: true });
  assert.equal(exitSkipState(flags({ beast: "fled" })).beast, "fled");
  // (the flags themselves are left alone: the chapter writes them)
  assert.equal(DEFAULT_FLAGS.outcomes.beast, undefined);
});
