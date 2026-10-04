import { test } from "node:test";
import assert from "node:assert/strict";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { CreateBox } from "@babylonjs/core/Meshes/Builders/boxBuilder";
import { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { DirectionalLight } from "@babylonjs/core/Lights/directionalLight";
import { HemisphericLight } from "@babylonjs/core/Lights/hemisphericLight";
import { PointLight } from "@babylonjs/core/Lights/pointLight";
import { FreeCamera } from "@babylonjs/core/Cameras/freeCamera";
import { LightPool, flickerAt, pickSources, placeInSlots, type PickOptions } from "../../../../src/engine/world/LightPool";
import { applyLightBudget } from "../../../../src/engine/render/lightBudget";
import { ShaderWatch } from "../../../../src/engine/render/shaderWatch";
import { newScene } from "../../helpers/jolt";

const O: PickOptions = { maxDistance: 18, behind: 2, hysteresis: 1.5 };
const eye = { x: 0, y: 0, z: 0 };
const fwd = { x: 0, y: 0, z: -1 };
const none = new Set<number>();

test("pickSources: nearest in front within range, priority first, lit ones keep a margin", () => {
  const c = [
    { id: 1, x: 0, y: 0, z: -10 }, // front, 10 m
    { id: 2, x: 0, y: 0, z: -4 }, // front, 4 m
    { id: 3, x: 0, y: 0, z: 3 }, // behind, 3 m
    { id: 4, x: 0, y: 0, z: -30 }, // too far
    { id: 5, x: 0, y: 0, z: 1.5 }, // behind but within 2 m of the eye plane: counts as in front
  ];
  assert.deepEqual(pickSources(c, eye, fwd, 3, none, O), [5, 2, 1]);
  assert.deepEqual(pickSources(c, eye, fwd, 5, none, O), [5, 2, 1, 3]);
  assert.deepEqual(pickSources(c, eye, fwd, 0, none, O), []);
  // a behind source only gets a slot when no front one wants it
  assert.deepEqual(pickSources([c[2], c[0]], eye, fwd, 1, none, O), [1]);
  // priority beats distance and facing
  assert.deepEqual(pickSources([...c, { id: 6, x: 0, y: 0, z: 10, priority: 1 }], eye, fwd, 2, none, O), [6, 5]);
  // a source with its own reach competes from farther away
  assert.deepEqual(pickSources([c[3], { ...c[3], id: 9, reach: 40 }], eye, fwd, 2, none, O), [9]);
  // hysteresis: a lit source 1 m farther still wins; 2 m farther does not
  const pair = (d: number) => [{ id: 7, x: 0, y: 0, z: -5 }, { id: 8, x: 0, y: 0, z: -5 - d }];
  assert.deepEqual(pickSources(pair(1), eye, fwd, 1, new Set([8]), O), [8]);
  assert.deepEqual(pickSources(pair(2), eye, fwd, 1, new Set([8]), O), [7]);
});

test("placeInSlots: chosen sources keep their slot, new ones fill free usable slots", () => {
  assert.deepEqual(placeInSlots([1, 2, 3], [null, null, null], [true, true, true]), [1, 2, 3]);
  // 2 stays in slot 2, 9 is dropped, 4 takes the first free slot
  assert.deepEqual(placeInSlots([2, 4], [9, null, 2], [true, true, true]), [4, null, 2]);
  // a locked/inactive slot is never used
  assert.deepEqual(placeInSlots([5, 6], [null, null, null], [false, true, false]), [null, 5, null]);
  assert.deepEqual(placeInSlots([], [1, 2], [true, true]), [null, null]);
});

test("flicker stays within its amplitude", () => {
  for (let t = 0; t < 5; t += 0.013) {
    const k = flickerAt(t, 0.3, 1.1);
    assert.ok(k >= 0.7 - 1e-9 && k <= 1.3 + 1e-9, String(k));
  }
  assert.equal(flickerAt(2, 0, 1), 1);
});

function rig() {
  const { engine, scene, dispose } = newScene();
  const cam = new FreeCamera("cam", new Vector3(0, 2, 8), scene);
  cam.setTarget(Vector3.Zero());
  return { engine, scene, dispose };
}

/** Render, and make every mesh check its shaders (whenReady compiles whatever is out of date, seen or not). */
async function settle(scene: import("@babylonjs/core/scene").Scene) {
  scene.render();
  await scene.whenReadyAsync();
  scene.render();
}

/** Run `seconds` of updates at 60 Hz with the eye at the origin looking down -Z. */
function run(pool: LightPool, seconds: number, e = new Vector3(), f = new Vector3(0, 0, -1)) {
  for (let i = 0; i < Math.round(seconds * 60); i++) pool.update(1 / 60, e, f);
}

test("the pool owns a fixed set of lights: sources come and go, the scene's lights never change", () => {
  const { scene, dispose } = rig();
  const pool = new LightPool(scene);
  assert.equal(pool.lights.length, 3);
  assert.equal(scene.lights.length, 3);
  const claims = [-3, -6, -9, -12, -15].map((z) => pool.add({ at: new Vector3(0, 1, z), intensity: 9, range: 18 }));
  run(pool, 1);
  assert.equal(scene.lights.length, 3);
  assert.ok(pool.lights.every((l) => l.isEnabled()), "always enabled");
  // the three nearest are lit, at full intensity once faded in
  assert.deepEqual(claims.map((c) => c.slot >= 0), [true, true, true, false, false]);
  const lit = pool.lights.map((l) => l.intensity).sort();
  assert.ok(lit.every((i) => Math.abs(i - 9) < 1e-6), String(lit));
  // the nearest goes out: its slot fades out, then lights the next one
  claims[0].stop();
  assert.equal(claims[0].active, false);
  run(pool, 0.1);
  run(pool, 0.4);
  assert.deepEqual(claims.map((c) => c.slot >= 0), [false, true, true, true, false]);
  for (const c of claims) c.stop();
  run(pool, 0.5);
  assert.ok(pool.lights.every((l) => l.intensity === 0));
  assert.equal(scene.lights.length, 3);
  pool.dispose();
  assert.equal(scene.lights.length, 0);
  dispose();
});

test("a slot moves to a new source with a crossfade of about 0.3 s", () => {
  const { scene, dispose } = rig();
  const pool = new LightPool(scene, { slots: 1 });
  const a = pool.add({ at: new Vector3(0, 0, -5), intensity: 4 });
  run(pool, 0.5);
  assert.equal(pool.shown(0), a.id);
  assert.ok(Math.abs(pool.lights[0].intensity - 4) < 1e-6);
  // a nearer source appears: fade out over 0.15 s, then in over 0.15 s
  const b = pool.add({ at: new Vector3(0, 0, -2), intensity: 4 });
  run(pool, 1 / 60);
  assert.equal(pool.shown(0), a.id);
  assert.ok(pool.lights[0].intensity < 4 && pool.lights[0].intensity > 0, "fading out");
  run(pool, 0.15);
  assert.equal(pool.shown(0), b.id);
  assert.ok(pool.lights[0].intensity < 4, "fading in");
  run(pool, 0.2);
  assert.ok(Math.abs(pool.lights[0].intensity - 4) < 1e-6);
  assert.ok(pool.lights[0].position.equalsWithEpsilon(new Vector3(0, 0, -2)));
  dispose();
});

test("a locked slot keeps its source (a carried torch) whatever is nearer; moving sources are followed", () => {
  const { scene, dispose } = rig();
  const pool = new LightPool(scene);
  const torchAt = new Vector3(0, 1, 6); // behind the eye
  const torch = pool.add({ at: () => torchAt, intensity: 3, color: [1, 0.6, 0.3] });
  const unlock = pool.lock(torch, 0);
  const fires = [-2, -3, -4, -5].map((z) => pool.add({ at: new Vector3(0, 0, z), intensity: 9 }));
  run(pool, 0.5);
  assert.equal(torch.slot, 0);
  assert.equal(pool.shown(0), torch.id);
  assert.deepEqual(fires.map((f) => f.slot >= 0), [true, true, false, false]);
  assert.ok(Math.abs(pool.lights[0].diffuse.g - 0.6) < 1e-6);
  torchAt.set(5, 1, 6);
  run(pool, 1 / 60);
  assert.equal(pool.lights[0].position.x, 5);
  // doused: the slot goes dark but stays reserved
  torch.intensity = 0;
  run(pool, 0.5);
  assert.equal(pool.lights[0].intensity, 0);
  assert.equal(fires[2].slot, -1);
  torch.intensity = 3;
  run(pool, 0.5);
  assert.equal(pool.shown(0), torch.id);
  // unlocked, it competes like any other source again (and loses: it is behind)
  unlock();
  run(pool, 1);
  assert.equal(torch.slot, -1);
  assert.deepEqual(fires.map((f) => f.slot >= 0), [true, true, true, false]);
  dispose();
});

test("low quality lights two slots, the third stays dark", () => {
  const { scene, dispose } = rig();
  const pool = new LightPool(scene);
  for (const z of [-2, -3, -4]) pool.add({ at: new Vector3(0, 0, z), intensity: 5 });
  pool.setSlots(2);
  run(pool, 0.5);
  assert.equal(pool.lights.filter((l) => l.intensity > 0).length, 2);
  assert.equal(scene.lights.length, 3);
  pool.setSlots(3);
  run(pool, 0.5);
  assert.equal(pool.lights.filter((l) => l.intensity > 0).length, 3);
  dispose();
});

test("no shader recompiles while the pool works (lights move, fade, change slots and quality)", async () => {
  const { engine, scene, dispose } = rig();
  const watch = new ShaderWatch(engine);
  new DirectionalLight("sun", new Vector3(0.4, -0.7, 0.5), scene);
  new HemisphericLight("fill", new Vector3(0, 1, 0), scene);
  const pool = new LightPool(scene);
  assert.equal(scene.lights.length, 5);
  const pbr = new PBRMaterial("pbr", scene);
  const std = new StandardMaterial("std", scene);
  applyLightBudget([pbr, std]);
  const a = CreateBox("a", {}, scene);
  a.material = pbr;
  const b = CreateBox("b", {}, scene);
  b.material = std;
  b.position.x = 2;
  await scene.whenReadyAsync();
  scene.render();
  const loaded = watch.count();
  assert.ok(loaded >= 2, `compiled ${loaded}`);
  // fires light and go out, slots change, quality changes: uniforms only
  const claims = [-2, -4, -8].map((z) => pool.add({ at: new Vector3(0, 1, z), intensity: 9, flicker: 0.3 }));
  for (let i = 0; i < 30; i++) {
    run(pool, 0.1);
    scene.render();
  }
  claims[1].stop();
  pool.setSlots(2);
  run(pool, 0.5);
  scene.render();
  pool.setSlots(3);
  run(pool, 0.5);
  await settle(scene);
  assert.equal(watch.count(), loaded, "nothing compiled after load");
  watch.dispose();
  dispose();
});

test("(why: without the pool, a fire bringing a light of its own recompiles every lit material)", async () => {
  const { engine, scene, dispose } = rig();
  const watch = new ShaderWatch(engine);
  new DirectionalLight("sun", new Vector3(0.4, -0.7, 0.5), scene);
  new HemisphericLight("fill", new Vector3(0, 1, 0), scene);
  CreateBox("a", {}, scene).material = new PBRMaterial("pbr", scene);
  await scene.whenReadyAsync();
  scene.render();
  const loaded = watch.count();
  new PointLight("firelight", new Vector3(), scene);
  await settle(scene);
  assert.ok(watch.count() > loaded);
  watch.dispose();
  dispose();
});
