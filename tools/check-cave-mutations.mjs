// Mutation test of the cave build gate (tools/gen/cave.mjs, design §4.3 validator and the joins it owns).
// Each mutation edits a copy of cave.mjs the way a careless change could break the cave, and the build
// (buildCave up to its first emit: the field validator in buildCaveData, then the checks of the decoded
// GLBs: the walk, the town-chapter set, the deck's enclosure, rails, gate boxes and the perch ramp) must
// fail with the expected message. The unmutated source must reach its first emit. Nothing is written
// to public/: emit throws before the first file. About 50 s per run, 4 at a time (21 runs: ~5 min).
//   node tools/check-cave-mutations.mjs              every mutation
//   node tools/check-cave-mutations.mjs sealed drain  the names containing any of the words
// Copies are written next to cave.mjs (tools/gen/.cave-mutant-*.mjs, so its imports resolve) and removed.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const SELF = fileURLToPath(import.meta.url);
const ROOT = path.resolve(path.dirname(SELF), "..");
const GEN = path.join(ROOT, "tools/gen");
const SRC = path.join(ROOT, "assets-src");
const MARK = "@@cave-mutation ";

// ---- child: run one copy up to its first emit
if (process.argv[2] === "--child") {
  const file = process.argv[3];
  class Reached extends Error {}
  let out;
  try {
    const m = await import(pathToFileURL(file).href);
    await m.buildCave({
      emit: async () => {
        throw new Reached("first emit");
      },
      SRC,
    });
    out = { passed: true, note: "returned without emitting" };
  } catch (e) {
    out = e instanceof Reached ? { passed: true } : { passed: false, message: String(e?.message ?? e) };
  }
  process.stdout.write("\n" + MARK + JSON.stringify(out) + "\n");
  process.exit(0);
}

/** A solid wall (negative = rock) spliced into air(): d = max(d, −wall). */
const wallInAir = (expr) => [
  "  return d;\n}\n\n// ------------------------------------------------------------------ terrain, outcrop, field S",
  `  d = Math.max(d, -(${expr}));\n  return d;\n}\n\n// ------------------------------------------------------------------ terrain, outcrop, field S`,
];
/** A vertical slab 2·half m thick across a tunnel at (cx, cz) with horizontal tangent (tx, tz), radius 8 m. */
const slab = (cx, cz, tx, tz, half) => `Math.max(Math.abs((x - (${cx})) * (${tx}) + (z - (${cz})) * (${tz})) - ${half}, Math.hypot(x - (${cx}), z - (${cz})) - 8)`;

