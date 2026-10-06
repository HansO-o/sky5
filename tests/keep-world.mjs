// The keep chapter's world, checkpoint by checkpoint (design §11): each `?debug&chapter=keep&from=N`
// start must put the player on the floor of the right level (no fall-through, no stuck-in-wall:
// feet within 0.3 m of the expected floor for 3 s), with the right lighting profile, and the
// screenshot (/tmp/claude-0/shots/kw-<step>[i].png) must show the room. WebGL on SwiftShader.
// Then the K3→K5 route between the checkpoints (§12: hall → storeroom → stair door → both flights →
// B1 → B2 → torture door → B3):
//   - a route probe: rays down every 0.25 m over the stairwell and its landings must meet the keep's
//     own colliders at the floor the stairs put there (never the terrain), the ground floor must have
//     no terrain over it anywhere, and the ground at the keep's outer wall feet must be whole;
//   - a scripted walk (camera yaw steered at waypoints, W held), down flight A along its east side,
//     back up it, down again and on to B3: no stall longer than 2 s, the feet never more than 0.4 m
//     off the floor the route expects there.
//   node tests/keep-world.mjs            (steps 0–4 on the rebel route, 1–2 on the imperial one, the route)
//   STEPS=0,4 FACTIONS=rebel ROUTE=0 node tests/keep-world.mjs
import fs from "node:fs";
import { chromium } from "playwright-core";

const TS = process.env.TS ?? "1";
const SHOTS = process.env.SHOTS ?? "/tmp/claude-0/shots";
const STEPS = (process.env.STEPS ?? "0,1,2,3,4").split(",").map(Number);
const FACTIONS = (process.env.FACTIONS ?? "rebel,imperial").split(",").filter(Boolean);
const ROUTE = process.env.ROUTE !== "0";
/** the profile each step stands in */
const PROFILE = { 0: "outdoor", 1: "hall", 2: "hall", 3: "hall", 4: "basement", 5: "basement", 6: "basement", 7: "cave", 8: "cave" };

