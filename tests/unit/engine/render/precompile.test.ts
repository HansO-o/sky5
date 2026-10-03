import { test } from "node:test";
import assert from "node:assert/strict";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { CreateBox } from "@babylonjs/core/Meshes/Builders/boxBuilder";
import { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { DirectionalLight } from "@babylonjs/core/Lights/directionalLight";
import { FreeCamera } from "@babylonjs/core/Cameras/freeCamera";
import { ShadowGenerator } from "@babylonjs/core/Lights/Shadows/shadowGenerator";
import "@babylonjs/core/Lights/Shadows/shadowGeneratorSceneComponent";
import type { Scene } from "@babylonjs/core/scene";
import { precompile, drawsInstanced } from "../../../../src/engine/render/precompile";
import { ShaderWatch, shaderName } from "../../../../src/engine/render/shaderWatch";
import { InstancedSet } from "../../../../src/world/instancing";
import { newScene } from "../../helpers/jolt";

function stage() {
  const { engine, scene, dispose } = newScene();
  // as on WebGL2 and WebGPU (the null engine reports no instancing, so would draw instances one by one)
  engine.getCaps().instancedArrays = true;
  const cam = new FreeCamera("cam", new Vector3(0, 3, 12), scene);
  cam.setTarget(Vector3.Zero());
  const sun = new DirectionalLight("sun", new Vector3(0.3, -1, 0.2), scene);
  sun.position = new Vector3(-10, 20, -10);
  return { engine, scene, sun, dispose };
}

async function settle(scene: Scene) {
  scene.render();
  await scene.whenReadyAsync();
  scene.render();
}

test("the watch counts each new shader program once, by phase", async () => {
  const { engine, scene, dispose } = stage();
  const watch = new ShaderWatch(engine);
  watch.mark("load");
  const a = CreateBox("a", {}, scene);
  a.material = new StandardMaterial("s", scene);
  const b = CreateBox("b", {}, scene);
  b.material = new StandardMaterial("s2", scene); // same shader: no new program
  await settle(scene);
  assert.equal(watch.count((p) => p === "load"), 1);
  assert.equal(watch.compiles[0].name, "default");
  watch.mark("x:play");
  await settle(scene);
  assert.equal(watch.count((p) => p.endsWith(":play")), 0);
  assert.equal(shaderName({ vertex: "pbr", fragment: "pbr" }), "pbr");
  assert.equal(shaderName({ vertexSource: "void main(){}" }), "custom");
  watch.dispose();
  dispose();
});

test("a mesh with glTF-style instances compiles both ways it can draw, shadow pass included", async () => {
  const { engine, scene, sun, dispose } = stage();
  const sg = new ShadowGenerator(256, sun);
  const watch = new ShaderWatch(engine);
  const mat = new PBRMaterial("m", scene);
  const src = CreateBox("src", {}, scene);
  src.material = mat;
  src.receiveShadows = true;
  const inst = src.createInstance("i1");
  inst.position.x = 2;
  sg.addShadowCaster(src);
  src.setEnabled(false);
  assert.equal(drawsInstanced(inst), true);
  await precompile([inst], { shadows: sg });
  const compiled = watch.count();
  assert.ok(compiled >= 2, `material + shadow depth: ${compiled}`);
  watch.mark("x:play");
  src.setEnabled(true);
  await settle(scene);
  // only the source in view (no instance): drawn on its own
  inst.setEnabled(false);
  await settle(scene);
  assert.equal(watch.count((p) => p === "x:play"), 0, watch.compiles.map((c) => `${c.phase} ${c.name}`).join(", "));
  watch.dispose();
  dispose();
});

test("a scatter set compiles its LODs as thin-instanced even with no instance in range yet", async () => {
  const { engine, scene, dispose } = stage();
  const watch = new ShaderWatch(engine);
  const near = CreateBox("near", {}, scene);
  near.material = new PBRMaterial("rock", scene);
  const far = CreateBox("far", { size: 2 }, scene);
  far.material = new StandardMaterial("impostor", scene);
  // [x, y, z, yaw, scale] x 2, both 40 m out: LOD 0 (to 10 m) has none, LOD 1 has both
  const set = new InstancedSet(new Float32Array([40, 0, 0, 0, 1, 0, 0, 40, 0, 1]), [
    { meshes: [near], maxDistance: 10 },
    { meshes: [far], maxDistance: 100 },
  ]);
  set.update(Vector3.Zero(), true);
  assert.equal(near.thinInstanceCount, 0);
  await set.precompile();
  assert.equal(near.thinInstanceCount, 0, "restored");
  await settle(scene);
  watch.mark("x:play");
  // the camera walks up to the instances: LOD 0 gets them, nothing compiles
  set.update(new Vector3(38, 0, 0));
  assert.equal(near.thinInstanceCount, 1);
  await settle(scene);
  assert.equal(watch.count((p) => p === "x:play"), 0);
  // hidden sets skip updates; shown again they re-bucket
  set.setEnabled(false);
  assert.equal(near.isEnabled(), false);
  assert.equal(set.update(Vector3.Zero(), true), false);
  set.setEnabled(true);
  assert.equal(set.update(Vector3.Zero()), true);
  assert.equal(near.thinInstanceCount, 0);
  watch.dispose();
  dispose();
});
