// The dragon chapter hands over to the keep seamlessly (design §0, §3.8). WebGL.
//   node tests/keep-handover.mjs              (both parts)
//   PARTS=skip node tests/keep-handover.mjs   (one of: natural, skip)
//
// natural — played out from the street (the player kept beside the scribe by the test): at the cut
//   the player is not moved and the camera does not turn (the keep picks the player up where the
//   dragon chapter left them), the dragon flies on, the town burns on, the screen stays lit.
// skip — skipped from its last step: the keep starts at the gate and fades itself in (the skip left
//   the screen black), the dragon still flying and the town still burning (nothing pops: the stage
//   owns both), the underground loads behind it, the keep cannot be skipped before the choice at the
//   gate, and once Brun is chosen a skip of the keep puts the player on the gallery's far bank under
//   the cave profile before the end card.
import { chromium } from "playwright-core";

const SHOTS = process.env.SHOTS ?? "/tmp/claude-0/shots";
const PARTS = (process.env.PARTS ?? "natural,skip").split(",");
const browser = await chromium.launch({
  executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
  args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"],
});
const results = [];
const check = (name, ok, detail = "") => {
  results.push(ok);
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? "  " + detail : ""}`);
};

async function open(ts) {
  const page = await (await browser.newContext({ viewport: { width: 960, height: 540 } })).newPage();
  const errors = [];
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  page.on("pageerror", (e) => errors.push(`${e.message}\n${e.stack}`));
  await page.goto(`http://localhost:4173/?webgl&debug&chapter=dragon&from=street&timescale=${ts}`);
  await page.waitForFunction(() => performance.getEntriesByName("menu-3d-ready").length > 0, null, { timeout: 180000 });
  await page.click("text=新游戏");
  await page.waitForFunction(() => window.__game?.stage?.chapter?.id === "dragon", null, { timeout: 600000 });
  return { page, errors };
}

const state = (page) =>
  page.evaluate(() => {
    const st = window.__game?.stage;
    const d = st?.dragons;
    const p = st?.player?.position;
    const fade = document.getElementById("fade");
    return {
      ch: st?.chapter?.id ?? null,
      step: st?.chapter?.step ?? null,
      end: !!document.getElementById("endcard"),
      dragon: d ? { mode: d.mode, on: d.dragon.root.isEnabled(), pos: d.dragon.root.position.asArray().map((v) => +v.toFixed(1)) } : null,
      fires: st?.townFires ? { count: st.townFires.count, paused: st.townFires.paused } : null,
      underground: !!st?.underground,
      profile: st?.world?.env?.interior ?? null,
      p: p ? [p.x, p.y, p.z].map((v) => +v.toFixed(2)) : null,
      yaw: st?.world?.rig?.yaw ?? null,
      t: st?.world?.time ?? 0,
      fade: fade ? { on: fade.classList.contains("on"), opacity: +getComputedStyle(fade).opacity } : null,
      skippable: !!st?.canSkip,
    };
  });

/** The stage's world keeps going and the keep's step 0 looks right (shared by both parts). */
async function keepAtGate(page, before, tag) {
  const k0 = await state(page);
  console.log(`  ${tag} keep:`, JSON.stringify(k0));
  check(`${tag}: the keep follows the dragon chapter, at step 0`, k0.ch === "keep" && k0.step === 0);
  check(`${tag}: the dragon flies on (not hidden)`, !!k0.dragon && k0.dragon.on && k0.dragon.mode !== "hidden" && k0.dragon.mode !== "idle", JSON.stringify(k0.dragon));
  check(`${tag}: the town still burns, as many fires as before`, !!k0.fires && !k0.fires.paused && k0.fires.count >= (before.fires?.count ?? 1), JSON.stringify(k0.fires));
  await page.waitForFunction((t) => window.__game.stage.world.time - t > 3, k0.t, { timeout: 300000 });
  const k1 = await state(page);
  const moved = Math.hypot(k1.dragon.pos[0] - k0.dragon.pos[0], k1.dragon.pos[1] - k0.dragon.pos[1], k1.dragon.pos[2] - k0.dragon.pos[2]);
  check(`${tag}: and keeps moving`, moved > 5, `${moved.toFixed(1)} m in ${(k1.t - k0.t).toFixed(1)} s`);
  check(`${tag}: outdoors at the gate`, k1.profile === "outdoor");
  // (the fade-in takes 1.2 s of real time)
  await page.waitForTimeout(1500);
  const k2 = await state(page);
  check(`${tag}: the screen is lit (no black fade left on)`, !!k2.fade && !k2.fade.on && k2.fade.opacity < 0.05, JSON.stringify(k2.fade));
  return k2;
}