const browser = await chromium.launch({
  executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
  args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"],
});
const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok });
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? "  " + detail : ""}`);
};

async function run(step, faction) {
  const tag = `${step}${faction === "imperial" ? "i" : ""}`;
  const page = await (await browser.newContext({ viewport: { width: 960, height: 540 } })).newPage();
  const errors = [];
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  page.on("pageerror", (e) => errors.push(`${e.message}\n${e.stack}`));
  const t0 = Date.now();
  try {
    await page.goto(`http://localhost:4173/?webgl&debug&chapter=keep&from=${step}&faction=${faction}&timescale=${TS}`);
    await page.waitForFunction(() => performance.getEntriesByName("menu-3d-ready").length > 0, null, { timeout: 180000 });
    await page.click("text=新游戏");
    await page.waitForFunction(
      (s) => {
        const st = window.__game?.stage;
        return st?.chapter?.id === "keep" && st.chapter.step === s && !!st.player && (s === 0 || !!st.underground);
      },
      step,
      { timeout: 600000 },
    );
    // the fade-in, and the zones' first checks
    await page.waitForTimeout(4000);
    const probe = () =>
      page.evaluate(() => {
        const st = window.__game.stage;
        const p = st.player.position;
        const u = st.underground;
        return {
          t: st.world.time,
          p: [p.x, p.y, p.z],
          profile: st.world.env.interior,
          zone: u?.zone ?? null,
          level: u?.level ?? null,
          outdoor: st.world.outdoorVisible,
          origin: u ? u.origin.y : null,
          ground: st.world.heightAt(p.x, p.z),
          bound: st.player.bound,
        };
      });
    const first = await probe();
    const expected = step === 0 ? first.ground : step <= 3 ? first.origin + 0.4 : step <= 6 ? first.origin - 5.6 : null;
    let worst = 0;
    const samples = [];
    const tEnd = first.t + 3;
    for (let i = 0; i < 400; i++) {
      const s = await probe();
      samples.push(s.p[1]);
      if (expected !== null) worst = Math.max(worst, Math.abs(s.p[1] - expected));
      if (s.t >= tEnd) break;
      await page.waitForTimeout(150);
    }
    const last = await probe();
    console.log(`  ${tag}: at (${last.p.map((v) => v.toFixed(2)).join(", ")}) zone ${last.zone} level ${last.level} profile ${last.profile} outdoor ${last.outdoor} bound ${last.bound}; ${samples.length} samples over ${(last.t - first.t).toFixed(1)} s game time (${((Date.now() - t0) / 1000).toFixed(0)} s real)`);
    if (expected !== null) check(`step ${tag}: on the floor (y ${expected.toFixed(2)} ± 0.3)`, worst <= 0.3, `worst ${worst.toFixed(3)} m`);
    const moved = Math.hypot(last.p[0] - first.p[0], last.p[2] - first.p[2]);
    check(`step ${tag}: stands still where placed (not pushed out of a wall)`, moved < 0.25, `moved ${moved.toFixed(3)} m`);
    check(`step ${tag}: profile ${PROFILE[step]}`, last.profile === PROFILE[step], String(last.profile));
    check(`step ${tag}: outdoor world ${step === 0 ? "shown" : "hidden"}`, last.outdoor === (step === 0));
    if (step === 1) check(`step ${tag}: bound`, last.bound === true);
    // the doors' colliders where their leaves are: the gate and the postern shut, the storeroom
    // locked shut, the guard-room door open on the rebel route (Brun leads through it), shut on the imperial one
    const rays = await page.evaluate(() => {
      const st = window.__game.stage;
      const ph = st.physics;
      const V = st.player.position.constructor;
      const ray = (from, dir, max) => ph.rayCastStatic(new V(...from), new V(...dir), max);
      return {
        // (off the seams: between the gate's two leaves, and where the postern's planks meet)
        gate: ray([59.2, 39.5, -651], [0, 0, -1], 4),
        postern: ray([46.4, 39.2, -659.3], [1, 0, 0], 3),
        store: ray([65.0, 39.2, -658.3], [1, 0, 0], 3),
        g2: ray([52.6, 39.2, -657.0], [1, 0, 0], 2.5),
        // from the room toward the gate bar (z −654.48…−654.23) and the postern beam (x 48.27…48.49)
        bar: ray([59.2, 39.43, -657], [0, 0, 1], 4),
        beam: ray([50.5, 39.18, -659.3], [-1, 0, 0], 3),
      };
    });
    const hit = (d, lo, hi) => Number.isFinite(d) && d >= lo && d <= hi;
    if (step >= 1 && step <= 3) {
      check(`step ${tag}: the gate is shut (its leaves block)`, hit(rays.gate, 2, 3.2), String(rays.gate));
      // (on the rebel route the beam's blocker stands in the passage, in front of the leaf)
      check(`step ${tag}: the postern is shut`, hit(rays.postern, faction === "rebel" ? 0.4 : 1, 2.2), String(rays.postern));
      check(`step ${tag}: the storeroom door is shut`, hit(rays.store, 0.6, 1.8), String(rays.store));
      const g2open = faction === "rebel";
      check(`step ${tag}: the guard-room door is ${g2open ? "open" : "shut"}`, g2open ? !hit(rays.g2, 0, 1.6) : hit(rays.g2, 0.4, 1.6), String(rays.g2));
      // the way in is barred on the route's side, and its blocker reaches over the bar or beam drawn there
      if (faction === "imperial") check(`step ${tag}: the gate's blocker covers its bar`, Number.isFinite(rays.bar) && -657 + rays.bar <= -654.5, `stops at z ${(-657 + rays.bar).toFixed(2)}`);
      else check(`step ${tag}: the postern's blocker covers its beam`, Number.isFinite(rays.beam) && 50.5 - rays.beam >= 48.5, `stops at x ${(50.5 - rays.beam).toFixed(2)}`);
    }
    if (step === 2) {
      // swing the gate and the postern open: their colliders go with the leaves, and the outdoor
      // world shows through them from the ground floor; shut again, it goes
      const open = await page.evaluate(async () => {
        const st = window.__game.stage;
        const ph = st.physics;
        const V = st.player.position.constructor;
        const ray = (from, dir, max) => ph.rayCastStatic(new V(...from), new V(...dir), max);
        st.underground.setBlocker("blocker_postern", false);
        st.underground.setBlocker("blocker_gate", false);
        st.gate.set(1);
        st.postern.set(1);
        const r = { gate: ray([59.2, 39.5, -651], [0, 0, -1], 4), postern: ray([46.4, 39.2, -659.3], [1, 0, 0], 3), outdoor: st.world.outdoorVisible };
        st.gate.set(0);
        st.postern.set(0);
        r.outdoorShut = st.world.outdoorVisible;
        return r;
      });
      check(`step ${tag}: the gate opened clears the doorway`, !Number.isFinite(open.gate) || open.gate > 3.5, String(open.gate));
      check(`step ${tag}: the postern opened clears the doorway`, !Number.isFinite(open.postern) || open.postern > 2.5, String(open.postern));
      check(`step ${tag}: the outdoor world shows through an open exterior door, not through a shut one`, open.outdoor === true && open.outdoorShut === false, JSON.stringify(open));
    }
    await page.screenshot({ path: `${SHOTS}/kw-${tag}.png` });
    if (step === 2) {
      // the barred way in, seen from the room: the gate bar (imperial), the postern beam (rebel)
      await page.evaluate((imp) => {
        const st = window.__game.stage, V = st.player.position.constructor;
        const [x, z, yaw] = imp ? [60, -656.4, Math.PI] : [50.2, -659, Math.PI / 2];
        st.player.teleport(new V(x, st.underground.origin.y + 0.42, z), yaw);
        st.world.rig.yaw = yaw;
        st.world.rig.pitch = -0.15;
      }, faction === "imperial");
      await page.waitForTimeout(2500);
      await page.screenshot({ path: `${SHOTS}/kw-${tag}-barred.png` });
    }
    // a look around: the camera turned half way
    await page.evaluate(() => {
      const rig = window.__game.stage.world.rig;
      rig.yaw += Math.PI;
    });
    await page.waitForTimeout(1500);
    await page.screenshot({ path: `${SHOTS}/kw-${tag}-back.png` });
    check(`step ${tag}: no page errors`, errors.length === 0, errors.slice(0, 3).join(" | "));
  } catch (e) {
    check(`step ${tag}: loads`, false, String(e).slice(0, 300));
    await page.screenshot({ path: `${SHOTS}/kw-${tag}-fail.png` }).catch(() => {});
    if (errors.length) console.log("  errors:", errors.slice(0, 5).join("\n  "));
  } finally {
    await page.context().close();
  }
}

