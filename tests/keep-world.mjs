// The keep chapter's world, checkpoint by checkpoint (design §11): each `?debug&chapter=keep&from=N`
// start must put the player on the floor of the right level (no fall-through, no stuck-in-wall:
// feet within 0.3 m of the expected floor for 3 s), with the right lighting profile, and the
// screenshot (/tmp/claude-0/shots/kw-<step>[i].png) must show the room. WebGL on SwiftShader.
//   node tests/keep-world.mjs            (steps 0–4 on the rebel route, 1–2 on the imperial one)
//   STEPS=0,4 FACTIONS=rebel node tests/keep-world.mjs
import { chromium } from "playwright-core";

const TS = process.env.TS ?? "1";
const SHOTS = process.env.SHOTS ?? "/tmp/claude-0/shots";
const STEPS = (process.env.STEPS ?? "0,1,2,3,4").split(",").map(Number);
const FACTIONS = (process.env.FACTIONS ?? "rebel,imperial").split(",");
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
    await page.screenshot({ path: `${SHOTS}/kw-${tag}.png` });
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

for (const faction of FACTIONS)
  for (const step of STEPS) {
    // the imperial route differs only where the checkpoints do (steps 1 and 2)
    if (faction === "imperial" && !(step === 1 || step === 2)) continue;
    await run(step, faction);
  }
await browser.close();
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed ? 1 : 0);