async function natural() {
  const { page, errors } = await open(3);
  try {
    await page.waitForTimeout(3000);
    const before = await state(page);
    console.log("  natural dragon:", JSON.stringify(before));
    // every teleport of the player is logged with the chapter playing then; the test keeps the player
    // beside the scribe (facing a fixed way) until the keep has begun
    await page.evaluate(() => {
      const st = window.__game.stage;
      const pl = st.player;
      const tp = pl.teleport.bind(pl);
      window.__tp = [];
      let mine = false;
      pl.teleport = (p, yaw) => {
        if (!mine) window.__tp.push({ ch: st.running?.chapter?.id ?? null, p: [p.x, p.y, p.z], yaw });
        return tp(p, yaw);
      };
      const V = pl.position.constructor;
      const follow = setInterval(() => {
        if (st.running?.chapter?.id === "keep" || st.chapter?.id === "keep") return clearInterval(follow);
        const s = st.world.npcs.get("scribe");
        if (!s) return;
        const x = s.root.position.x + 1.6, z = s.root.position.z + 1.6;
        mine = true;
        tp(new V(x, st.world.heightAt(x, z) + 0.1, z), 2.0);
        mine = false;
      }, 200);
    });
    // the town's panic bed (the stage's until the keep's K1): the same source before and after the cut
    const bedBefore = await page.evaluate(() => {
      window.__panic = window.__audio?.beds?.get("panic")?.src ?? null;
      return !!window.__panic;
    });
    await page.waitForFunction(() => window.__game?.stage?.chapter?.id === "keep", null, { timeout: 900000 });
    const k = await state(page);
    const bedAfter = await page.evaluate(() => {
      const b = window.__audio?.beds?.get("panic");
      return { same: !!b && b.src === window.__panic, gain: b ? +b.gain.gain.value.toFixed(3) : null };
    });
    if (bedBefore) check("natural: the panic bed carries on through the cut (not restarted)", bedAfter.same, JSON.stringify(bedAfter));
    else console.log("  (no panic bed playing before the cut: audio not running headless)");
    const log = await page.evaluate(() => window.__tp);
    console.log("  natural teleports:", JSON.stringify(log));
    check("natural: nothing teleports the player at the cut", log.length === 0, JSON.stringify(log));
    check("natural: the camera has not turned (yaw kept)", k.yaw !== null && Math.abs(Math.atan2(Math.sin(k.yaw - 2.0), Math.cos(k.yaw - 2.0))) < 0.05, String(k.yaw));
    check("natural: the player is where the dragon chapter left them (not on the K0 mark)", !!k.p && Math.hypot(k.p[0] - 60, k.p[2] + 648) > 1, JSON.stringify(k.p));
    await keepAtGate(page, before, "natural");
    await page.screenshot({ path: `${SHOTS}/kh-natural.png` });
  } catch (e) {
    check("natural: run", false, String(e).slice(0, 400));
    await page.screenshot({ path: `${SHOTS}/kh-natural-fail.png` }).catch(() => {});
  }
  check("natural: no page errors", errors.length === 0, errors.slice(0, 5).join(" | "));
  await page.context().close();
}