/**
 * In the page: the keep's floors in keep-local terms (tools/gen/keepinterior.mjs STAIRS: flight A
 * x 9.9…11.78 from z −1.2 down to −5.4, flight B x 6.6…8.5 from −5.4 down to −1.2, the core between
 * them, the mid landing z −7.78…−5.4 at B(3) = −2.6; the ramps run through the middle of the treads).
 */
const FLOORS = `
  const st = window.__game.stage, u = st.underground, ph = st.physics;
  const V = st.player.position.constructor;
  const O = u.origin;
  const GF = O.y + 0.4, MID = O.y - 2.6, BS = O.y - 5.6, HALF_RISE = 3 / 14 / 2;
  const lerp = (a, b, t) => a + (b - a) * Math.max(0, Math.min(1, t));
  /** the stairwell's floor at (x, z), null off its footprint (undefined: the core, no floor) */
  const stairFloor = (x, z) => {
    const lx = x - O.x, lz = z - O.z;
    if (lx < 6.6 || lx > 11.78 || lz < -7.78 || lz > -1.2) return null;
    if (lz < -5.4) return MID;
    if (lx >= 9.9) return lerp(GF, MID, (-1.2 - lz) / 4.2) - HALF_RISE;
    if (lx <= 8.5) return Math.max(BS, lerp(MID, BS, (lz + 5.4) / 4.2) - HALF_RISE);
    return undefined;
  };
  const down = (x, y, z, max) => {
    const h = ph.rayHitStatic(new V(x, y, z), new V(0, -1, 0), max);
    return h ? { y: y - h.distance, tag: h.body ? ph.tagOf(h.body) ?? "?" : "?" } : null;
  };
`;

