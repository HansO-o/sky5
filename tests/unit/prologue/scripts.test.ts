import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import * as keep from "../../../src/prologue/chapters/keepScript";
import * as exit from "../../../src/prologue/chapters/exitScript";
import { DEFAULT_FLAGS } from "../../../src/prologue/flags";
import type { BeatInfo, Faction, ScriptLine, Trigger } from "../../../src/prologue/chapters/keepScript";

// The beats of the design's beat sheets (docs/design/keep-exit-chapters.md §5.1, §6.1).
const KEEP_BEATS = ["K0", "K1", "K2", "K3", "K4", "K5", "K6", "K7", "K8", "K9", "K10", "K11", "K12"] as const;
const EXIT_BEATS = ["X0", "X1", "X2", "X3", "X4"] as const;
const ROUTES: Faction[] = ["rebel", "imperial"];

const chapters = [
  { name: "keep", beats: KEEP_BEATS, info: keep.KEEP_BEATS, table: keep.KEEP_SCRIPT as Record<string, readonly ScriptLine[]>, lines: keep.lines as (b: string, r: Faction | "both", o?: keep.LinesOptions) => ScriptLine[] },
  { name: "exit", beats: EXIT_BEATS, info: exit.EXIT_BEATS, table: exit.EXIT_SCRIPT as Record<string, readonly ScriptLine[]>, lines: exit.lines as (b: string, r: Faction | "both", o?: keep.LinesOptions) => ScriptLine[] },
];
const ALL: ScriptLine[] = [...keep.KEEP_LINES, ...exit.EXIT_LINES];

/** The banned phrases, read from the build gate itself so the two lists never drift apart. */
function banned(): string[] {
  const src = fs.readFileSync(path.join(process.cwd(), "tools/check-lines.mjs"), "utf8");
  const list = src.match(/const BANNED = \[([\s\S]*?)\];/);
  assert.ok(list, "BANNED list not found in tools/check-lines.mjs");
  const phrases = [...list[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]);
  assert.ok(phrases.length >= 20, `only ${phrases.length} banned phrases parsed`);
  return phrases;
}

/** Every string reachable from a value (the modules' exported data). */
function strings(v: unknown, out: string[] = [], seen = new Set<unknown>()): string[] {
  if (typeof v === "string") out.push(v);
  else if (v && typeof v === "object" && !seen.has(v)) {
    seen.add(v);
    for (const x of Object.values(v)) strings(x, out, seen);
  }
  return out;
}

test("every beat of the beat sheets has lines on both routes, or is marked silent", () => {
  for (const c of chapters) {
    assert.deepEqual(Object.keys(c.table), [...c.beats], `${c.name}: script beats`);
    assert.deepEqual(
      c.info.map((b) => b.id),
      [...c.beats],
      `${c.name}: beat info`,
    );
    for (const b of c.info as readonly BeatInfo[]) {
      for (const r of ROUTES) {
        const n = c.lines(b.id, r).length;
        if (b.silent) assert.equal(n, 0, `${b.id} is marked silent but has ${r} lines`);
        else assert.ok(n > 0, `${b.id} has no ${r} lines and is not marked silent`);
      }
    }
  }
});

test("line ids are unique, carry their beat as prefix, and resolve through line()", () => {
  const ids = ALL.map((l) => l.id);
  const dupes = ids.filter((id, i) => ids.indexOf(id) !== i);
  assert.deepEqual(dupes, [], "duplicate ids");
  for (const c of chapters)
    for (const [beat, ls] of Object.entries(c.table))
      for (const l of ls) assert.ok(l.id.startsWith(beat + "-"), `${l.id} is filed under ${beat}`);
  for (const l of keep.KEEP_LINES) assert.equal(keep.line(l.id as keep.KeepLineId), l);
  for (const l of exit.EXIT_LINES) assert.equal(exit.line(l.id as exit.ExitLineId), l);
  assert.throws(() => keep.line("K99-R1" as keep.KeepLineId));
});

