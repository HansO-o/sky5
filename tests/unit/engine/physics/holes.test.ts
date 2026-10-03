import { test } from "node:test";
import assert from "node:assert/strict";
import { effectiveHole, inHoles, inRect, type Rect2 } from "../../../../src/engine/physics/holes";
import { activeTerrainHoles, EXIT_HOLE, KEEP_HOLE, TERRAIN_HOLES } from "../../../../src/world/terrainHoles";

const inside = (a: Rect2, b: Rect2) => a.x0 >= b.x0 && a.x1 <= b.x1 && a.z0 >= b.z0 && a.z1 <= b.z1;

test("inRect and inHoles are inclusive", () => {
  const r = { x0: 0, x1: 2, z0: -4, z1: -1 };
  assert.ok(inRect(r, 0, -4) && inRect(r, 2, -1) && inRect(r, 1, -2));
  assert.ok(!inRect(r, 2.01, -2) && !inRect(r, 1, -0.9));
  assert.ok(inHoles([{ samples: r }], 1, -2));
  assert.ok(!inHoles([], 1, -2));
});

test("effectiveHole: the cells around the dropped samples", () => {
  assert.deepEqual(effectiveHole({ x0: 20, x1: 24, z0: 30, z1: 34 }, 0, 0, 2), { x0: 18, x1: 26, z0: 28, z1: 36 });
  assert.deepEqual(effectiveHole({ x0: 20.5, x1: 21.5, z0: 30, z1: 34 }, 0, 0, 2), null, "no sample inside");
});

test("the town holes stay inside the geometry covering them on the stage's terrain grid", () => {
  // PrologueStage.ensurePhysics: 512 m square around the square (60, -592), 256 samples
  const size = 512, n = 256, x0 = 60 - size / 2, z0 = -592 - size / 2, step = size / (n - 1);
  for (const h of TERRAIN_HOLES) {
    const eff = effectiveHole(h.samples, x0, z0, step);
    assert.ok(eff, `${h.id}: holds samples`);
    assert.ok(inside(eff!, h.render), `${h.id}: collider opening ${JSON.stringify(eff)} within the render skip ${JSON.stringify(h.render)}`);
  }
  // design §3.1: the keep's floor slab collider spans x 47.5…72.5, z −670.5…−653
  assert.ok(inside(effectiveHole(KEEP_HOLE.samples, x0, z0, step)!, { x0: 47.5, x1: 72.5, z0: -670.5, z1: -653 }));
  // the outcrop footprint x −26…−9, z −684…−664
  assert.ok(inside(effectiveHole(EXIT_HOLE.samples, x0, z0, step)!, { x0: -26, x1: -9, z0: -684, z1: -664 }));
});

test("holes open only once their covering geometry ships", () => {
  assert.deepEqual(activeTerrainHoles(() => false), []);
  assert.deepEqual(activeTerrainHoles((id) => id === "keep/interior"), [KEEP_HOLE]);
  assert.deepEqual(activeTerrainHoles(() => true), [KEEP_HOLE, EXIT_HOLE]);
});