async function routeProbe(page) {
  const r = await page.evaluate(new Function(`${FLOORS}
    const out = { stair: 0, stairBad: [], gf: 0, gfTerrain: [], feet: 0, feetBad: [] };
    // the stairwell and its top landing, from under G5's ceiling
    for (let lx = 6.6 + 0.125; lx < 11.78; lx += 0.25)
      for (let lz = -7.78 + 0.125; lz < 0.6; lz += 0.25) {
        const x = O.x + lx, z = O.z + lz;
        const h = down(x, O.y + 4.2, z, 12);
        out.stair++;
        // (the NE corner pilaster stands on the mid landing, floor to ceiling: no floor to check in it)
        const pilaster = lx >= 11.36 && lz <= -7.36;
        const want = pilaster ? null : lz > -1.2 ? GF : stairFloor(x, z);
        const edge = Math.min(Math.abs(lx - 6.6), Math.abs(lx - 8.5), Math.abs(lx - 9.9), Math.abs(lx - 11.78), Math.abs(lz + 7.78), Math.abs(lz + 5.4), Math.abs(lz + 1.2), Math.abs(lz - 0.6));
        if (!h || !h.tag.startsWith("keep_")) out.stairBad.push(\`(\${x.toFixed(2)}, \${z.toFixed(2)}): \${h ? h.tag + " at " + h.y.toFixed(2) : "nothing"}\`);
        else if (want != null && edge > 0.2 && Math.abs(h.y - want) > 0.2) out.stairBad.push(\`(\${x.toFixed(2)}, \${z.toFixed(2)}): \${h.tag} at \${h.y.toFixed(2)}, the floor is \${want.toFixed(2)}\`);
      }
    // the whole ground floor, from 5 cm over it: never the terrain
    for (let x = 48.22 + 0.125; x < 71.78; x += 0.25)
      for (let z = -669.78 + 0.125; z < -654.22; z += 0.25) {
        const h = down(x, GF + 0.05, z, 8);
        out.gf++;
        if (h && h.tag === "terrain") out.gfTerrain.push(\`(\${x.toFixed(2)}, \${z.toFixed(2)}) at \${h.y.toFixed(2)}\`);
      }
    // the outer wall feet east and north (x 72.5, z −670.5), where the terrain's opening overshoots
    const foot = (x, z) => {
      const g = st.world.heightAt(x, z);
      const h = down(x, g + 1, z, 3);
      out.feet++;
      if (!h || h.y < g - 0.06) out.feetBad.push(\`(\${x.toFixed(2)}, \${z.toFixed(2)}): \${h ? h.tag + " at " + h.y.toFixed(2) : "nothing"}, ground \${g.toFixed(2)}\`);
    };
    for (let z = -672; z <= -653; z += 0.25) for (const x of [72.55, 72.8, 73.05, 73.3, 73.8]) foot(x, z);
    for (let x = 47; x <= 74; x += 0.25) for (const z of [-670.55, -670.8, -671.1, -671.35, -671.8]) foot(x, z);
    return out;
  `));
  check("route: the stairwell's floors are the keep's colliders at the stairs' heights, never the terrain", r.stairBad.length === 0, `${r.stair} rays; ${r.stairBad.length} bad: ${r.stairBad.slice(0, 6).join("; ")}`);
  check("route: no terrain over the ground floor", r.gfTerrain.length === 0, `${r.gf} rays; ${r.gfTerrain.length} on terrain: ${r.gfTerrain.slice(0, 6).join("; ")}`);
  check("route: the ground is whole at the keep's east and north wall feet", r.feetBad.length === 0, `${r.feet} rays; ${r.feetBad.slice(0, 6).join("; ")}`);
}

