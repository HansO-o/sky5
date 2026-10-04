import { test } from "node:test";
import assert from "node:assert/strict";
import { Cancelled, Director, type DialogueSink } from "../../../src/prologue/Director";

/** Subtitles as a log ("who: text" / "-"), plus what is on screen now. */
function sink() {
  const s = { now: null as string | null, log: [] as string[] };
  const d: DialogueSink = {
    subtitle: (who, text) => {
      s.now = `${who}: ${text}`;
      s.log.push(s.now);
    },
    clearSubtitle: () => {
      s.now = null;
      s.log.push("-");
    },
  };
  return { s, d };
}

const flush = () => new Promise((r) => setImmediate(r));
/** Run the clock for `seconds` in `dt` steps, letting scripts continue between frames. */
async function run(dir: Director, seconds: number, dt = 0.05) {
  for (let t = 0; t < seconds - 1e-9; t += dt) {
    dir.update(dt);
    await flush();
  }
}

test("say shows the line for its reading time and clears it", async () => {
  const { s, d } = sink();
  const dir = new Director({ dialogue: d, readingTime: () => 2 });
  const sc = dir.scope();
  let done = false;
  void sc.say("布伦", "走。").then(() => (done = true));
  await flush();
  assert.equal(s.now, "布伦: 走。");
  assert.ok(dir.speaking && sc.speaking);
  await run(dir, 1.9);
  assert.ok(!done);
  await run(dir, 0.2);
  assert.ok(done);
  assert.equal(s.now, null);
  assert.ok(!dir.speaking);
});

test("holding the skip button ends a line early (after 0.3 s of it, a 0.35 s hold), gap cut short", async () => {
  const { s, d } = sink();
  let held = false;
  const dir = new Director({ dialogue: d, readingTime: () => 5, skipHeld: () => held });
  const sc = dir.scope();
  let done = -1;
  void sc.say("伊沃", "……抱歉。", { gap: 2 }).then(() => (done = dir.time));
  await flush();
  await run(dir, 0.5);
  held = true;
  await run(dir, 0.8);
  assert.ok(done > 0 && done < 1.2, `ended at ${done}`);
  assert.equal(s.now, null);
});

test("a chapter can turn skipping off, per scope or per line", async () => {
  const { d } = sink();
  const dir = new Director({ dialogue: d, readingTime: () => 1.5, skipHeld: () => true });
  const sc = dir.scope();
  sc.skipLines = false;
  let a = -1, b = -1;
  void sc.say("书记官", "选吧。").then(() => (a = dir.time));
  await run(dir, 1.6);
  assert.ok(a >= 1.5, "not skippable in this scope");
  void sc.say("书记官", "快！", { skip: true }).then(() => (b = dir.time));
  // the button has been down since before this line: it must be released first
  await run(dir, 1);
  assert.equal(b, -1);
});

test("barks: non-blocking, dropped during a line, paced per speaker, cleared on time", async () => {
  const { s, d } = sink();
  const dir = new Director({ dialogue: d, readingTime: () => 2 });
  const sc = dir.scope();
  assert.ok(sc.bark("布伦", "来啊，帝国佬！", { duration: 1 }));
  assert.equal(s.now, "布伦: 来啊，帝国佬！");
  assert.ok(!sc.bark("布伦", "好一斧！"), "same speaker within 4 s");
  await run(dir, 1.1);
  assert.equal(s.now, null, "a bark goes after its time");
  // a line takes the subtitle; barks wait it out (dropped)
  void sc.say("伊沃", "等他砍空了再还手！");
  await flush();
  assert.ok(!dir.bark("帝国兵", "叛贼！"));
  assert.equal(s.now, "伊沃: 等他砍空了再还手！");
  await run(dir, 2.1);
  assert.ok(dir.bark("帝国兵", "叛贼！", { duration: 3 }));
  // a line that starts over a bark replaces it, and the bark's end doesn't clear the line
  void sc.say("伊沃", "举盾！");
  await flush();
  await run(dir, 1.5);
  assert.equal(s.now, "伊沃: 举盾！");
  await run(dir, 0.6);
  assert.equal(s.now, null);
});

test("overlapping lines: the older one ending doesn't clear the newer", async () => {
  const { s, d } = sink();
  const dir = new Director({ dialogue: d, readingTime: (t) => (t === "A" ? 1 : 2) });
  const sc = dir.scope();
  void sc.say("x", "B");
  await run(dir, 0.5);
  void sc.say("y", "A");
  await run(dir, 1.1);
  // A (newer) ended and cleared; B (older) ends at 2 s without clearing anything new
  assert.equal(s.now, null);
  void sc.say("z", "A");
  await run(dir, 0.5);
  assert.equal(s.now, "z: A");
  await run(dir, 0.2);
  assert.equal(s.now, "z: A", "B ending at 2 s leaves z's line up");
});

test("a cancelled scope's line ends (no longer speaking), its waits reject", async () => {
  const { d } = sink();
  const dir = new Director({ dialogue: d, readingTime: () => 3 });
  const sc = dir.scope();
  const p = sc.say("布伦", "走。");
  await run(dir, 0.5);
  sc.cancel();
  await assert.rejects(p, Cancelled);
  assert.ok(!dir.speaking);
  assert.ok(!sc.bark("布伦", "走！"));
  dir.cancelAll();
  assert.ok(!dir.bark("布伦", "走！"));
});

test("a line whose speaker or look target throws still ends: no one is left speaking", async () => {
  const { s, d } = sink();
  const dir = new Director({ dialogue: d, readingTime: () => 2 });
  const sc = dir.scope();
  const missing = () => {
    // what `head(k) = () => w.npcs.get(k)!.root...` does once the NPC is gone
    throw new TypeError("Cannot read properties of undefined (reading 'root')");
  };
  const npc = { play: () => undefined, lookAt: () => undefined } as unknown as NonNullable<Parameters<typeof sc.say>[2]>["npc"];
  await assert.rejects(sc.say("布伦", "走。", { npc, look: missing }), TypeError);
  assert.ok(!dir.speaking, "the failed line ended");
  assert.equal(s.now, null, "and took its subtitle down");
  // a speaker whose clip fails the same way
  const broken = { play: () => { throw new Error("no clip"); }, lookAt: () => undefined } as unknown as typeof npc;
  await assert.rejects(sc.say("布伦", "走。", { npc: broken, talk: "Talk" }), /no clip/);
  assert.ok(!dir.speaking);
  // the rest of the session is unaffected: barks play, later lines run and end
  assert.ok(dir.bark("帝国兵", "叛贼！", { duration: 0.5 }));
  await run(dir, 0.6);
  let done = false;
  void sc.say("伊沃", "这边。").then(() => (done = true));
  await flush();
  assert.ok(dir.speaking);
  await run(dir, 2.1);
  assert.ok(done && !dir.speaking);
});

test("resetBarks lets every speaker bark again (a new chapter)", async () => {
  const { d } = sink();
  const dir = new Director({ dialogue: d });
  const soldier = {} as unknown as NonNullable<Parameters<typeof dir.bark>[2]>["npc"];
  assert.ok(dir.bark("帝国兵", "站住！", { npc: soldier, duration: 0.2 }));
  await run(dir, 2);
  assert.ok(!dir.bark("帝国兵", "站住！", { npc: soldier }), "cooldown");
  dir.resetBarks();
  assert.ok(dir.bark("帝国兵", "站住！", { npc: soldier }));
});
