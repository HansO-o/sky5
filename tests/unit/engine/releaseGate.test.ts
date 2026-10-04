import { test } from "node:test";
import assert from "node:assert/strict";
import { ReleaseGate } from "../../../src/engine/core/releaseGate";
import { Interactables, type InteractHost } from "../../../src/engine/world/Interactables";

test("open by default; once closed, it opens on the frame after the button is seen up", () => {
  const g = new ReleaseGate();
  assert.ok(g.update(false) && g.open);
  assert.ok(g.update(true), "an ordinary hold counts");
  g.close();
  assert.ok(!g.open);
  assert.ok(!g.update(true), "still held from the menu");
  assert.ok(!g.update(true));
  assert.ok(!g.update(false), "the frame the release is seen doesn't count either");
  assert.ok(g.update(false));
  assert.ok(g.update(true), "a fresh press counts");
});

test("a key tapped between two frames (down and up before the frame) doesn't leak its press", () => {
  const g = new ReleaseGate();
  g.close();
  // the resume frame: the key is already up, but its press edge is still in this frame's input
  assert.ok(!g.update(false));
  assert.ok(g.update(false));
});

/**
 * The stage's wiring (PrologueStage.createInteractables): the host reads activate through the gate,
 * which the stage closes when the pause menu closes and updates at the top of every gameplay frame.
 */
function rig() {
  const key = { down: false, pressed: false };
  const gate = new ReleaseGate();
  const used: string[] = [];
  const shown: (string | null)[] = [];
  const host: InteractHost = {
    view: () => ({ pos: { x: 0, y: 0, z: 0 }, yaw: 0 }),
    pressed: () => gate.open && key.pressed,
    held: () => gate.open && key.down,
    show: (t) => void shown.push(t),
  };
  const set = new Interactables(host);
  set.add({ id: "brun", pos: { x: 0, y: 0, z: -1.2 }, label: "跟随布伦", use: () => void used.push("brun") });
  /** one frame: the stage updates the gate, then the world runs the interactables; the edge clears at the frame's end */
  const frame = (down: boolean, pressed = false) => {
    key.down = down;
    key.pressed = pressed;
    gate.update(down);
    set.update(1 / 60);
    key.pressed = false;
  };
  return { gate, used, shown, set, frame };
}

test("resuming with E on 继续 doesn't use the prompted interactable (the K0 choice)", () => {
  const r = rig();
  r.frame(false);
  assert.equal(r.set.current?.id, "brun", "prompted");
  // paused: the stage stops updating; E on 继续 closes the menu (setPaused(false) closes the gate)
  r.gate.close();
  // first frame back: KeyE is still in this frame's presses and still held
  r.frame(true, true);
  r.frame(true);
  assert.deepEqual(r.used, []);
  // a quick tap on 继续 (down and up before the frame) doesn't leak either
  r.gate.close();
  r.frame(false, true);
  assert.deepEqual(r.used, []);
  assert.equal(r.set.current?.id, "brun", "the prompt stays up meanwhile");
  // let go, then a real press uses it
  r.frame(false);
  r.frame(true, true);
  assert.deepEqual(r.used, ["brun"]);
});

test("a hold target needs a fresh press after the menu: a key held through the resume never starts one", () => {
  const r = rig();
  const seen: string[] = [];
  r.set.add({ id: "cocoon", pos: { x: 0, y: 0, z: -0.8 }, label: "割开蛛茧", hold: true, use: () => void seen.push("cocoon") });
  r.set.remove("brun");
  r.frame(false);
  r.gate.close();
  r.frame(true, true);
  for (let i = 0; i < 120; i++) r.frame(true);
  assert.deepEqual(seen, [], "held for 2 s straight from the menu: nothing");
  r.frame(false);
  r.frame(true, true);
  for (let i = 0; i < 95; i++) r.frame(true);
  assert.deepEqual(seen, ["cocoon"]);
});
