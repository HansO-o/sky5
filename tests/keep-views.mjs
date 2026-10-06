// Look around the keep and the gallery (debug): starts `?debug&chapter=keep&from=STEP`, then for each
// view puts the player in the room (the zones show what it needs) and cuts the camera to a vantage
// point, with a screenshot each (/tmp/claude-0/shots/kv-<name>.png).
//   STEP=3 VIEWS=hall,g2 node tests/keep-views.mjs
import { chromium } from "playwright-core";

const STEP = process.env.STEP ?? "3";
const SHOTS = process.env.SHOTS ?? "/tmp/claude-0/shots";
/** name → [player x, z, y hint], camera [x, y, z], look-at [x, y, z], extra setup (evaluated in the page) */
const VIEWS = {
  gate_out: [[60, -647, 38.2], [60, 40.2, -644], [60, 40, -654], "st.gate.set(0)"],
  gate_open: [[60, -647, 38.2], [60, 40.2, -644], [60, 39.5, -660], "st.gate.set(1)"],
  postern_out: [[45, -656, 38.2], [43.5, 39.8, -655.5], [48, 39.2, -659.2], "st.postern.set(1)"],
  hall: [[60, -656.5, 38.2], [60, 41.5, -654.6], [60, 38.8, -662], ""],
  hall_s: [[60, -661, 38.2], [60, 41, -663.3], [60, 39.5, -655], "st.gate.set(0)"],
  g2: [[51.5, -657, 38.2], [53.0, 40.6, -655.0], [49.2, 38.6, -661], ""],
  g2n: [[51.5, -662, 38.2], [52.8, 40.6, -660.5], [50, 38.6, -668], ""],
  g3: [[60, -666, 38.2], [65.2, 40.8, -665.0], [56, 38.4, -669], ""],
  g4: [[68.5, -657, 38.2], [67.2, 40.8, -655.0], [71.2, 38.8, -658.5], "st.underground.doors.store_door.set(1)"],
  stair_top: [[69.5, -662.3, 38.2], [70.8, 40.6, -661.8], [68.5, 34.5, -667], "st.underground.doors.stair_door.set(1)"],
  stair_mid: [[69.2, -668.5, 35.2], [70.5, 37.2, -667.8], [67.5, 33, -662], ""],
  b1: [[68.2, -660, 32.2], [70.8, 34.6, -655.0], [66.5, 32.6, -662.5], ""],
  b2: [[63, -656.4, 32.2], [66.2, 34.3, -656.4], [58, 32.8, -656.4], "st.underground.doors.torture_door.set(1)"],
  b3: [[56.5, -657, 32.2], [58.3, 34.2, -655.0], [51.4, 32.4, -660], "st.underground.doors.torture_door.set(1)"],
  b3_cage: [[55, -657, 32.2], [54.5, 33.8, -655.0], [51.4, 32.8, -656.6], ""],
  b4: [[54.1, -665, 32.2], [54.1, 34.6, -664.5], [54.1, 32.8, -676], ""],
  b5: [[54.1, -683, 32.2], [57.6, 34.8, -682.4], [53, 32.6, -687.5], ""],
  gallery: [[51, -714, 28.2], [51.2, 30.6, -712.8], [48, 27.4, -728], ""],
  camp: [[50, -720, 28.2], [49.5, 30.4, -718.5], [54, 28, -725], ""],
};
const pick = (process.env.VIEWS ?? Object.keys(VIEWS).join(",")).split(",");

const browser = await chromium.launch({
  executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
  args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"],
});
const page = await (await browser.newContext({ viewport: { width: 960, height: 540 } })).newPage();
const errors = [];
page.on("console", (m) => (m.type() === "error" || m.type() === "warning") && errors.push(`[${m.type()}] ${m.text()}`));
page.on("pageerror", (e) => errors.push(`${e.message}\n${e.stack}`));
await page.goto(`http://localhost:4173/?webgl&debug&chapter=keep&from=${STEP}&faction=${process.env.FACTION ?? "rebel"}`);
await page.waitForFunction(() => performance.getEntriesByName("menu-3d-ready").length > 0, null, { timeout: 180000 });
await page.click("text=新游戏");
await page.waitForFunction(() => window.__game?.stage?.chapter?.id === "keep" && !!window.__game.stage.underground && !!window.__game.stage.player, null, { timeout: 600000 });
await page.waitForTimeout(3000);
for (const name of pick) {
  const v = VIEWS[name];
  if (!v) continue;
  const info = await page.evaluate(
    ([p, cam, look, setup]) => {
      const st = window.__game.stage;
      const V = st.player.position.constructor;
      const u = st.underground;
      const y = u.floor(p[0], p[1], p[2]) ?? p[2];
      st.player.teleport(new V(p[0], y + 0.02, p[1]), 0);
      if (setup) new Function("st", setup)(st);
      u.check();
      st.world.rig.cut(new V(cam[0], cam[1], cam[2]), new V(look[0], look[1], look[2]));
      return { zone: u.zone, level: u.level, profile: st.world.env.interior, y };
    },
    [v[0], v[1], v[2], v[3]],
  );
  // the lighting blend and the light pool's crossfades
  await page.waitForTimeout(3500);
  const after = await page.evaluate((dump) => {
    const st = window.__game.stage;
    const pool = st.world.lights;
    const l = pool.lights.map((x) => +x.intensity.toFixed(2));
    const r = { zone: st.underground.zone, profile: st.world.env.interior, lights: l, outdoor: st.world.outdoorVisible, slots: pool.slots };
    // the pool's sources near the eye (debug: DUMP=1)
    if (dump) {
      const eye = st.world.rig.position;
      r.sources = [...pool.sources.values()]
        .map((s) => ({ id: s.id, d: +Math.hypot(s.pos.x - eye.x, s.pos.y - eye.y, s.pos.z - eye.z).toFixed(1), i: s.intensity, slot: s.slot, p: [s.pos.x, s.pos.y, s.pos.z].map((v) => +v.toFixed(1)) }))
        .filter((s) => s.d < 25)
        .sort((a, b) => a.d - b.d);
    }
    return r;
  }, !!process.env.DUMP);
  console.log(name.padEnd(10), JSON.stringify(info), "→", JSON.stringify(after));
  await page.screenshot({ path: `${SHOTS}/kv-${name}.png` });
}
console.log(errors.filter((e) => !/\[timing\]|BJS -|no model for/.test(e)).slice(0, 20).join("\n"));
await browser.close();
