import { test } from "node:test";
import assert from "node:assert/strict";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { NodeHider } from "../../../../src/engine/world/visibility";
import { newScene } from "../../helpers/jolt";

test("the hider re-enables only what it hid itself", () => {
  const { scene, dispose } = newScene();
  const [a, b, c] = ["a", "b", "c"].map((n) => new TransformNode(n, scene));
  c.setEnabled(false); // hidden by someone else (a broken wall)
  const h = new NodeHider();
  h.hideOnly([a, b, c]);
  assert.deepEqual([a, b, c].map((n) => n.isEnabled(false)), [false, false, false]);
  assert.equal(h.size, 2);
  // keep mode: b comes back, a stays hidden
  h.hideOnly([a, c]);
  assert.deepEqual([a, b, c].map((n) => n.isEnabled(false)), [false, true, false]);
  h.showAll();
  assert.deepEqual([a, b, c].map((n) => n.isEnabled(false)), [true, true, false]);
  // something else takes over a hidden node: it is not brought back
  h.hideOnly([a, b]);
  h.forget(b);
  h.showAll();
  assert.deepEqual([a, b].map((n) => n.isEnabled(false)), [true, false]);
  dispose();
});
