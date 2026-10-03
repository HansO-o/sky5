import { test } from "node:test";
import assert from "node:assert/strict";
import { angleAround, dist3, interval, orbitPoints, strafeRun } from "../../../src/engine/anim/flight";

/** deterministic generator for the tests */
function seq(...vals: number[]) {
  let i = 0;
  return () => vals[i++ % vals.length];
}
const near = (a: number, b: number, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);

test("angleAround measures from +X toward +Z", () => {
  const c = { x: 10, z: -5 };
  near(angleAround(c, { x: 20, z: -5 }), 0);
  near(angleAround(c, { x: 10, z: 5 }), Math.PI / 2);
  near(angleAround(c, { x: 0, z: -5 }), Math.PI);
});

test("orbitPoints lie on the circle, one step apart, after the start angle", () => {
  const c = { x: 72, z: -592 };
  const pts = orbitPoints(c, 80, 0.3, 3, 0.7, { yMin: 40, yMax: 60, rng: seq(0, 0.5, 1) });
  assert.equal(pts.length, 3);
  pts.forEach((p, k) => {
    near(Math.hypot(p.x - c.x, p.z - c.z), 80, 1e-6);
    near(angleAround(c, p), 0.3 + (k + 1) * 0.7, 1e-9);
  });
  assert.deepEqual(
    pts.map((p) => p.y),
    [40, 50, 60],
  );
});

test("orbitPoints keep their clearance above the ground", () => {
  const pts = orbitPoints({ x: 0, z: 0 }, 50, 0, 4, 1, { yMin: 40, yMax: 40, rng: seq(0), ground: (x) => (x > 0 ? 35 : 0), clearance: 20 });
  for (const p of pts) assert.equal(p.y, p.x > 0 ? 55 : 40);
});

test("strafeRun crosses the target at right angles to the radial line, low over it", () => {
  const target = { x: 40, y: 45, z: -592 };
  const center = { x: 72, z: -592 };
  const r = strafeRun(target, center);
  // radial direction is -X, so the run goes along Z
  near(r.side.x, 0);
  near(Math.abs(r.side.z), 1);
  near(r.start.x, 40);
  near(r.mid.x, 40);
  near(r.end.x, 40);
  near(r.start.y, 45 + 26);
  near(r.mid.y, 45 + 13);
  near(r.end.y, 45 + 30);
  // start and end on opposite sides, the low point a little before the target
  assert.ok(Math.sign(r.start.z - target.z) === -Math.sign(r.end.z - target.z));
  near(Math.abs(r.mid.z - target.z), 8);
  near(dist3(r.start, { ...target, y: r.start.y }), 55);
});

test("strafeRun copes with a target at the centre", () => {
  const r = strafeRun({ x: 1, y: 0, z: 2 }, { x: 1, z: 2 });
  assert.ok(Number.isFinite(r.start.x) && Number.isFinite(r.start.z));
});

test("interval: fixed or drawn from the range", () => {
  assert.equal(interval(14), 14);
  assert.equal(interval([14, 18], seq(0)), 14);
  assert.equal(interval([14, 18], seq(0.5)), 16);
  for (let i = 0; i < 50; i++) {
    const v = interval([14, 18]);
    assert.ok(v >= 14 && v <= 18);
  }
});
