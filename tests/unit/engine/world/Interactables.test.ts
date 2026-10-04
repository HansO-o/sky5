import { test } from "node:test";
import assert from "node:assert/strict";
import { interactScore, Interactables, pickInteractable, type InteractHost, type InteractView } from "../../../../src/engine/world/Interactables";

// forward = (−sin yaw, −cos yaw): yaw 0 looks toward −z
const at = (x: number, z: number, yaw = 0, y = 0): InteractView => ({ pos: { x, y, z }, yaw });
const cand = (x: number, z: number, y = 0, radius = 2, cone = 35, height = 2.2) => ({ pos: { x, y, z }, radius, cone, height });

test("in reach: within the radius (horizontally), the height and the view cone", () => {
  const v = at(0, 0);
  assert.ok(Math.abs(interactScore(cand(0, -1.5), v)! - 1.5) < 1e-9);
  assert.equal(interactScore(cand(0, -2.1), v), null, "too far");
  assert.equal(interactScore(cand(0, 1.5), v), null, "behind");
  // 35° off the view is the edge
  const s = Math.sin((34 * Math.PI) / 180), c = Math.cos((34 * Math.PI) / 180);
  assert.notEqual(interactScore(cand(s * 1.5, -c * 1.5), v), null);
  const s2 = Math.sin((36 * Math.PI) / 180), c2 = Math.cos((36 * Math.PI) / 180);
  assert.equal(interactScore(cand(s2 * 1.5, -c2 * 1.5), v), null);
  // a floor below (the keep's basement under the hall) is out of reach
  assert.equal(interactScore(cand(0, -1, -6), v), null);
  assert.notEqual(interactScore(cand(0, -1, 1.4), v), null);
  // standing over it: the view no longer matters
  assert.notEqual(interactScore(cand(0, 0.4), v), null);
  // yaw π/2 looks toward −x
  assert.notEqual(interactScore(cand(-1.5, 0), at(0, 0, Math.PI / 2)), null);
  assert.equal(interactScore(cand(1.5, 0), at(0, 0, Math.PI / 2)), null);
});

test("the nearest wins; the one looked at wins a near tie; the current one sticks", () => {
  const v = at(0, 0);
  // the two NPCs at the gate: nearest first
  assert.equal(pickInteractable([cand(0, -1.8), cand(0.2, -1.2)], v), 1);
  // same distance: the one straight ahead
  const off = (deg: number, d: number) => cand(Math.sin((deg * Math.PI) / 180) * d, -Math.cos((deg * Math.PI) / 180) * d);
  assert.equal(pickInteractable([off(30, 1.5), off(2, 1.5)], v), 1);
  // the current pick is kept unless another is better by more than 0.25
  assert.equal(pickInteractable([cand(0, -1.5), cand(0, -1.4)], v, 0), 0);
  assert.equal(pickInteractable([cand(0, -1.5), cand(0, -1.1)], v, 0), 1);
  assert.equal(pickInteractable([cand(0, -5)], v), -1);
});

/** A host driven by the test: the player's view, the button, what was shown and played. */
function host(view: InteractView | null = at(0, 0)) {
  const log: string[] = [];
  const h = {
    view: view as InteractView | null,
    pressed: false,
    held: false,
    blocked: false,
    shown: null as string | null,
    progress: undefined as number | undefined,
    clip: null as string | null,
    seen: true,
  };
  const api: InteractHost = {
    view: () => h.view,
    pressed: () => h.pressed,
    held: () => h.held,
    blocked: () => h.blocked,
    show: (t, p) => {
      h.shown = t;
      h.progress = p;
      log.push(`show ${t}${p === undefined ? "" : ` ${p.toFixed(2)}`}`);
    },
    hold: (c) => {
      h.clip = c;
      log.push(`hold ${c}`);
    },
    sight: () => h.seen,
  };
  return { h, api, log };
}

test("prompt, press, use once; nothing while blocked", () => {
  const { h, api } = host();
  const set = new Interactables(api);
  const used: string[] = [];
  set.add({ id: "chest", pos: { x: 0, y: 0, z: -1.5 }, label: "打开箱子", use: () => used.push("chest") });
  set.update(0.016);
  assert.equal(h.shown, "E 打开箱子");
  assert.equal(set.current?.id, "chest");
  // a scripted line is spoken: no prompt, a press does nothing
  h.blocked = true;
  h.pressed = true;
  set.update(0.016);
  assert.equal(h.shown, null);
  assert.deepEqual(used, []);
  h.blocked = false;
  set.update(0.016);
  assert.deepEqual(used, ["chest"]);
  assert.equal(h.shown, null);
  assert.equal(set.get("chest"), null, "used once");
  set.update(0.016);
  assert.deepEqual(used, ["chest"]);
});