/** name, what it breaks, source edits [old, new] (each must match exactly once), expected failure. */
const MUTATIONS = [
  { name: "baseline", what: "the unmutated source", edits: [], expect: null },
  {
    name: "no_cap",
    what: "no cap over EXIT_HOLE",
    edits: [["return smin(smin(smin(b, h, 1.5), s, 1.2), c, 1.5);", "return smin(smin(b, h, 1.5), s, 1.2);"]],
    expect: /EXIT_HOLE is not covered by the outcrop/,
  },
  {
    name: "no_mouth_constraint",
    what: "the tunnel ignores the runtime terrain collider at the mouth",
    edits: [["if (top > -Infinity && top - y < 2.5)", "if (false)"]],
    expect: /runtime terrain collider reaches into the tunnel/,
  },
  {
    name: "no_stair_ramp",
    what: "no ramp collider on the terraced stair",
    edits: [["          colliders[group].tri(p00, p01, p11);\n          colliders[group].tri(p00, p11, p10);", "          void group;"]],
    expect: /stair ramp|no collider|anchor (cp_light|bend|stub84)/,
  },
  {
    name: "drain_wide",
    what: "the cave's drain box 10 cm wider than the keep's opening",
    edits: [["box: { min: [DRAIN_KEEP.min[0] + 0.01,", "box: { min: [DRAIN_KEEP.min[0] - 0.1,"]],
    expect: /drain plane lie outside the keep's opening/,
  },
  {
    name: "hood_low",
    what: "the hood lowered to 56.5",
    edits: [["hood: { min: [-23, 53.5, -681], max: [-7.8, 62.5, -674], r: 1.5 },", "hood: { min: [-23, 53.5, -681], max: [-7.8, 56.5, -674], r: 1.5 },"]],
    expect: /opens to the terrain surface|opens through the outcrop|no ceiling|rock cover/,
  },
  {
    name: "sealed_exit",
    what: "an 0.8 m rock wall sealing the exit climb at s ≈ 50 (x −52…−38, z −676.5…−675.7)",
    edits: [wallInAir("sdBox(x, y, z, [-52, 30, -676.5], [-38, 60, -675.7])")],
    expect: /walk path breach → balcony_mouth broken: exit s [\d.]+…[\d.]+ \(sealed/,
  },
  {
    name: "sealed_toDen",
    what: "a 1 m rock wall across toDen at (−6, −741)",
    edits: [wallInAir(slab(-6, -741, -0.7964, 0.6048, 0.5))],
    expect: /walk path breach → balcony_mouth broken: toDen s [\d.]+…[\d.]+ \(sealed/,
  },
  {
    name: "sealed_exit_decoded",
    what: "sealed_exit with the field validator switched off: the decoded-GLB walk alone must fail",
    edits: [
      wallInAir("sdBox(x, y, z, [-52, 30, -676.5], [-38, 60, -675.7])"),
      ['if (report.errors.length) throw new Error("cave validation failed:', 'if (false) throw new Error("cave validation failed:'],
    ],
    expect: /encoded colliders fail[\s\S]*walk: gap of [\d.]+ m outside the chasm between exit/,
  },
  {
    name: "narrow_toSpider",
    what: "toSpider narrowed to half-width 0.45 between the chambers",
    edits: [["toSpider: [[48, 28.0, -731, 2.2, 3.4], [47, 28.0, -741, 2.0, 3.3], [42, 28.2, -746, 2.0, 3.2], [32, 28.4, -749, 1.9, 3.2], [18, 28.5, -750, 2.2, 3.4]],", "toSpider: [[48, 28.0, -731, 2.2, 3.4], [47, 28.0, -741, 0.45, 3.3], [42, 28.2, -746, 0.45, 3.2], [32, 28.4, -749, 0.45, 3.2], [18, 28.5, -750, 2.2, 3.4]],"]],
    expect: /half-width 0\.\d\d m < 0\.9 across the tunnel at toSpider/,
  },
  {
    name: "pinch_toDen",
    what: "toDen pinched to a 1.4 m wide waist (two rock pillars r 0.6 m, 1.3 m either side of the centreline at (−6, −741))",
    edits: [wallInAir(`Math.max(Math.min(Math.hypot(x - (-6 - 0.6048 * 1.3), z - (-741 - 0.7964 * 1.3)), Math.hypot(x - (-6 + 0.6048 * 1.3), z - (-741 + 0.7964 * 1.3))) - 0.6, Math.abs(y - 31) - 3)`)],
    expect: /half-width 0\.\d\d m < 0\.9 across the tunnel at toDen/,
  },
  {
    name: "low_toDen",
    what: "toDen's ceiling lowered to 2.2 m over 3 m (rock from 2.2 m above the 29.87 floor at (−6, −741))",
    edits: [wallInAir(`Math.max(${slab(-6, -741, -0.7964, 0.6048, 1.5)}, 32.07 - y)`)],
    expect: /walk path breach → balcony_mouth broken: toDen s [\d.]+…[\d.]+ \(low|clearance [\d.]+ m < 2\.6/,
  },
  // ---- the outdoor set (cave/outcrop shown with the town, cave/mesh not loaded), the enclosure, the gates
  {
    name: "skin_crack",
    what: "the outcrop skin's border left where surface nets put it (up to 0.6 m above the render terrain on the steep west slope)",
    edits: [['      cls0[t] = "outcrop";\n      groundKept++;', "      groundKept++;"]],
    expect: /the outcrop skin's border is not under the render terrain/,
  },
  {
    name: "stub_in_cave",
    what: "the cave in front of the mouth plug ships in cave/mesh (zone E), not in cave/outcrop",
    edits: [['return inStub(c) ? "O" : zoneOf(c[0], c[1], c[2]);', "return zoneOf(c[0], c[1], c[2]);"]],
    expect: /muster set \(cave\/outcrop without cave\/mesh\): \d+ of \d+ rays toward zone E reach the void/,
  },
  {
    name: "stub_no_collider",
    what: "the stub's collider (rock floor in front of the plug) ships in cave_E_col, its render still in cave/outcrop",
    edits: [["cGroup[t] = groupOf(cIdx, t);", 'cGroup[t] = isStub(cIdx, t) ? "E" : groupOf(cIdx, t);']],
    expect: /muster set: \d+ of \d+ standable floors outside the mouth plug have no collider within 0\.45 m/,
  },
  {
    name: "hood_short",
    what: "the hood ends at x −15 (the earlier outcrop): east of it the deck's N edge runs on as a shelf onto the hillside",
    edits: [["hood: { min: [-23, 53.5, -681], max: [-7.8, 62.5, -674], r: 1.5 },", "hood: { min: [-23, 53.5, -681], max: [-15, 62.5, -674], r: 1.5 },"]],
    expect: /enclosure: the capsule \(step 0\.45, slopes ≤ 50°, jump [\d.]+ m\) from the platform (leaves the outcrop|reaches the terrain|leaves the rails' envelope)/,
  },
  {
    name: "no_W_wall",
    what: "no wall over the shoulder: from the outcrop's top (reachable from the hillside) one drops onto the deck",
    edits: [["      W: { a: [-21.8, -674.2], b: [-21.8, -667], y: [55.55, 66] },\n", ""]],
    expect: /enclosure: the capsule from the hillside reaches the (platform|mouth)/,
  },
  {
    name: "rails_low",
    what: "the S and E rails 0.2 m high",
    edits: [
      ["S: { a: [-21.8, -667], b: [-11, -667], y: [55.55, 66] },", "S: { a: [-21.8, -667], b: [-11, -667], y: [55.55, 56.25] },"],
      ["E: { a: [-11, -675.2], b: [-11, -667], y: [55.55, 66] },", "E: { a: [-11, -675.2], b: [-11, -667], y: [55.55, 56.25] },"],
    ],
    expect: /rails: only 0\.\d\d m above the deck/,
  },
  {
    name: "no_perch_ramp",
    what: "no perch ramp collider: the 2.2 m perch box cannot be climbed",
    edits: [["    colliders.A.quad([xFoot, fFoot, z1 + 0.05], [xTop, PERCH.top, z1 + 0.05], [xTop, PERCH.top, z0 - 0.05], [xFoot, fFoot, z0 - 0.05]);\n", ""]],
    expect: /perch: the decoded ramp does not climb from perch_foot to the perch top/,
  },
  {
    name: "web_narrow",
    what: "the web walls' box colliders a quarter of their width: the player walks round them",
    edits: [["col.box(centre, [0.3, Hh / 2, W / 2 - 0.2], [t, [0, 1, 0], sec.r]);", "col.box(centre, [0.3, Hh / 2, W / 8], [t, [0, 1, 0], sec.r]);"]],
    expect: /gate web_A: its box \([\d., ]+ half extents\) does not cover the tunnel section in its plane[\s\S]*gate web_B: its box/,
  },
  {
    name: "plug_narrow",
    what: "the mouth plug's box a quarter of the tunnel's width",
    edits: [["col.box(cc, [0.2, Hh / 2, W / 2], [t, [0, 1, 0], sec.r]);", "col.box(cc, [0.2, Hh / 2, W / 8], [t, [0, 1, 0], sec.r]);"]],
    expect: /gate outcrop_mouth_plug: its box \([\d., ]+ half extents\) does not cover the tunnel section in its plane/,
  },
];

// ---- parent
const words = process.argv.slice(2).filter((a) => !a.startsWith("-"));
const list = MUTATIONS.filter((m) => !words.length || m.name === "baseline" || words.some((w) => m.name.includes(w)));
const source = fs.readFileSync(path.join(GEN, "cave.mjs"), "utf8");
for (const f of fs.readdirSync(GEN)) if (f.startsWith(".cave-mutant-")) fs.rmSync(path.join(GEN, f));

const files = [];
for (const m of list) {
  let s = source;
  for (const [a, b] of m.edits) {
    const n = s.split(a).length - 1;
    if (n !== 1) throw new Error(`mutation ${m.name}: the edit matches ${n} times in cave.mjs (want 1): ${a.slice(0, 80)}`);
    s = s.replace(a, () => b);
  }
  m.file = path.join(GEN, `.cave-mutant-${m.name}.mjs`);
  fs.writeFileSync(m.file, s);
  files.push(m.file);
}

function run(m) {
  return new Promise((resolve) => {
    const t = performance.now();
    const child = spawn(process.execPath, [SELF, "--child", m.file], { cwd: ROOT, stdio: ["ignore", "pipe", "pipe"] });
    let out = "", err = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    child.on("close", (code) => {
      const line = out.split("\n").find((l) => l.startsWith(MARK));
      const r = line ? JSON.parse(line.slice(MARK.length)) : { passed: false, message: `child exited ${code} without a result\n${err.slice(-2000)}` };
      r.s = ((performance.now() - t) / 1000).toFixed(0);
      resolve(r);
    });
  });
}

let failures = 0;
try {
  const queue = [...list], jobs = Math.max(1, Math.min(4, os.availableParallelism?.() ?? os.cpus().length));
  console.log(`cave mutations: ${list.length} runs, ${jobs} at a time`);
  await Promise.all(
    Array.from({ length: jobs }, async () => {
      for (let m = queue.shift(); m; m = queue.shift()) {
        const r = await run(m);
        const caught = !r.passed && m.expect !== null && m.expect.test(r.message);
        const ok = m.expect === null ? r.passed : caught;
        if (!ok) failures++;
        const first = r.passed ? "" : (r.message.split("\n").find((l) => m.expect?.test(l)) ?? r.message.split("\n").slice(0, 2).join(" / ")).trim();
        console.log(`${ok ? "ok  " : "FAIL"} ${m.name.padEnd(20)} ${String(r.s).padStart(3)} s  ${m.expect === null ? (r.passed ? "passes" : "fails: " + r.message.split("\n").slice(0, 4).join(" / ")) : r.passed ? "NOT CAUGHT (the build would pass)" : (caught ? "caught: " : "failed, but not with the expected message: ") + first.slice(0, 220)}`);
      }
    }),
  );
} finally {
  for (const f of files) fs.rmSync(f, { force: true });
}
console.log(failures ? `\n${failures} of ${list.length} runs wrong` : `\nall ${list.length} runs as expected`);
process.exit(failures ? 1 : 0);
