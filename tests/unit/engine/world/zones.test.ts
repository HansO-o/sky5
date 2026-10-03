import { test } from "node:test";
import assert from "node:assert/strict";
import { Zones, inAabb, shownSets, zoneAt, type ZoneDef, type ZoneHost } from "../../../../src/engine/world/zones";

const box = (x0: number, x1: number, z0: number, z1: number, y0 = 0, y1 = 10) => ({ min: [x0, y0, z0] as const, max: [x1, y1, z1] as const });

// a keep (two floors) and a cave of three sections in a row, A - B - C
const DEFS: ZoneDef[] = [
  { id: "K_GF", boxes: [box(0, 10, 0, 10, 5, 10)], profile: "hall", show: ["keep_gf"], beds: [{ id: "amb_torch", gain: 0.4 }], music: null },
  { id: "K_BS", boxes: [box(0, 10, 0, 10, 0, 5)], profile: "basement", show: ["keep_bs"], beds: ["amb_dungeon"] },
  { id: "A", boxes: [box(20, 30, 0, 10)], profile: "cave", show: ["cave_A"], neighbours: ["B"], beds: ["amb_cave"], music: "explore" },
  { id: "B", boxes: [box(30, 40, 0, 10)], profile: "cave", show: ["cave_B"], neighbours: ["A", "C"], beds: ["amb_cave", "amb_drips"] },
  { id: "C", boxes: [box(40, 50, 0, 10)], profile: "cave", show: ["cave_C"], neighbours: ["B"], beds: ["amb_cave"], music: "spider" },
];

test("boxes, priorities and hysteresis", () => {
  assert.ok(inAabb(box(0, 1, 0, 1), { x: 1, y: 5, z: 0 }));
  assert.ok(!inAabb(box(0, 1, 0, 1), { x: 1.2, y: 5, z: 0 }));
  assert.ok(inAabb(box(0, 1, 0, 1), { x: 1.2, y: 5, z: 0 }, 0.25));
  assert.equal(zoneAt(DEFS, { x: 5, y: 6, z: 5 })?.id, "K_GF");
  assert.equal(zoneAt(DEFS, { x: 5, y: 1, z: 5 })?.id, "K_BS");
  assert.equal(zoneAt(DEFS, { x: 100, y: 1, z: 5 }), null);
  // on the shared wall A|B the first defined wins; once in B, B is kept within the margin
  assert.equal(zoneAt(DEFS, { x: 30, y: 1, z: 5 })?.id, "A");
  const B = DEFS[3];
  assert.equal(zoneAt(DEFS, { x: 29.7, y: 1, z: 5 }, B, 0.5)?.id, "B");
  assert.equal(zoneAt(DEFS, { x: 29.3, y: 1, z: 5 }, B, 0.5)?.id, "A");
  // a zone of higher priority takes over even inside the current one's margin
  const vault: ZoneDef = { id: "V", boxes: [box(28, 29.8, 0, 10)], priority: 1 };
  assert.equal(zoneAt([...DEFS, vault], { x: 29.7, y: 1, z: 5 }, B, 0.5)?.id, "V");
});

test("a zone shows its own sets and its neighbours'", () => {
  assert.deepEqual([...shownSets(DEFS, DEFS[3])].sort(), ["cave_A", "cave_B", "cave_C"]);
  assert.deepEqual([...shownSets(DEFS, DEFS[2])].sort(), ["cave_A", "cave_B"]);
  assert.deepEqual([...shownSets(DEFS, null, { show: ["outdoor"] })], ["outdoor"]);
});

function host(at: { x: number; y: number; z: number }) {
  const log: string[] = [];
  const h: ZoneHost = {
    probe: () => at,
    profile: (n, s) => log.push(`profile ${n} ${s}`),
    show: (set, on) => log.push(`${on ? "show" : "hide"} ${set}`),
    startBed: (id, gain) => log.push(`bed+ ${id}${gain === undefined ? "" : ` ${gain}`}`),
    stopBed: (id) => log.push(`bed- ${id}`),
    music: (m) => log.push(`music ${m}`),
    entered: (z, from) => log.push(`entered ${z?.id ?? "-"} from ${from?.id ?? "-"}`),
  };
  return { h, log, at };
}

test("entering zones sets profile, visibility, beds and music, each only when it changes", () => {
  const at = { x: 22, y: 1, z: 5 };
  const { h, log } = host(at);
  const zones = new Zones(h, DEFS, { outside: { profile: "outdoor", show: ["outdoor"] } });
  zones.check();
  assert.equal(zones.current?.id, "A");
  assert.deepEqual(log.sort(), [
    "bed+ amb_cave",
    "entered A from -",
    "hide keep_bs",
    "hide keep_gf",
    "hide outdoor",
    "music explore",
    "profile cave 1.5",
    "show cave_A",
    "show cave_B",
    "hide cave_C",
  ].sort());
  // into B: C appears, the drips start; same profile, same cave bed, no music given
  log.length = 0;
  at.x = 35;
  zones.check();
  assert.deepEqual(log, ["show cave_C", "bed+ amb_drips", "entered B from A"]);
  // into C: A is hidden, the drips stop, the music changes
  log.length = 0;
  at.x = 45;
  zones.check();
  assert.deepEqual(log, ["hide cave_A", "bed- amb_drips", "music spider", "entered C from B"]);
  // nothing changes while staying in C
  log.length = 0;
  at.x = 46;
  zones.check();
  assert.deepEqual(log, []);
  // out of every zone: the outside effects
  at.x = 100;
  zones.check();
  assert.deepEqual(log, ["profile outdoor 1.5", "show outdoor", "hide cave_B", "hide cave_C", "bed- amb_cave", "entered - from C"]);
  // up to the keep: its gain-carrying bed, music stopped
  log.length = 0;
  Object.assign(at, { x: 5, y: 7, z: 5 });
  zones.check();
  assert.deepEqual(log, ["profile hall 1.5", "hide outdoor", "show keep_gf", "bed+ amb_torch 0.4", "music null", "entered K_GF from -"]);
  // dispose stops the zones' beds
  log.length = 0;
  zones.dispose();
  assert.deepEqual(log, ["bed- amb_torch"]);
  zones.check();
  assert.deepEqual(log, ["bed- amb_torch"]);
});

test("checks run at 4 Hz on a frame bus; reset re-applies; zones can be added and removed", () => {
  const at = { x: 22, y: 1, z: 5 };
  const { h, log } = host(at);
  let tick: ((dt: number) => void) | null = null;
  const bus = { onUpdate: (fn: (dt: number) => void) => ((tick = fn), () => (tick = null)) };
  const zones = new Zones(h, [], { bus });
  const off = zones.define(DEFS[2]);
  tick!(0.1);
  tick!(0.1);
  assert.equal(log.length, 0, "not yet");
  tick!(0.1);
  assert.equal(zones.current?.id, "A");
  const n = log.length;
  tick!(0.3);
  assert.equal(log.length, n, "unchanged");
  zones.reset();
  tick!(0.3);
  assert.ok(log.length > n, "re-applied");
  off();
  tick!(0.3);
  assert.equal(zones.current, null);
  zones.dispose();
  assert.equal(tick, null, "unregistered from the bus");
});