test("no banned phrase in any line, label, objective, bark, prompt, tip or end-card text", () => {
  const phrases = banned();
  const texts = [
    ...strings(keep),
    ...strings(exit),
    // the generated end-card texts, every route and outcome
    ...ROUTES.flatMap((faction) =>
      (["killed", "bluff", "fought"] as const).flatMap((torture) =>
        (["asleep", "killed", "fled", "skipped"] as const).flatMap((beast) =>
          strings(exit.endCard({ faction, outcomes: { torture, beast }, deaths: { e1: 1 } })),
        ),
      ),
    ),
  ];
  assert.ok(texts.length > 300, `only ${texts.length} strings found`);
  for (const t of texts) for (const p of phrases) assert.ok(!t.includes(p), `banned phrase 「${p}」 in ${JSON.stringify(t)}`);
});

test("both routes cover the same mandatory beats and story events", () => {
  // events only one route has: the rebel assistant surrenders, optional records, the imperial bluff
  // broken off, the fungus (cut #1)
  const routeOnly = new Set<Trigger>(["surrender", "read", "attacked", "fungus"]);
  for (const c of chapters) {
    for (const b of c.info as readonly BeatInfo[]) {
      if (b.silent) continue;
      const events: Record<Faction, Set<Trigger>> = { rebel: new Set(), imperial: new Set() };
      for (const r of ROUTES) {
        // every variant of the imperial torture room keeps a main sequence
        const states = r === "imperial" ? [{ torture: "bluff" as const }, { torture: "fought" as const }] : [{ torture: "killed" as const }];
        for (const state of states) {
          const main = c.lines(b.id, r, { on: "main", state }).filter((l) => !l.optional);
          if (!b.optional) assert.ok(main.length > 0, `${b.id}: no mandatory ${r} lines (${state.torture})`);
        }
        for (const l of c.lines(b.id, r)) if (l.on && !routeOnly.has(l.on)) events[r].add(l.on);
      }
      assert.deepEqual([...events.rebel].sort(), [...events.imperial].sort(), `${b.id}: events with lines on one route only`);
      for (const r of ROUTES) assert.equal(b.objective[r].length, b.objective[ROUTES[0]].length, `${b.id}: objective steps differ by route`);
    }
  }
});

test("objectives: every step is text, and only the stairs (K5) have none", () => {
  for (const b of [...keep.KEEP_BEATS, ...exit.EXIT_BEATS] as readonly BeatInfo[]) {
    for (const r of ROUTES) {
      const steps = keep.objectiveOf(b, r);
      assert.equal(steps.length === 0, b.id === "K5", `${b.id} ${r}: ${steps.length} objective steps`);
      for (const s of steps) assert.ok(s.trim().length > 1);
    }
  }
  const k6 = keep.KEEP_BEATS.find((b) => b.id === "K6")!;
  assert.deepEqual(keep.objectiveOf(k6, "imperial", { torture: "bluff" }), ["查看审讯室", "打开笼子"]);
  assert.deepEqual(keep.objectiveOf(k6, "imperial", { torture: "fought" }), ["击败审讯官", "打开笼子"]);
  assert.deepEqual(exit.objectiveOf(exit.EXIT_BEATS[4], "rebel"), ["前往溪谷的柳溪村，找到铁桦家的蜂场"]);
});

test("speaker labels follow the cast: the scribe is 伊沃 only once he has introduced himself", () => {
  const order = ALL.map((l) => l.id);
  const intro = order.indexOf("K1-I6");
  for (const [i, l] of ALL.entries()) {
    if (l.branch === "rebel") assert.notEqual(l.who, "伊沃", `${l.id}: the rebel route never learns his name`);
    if (l.branch !== "rebel" && i <= intro) assert.notEqual(l.who, "伊沃", `${l.id}: 伊沃 before K1-I6`);
    if (l.branch === "imperial" && i > intro) assert.notEqual(l.who, "书记官", `${l.id}: 书记官 after K1-I6`);
  }
  const kaja = order.indexOf("K6-I17");
  for (const [i, l] of ALL.entries()) if (i > kaja) assert.notEqual(l.who, "霜誓军斥候", `${l.id}: the scout gave her name in K6-I17`);
  assert.equal(keep.line("K1-I6").who, "书记官");
  assert.equal(keep.line("K1-I7").who, "伊沃");
});

