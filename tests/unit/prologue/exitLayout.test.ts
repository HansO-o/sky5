import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { bankOf, beyond, inZoneBox, pathLength, pathProgress, pathTangent, respawnTarget, respawnVolumes, splitBoxes, type ExitAnchors, type ZoneBox } from "../../../src/prologue/exit/layout";
import { EXIT_CHECKPOINTS, EXIT_MARKS, webInSwing } from "../../../src/prologue/exit/rules";
import type { V3 } from "../../../src/prologue/keep/anchors";

const L: V3[] = [
  [0, 0, 0],
  [10, 0, 0],
  [10, 0, -10],
];

test("progress along a walk: arc length of the nearest point, and the distance to it", () => {
  assert.equal(pathLength(L), 20);
  assert.deepEqual(pathProgress(L, { x: 4, y: 0, z: 1 }), { s: 4, d: 1 });
  const p = pathProgress(L, { x: 11, y: 0, z: -5 });
  assert.equal(p.s, 15);
  assert.equal(p.d, 1);
  // past the ends: clamped
  assert.equal(pathProgress(L, { x: -3, y: 0, z: 0 }).s, 0);
  assert.equal(pathProgress(L, { x: 10, y: 0, z: -14 }).s, 20);
  assert.deepEqual(pathProgress([], { x: 0, y: 0, z: 0 }), { s: 0, d: Infinity });
});

test("progress is 3D: switchbacks over each other resolve by height", () => {
  const climb: V3[] = [
    [0, 0, 0],
    [10, 2, 0],
    [10, 4, -3],
    [0, 6, -3],
    [0, 8, 0],
    [10, 10, 0],
  ];
  const low = pathProgress(climb, { x: 5, y: 1, z: 0 }).s;
  const high = pathProgress(climb, { x: 5, y: 9, z: 0 }).s;
  assert.ok(low < 6, `low ${low}`);
  assert.ok(high > 25, `high ${high}`);
});

test("the walk's direction at a point, and the plane across it", () => {
  assert.deepEqual(pathTangent(L, 5), { x: 1, z: 0 });
  assert.deepEqual(pathTangent(L, 15), { x: 0, z: -1 });
  assert.deepEqual(pathTangent(L, 99), { x: 0, z: -1 });
  assert.equal(pathTangent([[0, 0, 0]], 0), null);
  assert.equal(beyond({ x: 6, z: 0 }, { x: 5, z: 0 }, { x: 1, z: 0 }), true);
  assert.equal(beyond({ x: 4, z: 3 }, { x: 5, z: 0 }, { x: 1, z: 0 }), false);
});

test("zone boxes split by where their centres fall along the walk, keeping their order", () => {
  const box = (x: number): ZoneBox => ({ min: [x - 1, -1, -1], max: [x + 1, 1, 1] });
  const boxes = [box(1), box(4), box(7), box(9.5)];
  const [a, b, c] = splitBoxes(boxes, L, [3, 8]);
  assert.deepEqual(a, [boxes[0]]);
  assert.deepEqual(b, [boxes[1], boxes[2]]);
  assert.deepEqual(c, [boxes[3]]);
  assert.equal(splitBoxes(boxes, L, []).length, 1);
});

const CHASM = { x: [30, 66] as const, z: [-735.7, -727.3] as const };

test("the gallery's banks: the lever's (north) and the exit's (south)", () => {
  assert.equal(bankOf({ x: 44, z: -724 }, CHASM), "north");
  assert.equal(bankOf({ x: 47.5, z: -738.5 }, CHASM), "south");
  assert.equal(bankOf({ x: 48, z: -731 }, CHASM), null);
  assert.equal(bankOf({ x: 18, z: -750 }, CHASM), null);
});

const VOLUMES = {
  respawn_gallery: { min: [32, 0, -735.5] as V3, max: [64, 25.5, -727.5] as V3, to: ["lever_stance", "gal_s_cp"] },
  respawn_outcrop: { min: [-26.79, 0, -676] as V3, max: [-6.5, 50, -662.42] as V3, to: ["platform"] },
  water: { min: [30, 22.8, -737] as V3, max: [66, 23.7, -725] as V3 },
  spider_arena: { min: [9, 26, -757] as V3, max: [27, 36, -743] as V3 },
};

test("falls: the stream puts the player back on the bank last stood on, the outcrop on the deck", () => {
  const v = respawnVolumes(VOLUMES);
  assert.deepEqual(
    v.map((x) => x.id),
    ["respawn_gallery", "respawn_outcrop"],
  );
  const inStream = { x: 48, y: 24, z: -731 };
  assert.deepEqual(respawnTarget(inStream, v, "north"), { volume: "respawn_gallery", to: "lever_stance" });
  assert.deepEqual(respawnTarget(inStream, v, "south"), { volume: "respawn_gallery", to: "gal_s_cp" });
  assert.deepEqual(respawnTarget(inStream, v, null), { volume: "respawn_gallery", to: "gal_s_cp" });
  assert.deepEqual(respawnTarget({ x: -15, y: 45, z: -668 }, v, null), { volume: "respawn_outcrop", to: "platform" });
  assert.equal(respawnTarget({ x: 48, y: 27, z: -738 }, v, "south"), null);
  assert.equal(respawnTarget({ x: -15, y: 56.05, z: -670.5 }, v, null), null, "standing on the deck");
});

