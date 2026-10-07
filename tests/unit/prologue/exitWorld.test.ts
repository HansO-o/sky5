// The exit's world glue without a browser: the web walls (blows from the combat system's swings,
// the collider, the flag, the dissolve), the cocoon, and the spider ambush driving its spiders.
// Babylon runs on a NullEngine; physics, the world's frame bus and the spiders are stand-ins.
import { test } from "node:test";
import assert from "node:assert/strict";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { CreateBox } from "@babylonjs/core/Meshes/Builders/boxBuilder";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import type { Scene } from "@babylonjs/core/scene";
import { Emitter } from "../../../src/engine/core/emitter";
import { newScene } from "../helpers/jolt";

// (the asset client starts its download worker when it is imported: none in Node)
(globalThis as { Worker?: unknown }).Worker ??= class {
  onmessage: unknown = null;
  onerror: unknown = null;
  onmessageerror: unknown = null;
  postMessage() {}
  terminate() {}
};
const { CaveWeb, CaveCocoon } = await import("../../../src/prologue/exit/webs");
const { SpiderAmbush } = await import("../../../src/prologue/exit/ambush");
const { caveSpiderGait, wolfGait, SPIDER_RIG } = await import("../../../src/prologue/exit/rigs");
const { EXIT_IDS, WEB } = await import("../../../src/prologue/exit/rules");
const { SPIDER } = await import("../../../src/prologue/creatures");

/** The world's frame bus, stepped by hand. */
function bus() {
  const fns = new Set<(dt: number) => void>();
  return {
    disposed: false,
    onUpdate(fn: (dt: number) => void) {
      fns.add(fn);
      return () => void fns.delete(fn);
    },
    step(seconds: number, dt = 1 / 30) {
      for (let t = 0; t < seconds - 1e-9; t += dt) for (const f of [...fns]) f(dt);
    },
    get listeners() {
      return fns.size;
    },
  };
}

/** Bodies on and off. */
function bodies() {
  const off = new Set<number>();
  return {
    bodyEnabled: (id: number) => !off.has(id),
    setBodyEnabled: (id: number, on: boolean) => void (on ? off.delete(id) : off.add(id)),
  };
}

const WEB_A = {
  centre: [27.01, 30.003, -749.65] as const,
  normal: [-0.998, 0, -0.067] as const,
  size: [5.9, 5.15] as const,
  floor: 27.58,
  box: { centre: [27.01, 30.003, -749.65] as const, half: [0.3, 2.58, 2.75] as const, axes: [[-0.998, 0, -0.067], [0, 1, 0], [0.067, 0, -0.998]] as const },
};

function webCards(scene: Scene) {
  const n = new TransformNode("web_A_cards", scene);
  n.position.set(27.01, 30.003, -749.65);
  const card = CreateBox("web_A_card", { width: 0.1, height: 5, depth: 5.5 }, scene);
  card.parent = n;
  return { n, card };
}

function makeWeb() {
  const { scene, dispose } = newScene();
  const world = bus();
  const ph = bodies();
  const { n, card } = webCards(scene);
  const recorded: string[] = [];
  const web = new CaveWeb({ id: "web_A", flag: EXIT_IDS.webA, world: world as never, physics: ph as never, cards: n, body: 7 as never, def: WEB_A as never, record: (id) => recorded.push(id) });
  const events: unknown[] = [];
  web.events.on((e) => events.push(e));
  return { scene, dispose, world, ph, n, card, web, recorded, events };
}

test("a web wall: two blows shiver it, the third brings it down (collider off at once, flag, dissolve)", () => {
  const t = makeWeb();
  assert.equal(t.web.blow(false), false);
  assert.equal(t.web.blow(false), false);
  assert.deepEqual(t.events, [{ type: "hit", hits: 1 }, { type: "hit", hits: 2 }]);
  assert.equal(t.ph.bodyEnabled(7), true);
  assert.equal(t.web.blow(false), true);
  assert.equal(t.web.cut, true);
  assert.deepEqual(t.events.at(-1), { type: "cut", by: "player" });
  assert.equal(t.ph.bodyEnabled(7), false, "the way is open at once");
  assert.deepEqual(t.recorded, [EXIT_IDS.webA]);
  assert.equal(t.card.isVisible, true, "still dissolving");
  t.world.step(WEB.dissolve + 0.1);
  assert.equal(t.card.isVisible, false);
  assert.ok(t.n.position.y < 30.003 - 0.5, "the cards sagged");
  assert.equal(t.web.blow(true), false, "nothing more to cut");
  t.dispose();
});