test("enabled, labels, reusable targets wait for their use to settle", async () => {
  const { h, api } = host();
  const set = new Interactables(api, { radius: 3 });
  let open = false;
  let finish!: () => void;
  const it = set.add({
    id: "door",
    pos: () => ({ x: 0, y: 0, z: -2.5 }),
    label: () => (open ? "关门" : "开门"),
    enabled: () => true,
    once: false,
    use: () => new Promise<void>((r) => (finish = () => ((open = !open), r()))),
  });
  set.update(0.016);
  assert.equal(h.shown, "E 开门", "radius from the options (3 m)");
  it.enabled = false;
  set.update(0.016);
  assert.equal(h.shown, null);
  it.enabled = null;
  h.pressed = true;
  set.update(0.016);
  h.pressed = false;
  // busy until the use settles
  set.update(0.016);
  assert.equal(h.shown, null);
  finish();
  await new Promise((r) => setImmediate(r));
  set.update(0.016);
  assert.equal(h.shown, "E 关门");
  it.label = "锁门";
  set.update(0.016);
  assert.equal(h.shown, "E 锁门");
});

test("a hold target needs the button held for 1.5 s, kneeling meanwhile; letting go cancels", () => {
  const { h, api, log } = host();
  const set = new Interactables(api, { holdClip: "Fixing_Kneeling" });
  let used = 0;
  set.add({ id: "cocoon", pos: { x: 0, y: 0.5, z: -1 }, label: "搜查", hold: true, use: () => used++ });
  set.update(0.1);
  h.pressed = h.held = true;
  set.update(0.1);
  h.pressed = false;
  assert.equal(h.clip, "Fixing_Kneeling");
  assert.equal(h.progress, 0);
  for (let i = 0; i < 7; i++) set.update(0.1);
  assert.ok(Math.abs(h.progress! - 0.7 / 1.5) < 1e-9);
  // let go: the kneel ends, nothing used
  h.held = false;
  set.update(0.1);
  assert.equal(h.clip, null);
  assert.equal(used, 0);
  assert.equal(h.shown, "E 搜查");
  // held without a fresh press: no hold
  h.held = true;
  set.update(0.1);
  assert.equal(set.holdProgress, null);
  // a fresh press, held to the end (looking away doesn't matter meanwhile)
  h.pressed = true;
  set.update(0.1);
  h.pressed = false;
  h.view = at(0, 0, Math.PI);
  for (let i = 0; i < 14; i++) set.update(0.1);
  assert.equal(used, 0);
  set.update(0.1);
  assert.equal(used, 1);
  assert.equal(h.clip, null);
  assert.ok(log.includes("hold null"));
});

test("a hold is cancelled by walking off or a line starting; seconds per target", () => {
  const { h, api } = host();
  const set = new Interactables(api, { holdClip: "Kneel" });
  let used = 0;
  set.add({ id: "a", pos: { x: 0, y: 0, z: -1 }, label: "A", hold: 0.5, clip: null, use: () => used++ });
  h.pressed = h.held = true;
  set.update(0.1);
  h.pressed = false;
  assert.equal(h.clip, null, "the target asked for no clip");
  h.view = at(0, 3);
  set.update(0.1);
  assert.equal(set.holdProgress, null, "walked off");
  h.view = at(0, 0);
  h.pressed = true;
  set.update(0.1);
  h.pressed = false;
  h.blocked = true;
  set.update(0.1);
  assert.equal(set.holdProgress, null, "a line started");
  h.blocked = false;
  h.pressed = true;
  set.update(0.1);
  h.pressed = false;
  for (let i = 0; i < 5; i++) set.update(0.1);
  assert.equal(used, 1);
});

test("out of sight targets give way to the next one; no view, no prompt; dispose hides it", () => {
  const { h, api } = host();
  const set = new Interactables(api);
  let seen = new Set(["far"]);
  api.sight = (_v, p) => seen.has(p.z === -1 ? "near" : "far");
  set.add({ id: "near", pos: { x: 0, y: 0, z: -1 }, label: "近", use: () => {} });
  set.add({ id: "far", pos: { x: 0, y: 0, z: -1.8 }, label: "远", use: () => {} });
  set.update(0.016);
  assert.equal(h.shown, "E 远");
  seen = new Set(["near", "far"]);
  set.update(0.016);
  assert.equal(h.shown, "E 近");
  h.view = null;
  set.update(0.016);
  assert.equal(h.shown, null);
  h.view = at(0, 0);
  set.update(0.016);
  assert.equal(h.shown, "E 近");
  // a key label from the host
  api.key = () => "A";
  set.update(0.016);
  assert.equal(h.shown, "A 近");
  set.dispose();
  assert.equal(h.shown, null);
  set.update(0.016);
  assert.equal(h.shown, null);
});

test("use(id) fires a target directly (fallbacks); a throwing use is contained", () => {
  const { api } = host(null);
  const set = new Interactables(api);
  let n = 0;
  set.add({ id: "lever", pos: { x: 0, y: 0, z: 0 }, label: "拉下拉杆", use: () => n++ });
  set.add({ id: "bad", pos: { x: 0, y: 0, z: 0 }, label: "x", use: () => { throw new Error("boom"); } });
  const heard: string[] = [];
  set.onUse.on((i) => heard.push(i.id));
  const err = console.error;
  console.error = () => {};
  try {
    assert.ok(set.use("lever"));
    assert.ok(!set.use("lever"));
    assert.ok(set.use("bad"));
  } finally {
    console.error = err;
  }
  assert.equal(n, 1);
  assert.deepEqual(heard, ["lever", "bad"]);
});