// ------------------------------------------------------------------- against the shipped anchors

/** cave/anchors as the build shipped it (the test is skipped without a build). */
function shippedAnchors(): ExitAnchors | null {
  const root = process.cwd();
  const mf = path.join(root, "public/manifest.json");
  if (!fs.existsSync(mf)) return null;
  const m = JSON.parse(fs.readFileSync(mf, "utf8")) as { assets: { id: string; url: string }[] };
  const e = m.assets.find((a) => a.id === "cave/anchors");
  if (!e) return null;
  const p = path.join(root, "public", e.url);
  return fs.existsSync(p) ? (JSON.parse(fs.readFileSync(p, "utf8")) as ExitAnchors) : null;
}

const A = shippedAnchors();
const at = (a: ExitAnchors, name: string) => {
  const p = a.anchors[name]?.pos;
  assert.ok(p, `anchor ${name}`);
  return { x: p[0], y: p[1], z: p[2] };
};

test("the shipped anchors hold every exit checkpoint, where §11 puts it", { skip: !A }, () => {
  const a = A!;
  for (const c of EXIT_CHECKPOINTS) for (const name of [c.player, c.companion]) assert.ok(EXIT_MARKS[name], name);
  // (and the fallbacks of every other anchor the exit's world stands on)
  for (const [name, m] of Object.entries(EXIT_MARKS)) {
    const p = at(a, name);
    assert.ok(Math.hypot(p.x - m[0], p.z - m[2]) < 0.2 && Math.abs(p.y - m[1]) < 0.25, `${name} at ${p.x}, ${p.y}, ${p.z}`);
  }
  for (const name of ["bones_1", "bones_2", "bones_3", "den_path_1"]) at(a, name);
});

test("the wolf's leash line at climb_s23: the den and cp_climb inside, the climb above beyond", { skip: !A }, () => {
  const a = A!;
  const walk = a.paths?.walk?.exit ?? [];
  assert.ok(walk.length > 10);
  const s23 = at(a, "climb_s23");
  const dir = pathTangent(walk, pathProgress(walk, s23).s)!;
  assert.ok(dir);
  const past = (name: string) => beyond(at(a, name), s23, dir);
  for (const name of ["wolf_bed", "satchel", "cp_den", "cp_climb", "den_centre"]) assert.equal(past(name), false, name);
  for (const name of ["climb_mid", "cp_light", "bend", "platform"]) assert.equal(past(name), true, name);
});

test("the shipped zone D splits into the climb, the wind from climb_mid and the light from cp_light", { skip: !A }, () => {
  const a = A!;
  const walk = a.paths!.walk!.exit!;
  const s = (name: string) => pathProgress(walk, at(a, name)).s;
  assert.ok(s("climb_s23") < s("climb_mid") && s("climb_mid") < s("cp_light") && s("cp_light") < s("bend"));
  const D = a.zones.D!.boxes as ZoneBox[];
  const [d0, dw, dl] = splitBoxes(D, walk, [s("climb_mid") - 1, s("cp_light") - 0.5]);
  assert.ok(d0.length && dw.length && dl.length, `${d0.length} / ${dw.length} / ${dl.length}`);
  assert.equal(d0.length + dw.length + dl.length, D.length);
  // (overlaps resolve to the earlier zone: the zone a point is in is the first that holds it)
  const zoneOf = (name: string) => {
    const p = at(a, name);
    return [d0, dw, dl].findIndex((list) => list.some((b) => inZoneBox(b, p)));
  };
  assert.equal(zoneOf("cp_climb"), 0);
  assert.equal(zoneOf("climb_s23"), 0);
  assert.equal(zoneOf("climb_mid"), 1);
  assert.equal(zoneOf("cp_light"), 2);
  // the deck is in E's box for it, the bend before it
  const E = a.zones.E!.boxes as ZoneBox[];
  assert.ok(E.some((b) => inZoneBox(b, at(a, "platform"))));
});

test("the shipped web walls are within a sword's reach of their stand points", { skip: !A }, () => {
  const a = A!;
  for (const id of ["web_A", "web_B"] as const) {
    const w = a.webs?.[id];
    assert.ok(w, id);
    // 1.3 m in front of the wall on either side, facing it
    for (const side of [1, -1]) {
      const p = { x: w.centre[0] + w.normal[0] * 1.3 * side, y: w.floor, z: w.centre[2] + w.normal[2] * 1.3 * side };
      const yaw = Math.atan2(-(w.centre[0] - p.x), -(w.centre[2] - p.z));
      assert.equal(webInSwing({ ...p, yaw }, { reach: 1.8, arc: 55 }, w), true, `${id} side ${side}`);
    }
  }
});