test("a heavy cuts a web at once; a checkpoint stands it up again, or takes it away silently", () => {
  const t = makeWeb();
  assert.equal(t.web.blow(true), true);
  t.world.step(1);
  t.web.set(false);
  assert.equal(t.web.cut, false);
  assert.equal(t.web.hits, 0);
  assert.equal(t.card.isVisible, true);
  assert.equal(t.ph.bodyEnabled(7), true);
  assert.ok(Math.abs(t.n.position.y - 30.003) < 1e-6, "back where it was built");
  const before = t.events.length;
  t.web.set(true);
  assert.equal(t.card.isVisible, false);
  assert.equal(t.ph.bodyEnabled(7), false);
  assert.equal(t.events.length, before, "no event for a checkpoint");
  t.dispose();
});

test("a checkpoint posing a web mid-dissolve wins over the dissolve", () => {
  const t = makeWeb();
  t.web.blow(true);
  t.world.step(0.3);
  t.web.set(false);
  t.world.step(2);
  assert.equal(t.card.isVisible, true, "the dissolve was called off");
  assert.equal(t.ph.bodyEnabled(7), true);
  assert.ok(Math.abs(t.n.position.y - 30.003) < 1e-6);
  t.dispose();
});

test("the companion's cut (the 60 s fallback) and the soft-lock's", () => {
  const t = makeWeb();
  t.web.blow(false);
  t.web.cutNow("companion");
  assert.deepEqual(t.events.at(-1), { type: "cut", by: "companion" });
  assert.equal(t.ph.bodyEnabled(7), false);
  t.dispose();
});

test("a web counts the player's swings that reach it, from the combat system's events", () => {
  const t = makeWeb();
  const events = new Emitter<unknown>();
  const player = { pose: { x: 28.6, y: 27.6, z: -749.6, yaw: Math.PI / 2 } };
  const brun = { pose: { x: 28.6, y: 27.6, z: -749.6, yaw: Math.PI / 2 } };
  const off = t.web.arm({ system: { events }, player } as never);
  const swing = (attacker: unknown, heavy = false) => events.emit({ type: "swing", attacker, attack: { reach: 1.8, arc: 55, heavy } });
  swing(player);
  assert.equal(t.web.hits, 1);
  swing(brun);
  assert.equal(t.web.hits, 1, "only the player's swings count");
  events.emit({ type: "miss", attacker: player, attack: { reach: 1.8, arc: 55 } });
  assert.equal(t.web.hits, 1, "only swings");
  player.pose.yaw = -Math.PI / 2;
  swing(player);
  assert.equal(t.web.hits, 1, "facing away");
  player.pose.yaw = Math.PI / 2;
  swing(player, true);
  assert.equal(t.web.cut, true, "a heavy");
  off();
  t.dispose();
});

test("the cocoon: searched, it goes (collider, flag); a checkpoint closes it again", () => {
  const { scene, dispose } = newScene();
  const world = bus();
  const ph = bodies();
  const n = new TransformNode("cocoon_courier_mesh", scene);
  const m = CreateBox("cocoon", { size: 0.8 }, scene);
  m.parent = n;
  const recorded: string[] = [];
  const c = new CaveCocoon({ flag: EXIT_IDS.cocoon, world: world as never, physics: ph as never, mesh: n, body: 3 as never, at: new Vector3(22, 28.45, -754), record: (id) => recorded.push(id) });
  c.open();
  assert.equal(c.searched, true);
  assert.equal(ph.bodyEnabled(3), false);
  assert.deepEqual(recorded, [EXIT_IDS.cocoon]);
  world.step(1);
  assert.equal(m.isVisible, false);
  c.set(false);
  assert.equal(c.searched, false);
  assert.equal(m.isVisible, true);
  assert.equal(ph.bodyEnabled(3), true);
  dispose();
});