async function skip() {
  const { page, errors } = await open(2);
  try {
    await page.waitForTimeout(5000);
    const before = await state(page);
    console.log("  skip dragon:", JSON.stringify(before));
    await page.evaluate(() => void window.__game.stage.skipChapter());
    await page.waitForFunction(() => window.__game?.stage?.chapter?.id === "keep", null, { timeout: 300000 });
    const k = await keepAtGate(page, before, "skip");
    // the choice at the gate is the player's to make (§0 #2): no skipping until it is made
    check("skip: the keep at the gate cannot be skipped before the choice", k.skippable === false);
    await page.screenshot({ path: `${SHOTS}/kh-keep0.png` });
    await page.waitForFunction(() => !!window.__game.stage.underground, null, { timeout: 600000 });
    check("skip: the underground loads behind the gate", true);
    // choose Brun (as the E prompt does), then the chapter may be skipped
    await page.evaluate(() => window.__game.stage.chapter.debugChoose("brun"));
    await page.waitForFunction(() => !!window.__game.stage.canSkip, null, { timeout: 300000 });
    check("skip: skippable once the choice is made", true);
    await page.evaluate(() => void window.__game.stage.skipChapter());
    await page.waitForFunction(() => window.__game?.stage?.chapter === null || !!document.getElementById("endcard"), null, { timeout: 120000 });
    const after = await state(page);
    console.log("  skipped:", JSON.stringify(after));
    check("skip: skipped to the gallery's far bank (gal_s_cp)", !!after.p && Math.hypot(after.p[0] - 47.5, after.p[2] + 738.5) < 1 && Math.abs(after.p[1] - 27.06) < 0.4, JSON.stringify(after.p));
    check("skip: cave profile", after.profile === "cave", String(after.profile));
    const torch = await page.evaluate(() => {
      const st = window.__game.stage;
      const c = st.world.npcs.get(st.flags.faction === "imperial" ? "scribe" : "brun");
      const lever = st.underground.props.bridge?.lever;
      return {
        torch: !!st.world.scene.getTransformNodeByName("carried_torch"),
        lever: lever?.rotationQuaternion ? +(2 * Math.acos(Math.min(1, Math.abs(lever.rotationQuaternion.w)))).toFixed(3) : null,
        bridge: st.underground.props.bridge?.state ?? null,
        companion: c ? c.root.position.asArray().map((v) => +v.toFixed(2)) : null,
      };
    });
    console.log("  end state:", JSON.stringify(torch));
    // the filled kit is on the body (nobody had handed the player gear at the gate)
    await page.waitForTimeout(3000);
    const kit = await page.evaluate(() => {
      const st = window.__game.stage;
      const items = st.gear?.items ?? null;
      return { inv: st.flags.inv, gear: !!st.gear, main: items ? Object.keys(items).filter((k) => items[k]) : null };
    });
    console.log("  kit:", JSON.stringify(kit));
    check(
      "skip: the filled kit is on the player's body",
      kit.gear && kit.inv.weapon !== "none" && kit.inv.armour > 0 && kit.main.includes("main") && kit.main.includes("off") === kit.inv.shield,
      JSON.stringify(kit),
    );
    check("skip: the guide carries a torch", torch.torch);
    check("skip: the bridge is broken and the lever pulled", torch.bridge === null || (torch.bridge === "broken" && Math.abs((torch.lever ?? 0) - 0.6457) < 0.01), JSON.stringify(torch));
    await page.waitForSelector("#endcard", { timeout: 120000 });
    check("skip: the end card follows", true);
  } catch (e) {
    check("skip: run", false, String(e).slice(0, 400));
    await page.screenshot({ path: `${SHOTS}/kh-fail.png` }).catch(() => {});
  }
  check("skip: no page errors", errors.length === 0, errors.slice(0, 5).join(" | "));
  await page.context().close();
}

if (PARTS.includes("natural")) await natural();
if (PARTS.includes("skip")) await skip();
await browser.close();
const failed = results.filter((r) => !r).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed ? 1 : 0);
