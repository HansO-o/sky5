import { test } from "node:test";
import assert from "node:assert/strict";
import { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { MultiMaterial } from "@babylonjs/core/Materials/multiMaterial";
import { SCENE_LIGHTS, applyLightBudget, enforceLightBudget } from "../../../../src/engine/render/lightBudget";
import { newScene } from "../../helpers/jolt";

test("every lit material is set up for the 5 scene lights (raised, never lowered)", () => {
  const { scene, dispose } = newScene();
  assert.equal(SCENE_LIGHTS, 5);
  const pbr = new PBRMaterial("p", scene);
  const std = new StandardMaterial("s", scene);
  const wide = new StandardMaterial("w", scene);
  wide.maxSimultaneousLights = 8;
  const multi = new MultiMaterial("m", scene);
  const sub = new PBRMaterial("sub", scene);
  multi.subMaterials.push(sub, null);
  assert.equal(pbr.maxSimultaneousLights, 4, "Babylon's default would drop the last pool light");
  applyLightBudget([pbr, std, wide, multi, null, undefined]);
  assert.deepEqual([pbr, std, wide, sub].map((m) => m.maxSimultaneousLights), [5, 5, 8, 5]);
  dispose();
});

test("a scene keeps the budget on its default material and on materials added later", async () => {
  const { scene, dispose } = newScene();
  const early = new PBRMaterial("early", scene);
  const off = enforceLightBudget(scene);
  assert.equal(scene.defaultMaterial.maxSimultaneousLights, 5);
  assert.equal(early.maxSimultaneousLights, 5);
  const late = new StandardMaterial("late", scene);
  // Babylon announces new materials a tick later
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(late.maxSimultaneousLights, 5);
  off();
  const after = new StandardMaterial("after", scene);
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(after.maxSimultaneousLights, 4);
  dispose();
});