/** Waypoints of the K3→K5 walk: [x, z, level of the leg that ends there]. */
const WALK = [
  // hall → storeroom (its door unlocked and open, as the key ring leaves it)
  [64.8, -658.3, "gf"],
  [67.4, -658.3, "gf"],
  [69.6, -659.6, "gf"],
  // the stair door → the top landing
  [69.7, -661.0, "gf"],
  [70.4, -662.3, "gf"],
  // down flight A along its east side, across the mid landing, down flight B
  [71.38, -662.9, "gf"],
  [71.38, -667.3, "stair"],
  [71.0, -668.7, "stair"],
  [67.55, -668.7, "stair"],
  [67.55, -667.2, "stair"],
  [67.55, -662.4, "bs"],
  // and back up: flight B, the mid landing, flight A on its east side to the top
  [67.55, -667.3, "stair"],
  [68.2, -668.7, "stair"],
  [71.0, -668.6, "stair"],
  [71.38, -667.2, "stair"],
  [71.38, -662.7, "gf"],
  // down again through the middle of the flights, into B1
  [70.85, -662.7, "gf"],
  [70.85, -667.3, "stair"],
  [70.3, -668.7, "stair"],
  [67.55, -668.6, "stair"],
  [67.55, -667.2, "stair"],
  [67.55, -662.4, "bs"],
  // B1 → the corridor B2 → the torture door → B3
  [67.4, -656.4, "bs"],
  [65.5, -656.4, "bs"],
  [60.3, -656.4, "bs"],
  // (round the torture door's leaf, open into B3 along z −657.1 out to x 57.7)
  [58.3, -656.4, "bs"],
  // (west of the brazier at (56.6, −657.4))
  [55.6, -656.4, "bs"],
  [55.5, -660.5, "bs"],
];