test("lines the spec shares between the routes keep its id; extra lines quote the spec verbatim", () => {
  // K2-F (布伦 / 伊沃): one shared fallback line, spoken by the route's companion
  const f = keep.line("K2-F");
  assert.deepEqual([f.branch, f.on, f.who, f.alt, f.text], ["both", "fallback", "布伦", "伊沃", "接着！"]);
  for (const r of ROUTES) assert.deepEqual(keep.lines("K2", r, { on: "fallback" }).map((l) => l.id), ["K2-F"], r);
  // the K1 latch loop: the beat sheet's words, before the scribe has a name
  assert.deepEqual(keep.lines("K1", "rebel", { on: "latch" }).map((l) => [l.id, l.who, l.text]), [["K1-RL", "布伦", "门闩卡住了"]]);
  assert.deepEqual(keep.lines("K1", "imperial", { on: "latch" }).map((l) => [l.id, l.who, l.text]), [["K1-IL", "书记官", "门闩卡住了"]]);
  // quotes inside a line are Chinese quotation marks (the spec's tables write ASCII ones)
  for (const l of ALL) assert.ok(!l.text.includes('"'), `${l.id}: ASCII quote in the text`);
  assert.equal(keep.line("K6-I9").text, "我现在就能在上面添一行字——“审讯官奥斯维克，临阵违令，就地处决。”");
  assert.equal(exit.line("X0-I2").text, "我在书记处抄了十年公文，从没有哪一份写过“龙”这个字。");
});

test("lines() picks the scene variant from the flags", () => {
  const ids = (ls: ScriptLine[]) => ls.map((l) => l.id);
  const bluff = ids(keep.lines("K6", "imperial", { state: { torture: "bluff" } }));
  const fought = ids(keep.lines("K6", "imperial", { state: { torture: "fought" } }));
  assert.ok(bluff.includes("K6-I16") && bluff.includes("K6-I14") && !bluff.includes("K6-I16f") && !bluff.includes("K6-IX1") && !bluff.includes("K6-R5"));
  assert.ok(fought.includes("K6-I16f") && fought.includes("K6-IX1") && fought.includes("K6-R5") && !fought.includes("K6-I16") && !fought.includes("K6-I11"));
  const rebel = ids(keep.lines("K6", "rebel", { state: keep.scriptState({ ...DEFAULT_FLAGS, outcomes: { torture: "killed" } }) }));
  assert.ok(rebel.includes("K6-R5") && rebel.includes("K6-R6") && !rebel.some((id) => id.startsWith("K6-I")));
  // no state: every variant
  assert.ok(ids(keep.lines("K9", "imperial")).includes("K9-I1") && ids(keep.lines("K9", "imperial")).includes("K9-I1f"));
  assert.deepEqual(ids(keep.lines("K9", "imperial", { on: "main", state: { torture: "fought" } })), ["K9-I1f", "K9-I2", "K9-I3", "K9-I4"]);
  // the letter line only with the letter
  assert.ok(!ids(exit.lines("X4", "imperial", { state: { letter: false } })).includes("X4-I9"));
  assert.ok(ids(exit.lines("X4", "imperial", { state: { letter: true } })).includes("X4-I9"));
  // "both": only the shared lines (K0 before the choice)
  assert.ok(keep.lines("K0", "both").every((l) => l.branch === "both"));
  assert.deepEqual(ids(keep.lines("K0", "rebel", { on: "commit" })), ["K0-R1", "K0-R2", "K0-R3"]);
  assert.deepEqual(ids(exit.lines("X2", "imperial", { on: "wake" })), ["X2-I7", "X2-I8"]);
});

