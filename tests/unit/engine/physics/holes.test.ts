import { test } from "node:test";
import assert from "node:assert/strict";
import { effectiveHole, inHoles, inRect, type Rect2 } from "../../../../src/engine/physics/holes";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { activeTerrainHoles, EXIT_HOLE, KEEP_HOLE, patchSlabs, TERRAIN_GRID, TERRAIN_HOLES, TERRAIN_STEP } from "../../../../src/world/terrainHoles";
import { newPhysics } from "../../helpers/jolt";

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

const G = TERRAIN_GRID;
const keepHole = () => effectiveHole(KEEP_HOLE.samples, G.x0, G.z0, TERRAIN_STEP)!;
/** keep/anchors: the G5 stairwell and its top landing G5t (world, inner wall faces) */
const STAIRWELL: Rect2 = { x0: 66.6, x1: 71.78, z0: -669.78, z1: -661.4 };
/** the keep's inner wall faces */
const KEEP_INSIDE: Rect2 = { x0: 48.22, x1: 71.78, z0: -669.78, z1: -654.22 };

test("the stage's terrain grid is the one the holes are sized for", () => {
  // centred on LAYOUT.square (src/world/town.ts, which cannot load in Node: it pulls in the asset worker)
  assert.equal(G.x0 + G.size / 2, 60);
  assert.equal(G.z0 + G.size / 2, -592);
  assert.ok(Math.abs(TERRAIN_STEP - 512 / 255) < 1e-12);
});

test("each hole's collider opening is covered: by the render skip, or by its patches", () => {
  for (const h of TERRAIN_HOLES) {
    const eff = effectiveHole(h.samples, G.x0, G.z0, TERRAIN_STEP);
    assert.ok(eff, `${h.id}: holds samples`);
    for (let x = eff!.x0; x <= eff!.x1 + 1e-9; x += 0.05)
      for (let z = eff!.z0; z <= eff!.z1 + 1e-9; z += 0.05)
        if (!inRect(h.render, x, z)) assert.ok((h.patches ?? []).some((p) => inRect(p, x, z)), `${h.id}: opening at (${x.toFixed(2)}, ${z.toFixed(2)}) is neither covered nor patched`);
  }
  // the outcrop footprint x −26…−9, z −684…−664
  assert.ok(inside(effectiveHole(EXIT_HOLE.samples, G.x0, G.z0, TERRAIN_STEP)!, { x0: -26, x1: -9, z0: -684, z1: -664 }));
});

test("the keep's opening clears the whole stairwell and stays under the floor slab elsewhere", () => {
  const eff = keepHole();
  // G5 goes 6 m down through the terrain's level: no height-field triangle may stand in it (with
  // a cell's width to spare, Jolt keeps the half of a corner cell away from its dropped sample)
  assert.ok(inside(STAIRWELL, { x0: eff.x0, x1: eff.x1 - 1, z0: eff.z0 + 1, z1: eff.z1 }), `opening ${JSON.stringify(eff)} vs stairwell`);
  // west and south the ground-floor slab (x 47.5…72.5, z −670.5…−653) covers it
  assert.ok(eff.x0 >= 47.5 && eff.z1 <= -653);
  // the patches close the outside, never the inside
  for (const p of KEEP_HOLE.patches ?? []) {
    const overlap = p.x0 < KEEP_INSIDE.x1 && p.x1 > KEEP_INSIDE.x0 && p.z0 < KEEP_INSIDE.z1 && p.z1 > KEEP_INSIDE.z0;
    assert.ok(!overlap, `patch ${JSON.stringify(p)} reaches into the keep`);
  }
});

test("Jolt: no terrain inside the stairwell, ground at the keep's wall feet", async () => {
  const ph = await newPhysics();
  const ground = 37.95;
  const flat = () => ground;
  ph.addHeightField(G.x0, G.z0, G.size, G.samples, flat, [KEEP_HOLE], { tag: "terrain" });
  for (const p of patchSlabs([KEEP_HOLE], flat)) ph.addBox(new Vector3(...p.center), new Vector3(...p.half), undefined, { tag: "terrain" });
  const DOWN = new Vector3(0, -1, 0);
  const down = (x: number, z: number) => ph.rayCastStatic(new Vector3(x, 45, z), DOWN, 20);
  let open = 0;
  for (let x = STAIRWELL.x0; x <= STAIRWELL.x1 + 1e-9; x += 0.25)
    for (let z = STAIRWELL.z0; z <= STAIRWELL.z1 + 1e-9; z += 0.25) {
      assert.equal(down(x, z), Infinity, `terrain inside the stairwell at (${x.toFixed(2)}, ${z.toFixed(2)})`);
      open++;
    }
  assert.ok(open > 400);
  // outside the shell (x 72.5, z −670.5) the ground is whole: on the patches and past them
  for (let z = -673; z <= -653; z += 0.25)
    for (const x of [72.55, 72.8, 73.05, 73.3, 74]) assert.ok(Math.abs(45 - down(x, z) - ground) < 0.02, `east wall foot (${x}, ${z})`);
  for (let x = 47; x <= 74; x += 0.25)
    for (const z of [-670.55, -670.8, -671.1, -671.35, -672]) assert.ok(Math.abs(45 - down(x, z) - ground) < 0.02, `north wall foot (${x}, ${z})`);
  ph.dispose();
});

test("holes open only once their covering geometry ships", () => {
  assert.deepEqual(activeTerrainHoles(() => false), []);
  assert.deepEqual(activeTerrainHoles((id) => id === "keep/interior"), [KEEP_HOLE]);
  assert.deepEqual(activeTerrainHoles(() => true), [KEEP_HOLE, EXIT_HOLE]);
});
