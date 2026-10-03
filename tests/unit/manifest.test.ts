import { test } from "node:test";
import assert from "node:assert/strict";
import { SEGMENTS, segmentIndex } from "../../src/core/assets/manifest";

test("story segments in play order, keep and exit after the dragon (no choice segment)", () => {
  assert.deepEqual([...SEGMENTS], ["menu", "cart", "muster", "execution", "dragon", "keep", "exit"]);
  assert.ok(!(SEGMENTS as readonly string[]).includes("choice"));
  // the keep pack is the tier after the dragon chapter (prefetched while it plays)
  assert.equal(segmentIndex("keep"), segmentIndex("dragon") + 1);
  assert.equal(segmentIndex("exit"), segmentIndex("keep") + 1);
});