async function walkRoute() {
  const page = await (await browser.newContext({ viewport: { width: 960, height: 540 } })).newPage();
  const errors = [];
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  page.on("pageerror", (e) => errors.push(`${e.message}\n${e.stack}`));
  const t0 = Date.now();
  try {
    await page.goto(`http://localhost:4173/?webgl&debug&chapter=keep&from=3&faction=rebel&timescale=1`);
    await page.waitForFunction(() => performance.getEntriesByName("menu-3d-ready").length > 0, null, { timeout: 180000 });
    await page.click("text=新游戏");
    await page.waitForFunction(() => {
      const st = window.__game?.stage;
      return st?.chapter?.id === "keep" && st.chapter.step === 3 && !!st.player && !!st.underground;
    }, null, { timeout: 600000 });
    await page.waitForTimeout(4000);
    await routeProbe(page);
    // the doors on the way stand open (the beats open them with the key ring, the kick); go
    await page.evaluate(
      new Function(
        "wps",
        `${FLOORS}
        const d = u.doors;
        d.store_door.locked = false;
        d.store_door.set(1);
        d.stair_door.set(1);
        d.torture_door.set(1);
        st.world.rig.pitch = 0;
        const W = (window.__walk = { i: 0, samples: [], done: false, zones: [] });
        const level = { gf: GF, bs: BS };
        const off = st.world.onUpdate(() => {
          const p = st.player.position;
          let wp = wps[W.i];
          while (wp && Math.hypot(wp[0] - p.x, wp[1] - p.z) < 0.3) wp = wps[++W.i];
          if (!wp) {
            W.done = true;
            off();
            return;
          }
          st.world.rig.yaw = Math.atan2(-(wp[0] - p.x), -(wp[1] - p.z));
          const sf = stairFloor(p.x, p.z);
          const want = sf === null ? (wp[2] === "stair" ? null : level[wp[2]]) : sf ?? null;
          W.samples.push([st.world.time, p.x, p.y, p.z, W.i, want]);
          const z = u.zone + "/" + st.world.env.interior;
          if (W.zones[W.zones.length - 1] !== z) W.zones.push(z);
        });
      `,
      ),
      WALK,
    );
    await page.keyboard.down("KeyW");
    let shot = 0;
    const shotsAt = new Set([4, 7, 10, 16, 22, 26]);
    let state = { done: false, i: 0, n: 0 };
    for (let k = 0; k < 900; k++) {
      await page.waitForTimeout(1000);
      state = await page.evaluate(() => {
        const W = window.__walk;
        const s = W.samples[W.samples.length - 1];
        return { done: W.done, i: W.i, n: W.samples.length, t: s?.[0], p: s ? [s[1], s[2], s[3]] : null };
      });
      if (shotsAt.has(state.i)) {
        shotsAt.delete(state.i);
        await page.screenshot({ path: `${SHOTS}/kw-walk-${shot++}-wp${state.i}.png` });
      }
      if (state.done) break;
      // a walk stuck for good: stop waiting (the stall check reports where)
      const W = await page.evaluate(() => {
        const W = window.__walk, s = W.samples;
        if (s.length < 2) return 0;
        const last = s[s.length - 1];
        let j = s.length - 1;
        while (j > 0 && last[0] - s[j][0] < 15) j--;
        return last[0] - s[j][0] >= 15 && Math.hypot(last[1] - s[j][1], last[3] - s[j][3]) < 0.3 ? 1 : 0;
      });
      if (W) break;
    }
    await page.keyboard.up("KeyW");
    await page.screenshot({ path: `${SHOTS}/kw-walk-end.png` });
    const w = await page.evaluate(() => ({ samples: window.__walk.samples, zones: window.__walk.zones, done: window.__walk.done, i: window.__walk.i }));
    const s = w.samples;
    fs.writeFileSync(`${SHOTS}/kw-walk.json`, JSON.stringify(w));
    console.log(`  walk: ${w.done ? "reached the end" : `stopped before waypoint ${w.i} ${JSON.stringify(WALK[w.i])}`} after ${s.length ? (s[s.length - 1][0] - s[0][0]).toFixed(1) : 0} s game time (${((Date.now() - t0) / 1000).toFixed(0)} s real), ${s.length} frames`);
    console.log(`  walk zones: ${w.zones.join(" → ")}`);
    check("walk: reaches B3 through the storeroom, both flights (down, up, down) and the corridor", w.done, `last waypoint ${w.i}/${WALK.length}`);
    // stalls: anywhere the feet stayed within 0.15 m of a spot for 2 s of game time (the walk turns
    // back on itself, so not the net displacement)
    const stalls = [];
    for (let a = 0, b = 0; a < s.length; a++) {
      while (b < s.length && s[b][0] - s[a][0] < 2) b++;
      if (b >= s.length) break;
      let far = 0;
      for (let k = a + 1; k <= b; k++) far = Math.max(far, Math.hypot(s[k][1] - s[a][1], s[k][3] - s[a][3]));
      if (far < 0.15) {
        stalls.push(`t ${s[a][0].toFixed(1)}…${s[b][0].toFixed(1)} (${b - a} frames) at (${s[a].slice(1, 4).map((v) => v.toFixed(2)).join(", ")}) heading for ${s[a][4]}`);
        a = b;
      }
    }
    check("walk: never stalls for more than 2 s", stalls.length === 0, stalls.slice(0, 4).join("; "));
    // the floor: never more than 0.4 m off where the route expects it
    let worst = { d: 0, at: null };
    for (const x of s) {
      if (x[5] === null) continue;
      const d = Math.abs(x[2] - x[5]);
      if (d > worst.d) worst = { d, at: x };
    }
    check(
      "walk: the feet stay within 0.4 m of the route's floor",
      worst.d <= 0.4,
      `worst ${worst.d.toFixed(3)} m${worst.at ? ` at (${worst.at.slice(1, 4).map((v) => v.toFixed(2)).join(", ")}), floor ${worst.at[5].toFixed(2)}` : ""}`,
    );
    const lastZone = w.zones[w.zones.length - 1] ?? "";
    check("walk: ends in B3 under the basement profile", lastZone === "B3/basement", lastZone);
    check("walk: no page errors", errors.length === 0, errors.slice(0, 3).join(" | "));
  } catch (e) {
    check("walk: runs", false, String(e).slice(0, 300));
    await page.screenshot({ path: `${SHOTS}/kw-walk-fail.png` }).catch(() => {});
    if (errors.length) console.log("  errors:", errors.slice(0, 5).join("\n  "));
  } finally {
    await page.context().close();
  }
}

for (const faction of FACTIONS)
  for (const step of STEPS) {
    // the imperial route differs only where the checkpoints do (steps 1 and 2)
    if (faction === "imperial" && !(step === 1 || step === 2)) continue;
    await run(step, faction);
  }
if (ROUTE) await walkRoute();
await browser.close();
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed ? 1 : 0);