/** A spider of the ambush as the encounter holds it. */
function spider() {
  return {
    hidden: true,
    dead: false,
    emerged: 0,
    dropped: null as { x: number; y: number; z: number } | null,
    emerge() {
      this.hidden = false;
      this.emerged++;
    },
    async drop(mouth: { x: number; y: number; z: number }) {
      this.hidden = false;
      this.dropped = mouth;
    },
  };
}

function ambush() {
  const world = bus();
  const webAEvents = new Emitter<{ type: string }>();
  const webB = { cut: false, by: "" as string, cutNow(by: string) {
    this.cut = true;
    this.by = by;
  } };
  const anchors: Record<string, Vector3> = { spider_c: new Vector3(18, 27.55, -750), chimney_mouth: new Vector3(18, 34.8, -750.5) };
  const cave = { webs: { A: { cut: false, events: webAEvents }, B: webB }, anchor: (name: string) => ({ pos: anchors[name], yaw: 0 }) };
  const cast = { n: spider(), s: spider(), giant: spider() };
  const player = { x: 31.5, y: 27.7, z: -749 };
  const a = new SpiderAmbush({ world: world as never, cave: cave as never, cast: () => cast as never, player: () => player });
  const cues: string[] = [];
  a.cues.on((c) => cues.push(c));
  return { world, a, cast, player, cues, webAEvents, webB };
}

test("the ambush: armed, it waits for the player to come within 6 m of the chamber's centre", () => {
  const t = ambush();
  t.world.step(2);
  assert.equal(t.a.started, false, "not armed yet");
  t.a.arm();
  t.world.step(2);
  assert.equal(t.a.started, false, "13.5 m away");
  t.player.x = 23.5;
  t.world.step(0.1);
  assert.equal(t.a.started, true);
  assert.deepEqual(t.cues, ["skitter"]);
});

test("the ambush: burrow_n at 1 s, burrow_s at 4 s, the giant once both are dead, web B at 120 s", () => {
  const t = ambush();
  t.a.start();
  t.world.step(1.05);
  assert.equal(t.cast.n.emerged, 1);
  assert.equal(t.cast.s.emerged, 0);
  t.world.step(3.0);
  assert.equal(t.cast.s.emerged, 1);
  assert.deepEqual(t.cues, ["skitter", "bark", "smallN", "smallS", "music"]);
  t.cast.n.dead = true;
  t.world.step(1);
  assert.equal(t.cast.giant.dropped, null, "one small spider still fights");
  t.cast.s.dead = true;
  t.world.step(0.1);
  const d = t.cast.giant.dropped;
  assert.deepEqual(d && [d.x, d.y, d.z], [18, 34.8, -750.5], "down the chimney");
  assert.equal(t.cues.at(-1), "phaseB");
  t.world.step(120);
  assert.equal(t.webB.cut, true);
  assert.equal(t.webB.by, "script");
  assert.equal(t.cues.at(-1), "webB");
});

test("the ambush: 8 s after web A falls it starts wherever the player is; a retry waits again", () => {
  const t = ambush();
  t.a.arm();
  t.webAEvents.emit({ type: "cut" });
  t.world.step(7.5);
  assert.equal(t.a.started, false);
  t.world.step(0.6);
  assert.equal(t.a.started, true);
  t.a.reset();
  assert.equal(t.a.started, false);
  // (web A fell long ago: the retry starts again at once)
  t.world.step(0.1);
  assert.equal(t.a.started, true);
  t.a.dispose();
  assert.equal(t.world.listeners, 0);
});

test("the spiders walk at the clip's measured pace; the wolf walks, then runs", () => {
  const small = caveSpiderGait(SPIDER_RIG.small.scale);
  assert.ok(Math.abs(small.forward[0].native - 1.305 * 0.55) < 1e-9);
  assert.equal(small.back?.reverse, true);
  assert.equal(caveSpiderGait(1).forward[0].native, 1.305);
  assert.equal(small.idle, SPIDER.clips.idle);
  assert.equal(small.forward[0].clip, SPIDER.clips.walk);
  const w = wolfGait();
  assert.deepEqual(
    w.forward.map((f) => f.clip),
    ["Walk", "Run"],
  );
  // the AI's 7 m/s charge is Run at about 1.26
  assert.ok(Math.abs(7 / w.forward[1].native - 1.26) < 0.01);
});