test("K0 nags alternate between the two NPCs, six of them", () => {
  assert.equal(keep.K0_NAGS.length, keep.KEEP_TIMING.nag.max);
  keep.K0_NAGS.forEach((l, i) => assert.equal(l.who, i % 2 ? "书记官" : "布伦"));
});

test("set-piece timings are mirrored on both routes", () => {
  const at = (ls: ScriptLine[]) => ls.filter((l) => l.at !== undefined).map((l) => l.at);
  for (const b of ["K12"] as const) assert.deepEqual(at(keep.lines(b, "rebel")), at(keep.lines(b, "imperial")));
  for (const b of ["X1", "X2", "X4"] as const) assert.deepEqual(at(exit.lines(b, "rebel")), at(exit.lines(b, "imperial")), b);
  const p = exit.EXIT_TIMING.platform;
  assert.deepEqual(at(exit.lines("X4", "rebel")), [p.first, p.overhead, p.roar, p.closing]);
  assert.deepEqual(at(keep.lines("K12", "imperial")), [keep.KEEP_TIMING.standoff.shout, keep.KEEP_TIMING.standoff.at, keep.KEEP_TIMING.standoff.closing]);
});

test("the player's name is a {name} placeholder, filled with a fallback", () => {
  for (const l of ALL) {
    assert.ok(!l.text.includes("${"), `${l.id}: template syntax left in the text`);
    for (const m of l.text.matchAll(/\{(\w+)\}/g)) assert.equal(m[1], "name", `${l.id}: unknown placeholder {${m[1]}}`);
  }
  assert.equal(keep.fill(keep.line("K0-03").text, { name: "艾拉" }), "西墙根有道送柴的小门，帝国人从来懒得锁。艾拉，跟我走！");
  assert.equal(keep.fill("{name}！这边！"), `${keep.DEFAULT_NAME}！这边！`);
  assert.equal(keep.fill("{name}！这边！", { name: "" }), "朋友！这边！");
  assert.equal(exit.fill(exit.EXECUTION_LIST.rows[exit.EXECUTION_LIST.struck], { name: "艾拉", homeland: "寒脊" }), "艾拉 寒脊人 ——添");
  const named = ALL.filter((l) => l.text.includes("{name}")).map((l) => l.id);
  for (const id of ["K0-03", "K0-04", "K12-R5", "K12-I5", "X4-R5", "X4-I5"]) assert.ok(named.includes(id), `${id} names the player`);
});

test("the end card reads the outcomes", () => {
  const card = exit.endCard({ faction: "imperial", outcomes: { torture: "bluff", beast: "fled" }, deaths: { e1: 2, e5: 1 } });
  assert.equal(card.title, "雾门镇 · 序章 · 完");
  assert.equal(card.epilogue, "你随书记官伊沃·塔兰逃出了雾门镇。你的名字，已从名单上划去。");
  assert.equal(card.summary, "阵营 帝国 · 审讯室 一张空白手令 · 巨狼 从狼口逃生 · 倒下 3 次");
  assert.equal(card.otherPath, "另一条路仍在等你：跟随布伦");
  assert.equal(exit.endCard({ outcomes: {}, deaths: {} }).summary, "阵营 霜誓军 · 审讯室 — · 巨狼 — · 倒下 0 次");
});

test("bark pools are non-empty and the companion specials are there", () => {
  for (const pools of [keep.KEEP_BARKS, exit.EXIT_BARKS])
    for (const [k, p] of Object.entries(pools)) {
      assert.ok(p.who.length > 0, k);
      assert.ok(p.lines.length > 0, k);
    }
  assert.deepEqual(keep.KEEP_BARKS.brun.taunt, ["冲我来！"]);
  assert.deepEqual(keep.KEEP_BARKS.ivo.shieldWall, ["我、我挡着——快喝药！"]);
  assert.equal(keep.KEEP_BARKS.assistant.surrender.length, 1);
});
